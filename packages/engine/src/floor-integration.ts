import type { FloorSeedAllocation } from './generation-model.js';
import type { GeneratedFloor } from './generate-floor.js';
import type { CompiledContentPack } from '@woven-deep/content';
import { allocateFloorSeed } from './generation-random.js';
import { advanceMerchantLifecycle } from './merchant-lifecycle.js';
import type { ActiveRun, DomainEvent, Uint32State } from './model.js';
import { refreshKnowledge } from './perception.js';
import { placeFloorPopulations } from './population-placement.js';
import { isNonZeroState } from './random.js';
import { validateActiveRun } from './save-schema.js';
import { heroActor, heroPerception } from './actor-model.js';
import { placeFallenHeroEncounters } from './champion.js';
import { recordFloorEntered } from './run-metrics.js';

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

export interface FloorIntegrationResult {
  readonly state: ActiveRun;
  readonly events: readonly DomainEvent[];
}

/**
 * Appends a generated floor to the run, planning (or committing pre-planned) population placement.
 * Merchant lifecycle processing only runs when the content-bearing `population` argument is
 * supplied; callers integrating a bare floor resolve merchant deadlines at their own boundary.
 */
export function integrateGeneratedFloor(
  run: ActiveRun,
  generated: GeneratedFloor,
  allocation: FloorSeedAllocation,
  population?: Readonly<{
    content: CompiledContentPack;
    environmentTags?: readonly string[];
    /** Test/demo-only override. Production callers leave encounter selection weighted. */
    forcedEncounterId?: string;
  }>,
): FloorIntegrationResult {
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

  const transitioningToInsertedFloor = run.activeFloorId === generated.floor.floorId
    && heroActor(run).floorId === generated.floor.floorId
    && !run.floors.some((floor) => floor.floorId === generated.floor.floorId);

  // A brand-new run bootstraps its first-ever floor with no prior floors to append after; every
  // other caller transitions between floors that already exist in an established run. This admits
  // exactly the shape `createNewRun` hands off: `floors: []` with the hero already placed on the
  // generated floor and `activeFloorId` already pointing at it (`transitioningToInsertedFloor`).
  const previousFloor = run.floors.at(-1);
  const isBootstrappingFirstFloor = run.floors.length === 0 && transitioningToInsertedFloor;
  if (!isBootstrappingFirstFloor
    && (previousFloor === undefined || generated.floor.floorId <= previousFloor.floorId)) {
    throw new RangeError('generated floor identifier must be a unique strict append in increasing order');
  }

  if (!transitioningToInsertedFloor) validateActiveRun(run);

  // A floor transition can observe a save whose merchants are already due (or crossed warning
  // thresholds); resolve the global merchant lifecycle before the new floor is populated.
  const eventId = `event.${generated.floor.floorId}.population`;
  const lifecycle = population === undefined ? null : advanceMerchantLifecycle({
    state: run, content: population.content, previousWorldTime: run.worldTime,
    nextWorldTime: run.worldTime, eventId,
  });
  run = lifecycle?.state ?? run;

  if (generated.populationPlacement !== undefined && population !== undefined) {
    throw new TypeError('generated floor population must not be planned twice');
  }
  // Two distinct population mechanisms feed a floor: `generated.populationPlacement` is a single
  // guaranteed encounter (e.g. a boss) already committed during `generateFloor`'s own retry loop,
  // tied to that loop's regeneration-on-rejection contract; `population` (this function's own
  // argument) fills the rest of the floor up to its density budget via `placeFloorPopulations`.
  // The two never both apply to the same call (enforced above), so exactly one of the branches
  // below runs, each producing an equivalent { run, events } outcome.
  let outcome: Readonly<{ run: ActiveRun; events: readonly DomainEvent[] }> | null = null;
  if (generated.populationPlacement !== undefined) {
    const placement = generated.populationPlacement;
    const updatedRun: ActiveRun = placement.status === 'placed'
      ? {
        ...run,
        actors: [...run.actors, ...placement.createdActors]
          .sort((left, right) => left.actorId < right.actorId ? -1 : left.actorId > right.actorId ? 1 : 0),
        items: placement.createdItems.length === 0 ? run.items : [...run.items, ...placement.createdItems]
          .sort((left, right) => left.itemId < right.itemId ? -1 : left.itemId > right.itemId ? 1 : 0),
        populations: [...run.populations, placement.population]
          .sort((left, right) => left.populationId < right.populationId ? -1 : left.populationId > right.populationId ? 1 : 0),
        rng: {
          ...run.rng, encounters: placement.nextEncounterState,
          ...(placement.nextMerchantStockState === null ? {} : { 'merchant-stock': placement.nextMerchantStockState }),
        },
        encounterDecisions: placement.encounterDecisions,
      }
      : { ...run, rng: { ...run.rng, encounters: placement.nextEncounterState }, encounterDecisions: placement.encounterDecisions };
    const placementEvents: DomainEvent[] = [];
    if (placement.status === 'placed') {
      placementEvents.push({ type: 'population.created', eventId, populationId: placement.population.populationId,
        encounterId: placement.population.encounterId, floorId: placement.population.floorId,
        model: placement.population.model, actorIds: placement.population.livingMemberIds });
      if (placement.population.model === 'group' && placement.population.leaderActorId !== null) {
        const leaderActorId = placement.population.leaderActorId;
        const roleId = placement.population.roleMembership.find((role) => role.actorId === leaderActorId)?.roleId;
        if (roleId === undefined) throw new Error(`internal invariant: group leader ${leaderActorId} has no role`);
        placementEvents.push({ type: 'group.leader-created', eventId, populationId: placement.population.populationId,
          actorId: leaderActorId, roleId });
      }
    } else {
      for (const diagnostic of placement.diagnostics) placementEvents.push({ ...diagnostic, eventId, floorId: generated.floor.floorId });
    }
    outcome = { run: updatedRun, events: placementEvents };
  } else if (population !== undefined) {
    const result = placeFloorPopulations({
      run, floor: generated.floor, content: population.content,
      ...(population.environmentTags === undefined ? {} : { environmentTags: population.environmentTags }),
      ...(population.forcedEncounterId === undefined ? {} : { forcedEncounterId: population.forcedEncounterId }),
    });
    const rejected = result.placements.find((candidate) => candidate.status === 'rejected');
    if (rejected) throw new RangeError(`required population placement rejected generated floor: ${rejected.reason}`);
    outcome = { run: result.state, events: result.events };
  }

  const populatedRun = outcome?.run ?? run;
  let floor = generated.floor;
  const fallen = population === undefined ? null : placeFallenHeroEncounters({
    run: populatedRun, floor, content: population.content,
  });
  if (fallen !== null) floor = fallen.floor;
  const actorsAfterPlacement = fallen === null ? populatedRun.actors
    : [...populatedRun.actors, ...fallen.actors]
      .sort((left, right) => left.actorId < right.actorId ? -1 : left.actorId > right.actorId ? 1 : 0);
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

  const beforeValidation: ActiveRun = {
    ...populatedRun,
    rng: { ...populatedRun.rng, generation: [...allocation.nextGenerationState] },
    actors: actorsAfterPlacement,
    encounterDecisions: populatedRun.encounterDecisions,
    populations: fallen?.populations ?? populatedRun.populations,
    fallenHeroDecisions: fallen?.decisions ?? populatedRun.fallenHeroDecisions,
    floors: [...populatedRun.floors, floor],
  };
  const state = validateActiveRun(transitioningToInsertedFloor
    ? recordFloorEntered(beforeValidation, generated.floor.depth)
    : beforeValidation);
  const events: DomainEvent[] = [...(lifecycle?.events ?? []), ...(outcome?.events ?? [])];
  return { state, events };
}

export function addGeneratedFloor(
  run: ActiveRun,
  generated: GeneratedFloor,
  allocation: FloorSeedAllocation,
  population?: Readonly<{
    content: CompiledContentPack;
    environmentTags?: readonly string[];
    /** Test/demo-only override. Production callers leave encounter selection weighted. */
    forcedEncounterId?: string;
  }>,
): ActiveRun {
  return integrateGeneratedFloor(run, generated, allocation, population).state;
}
