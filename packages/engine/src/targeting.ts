import type { TargetingId } from '@woven-deep/content';
import type { ActorState } from './actor-model.js';
import type { IlluminationField } from './light-model.js';
import type { FloorSnapshot, OpaqueId, Point } from './model.js';
import { tileIndex } from './model.js';
import { tileDefinition } from './terrain.js';
import { isVisible } from './visibility.js';

export type TargetInvalidReason =
  'target.not_visible' | 'target.out_of_range' | 'target.blocked' | 'target.invalid';
export type TargetValidation =
  | Readonly<{ ok: true; cells: readonly Point[]; targetActorId?: OpaqueId }>
  | Readonly<{ ok: false; reason: TargetInvalidReason }>;

export interface TargetValidationInput {
  readonly targetingId: TargetingId;
  readonly sourceActor: ActorState;
  readonly targetActorId: OpaqueId | null;
  readonly target: Point | null;
  readonly floor: FloorSnapshot;
  readonly actors: readonly ActorState[];
  readonly visibilityWords: readonly number[];
  readonly illumination: Pick<IlluminationField, 'intensity'>;
  readonly range: number;
}

function line(from: Point, to: Point): readonly Point[] {
  const points: Point[] = [];
  let x = from.x;
  let y = from.y;
  const dx = Math.abs(to.x - from.x);
  const sx = from.x < to.x ? 1 : -1;
  const dy = -Math.abs(to.y - from.y);
  const sy = from.y < to.y ? 1 : -1;
  let error = dx + dy;
  while (x !== to.x || y !== to.y) {
    const twice = 2 * error;
    if (twice >= dy) {
      error += dy;
      x += sx;
    }
    if (twice <= dx) {
      error += dx;
      y += sy;
    }
    points.push({ x, y });
  }
  return points;
}

function validatePoint(
  input: TargetValidationInput,
  point: Point,
  targetActorId?: OpaqueId,
): TargetValidation {
  const index = tileIndex(input.floor, point.x, point.y);
  if (
    index === undefined ||
    !isVisible(input.visibilityWords, index) ||
    (input.illumination.intensity[index] ?? 0) <= 0
  ) {
    return { ok: false, reason: 'target.not_visible' };
  }
  const distance = Math.max(
    Math.abs(point.x - input.sourceActor.x),
    Math.abs(point.y - input.sourceActor.y),
  );
  if (distance > input.range) return { ok: false, reason: 'target.out_of_range' };
  const cells = line(input.sourceActor, point);
  if (
    cells.slice(0, -1).some((cell) => {
      const cellIndex = tileIndex(input.floor, cell.x, cell.y)!;
      return tileDefinition(input.floor.tiles[cellIndex]!).opaque;
    })
  )
    return { ok: false, reason: 'target.blocked' };
  return targetActorId === undefined ? { ok: true, cells } : { ok: true, cells, targetActorId };
}

export function validateTarget(input: TargetValidationInput): TargetValidation {
  if (!Number.isSafeInteger(input.range) || input.range < 0)
    throw new RangeError('target range must be a non-negative safe integer');
  if (input.sourceActor.floorId !== input.floor.floorId)
    return { ok: false, reason: 'target.invalid' };
  if (input.targetingId === 'target.self') {
    return {
      ok: true,
      cells: [{ x: input.sourceActor.x, y: input.sourceActor.y }],
      targetActorId: input.sourceActor.actorId,
    };
  }
  if (input.targetingId === 'target.actor') {
    const target =
      input.targetActorId === null
        ? undefined
        : input.actors.find(
            (actor) =>
              actor.actorId === input.targetActorId && actor.floorId === input.floor.floorId,
          );
    if (!target) return { ok: false, reason: 'target.not_visible' };
    return validatePoint(input, target, target.actorId);
  }
  if (input.target === null) return { ok: false, reason: 'target.invalid' };
  return validatePoint(input, input.target);
}
