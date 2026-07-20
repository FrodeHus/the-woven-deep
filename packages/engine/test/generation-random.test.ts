import { describe, expect, it } from 'vitest';
import {
  allocateFloorSeed,
  deriveAttemptSeed,
  deriveRngStreams,
  type Uint32State,
} from '../src/index.js';

describe('generation random states', () => {
  it('allocates one floor seed from exactly four xoshiro steps', () => {
    const generation = [1, 2, 3, 4] as const;
    expect(allocateFloorSeed(generation)).toEqual({
      floorSeed: [11_520, 0, 5_927_040, 70_819_200],
      nextGenerationState: [27_274_249, 25_704_967, 31_982_592, 12_605_441],
    });
    expect(generation).toEqual([1, 2, 3, 4]);
  });

  it('does not mutate caller-owned named run streams', () => {
    const streams = deriveRngStreams([10, 20, 30, 40]);
    const before = structuredClone(streams);
    allocateFloorSeed(streams.generation);
    expect(streams).toEqual(before);
  });

  it('derives stable, distinct nonzero attempt states', () => {
    const seed = [11_520, 0, 5_927_040, 70_819_200] as const;
    expect(deriveAttemptSeed(seed, 0)).toEqual([
      3_695_093_596, 1_050_304_191, 2_863_447_750, 3_493_573_262,
    ]);
    expect(deriveAttemptSeed(seed, 0)).toEqual(deriveAttemptSeed(seed, 0));
    const attempts = Array.from({ length: 8 }, (_, attempt) => deriveAttemptSeed(seed, attempt));
    expect(new Set(attempts.map((state) => state.join(','))).size).toBe(8);
    expect(attempts.every((state) => state.some((word) => word !== 0))).toBe(true);
  });

  it('rejects invalid source states and unsafe attempt numbers', () => {
    expect(() => allocateFloorSeed([0, 0, 0, 0])).toThrow();
    expect(() => deriveAttemptSeed([0, 0, 0, 0], 0)).toThrow();
    for (const attempt of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => deriveAttemptSeed([1, 2, 3, 4] as Uint32State, attempt)).toThrow();
    }
  });
});
