import type { ItemContentEntry } from '@woven-deep/content';
import { describe, expect, it } from 'vitest';
import { itemKnownFacts } from './item-facts.js';

function entry(overrides: Partial<ItemContentEntry>): ItemContentEntry {
  return {
    kind: 'item',
    id: 'item.test',
    name: 'Test',
    glyph: '*',
    color: '#ffffff',
    tags: [],
    category: 'misc',
    stackLimit: 1,
    price: 45,
    rarity: 'common',
    heirloomEligible: true,
    minDepth: 1,
    maxDepth: 20,
    actionCost: 100,
    modifiers: {},
    equipment: null,
    combat: null,
    light: null,
    artifact: null,
    identification: { mode: 'known', poolId: null },
    effects: [],
    ...overrides,
  } as ItemContentEntry;
}

describe('itemKnownFacts intrinsic modifiers', () => {
  it('reveals each intrinsic modifier as a signed labelled row', () => {
    const facts = itemKnownFacts(entry({ modifiers: { weaveRegen: 1 } }));
    expect(facts).toContainEqual({ label: 'Weave regen', value: '+1' });
  });

  it('lists modifiers in DERIVED_STAT_NAMES order, before Worth', () => {
    const facts = itemKnownFacts(entry({ modifiers: { search: 2, maxWeave: 3 } }));
    const labels = facts.map((fact) => fact.label);
    expect(labels).toEqual(['Max weave', 'Search', 'Worth']);
  });

  it('adds no rows for an item with no intrinsic modifiers', () => {
    expect(itemKnownFacts(entry({}))).toEqual([{ label: 'Worth', value: '45' }]);
  });
});
