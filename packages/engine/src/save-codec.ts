import type { ActiveRun } from './model.js';
import { SaveLoadError } from './save-error.js';
import { legacyActiveRunV4Schema, validateActiveRun } from './save-schema.js';
import { deriveRngStreams } from './random.js';
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

export function decodeActiveRun(json: string): ActiveRun {
  let input: unknown;
  try { input = JSON.parse(json); }
  catch (cause) { throw new SaveLoadError('malformed_json', '$', 'Save is not valid JSON', { cause }); }
  const schemaVersion = typeof input === 'object' && input !== null
    ? (input as Readonly<Record<string, unknown>>).schemaVersion
    : undefined;
  if (schemaVersion === 4) {
    try { return validateActiveRun(migrateV4ToV5(input)); }
    catch (cause) {
      if (cause instanceof SaveLoadError) throw cause;
      const issue = (cause as { issues?: readonly { path: readonly PropertyKey[]; message: string }[] }).issues?.[0];
      const path = issue?.path.map(String).join('.') || '$';
      throw new SaveLoadError('invalid_save', path,
        `Invalid save at ${path}: ${issue?.message ?? 'legacy schema validation failed'}`, { cause });
    }
  }
  if (schemaVersion !== SAVE_SCHEMA_VERSION) {
    throw new SaveLoadError(
      'unsupported_version',
      'schemaVersion',
      `Unsupported save schema version ${String(schemaVersion)}; expected ${SAVE_SCHEMA_VERSION}`,
    );
  }
  return validateActiveRun(input);
}
