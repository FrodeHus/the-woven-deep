import type { CompiledContentPack } from '@woven-deep/content';
import { actionCostFor, balanceEntry, type GameAction } from './actions.js';
import { actorById } from './actor-model.js';
import { movementAction } from './movement.js';
import type { ActiveRun, Direction, OpaqueId, Point } from './model.js';
import { relationshipBetween } from './reactions.js';

const DIRECTIONS: readonly Direction[] = [
  'northwest', 'north', 'northeast', 'west', 'east', 'southwest', 'south', 'southeast',
];

function distance(left: Point, right: Point): number {
  return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));
}

export function chooseBehaviorAction(input: Readonly<{
  state: ActiveRun;
  actorId: OpaqueId;
  content: CompiledContentPack;
}>): GameAction {
  const actor = actorById(input.state, input.actorId);
  if (!actor) throw new Error(`internal invariant: actor ${input.actorId} does not exist`);
  const rules = balanceEntry(input.content);
  if (actor.behaviorId === null) {
    return { type: 'wait', actorId: actor.actorId, cost: actionCostFor(rules, 'action.wait') };
  }
  if (actor.behaviorId !== 'behavior.approach-and-attack') {
    throw new Error(`internal invariant: no behavior resolver for ${actor.behaviorId ?? 'null'}`);
  }
  const targets = input.state.actors.filter((candidate) => (
    candidate.actorId !== actor.actorId && candidate.health > 0 && candidate.floorId === actor.floorId
    && actor.awareActorIds.includes(candidate.actorId)
    && relationshipBetween(input.state, actor.actorId, candidate.actorId) === 'hostile'
  )).sort((left, right) => distance(actor, left) - distance(actor, right)
    || (left.actorId < right.actorId ? -1 : left.actorId > right.actorId ? 1 : 0));
  const target = targets[0];
  if (!target) return { type: 'wait', actorId: actor.actorId, cost: actionCostFor(rules, 'action.wait') };
  if (distance(actor, target) === 1) {
    return {
      type: 'bump-attack', actorId: actor.actorId, targetActorId: target.actorId,
      cost: actionCostFor(rules, 'action.attack'),
    };
  }
  const floor = input.state.floors.find((candidate) => candidate.floorId === actor.floorId);
  if (!floor) throw new Error(`internal invariant: actor floor ${actor.floorId} does not exist`);
  const currentDistance = distance(actor, target);
  for (const direction of DIRECTIONS) {
    const result = movementAction({
      actor, floor, actors: input.state.actors, features: input.state.features,
      relationships: input.state.relationships, direction, cost: actionCostFor(rules, 'action.move'),
    });
    if (result.status === 'move' && distance(result.to, target) < currentDistance) {
      return { type: 'move', actorId: actor.actorId, to: result.to, cost: result.cost };
    }
  }
  return { type: 'wait', actorId: actor.actorId, cost: actionCostFor(rules, 'action.wait') };
}
