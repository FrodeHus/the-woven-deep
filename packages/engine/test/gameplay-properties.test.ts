import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  advanceToNextReady, createDemoContentPack, createDemoRun, mergeStacks, selectReadyActor,
  splitStack, stableJson, type ItemInstance,
} from '../src/index.js';
import type { ItemContentEntry } from '@woven-deep/content';
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

describe('inventory conservation properties', () => {
  const definition: ItemContentEntry = {
    kind: 'item', id: 'item.property', name: 'Property item', glyph: '*', color: '#ffffff', tags: [],
    category: 'misc', stackLimit: 100, price: 1, rarity: 'common', minDepth: 0, maxDepth: 20,
    actionCost: 100, equipment: null, combat: null, light: null,
    identification: { mode: 'known', groupId: null, appearances: [] }, effects: [],
  };
  const content = (() => {
    const base = createDemoContentPack();
    return { ...base, entries: [...base.entries, definition] };
  })();

  it('conserves quantity and stable output across legal split-merge sequences', () => {
    fc.assert(fc.property(
      fc.integer({ min: 2, max: 100 }),
      fc.integer({ min: 1, max: 99 }),
      (quantity, candidateSplit) => {
        const splitQuantity = 1 + (candidateSplit % (quantity - 1));
        const instance: ItemInstance = {
          itemId: 'item.property.1', contentId: definition.id, quantity, condition: 100,
          enchantment: null, identified: true, charges: null, fuel: null, enabled: null,
          location: { type: 'backpack', actorId: 'hero.demo' },
        };
        const run = { ...createDemoRun(), items: [instance] };
        const before = stableJson(run);
        const first = splitStack({
          run, content, actorId: 'hero.demo', itemId: instance.itemId,
          quantity: splitQuantity, newItemId: 'item.property.2',
        });
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        expect(first.items.reduce((sum, item) => sum + item.quantity, 0)).toBe(quantity);
        const second = mergeStacks({
          run: first.run, content, actorId: 'hero.demo',
          leftItemId: 'item.property.1', rightItemId: 'item.property.2',
        });
        expect(second.ok).toBe(true);
        if (!second.ok) return;
        expect(second.items).toEqual([instance]);
        expect(stableJson(run)).toBe(before);
        expect(stableJson(splitStack({
          run, content, actorId: 'hero.demo', itemId: instance.itemId,
          quantity: splitQuantity, newItemId: 'item.property.2',
        }))).toBe(stableJson(first));
      },
    ), { seed: 0x4a04, numRuns: 500 });
  });
});
