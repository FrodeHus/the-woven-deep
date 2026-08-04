import type { ActorState } from './actor-model.js';
import type { ActiveRun, Point } from './model.js';
import { relationshipBetween } from './reactions.js';

/** Chebyshev (king-move) distance — the grid's own metric, so "adjacent" means all eight
 * neighbours. */
export function actorDistance(left: Point, right: Point): number {
  return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));
}

/**
 * The hostile actor `actor` is acting against this turn: its locked goal target while that
 * target is still alive, present, aware-of, and hostile; otherwise the nearest such actor, ties
 * broken by actor id so the choice is stable across identical states.
 *
 * Extracted from `chooseBehaviorAction` so the melee branch, the pathing branch, and the cast
 * decision (`champion-casting.ts`) cannot drift apart — a haunt that cast at one actor while
 * walking toward another would be a bug no single-file test would catch.
 */
export function awareHostileTarget(
  input: Readonly<{ state: ActiveRun; actor: ActorState }>,
): ActorState | undefined {
  const { state, actor } = input;
  const isEligible = (candidate: ActorState): boolean =>
    candidate.actorId !== actor.actorId &&
    candidate.health > 0 &&
    candidate.floorId === actor.floorId &&
    actor.awareActorIds.includes(candidate.actorId) &&
    relationshipBetween(state, actor.actorId, candidate.actorId) === 'hostile';
  const savedGoal = actor.behaviorState.goal;
  const goalTarget =
    savedGoal?.type === 'actor'
      ? state.actors.find(
          (candidate) => candidate.actorId === savedGoal.targetActorId && isEligible(candidate),
        )
      : undefined;
  if (goalTarget) return goalTarget;
  return state.actors
    .filter(isEligible)
    .sort(
      (left, right) =>
        actorDistance(actor, left) - actorDistance(actor, right) ||
        (left.actorId < right.actorId ? -1 : left.actorId > right.actorId ? 1 : 0),
    )[0];
}
