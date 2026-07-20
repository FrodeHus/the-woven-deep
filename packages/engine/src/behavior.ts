import type { CompiledContentPack } from '@woven-deep/content';
import { actionCostFor, balanceEntry, type GameAction } from './actions.js';
import { actorById, type ActorState } from './actor-model.js';
import { entryById } from './content-index.js';
import { featureTiles } from './features.js';
import { MERCHANT_BEHAVIOR_ID, merchantBehaviorAction } from './merchant-behavior.js';
import { findPath, selectPathStep } from './pathfinding.js';
import { movementBlockReason } from './terrain.js';
import type { ActiveRun, OpaqueId, Point } from './model.js';
import type { ActorGoal } from './population-model.js';
import { relationshipBetween } from './reactions.js';
import { swarmSpawnAction } from './swarm-behavior.js';

function distance(left: Point, right: Point): number {
  return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));
}

export function selectPatrolGoal(
  input: Readonly<{
    state: ActiveRun;
    actor: ActorState;
    content: CompiledContentPack;
  }>,
): ActorGoal | null {
  const definition = entryById(input.content, input.actor.contentId);
  if (!definition || definition.kind !== 'monster') {
    throw new Error(
      `internal invariant: monster definition ${input.actor.contentId} does not exist`,
    );
  }
  const population = input.state.populations.find(
    (candidate) => candidate.populationId === input.actor.populationId,
  );
  const bossPhaseId = population?.model === 'boss' ? population.currentPhaseId : null;
  const bossEncounter =
    population?.model === 'boss' && bossPhaseId !== null
      ? entryById(input.content, population.encounterId)
      : undefined;
  const phase =
    bossEncounter?.kind === 'encounter' && bossEncounter.model === 'boss'
      ? bossEncounter.definition.phases.find((candidate) => candidate.phaseId === bossPhaseId)
      : undefined;
  const waypoints = (phase?.behaviorParameters ?? definition.behaviorParameters).waypoints;
  if (
    !Array.isArray(waypoints) ||
    waypoints.length === 0 ||
    waypoints.some(
      (waypoint) =>
        typeof waypoint !== 'object' ||
        waypoint === null ||
        !Number.isSafeInteger((waypoint as Point).x) ||
        !Number.isSafeInteger((waypoint as Point).y),
    )
  )
    throw new Error(`internal invariant: invalid patrol waypoints for ${definition.id}`);
  const points = waypoints as readonly Point[];
  const current = points.findIndex(
    (point) => point.x === input.actor.x && point.y === input.actor.y,
  );
  const selected = points[current < 0 ? 0 : (current + 1) % points.length]!;
  const floor = input.state.floors.find((candidate) => candidate.floorId === input.actor.floorId);
  if (!floor)
    throw new Error(`internal invariant: actor floor ${input.actor.floorId} does not exist`);
  if (selected.x < 0 || selected.y < 0 || selected.x >= floor.width || selected.y >= floor.height)
    return null;
  return { type: 'cell', floorId: floor.floorId, x: selected.x, y: selected.y };
}

