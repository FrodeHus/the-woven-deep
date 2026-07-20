import { describe, expect, it } from 'vitest';

import { TILE_DEFINITIONS } from '../src/terrain.js';
import { computeFieldOfView, isVisible } from '../src/visibility.js';
import type { TileId } from '../src/model.js';

interface Point {
  readonly x: number;
  readonly y: number;
}

const openFloor = (width: number, height: number): TileId[] =>
  Array.from({ length: width * height }, () => 1 as TileId);
const index = (width: number, x: number, y: number): number => y * width + x;

function visibleCoordinates(words: readonly number[], width: number, height: number): Point[] {
  const result: Point[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (isVisible(words, index(width, x, y))) result.push({ x, y });
    }
  }
  return result;
}

describe('field of view', () => {
  it('shows a blocker but not the cell directly behind it', () => {
    const tiles = openFloor(7, 7);
    tiles[index(7, 3, 2)] = 0;
    const visible = computeFieldOfView({
      width: 7,
      height: 7,
      tiles,
      origin: { x: 3, y: 3 },
      radius: 4,
    });
    expect(isVisible(visible, index(7, 3, 2))).toBe(true);
    expect(isVisible(visible, index(7, 3, 1))).toBe(false);
  });

  it('blocks a diagonal between two orthogonal walls', () => {
    const tiles = openFloor(4, 4);
    tiles[index(4, 2, 1)] = 0;
    tiles[index(4, 1, 2)] = 0;
    const visible = computeFieldOfView({
      width: 4,
      height: 4,
      tiles,
      origin: { x: 1, y: 1 },
      radius: 3,
    });
    expect(isVisible(visible, index(4, 2, 2))).toBe(false);
  });

  it('returns the complete sealed-corner fixture in row-major order', () => {
    const tiles = openFloor(4, 4);
    tiles[index(4, 2, 1)] = 0;
    tiles[index(4, 1, 2)] = 0;

    const visible = computeFieldOfView({
      width: 4,
      height: 4,
      tiles,
      origin: { x: 1, y: 1 },
      radius: 3,
    });

    expect(visibleCoordinates(visible, 4, 4)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 0, y: 2 },
      { x: 1, y: 2 },
      { x: 3, y: 2 },
      { x: 0, y: 3 },
      { x: 2, y: 3 },
    ]);
  });

  it('allows a diagonal when only one orthogonal side is blocked', () => {
    const tiles = openFloor(4, 4);
    tiles[index(4, 2, 1)] = 0;
    const visible = computeFieldOfView({
      width: 4,
      height: 4,
      tiles,
      origin: { x: 1, y: 1 },
      radius: 3,
    });
    expect(isVisible(visible, index(4, 2, 2))).toBe(true);
  });

  it('is symmetric when endpoints are reversed', () => {
    const tiles = openFloor(7, 7);
    tiles[index(7, 3, 2)] = 0;
    const canSee = (from: Point, to: Point): boolean =>
      isVisible(
        computeFieldOfView({ width: 7, height: 7, tiles, origin: from, radius: 7 }),
        index(7, to.x, to.y),
      );
    expect(canSee({ x: 1, y: 1 }, { x: 5, y: 4 })).toBe(canSee({ x: 5, y: 4 }, { x: 1, y: 1 }));
  });

  it('uses a circular radius and includes its origin', () => {
    const tiles = openFloor(7, 7);
    const visible = computeFieldOfView({
      width: 7,
      height: 7,
      tiles,
      origin: { x: 3, y: 3 },
      radius: 3,
    });
    expect(isVisible(visible, index(7, 3, 3))).toBe(true);
    expect(isVisible(visible, index(7, 6, 3))).toBe(true);
    expect(isVisible(visible, index(7, 6, 6))).toBe(false);
  });

  it('returns packed words with zeroed padding bits', () => {
    const visible = computeFieldOfView({
      width: 7,
      height: 7,
      tiles: openFloor(7, 7),
      origin: { x: 3, y: 3 },
      radius: 7,
    });

    expect(visible).toHaveLength(2);
    expect(visible[1]! >>> 17).toBe(0);
  });

  it.each([
    {
      label: 'zero width',
      input: { width: 0, height: 2, tiles: [] as TileId[], origin: { x: 0, y: 0 }, radius: 1 },
    },
    {
      label: 'fractional height',
      input: { width: 2, height: 1.5, tiles: openFloor(2, 2), origin: { x: 0, y: 0 }, radius: 1 },
    },
    {
      label: 'out-of-bounds origin',
      input: { width: 2, height: 2, tiles: openFloor(2, 2), origin: { x: 2, y: 0 }, radius: 1 },
    },
    {
      label: 'fractional origin',
      input: { width: 2, height: 2, tiles: openFloor(2, 2), origin: { x: 0.5, y: 0 }, radius: 1 },
    },
    {
      label: 'negative radius',
      input: { width: 2, height: 2, tiles: openFloor(2, 2), origin: { x: 0, y: 0 }, radius: -1 },
    },
    {
      label: 'fractional radius',
      input: { width: 2, height: 2, tiles: openFloor(2, 2), origin: { x: 0, y: 0 }, radius: 1.5 },
    },
    {
      label: 'wrong tile length',
      input: { width: 2, height: 2, tiles: openFloor(3, 1), origin: { x: 0, y: 0 }, radius: 1 },
    },
  ])('rejects $label', ({ input }) => {
    expect(() => computeFieldOfView(input)).toThrow();
  });

  it('rejects an invalid tile ID', () => {
    const tiles = openFloor(2, 2);
    tiles[2] = (Math.max(...TILE_DEFINITIONS.map((definition) => definition.id)) + 1) as TileId;

    expect(() =>
      computeFieldOfView({ width: 2, height: 2, tiles, origin: { x: 0, y: 0 }, radius: 1 }),
    ).toThrow(new TypeError('tile 2 must be a valid tile ID'));
  });

  it('accepts every tile ID published by the terrain registry', () => {
    const tiles = TILE_DEFINITIONS.map((definition) => definition.id);

    expect(() =>
      computeFieldOfView({
        width: tiles.length,
        height: 1,
        tiles,
        origin: { x: 0, y: 0 },
        radius: tiles.length,
      }),
    ).not.toThrow();
  });

  it('rejects sparse tile input', () => {
    const tiles = Array<TileId>(4);
    tiles[0] = 1;
    tiles[1] = 1;
    tiles[3] = 1;

    expect(() =>
      computeFieldOfView({ width: 2, height: 2, tiles, origin: { x: 0, y: 0 }, radius: 1 }),
    ).toThrow(new TypeError('tile 2 must be a valid tile ID'));
  });
});

describe('packed visibility lookup', () => {
  it('reads a set bit', () => {
    expect(isVisible([0b100], 2)).toBe(true);
    expect(isVisible([0b100], 1)).toBe(false);
  });

  it.each([-1, 1.5, 32])('rejects invalid index %s', (bitIndex) => {
    expect(() => isVisible([0], bitIndex)).toThrow(RangeError);
  });

  it('rejects malformed and sparse words', () => {
    expect(() => isVisible([0x1_0000_0000], 0)).toThrow(TypeError);
    const sparse = Array<number>(1);
    expect(() => isVisible(sparse, 0)).toThrow(TypeError);
  });
});
