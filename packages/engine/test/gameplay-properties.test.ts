import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { advanceToNextReady, createDemoContentPack, selectReadyActor } from '../src/index.js';
import { actor, schedulerStateArbitrary } from './arbitraries.js';

describe('gameplay scheduler properties', () => {
  it('always selects a living actor with safe integer state without mutating its input', () => {
    fc.assert(fc.property(schedulerStateArbitrary, (state) => {
      const before = structuredClone(state);
      const result = advanceToNextReady(state);
      expect(state).toEqual(before);
      expect(Number.isSafeInteger(result.worldTime)).toBe(true);
      expect(result.actors.every((candidate) => Number.isSafeInteger(candidate.energy))).toBe(true);
      expect(result.selectedActorId).not.toBeNull();
    }), { seed: 0x4a01, numRuns: 500 });
  });

  it('selects the same actor for every input order', () => {
    fc.assert(fc.property(schedulerStateArbitrary, fc.integer(), (state, offset) => {
      const pivot = Math.abs(offset) % state.actors.length;
      const permuted = [...state.actors.slice(pivot), ...state.actors.slice(0, pivot)].reverse();
      expect(selectReadyActor(permuted, state.content)?.actorId)
        .toBe(selectReadyActor(state.actors, state.content)?.actorId);
      expect(advanceToNextReady({ ...state, actors: permuted }).selectedActorId)
        .toBe(advanceToNextReady(state).selectedActorId);
    }), { seed: 0x4a02, numRuns: 500 });
  });

  it('fails deterministically when advancing world time would overflow', () => {
    fc.assert(fc.property(
      fc.integer({ min: -10_000, max: 99 }),
      fc.integer({ min: 1, max: 400 }),
      (energy, speed) => {
        const state = {
          worldTime: Number.MAX_SAFE_INTEGER,
          content: createDemoContentPack(),
          actors: [actor({ actorId: 'hero.test', playerControlled: true, health: 10, energy, speed })],
        };
        expect(() => advanceToNextReady(state)).toThrow(/worldTime.*safe integer/i);
      },
    ), { seed: 0x4a03, numRuns: 500 });
  });
});
