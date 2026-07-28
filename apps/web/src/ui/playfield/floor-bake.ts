import { isStairUp, type ObservableCell, type TileId } from '@woven-deep/engine';
import type { AtlasRect, PlayfieldAtlas } from './atlas.js';
import { TILE_HALF_H, TILE_HALF_W } from './iso-math.js';
import { skinFloor, type TileFamily, type TileSkin } from './tile-skinning.js';

/**
 * The regenerated sheet draws each flat-floor cell as a diamond whose measured crop is close to
 * square rather than the 2:1 the iso grid expects. `planFloorBake` maps that crop onto the 2:1
 * pitch (64px wide by 32px tall at scale 1) and centres the diamond on the cell, which tessellates
 * exactly. A hair of overscan about that centre hides the sub-pixel seams a fractional camera zoom
 * can still open between adjacent diamonds, keeping the floor reading as continuous stone.
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

/**
 * Occlusion stub (user-decided see-through-walls polish, dynamic -- it follows the hero). A standing
 * wall whose raised body covers the hero's vicinity on screen is not drawn full-height; instead only
 * the bottom `STUB_SOURCE_FRACTION` of the cube crop is blitted at the same foot anchor, leaving a
 * short wall base the hero and the corridor floor read over. No alpha anywhere -- the stub is fully
 * opaque, just short. The fraction is tuned so the stub top sits at roughly the cell's floor-diamond
 * top corner: for the live 120x144 wall crop (dest height 76.8, floor-diamond half-depth 16) a
 * ~0.42 crop lands the top on the corner; kept a touch lower so the reveal is unambiguous.
 */
export const STUB_SOURCE_FRACTION = 0.34;

/** Half a tile's screen width in bake-local pixels: the reference width for a fixture post. */
const FIXTURE_POST_WIDTH = TILE_HALF_W;
/** A wall-mounted torch reads wider than a freestanding post; sized against the tile pitch. */
const FIXTURE_WALL_WIDTH = TILE_HALF_W * 1.7;
/** How far a wall-mounted torch is nudged from the cell centre toward its backing wall face, as a
 * fraction of the neighbour offset -- enough to read as mounted without leaving the cell. */
const FIXTURE_WALL_OFFSET = 0.32;
/** The engine presentation token a lamp fixture carries (`content/vaults/*` `presentationToken`). */
const LAMP_FIXTURE_TOKEN = 'fixture.lamp';

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

/** A family lookup across the WHOLE grid (not just drawn cells): buried-wall and occlusion checks
 * need real neighbour geometry regardless of fog. `cells` always covers every grid index (an engine
 * invariant of `ObservableFloorProjection`), so this is a straight remap of the skinned families. */
function makeFamilyAt(
  cells: readonly ObservableCell[],
  skins: readonly TileSkin[],
  width: number,
  height: number,
): (x: number, y: number) => TileFamily {
  const familyByIndex: (TileFamily | undefined)[] = Array.from(
    { length: width * height },
    (): TileFamily | undefined => undefined,
  );
  for (let i = 0; i < cells.length; i += 1) familyByIndex[cells[i]!.index] = skins[i]!.family;
  return (x: number, y: number): TileFamily => {
    if (x < 0 || x >= width || y < 0 || y >= height) return 'void';
    return familyByIndex[y * width + x] ?? 'void';
  };
}

/** A wall fully enclosed by other walls in its 8-neighbourhood is never drawn (nothing sees it). */
function isBuriedWall(
  x: number,
  y: number,
  familyAt: (x: number, y: number) => TileFamily,
): boolean {
  for (let ny = y - 1; ny <= y + 1; ny += 1) {
    for (let nx = x - 1; nx <= x + 1; nx += 1) {
      if (nx === x && ny === y) continue;
      if (!isWallFamily(familyAt(nx, ny))) return false;
    }
  }
  return true;
}

/** The cells a standing wall at `(x,y)` of drawn height `dh` covers on screen behind it: `(x-1,y-1)`
 * two rows up (reached once the body rises `>= 2 * floorHalfDh` above the cell centre) and
 * `(x-1,y)`/`(x,y-1)` one row up (`>= 1 * floorHalfDh`). The body top sits `dh - floorHalfDh` above
 * the cell centre; a behind cell `rows` up has its centre `rows * floorHalfDh` above. */
function wallCoversBehind(
  x: number,
  y: number,
  dh: number,
  floorHalfDh: number,
): readonly [number, number][] {
  const rise = dh - floorHalfDh;
  const out: [number, number][] = [];
  if (rise >= 2 * floorHalfDh) out.push([x - 1, y - 1]);
  if (rise >= 1 * floorHalfDh) {
    out.push([x - 1, y]);
    out.push([x, y - 1]);
  }
  return out;
}

/**
 * The grid indices of the walls that must render as occlusion stubs this frame: every drawn wall
 * whose raised body covers the HERO's vicinity on screen (the hero's cell or an orthogonal
 * neighbour). Dynamic -- it depends on `hero`, so it changes as the hero moves, and is empty when
 * `hero` is undefined. Pure; both `planFloorBake` (to stub the walls) and the renderer's rebake key
 * (to trigger a rebuild only when the set actually changes) derive from this one function.
 */
