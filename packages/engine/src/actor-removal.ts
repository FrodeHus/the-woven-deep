import type { ActorState } from './actor-model.js';
import type { ActiveRun, DomainEvent, OpaqueId, PublicEvent } from './model.js';

/**
 * What the run has to forget when an actor leaves the world mid-run without dying: a merchant
 * walking its route out of the dungeon, a haunt fading after an offering. None of this was ever
 * merchant-specific -- it is the removal half of "a stored actor id must always resolve", which the
 * save schema enforces across awareness lists, behavior memories, goals, condition sources, group
 * knowledge, and retained command events alike. A leaf module so the two removal paths can share it
 * without either importing the other's lifecycle.
 */

/** Drops awareness, memories, goals, and condition sources that reference the removed actor. */
export function scrubActorReferences(actor: ActorState, removedActorId: OpaqueId): ActorState {
  const awareActorIds = actor.awareActorIds.includes(removedActorId)
    ? actor.awareActorIds.filter((candidate) => candidate !== removedActorId)
    : actor.awareActorIds;
  const lastKnownTargets = actor.behaviorState.lastKnownTargets.some(
    (memory) =>
      memory.targetActorId === removedActorId || memory.observerActorId === removedActorId,
  )
    ? actor.behaviorState.lastKnownTargets.filter(
        (memory) =>
          memory.targetActorId !== removedActorId && memory.observerActorId !== removedActorId,
      )
    : actor.behaviorState.lastKnownTargets;
  const goal =
    actor.behaviorState.goal?.type === 'actor' &&
    actor.behaviorState.goal.targetActorId === removedActorId
      ? null
      : actor.behaviorState.goal;
  // A condition outlives its source; only the stale source reference is cleared.
  const conditions = actor.conditions.some(
    (condition) => condition.sourceActorId === removedActorId,
  )
    ? actor.conditions.map((condition) =>
        condition.sourceActorId === removedActorId
          ? { ...condition, sourceActorId: null }
          : condition,
      )
    : actor.conditions;
  if (
    awareActorIds === actor.awareActorIds &&
    lastKnownTargets === actor.behaviorState.lastKnownTargets &&
    goal === actor.behaviorState.goal &&
    conditions === actor.conditions
  ) {
    return actor;
  }
  return {
    ...actor,
    awareActorIds,
    conditions,
    behaviorState: { ...actor.behaviorState, goal, lastKnownTargets },
  };
}

/**
 * Drops recorded intent events that reference the removed actor. The command records themselves
 * survive untouched for dedup and replay; only the stale `actor.intent-changed` entries (which the
 * save schema requires to reference an existing actor) are filtered from their event streams.
 */
export function scrubRecordedCommands(
  recentCommands: ActiveRun['recentCommands'],
  removedActorId: OpaqueId,
): ActiveRun['recentCommands'] {
  const stale = (event: DomainEvent | PublicEvent): boolean =>
    event.type === 'actor.intent-changed' && event.actorId === removedActorId;
  if (
    !recentCommands.some((record) => record.events.some(stale) || record.publicEvents.some(stale))
  ) {
    return recentCommands;
  }
  return recentCommands.map((record) => {
    const events = record.events.some(stale)
      ? record.events.filter((event) => !stale(event))
      : record.events;
    const publicEvents = record.publicEvents.some(stale)
      ? record.publicEvents.filter((event) => !stale(event))
      : record.publicEvents;
    return events === record.events && publicEvents === record.publicEvents
      ? record
      : { ...record, events, publicEvents };
  });
}

/** Drops group knowledge entries that reference the removed actor. */
export function scrubPopulationReferences(
  population: ActiveRun['populations'][number],
  removedActorId: OpaqueId,
): ActiveRun['populations'][number] {
  if (population.model !== 'group') return population;
  if (
    !population.sharedKnowledge.some(
      (memory) =>
        memory.targetActorId === removedActorId || memory.observerActorId === removedActorId,
    )
  ) {
    return population;
  }
  return {
    ...population,
    sharedKnowledge: population.sharedKnowledge.filter(
      (memory) =>
        memory.targetActorId !== removedActorId && memory.observerActorId !== removedActorId,
    ),
  };
}
