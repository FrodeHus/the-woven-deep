import { describe, expect, it } from 'vitest';
import type { ObservableCell } from '@woven-deep/engine';
import type { AtlasRect, PlayfieldAtlas } from './atlas.js';
import {
  bakeFloor,
  bakeKey,
  FLOOR_OVERSCAN,
  occludedWallIndices,
  planFloorBake,
  STUB_SOURCE_FRACTION,
  WALL_OVERSCAN,
  type FloorBakePlan,
} from './floor-bake.js';

// A synthetic atlas with uniform square rects keeps the geometry assertions arithmetic-clean; the
// live sheet's rects are tight measured crops (see atlas.test.ts). `x` distinguishes fixtures for
// equality assertions.
function rect(x: number, w = 128, h = 128): AtlasRect {
  return { x, y: 0, w, h };
}

function makeAtlas(): PlayfieldAtlas {
  return {
    imageUrl: 'atlas.png',
    blockDepthPx: 48,
    floors: [0, 1, 2, 3, 4, 5, 6].map((i) => rect(100 + i)),
    dirty: [0, 1, 2, 3, 4, 5, 6].map((i) => rect(200 + i)),
    walls: [0, 1, 2, 3, 4, 5].map((i) => rect(300 + i)),
    rounded: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => rect(400 + i)),
    weaveWalls: [rect(500)],
    stairs: rect(600),
    stairsUp: rect(610),
    door: rect(700),
    gate: rect(800),
    torch: rect(810),
    torchWall: rect(820),
    pillar: rect(900),
    pillarBroken: rect(950),
    townFloors: [rect(1000), rect(1001)],
    townWalls: [rect(1010), rect(1011)],
    houseDoor: rect(1020),
    entranceSurround: rect(1030),
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
    const plan = planFloorBake(cells, 3, 3, 'floor-unknown', atlas, 1, false);
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

    const visiblePlan = planFloorBake(visibleCells, 3, 3, 'floor-knowledge', atlas, 1, false);
    const rememberedPlan = planFloorBake(rememberedCells, 3, 3, 'floor-knowledge', atlas, 1, false);

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
    const plan = planFloorBake(cells, 2, 2, 'floor-order', atlas, 1, false);

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
    const plan = planFloorBake(cells, 3, 3, 'floor-buried', atlas, 1, false);

    // Only the 8 perimeter wall cells are drawn; the fully-surrounded center is buried.
    expect(plan.draws).toHaveLength(8);
  });
});

describe('planFloorBake single-rect families', () => {
  it('bakes a stair-down cell (tileId 5) using atlas.stairs', () => {
    const atlas = makeAtlas();
    const cells = grid(
      1,
      1,
      () => 'terrain.stair',
      () => ({ tileId: 5 }),
    );
    const plan = planFloorBake(cells, 1, 1, 'floor-stairs-down', atlas, 1, false);
    expect(plan.draws).toHaveLength(1);
    expect(plan.draws[0]!.rect).toEqual(atlas.stairs);
  });

  it('bakes a stair-up cell (tileId 4) using atlas.stairsUp', () => {
    const atlas = makeAtlas();
    const cells = grid(
      1,
      1,
      () => 'terrain.stair',
      () => ({ tileId: 4 }),
    );
    const plan = planFloorBake(cells, 1, 1, 'floor-stairs-up', atlas, 1, false);
    expect(plan.draws).toHaveLength(1);
    expect(plan.draws[0]!.rect).toEqual(atlas.stairsUp);
  });

  it('falls back to atlas.stairs for a stair cell with no tileId', () => {
    const atlas = makeAtlas();
    const cells = grid(1, 1, () => 'terrain.stair');
    const plan = planFloorBake(cells, 1, 1, 'floor-stairs', atlas, 1, false);
    expect(plan.draws).toHaveLength(1);
    expect(plan.draws[0]!.rect).toEqual(atlas.stairs);
  });

  it('bakes a door cell using atlas.door', () => {
    const atlas = makeAtlas();
    const cells = grid(1, 1, () => 'terrain.door');
    const plan = planFloorBake(cells, 1, 1, 'floor-door', atlas, 1, false);
    expect(plan.draws).toHaveLength(1);
    expect(plan.draws[0]!.rect).toEqual(atlas.door);
  });
});

