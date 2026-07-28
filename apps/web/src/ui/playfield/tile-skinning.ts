import type { ObservableCell } from '@woven-deep/engine';

export type TileFamily =
  | 'floor'
  | 'floor-dirty'
  | 'wall'
  | 'wall-rounded'
  | 'wall-weave'
  | 'door'
  | 'pillar'
  | 'pillar-broken'
  | 'stairs'
  | 'town-floor'
  | 'town-wall'
  | 'town-door'
  | 'void';

export interface TileSkin {
  family: TileFamily;
  variant: number;
}

/** Atlas family array lengths (`atlas-unified.json` via `atlas.ts`), duplicated here as literal
 * constants rather than imported so this pure WFC pass stays decoupled from atlas loading. The
 * measured (auto-sliced) sheet ships 7 floor and 7 dirt variants, 6 wall cubes, and a single
 * Weave-conduit wall. */
const FLOORS_LEN = 7;
const DIRTY_LEN = 7;
const WALLS_LEN = 6;
const WEAVE_LEN = 1;
const TOWN_FLOORS_LEN = 2;
const TOWN_WALLS_LEN = 2;

/** Dungeon floor dirt scatter rate: 1-in-`DIRTY_RATE` cells seed dirt before neighbour
 * propagation. Higher is calmer. */
const DIRTY_RATE = 8;
// `rounded` addresses 8 topology slots (NE/SE/SW/NW=0-3, endcaps=4-5, lone=6-7); every branch below
// picks a literal in that range so no length constant is needed for modulo. The sheet supplies 7
// boulder pieces, so `atlas-unified.json` duplicates the last into slot 7 to fill the 8th lone slot.

/** Closed set of engine terrain tokens (`TILE_DEFINITIONS`, `packages/engine/src/terrain.ts`).
 * Both stair tiles (up/down) share `terrain.stair` and, for now, the same sprite family. Any
 * other non-empty token is a new engine tile this module hasn't been taught about yet -- fail
 * loud instead of silently guessing `floor`. */
export function familyForToken(token: string | undefined): TileFamily {
  switch (token) {
    case undefined:
    case 'terrain.void':
      return 'void';
    case 'terrain.wall':
      return 'wall';
    case 'terrain.floor':
      return 'floor';
    case 'terrain.door':
      return 'door';
    case 'terrain.pillar':
      return 'pillar';
    case 'terrain.stair':
      return 'stairs';
    default:
      throw new Error(`tile-skinning: unrecognized terrain token "${token}"`);
  }
}

/** Deterministic 32-bit hash: FNV-1a over `floorId`, then xor-mixed with the cell coordinates via
 * large odd primes. Folding the floorId in means two floors never collapse to an identical skin
 * layout. Never `Math.random` -- determinism (byte-identical replay) is the point of this whole
 * module. */
export function cellSeed(floorId: string, x: number, y: number): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < floorId.length; index += 1) {
    hash ^= floorId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash = hash >>> 0;
  return (hash ^ (x * 73856093) ^ (y * 19349663)) >>> 0;
}

function isOpenFamily(family: TileFamily): boolean {
  return family !== 'wall' && family !== 'void';
}

/**
 * Skins an entire floor deterministically from its engine cells: no `Math.random`, no clock,
 * same `(cells, width, height, floorId)` always yields the same `TileSkin[]` (parallel to
 * `cells`, same order). Two passes:
 *  1. Resolve every cell's base terrain family from its token (fails loud on an unknown token).
 *  2. Walk the grid in y-major order (top-to-bottom, left-to-right) resolving the final skin:
 *     wall shape from open-neighbor topology, floor dirt clustering from already-resolved
 *     north/west neighbors -- both keyed off `cellSeed`, never off scan-order-independent state.
 */
