import { describe, expect, it } from 'vitest';
import type { ObservableCell } from '@woven-deep/engine';
import type { AtlasRect, PlayfieldAtlas } from './atlas.js';
import {
  bakeFloor,
  bakeKey,
  FLOOR_OVERSCAN,
  planFloorBake,
  WALL_OVERSCAN,
  type FloorBakePlan,
} from './floor-bake.js';

function rect(x: number, w = 64, h = 32): AtlasRect {
  return { x, y: 0, w, h };
}

function makeAtlas(): PlayfieldAtlas {
  return {
    imageUrl: 'atlas.png',
    blockDepthPx: 34,
    floors: [0, 1, 2, 3, 4, 5, 6].map((i) => rect(100 + i)),
    dirty: [0, 1, 2, 3, 4, 5, 6].map((i) => rect(200 + i)),
    walls: [0, 1, 2, 3, 4, 5].map((i) => rect(300 + i, 64, 96)),
    rounded: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => rect(400 + i, 64, 96)),
    weaveWalls: [rect(500, 64, 96)],
    stairs: rect(600),
    door: rect(700),
    gate: rect(800),
    torch: rect(810, 16, 16),
    torchWall: rect(820, 16, 32),
    pillar: rect(900, 64, 64),
    pillarBroken: rect(950, 64, 64),
  };
}

function cell(
  x: number,
  y: number,
  width: number,
  token: string | undefined,
  overrides: Partial<ObservableCell> = {},
): ObservableCell {
  return {
    index: y * width + x,
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
  tokenAt: (x: number, y: number) => string | undefined,
  overridesAt: (x: number, y: number) => Partial<ObservableCell> = () => ({}),
): ObservableCell[] {
  const cells: ObservableCell[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      cells.push(cell(x, y, width, tokenAt(x, y), overridesAt(x, y)));
    }
  }
  return cells;
}

describe('planFloorBake unknown cells', () => {
  it('produces no draws for a fully unknown floor', () => {
    const atlas = makeAtlas();
    const cells = grid(
      3,
      3,
      () => undefined,
      () => ({ knowledge: 'unknown', intensity: 0 }),
    );
    const plan = planFloorBake(cells, 3, 3, 'floor-unknown', atlas, 1);
    expect(plan.draws).toHaveLength(0);
  });
});

describe('planFloorBake knowledge tiers', () => {
  it('bakes remembered and visible cells identically', () => {
    const atlas = makeAtlas();
    const tokenAt = (x: number, y: number): string =>
      x === 0 || y === 0 || x === 2 || y === 2 ? 'terrain.wall' : 'terrain.floor';

    const visibleCells = grid(3, 3, tokenAt);
    const rememberedCells = grid(3, 3, tokenAt, () => ({ knowledge: 'remembered', intensity: 24 }));

    const visiblePlan = planFloorBake(visibleCells, 3, 3, 'floor-knowledge', atlas, 1);
    const rememberedPlan = planFloorBake(rememberedCells, 3, 3, 'floor-knowledge', atlas, 1);

    expect(rememberedPlan).toStrictEqual(visiblePlan);
  });
});

describe('planFloorBake ordering', () => {
  it('orders draws back-to-front: (x + y) ascending, then x ascending', () => {
    const atlas = makeAtlas();
    const tokenAt = (x: number, y: number): string => {
      if (x === 0 && y === 0) return 'terrain.door';
      if (x === 1 && y === 0) return 'terrain.stair';
      if (x === 0 && y === 1) return 'terrain.pillar';
      return 'terrain.floor';
    };
    const cells = grid(2, 2, tokenAt);
    const plan = planFloorBake(cells, 2, 2, 'floor-order', atlas, 1);

    expect(plan.draws).toHaveLength(4);
    expect(plan.draws[0]!.rect).toEqual(atlas.door); // (0,0) sum 0
    expect(plan.draws[1]!.rect).toEqual(atlas.pillar); // (0,1) sum 1, x 0
    expect(plan.draws[2]!.rect).toEqual(atlas.stairs); // (1,0) sum 1, x 1
    expect(atlas.floors).toContainEqual(plan.draws[3]!.rect); // (1,1) sum 2, some floor variant
  });
});

describe('planFloorBake buried walls', () => {
  it('skips a wall cell with no non-wall neighbor in the 8-neighborhood', () => {
    const atlas = makeAtlas();
    const cells = grid(3, 3, () => 'terrain.wall');
    const plan = planFloorBake(cells, 3, 3, 'floor-buried', atlas, 1);

    // Only the 8 perimeter wall cells are drawn; the fully-surrounded center is buried.
    expect(plan.draws).toHaveLength(8);
  });
});

describe('planFloorBake single-rect families', () => {
  it('bakes a stairs cell using atlas.stairs', () => {
    const atlas = makeAtlas();
    const cells = grid(1, 1, () => 'terrain.stair');
    const plan = planFloorBake(cells, 1, 1, 'floor-stairs', atlas, 1);
    expect(plan.draws).toHaveLength(1);
    expect(plan.draws[0]!.rect).toEqual(atlas.stairs);
  });

  it('bakes a door cell using atlas.door', () => {
    const atlas = makeAtlas();
    const cells = grid(1, 1, () => 'terrain.door');
    const plan = planFloorBake(cells, 1, 1, 'floor-door', atlas, 1);
    expect(plan.draws).toHaveLength(1);
    expect(plan.draws[0]!.rect).toEqual(atlas.door);
  });
});