describe('planFloorBake town families', () => {
  it('bakes town floor cells from atlas.townFloors, never the dungeon floors or dirty', () => {
    const atlas = makeAtlas();
    const cells = grid(3, 3, () => 'terrain.floor');
    const plan = planFloorBake(cells, 3, 3, 'town-floor', atlas, 1, true);
    expect(plan.draws).toHaveLength(9);
    for (const draw of plan.draws) {
      expect(atlas.townFloors).toContainEqual(draw.rect);
      expect(atlas.floors).not.toContainEqual(draw.rect);
      expect(atlas.dirty).not.toContainEqual(draw.rect);
    }
  });

  it('bakes town wall cells from atlas.townWalls, never rounded/weave dungeon shapes', () => {
    const atlas = makeAtlas();
    // A lone wall surrounded by floor would resolve to a rounded boulder in the dungeon; in town it
    // must stay a plain town wall.
    const cells = grid(3, 3, (x, y) => (x === 1 && y === 1 ? 'terrain.wall' : 'terrain.floor'));
    const plan = planFloorBake(cells, 3, 3, 'town-wall', atlas, 1, true);
    const wallDraw = plan.draws.find((draw) => atlas.townWalls.some((r) => r.x === draw.rect.x));
    expect(wallDraw).toBeDefined();
    expect(atlas.rounded).not.toContainEqual(wallDraw!.rect);
  });

  it('bakes a town door cell from atlas.houseDoor', () => {
    const atlas = makeAtlas();
    const cells = grid(1, 1, () => 'terrain.door');
    const plan = planFloorBake(cells, 1, 1, 'town-door', atlas, 1, true);
    expect(plan.draws[0]!.rect).toEqual(atlas.houseDoor);
  });

  it('bakes a town stair (entrance) cell from the stair well, not entranceSurround (user decision)', () => {
    const atlas = makeAtlas();
    const cells = grid(
      1,
      1,
      () => 'terrain.stair',
      () => ({ tileId: 5 }),
    );
    const plan = planFloorBake(cells, 1, 1, 'town-entrance', atlas, 1, true);
    expect(plan.draws[0]!.rect).toEqual(atlas.stairs);
    expect(plan.draws[0]!.rect).not.toEqual(atlas.entranceSurround);
  });

  it('leaves dungeon skinning unchanged when town is false', () => {
    const atlas = makeAtlas();
    const cells = grid(1, 1, () => 'terrain.door');
    const dungeon = planFloorBake(cells, 1, 1, 'floor-door', atlas, 1, false);
    expect(dungeon.draws[0]!.rect).toEqual(atlas.door);
  });
});

describe('planFloorBake flat floor geometry', () => {
  it('squashes a full-cell floor diamond onto the 2:1 iso footprint centred on the cell', () => {
    const atlas = makeAtlas();
    const cells = grid(1, 1, () => 'terrain.floor');
    const plan = planFloorBake(cells, 1, 1, 'floor-flat', atlas, 1, false);
    expect(plan.draws).toHaveLength(1);
    const draw = plan.draws[0]!;
    expect(atlas.floors).toContainEqual(draw.rect);

    // Width keeps the full 64px pitch (overscanned); height is halved to the 2:1 footprint (32px)
    // rather than the square 64px, so the full-cell diamond tessellates instead of overlapping.
    expect(draw.dw).toBeCloseTo(64 * FLOOR_OVERSCAN, 5);
    expect(draw.dh).toBeCloseTo(32 * FLOOR_OVERSCAN, 5);
    // Centred on the cell (sx = 0, sy = 0 here) in both axes.
    expect(draw.dx).toBeCloseTo(plan.originX - (64 * FLOOR_OVERSCAN) / 2, 5);
    expect(draw.dy).toBeCloseTo(plan.originY - (32 * FLOOR_OVERSCAN) / 2, 5);
  });
});

