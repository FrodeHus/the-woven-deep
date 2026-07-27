import { isStairUp, type ObservableCell, type TileId } from '@woven-deep/engine';
import type { AtlasRect, PlayfieldAtlas } from './atlas.js';
import { TILE_HALF_H, TILE_HALF_W } from './iso-math.js';
import { skinFloor, type TileFamily } from './tile-skinning.js';

/**
 * The regenerated sheet draws each flat-floor cell as a full-cell diamond that spans the whole
 * 128px square (apex to apex, edge to edge), so its footprint is 1:1 rather than the 2:1 the iso
 * grid expects. `planFloorBake` maps that full cell onto the 2:1 pitch (64px wide by 32px tall at
 * scale 1) and centres the diamond on the cell, which tessellates exactly. A hair of overscan about
 * that centre hides the sub-pixel seams a fractional camera zoom can still open between adjacent
 * diamonds, keeping the floor reading as continuous stone.
 */
export const FLOOR_OVERSCAN = 1.02;

/**
 * The same seam correction for wall tiles, applied horizontally only: adjacent wall faces along an
 * explored edge otherwise show hairline gaps where sub-pixel rounding falls short of the cell
 * pitch. Widening about the cell centre closes them without changing the base-anchored height.
 */
export const WALL_OVERSCAN = 1.02;

export interface BakeDraw {
  rect: AtlasRect;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

export interface FloorBakePlan {
  draws: readonly BakeDraw[];
  pxWidth: number;
  pxHeight: number;
  originX: number;
  originY: number;
}

function isWallFamily(family: TileFamily): boolean {
  return (
    family === 'wall' ||
    family === 'wall-rounded' ||
    family === 'wall-weave' ||
    family === 'town-wall'
  );
}

// Flat walkable surfaces: their sheet art is a full-cell diamond with no vertical body, so they are
// squashed onto the 2:1 iso footprint and centred on the cell. Objects that stand ON the floor
// (doors, pillars, stairs) keep their full in-cell height and are anchored separately.
function isFlatFloorFamily(family: TileFamily): boolean {
  return family === 'floor' || family === 'floor-dirty' || family === 'town-floor';
}

// `void` is excluded from the family type: the only caller filters void cells out before resolving
// a rect, so the switch stays exhaustive over the drawable families with no void arm. The result is
// still optional because an out-of-range variant (atlas/length drift) reads back `undefined`.
function rectForSkin(
  family: Exclude<TileFamily, 'void'>,
  variant: number,
  atlas: PlayfieldAtlas,
  tileId: TileId | undefined,
): AtlasRect | undefined {
  switch (family) {
    case 'floor':
      return atlas.floors[variant];
    case 'floor-dirty':
      return atlas.dirty[variant];
    case 'wall':
      return atlas.walls[variant];
    case 'wall-rounded':
      return atlas.rounded[variant];
    case 'wall-weave':
      return atlas.weaveWalls[variant];
    case 'door':
      return atlas.door;
    case 'pillar':
      return atlas.pillar;
    case 'pillar-broken':
      return atlas.pillarBroken;
    case 'stairs':
      // Both stair tiles skin to the 'stairs' family; the direction picks the rect. Up rises
      // against a wall block, down cuts a well into the floor plane.
      return isStairUp(tileId) ? atlas.stairsUp : atlas.stairs;
    case 'town-floor':
      return atlas.townFloors[variant];
    case 'town-wall':
      return atlas.townWalls[variant];
    case 'town-door':
      return atlas.houseDoor;
    case 'town-entrance':
      return atlas.entranceSurround;
  }
}

interface Placed {
  x: number;
  y: number;
  rect: AtlasRect;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/**
 * Plans a static floor bake: every draw call the renderer will replay onto a per-floor canvas,
 * plus the canvas size and the origin offset the renderer positions that canvas at. Pure --
 * no canvas, no I/O -- so it is fully unit-testable without jsdom's canvas stubs.
 *
 * Coordinate convention (bake-local space, no camera): a cell's un-shifted iso position is
 * `((x - y) * TILE_HALF_W * scale, (x + y) * TILE_HALF_H * scale)`, the same projection
 * `iso-math.ts`'s `worldToScreen` uses with no camera/viewport term. `originX = height *
 * TILE_HALF_W * scale` (not `height - 1`) is deliberate: it is exactly the shift that lands the
 * leftmost cell's diamond flush against the canvas's left edge (`x=0, y=height-1` resolves to
 * `dx = 0`), which is the "demo" convention referenced in the design doc. `originY` starts at
 * `blockDepthPx * scale` (a fixed top margin sized to the tallest normal wall foot) and, together
 * with `originX`, is then nudged outward by however far any actual draw still overshoots
 * negative -- so the returned canvas always fully contains every planned draw regardless of the
 * atlas's exact rect proportions.
 */
export function planFloorBake(
  cells: readonly ObservableCell[],
  width: number,
  height: number,
  floorId: string,
  atlas: PlayfieldAtlas,
  scale: number,
  town: boolean,
): FloorBakePlan {
  const skins = skinFloor(cells, width, height, floorId, town);

  const dw = TILE_HALF_W * 2 * scale; // 64 * scale, per spec
  const floorHalfDh = TILE_HALF_H * scale;

  const isoX = (x: number, y: number): number => (x - y) * TILE_HALF_W * scale;
  const isoY = (x: number, y: number): number => (x + y) * TILE_HALF_H * scale;

  // Family lookup across the WHOLE grid, not just the cells actually drawn -- buried-wall
  // detection needs real neighbor geometry regardless of fog. `cells` always covers every grid
  // index (an engine invariant of `ObservableFloorProjection`), so this is a straight remap.
  const familyByIndex: (TileFamily | undefined)[] = Array.from(
    { length: width * height },
    (): TileFamily | undefined => undefined,
  );
  for (let i = 0; i < cells.length; i += 1) {
    familyByIndex[cells[i]!.index] = skins[i]!.family;
  }
  const familyAt = (x: number, y: number): TileFamily => {
    if (x < 0 || x >= width || y < 0 || y >= height) return 'void';
    return familyByIndex[y * width + x] ?? 'void';
  };
  const isBuriedWall = (x: number, y: number): boolean => {
    for (let ny = y - 1; ny <= y + 1; ny += 1) {
      for (let nx = x - 1; nx <= x + 1; nx += 1) {
        if (nx === x && ny === y) continue;
        if (!isWallFamily(familyAt(nx, ny))) return false;
      }
    }
    return true;
  };

  const placed: Placed[] = [];

  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i]!;
    if (cell.knowledge === 'unknown') continue; // terrain data may be absent
    const skin = skins[i]!;
    if (skin.family === 'void') continue;

