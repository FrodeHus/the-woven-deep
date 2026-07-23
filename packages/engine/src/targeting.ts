import type { SpellAoeDescriptor, TargetingId } from '@woven-deep/content';
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
  readonly aoe?: SpellAoeDescriptor;
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

function chebyshev(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function isOpaqueCell(input: TargetValidationInput, point: Point): boolean {
  const index = tileIndex(input.floor, point.x, point.y);
  if (index === undefined) return true;
  return tileDefinition(input.floor.tiles[index]!).opaque;
}

/** Filled Chebyshev disc around `center`, deterministically ordered (row-major), in-bounds only. */
function burstCells(input: TargetValidationInput, center: Point, radius: number): readonly Point[] {
  const cells: Point[] = [];
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const cell = { x: center.x + dx, y: center.y + dy };
      if (tileIndex(input.floor, cell.x, cell.y) === undefined) continue;
      cells.push(cell);
    }
  }
  return cells;
}

/** Bresenham path from the caster toward `aim`, capped at `radius`, stopping at the first opaque tile. */
function lineCells(input: TargetValidationInput, aim: Point, radius: number): readonly Point[] {
  const cells: Point[] = [];
  for (const cell of line(input.sourceActor, aim)) {
    if (chebyshev(input.sourceActor, cell) > radius) break;
    if (isOpaqueCell(input, cell)) break;
    cells.push(cell);
  }
  return cells;
}

/**
 * Wedge of depth `radius` from the caster toward `aim`, correct for all 8 aim
 * directions (cardinal and diagonal). A cell at offset (dx, dy) from the
 * caster is in the cone iff it's within the Chebyshev extent, forward of the
 * caster along the aim direction, and within the 45-degree half-angle of that
 * direction (forward component >= perpendicular component).
 */
function coneCells(input: TargetValidationInput, aim: Point, radius: number): readonly Point[] {
  const fx = Math.sign(aim.x - input.sourceActor.x);
  const fy = Math.sign(aim.y - input.sourceActor.y);
  const cells: Point[] = [];
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > radius) continue;
      const forward = dx * fx + dy * fy;
      if (forward <= 0) continue;
      const perpendicular = Math.abs(dx * -fy + dy * fx);
      if (forward < perpendicular) continue;
      const cell = { x: input.sourceActor.x + dx, y: input.sourceActor.y + dy };
      if (tileIndex(input.floor, cell.x, cell.y) === undefined) continue;
      cells.push(cell);
    }
  }
  return cells;
}

/**
 * Gate for the aim cell of an AoE cast: visible, lit, and within point-and-click
 * range of the caster. Unlike `validatePoint`, this does NOT require an
 * unobstructed line of sight all the way to the aim cell — for burst/line/cone
 * the aim is a direction/anchor, and any blocking geometry (e.g. a wall cutting
 * a line short) is handled by the shape-specific cell computation instead.
 */
function validateAimPoint(input: TargetValidationInput, point: Point): TargetValidation {
  const index = tileIndex(input.floor, point.x, point.y);
  if (
    index === undefined ||
    !isVisible(input.visibilityWords, index) ||
    (input.illumination.intensity[index] ?? 0) <= 0
  ) {
    return { ok: false, reason: 'target.not_visible' };
  }
  if (chebyshev(input.sourceActor, point) > input.range)
    return { ok: false, reason: 'target.out_of_range' };
  return { ok: true, cells: [] };
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
  if (
    input.aoe !== undefined &&
    (input.targetingId === 'target.burst' ||
      input.targetingId === 'target.line' ||
      input.targetingId === 'target.cone')
  ) {
    if (input.target === null) return { ok: false, reason: 'target.invalid' };
    const aimed = validateAimPoint(input, input.target);
    if (!aimed.ok) return aimed;
    const cells =
      input.targetingId === 'target.burst'
        ? burstCells(input, input.target, input.aoe.radius)
        : input.targetingId === 'target.line'
          ? lineCells(input, input.target, input.aoe.radius)
          : coneCells(input, input.target, input.aoe.radius);
    return { ok: true, cells };
  }
  if (input.target === null) return { ok: false, reason: 'target.invalid' };
  return validatePoint(input, input.target);
}
