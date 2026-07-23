import type { Point } from './model.js';

/**
 * Callbacks that abstract the tile source for AoE shape computation. The engine passes tile-derived
 * callbacks (`targeting.ts`); the web client passes fogged-projection-derived callbacks
 * (`apps/web/src/session/spell-targeting.ts`). The ALGORITHM is single-source here; only the INPUT
 * differs, which is exactly why the client preview stays advisory while the server stays
 * authoritative. `isOpaque` MUST return `true` for out-of-bounds points (so `lineCells` stops at the
 * map edge), mirroring the engine's `isOpaqueCell`.
 */
export interface AoeGeometryCallbacks {
  readonly isOpaque: (point: Point) => boolean;
  readonly inBounds: (point: Point) => boolean;
}

function chebyshev(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Bresenham path from `from` to `to`, EXCLUSIVE of `from` and inclusive of `to`. */
export function bresenhamLine(from: Point, to: Point): readonly Point[] {
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

/** Filled Chebyshev disc around `center`, deterministically ordered (row-major), in-bounds only. */
export function burstCells(
  center: Point,
  radius: number,
  callbacks: Pick<AoeGeometryCallbacks, 'inBounds'>,
): readonly Point[] {
  const cells: Point[] = [];
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const cell = { x: center.x + dx, y: center.y + dy };
      if (!callbacks.inBounds(cell)) continue;
      cells.push(cell);
    }
  }
  return cells;
}

/** Bresenham path from `origin` toward `aim`, capped at `radius`, stopping at the first opaque tile. */
export function lineCells(
  origin: Point,
  aim: Point,
  radius: number,
  callbacks: Pick<AoeGeometryCallbacks, 'isOpaque'>,
): readonly Point[] {
  const cells: Point[] = [];
  for (const cell of bresenhamLine(origin, aim)) {
    if (chebyshev(origin, cell) > radius) break;
    if (callbacks.isOpaque(cell)) break;
    cells.push(cell);
  }
  return cells;
}

/**
 * Wedge of depth `radius` from `origin` toward `aim`, correct for all 8 aim directions. A cell at
 * offset (dx, dy) is in the cone iff it's within the Chebyshev extent, forward of the origin along
 * the aim direction, and within the 45-degree half-angle (forward component >= perpendicular).
 */
export function coneCells(
  origin: Point,
  aim: Point,
  radius: number,
  callbacks: Pick<AoeGeometryCallbacks, 'inBounds'>,
): readonly Point[] {
  const fx = Math.sign(aim.x - origin.x);
  const fy = Math.sign(aim.y - origin.y);
  const cells: Point[] = [];
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > radius) continue;
      const forward = dx * fx + dy * fy;
      if (forward <= 0) continue;
      const perpendicular = Math.abs(dx * -fy + dy * fx);
      if (forward < perpendicular) continue;
      const cell = { x: origin.x + dx, y: origin.y + dy };
      if (!callbacks.inBounds(cell)) continue;
      cells.push(cell);
    }
  }
  return cells;
}
