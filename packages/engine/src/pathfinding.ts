import type { Point } from './model.js';
import { rotAStarPath } from './rot-adapter.js';

export interface PathRequest {
  readonly width: number;
  readonly height: number;
  readonly topology: 4 | 8;
  readonly origin: Point;
  readonly destination: Point;
  readonly isPassable: (x: number, y: number) => boolean;
}

export type PathStepSelection =
  | Readonly<{ status: 'move'; step: Point; diagnostic: null }>
  | Readonly<{
      status: 'hold';
      step: null;
      diagnostic: Readonly<{ code: 'population.path-unavailable' }>;
    }>;

export function selectPathStep(path: readonly Point[] | null): PathStepSelection {
  const step = path?.[0];
  return step === undefined
    ? { status: 'hold', step: null, diagnostic: { code: 'population.path-unavailable' } }
    : { status: 'move', step: { x: step.x, y: step.y }, diagnostic: null };
}

function validDimension(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function findPath(input: PathRequest): readonly Point[] | null {
  if (!validDimension(input.width) || !validDimension(input.height)) {
    throw new RangeError('path dimensions must be positive safe integers');
  }
  const inside = (point: Point) =>
    Number.isSafeInteger(point.x) &&
    Number.isSafeInteger(point.y) &&
    point.x >= 0 &&
    point.y >= 0 &&
    point.x < input.width &&
    point.y < input.height;
  if (!inside(input.origin) || !inside(input.destination))
    throw new RangeError('path endpoint is outside the grid');
  const passable = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < input.width && y < input.height && input.isPassable(x, y);
  if (
    !passable(input.origin.x, input.origin.y) ||
    !passable(input.destination.x, input.destination.y)
  )
    return null;
  if (input.origin.x === input.destination.x && input.origin.y === input.destination.y) return [];
  const directions =
    input.topology === 4
      ? ([
          [0, -1],
          [1, 0],
          [0, 1],
          [-1, 0],
        ] as const)
      : ([
          [0, -1],
          [1, 0],
          [0, 1],
          [-1, 0],
          [1, -1],
          [1, 1],
          [-1, 1],
          [-1, -1],
        ] as const);
  let selected: readonly Point[] | null = null;
  for (const [dx, dy] of directions) {
    const first = { x: input.origin.x + dx, y: input.origin.y + dy };
    if (!passable(first.x, first.y)) continue;
    if (
      dx !== 0 &&
      dy !== 0 &&
      !passable(input.origin.x + dx, input.origin.y) &&
      !passable(input.origin.x, input.origin.y + dy)
    )
      continue;
    const remainder = rotAStarPath({
      topology: input.topology,
      origin: first,
      destination: input.destination,
      isPassable: (x, y) => (x !== input.origin.x || y !== input.origin.y) && passable(x, y),
    });
    if (remainder === null) continue;
    const candidate = remainder.map((point) => ({ x: point.x, y: point.y }));
    if (selected === null || candidate.length < selected.length) selected = candidate;
  }
  return selected;
}
