import { describe, expect, it } from 'vitest';
import { analyzeConnectivity, type TileId } from '../src/index.js';

const grid = (lines: readonly string[]): { width: number; height: number; tiles: TileId[] } => ({
  width: lines[0]!.length,
  height: lines.length,
  tiles: lines.flatMap((line) => [...line].map((cell) => ({ '#': 0, '.': 1, '+': 2 }[cell]! as TileId))),
});

describe('four-way topology connectivity', () => {
  it('traverses north, east, south, west and reconstructs a deterministic shortest route', () => {
    const input = grid(['#####', '#...#', '#.#.#', '#...#', '#####']);
    const result = analyzeConnectivity({ ...input, start: { x: 1, y: 3 }, target: { x: 3, y: 1 } });
    expect(result.componentSize).toBe(8);
    expect(result.distance).toBe(4);
    expect(result.route).toEqual([
      { x: 1, y: 3 }, { x: 1, y: 2 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 },
    ]);
  });

  it('counts closed doors as potential paths and detects every component', () => {
    const connected = analyzeConnectivity({ ...grid(['#####', '#.+.#', '#####']), start: { x: 1, y: 1 } });
    expect(connected.componentSize).toBe(3);
    expect(connected.traversableCellCount).toBe(3);
    expect(connected.connected).toBe(true);

    const split = analyzeConnectivity({ ...grid(['#####', '#.#.#', '#####']), start: { x: 1, y: 1 } });
    expect(split.connected).toBe(false);
  });

  it('rejects diagonal-only contact', () => {
    const result = analyzeConnectivity({ ...grid(['####', '#.##', '##.#', '####']), start: { x: 1, y: 1 } });
    expect(result.componentSize).toBe(1);
    expect(result.traversableCellCount).toBe(2);
    expect(result.connected).toBe(false);
  });
});
