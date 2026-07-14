import type { CompiledContentPack } from '@woven-deep/content';
import { actionCostFor, balanceEntry, type GameAction } from './actions.js';
import { actorById, type ActorState } from './actor-model.js';
import { featureTiles } from './features.js';
import { findPath, selectPathStep } from './pathfinding.js';
import { movementBlockReason } from './terrain.js';
import type { ActiveRun, OpaqueId, Point } from './model.js';
import type { ActorGoal } from './population-model.js';
import { relationshipBetween } from './reactions.js';

function distance(left: Point, right: Point): number {
  return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));
}

export function selectPatrolGoal(input: Readonly<{
  state: ActiveRun;
  actor: ActorState;
  content: CompiledContentPack;
}>): ActorGoal | null {
  const definition = input.content.entries.find((entry) => entry.kind === 'monster'
    && entry.id === input.actor.contentId);
  if (!definition || definition.kind !== 'monster') {
    throw new Error(`internal invariant: monster definition ${input.actor.contentId} does not exist`);
  }
  const waypoints = definition.behaviorParameters.waypoints;
  if (!Array.isArray(waypoints) || waypoints.length === 0 || waypoints.some((waypoint) => (
    typeof waypoint !== 'object' || waypoint === null
    || !Number.isSafeInteger((waypoint as Point).x) || !Number.isSafeInteger((waypoint as Point).y)
  ))) throw new Error(`internal invariant: invalid patrol waypoints for ${definition.id}`);
  const points = waypoints as readonly Point[];
  const current = points.findIndex((point) => point.x === input.actor.x && point.y === input.actor.y);
  const selected = points[current < 0 ? 0 : (current + 1) % points.length]!;
  const floor = input.state.floors.find((candidate) => candidate.floorId === input.actor.floorId);
  if (!floor) throw new Error(`internal invariant: actor floor ${input.actor.floorId} does not exist`);
  if (selected.x < 0 || selected.y < 0 || selected.x >= floor.width || selected.y >= floor.height) return null;
  return { type: 'cell', floorId: floor.floorId, x: selected.x, y: selected.y };
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
  if (actor.behaviorId !== 'behavior.approach-and-attack' && actor.behaviorId !== 'behavior.patrol') {
    throw new Error(`internal invariant: no behavior resolver for ${actor.behaviorId ?? 'null'}`);
  }
  if (actor.behaviorState.intent === 'flee' && actor.behaviorState.investigation
    && (actor.behaviorState.investigation.expiresAt === null
      || actor.behaviorState.investigation.expiresAt > input.state.worldTime)) {
    const hostiles = input.state.actors.filter((candidate) => candidate.actorId !== actor.actorId
      && candidate.health > 0 && candidate.floorId === actor.floorId
      && relationshipBetween(input.state, actor.actorId, candidate.actorId) === 'hostile');
    const nearest = hostiles.sort((left, right) => distance(actor, left) - distance(actor, right)
      || (left.actorId < right.actorId ? -1 : 1))[0];
    if (nearest) {
      const floor = input.state.floors.find((candidate) => candidate.floorId === actor.floorId)!;
      const tiles = featureTiles(input.state, floor.floorId);
      const occupied = new Set(input.state.actors.filter((candidate) => candidate.actorId !== actor.actorId
        && candidate.floorId === actor.floorId && candidate.health > 0).map((candidate) => `${candidate.x}:${candidate.y}`));
      const candidates = [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => ({ x: actor.x + dx, y: actor.y + dy })))
        .filter((point) => point.x >= 0 && point.y >= 0 && point.x < floor.width && point.y < floor.height
          && (point.x !== actor.x || point.y !== actor.y)
          && movementBlockReason(tiles[point.y * floor.width + point.x]!) === undefined
          && !occupied.has(`${point.x}:${point.y}`))
        .sort((left, right) => distance(right, nearest) - distance(left, nearest)
          || left.y - right.y || left.x - right.x);
      if (candidates[0] && distance(candidates[0], nearest) > distance(actor, nearest)) {
        return { type: 'move', actorId: actor.actorId, to: candidates[0], cost: actionCostFor(rules, 'action.move') };
      }
    }
    return { type: 'wait', actorId: actor.actorId, cost: actionCostFor(rules, 'action.wait') };
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
      && actor.awareActorIds.includes(candidate.actorId)
      && relationshipBetween(input.state, actor.actorId, candidate.actorId) === 'hostile')
    : undefined;
  const target = goalTarget ?? awareTargets[0];
  if (target && distance(actor, target) === 1) {
    return {
      type: 'bump-attack', actorId: actor.actorId, targetActorId: target.actorId,
      cost: actionCostFor(rules, 'action.attack'),
    };
  }
  const investigation = actor.behaviorState.investigation;
  const investigationDestination = investigation !== null && investigation.floorId === actor.floorId
    && (investigation.expiresAt === null || investigation.expiresAt > input.state.worldTime)
    ? { x: investigation.x, y: investigation.y }
    : null;
  const destination = target
    ? { x: target.x, y: target.y }
    : savedGoal?.type === 'actor' ? investigationDestination
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
