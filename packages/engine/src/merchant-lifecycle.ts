import type { CompiledContentPack, MerchantEncounterContentEntry } from '@woven-deep/content';
import type { ActorState } from './actor-model.js';
import type { MerchantPopulation } from './merchant-model.js';
import type { ActiveRun, DomainEvent, OpaqueId, PublicEvent } from './model.js';
import { compareCodeUnits } from './stable-json.js';
import { activeTradeValidIgnoringDeparture, closeTradeIfInvalid } from './trade.js';

function merchantEncounter(content: CompiledContentPack, encounterId: OpaqueId): MerchantEncounterContentEntry {
  const entry = content.entries.find((candidate) => candidate.id === encounterId);
  if (!entry || entry.kind !== 'encounter' || entry.model !== 'merchant') {
    throw new Error(`internal invariant: merchant encounter ${encounterId} does not exist`);
  }
  return entry;
}

/** Drops awareness, memories, goals, and condition sources that reference the departed actor. */
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
  // A condition outlives its source; only the stale source reference is cleared.
  const conditions = actor.conditions.some((condition) => condition.sourceActorId === departedActorId)
    ? actor.conditions.map((condition) => condition.sourceActorId === departedActorId
      ? { ...condition, sourceActorId: null } : condition)
    : actor.conditions;
  if (awareActorIds === actor.awareActorIds && lastKnownTargets === actor.behaviorState.lastKnownTargets
    && goal === actor.behaviorState.goal && conditions === actor.conditions) {
    return actor;
  }
  return { ...actor, awareActorIds, conditions, behaviorState: { ...actor.behaviorState, goal, lastKnownTargets } };
}

/**
 * Drops recorded intent events that reference the departed actor. The command records themselves
 * survive untouched for dedup and replay; only the stale `actor.intent-changed` entries (which the
 * save schema requires to reference an existing actor) are filtered from their event streams.
 */
function scrubRecordedCommands(
  recentCommands: ActiveRun['recentCommands'], departedActorId: OpaqueId,
): ActiveRun['recentCommands'] {
  const stale = (event: DomainEvent | PublicEvent): boolean =>
    event.type === 'actor.intent-changed' && event.actorId === departedActorId;
  if (!recentCommands.some((record) => record.events.some(stale) || record.publicEvents.some(stale))) {
    return recentCommands;
  }
  return recentCommands.map((record) => {
    const events = record.events.some(stale) ? record.events.filter((event) => !stale(event)) : record.events;
    const publicEvents = record.publicEvents.some(stale)
      ? record.publicEvents.filter((event) => !stale(event)) : record.publicEvents;
    return events === record.events && publicEvents === record.publicEvents
      ? record : { ...record, events, publicEvents };
  });
}

/**
 * Drops in-flight `actor.intent-changed` events referencing merchants that departed within the
 * same command. Recorded saved commands are scrubbed by `advanceMerchantLifecycle` itself; this
 * covers the event arrays still being accumulated when the departure resolves, so the command
 * about to be recorded never carries a dangling actor reference.
 */
export function scrubDepartedIntentEvents(input: Readonly<{
  events: DomainEvent[];
  publicEvents: PublicEvent[];
  departureEvents: readonly DomainEvent[];
}>): void {
  const departedActorIds = new Set(input.departureEvents
    .flatMap((event) => event.type === 'merchant.departed' ? [event.actorId] : []));
  if (departedActorIds.size === 0) return;
  const stale = (event: DomainEvent | PublicEvent): boolean =>
    event.type === 'actor.intent-changed' && departedActorIds.has(event.actorId);
  if (input.events.some(stale)) {
    input.events.splice(0, input.events.length, ...input.events.filter((event) => !stale(event)));
  }
  if (input.publicEvents.some(stale)) {
    input.publicEvents.splice(0, input.publicEvents.length,
      ...input.publicEvents.filter((event) => !stale(event)));
  }
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
 *
 * `previousWorldTime` is accepted for the interval signature; crossing detection is threshold-set
 * based (each threshold compares against the persisted `emittedWarningThresholds`), so the lower
 * bound never influences which warnings fire.
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
    // `null` marks a permanent merchant, which never departs and never warns.
    if (population.departureAt === null) continue;
    const remaining = population.departureAt - input.nextWorldTime;
    if (remaining > 0) {
      const encounter = merchantEncounter(input.content, population.encounterId);
      if (encounter.definition.permanent) {
        throw new Error(`internal invariant: merchant population ${populationId} is bound to a permanent encounter definition, which never departs and should not reach the lifecycle boundary`);
      }
      // Content validation (packages/content schema.ts) guarantees a non-permanent merchant
      // declares departureWarningThresholds, so asserting it here is safe given the guard above.
      const crossed = encounter.definition.departureWarningThresholds!
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
      recentCommands: scrubRecordedCommands(state.recentCommands, departing.actorId),
    };
    events.push({
      type: 'merchant.departed', eventId: input.eventId,
      populationId, actorId: departing.actorId, stockItemIds: departing.stockItemIds,
    });
  }
  return { state, events };
}