    const wall = isWallFamily(skin.family);
    if (wall && isBuriedWall(cell.x, cell.y)) continue;

    const rect = rectForSkin(skin.family, skin.variant, atlas, cell.tileId);
    if (rect === undefined) continue;

    const sx = isoX(cell.x, cell.y);
    const sy = isoY(cell.x, cell.y);
    const dh = dw * (rect.h / rect.w);

    // Every unified-sheet cell is a full 128px square whose top-face diamond sits at a fixed
    // in-cell depth: its bottom corner `blockDepthPx` px above the cell base, its centre a further
    // quarter-width up (the diamond is 2:1). `spriteScale` maps that source geometry into the
    // scaled draw. Anchoring the diamond centre on the cell keeps floors and wall top faces on the
    // one floor plane; the wall art's own body then rises above and drops below that plane.
    const spriteScale = dw / rect.w;
    const diamondCentreY = (rect.h - atlas.blockDepthPx - rect.w / 4) * spriteScale;

    if (wall) {
      // Base-anchored: the sprite's bottom edge sits `blockDepthPx` (source px, scaled) below the
      // cell's own floor-diamond bottom corner, so tall wall art rises from the tile it stands on
      // instead of being centred on it. Widened by `WALL_OVERSCAN` about the cell centre (bottom +
      // height unchanged) so adjacent wall faces meet instead of leaving hairline gaps.
      const bottomY = sy + floorHalfDh + atlas.blockDepthPx * spriteScale;
      const wdw = dw * WALL_OVERSCAN;
      placed.push({ x: cell.x, y: cell.y, rect, dx: sx - wdw / 2, dy: bottomY - dh, dw: wdw, dh });
    } else if (isFlatFloorFamily(skin.family)) {
      // Flat floor: the full-cell diamond is squashed onto the 2:1 iso footprint (half the drawn
      // height) and centred on the cell, so adjacent diamonds meet edge to edge across the pitch.
      // `FLOOR_OVERSCAN` grows it symmetrically about that centre to close sub-pixel seams.
      const fdw = dw * FLOOR_OVERSCAN;
      const fdh = floorHalfDh * 2 * FLOOR_OVERSCAN;
      placed.push({ x: cell.x, y: cell.y, rect, dx: sx - fdw / 2, dy: sy - fdh / 2, dw: fdw, dh: fdh });
    } else {
      // Object standing on the floor (door, pillar, stairs): the diamond centre lands on the cell
      // centre (`sx`, `sy`) so its footprint tessellates with the floor, then scaled up by
      // `FLOOR_OVERSCAN` about that centre while keeping the object's full in-cell height.
      const fdw = dw * FLOOR_OVERSCAN;
      const fdh = dh * FLOOR_OVERSCAN;
      placed.push({
        x: cell.x,
        y: cell.y,
        rect,
        dx: sx - fdw / 2,
        dy: sy - diamondCentreY * FLOOR_OVERSCAN,
        dw: fdw,
        dh: fdh,
      });
    }
  }