describe('planFloorBake tile anchoring', () => {
  it('top-anchors a flat tile at the cell diamond apex and overscans it about the cell centre', () => {
    const atlas = makeAtlas();
    // A pillar is a flat (non-wall) tile with a predictable 64x64 rect, so its draw geometry is
    // fully determined -- unlike a floor variant, whose rect is hash-chosen.
    const cells = grid(1, 1, () => 'terrain.pillar');
    const plan = planFloorBake(cells, 1, 1, 'floor-anchor', atlas, 1);
    expect(plan.draws).toHaveLength(1);
    const draw = plan.draws[0]!;

    // Overscanned in both axes (aspect preserved: the 64x64 pillar rect stays square).
    expect(draw.dw).toBeCloseTo(64 * FLOOR_OVERSCAN, 5);
    expect(draw.dh).toBeCloseTo(64 * FLOOR_OVERSCAN, 5);
    // Horizontally centred on the cell (sx = 0 here): left edge is half the overscanned width in.
    expect(draw.dx).toBeCloseTo(plan.originX - (64 * FLOOR_OVERSCAN) / 2, 5);
    // Top-anchored: the diamond apex sits `TILE_HALF_H * overscan` above the cell centre -- NOT
    // half the sprite height (which is what centring a 1:1 rect would give, ~32 * overscan).
    expect(draw.dy).toBeCloseTo(plan.originY - 16 * FLOOR_OVERSCAN, 5);
  });

  it('widens a wall tile horizontally by WALL_OVERSCAN while keeping its base-anchored height', () => {
    const atlas = makeAtlas();
    const cells = grid(1, 1, () => 'terrain.wall');
    const plan = planFloorBake(cells, 1, 1, 'floor-wall-anchor', atlas, 1);
    expect(plan.draws).toHaveLength(1);
    const draw = plan.draws[0]!;

    // Width overscanned; height left at the base 64->96 mapping (walls rise, they don't fatten).
    expect(draw.dw).toBeCloseTo(64 * WALL_OVERSCAN, 5);
    expect(draw.dh).toBeCloseTo(96, 5);
    // Still centred on the cell horizontally (sx = 0).
    expect(draw.dx).toBeCloseTo(plan.originX - (64 * WALL_OVERSCAN) / 2, 5);
  });
});

describe('planFloorBake canvas sizing', () => {
  it('rounds the bake canvas size up to whole pixels so a fractional scale never clips the last row/column', () => {
    const atlas = makeAtlas();
    const cells = grid(3, 3, () => 'terrain.floor');
    const plan = planFloorBake(cells, 3, 3, 'floor-ceil', atlas, 0.37);
    expect(Number.isInteger(plan.pxWidth)).toBe(true);
    expect(Number.isInteger(plan.pxHeight)).toBe(true);
  });
});

describe('bakeFloor', () => {
  it('throws when the 2d context is unavailable, rather than uploading a silently blank floor', () => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => null,
    } as unknown as HTMLCanvasElement;
    const image = {} as CanvasImageSource;
    const plan: FloorBakePlan = { draws: [], pxWidth: 4, pxHeight: 4, originX: 0, originY: 0 };
    expect(() => bakeFloor(canvas, image, plan)).toThrow(/2d context/);
  });
});

describe('bakeKey', () => {
  it('is stable across a knowledge-only change (visible <-> remembered)', () => {
    const width = 3;
    const height = 3;
    const tokenAt = (x: number, y: number): string =>
      x === 0 || y === 0 || x === 2 || y === 2 ? 'terrain.wall' : 'terrain.floor';
    const visibleCells = grid(width, height, tokenAt);
    const rememberedCells = grid(width, height, tokenAt, () => ({
      knowledge: 'remembered',
      intensity: 24,
    }));

    expect(bakeKey(rememberedCells, 'floor-key')).toBe(bakeKey(visibleCells, 'floor-key'));
  });

  it('changes when a cell becomes newly discovered', () => {
    const width = 2;
    const undiscovered = [
      cell(0, 0, width, 'terrain.floor'),
      cell(1, 0, width, undefined, { knowledge: 'unknown', intensity: 0 }),
    ];
    const discovered = [cell(0, 0, width, 'terrain.floor'), cell(1, 0, width, 'terrain.floor')];

    expect(bakeKey(discovered, 'floor-key')).not.toBe(bakeKey(undiscovered, 'floor-key'));
  });

  it('changes when a known cell token flips (e.g. a door opening)', () => {
    const width = 1;
    const closed = [cell(0, 0, width, 'terrain.door')];
    const opened = [cell(0, 0, width, 'terrain.floor')];

    expect(bakeKey(opened, 'floor-key')).not.toBe(bakeKey(closed, 'floor-key'));
  });
});
