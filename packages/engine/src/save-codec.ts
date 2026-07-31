import type { CompiledContentPack } from '@woven-deep/content';
import { validateRequiredFloorLootTables } from './loot-placement.js';
import type { ActiveRun } from './model.js';
import { SaveLoadError } from './save-error.js';
import {
  legacyActiveRunV4Schema,
  legacyActiveRunV5Schema,
  legacyActiveRunV6Schema,
  legacyActiveRunV7Schema,
  legacyActiveRunV8Schema,
  legacyActiveRunV9Schema,
  legacyActiveRunV10Schema,
  legacyActiveRunV11Schema,
  legacyActiveRunV12Schema,
  legacyActiveRunV13Schema,
  emptyLegacyRunMetricsV9,
  validateActiveRun,
} from './save-schema.js';
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

function migrateV5ToV6(input: unknown): unknown {
  const v5 = legacyActiveRunV5Schema.parse(input);
  const derived = deriveRngStreams(v5.runSeed);
  return {
    ...v5,
    schemaVersion: 6,
    rng: { ...v5.rng, 'run-records': derived['run-records'] },
    metrics: emptyLegacyRunMetricsV9,
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

function migrateV8ToV9(input: unknown): unknown {
  const v8 = legacyActiveRunV8Schema.parse(input);
  return {
    ...v8,
    schemaVersion: 9,
    // Pre-Weave actors load at full Weave. Migrations are content-free: the hero's derived maximum
    // is `base 4 + wits`, matching the bundled `maxWeave: { base: 4, wits: 1 }` formula; non-hero
    // actors carry no Weave pool (they never cast).
    actors: v8.actors.map((actor) => {
      const maxWeave = actor.playerControlled ? 4 + actor.attributes.wits : 0;
      return { ...actor, weave: maxWeave, maxWeave };
    }),
  };
}

function migrateV9ToV10(input: unknown): unknown {
  const v9 = legacyActiveRunV9Schema.parse(input);
  return {
    ...v9,
    schemaVersion: 10,
    metrics: { ...v9.metrics, defeatedBossMonsterIds: [] },
  };
}

function stripAchievementCriteriaId(event: Record<string, unknown>): Record<string, unknown> {
  if (event['type'] !== 'achievement.granted') return event;
  const { criteriaId: _criteriaId, ...rest } = event;
  return rest;
}

function migrateV10ToV11(input: unknown): unknown {
  const v10 = legacyActiveRunV10Schema.parse(input);
  return {
    ...v10,
    schemaVersion: 11,
    recentCommands: v10.recentCommands.map((recordedCommand) => ({
      ...recordedCommand,
      events: recordedCommand.events.map(stripAchievementCriteriaId),
      publicEvents: recordedCommand.publicEvents.map(stripAchievementCriteriaId),
    })),
  };
}

function migrateV11ToV12(input: unknown): unknown {
  const v11 = legacyActiveRunV11Schema.parse(input);
  const derived = deriveRngStreams(v11.runSeed);
  return {
    ...v11,
    schemaVersion: 12,
    rng: { ...v11.rng, 'loot-placement': derived['loot-placement'] },
  };
}

// The artifact bump is field-defaults only: a mid-run v12 save resumes with no artifact offered and
// an empty undrawn pool, so it neither offers nor drops anything for the rest of that run.
function migrateV12ToV13(input: unknown): unknown {
  const v12 = legacyActiveRunV12Schema.parse(input);
  return { ...v12, schemaVersion: 13, offeredArtifact: null, artifactsUndiscovered: [] };
}

// The curse bump adds one optional item field (`ItemInstance.curse`, absent on every existing
// item, no default to write) and one required-nullable recorded-heirloom field
// (`RecordedHeirloomSnapshot.curse`, which must be written as `null` for every already-recorded
// Hall standing, since the live schema requires the key). Neither can sprout a curse on load.
function migrateV13ToV14(input: unknown): unknown {
  const v13 = legacyActiveRunV13Schema.parse(input);
  return {
    ...v13,
    schemaVersion: 14,
    fallenHeroStandings: v13.fallenHeroStandings.map((standing) => ({
      ...standing,
      heirloom: { ...standing.heirloom, curse: null },
    })),
  };
}

function migrateLegacy(
  input: unknown,
  schemaVersion: 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13,
): ActiveRun {
  try {
    const migrated =
      schemaVersion === 4
        ? migrateV13ToV14(
            migrateV12ToV13(
              migrateV11ToV12(
                migrateV10ToV11(
                  migrateV9ToV10(
                    migrateV8ToV9(migrateV7ToV8(migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(input))))),
                  ),
                ),
              ),
            ),
          )
        : schemaVersion === 5
          ? migrateV13ToV14(
              migrateV12ToV13(
                migrateV11ToV12(
                  migrateV10ToV11(
                    migrateV9ToV10(migrateV8ToV9(migrateV7ToV8(migrateV6ToV7(migrateV5ToV6(input))))),
                  ),
                ),
              ),
            )
          : schemaVersion === 6
            ? migrateV13ToV14(
                migrateV12ToV13(
                  migrateV11ToV12(
                    migrateV10ToV11(
                      migrateV9ToV10(migrateV8ToV9(migrateV7ToV8(migrateV6ToV7(input)))),
                    ),
                  ),
                ),
              )
            : schemaVersion === 7
              ? migrateV13ToV14(
                  migrateV12ToV13(
                    migrateV11ToV12(
                      migrateV10ToV11(migrateV9ToV10(migrateV8ToV9(migrateV7ToV8(input)))),
                    ),
                  ),
                )
              : schemaVersion === 8
                ? migrateV13ToV14(
                    migrateV12ToV13(
                      migrateV11ToV12(migrateV10ToV11(migrateV9ToV10(migrateV8ToV9(input)))),
                    ),
                  )
                : schemaVersion === 9
                  ? migrateV13ToV14(
                      migrateV12ToV13(migrateV11ToV12(migrateV10ToV11(migrateV9ToV10(input)))),
                    )
                  : schemaVersion === 10
                    ? migrateV13ToV14(migrateV12ToV13(migrateV11ToV12(migrateV10ToV11(input))))
                    : schemaVersion === 11
                      ? migrateV13ToV14(migrateV12ToV13(migrateV11ToV12(input)))
                      : schemaVersion === 12
                        ? migrateV13ToV14(migrateV12ToV13(input))
                        : migrateV13ToV14(input);
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

/**
 * Decodes a save, migrating any supported legacy schema version forward.
 *
 * `content` is optional only because callers that merely probe a blob's decodability (and the
 * fixtures' round-trip assertions) have no pack in hand. Every caller that is actually about to
 * play the decoded run passes it, which is what makes the engine-required floor loot tables a
 * load-time guarantee rather than a first-descent surprise. The check runs before the JSON is even
 * parsed and deliberately outside the `SaveLoadError` mapping below: a pack missing a required
 * table is a content fault, not a corrupt save, so it must not be reported as `invalid_save` (nor
 * be swallowed by a host that discards unreadable saves).
 */
export function decodeActiveRun(json: string, content?: CompiledContentPack): ActiveRun {
  if (content !== undefined) validateRequiredFloorLootTables(content);
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
  if (
    schemaVersion === 4 ||
    schemaVersion === 5 ||
    schemaVersion === 6 ||
    schemaVersion === 7 ||
    schemaVersion === 8 ||
    schemaVersion === 9 ||
    schemaVersion === 10 ||
    schemaVersion === 11 ||
    schemaVersion === 12 ||
    schemaVersion === 13
  ) {
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