export function chooseBehaviorAction(
  input: Readonly<{
    state: ActiveRun;
    actorId: OpaqueId;
    content: CompiledContentPack;
  }>,
): GameAction {
  const actor = actorById(input.state, input.actorId);
  if (!actor) throw new Error(`internal invariant: actor ${input.actorId} does not exist`);
  const rules = balanceEntry(input.content);
  if (actor.behaviorId === null) {
    return { type: 'wait', actorId: actor.actorId, cost: actionCostFor(rules, 'action.wait') };
  }
  if (actor.behaviorId === MERCHANT_BEHAVIOR_ID) {
    return merchantBehaviorAction({
      state: input.state,
      content: input.content,
      actorId: actor.actorId,
    });
  }
  if (
    actor.behaviorId !== 'behavior.approach-and-attack' &&
    actor.behaviorId !== 'behavior.patrol'
  ) {
    throw new Error(`internal invariant: no behavior resolver for ${actor.behaviorId ?? 'null'}`);
  }
  if (
    actor.behaviorState.intent === 'flee' &&
    actor.behaviorState.investigation &&
    (actor.behaviorState.investigation.expiresAt === null ||
      actor.behaviorState.investigation.expiresAt > input.state.worldTime)
  ) {
    const goal = actor.behaviorState.goal;
    if (goal?.type === 'cell' && goal.floorId === actor.floorId) {
      const floor = input.state.floors.find((candidate) => candidate.floorId === actor.floorId)!;
      const tiles = featureTiles(input.state, floor.floorId);
      const occupied = new Set(
        input.state.actors
          .filter(
            (candidate) =>
              candidate.actorId !== actor.actorId &&
              candidate.floorId === actor.floorId &&
              candidate.health > 0,
          )
          .map((candidate) => `${candidate.x}:${candidate.y}`),
      );
      const path = findPath({
        width: floor.width,
        height: floor.height,
        topology: 8,
        origin: actor,
        destination: goal,
        isPassable: (x, y) =>
          movementBlockReason(tiles[y * floor.width + x]!) === undefined &&
          ((x === actor.x && y === actor.y) || !occupied.has(`${x}:${y}`)),
      });
      const selected = selectPathStep(path);
      if (selected.status === 'move')
        return {
          type: 'move',
          actorId: actor.actorId,
          to: selected.step,
          cost: actionCostFor(rules, 'action.move'),
        };
    }
    return { type: 'wait', actorId: actor.actorId, cost: actionCostFor(rules, 'action.wait') };
  }
  const awareTargets = input.state.actors
    .filter(
      (candidate) =>
        candidate.actorId !== actor.actorId &&
        candidate.health > 0 &&
        candidate.floorId === actor.floorId &&
        actor.awareActorIds.includes(candidate.actorId) &&
        relationshipBetween(input.state, actor.actorId, candidate.actorId) === 'hostile',
    )
    .sort(
      (left, right) =>
        distance(actor, left) - distance(actor, right) ||
        (left.actorId < right.actorId ? -1 : left.actorId > right.actorId ? 1 : 0),
    );
  const savedGoal = actor.behaviorState.goal;
  const goalTarget =
    savedGoal?.type === 'actor'
      ? input.state.actors.find(
          (candidate) =>
            candidate.actorId === savedGoal.targetActorId &&
            candidate.health > 0 &&
            candidate.floorId === actor.floorId &&
            actor.awareActorIds.includes(candidate.actorId) &&
            relationshipBetween(input.state, actor.actorId, candidate.actorId) === 'hostile',
        )
      : undefined;
  const target = goalTarget ?? awareTargets[0];
  if (target && distance(actor, target) === 1) {
    return {
      type: 'bump-attack',
      actorId: actor.actorId,
      targetActorId: target.actorId,
      cost: actionCostFor(rules, 'action.attack'),
    };
  }
  const spawn = swarmSpawnAction(input);
  if (spawn) return spawn;
  const investigation = actor.behaviorState.investigation;
  const investigationDestination =
    investigation !== null &&
    investigation.floorId === actor.floorId &&
    (investigation.expiresAt === null || investigation.expiresAt > input.state.worldTime)
      ? { x: investigation.x, y: investigation.y }
      : null;
  const destination = target
    ? { x: target.x, y: target.y }
    : savedGoal?.type === 'actor'
      ? investigationDestination
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
  const occupied = new Set(
    input.state.actors
      .filter(
        (candidate) =>
          candidate.actorId !== actor.actorId &&
          candidate.floorId === actor.floorId &&
          candidate.health > 0,
      )
      .map((candidate) => `${candidate.x}:${candidate.y}`),
  );
  const path = findPath({
    width: floor.width,
    height: floor.height,
    topology: 8,
    origin: { x: actor.x, y: actor.y },
    destination,
    isPassable: (x, y) => {
      const index = y * floor.width + x;
      const isDestination = x === destination.x && y === destination.y;
      return (
        movementBlockReason(tiles[index]!) === undefined &&
        ((isDestination && target !== undefined) || !occupied.has(`${x}:${y}`))
      );
    },
  });
  const selected = selectPathStep(path);
  if (selected.status === 'move') {
    return {
      type: 'move',
      actorId: actor.actorId,
      to: selected.step,
      cost: actionCostFor(rules, 'action.move'),
    };
  }
  return { type: 'wait', actorId: actor.actorId, cost: actionCostFor(rules, 'action.wait') };
}
