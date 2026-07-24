import { describe, expect, it } from 'vitest';
import type { Point } from '../src/index.js';
import { bresenhamLine, burstCells, coneCells, lineCells } from '../src/aoe-geometry.js';

/** In-bounds for a `w x h` grid whose origin is (0,0). */
function boundsOf(w: number, h: number) {
  return (p: Point): boolean => p.x >= 0 && p.y >= 0 && p.x < w && p.y < h;
}

/** Opaque when the point is out of the `w x h` grid OR is one of `walls`. Mirrors the engine
 * contract: out-of-bounds reads as opaque so `lineCells` stops at the edge. */
function opacityOf(w: number, h: number, walls: readonly [number, number][]) {
  const wallSet = new Set(walls.map(([x, y]) => `${x},${y}`));
  return (p: Point): boolean =>
    p.x < 0 || p.y < 0 || p.x >= w || p.y >= h || wallSet.has(`${p.x},${p.y}`);
}

function keys(cells: readonly Point[]): Set<string> {
  return new Set(cells.map((c) => `${c.x},${c.y}`));
}

describe('burstCells', () => {
  it('returns every in-bounds cell within Chebyshev radius of the center', () => {
    const cells = burstCells({ x: 5, y: 5 }, 1, { inBounds: boundsOf(9, 9) });
    const set = keys(cells);
    expect(set.size).toBe(9);
    expect(set.has('4,4')).toBe(true);
    expect(set.has('6,6')).toBe(true);
    expect(set.has('3,5')).toBe(false);
  });

  it('drops out-of-bounds cells at the map edge', () => {
    const cells = burstCells({ x: 0, y: 0 }, 1, { inBounds: boundsOf(9, 9) });
    expect(keys(cells)).toEqual(new Set(['0,0', '1,0', '0,1', '1,1']));
  });
});

describe('lineCells', () => {
  it('collects cells toward the aim and stops before an opaque tile, excluding the origin', () => {
    const cells = lineCells({ x: 2, y: 2 }, { x: 8, y: 2 }, 6, {
      isOpaque: opacityOf(9, 3, [[5, 2]]),
    });
    const xs = cells
      .filter((c) => c.y === 2)
      .map((c) => c.x)
      .sort((a, b) => a - b);
    expect(xs).toEqual([3, 4]);
  });
});

describe('coneCells', () => {
  it('returns a widening wedge in the aimed direction', () => {
    const cells = coneCells({ x: 2, y: 2 }, { x: 8, y: 2 }, 3, { inBounds: boundsOf(11, 11) });
    const set = keys(cells);
    expect(set.has('3,2')).toBe(true); // one cell east
    expect(set.has('5,4')).toBe(true); // widened at depth 3
    expect(set.has('2,5')).toBe(false); // due south, not in an eastward cone
    expect(set.has('2,2')).toBe(false); // never includes the origin
  });
});

describe('bresenhamLine', () => {
  it('is exclusive of the start and inclusive of the end', () => {
    const cells = bresenhamLine({ x: 0, y: 0 }, { x: 3, y: 0 });
    expect(cells).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
  });
});