export function skinFloor(
  cells: readonly ObservableCell[],
  width: number,
  height: number,
  floorId: string,
  town: boolean,
): readonly TileSkin[] {
  const size = width * height;
  const baseFamily: TileFamily[] = Array.from({ length: size }, (): TileFamily => 'void');

  for (const cell of cells) {
    const gridIndex = cell.y * width + cell.x;
    baseFamily[gridIndex] = familyForToken(cell.token);
  }

  const resolved: (TileSkin | undefined)[] = Array.from(
    { length: size },
    (): TileSkin | undefined => undefined,
  );

  const familyAt = (x: number, y: number): TileFamily => {
    if (x < 0 || x >= width || y < 0 || y >= height) return 'void';
    return baseFamily[y * width + x]!;
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const gridIndex = y * width + x;
      const family = baseFamily[gridIndex]!;
      const seed = cellSeed(floorId, x, y);

      if (town) {
        // The town is masonry of a different material: cobbles never wear dirty, and its timber
        // walls have no rounded-boulder or Weave-conduit shapes, so town cells skip the dungeon
        // topology entirely and alternate coherently between the two town variants by seed.
        if (family === 'wall') {
          resolved[gridIndex] = { family: 'town-wall', variant: seed % TOWN_WALLS_LEN };
        } else if (family === 'floor') {
          resolved[gridIndex] = { family: 'town-floor', variant: seed % TOWN_FLOORS_LEN };
        } else if (family === 'door') {
          resolved[gridIndex] = { family: 'town-door', variant: 0 };
        } else if (family === 'stairs') {
          // The dungeon entrance renders the same descending stair-well as dungeon floors (user
          // decision); `entranceSurround` is demoted to the reserved atlas tier.
          resolved[gridIndex] = { family: 'stairs', variant: 0 };
        } else {
          resolved[gridIndex] = { family, variant: 0 };
        }
        continue;
      }

      if (family === 'wall') {
        resolved[gridIndex] = resolveWallSkin(seed, x, y, familyAt);
        continue;
      }

      if (family === 'floor') {
        const north = resolved[y > 0 ? gridIndex - width : -1];
        const west = resolved[x > 0 ? gridIndex - 1 : -1];
        const northDirty = north?.family === 'floor-dirty';
        const westDirty = west?.family === 'floor-dirty';
        const seedDirty = seed % DIRTY_RATE === 0;
        // The propagation coin reads a high bit (`>>> 8`), decoupled from the low bits the
        // rule-1 seed test consumes: a coin on the low bits stays correlated with which cells
        // qualify to propagate at all, which can make this clause effectively dead. Reading a
        // higher bit breaks that coupling so propagation can actually fire on real floors.
        const neighborPropagatedDirty = northDirty && westDirty && (seed >>> 8) % 2 === 0;
        const isDirty = seedDirty || neighborPropagatedDirty;
        resolved[gridIndex] = isDirty
          ? { family: 'floor-dirty', variant: seed % DIRTY_LEN }
          : { family: 'floor', variant: seed % FLOORS_LEN };
        continue;
      }

      // door, pillar, stairs, void: single atlas rect per family, no seeded variance.
      resolved[gridIndex] = { family, variant: 0 };
    }
  }

  return cells.map((cell) => {
    const gridIndex = cell.y * width + cell.x;
    const skin = resolved[gridIndex];
    if (!skin) throw new Error(`tile-skinning: unresolved cell at (${cell.x}, ${cell.y})`);
    return skin;
  });
}

function resolveWallSkin(
  seed: number,
  x: number,
  y: number,
  familyAt: (x: number, y: number) => TileFamily,
): TileSkin {
  const north = isOpenFamily(familyAt(x, y - 1));
  const south = isOpenFamily(familyAt(x, y + 1));
  const east = isOpenFamily(familyAt(x + 1, y));
  const west = isOpenFamily(familyAt(x - 1, y));
  const openCount = [north, south, east, west].filter(Boolean).length;

  if (openCount <= 1) {
    if (seed % 9 === 0) return { family: 'wall-weave', variant: seed % WEAVE_LEN };
    return { family: 'wall', variant: seed % WALLS_LEN };
  }

  if (openCount === 2) {
    if (north && east) return { family: 'wall-rounded', variant: 0 }; // NE
    if (south && east) return { family: 'wall-rounded', variant: 1 }; // SE
    if (south && west) return { family: 'wall-rounded', variant: 2 }; // SW
    if (north && west) return { family: 'wall-rounded', variant: 3 }; // NW
    // Opposite pair (north&south, or east&west): a straight through-cut, not a corner.
    return { family: 'wall-rounded', variant: north ? 4 : 5 };
  }

  if (openCount === 3) {
    // One side stays closed; orient the endcap by axis of the closed side.
    const closedIsVertical = !north || !south;
    return { family: 'wall-rounded', variant: closedIsVertical ? 4 : 5 };
  }

  // openCount === 4: an isolated wall cell with no orientation to prefer -- seed picks a variant.
  return { family: 'wall-rounded', variant: 6 + (seed % 2) };
}
