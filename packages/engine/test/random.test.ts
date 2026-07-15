import { describe, expect, it } from 'vitest';
import {
  deriveRngStreams,
  expandLegacySeed,
  nextUint32,
  type Uint32State,
} from '../src/index.js';

describe('xoshiro128**', () => {
  it('rejects the forbidden all-zero state at the public step boundary', () => {
    expect(() => nextUint32([0, 0, 0, 0])).toThrow(/invariant/i);
  });

  it('matches the published project vector without mutating input', () => {
    const initial = [1, 2, 3, 4] as const;
    const first = nextUint32(initial);
    const second = nextUint32(first.state);
    expect(first.value).toBe(11_520);
    expect(first.state).toEqual([7, 0, 1026, 12_288]);
    expect(second.value).toBe(0);
    expect(initial).toEqual([1, 2, 3, 4]);
  });

  it('expands the same legacy seed identically', () => {
    expect(expandLegacySeed(0x12345678)).toEqual([
      2986037511, 744488920, 2204577711, 2810942300,
    ]);
  });

  it('derives isolated named streams', () => {
    const seed = [1, 2, 3, 4] as Uint32State;
    const left = deriveRngStreams(seed);
    const right = deriveRngStreams(seed);
    expect(left).toEqual(right);
    expect(new Set(Object.values(left).map((state) => state.join(','))).size).toBe(10);
    const advancedCombat = nextUint32(left.combat).state;
    expect(advancedCombat).not.toEqual(left.combat);
    expect(left.generation).toEqual(right.generation);
    expect(left['population-gates']).toEqual(right['population-gates']);
  });

  it('never emits the forbidden all-zero derived state across representative seeds', () => {
    for (let seed = 0; seed < 1_000; seed += 1) {
      for (const state of Object.values(deriveRngStreams(expandLegacySeed(seed)))) {
        expect(state.some((word) => word !== 0)).toBe(true);
      }
    }
  });
});