export function occludedWallIndices(
  cells: readonly ObservableCell[],
  width: number,
  height: number,
  floorId: string,
  atlas: PlayfieldAtlas,
  scale: number,
  town: boolean,
  hero: { x: number; y: number } | undefined,
): ReadonlySet<number> {
  const result = new Set<number>();
  if (hero === undefined) return result;

  const skins = skinFloor(cells, width, height, floorId, town);
  const familyAt = makeFamilyAt(cells, skins, width, height);
  const dw = TILE_HALF_W * 2 * scale;
  const floorHalfDh = TILE_HALF_H * scale;

  const vicinity = new Set<string>([
    `${hero.x},${hero.y}`,
    `${hero.x},${hero.y - 1}`,
    `${hero.x},${hero.y + 1}`,
    `${hero.x - 1},${hero.y}`,
    `${hero.x + 1},${hero.y}`,
  ]);

  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i]!;
    if (cell.knowledge === 'unknown') continue;
    const skin = skins[i]!;
    if (!isWallFamily(skin.family)) continue;
    if (isBuriedWall(cell.x, cell.y, familyAt)) continue;
    const rect = rectForSkin(
      skin.family as Exclude<TileFamily, 'void'>,
      skin.variant,
      atlas,
      cell.tileId,
    );
    if (rect === undefined) continue;
    const dh = dw * (rect.h / rect.w);
    for (const [bx, by] of wallCoversBehind(cell.x, cell.y, dh, floorHalfDh)) {
      if (vicinity.has(`${bx},${by}`)) {
        result.add(cell.index);
        break;
      }
    }
  }
  return result;
}

