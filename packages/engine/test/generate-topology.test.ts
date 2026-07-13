import { readFileSync } from 'node:fs';
import { Map, RNG } from 'rot-js';
import { describe, expect, it, vi } from 'vitest';
import {
  analyzeConnectivity,
  createClassicTheme,
  expandLegacySeed,
  generateTopology,
  maskHas,
  stableJson,
  type GenerateTopologyRequest,
} from '../src/index.js';

const ambient = { color: [32, 40, 48] as const, strength: 3 };
const request = (seed = [1, 2, 3, 4] as const, width = 80, height = 25): GenerateTopologyRequest => ({
  floorId: 'floor.test', floorSeed: seed, depth: 1, width, height,
  theme: createClassicTheme(width, height, { ambient }),
});

function assertValid(draft: ReturnType<typeof generateTopology>): void {
  expect(draft.tiles).toHaveLength(draft.width * draft.height);
  expect(draft.tiles.every((tile) => Number.isInteger(tile) && tile >= 0 && tile <= 6)).toBe(true);
  expect(draft.tiles[draft.stairUp.y * draft.width + draft.stairUp.x]).toBe(4);
  expect(draft.tiles[draft.stairDown.y * draft.width + draft.stairDown.x]).toBe(5);
  expect(draft.stairUp).not.toEqual(draft.stairDown);
  const connectivity = analyzeConnectivity({
    width: draft.width, height: draft.height, tiles: draft.tiles,
    start: draft.stairUp, target: draft.stairDown,
  });
  expect(connectivity.connected).toBe(true);
  expect(connectivity.distance).toBe(draft.report.stairDistance);
  draft.tiles.forEach((tile, index) => {
    if ([1, 2, 4, 5].includes(tile)) {
      expect(maskHas(request(draft.floorSeed, draft.width, draft.height).theme.maskWords, draft.width, index % draft.width, Math.floor(index / draft.width))).toBe(true);
    }
  });
}

describe('classic topology generation', () => {
  it('matches the independently inspected seed-1 topology snapshot', () => {
    const expected = readFileSync(new URL('./fixtures/classic-topology-seed-1.json', import.meta.url), 'utf8').trimEnd();
    expect(stableJson(generateTopology(request()))).toBe(expected);
  });

  it('produces stable connected rooms, corridors, and distant stairs without mutating inputs or ROT state', () => {
    const input = request();
    const before = stableJson(input);
    const rotBefore = [...RNG.getState()];
    const first = generateTopology(input);
    const second = generateTopology(input);
    assertValid(first);
    expect(first.rooms.length).toBeGreaterThanOrEqual(6);
    expect(first.corridors.length).toBeGreaterThan(0);
    expect(first.report.stairDistance).toBeGreaterThanOrEqual(20);
    expect(stableJson(first)).toBe(stableJson(second));
    expect(stableJson(input)).toBe(before);
    expect(RNG.getState()).toEqual(rotBefore);
  });

  it('succeeds normally or through fallback over 200 deterministic seeds', () => {
    for (let seed = 1; seed <= 200; seed += 1) assertValid(generateTopology(request(expandLegacySeed(seed), 40, 20)));
  });

  it('uses a deterministic connected fallback with no vaults after safe rejection', () => {
    const input: GenerateTopologyRequest = {
      ...request([9, 8, 7, 6], 40, 20), attemptLimit: 1,
      topologyFactory: () => ({ ok: false, code: 'topology.empty' }),
    };
    const left = generateTopology(input);
    const right = generateTopology(input);
    assertValid(left);
    expect(left.report.fallback).toBe(true);
    expect(left.report.attempt).toBe(null);
    expect(left.report.vaults).toEqual([]);
    expect(left.report.rejectionCounts).toEqual({ 'topology.empty': 1 });
    expect(stableJson(left)).toBe(stableJson(right));
  });

  it('does not let the clock select ROT topology', () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(10);
    const first = generateTopology(request());
    now.mockReturnValue(9_999_999_999);
    const second = generateTopology(request());
    expect(stableJson(first)).toBe(stableJson(second));
    now.mockRestore();
  });

  it('rejects a malformed pinned ROT corridor shape without exposing partial topology', () => {
    const getter = vi.spyOn(Map.Digger.prototype, 'getCorridors').mockReturnValue([
      { _startX: 1, _startY: 1, _endX: Number.NaN, _endY: 2 },
    ] as never);
    const result = generateTopology({ ...request(), attemptLimit: 1 });
    expect(result.report.fallback).toBe(true);
    expect(result.report.rejectionCounts).toEqual({ 'topology.invalid-geometry': 1 });
    getter.mockRestore();
  });

  it('falls back deterministically and restores ROT state when Digger throws at the minimum dimensions', () => {
    const input = request([1, 2, 3, 4], 20, 12);
    const rotBefore = [...RNG.getState()];
    const first = generateTopology(input);
    const second = generateTopology(input);
    assertValid(first);
    expect(first.report.fallback).toBe(true);
    expect(first.report.rejectionCounts['topology.invalid-geometry']).toBeGreaterThan(0);
    expect(stableJson(first)).toBe(stableJson(second));
    expect(RNG.getState()).toEqual(rotBefore);
  });

  it.each([
    request([1, 2, 3, 4], 20, 12),
    { ...request(), width: 19 },
    { ...request(), height: 101 },
    { ...request(), attemptLimit: 0 },
    { ...request(), attemptLimit: 33 },
    { ...request(), floorSeed: [0, 0, 0, 0] as const },
  ])('rejects invalid dimensions, limits, seeds, or mismatched themes', (input) => {
    if (input.width === 20 && input.height === 12) expect(() => generateTopology(input)).not.toThrow();
    else expect(() => generateTopology(input)).toThrowError(expect.objectContaining({ code: expect.stringMatching(/^generation\./) }));
  });
});
