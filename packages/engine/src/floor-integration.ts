import type { FloorSeedAllocation } from './generation-model.js';
import type { GeneratedFloor } from './generate-floor.js';
import { allocateFloorSeed } from './generation-random.js';
import type { ActiveRun, Uint32State } from './model.js';
import { refreshKnowledge } from './perception.js';
import { isNonZeroState } from './random.js';
import { validateActiveRun } from './save-schema.js';
import { heroActor, heroPerception } from './actor-model.js';

function assertState(value: Uint32State, label: string): void {
  if (!Array.isArray(value) || value.length !== 4
    || value.some((word, index) => !(index in value)
      || !Number.isInteger(word) || word < 0 || word > 0xffff_ffff)) {
    throw new TypeError(`${label} must contain four unsigned 32-bit words`);
  }
}

function sameState(left: Uint32State, right: Uint32State): boolean {
  return left[0] === right[0] && left[1] === right[1]
    && left[2] === right[2] && left[3] === right[3];
}

export function addGeneratedFloor(
  run: ActiveRun,
  generated: GeneratedFloor,
  allocation: FloorSeedAllocation,
): ActiveRun {
  assertState(allocation.floorSeed, 'allocated floor seed');
  assertState(allocation.nextGenerationState, 'next generation state');
  if (!isNonZeroState(allocation.nextGenerationState)) {
    throw new RangeError('next generation state must not be all zero');
  }
  const expectedAllocation = allocateFloorSeed(run.rng.generation);
  if (!sameState(allocation.floorSeed, expectedAllocation.floorSeed)
    || !sameState(allocation.nextGenerationState, expectedAllocation.nextGenerationState)) {
    throw new RangeError('floor seed allocation must match the current generation stream');
  }
  if (!sameState(generated.floor.seed, allocation.floorSeed)) {
    throw new RangeError('generated floor seed must equal the allocated floor seed');
  }

  const previousFloor = run.floors.at(-1);
  if (previousFloor === undefined || generated.floor.floorId <= previousFloor.floorId) {
    throw new RangeError('generated floor identifier must be a unique strict append in increasing order');
  }

  const transitioningToInsertedFloor = run.activeFloorId === generated.floor.floorId
    && heroActor(run).floorId === generated.floor.floorId
    && !run.floors.some((floor) => floor.floorId === generated.floor.floorId);
  if (!transitioningToInsertedFloor) validateActiveRun(run);

  let floor = generated.floor;
  if (transitioningToInsertedFloor) {
    const actors = new Map<string, Readonly<{ x: number; y: number }>>(
      floor.entities.map((entity) => [entity.entityId, entity] as const),
    );
    const actor = heroActor(run);
    actors.set(actor.actorId, actor);
    floor = {
      ...floor,
      knowledge: refreshKnowledge({ floor, hero: heroPerception(run.hero, actor), actors }).knowledge,
    };
  }

  return validateActiveRun({
    ...run,
    rng: { ...run.rng, generation: [...allocation.nextGenerationState] },
    floors: [...run.floors, floor],
  });
}
