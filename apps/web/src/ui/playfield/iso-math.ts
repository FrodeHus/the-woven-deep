export interface IsoView {
  readonly camX: number;
  readonly camY: number;
  readonly zoom: number;
  readonly viewW: number;
  readonly viewH: number;
}

export const TILE_HALF_W = 32;
export const TILE_HALF_H = 16;

/**
 * Maps isometric world coordinates to screen pixels.
 * Formula: sx = (tx - camX - (ty - camY)) * TILE_HALF_W * zoom + viewW / 2
 *          sy = (tx - camX + (ty - camY)) * TILE_HALF_H * zoom + viewH / 2 - (z ?? 0) * zoom
 */
export function worldToScreen(
  view: IsoView,
  tx: number,
  ty: number,
  z?: number,
): readonly [number, number] {
  const dx = tx - view.camX;
  const dy = ty - view.camY;
  const elevation = z ?? 0;

  const sx =
    (dx - dy) * TILE_HALF_W * view.zoom + view.viewW / 2;
  const sy =
    (dx + dy) * TILE_HALF_H * view.zoom + view.viewH / 2 - elevation * view.zoom;

  return [sx, sy];
}

/**
 * Maps screen pixels to isometric world coordinates.
 * Exact inverse of worldToScreen (solves the 2×2 linear system).
 */
export function screenToWorld(
  view: IsoView,
  sx: number,
  sy: number,
): readonly [number, number] {
  // Denormalize screen coordinates relative to viewport center
  const dx_norm =
    (sx - view.viewW / 2) / (TILE_HALF_W * view.zoom);
  const dy_norm =
    (sy - view.viewH / 2) / (TILE_HALF_H * view.zoom);

  // Solve for tx-camX and ty-camY
  const u = (dx_norm + dy_norm) / 2;
  const v = (dy_norm - dx_norm) / 2;

  const tx = view.camX + u;
  const ty = view.camY + v;

  return [tx, ty];
}

/**
 * Returns the grid cell at a screen position, or null if out of bounds.
 * Grid cell x and y are floored to integers and must be in [0, width) × [0, height).
 */
export function cellAtScreen(
  view: IsoView,
  sx: number,
  sy: number,
  width: number,
  height: number,
): { x: number; y: number } | null {
  const [tx, ty] = screenToWorld(view, sx, sy);
  const x = Math.floor(tx);
  const y = Math.floor(ty);

  if (x >= 0 && x < width && y >= 0 && y < height) {
    return { x, y };
  }

  return null;
}
