import { describe, expect, it } from 'vitest';
import { applyEffectResult, createDemoRun, withRngStream } from '../src/index.js';
import type { ActorState } from '../src/index.js';

describe('applyEffectResult', () => {
  it('folds actors, items, survival, and the effects rng stream, leaving other fields untouched', () => {
    const state = createDemoRun();
    const movedHero: ActorState = { ...state.actors[0]!, health: 3 };
    const resolved = {
      actors: [movedHero],
      items: [{ marker: 'item' }] as never,
      survival: { ...state.survival, hungerStage: 'hungry' as const },
      features: [{ marker: 'feature' }] as never,
      floors: [] as never,
      effectsState: [9, 9, 9, 9] as const,
      events: [],
    };

    const next = applyEffectResult(state, resolved);

    expect(next.actors).toBe(resolved.actors);
    expect(next.items).toBe(resolved.items);
    expect(next.survival).toBe(resolved.survival);
    expect(next.rng.effects).toEqual([9, 9, 9, 9]);
    expect(next.rng.combat).toEqual(state.rng.combat);
    expect(next.features).toBe(state.features);
    expect(next.floors).toBe(state.floors);
  });
});

describe('withRngStream', () => {
  it('advances only the named stream', () => {
    const state = createDemoRun();
    const next = withRngStream(state, 'loot', [1, 2, 3, 4]);
    expect(next.rng.loot).toEqual([1, 2, 3, 4]);
    expect(next.rng.effects).toEqual(state.rng.effects);
    expect(next.rng.combat).toEqual(state.rng.combat);
    expect(next.actors).toBe(state.actors);
  });
});
