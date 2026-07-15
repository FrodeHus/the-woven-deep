import type { CompiledContentPack, VaultContentEntry } from '@woven-deep/content';
import type { OpaqueId } from './model.js';
import { heroActor } from './actor-model.js';
import { generateFloor } from './generate-floor.js';
import { createClassicTheme } from './generation-mask.js';
import { allocateFloorSeed } from './generation-random.js';
import { integrateGeneratedFloor, type FloorIntegrationResult } from './floor-integration.js';
import type { ActiveRun } from './model.js';
import { NEW_RUN_FLOOR_HEIGHT, NEW_RUN_FLOOR_THEME_SETTINGS, NEW_RUN_FLOOR_WIDTH } from './new-run.js';

/**
 * Generates a floor identifier from a depth number with 3-digit zero-padding.
 * Supports depths 1-999; depths >= 1000 throw RangeError.
 * Uses 3-digit padding to ensure lexicographic string comparison matches numeric ordering.
 */
export function depthFloorId(depth: number): OpaqueId {
  if (depth < 1 || depth > 999) {
    throw new RangeError(`floor depth must be between 1 and 999, got ${depth}`);
  }
  return `floor.depth-${String(depth).padStart(3, '0')}` as OpaqueId;
}

function nextFloorId(depth: number): string {
  return depthFloorId(depth);
}

/**
 * Generates and enters the floor below the hero's current one. The hero must stand on the active
 * floor's stair-down tile; the run must not already be concluded. Mirrors `createNewRun`'s
 * floor-generation settings (same width/height/theme) so the whole run stays on one generation
 * profile, and delegates floor bookkeeping (metrics, validation) to `integrateGeneratedFloor`'s
 * "transitioning to inserted floor" branch.
 */
export function descendToNextFloor(
  run: ActiveRun,
  context: Readonly<{ content: CompiledContentPack }>,
): FloorIntegrationResult {
  if (run.conclusion !== null) {
    throw new Error('descendToNextFloor cannot transition a concluded run');
  }

  const activeFloor = run.floors.find((floor) => floor.floorId === run.activeFloorId);
  if (activeFloor === undefined) {
    throw new Error(`internal invariant: active floor ${run.activeFloorId} is missing from floors`);
  }
  const hero = heroActor(run);
  const stairDown = activeFloor.stairDown;
  if (stairDown === null || hero.x !== stairDown.x || hero.y !== stairDown.y) {
    throw new Error('descendToNextFloor requires the hero to be standing on stair-down');
  }

  const allocation = allocateFloorSeed(run.rng.generation);
  const nextDepth = activeFloor.depth + 1;
  const floorId = nextFloorId(nextDepth);
  const vaults = context.content.entries.filter((entry): entry is VaultContentEntry => entry.kind === 'vault');
  const generated = generateFloor({
    floorId,
    floorSeed: allocation.floorSeed,
    depth: nextDepth,
    width: NEW_RUN_FLOOR_WIDTH,
    height: NEW_RUN_FLOOR_HEIGHT,
    theme: createClassicTheme(NEW_RUN_FLOOR_WIDTH, NEW_RUN_FLOOR_HEIGHT, NEW_RUN_FLOOR_THEME_SETTINGS),
    vaults,
  });
  const stairUp = generated.floor.stairUp;
  if (stairUp === null) throw new Error('internal invariant: generated floor must have a stair-up');

  const moved: ActiveRun = {
    ...run,
    actors: run.actors.map((actor) => actor.actorId === hero.actorId
      ? { ...actor, floorId, x: stairUp.x, y: stairUp.y }
      : actor),
    activeFloorId: floorId,
    activeFloorEnteredAt: run.worldTime,
  };

  return integrateGeneratedFloor(moved, generated, allocation, { content: context.content });
}
