import { z } from 'zod';
import type { ActiveRun } from './model.js';
import { deriveRngStreams, expandLegacySeed } from './random.js';
import { SaveLoadError } from './save-error.js';
import { validateActiveRun } from './save-schema.js';
import { ENGINE_GAME_VERSION, SAVE_SCHEMA_VERSION } from './versions.js';

const identifier = z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,127}$/);
const heroName = z.string().refine(
  (name) => [...name].length >= 1
    && [...name].length <= 40
    && name.normalize('NFC') === name
    && !/[\p{Cc}\p{Cf}]/u.test(name),
);
const safeNonNegative = z.number().int().safe().nonnegative();
const uint32 = z.number().int().min(0).max(0xffff_ffff);
const legacyEntity = z.strictObject({
  entityId: identifier,
  x: safeNonNegative,
  y: safeNonNegative,
});
const legacyHero = z.strictObject({
  heroId: identifier,
  name: heroName,
  floorId: identifier,
  x: safeNonNegative,
  y: safeNonNegative,
});
const legacyFloor = z.strictObject({
  floorId: identifier,
  seed: uint32,
  generatorVersion: z.literal(1),
  width: z.number().int().min(1).max(512),
  height: z.number().int().min(1).max(512),
  depth: z.number().int().min(0).max(10_000),
  tiles: z.array(z.union([z.literal(0), z.literal(1)])).readonly(),
  entities: z.array(legacyEntity).readonly(),
});
const legacyActiveRun = z.strictObject({
  schemaVersion: z.literal(0),
  gameVersion: z.literal(ENGINE_GAME_VERSION),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  runId: identifier,
  seed: uint32,
  revision: safeNonNegative,
  turn: safeNonNegative,
  hero: legacyHero,
  floor: legacyFloor,
});

function unsupportedVersion(message: string): never {
  throw new SaveLoadError('unsupported_version', 'schemaVersion', message);
}

export function migrateActiveRun(input: unknown): ActiveRun {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    unsupportedVersion('Save schema version is missing or unsupported');
  }

  const schemaVersion = (input as Record<string, unknown>).schemaVersion;
  if (schemaVersion === SAVE_SCHEMA_VERSION) return validateActiveRun(input);
  if (schemaVersion !== 0) unsupportedVersion('Save schema version is missing or unsupported');

  const parsed = legacyActiveRun.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const path = issue.path.join('.') || '$';
    throw new SaveLoadError(
      'migration_failed',
      path,
      `Could not migrate save at ${path}: ${issue.message}`,
    );
  }

  const legacy = parsed.data;
  const runSeed = expandLegacySeed(legacy.seed);
  const migrated = {
    schemaVersion: SAVE_SCHEMA_VERSION,
    gameVersion: legacy.gameVersion,
    contentHash: legacy.contentHash,
    runId: legacy.runId,
    runSeed,
    rng: deriveRngStreams(runSeed),
    revision: legacy.revision,
    turn: legacy.turn,
    hero: legacy.hero,
    activeFloorId: legacy.hero.floorId,
    floors: [{
      ...legacy.floor,
      seed: expandLegacySeed(legacy.floor.seed),
    }],
    recentCommands: [],
  };

  try {
    return validateActiveRun(migrated);
  } catch (cause) {
    if (cause instanceof SaveLoadError) {
      throw new SaveLoadError(
        'migration_failed',
        cause.path,
        `Could not migrate save at ${cause.path}: ${cause.message}`,
        { cause },
      );
    }
    throw cause;
  }
}