// The orthogonal neighbour a wall-mounted torch backs onto, preferring a screen-upward wall (north
// then west) so the torch reads as fixed to a back wall rather than a foreground one, then falling
// back to east/south. Returns the wall cell's coordinates, or `undefined` when no orthogonal
// neighbour is a wall (a freestanding post).
function adjacentWallDirection(
  x: number,
  y: number,
  familyAt: (x: number, y: number) => TileFamily,
): { x: number; y: number } | undefined {
  const candidates: readonly [number, number][] = [
    [x, y - 1], // north (up-right on screen)
    [x - 1, y], // west (up-left on screen)
    [x + 1, y], // east
    [x, y + 1], // south
  ];
  for (const [nx, ny] of candidates) {
    if (isWallFamily(familyAt(nx, ny))) return { x: nx, y: ny };
  }
  return undefined;
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
  occluded: ReadonlySet<number> = new Set(),
): FloorBakePlan {
  const skins = skinFloor(cells, width, height, floorId, town);

  const dw = TILE_HALF_W * 2 * scale; // 64 * scale, per spec
  const floorHalfDh = TILE_HALF_H * scale;

  const isoX = (x: number, y: number): number => (x - y) * TILE_HALF_W * scale;
  const isoY = (x: number, y: number): number => (x + y) * TILE_HALF_H * scale;

  const familyAt = makeFamilyAt(cells, skins, width, height);

  const placed: Placed[] = [];

  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i]!;
    if (cell.knowledge === 'unknown') continue; // terrain data may be absent
    const skin = skins[i]!;
    if (skin.family === 'void') continue;

    const wall = isWallFamily(skin.family);
    if (wall && isBuriedWall(cell.x, cell.y, familyAt)) continue;

    const rect = rectForSkin(skin.family, skin.variant, atlas, cell.tileId);
    if (rect === undefined) continue;

    const sx = isoX(cell.x, cell.y);
    const sy = isoY(cell.x, cell.y);
    const dh = dw * (rect.h / rect.w);

    // Each measured tile crop carries a top-face diamond at a fixed depth: its bottom corner
    // `blockDepthPx` source-px above the crop base, its centre a further quarter-width up (the
    // diamond projects 2:1). `spriteScale` maps that source geometry into the
    // scaled draw. Anchoring the diamond centre on the cell keeps floors and wall top faces on the
    // one floor plane; the wall art's own body then rises above and drops below that plane.
    const spriteScale = dw / rect.w;
    const diamondCentreY = (rect.h - atlas.blockDepthPx - rect.w / 4) * spriteScale;
    // Object-tile anchoring (door/pillar/stairs) assumes band-form art with the diamond at a fixed
    // in-cell depth; full-cell object art would render ~24px low, so regenerated object tiles must
    // follow the band form.

    if (wall) {
      // Foot-anchored: a measured wall crop is tight, so its bottom edge is the cube's front foot.
      // Rest that foot on the cell's floor-diamond bottom corner (`sy + floorHalfDh`), which lands
      // the whole cube -- top face and side faces -- ABOVE the cell's floor plane and overpainting
      // it. The cube height is already encoded in `dh` (the scaled crop height), so its top edge
      // rises `dh - floorHalfDh` above the cell centre; no separate depth offset is added. Adding
      // `blockDepthPx` here (the earlier bug) instead sank the body a full cube-depth below the
      // plane, where the next row's floor overpainted it and the wall read as flat floor.
      // Widened by `WALL_OVERSCAN` about the cell centre (foot and height unchanged) so adjacent
      // wall faces meet instead of leaving hairline gaps.
      const bottomY = sy + floorHalfDh;
      const wdw = dw * WALL_OVERSCAN;
      if (occluded.has(cell.index)) {
        // Occlusion stub: the wall covers the hero's vicinity on screen, so draw only the bottom
        // slice of the cube crop (same foot anchor, cropped source AND dest height). The short base
        // still reads as a wall while the hero and the corridor behind it show over it. No alpha.
        const stubDh = dh * STUB_SOURCE_FRACTION;
        const stubRect: AtlasRect = {
          x: rect.x,
          y: rect.y + rect.h * (1 - STUB_SOURCE_FRACTION),
          w: rect.w,
          h: rect.h * STUB_SOURCE_FRACTION,
        };
        placed.push({
          x: cell.x,
          y: cell.y,
          rect: stubRect,
          dx: sx - wdw / 2,
          dy: bottomY - stubDh,
          dw: wdw,
          dh: stubDh,
        });
      } else {
        placed.push({
          x: cell.x,
          y: cell.y,
          rect,
          dx: sx - wdw / 2,
          dy: bottomY - dh,
          dw: wdw,
          dh,
        });
      }
    } else if (isFlatFloorFamily(skin.family)) {
      // Flat floor: the full-cell diamond is squashed onto the 2:1 iso footprint (half the drawn
      // height) and centred on the cell, so adjacent diamonds meet edge to edge across the pitch.
      // `FLOOR_OVERSCAN` grows it symmetrically about that centre to close sub-pixel seams.
      const fdw = dw * FLOOR_OVERSCAN;
      const fdh = floorHalfDh * 2 * FLOOR_OVERSCAN;
      placed.push({
        x: cell.x,
        y: cell.y,
        rect,
        dx: sx - fdw / 2,
        dy: sy - fdh / 2,
        dw: fdw,
        dh: fdh,
      });
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

  // Lamp fixtures: a standing torch on each discovered fixture cell, IN ADDITION to the light pool
  // the renderer paints. A torch backed by an orthogonally adjacent wall mounts against that wall
  // face (`torchWall`, nudged toward the wall); an unbacked one stands as a freestanding `torch`
  // post at the cell centre. Baked because fixtures never move within a floor. Emitted into the same
  // `placed` list so the back-to-front sort paints each torch after its own floor yet behind any
  // wall in front of it.
  for (const cell of cells) {
    if (cell.knowledge === 'unknown') continue;
    const fixture = cell.fixture;
    if (fixture === undefined || fixture.token !== LAMP_FIXTURE_TOKEN) continue;

    const sx = isoX(cell.x, cell.y);
    const sy = isoY(cell.x, cell.y);
    const wallDir = adjacentWallDirection(cell.x, cell.y, familyAt);

    if (wallDir) {
      const rect = atlas.torchWall;
      const fw = FIXTURE_WALL_WIDTH * scale;
      const fh = fw * (rect.h / rect.w);
      // Screen offset of the backing wall's centre from this cell, scaled down so the torch sits
      // against the wall face without leaving the cell.
      const ox = isoX(wallDir.x, wallDir.y) - sx;
      const oy = isoY(wallDir.x, wallDir.y) - sy;
      const cx = sx + ox * FIXTURE_WALL_OFFSET;
      const cy = sy + oy * FIXTURE_WALL_OFFSET;
      placed.push({
        x: cell.x,
        y: cell.y,
        rect,
        dx: cx - fw / 2,
        dy: cy - fh,
        dw: fw,
        dh: fh,
      });
    } else {
      const rect = atlas.torch;
      const fw = FIXTURE_POST_WIDTH * scale;
      const fh = fw * (rect.h / rect.w);
      // Freestanding post: foot at the cell centre so it stands in the middle of the diamond.
      placed.push({
        x: cell.x,
        y: cell.y,
        rect,
        dx: sx - fw / 2,
        dy: sy - fh,
        dw: fw,
        dh: fh,
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
 * A key that changes iff the bake would change: the floor id folded with every known cell's
 * `(index, token)` pair (in cell order), then the sorted occlusion-stub set. Knowledge tier
 * (`remembered` vs `visible`) never enters the fold -- fog changes every step and the bake must not.
 * The occlusion set DOES enter it, because the hero-proximity stubs are baked: folding the exact set
 * (not the raw hero position) rebuilds only on steps where the stub set actually changes -- most
 * steps beside a wall, none in an open room. FNV-1a, same mix as `tile-skinning.ts`'s `cellSeed`.
 */
export function bakeKey(
  cells: readonly ObservableCell[],
  floorId: string,
  occluded: ReadonlySet<number> = new Set(),
): string {
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
  for (const index of [...occluded].sort((a, b) => a - b)) mix(`#${index}`);

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
