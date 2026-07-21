import type { CompiledContentPack, VaultContentEntry } from '@woven-deep/content';
import type { DomainEvent, OpaqueId, Point } from './model.js';
import { balanceEntry } from './actions.js';
import { heroActor, heroPerception } from './actor-model.js';
import { FINAL_CHAMBER_DEPTH, generateFinalChamberFloor } from './final-chamber.js';
import { depthFloorId } from './floor-id.js';
import { generateFloor } from './generate-floor.js';
import { createClassicTheme } from './generation-mask.js';
import { allocateFloorSeed } from './generation-random.js';
import { integrateGeneratedFloor, type FloorIntegrationResult } from './floor-integration.js';
import { restockMerchant } from './merchant-stock.js';
import type { ActiveRun } from './model.js';
import { refreshKnowledge } from './perception.js';
import { recordFloorEntered } from './run-metrics.js';
import { validateActiveRun } from './save-schema.js';
import { compareCodeUnits } from './stable-json.js';
import { tileDefinition } from './terrain.js';
import {
  NEW_RUN_FLOOR_HEIGHT,
  NEW_RUN_FLOOR_THEME_SETTINGS,
  NEW_RUN_FLOOR_WIDTH,
} from './new-run.js';

export { depthFloorId };

function nextFloorId(depth: number): string {
  return depthFloorId(depth);
}

/**
 * Fires every un-fired balance restock milestone the run's dungeon high-water mark has now
 * reached, restocking every permanent (town) merchant once per milestone and recording it in
 * `restockedMilestones` so a later descend (to the same or a shallower/deeper floor) never
 * re-fires it. Milestones are processed in ascending order; each restocks merchants in a fixed
 * populationId order, so a given (seed, milestone) always restocks byte-identically.
 */
function applyMerchantRestocks(
  input: Readonly<{
    state: ActiveRun;
    content: CompiledContentPack;
  }>,
): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  const balance = balanceEntry(input.content);
  const dueMilestones = balance.restockMilestones
    .filter(
      (milestone) =>
        !input.state.restockedMilestones.includes(milestone) &&
        input.state.metrics.deepestDepth >= milestone,
    )
    .sort((left, right) => left - right);
  if (dueMilestones.length === 0) return { state: input.state, events: [] };
  let state = input.state;
  const events: DomainEvent[] = [];
  for (const milestone of dueMilestones) {
    const permanentMerchantIds = state.populations
      .filter((population) => population.model === 'merchant')
      .filter((population) => {
        const encounter = input.content.entries.find(
          (entry) => entry.id === population.encounterId,
        );
        return (
          encounter !== undefined &&
          encounter.kind === 'encounter' &&
          encounter.model === 'merchant' &&
          encounter.definition.permanent
        );
      })
      .map((population) => population.populationId)
      .sort(compareCodeUnits);
    for (const populationId of permanentMerchantIds) {
      const restocked = restockMerchant(state, { content: input.content, populationId });
      state = restocked.state;
      events.push(...restocked.events);
    }
    state = {
      ...state,
      restockedMilestones: [...state.restockedMilestones, milestone].sort(
        (left, right) => left - right,
      ),
    };
  }
  return { state, events };
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

  const nextDepth = activeFloor.depth + 1;
  const floorId = nextFloorId(nextDepth);

  // The floor below may already exist in this run (the hero previously descended into it and has
  // since ascended back up): re-entering it must never regenerate, reroll, or otherwise touch the
  // stored snapshot -- the RNG streams must stay byte-identical to a never-left run. `floorsEntered`
  // is not re-recorded either: it counts first-ever entries, and this is a return visit.
  const stored = run.floors.find((floor) => floor.floorId === floorId);
  if (stored !== undefined) {
    const arrival = stored.stairUp;
    if (arrival === null) {
      throw new Error(`internal invariant: stored floor ${floorId} has no stair-up`);
    }
    const entered = enterStoredFloor(run, { floorId, arrival });
    const restocked = applyMerchantRestocks({ state: entered, content: context.content });
    return { state: restocked.state, events: restocked.events };
  }

  // The Final Chamber is authored, not generated (mirroring the town's own bootstrap in
  // new-run.ts): it consumes no randomness, so no floor-seed allocation happens and `rng.generation`
  // stays untouched by this descent. It is assembled and appended directly here rather than through
  // `integrateGeneratedFloor`, whose seed-match assertion is scoped to procedurally allocated floors.
  if (nextDepth === FINAL_CHAMBER_DEPTH) {
    const chamberFloor = generateFinalChamberFloor(context.content);
    const chamberStairUp = chamberFloor.stairUp;
    if (chamberStairUp === null) {
      throw new Error('internal invariant: final chamber floor must have a stair-up');
    }
    const moved: ActiveRun = {
      ...run,
      actors: run.actors.map((actor) =>
        actor.actorId === hero.actorId
          ? { ...actor, floorId, x: chamberStairUp.x, y: chamberStairUp.y }
          : actor,
      ),
      activeFloorId: floorId,
      activeFloorEnteredAt: run.worldTime,
      recentCommands: [],
    };
    const movedHero = heroActor(moved);
    const actorsById = new Map<string, Readonly<{ x: number; y: number }>>(
      chamberFloor.entities.map((entity) => [entity.entityId, entity] as const),
    );
    actorsById.set(movedHero.actorId, movedHero);
    const litChamberFloor = {
      ...chamberFloor,
      knowledge: refreshKnowledge({
        floor: chamberFloor,
        hero: heroPerception(moved.hero, movedHero),
        actors: actorsById,
      }).knowledge,
    };
    const withChamber = validateActiveRun(
      recordFloorEntered({ ...moved, floors: [...moved.floors, litChamberFloor] }, nextDepth),
    );
    const restocked = applyMerchantRestocks({ state: withChamber, content: context.content });
    return { state: restocked.state, events: restocked.events };
  }

  const allocation = allocateFloorSeed(run.rng.generation);
  const vaults = context.content.entries.filter(
    (entry): entry is VaultContentEntry => entry.kind === 'vault',
  );
  const generated = generateFloor({
    floorId,
    floorSeed: allocation.floorSeed,
    depth: nextDepth,
    width: NEW_RUN_FLOOR_WIDTH,
    height: NEW_RUN_FLOOR_HEIGHT,
    theme: createClassicTheme(
      NEW_RUN_FLOOR_WIDTH,
      NEW_RUN_FLOOR_HEIGHT,
      NEW_RUN_FLOOR_THEME_SETTINGS,
    ),
    vaults,
  });
  const stairUp = generated.floor.stairUp;
  if (stairUp === null) throw new Error('internal invariant: generated floor must have a stair-up');

  const moved: ActiveRun = {
    ...run,
    actors: run.actors.map((actor) =>
      actor.actorId === hero.actorId ? { ...actor, floorId, x: stairUp.x, y: stairUp.y } : actor,
    ),
    activeFloorId: floorId,
    activeFloorEnteredAt: run.worldTime,
    // Retained command events (e.g. moves) reference coordinates on the floor being left; the
    // save schema validates them against the active floor, so they cannot survive a descent.
    // Replay-after-descend safety is unaffected: revision never resets, so stale-revision
    // rejection still guards against replaying commands issued before this transition.
    recentCommands: [],
  };

  const integrated = integrateGeneratedFloor(moved, generated, allocation, {
    content: context.content,
  });
  const restocked = applyMerchantRestocks({ state: integrated.state, content: context.content });
  return { state: restocked.state, events: [...integrated.events, ...restocked.events] };
}

