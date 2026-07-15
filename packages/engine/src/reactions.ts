import type { CompiledContentPack } from '@woven-deep/content';
import { actorById, type ActorState, type Disposition } from './actor-model.js';
import { actorHasConditionTrait } from './conditions.js';
import type { ActiveRun, DomainEvent, OpaqueId, Point, Uint32State } from './model.js';

function normalizedPair(leftActorId: OpaqueId, rightActorId: OpaqueId) {
  if (leftActorId === rightActorId) throw new RangeError('relationship actors must be distinct');
  return leftActorId < rightActorId
    ? { leftActorId, rightActorId }
    : { leftActorId: rightActorId, rightActorId: leftActorId };
}

function requiredActor(run: Pick<ActiveRun, 'actors'>, actorId: OpaqueId): ActorState {
  const actor = actorById(run, actorId);
  if (!actor) throw new Error(`internal invariant: actor ${actorId} does not exist`);
  return actor;
}

export function relationshipBetween(
  run: Pick<ActiveRun, 'actors' | 'relationships'>,
  leftActorId: OpaqueId,
  rightActorId: OpaqueId,
): Disposition {
  if (leftActorId === rightActorId) return 'friendly';
  const pair = normalizedPair(leftActorId, rightActorId);
  const override = run.relationships.find((candidate) => (
    candidate.leftActorId === pair.leftActorId && candidate.rightActorId === pair.rightActorId
  ));
  if (override) return override.relationship;
  const left = requiredActor(run, leftActorId);
  const right = requiredActor(run, rightActorId);
  if (left.populationId !== null && left.populationId === right.populationId) return 'friendly';
  // Explicit-neutral parties (merchants, surrendered actors) stay out of fights by default:
  // hostility toward them exists only through an explicit override, never by disposition.
  if (left.disposition === 'neutral' || right.disposition === 'neutral') return 'neutral';
  if (left.disposition === 'hostile' || right.disposition === 'hostile') return 'hostile';
  return 'friendly';
}

export function setRelationship(
  run: ActiveRun,
  leftActorId: OpaqueId,
  rightActorId: OpaqueId,
  relationship: Disposition,
): ActiveRun {
  requiredActor(run, leftActorId);
  requiredActor(run, rightActorId);
  const pair = normalizedPair(leftActorId, rightActorId);
  const relationships = [
    ...run.relationships.filter((candidate) => (
      candidate.leftActorId !== pair.leftActorId || candidate.rightActorId !== pair.rightActorId
    )),
    { ...pair, relationship },
  ].sort((left, right) => left.leftActorId < right.leftActorId ? -1
    : left.leftActorId > right.leftActorId ? 1
      : left.rightActorId < right.rightActorId ? -1
        : left.rightActorId > right.rightActorId ? 1 : 0);
  return { ...run, relationships };
}

function distance(left: Point, right: Point): number {
  return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));
}

export function eligibleOpportunityAttackers(input: Readonly<{
  run: ActiveRun;
  content: CompiledContentPack;
  moverActorId: OpaqueId;
  from: Point;
  to: Point;
}>): readonly ActorState[] {
  const mover = requiredActor(input.run, input.moverActorId);
  if (actorHasConditionTrait(mover, 'condition-trait.avoids-opportunity-attacks', input.content)) return [];
  return input.run.actors.filter((candidate) => (
    candidate.actorId !== mover.actorId
    && candidate.floorId === mover.floorId
    && candidate.health > 0
    && candidate.reactionReady
    && candidate.awareActorIds.includes(mover.actorId)
    && relationshipBetween(input.run, candidate.actorId, mover.actorId) === 'hostile'
    && !actorHasConditionTrait(candidate, 'condition-trait.incapacitated', input.content)
    && !actorHasConditionTrait(candidate, 'condition-trait.suppresses-reactions', input.content)
    && distance(candidate, input.from) === 1
    && distance(candidate, input.to) > 1
  )).sort((left, right) => left.actorId < right.actorId ? -1 : left.actorId > right.actorId ? 1 : 0);
}

export interface ReactionAttackInput {
  readonly actors: readonly ActorState[];
  readonly combatState: Uint32State;
  readonly attackerId: OpaqueId;
  readonly targetActorId: OpaqueId;
  readonly eventId: OpaqueId;
}

export interface ReactionAttackResult {
  readonly actors: readonly ActorState[];
  readonly combatState: Uint32State;
  readonly events: readonly DomainEvent[];
}

export type ReactionAttackResolver = (input: ReactionAttackInput) => ReactionAttackResult;

export function completeNormalActorTurn(actor: ActorState): ActorState {
  return actor.reactionReady ? actor : { ...actor, reactionReady: true };
}

export function resolveOpportunityAttacks(input: Readonly<{
  run: ActiveRun;
  content: CompiledContentPack;
  moverActorId: OpaqueId;
  from: Point;
  to: Point;
  eventId: OpaqueId;
  resolveAttack: ReactionAttackResolver;
}>): Readonly<{ state: ActiveRun; events: readonly DomainEvent[]; movementAllowed: boolean }> {
  const attackerIds = eligibleOpportunityAttackers(input).map((actor) => actor.actorId);
  let actors = [...input.run.actors];
  let combatState = input.run.rng.combat;
  const events: DomainEvent[] = [];
  for (const attackerId of attackerIds) {
    const mover = actors.find((actor) => actor.actorId === input.moverActorId);
    if (!mover || mover.health === 0) break;
    const attacker = actors.find((actor) => actor.actorId === attackerId);
    if (!attacker || attacker.health === 0) continue;
    actors = actors.map((actor) => actor.actorId === attackerId ? { ...actor, reactionReady: false } : actor);
    events.push({
      type: 'reaction.triggered', eventId: input.eventId,
      actorId: attackerId, targetActorId: input.moverActorId,
    });
    const resolved = input.resolveAttack({
      actors, combatState, attackerId, targetActorId: input.moverActorId, eventId: input.eventId,
    });
    actors = [...resolved.actors];
    combatState = resolved.combatState;
    events.push(...resolved.events);
  }
  const state = { ...input.run, actors, rng: { ...input.run.rng, combat: combatState } };
  const mover = requiredActor(state, input.moverActorId);
  const movementAllowed = mover.health > 0
    && !actorHasConditionTrait(mover, 'condition-trait.incapacitated', input.content)
    && !actorHasConditionTrait(mover, 'condition-trait.prevents-movement', input.content);
  return { state, events, movementAllowed };
}
