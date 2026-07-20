import type { ActiveRun } from './model.js';
import { SaveLoadError } from './save-error.js';
import {
  legacyActiveRunV4Schema,
  legacyActiveRunV5Schema,
  legacyActiveRunV6Schema,
  legacyActiveRunV7Schema,
  validateActiveRun,
} from './save-schema.js';
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

function migrateV6ToV7(input: unknown): unknown {
  const v6 = legacyActiveRunV6Schema.parse(input);
  return {
    ...v6,
    schemaVersion: 7,
    hero: { ...v6.hero, classTags: [], statModifiers: {} },
  };
}

function migrateV7ToV8(input: unknown): unknown {
  const v7 = legacyActiveRunV7Schema.parse(input);
  return {
    ...v7,
    schemaVersion: 8,
    // Migrations are content-free: the literal 6 matches the bundled base house capacity, and a
    // v7 save can never have purchased upgrades (the feature did not exist yet).
    house: { capacity: 6, upgradesPurchased: 0 },
    restockedMilestones: [],
  };
}

function migrateLegacy(input: unknown, schemaVersion: 4 | 5 | 6 | 7): ActiveRun {
  try {
    const migrated =
      schemaVersion === 4
        ? migrateV7ToV8(migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(input))))
        : schemaVersion === 5
          ? migrateV7ToV8(migrateV6ToV7(migrateV5ToV6(input)))
          : schemaVersion === 6
            ? migrateV7ToV8(migrateV6ToV7(input))
            : migrateV7ToV8(input);
    return validateActiveRun(migrated);
  } catch (cause) {
    if (cause instanceof SaveLoadError) throw cause;
    const issue = (
      cause as { issues?: readonly { path: readonly PropertyKey[]; message: string }[] }
    ).issues?.[0];
    const path = issue?.path.map(String).join('.') || '$';
    throw new SaveLoadError(
      'invalid_save',
      path,
      `Invalid save at ${path}: ${issue?.message ?? 'legacy schema validation failed'}`,
      { cause },
    );
  }
}

export function decodeActiveRun(json: string): ActiveRun {
  let input: unknown;
  try {
    input = JSON.parse(json);
  } catch (cause) {
    throw new SaveLoadError('malformed_json', '$', 'Save is not valid JSON', { cause });
  }
  const schemaVersion =
    typeof input === 'object' && input !== null
      ? (input as Readonly<Record<string, unknown>>).schemaVersion
      : undefined;
  if (schemaVersion === 4 || schemaVersion === 5 || schemaVersion === 6 || schemaVersion === 7) {
    return migrateLegacy(input, schemaVersion);
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