/**
 * Moves the hero onto an already-stored floor without touching that floor's snapshot in any way:
 * no generation, no reroll, no knowledge refresh. Used for both re-descending into a previously
 * visited floor and ascending back up -- either way the target floor already exists in `run.floors`
 * and this is purely a bookkeeping move (active floor pointer, hero position, entry timestamp,
 * clearing stale command history). Byte-identical RNG streams across a stored re-entry depend on
 * this function never allocating or consuming randomness.
 */
export function enterStoredFloor(
  run: ActiveRun,
  input: Readonly<{
    floorId: OpaqueId;
    arrival: Point;
  }>,
): ActiveRun {
  const floor = run.floors.find((candidate) => candidate.floorId === input.floorId);
  if (floor === undefined) {
    throw new Error(
      `enterStoredFloor requires floor ${input.floorId} to already exist in run.floors`,
    );
  }
  const { x, y } = input.arrival;
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    x >= floor.width ||
    y < 0 ||
    y >= floor.height
  ) {
    throw new RangeError(`enterStoredFloor arrival (${x}, ${y}) is outside floor ${input.floorId}`);
  }
  const tileId = floor.tiles[y * floor.width + x];
  if (tileId === undefined || !tileDefinition(tileId).walkable) {
    throw new Error(
      `enterStoredFloor arrival (${x}, ${y}) on floor ${input.floorId} is not walkable`,
    );
  }

  const hero = heroActor(run);
  const moved: ActiveRun = {
    ...run,
    actors: run.actors.map((actor) =>
      actor.actorId === hero.actorId ? { ...actor, floorId: input.floorId, x, y } : actor,
    ),
    activeFloorId: input.floorId,
    activeFloorEnteredAt: run.worldTime,
    // Same rationale as descendToNextFloor: retained command events reference the floor being
    // left, so they cannot survive any floor change, stored or generated.
    recentCommands: [],
  };

  return validateActiveRun(moved);
}

/**
 * Ascends the hero from the active floor's stair-up tile to the floor one depth shallower (town
 * for depth 1), arriving on that floor's stair-down tile. The target floor is always already
 * stored: a floor can only be reached by descending from it in the first place. Never generates,
 * never records `floorsEntered` (only first-ever entries count, and this revisits a floor already
 * counted), and emits no events -- nothing happens to the world by moving between floors that
 * already exist.
 */
export function ascendToPreviousFloor(
  run: ActiveRun,
  context: Readonly<{ content: CompiledContentPack }>,
): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  void context;
  if (run.conclusion !== null) {
    throw new Error('ascendToPreviousFloor cannot transition a concluded run');
  }

  const activeFloor = run.floors.find((floor) => floor.floorId === run.activeFloorId);
  if (activeFloor === undefined) {
    throw new Error(`internal invariant: active floor ${run.activeFloorId} is missing from floors`);
  }
  const hero = heroActor(run);
  const stairUp = activeFloor.stairUp;
  if (stairUp === null || hero.x !== stairUp.x || hero.y !== stairUp.y) {
    throw new Error('ascendToPreviousFloor requires the hero to be standing on stair-up');
  }

  const targetFloorId = depthFloorId(activeFloor.depth - 1);
  const targetFloor = run.floors.find((floor) => floor.floorId === targetFloorId);
  if (targetFloor === undefined) {
    throw new Error(`internal invariant: floor ${targetFloorId} is missing from floors`);
  }
  const arrival = targetFloor.stairDown;
  if (arrival === null) {
    throw new Error(`internal invariant: floor ${targetFloorId} has no stair-down`);
  }

  const state = enterStoredFloor(run, { floorId: targetFloorId, arrival });
  return { state, events: [] };
}