describe('planFloorBake tile anchoring', () => {
  it('centres a flat tile diamond on the cell and overscans it about that centre', () => {
    const atlas = makeAtlas();
    // A pillar is a flat (non-wall) tile with a predictable full-cell rect, so its draw geometry is
    // fully determined -- unlike a floor variant, whose rect is hash-chosen.
    const cells = grid(1, 1, () => 'terrain.pillar');
    const plan = planFloorBake(cells, 1, 1, 'floor-anchor', atlas, 1, false);
    expect(plan.draws).toHaveLength(1);
    const draw = plan.draws[0]!;

    // Overscanned in both axes (aspect preserved: the 128x128 cell rect stays square at 64px).
    expect(draw.dw).toBeCloseTo(64 * FLOOR_OVERSCAN, 5);
    expect(draw.dh).toBeCloseTo(64 * FLOOR_OVERSCAN, 5);
    // Horizontally centred on the cell (sx = 0 here): left edge is half the overscanned width in.
    expect(draw.dx).toBeCloseTo(plan.originX - (64 * FLOOR_OVERSCAN) / 2, 5);
    // Diamond-centre-anchored: (rect.h - blockDepthPx - rect.w/4) * spriteScale = (128-48-32)*0.5
    // = 24 above the cell centre, then scaled about that centre by the overscan.
    expect(draw.dy).toBeCloseTo(plan.originY - 24 * FLOOR_OVERSCAN, 5);
  });

  it('widens a wall tile horizontally by WALL_OVERSCAN while keeping its foot-anchored height', () => {
    const atlas = makeAtlas();
    const cells = grid(1, 1, () => 'terrain.wall');
    const plan = planFloorBake(cells, 1, 1, 'floor-wall-anchor', atlas, 1, false);
    expect(plan.draws).toHaveLength(1);
    const draw = plan.draws[0]!;

    // Width overscanned; height left at the full-cell 128->64 mapping (walls rise, they don't fatten).
    expect(draw.dw).toBeCloseTo(64 * WALL_OVERSCAN, 5);
    expect(draw.dh).toBeCloseTo(64, 5);
    // Still centred on the cell horizontally (sx = 0).
    expect(draw.dx).toBeCloseTo(plan.originX - (64 * WALL_OVERSCAN) / 2, 5);
    // Foot-anchored: the crop's bottom edge rests on the cell floor-diamond bottom corner
    // (floorHalfDh = 16 below the cell centre), independent of blockDepthPx.
    expect(draw.dy + draw.dh).toBeCloseTo(plan.originY + 16, 5);
  });

  it('stands a measured wall cube above its own floor plane (real 120x144 crop, depth 80)', () => {
    // The live sheet's plain-wall crops are 120x144 with blockDepthPx=80 (see atlas-unified.json).
    // A wall must render as a raised cube: foot on the cell floor, top edge well above the floor
    // diamond's top corner. Anchoring by the crop foot is what makes the whole body overpaint the
    // cell's own floor instead of sinking below the plane (the flat-wall regression).
    const atlas: PlayfieldAtlas = {
      ...makeAtlas(),
      blockDepthPx: 80,
      walls: [0, 1, 2, 3, 4, 5].map((i) => ({ x: i, y: 0, w: 120, h: 144 })),
    };
    const cells = grid(1, 1, () => 'terrain.wall');
    const plan = planFloorBake(cells, 1, 1, 'floor-real-wall', atlas, 1, false);
    expect(plan.draws).toHaveLength(1);
    const draw = plan.draws[0]!;

    // Cell centre is the origin (x=0,y=0 -> sx=sy=0); the plan shifts everything by originX/originY.
    const cellCentreY = plan.originY;
    const floorHalfDh = 16; // TILE_HALF_H * scale(1)
    // Height derives from the 120x144 aspect scaled onto the 64px pitch: dh = 64 * 144/120 = 76.8.
    expect(draw.dh).toBeCloseTo(64 * (144 / 120), 5);
    // Base at the cell's floor-diamond bottom corner.
    expect(draw.dy + draw.dh).toBeCloseTo(cellCentreY + floorHalfDh, 5);
    // Top edge stands MEANINGFULLY above the cell's floor-diamond top corner (cellCentre - 16):
    // the top rises dh - floorHalfDh = 60.8 above the foot, i.e. ~44.8 above the diamond top corner.
    const diamondTopY = cellCentreY - floorHalfDh;
    expect(draw.dy).toBeLessThan(diamondTopY - 20);
  });
});

describe('occludedWallIndices (dynamic hero-proximity occlusion)', () => {
  // 4x4 open floor with a single lone wall at (2,2). Its raised body covers (1,1)/(1,2)/(2,1).
  const wallAt = (x: number, y: number): string =>
    x === 2 && y === 2 ? 'terrain.wall' : 'terrain.floor';

  it('flags a wall whose body covers the hero vicinity', () => {
    const atlas = makeAtlas();
    const cells = grid(4, 4, wallAt);
    const set = occludedWallIndices(cells, 4, 4, 'occ', atlas, 1, false, { x: 1, y: 1 });
    expect([...set]).toEqual([2 * 4 + 2]); // only the (2,2) wall
  });

  it('flags nothing when the hero is nowhere behind the wall', () => {
    const atlas = makeAtlas();
    const cells = grid(4, 4, wallAt);
    const set = occludedWallIndices(cells, 4, 4, 'occ', atlas, 1, false, { x: 0, y: 3 });
    expect(set.size).toBe(0);
  });

  it('is empty when there is no hero', () => {
    const atlas = makeAtlas();
    const cells = grid(4, 4, wallAt);
    expect(occludedWallIndices(cells, 4, 4, 'occ', atlas, 1, false, undefined).size).toBe(0);
  });
});

