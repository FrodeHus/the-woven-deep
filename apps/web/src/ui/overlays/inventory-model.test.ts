import { describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import type { HeroView } from '../../session/projection-view.js';
import {
  allMenuEntries, bucketFor, byNameStable, equippedLightMatchingFuel, matchesFilter, visibleEntries,
  type MenuEntry, type ProjectedItemLike,
} from './inventory-model.js';

function item(overrides: Readonly<Partial<ProjectedItemLike>> & Pick<ProjectedItemLike, 'itemId' | 'name' | 'category'>): ProjectedItemLike {
  return {
    quantity: 1, identified: true, condition: 100, fuel: null, enabled: null,
    ...overrides,
  };
}

function hero(
  backpack: readonly ProjectedItemLike[],
  equipment: Readonly<Record<string, ProjectedItemLike | null>> = {},
): HeroView {
  return { backpack, equipment } as unknown as HeroView;
}

describe('bucketFor', () => {
  it('groups weapon/ammunition into weapons', () => {
    expect(bucketFor('weapon')).toBe('weapons');
    expect(bucketFor('ammunition')).toBe('weapons');
  });

  it('groups armor/shield into armor', () => {
    expect(bucketFor('armor')).toBe('armor');
    expect(bucketFor('shield')).toBe('armor');
  });

  it('groups food/potion/scroll into consumables', () => {
    expect(bucketFor('food')).toBe('consumables');
    expect(bucketFor('potion')).toBe('consumables');
    expect(bucketFor('scroll')).toBe('consumables');
  });

  it('groups light/fuel into light', () => {
    expect(bucketFor('light')).toBe('light');
    expect(bucketFor('fuel')).toBe('light');
  });

  it('groups ring/misc into other', () => {
    expect(bucketFor('ring')).toBe('other');
    expect(bucketFor('misc')).toBe('other');
  });
});

describe('matchesFilter', () => {
  it('matches everything under "all"', () => {
    expect(matchesFilter(item({ itemId: 'i1', name: 'Sword', category: 'weapon' }), 'all')).toBe(true);
  });

  it('matches only items whose bucket equals the filter', () => {
    const sword = item({ itemId: 'i1', name: 'Sword', category: 'weapon' });
    expect(matchesFilter(sword, 'weapons')).toBe(true);
    expect(matchesFilter(sword, 'armor')).toBe(false);
  });
});

describe('allMenuEntries', () => {
  it('lists backpack stacks first, then equipped items in equipment key order', () => {
    const ration = item({ itemId: 'item.ration', name: 'Travel ration', category: 'food' });
    const sword = item({ itemId: 'item.sword', name: 'Iron sword', category: 'weapon' });
    const shield = item({ itemId: 'item.shield', name: 'Wooden shield', category: 'shield' });
    const entries = allMenuEntries(hero([ration], { 'main-hand': sword, 'off-hand': shield }));

    expect(entries).toEqual<readonly MenuEntry[]>([
      { item: ration, equipped: false },
      { item: sword, equipped: true, slot: 'main-hand' },
      { item: shield, equipped: true, slot: 'off-hand' },
    ]);
  });

  it('omits empty equipment slots', () => {
    const ration = item({ itemId: 'item.ration', name: 'Travel ration', category: 'food' });
    const entries = allMenuEntries(hero([ration], { 'main-hand': null }));
    expect(entries).toEqual<readonly MenuEntry[]>([{ item: ration, equipped: false }]);
  });
});

describe('byNameStable', () => {
  it('orders by plain codepoint name comparison, not localeCompare', () => {
    const apple: MenuEntry = { item: item({ itemId: 'a', name: 'Apple', category: 'food' }), equipped: false };
    const zebra: MenuEntry = { item: item({ itemId: 'z', name: 'Zebra pelt', category: 'misc' }), equipped: false };
    expect(byNameStable(apple, zebra)).toBeLessThan(0);
    expect(byNameStable(zebra, apple)).toBeGreaterThan(0);
    expect(byNameStable(apple, apple)).toBe(0);
  });
});

describe('visibleEntries', () => {
  it('filters by category bucket and preserves backpack-then-equipped order when unsorted', () => {
    const sword = item({ itemId: 'item.sword', name: 'Sword', category: 'weapon' });
    const shield = item({ itemId: 'item.shield', name: 'Shield', category: 'shield' });
    const entries = visibleEntries(hero([sword, shield]), 'weapons', false);
    expect(entries.map((entry) => entry.item.itemId)).toEqual(['item.sword']);
  });

  it('stably sorts by name when sortByName is true, ties keeping original relative order', () => {
    const zebra = item({ itemId: 'item.zebra', name: 'Zebra pelt', category: 'misc' });
    const apple = item({ itemId: 'item.apple', name: 'Apple', category: 'food' });
    const entries = visibleEntries(hero([zebra, apple]), 'all', true);
    expect(entries.map((entry) => entry.item.itemId)).toEqual(['item.apple', 'item.zebra']);
  });

  it('leaves default order untouched when sortByName is false', () => {
    const zebra = item({ itemId: 'item.zebra', name: 'Zebra pelt', category: 'misc' });
    const apple = item({ itemId: 'item.apple', name: 'Apple', category: 'food' });
    const entries = visibleEntries(hero([zebra, apple]), 'all', false);
    expect(entries.map((entry) => entry.item.itemId)).toEqual(['item.zebra', 'item.apple']);
  });
});

describe('equippedLightMatchingFuel', () => {
  function packWith(entries: readonly Record<string, unknown>[]): CompiledContentPack {
    return { entries } as unknown as CompiledContentPack;
  }

  it('returns the equipped light whose fuelTags intersect the fuel item\'s tags', () => {
    const pack = packWith([
      { id: 'item.lamp-oil', kind: 'item', tags: ['lamp-oil'] },
      { id: 'item.brass-lantern', kind: 'item', tags: [], light: { fuelTags: ['lamp-oil'] } },
    ]);
    const lantern = item({ itemId: 'item.lantern-1', contentId: 'item.brass-lantern', name: 'Brass lantern', category: 'light' });
    const oil = item({ itemId: 'item.oil-stack', contentId: 'item.lamp-oil', name: 'Lamp oil', category: 'fuel' });
    const result = equippedLightMatchingFuel(pack, hero([], { 'off-hand': lantern }), oil);
    expect(result).toBe(lantern);
  });

  it('returns undefined when no equipped light shares a fuel tag', () => {
    const pack = packWith([
      { id: 'item.lamp-oil', kind: 'item', tags: ['lamp-oil'] },
      { id: 'item.sword', kind: 'item', tags: [] },
    ]);
    const sword = item({ itemId: 'item.sword-1', contentId: 'item.sword', name: 'Iron sword', category: 'weapon' });
    const oil = item({ itemId: 'item.oil-stack', contentId: 'item.lamp-oil', name: 'Lamp oil', category: 'fuel' });
    const result = equippedLightMatchingFuel(pack, hero([], { 'main-hand': sword }), oil);
    expect(result).toBeUndefined();
  });

  it('returns undefined for an unidentified fuel item (no contentId)', () => {
    const pack = packWith([]);
    const oil = item({ itemId: 'item.oil-stack', name: 'Unknown potion', category: 'fuel' });
    const result = equippedLightMatchingFuel(pack, hero([], {}), oil);
    expect(result).toBeUndefined();
  });
});