  // Back-to-front paint order: (x + y) ascending, then x ascending.
  placed.sort((a, b) => a.x + a.y - (b.x + b.y) || a.x - b.x);

  const rawOriginX = height * TILE_HALF_W * scale;
  const rawOriginY = atlas.blockDepthPx * scale;

  let minX = 0;
  let minY = 0;
  for (const p of placed) {
    minX = Math.min(minX, p.dx + rawOriginX);
    minY = Math.min(minY, p.dy + rawOriginY);
  }
  const originX = rawOriginX + (minX < 0 ? -minX : 0);
  const originY = rawOriginY + (minY < 0 ? -minY : 0);

  let pxWidth = 0;
  let pxHeight = 0;
  const draws: BakeDraw[] = placed.map((p) => {
    const dx = p.dx + originX;
    const dy = p.dy + originY;
    pxWidth = Math.max(pxWidth, dx + p.dw);
    pxHeight = Math.max(pxHeight, dy + p.dh);
    return { rect: p.rect, dx, dy, dw: p.dw, dh: p.dh };
  });

  // Round up to whole pixels: a fractional `scale` leaves the rightmost/bottommost draw ending on a
  // sub-pixel boundary, and a truncating canvas size would clip that last row or column.
  return { draws, pxWidth: Math.ceil(pxWidth), pxHeight: Math.ceil(pxHeight), originX, originY };
}

/**
 * A key that changes iff a floor's discovered geometry changes: the floor id folded with every
 * known cell's `(index, token)` pair, in cell order. Knowledge tier (`remembered` vs `visible`)
 * never enters the fold -- that is the whole point, since fog changes every step and the bake
 * must not. FNV-1a, same mixing convention as `tile-skinning.ts`'s `cellSeed`.
 */
export function bakeKey(cells: readonly ObservableCell[], floorId: string): string {
  let hash = 0x811c9dc5;
  const mix = (value: string): void => {
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
  };

  mix(floorId);
  for (const cell of cells) {
    if (cell.knowledge === 'unknown') continue;
    mix(`|${cell.index}:${cell.token ?? ''}`);
  }

  return (hash >>> 0).toString(16);
}

/** Thin replay of a plan's draws onto `canvas` via `image`. All decisions live in the plan. */
export function bakeFloor(
  canvas: HTMLCanvasElement,
  image: CanvasImageSource,
  plan: FloorBakePlan,
): void {
  canvas.width = plan.pxWidth;
  canvas.height = plan.pxHeight;
  const ctx = canvas.getContext('2d');
  // Fail loud: a null 2d context means the floor cannot be baked at all, so surface it as an error
  // rather than a silently blank canvas the renderer would upload as an empty texture.
  if (ctx === null) {
    throw new Error('bakeFloor: 2d context unavailable for the floor bake canvas');
  }

  for (const draw of plan.draws) {
    ctx.drawImage(
      image,
      draw.rect.x,
      draw.rect.y,
      draw.rect.w,
      draw.rect.h,
      draw.dx,
      draw.dy,
      draw.dw,
      draw.dh,
    );
  }
}
