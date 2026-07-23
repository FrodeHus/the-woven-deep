import { describe, expect, it } from 'vitest';
import { createDemoRun, validateTarget, type TileId } from '../src/index.js';

function openFloor(width: number, height: number, walls: readonly [number, number][] = []) {
  const run = createDemoRun();
  const tiles = Array<TileId>(width * height).fill(1);
  for (const [x, y] of walls) tiles[y * width + x] = 0;
  return { ...run.floors[0]!, width, height, tiles };
}

function baseInput(floor: ReturnType<typeof openFloor>) {
  const run = createDemoRun();
  const source = { ...run.actors[0]!, x: 2, y: 2, floorId: floor.floorId };
  return {
    sourceActor: source,
    targetActorId: null,
    floor,
    actors: [source],
    // fully lit + fully visible so validatePoint's visibility/illumination gates pass
    visibilityWords: Array(Math.ceil((floor.width * floor.height) / 32)).fill(0xffffffff),
    illumination: { intensity: Array(floor.width * floor.height).fill(255) },
    range: 6,
  } as const;
}

describe('AoE cell computation', () => {
  it('burst returns every cell within Chebyshev radius of the aim cell', () => {
    const floor = openFloor(9, 9);
    const result = validateTarget({
      ...baseInput(floor),
      targetingId: 'target.burst',
      target: { x: 5, y: 5 },
      aoe: { shape: 'burst', radius: 1 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cells = new Set(result.cells.map((c) => `${c.x},${c.y}`));
    expect(cells.size).toBe(9);
    expect(cells.has('4,4')).toBe(true);
    expect(cells.has('6,6')).toBe(true);
    expect(cells.has('3,5')).toBe(false);
  });

  it('line collects cells toward the aim and stops before an opaque tile', () => {
    // Caster is fixed at (2,2) by baseInput; keep the wall/aim on the same
    // row (y=2) so the Bresenham path is a straight horizontal line and the
    // wall actually sits in that path.
    const floor = openFloor(9, 3, [[5, 2]]);
    const result = validateTarget({
      ...baseInput(floor),
      targetingId: 'target.line',
      target: { x: 8, y: 2 },
      aoe: { shape: 'line', radius: 6 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const xs = result.cells.filter((c) => c.y === 2).map((c) => c.x).sort((a, b) => a - b);
    expect(xs).toEqual([3, 4]); // stops before the wall at x=5, excludes the caster cell itself
  });

  it('cone returns a widening wedge in the aimed direction', () => {
    const floor = openFloor(11, 11);
    const result = validateTarget({
      ...baseInput(floor),
      targetingId: 'target.cone',
      target: { x: 8, y: 2 }, // due east of caster (2,2)
      aoe: { shape: 'cone', radius: 3 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cells = new Set(result.cells.map((c) => `${c.x},${c.y}`));
    expect(cells.has('3,2')).toBe(true); // depth 1 straight ahead
    expect(cells.has('5,4')).toBe(true); // depth 3 widened
    expect(cells.has('1,2')).toBe(false); // never behind the caster
  });
});
