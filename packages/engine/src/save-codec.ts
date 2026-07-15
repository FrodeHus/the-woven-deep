import type { ActiveRun } from './model.js';
import { SaveLoadError } from './save-error.js';
import { legacyActiveRunV4Schema, legacyActiveRunV5Schema, validateActiveRun } from './save-schema.js';
import { deriveRngStreams } from './random.js';
import { emptyRunMetrics } from './run-metrics.js';
import { stableJson } from './stable-json.js';
import { SAVE_SCHEMA_VERSION } from './versions.js';

export function encodeActiveRun(state: ActiveRun): string {
  return stableJson(validateActiveRun(state));
}

function migrateV4ToV5(input: unknown): unknown {
  const v4 = legacyActiveRunV4Schema.parse(input);
  const derived = deriveRngStreams(v4.runSeed);
  return {
    ...v4,
    schemaVersion: 5,
    rng: {
      ...v4.rng,
      'merchant-stock': derived['merchant-stock'],
      'merchant-runtime': derived['merchant-runtime'],
    },
    hero: { ...v4.hero, currency: 0 },
    reputations: [],
    activeTrade: null,
  };
}

function migrateV5ToV6(input: unknown): unknown {
  const v5 = legacyActiveRunV5Schema.parse(input);
  const derived = deriveRngStreams(v5.runSeed);
  return {
    ...v5,
    schemaVersion: 6,
    rng: { ...v5.rng, 'run-records': derived['run-records'] },
    metrics: emptyRunMetrics(),
    conclusion: null,
  };
}

function migrateLegacy(input: unknown, schemaVersion: 4 | 5): ActiveRun {
  try {
    return validateActiveRun(schemaVersion === 4 ? migrateV5ToV6(migrateV4ToV5(input)) : migrateV5ToV6(input));
  } catch (cause) {
    if (cause instanceof SaveLoadError) throw cause;
    const issue = (cause as { issues?: readonly { path: readonly PropertyKey[]; message: string }[] }).issues?.[0];
    const path = issue?.path.map(String).join('.') || '$';
    throw new SaveLoadError('invalid_save', path,
      `Invalid save at ${path}: ${issue?.message ?? 'legacy schema validation failed'}`, { cause });
  }
}

export function decodeActiveRun(json: string): ActiveRun {
  let input: unknown;
  try { input = JSON.parse(json); }
  catch (cause) { throw new SaveLoadError('malformed_json', '$', 'Save is not valid JSON', { cause }); }
  const schemaVersion = typeof input === 'object' && input !== null
    ? (input as Readonly<Record<string, unknown>>).schemaVersion
    : undefined;
  if (schemaVersion === 4 || schemaVersion === 5) return migrateLegacy(input, schemaVersion);
  if (schemaVersion !== SAVE_SCHEMA_VERSION) {
    throw new SaveLoadError(
      'unsupported_version',
      'schemaVersion',
      `Unsupported save schema version ${String(schemaVersion)}; expected ${SAVE_SCHEMA_VERSION}`,
    );
  }
  return validateActiveRun(input);
}
