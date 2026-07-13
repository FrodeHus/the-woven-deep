import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  advanceToNextReady, createDemoContentPack, createDemoRun, mergeStacks, selectReadyActor,
  splitStack, stableJson, type ItemInstance, itemLightSources,
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

describe('item light properties', () => {
  it('never emits light from a backpack, empty fuel, or a disabled item', () => {
    fc.assert(fc.property(
      fc.boolean(), fc.integer({ min: 0, max: 100 }), fc.constantFrom('backpack', 'equipped', 'floor'),
      (enabled, fuel, locationType) => {
        const definition: ItemContentEntry = {
          kind: 'item', id: 'item.light-property', name: 'Property light', glyph: 'i', color: '#ffffff', tags: [],
          category: 'light', stackLimit: 1, price: 1, rarity: 'common', minDepth: 0, maxDepth: 20, actionCost: 100,
          equipment: { slots: ['off-hand'], handedness: 'one-handed', reservedSlots: [] }, combat: null,
          light: { color: [255, 255, 255], radius: 3, strength: 100, fuelCapacity: 100,
            fuelPerTime: 1, warningThresholds: [10], fuelTags: ['oil'] },
          identification: { mode: 'known', groupId: null, appearances: [] }, effects: [],
        };
        const base = createDemoRun();
        const location = locationType === 'backpack' ? { type: 'backpack' as const, actorId: 'hero.demo' }
          : locationType === 'equipped' ? { type: 'equipped' as const, actorId: 'hero.demo', slot: 'off-hand' as const }
            : { type: 'floor' as const, floorId: 'floor.demo', x: 1, y: 1 };
        const instance: ItemInstance = { itemId: 'item.light-property.1', contentId: definition.id,
          quantity: 1, condition: 100, enchantment: null, identified: true, charges: null, fuel, enabled, location };
        const content = { ...createDemoContentPack(), entries: [...createDemoContentPack().entries, definition] };
        const emitted = itemLightSources({ run: { ...base, items: [instance] }, content, floorId: 'floor.demo' });
        expect(emitted.length).toBe(enabled && fuel > 0 && locationType !== 'backpack' ? 1 : 0);
      },
    ), { seed: 0x4a05, numRuns: 500 });
  });
});
