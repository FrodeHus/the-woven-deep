import { describe, expect, it } from 'vitest';
import type { ObservableCell } from '@woven-deep/engine';
import { cellSeed, familyForToken, skinFloor } from './tile-skinning.js';

function cell(
  x: number,
  y: number,
  token: string | undefined,
  overrides: Partial<ObservableCell> = {},
): ObservableCell {
  return {
    index: 0,
    x,
    y,
    knowledge: 'visible',
    token,
    intensity: 1,
    ...overrides,
  } as ObservableCell;
}

function grid(
  width: number,
  height: number,
  tokenAt: (x: number, y: number) => string,
): ObservableCell[] {
  const cells: ObservableCell[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      cells.push(cell(x, y, tokenAt(x, y)));
    }
  }
  return cells;
}

describe('familyForToken', () => {
  it('maps every known terrain token', () => {
    expect(familyForToken('terrain.wall')).toBe('wall');
    expect(familyForToken('terrain.floor')).toBe('floor');
    expect(familyForToken('terrain.door')).toBe('door');
    expect(familyForToken('terrain.pillar')).toBe('pillar');
    expect(familyForToken('terrain.stair')).toBe('stairs');
    expect(familyForToken('terrain.void')).toBe('void');
    expect(familyForToken(undefined)).toBe('void');
  });

  it('throws on an unrecognized non-empty token', () => {
    expect(() => familyForToken('terrain.lava')).toThrow();
  });
});

describe('cellSeed', () => {
  it('is deterministic for the same inputs', () => {
    expect(cellSeed('floor-1', 3, 4)).toBe(cellSeed('floor-1', 3, 4));
  });

  it('differs across floorId', () => {
    expect(cellSeed('floor-1', 3, 4)).not.toBe(cellSeed('floor-2', 3, 4));
  });

  it('returns a 32-bit unsigned integer', () => {
    const seed = cellSeed('floor-1', 3, 4);
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(0xffffffff);
  });
});

describe('skinFloor determinism', () => {
  it('produces deeply equal output for the same inputs twice', () => {
    const width = 6;
    const height = 6;
    const cells = grid(width, height, (x, y) =>
      x === 0 || y === 0 || x === width - 1 || y === height - 1 ? 'terrain.wall' : 'terrain.floor',
    );
    const first = skinFloor(cells, width, height, 'floor-alpha', false);
    const second = skinFloor(cells, width, height, 'floor-alpha', false);
    expect(second).toStrictEqual(first);
  });

  it('differs somewhere when the floorId differs', () => {
    const width = 6;
    const height = 6;
    const cells = grid(width, height, (x, y) =>
      x === 0 || y === 0 || x === width - 1 || y === height - 1 ? 'terrain.wall' : 'terrain.floor',
    );
    const a = skinFloor(cells, width, height, 'floor-alpha', false);
    const b = skinFloor(cells, width, height, 'floor-beta', false);
    expect(a).not.toStrictEqual(b);
  });
});

describe('skinFloor wall topology', () => {
  it('skins a lone wall cell surrounded by floor as wall-rounded variant 6 or 7', () => {
    const width = 3;
    const height = 3;
    const cells = grid(width, height, (x, y) =>
      x === 1 && y === 1 ? 'terrain.wall' : 'terrain.floor',
    );
    const skins = skinFloor(cells, width, height, 'floor-lone', false);
    const index = 1 * width + 1;
    expect(skins[index]!.family).toBe('wall-rounded');
    expect([6, 7]).toContain(skins[index]!.variant);
  });

  it('skins a wall in a straight run with one open side as plain wall', () => {
    // 3x3: middle row is a wall run except the center cell has floor to its north only.
    const width = 3;
    const height = 3;
    const cells = grid(width, height, (x, y) => {
      if (y === 1) return 'terrain.wall';
      if (x === 1 && y === 0) return 'terrain.floor';
      return 'terrain.wall';
    });
    const skins = skinFloor(cells, width, height, 'floor-straight-2', false);
    const index = 1 * width + 1;
    expect(skins[index]!.family).toBe('wall');
  });
});

describe('skinFloor unknown tokens', () => {
  it('throws when an unrecognized token appears in the floor', () => {
    const width = 2;
    const height = 1;
    const cells = [cell(0, 0, 'terrain.floor'), cell(1, 0, 'terrain.lava')];
    expect(() => skinFloor(cells, width, height, 'floor-bad', false)).toThrow();
  });
});

