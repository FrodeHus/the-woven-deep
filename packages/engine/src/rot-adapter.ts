import { Path, RNG } from 'rot-js';
import type { Point } from './model.js';

export function rotAStarPath(input: Readonly<{
  topology: 4 | 8;
  origin: Point;
  destination: Point;
  isPassable: (x: number, y: number) => boolean;
}>): readonly Point[] | null {
  const points: Point[] = [];
  const path = new Path.AStar(
    input.destination.x,
    input.destination.y,
    input.isPassable,
    { topology: input.topology },
  );
  path.compute(input.origin.x, input.origin.y, (x, y) => { points.push({ x, y }); });
  return points.length === 0 ? null : points;
}

export function withRotSeed<T>(seed: number, operation: () => T): T {
  if (!Number.isInteger(seed) || seed <= 0 || seed > 0xffff_ffff) {
    throw new RangeError('ROT seed must be a nonzero unsigned 32-bit integer');
  }

  const previous = [...RNG.getState()] as ReturnType<typeof RNG.getState>;
  try {
    RNG.setSeed(seed);
    return operation();
  } finally {
    RNG.setState(previous);
  }
}
