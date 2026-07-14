import type { ActorBehaviorState, LastKnownTarget } from './population-model.js';
import { compareCodeUnits } from './stable-json.js';
import { isPerceivedCell } from './perception.js';

function newer(left: LastKnownTarget, right: LastKnownTarget): LastKnownTarget {
  if (right.observedAt !== left.observedAt) return right.observedAt > left.observedAt ? right : left;
  return compareCodeUnits(right.observerActorId, left.observerActorId) < 0 ? right : left;
}

export function mergeLastKnownTargets(
  memories: readonly LastKnownTarget[], observations: readonly LastKnownTarget[],
): readonly LastKnownTarget[] {
  const byTarget = new Map<string, LastKnownTarget>();
  for (const memory of [...memories, ...observations]) {
    const previous = byTarget.get(memory.targetActorId);
    byTarget.set(memory.targetActorId, previous ? newer(previous, memory) : memory);
  }
  return [...byTarget.values()].sort((left, right) => compareCodeUnits(left.targetActorId, right.targetActorId));
}

export function visibleTargetObservations(input: Readonly<{
  observerActorId: string;
  floorId: string;
  width: number;
  visibilityWords: readonly number[];
  illuminationIntensity: readonly number[];
  observedAt: number;
  actors: readonly Readonly<{ actorId: string; x: number; y: number }>[];
}>): readonly LastKnownTarget[] {
  if (!Number.isSafeInteger(input.width) || input.width <= 0) throw new RangeError('perception width must be positive');
  return input.actors
    .filter((actor) => actor.actorId !== input.observerActorId)
    .filter((actor) => {
      const index = actor.y * input.width + actor.x;
      return index >= 0 && index < input.illuminationIntensity.length
        && isPerceivedCell(input.visibilityWords, { intensity: input.illuminationIntensity }, index);
    })
    .map((actor): LastKnownTarget => ({
      targetActorId: actor.actorId, floorId: input.floorId, x: actor.x, y: actor.y,
      observedAt: input.observedAt, source: 'sight', observerActorId: input.observerActorId,
    }))
    .sort((left, right) => compareCodeUnits(left.targetActorId, right.targetActorId));
}

export function soundTargetObservation(input: Readonly<{
  observerActorId: string;
  targetActorId: string;
  floorId: string;
  x: number;
  y: number;
  observedAt: number;
}>): LastKnownTarget {
  return { ...input, source: 'sound' };
}

export function updateActorMemory(input: Readonly<{
  state: ActorBehaviorState;
  observations: readonly LastKnownTarget[];
  investigationDuration: number | null;
}>): ActorBehaviorState {
  if (input.observations.length === 0) return input.state;
  if (input.investigationDuration !== null
    && (!Number.isSafeInteger(input.investigationDuration) || input.investigationDuration < 0)) {
    throw new RangeError('investigation duration must be a non-negative safe integer or null');
  }
  const selected = [...input.observations].sort((left, right) => {
    if (left.observedAt !== right.observedAt) return right.observedAt - left.observedAt;
    const observerOrder = compareCodeUnits(left.observerActorId, right.observerActorId);
    return observerOrder !== 0 ? observerOrder : compareCodeUnits(left.targetActorId, right.targetActorId);
  })[0]!;
  return {
    ...input.state,
    lastKnownTargets: mergeLastKnownTargets(input.state.lastKnownTargets, input.observations),
    investigation: {
      floorId: selected.floorId, x: selected.x, y: selected.y, startedAt: selected.observedAt,
      expiresAt: input.investigationDuration === null ? null : selected.observedAt + input.investigationDuration,
    },
  };
}
