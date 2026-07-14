import type { CompiledContentPack } from '@woven-deep/content';
import { actionCostFor, balanceEntry, type GameAction } from './actions.js';
import { actorById } from './actor-model.js';
import { featureTiles } from './features.js';
import { findPath, selectPathStep } from './pathfinding.js';
import { movementBlockReason } from './terrain.js';
import type { ActiveRun, OpaqueId, Point } from './model.js';
import { relationshipBetween } from './reactions.js';

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
  const awareTargets = input.state.actors.filter((candidate) => (
    candidate.actorId !== actor.actorId && candidate.health > 0 && candidate.floorId === actor.floorId
    && actor.awareActorIds.includes(candidate.actorId)
    && relationshipBetween(input.state, actor.actorId, candidate.actorId) === 'hostile'
  )).sort((left, right) => distance(actor, left) - distance(actor, right)
    || (left.actorId < right.actorId ? -1 : left.actorId > right.actorId ? 1 : 0));
  const savedGoal = actor.behaviorState.goal;
  const goalTarget = savedGoal?.type === 'actor'
    ? input.state.actors.find((candidate) => candidate.actorId === savedGoal.targetActorId
      && candidate.health > 0 && candidate.floorId === actor.floorId
      && relationshipBetween(input.state, actor.actorId, candidate.actorId) === 'hostile')
    : undefined;
  const target = goalTarget ?? awareTargets[0];
  if (target && distance(actor, target) === 1) {
    return {
      type: 'bump-attack', actorId: actor.actorId, targetActorId: target.actorId,
      cost: actionCostFor(rules, 'action.attack'),
    };
  }
  const destination = target
    ? { x: target.x, y: target.y }
    : savedGoal?.type === 'cell' && savedGoal.floorId === actor.floorId
      ? { x: savedGoal.x, y: savedGoal.y }
      : savedGoal?.type === 'formation'
      ? { x: savedGoal.x, y: savedGoal.y }
      : null;
  if (!destination || (destination.x === actor.x && destination.y === actor.y)) {
    return { type: 'wait', actorId: actor.actorId, cost: actionCostFor(rules, 'action.wait') };
  }
  const floor = input.state.floors.find((candidate) => candidate.floorId === actor.floorId);
  if (!floor) throw new Error(`internal invariant: actor floor ${actor.floorId} does not exist`);
  const tiles = featureTiles(input.state, floor.floorId);
  const occupied = new Set(input.state.actors.filter((candidate) => candidate.actorId !== actor.actorId
    && candidate.floorId === actor.floorId && candidate.health > 0)
    .map((candidate) => `${candidate.x}:${candidate.y}`));
  const path = findPath({
    width: floor.width, height: floor.height, topology: 8,
    origin: { x: actor.x, y: actor.y }, destination,
    isPassable: (x, y) => {
      const index = y * floor.width + x;
      const isDestination = x === destination.x && y === destination.y;
      return movementBlockReason(tiles[index]!) === undefined
        && ((isDestination && target !== undefined) || !occupied.has(`${x}:${y}`));
    },
  });
  const selected = selectPathStep(path);
  if (selected.status === 'move') {
    return { type: 'move', actorId: actor.actorId, to: selected.step, cost: actionCostFor(rules, 'action.move') };
  }
  return { type: 'wait', actorId: actor.actorId, cost: actionCostFor(rules, 'action.wait') };
}
