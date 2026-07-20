import { describe, expect, it } from 'vitest';
import { findPath, selectPathStep, stableJson } from '../src/index.js';

const key = (x: number, y: number) => `${x}:${y}`;

describe('deterministic A* path adapter', () => {
  it('uses caller-owned passability and excludes the origin from copied output', () => {
    const blocked = new Set(['2:1']);
    const input = {
      width: 5,
      height: 3,
      topology: 4 as const,
      origin: { x: 1, y: 1 },
      destination: { x: 3, y: 1 },
      isPassable: (x: number, y: number) => !blocked.has(key(x, y)),
    };
    const before = stableJson({
      blocked: [...blocked],
      origin: input.origin,
      destination: input.destination,
    });
    const path = findPath(input);
    expect(path).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 1 },
    ]);
    expect(path?.[0]).not.toBe(input.origin);
    expect(
      stableJson({ blocked: [...blocked], origin: input.origin, destination: input.destination }),
    ).toBe(before);
  });

  it('treats closed doors, occupied destinations, and unreachable goals as blocked', () => {
    const closedDoor = new Set(['2:0']);
    expect(
      findPath({
        width: 5,
        height: 1,
        topology: 4,
        origin: { x: 0, y: 0 },
        destination: { x: 4, y: 0 },
        isPassable: (x, y) => !closedDoor.has(key(x, y)),
      }),
    ).toBeNull();
    expect(
      findPath({
        width: 3,
        height: 1,
        topology: 4,
        origin: { x: 0, y: 0 },
        destination: { x: 2, y: 0 },
        isPassable: (x, y) => key(x, y) !== '2:0',
      }),
    ).toBeNull();
  });

  it('rejects diagonal movement through a corner sealed on both sides', () => {
    const blocked = new Set(['1:0', '0:1']);
    expect(
      findPath({
        width: 2,
        height: 2,
        topology: 8,
        origin: { x: 0, y: 0 },
        destination: { x: 1, y: 1 },
        isPassable: (x, y) => !blocked.has(key(x, y)),
      }),
    ).toBeNull();
  });

  it('chooses the same equal-cost route on every call and returns plain points only', () => {
    const input = {
      width: 5,
      height: 3,
      topology: 4 as const,
      origin: { x: 0, y: 1 },
      destination: { x: 4, y: 1 },
      isPassable: (x: number, y: number) => key(x, y) !== '2:1',
    };
    const first = findPath(input);
    expect(findPath(input)).toEqual(first);
    expect(first).not.toBeNull();
    for (const point of first!) {
      expect(Object.getPrototypeOf(point)).toBe(Object.prototype);
      expect(Object.keys(point).sort()).toEqual(['x', 'y']);
    }
  });

  it('falls back to hold with a stable internal diagnostic when no step is available', () => {
    expect(selectPathStep(null)).toEqual({
      status: 'hold',
      step: null,
      diagnostic: { code: 'population.path-unavailable' },
    });
    expect(selectPathStep([{ x: 2, y: 3 }])).toEqual({
      status: 'move',
      step: { x: 2, y: 3 },
      diagnostic: null,
    });
  });
});