describe('planFloorBake occlusion stub', () => {
  const wallAt = (x: number, y: number): string =>
    x === 2 && y === 2 ? 'terrain.wall' : 'terrain.floor';

  it('renders an occluded wall as a cropped bottom stub, full-height otherwise', () => {
    const atlas = makeAtlas();
    const cells = grid(4, 4, wallAt);
    const wallIndex = 2 * 4 + 2;
    const full = planFloorBake(cells, 4, 4, 'occ', atlas, 1, false);
    const stub = planFloorBake(cells, 4, 4, 'occ', atlas, 1, false, new Set([wallIndex]));
    // The lone wall skins to a rounded boulder, so its draw is the only one on a rounded rect.
    const fullWall = full.draws.find((d) => atlas.rounded.some((r) => r.x === d.rect.x))!;
    const stubWall = stub.draws.find((d) => atlas.rounded.some((r) => r.x === d.rect.x))!;
    // Stub crops the SOURCE rect to its bottom fraction and scales the dest height the same way.
    expect(stubWall.rect.h).toBeCloseTo(fullWall.rect.h * STUB_SOURCE_FRACTION, 5);
    expect(stubWall.dh).toBeCloseTo(fullWall.dh * STUB_SOURCE_FRACTION, 5);
    // Same foot anchor: the bottom edge (dy + dh) is unchanged.
    expect(stubWall.dy + stubWall.dh).toBeCloseTo(fullWall.dy + fullWall.dh, 5);
    // The source crop starts partway down the original rect (a bottom slice).
    expect(stubWall.rect.y).toBeGreaterThan(fullWall.rect.y);
  });
});

describe('bakeKey occlusion folding', () => {
  it('changes when the occlusion stub set changes, order-independently', () => {
    const cells = grid(4, 4, () => 'terrain.floor');
    expect(bakeKey(cells, 'k', new Set([5]))).not.toBe(bakeKey(cells, 'k', new Set()));
    expect(bakeKey(cells, 'k', new Set([5]))).not.toBe(bakeKey(cells, 'k', new Set([6])));
    expect(bakeKey(cells, 'k', new Set([5, 6]))).toBe(bakeKey(cells, 'k', new Set([6, 5])));
  });
});

describe('planFloorBake lamp fixtures', () => {
  const lamp = {
    lightId: 'l1',
    glyph: '*',
    token: 'fixture.lamp',
  } as unknown as NonNullable<ObservableCell['fixture']>;

  it('adds a freestanding torch post on a lamp cell with no adjacent wall', () => {
    const atlas = makeAtlas();
    const cells = grid(
      3,
      3,
      () => 'terrain.floor',
      (x, y) => (x === 1 && y === 1 ? { fixture: lamp } : {}),
    );
    const plan = planFloorBake(cells, 3, 3, 'lamp-free', atlas, 1, false);
    // 9 floors + 1 torch post.
    expect(plan.draws.filter((d) => d.rect === atlas.torch)).toHaveLength(1);
    expect(plan.draws.filter((d) => d.rect === atlas.torchWall)).toHaveLength(0);
  });

  it('mounts a wall torch when a lamp cell has an orthogonally adjacent wall', () => {
    const atlas = makeAtlas();
    // Lamp at (1,1) with a wall to the north at (1,0).
    const cells = grid(
      3,
      3,
      (x, y) => (x === 1 && y === 0 ? 'terrain.wall' : 'terrain.floor'),
      (x, y) => (x === 1 && y === 1 ? { fixture: lamp } : {}),
    );
    const plan = planFloorBake(cells, 3, 3, 'lamp-wall', atlas, 1, false);
    expect(plan.draws.filter((d) => d.rect === atlas.torchWall)).toHaveLength(1);
    expect(plan.draws.filter((d) => d.rect === atlas.torch)).toHaveLength(0);
  });

  it('emits no torch for an undiscovered lamp cell', () => {
    const atlas = makeAtlas();
    const cells = grid(
      3,
      3,
      () => 'terrain.floor',
      (x, y) => (x === 1 && y === 1 ? { fixture: lamp, knowledge: 'unknown', intensity: 0 } : {}),
    );
    const plan = planFloorBake(cells, 3, 3, 'lamp-unknown', atlas, 1, false);
    expect(
      plan.draws.filter((d) => d.rect === atlas.torch || d.rect === atlas.torchWall),
    ).toHaveLength(0);
  });
});

describe('planFloorBake canvas sizing', () => {
  it('rounds the bake canvas size up to whole pixels so a fractional scale never clips the last row/column', () => {
    const atlas = makeAtlas();
    const cells = grid(3, 3, () => 'terrain.floor');
    const plan = planFloorBake(cells, 3, 3, 'floor-ceil', atlas, 0.37, false);
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
