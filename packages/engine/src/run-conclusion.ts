import type { CompiledContentPack, CompletionType } from '@woven-deep/content';
import { heroActor } from './actor-model.js';
import type { ActiveRun, ActorDiedEvent, DomainEvent, OpaqueId, RunConcludedEvent } from './model.js';

export interface RunConclusionCause {
  readonly killerContentId: OpaqueId | null;   // null for non-death completions
  readonly depth: number;
  readonly turn: number;
  readonly worldTime: number;
}

export interface RunConclusion {
  readonly completionType: CompletionType;
  readonly cause: Readonly<RunConclusionCause>;
  readonly concludedAtRevision: number;
  readonly finalized: boolean;
}

function isHeroDeathEvent(event: DomainEvent, heroId: OpaqueId): event is ActorDiedEvent {
  return event.type === 'actor.died' && event.actorId === heroId;
}

/**
 * Concludes the run with a `died` completion inside the same transition that kills the hero.
 * Living heroes and already-concluded runs pass through unchanged (no event appended). Otherwise
 * the killer is credited from the last `actor.died` event carrying the hero's `actorId`: former
 * killers remain in `state.actors`, so their `contentId` is looked up there, and the killer resolves
 * to `null` both for environmental deaths (no such event in this transition) and hero self-kills.
 */
export function concludeRunOnHeroDeath(input: Readonly<{
  state: ActiveRun;
  content: CompiledContentPack;
  events: readonly DomainEvent[];
  revision: number;
  turn: number;
  eventId: OpaqueId;
}>): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  const { state } = input;
  const hero = heroActor(state);
  if (hero.health > 0 || state.conclusion !== null) return { state, events: input.events };

  const killingEvent = [...input.events].reverse().find((event) => isHeroDeathEvent(event, hero.actorId));
  const killerActorId = killingEvent?.killerActorId ?? null;
  const killerContentId = killerActorId !== null && killerActorId !== hero.actorId
    ? state.actors.find((actor) => actor.actorId === killerActorId)?.contentId ?? null
    : null;

  const floor = state.floors.find((candidate) => candidate.floorId === hero.floorId);
  if (!floor) throw new Error(`internal invariant: active floor ${hero.floorId} is missing`);

  const conclusion: RunConclusion = {
    completionType: 'died',
    cause: { killerContentId, depth: floor.depth, turn: input.turn, worldTime: state.worldTime },
    concludedAtRevision: input.revision,
    finalized: false,
  };
  const concludedEvent: RunConcludedEvent = {
    type: 'run.concluded', eventId: input.eventId, completionType: conclusion.completionType, cause: conclusion.cause,
  };
  return { state: { ...state, conclusion }, events: [...input.events, concludedEvent] };
}
