import type { CompiledContentPack, MerchantEncounterContentEntry } from '@woven-deep/content';
import type { ActorState } from './actor-model.js';
import type { MerchantPopulation } from './merchant-model.js';
import type { ActiveRun, DomainEvent, OpaqueId } from './model.js';
import { compareCodeUnits } from './stable-json.js';
import { activeTradeValidIgnoringDeparture, closeTradeIfInvalid } from './trade.js';

function merchantEncounter(content: CompiledContentPack, encounterId: OpaqueId): MerchantEncounterContentEntry {
  const entry = content.entries.find((candidate) => candidate.id === encounterId);
  if (!entry || entry.kind !== 'encounter' || entry.model !== 'merchant') {
    throw new Error(`internal invariant: merchant encounter ${encounterId} does not exist`);
  }
  return entry;
}

/** Drops awareness, memories, and goals that reference the departed actor. */
function scrubActorReferences(actor: ActorState, departedActorId: OpaqueId): ActorState {
  const awareActorIds = actor.awareActorIds.includes(departedActorId)
    ? actor.awareActorIds.filter((candidate) => candidate !== departedActorId)
    : actor.awareActorIds;
  const lastKnownTargets = actor.behaviorState.lastKnownTargets.some((memory) =>
    memory.targetActorId === departedActorId || memory.observerActorId === departedActorId)
    ? actor.behaviorState.lastKnownTargets.filter((memory) =>
      memory.targetActorId !== departedActorId && memory.observerActorId !== departedActorId)
    : actor.behaviorState.lastKnownTargets;
  const goal = actor.behaviorState.goal?.type === 'actor'
    && actor.behaviorState.goal.targetActorId === departedActorId ? null : actor.behaviorState.goal;
  if (awareActorIds === actor.awareActorIds && lastKnownTargets === actor.behaviorState.lastKnownTargets
    && goal === actor.behaviorState.goal) {
    return actor;
  }
  return { ...actor, awareActorIds, behaviorState: { ...actor.behaviorState, goal, lastKnownTargets } };
}

function scrubPopulationReferences(
  population: ActiveRun['populations'][number], departedActorId: OpaqueId,
): ActiveRun['populations'][number] {
  if (population.model !== 'group') return population;
  if (!population.sharedKnowledge.some((memory) =>
    memory.targetActorId === departedActorId || memory.observerActorId === departedActorId)) {
    return population;
  }
  return {
    ...population,
    sharedKnowledge: population.sharedKnowledge.filter((memory) =>
      memory.targetActorId !== departedActorId && memory.observerActorId !== departedActorId),
  };
}

/**
 * Advances every merchant population's departure lifecycle across the whole run — including
 * inactive floors — after world time moved from `previousWorldTime` to `nextWorldTime`. Off-floor
 * merchants never take actor turns: this boundary only records crossed warning thresholds
 * (each authored remaining-time threshold is emitted exactly once, persisted in
 * `emittedWarningThresholds`) and resolves due departures. A due merchant engaged in a currently
 * valid modal trade defers its departure; an invalid trade is closed automatically first, then the
 * departure removes the actor and all held stock atomically and marks the population departed.
 */
export function advanceMerchantLifecycle(input: Readonly<{
  state: ActiveRun;
  content: CompiledContentPack;
  previousWorldTime: number;
  nextWorldTime: number;
  eventId: OpaqueId;
}>): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  if (!Number.isSafeInteger(input.previousWorldTime) || !Number.isSafeInteger(input.nextWorldTime)
    || input.previousWorldTime < 0 || input.nextWorldTime < input.previousWorldTime) {
    throw new RangeError('merchant lifecycle requires a non-decreasing safe world-time window');
  }
  let state = input.state;
  const events: DomainEvent[] = [];
  const merchantIds = state.populations
    .filter((candidate) => candidate.model === 'merchant')
    .map((candidate) => candidate.populationId)
    .sort(compareCodeUnits);
  for (const populationId of merchantIds) {
    const population = state.populations.find((candidate): candidate is MerchantPopulation =>
      candidate.model === 'merchant' && candidate.populationId === populationId)!;
    if (population.lifecycle === 'departed' || population.lifecycle === 'dead') continue;
    const remaining = population.departureAt - input.nextWorldTime;
    if (remaining > 0) {
      const encounter = merchantEncounter(input.content, population.encounterId);
      const crossed = encounter.definition.departureWarningThresholds
        .filter((threshold) => remaining <= threshold
          && !population.emittedWarningThresholds.includes(threshold))
        .sort((left, right) => right - left);
      if (crossed.length === 0) continue;
      const emittedWarningThresholds = [...new Set([...population.emittedWarningThresholds, ...crossed])]
        .sort((left, right) => right - left);
      for (const threshold of crossed) {
        events.push({
          type: 'merchant.departure-warning', eventId: input.eventId,
          populationId, actorId: population.actorId, threshold, remaining,
        });
      }
      state = {
        ...state,
        populations: state.populations.map((candidate) => candidate.populationId === populationId
          ? { ...population, emittedWarningThresholds } : candidate),
      };
      continue;
    }
    if (state.activeTrade?.merchantPopulationId === populationId) {
      // A currently valid modal trade defers the departure; the modal boundary closes it later.
      if (activeTradeValidIgnoringDeparture(state, input.content)) continue;
      const closed = closeTradeIfInvalid({ state, content: input.content, eventId: input.eventId });
      state = closed.state;
      events.push(...closed.events);
    }
    const departing = state.populations.find((candidate): candidate is MerchantPopulation =>
      candidate.model === 'merchant' && candidate.populationId === populationId)!;
    state = {
      ...state,
      actors: state.actors
        .filter((actor) => actor.actorId !== departing.actorId)
        .map((actor) => scrubActorReferences(actor, departing.actorId)),
      items: state.items.filter((item) => !(item.location.type === 'merchant-stock'
        && item.location.populationId === populationId)),
      relationships: state.relationships.filter((relationship) =>
        relationship.leftActorId !== departing.actorId && relationship.rightActorId !== departing.actorId),
      populations: state.populations.map((candidate) => candidate.populationId === populationId
        ? { ...departing, lifecycle: 'departed' as const, livingMemberIds: [], stockItemIds: [] }
        : scrubPopulationReferences(candidate, departing.actorId)),
    };
    events.push({
      type: 'merchant.departed', eventId: input.eventId,
      populationId, actorId: departing.actorId, stockItemIds: departing.stockItemIds,
    });
  }
  return { state, events };
}
