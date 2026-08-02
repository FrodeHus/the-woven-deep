import { describe, expect, it } from 'vitest';
import type { ObservableCell } from '@woven-deep/engine';
import { doorWallAxis, withImpliedDoorFrames } from './door-frames.js';

const WIDTH = 5;
const HEIGHT = 5;

function cell(
  x: number,
  y: number,
  token: string | undefined,
  overrides: Partial<ObservableCell> = {},
): ObservableCell {
  return {
    index: y * WIDTH + x,
    x,
    y,
    knowledge: token === undefined ? 'unknown' : 'visible',
    token,
    intensity: token === undefined ? 0 : 200,
    ...overrides,
  } as ObservableCell;
}

function grid(
  tokenAt: (x: number, y: number) => string | undefined,
  overridesAt: (x: number, y: number) => Partial<ObservableCell> = () => ({}),
): ObservableCell[] {
  const cells: ObservableCell[] = [];
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      cells.push(cell(x, y, tokenAt(x, y), overridesAt(x, y)));
    }
  }
  return cells;
}

function at(cells: readonly ObservableCell[], x: number, y: number): ObservableCell {
  const found = cells.find((candidate) => candidate.x === x && candidate.y === y);
  if (found === undefined) throw new Error(`no cell at (${x}, ${y})`);
  return found;
}

/** A door at (2,2) seen down a north-south corridor: the corridor cells are known, the two cells
 * flanking the doorway east and west are still undiscovered. */
function corridorDoorFloor(doorOverrides: Partial<ObservableCell> = {}): readonly ObservableCell[] {
  return grid(
    (x, y) => {
      if (x === 2 && y === 2) return 'terrain.door';
      if (x === 2) return 'terrain.floor';
      return undefined;
    },
    (x, y) => (x === 2 && y === 2 ? doorOverrides : {}),
  );
}

describe('withImpliedDoorFrames', () => {
  it('renders wall mass at the undiscovered cells flanking a visible door', () => {
    const framed = withImpliedDoorFrames(corridorDoorFloor(), WIDTH, HEIGHT);

    for (const [x, y] of [
      [1, 2],
      [3, 2],
    ] as const) {
      const flank = at(framed, x, y);
      expect(flank.token).toBe('terrain.wall');
      expect(flank.knowledge).toBe('visible');
      expect(flank.intensity).toBe(200);
      expect(flank.index).toBe(y * WIDTH + x);
    }
  });

  it('carries the door cell tint onto its implied frame', () => {
    const framed = withImpliedDoorFrames(corridorDoorFloor({ tint: [10, 20, 30] }), WIDTH, HEIGHT);

    expect(at(framed, 1, 2).tint).toEqual([10, 20, 30]);
  });

  it('dims the frame with a remembered door', () => {
    const framed = withImpliedDoorFrames(
      corridorDoorFloor({ knowledge: 'remembered', intensity: 24 }),
      WIDTH,
      HEIGHT,
    );

    expect(at(framed, 3, 2).knowledge).toBe('remembered');
    expect(at(framed, 3, 2).intensity).toBe(24);
  });

  it('leaves a floor whose door flanks are already discovered untouched', () => {
    const cells = grid((x, y) => {
      if (x === 2 && y === 2) return 'terrain.door';
      if (x === 2) return 'terrain.floor';
      if ((x === 1 || x === 3) && y === 2) return 'terrain.wall';
      return undefined;
    });

    expect(withImpliedDoorFrames(cells, WIDTH, HEIGHT)).toBe(cells);
  });

  it('leaves an undiscovered door alone', () => {
    const cells = grid((x, y) => (x === 2 && y !== 2 ? 'terrain.floor' : undefined));

    expect(withImpliedDoorFrames(cells, WIDTH, HEIGHT)).toBe(cells);
  });

  it('invents nothing around non-door terrain', () => {
    const cells = grid((x, y) => (x === 2 && y >= 1 && y <= 3 ? 'terrain.floor' : undefined));

    expect(withImpliedDoorFrames(cells, WIDTH, HEIGHT)).toBe(cells);
  });

  it('invents nothing when the passage axis is ambiguous', () => {
    const cells = grid((x, y) => {
      if (x === 2 && y === 2) return 'terrain.door';
      if (x === 2 && y === 1) return 'terrain.floor';
      if (x === 1 && y === 2) return 'terrain.floor';
      return undefined;
    });

    expect(withImpliedDoorFrames(cells, WIDTH, HEIGHT)).toBe(cells);
  });

  it('frames a door on the horizontal passage axis', () => {
    const cells = grid((x, y) => {
      if (x === 2 && y === 2) return 'terrain.door';
      if (y === 2) return 'terrain.floor';
      return undefined;
    });

    const framed = withImpliedDoorFrames(cells, WIDTH, HEIGHT);
    expect(at(framed, 2, 1).token).toBe('terrain.wall');
    expect(at(framed, 2, 3).token).toBe('terrain.wall');
  });

  it('keeps the projection cell order and count', () => {
    const framed = withImpliedDoorFrames(corridorDoorFloor(), WIDTH, HEIGHT);

    expect(framed).toHaveLength(WIDTH * HEIGHT);
    expect(framed.map((entry) => entry.index)).toEqual(
      Array.from({ length: WIDTH * HEIGHT }, (_unused, index) => index),
    );
  });
});

describe('doorWallAxis', () => {
  /** A `cellAt`-shaped lookup over a plain array, exactly the shape `IsoRenderer` builds from its
   * own `cellByKey` map -- the same lookup contract `doorWallAxis` consumes. */
  function lookup(
    cells: readonly ObservableCell[],
  ): (x: number, y: number) => ObservableCell | undefined {
    return (x, y) => cells.find((candidate) => candidate.x === x && candidate.y === y);
  }

  it('reports a horizontal wall axis for a door on a north-south passage (flanked east/west)', () => {
    const cells = corridorDoorFloor();
    expect(doorWallAxis(lookup(cells), 2, 2)).toBe('horizontal');
  });

  it('reports a vertical wall axis for a door on an east-west passage (flanked north/south)', () => {
    const cells = grid((x, y) => {
      if (x === 2 && y === 2) return 'terrain.door';
      if (y === 2) return 'terrain.floor';
      return undefined;
    });
    expect(doorWallAxis(lookup(cells), 2, 2)).toBe('vertical');
  });

  it('returns null when the passage axis is ambiguous (passage on both axes)', () => {
    const cells = grid((x, y) => {
      if (x === 2 && y === 2) return 'terrain.door';
      if (x === 2 && y === 1) return 'terrain.floor';
      if (x === 1 && y === 2) return 'terrain.floor';
      return undefined;
    });
    expect(doorWallAxis(lookup(cells), 2, 2)).toBeNull();
  });

  it('returns null when neither axis has known passage (both flanks still unknown)', () => {
    const cells = grid((x, y) => (x === 2 && y === 2 ? 'terrain.door' : undefined));
    expect(doorWallAxis(lookup(cells), 2, 2)).toBeNull();
  });
});