describe('skinFloor floor dirty clustering', () => {
  // The propagation coin (`(cellSeed >>> 8) % 2 === 0`) is deliberately read from a high bit,
  // decoupled from the rule-1 seed test (`cellSeed % 8 === 0`) that consumes the low bits: a coin
  // on the low bits stays correlated with which cells qualify to propagate, which can make
  // propagation effectively dead. Reading `>>> 8` breaks that coupling, so this floor ("dirt-a")
  // was picked because it actually exercises propagation end-to-end at the tuned rate.
  it('collapses seed-dirty cells, propagates dirt to qualifying neighbors, and never leaves a dirty cell unexplained by either rule', () => {
    const width = 10;
    const height = 10;
    const cells = grid(width, height, () => 'terrain.floor');
    const floorId = 'dirt-a';
    const skins = skinFloor(cells, width, height, floorId, false);

    const isDirty = (x: number, y: number): boolean =>
      skins[y * width + x]!.family === 'floor-dirty';
    const isSeedDirty = (x: number, y: number): boolean => cellSeed(floorId, x, y) % 8 === 0;

    let sawSeedDirty = false;
    let sawNeighborPropagated = false;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (!isDirty(x, y)) continue;
        const seedDirty = isSeedDirty(x, y);
        const north = y > 0 && isDirty(x, y - 1);
        const west = x > 0 && isDirty(x - 1, y);
        const neighborPropagated = north && west && (cellSeed(floorId, x, y) >>> 8) % 2 === 0;
        // Every dirty cell must trace back to one of the two spec'd rules -- no third,
        // unseeded mechanism is allowed to mark a cell dirty.
        expect(seedDirty || neighborPropagated).toBe(true);
        if (seedDirty) sawSeedDirty = true;
        if (!seedDirty && neighborPropagated) sawNeighborPropagated = true;
      }
    }
    expect(sawSeedDirty).toBe(true);
    expect(sawNeighborPropagated).toBe(true);
  });
});

describe('skinFloor town', () => {
  it('skins town floors from the town-floor family only -- never dirty -- alternating both cobbles', () => {
    const width = 8;
    const height = 8;
    const cells = grid(width, height, () => 'terrain.floor');
    const skins = skinFloor(cells, width, height, 'town-plaza', true);
    const variants = new Set<number>();
    for (const skin of skins) {
      expect(skin.family).toBe('town-floor');
      expect(skin.variant).toBeLessThan(2);
      variants.add(skin.variant);
    }
    // Both cobble variants appear across the plaza (coherent alternation, not a single tile).
    expect(variants).toEqual(new Set([0, 1]));
  });

  it('skins every town wall as a plain town-wall -- no rounded boulder for a lone wall', () => {
    const width = 3;
    const height = 3;
    // A lone wall in floor resolves to a rounded boulder in the dungeon; in town it stays a wall.
    const cells = grid(width, height, (x, y) =>
      x === 1 && y === 1 ? 'terrain.wall' : 'terrain.floor',
    );
    const skins = skinFloor(cells, width, height, 'town-walls', true);
    const center = skins[1 * width + 1]!;
    expect(center.family).toBe('town-wall');
    expect(center.variant).toBeLessThan(2);
  });

  it('skins town doors to the town-door family and the dungeon entrance to the stair well', () => {
    const cells = [cell(0, 0, 'terrain.door'), cell(1, 0, 'terrain.stair', { tileId: 5 })];
    const skins = skinFloor(cells, 2, 1, 'town-fixtures', true);
    expect(skins[0]!.family).toBe('town-door');
    // User decision: the town entrance renders the descending stair well, not the arch surround.
    expect(skins[1]!.family).toBe('stairs');
  });

  it('is unchanged from dungeon skinning shape when town is false (no town families leak)', () => {
    const width = 4;
    const height = 4;
    const cells = grid(width, height, (x, y) =>
      x === 0 || y === 0 || x === width - 1 || y === height - 1 ? 'terrain.wall' : 'terrain.floor',
    );
    const skins = skinFloor(cells, width, height, 'dungeon', false);
    for (const skin of skins) {
      expect(skin.family.startsWith('town-')).toBe(false);
    }
  });
});
