import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  compileContentDirectory,
  type CompiledContentPack,
  type ItemContentEntry,
  type MerchantEncounterContentEntry,
  type NpcFactionContentEntry,
} from '@woven-deep/content/compiler';
import {
  changeReputation,
  createDemoRun,
  ensureFactionReputation,
  factionReputation,
  guaranteedUniqueItemIds,
  merchantAcceptsItem,
  quoteMerchantPurchase,
  quoteMerchantSale,
  quoteMerchantService,
  reputationTier,
  type ActiveRun,
  type ItemInstance,
} from '../src/index.js';

let content: CompiledContentPack;
let faction: NpcFactionContentEntry;
let encounter: MerchantEncounterContentEntry;
let sword: ItemContentEntry;
let ring: ItemContentEntry;

beforeAll(async () => {
  content = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
  faction = content.entries.find((entry): entry is NpcFactionContentEntry => entry.kind === 'npc-faction')!;
  encounter = content.entries.find((entry): entry is MerchantEncounterContentEntry =>
    entry.kind === 'encounter' && entry.model === 'merchant' && !entry.definition.permanent)!;
  sword = content.entries.find((entry): entry is ItemContentEntry =>
    entry.kind === 'item' && entry.id === 'item.iron-sword')!;
  ring = content.entries.find((entry): entry is ItemContentEntry =>
    entry.kind === 'item' && entry.id === 'item.etched-ring')!;
});

function runWithReputations(reputations: ActiveRun['reputations']): ActiveRun {
  return { ...createDemoRun(), reputations };
}

function backpackItem(definition: ItemContentEntry, overrides: Partial<ItemInstance> = {}): ItemInstance {
  return {
    itemId: 'item.commerce-test', contentId: definition.id, quantity: 1, condition: 100,
    enchantment: null, identified: true, charges: null, fuel: null, enabled: null,
    location: { type: 'backpack', actorId: 'hero.demo' }, ...overrides,
  };
}

describe('merchant price quotes', () => {
  it('rounds purchases up, sales down, and services up with exact integer arithmetic', () => {
    expect(quoteMerchantPurchase({ basePrice: 3, merchantBps: 12500, factionBps: 11000 })).toBe(5);
    expect(quoteMerchantSale({ basePrice: 3, merchantBps: 5000, factionBps: 9000 })).toBe(1);
    expect(quoteMerchantService({ basePrice: 3, factionBps: 11000 })).toBe(4);
  });

  it('keeps exact quotes when the product divides evenly', () => {
    expect(quoteMerchantPurchase({ basePrice: 4, merchantBps: 12500, factionBps: 10000 })).toBe(5);
    expect(quoteMerchantSale({ basePrice: 4, merchantBps: 12500, factionBps: 10000 })).toBe(5);
    expect(quoteMerchantService({ basePrice: 4, factionBps: 15000 })).toBe(6);
  });

  it('allows a zero sale price but clamps positive purchases and services to at least one', () => {
    expect(quoteMerchantSale({ basePrice: 1, merchantBps: 5000, factionBps: 1000 })).toBe(0);
    expect(quoteMerchantPurchase({ basePrice: 1, merchantBps: 1, factionBps: 1 })).toBe(1);
    expect(quoteMerchantService({ basePrice: 1, factionBps: 1 })).toBe(1);
  });

  it('quotes zero only for a zero product', () => {
    expect(quoteMerchantPurchase({ basePrice: 0, merchantBps: 12500, factionBps: 11000 })).toBe(0);
    expect(quoteMerchantPurchase({ basePrice: 3, merchantBps: 0, factionBps: 11000 })).toBe(0);
    expect(quoteMerchantSale({ basePrice: 0, merchantBps: 5000, factionBps: 9000 })).toBe(0);
    expect(quoteMerchantService({ basePrice: 0, factionBps: 11000 })).toBe(0);
  });

  it('rejects negative, noninteger, and unsafe inputs before arithmetic', () => {
    for (const invalid of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(() => quoteMerchantPurchase({ basePrice: invalid, merchantBps: 12500, factionBps: 11000 })).toThrow(RangeError);
      expect(() => quoteMerchantPurchase({ basePrice: 3, merchantBps: invalid, factionBps: 11000 })).toThrow(RangeError);
      expect(() => quoteMerchantPurchase({ basePrice: 3, merchantBps: 12500, factionBps: invalid })).toThrow(RangeError);
      expect(() => quoteMerchantSale({ basePrice: invalid, merchantBps: 5000, factionBps: 9000 })).toThrow(RangeError);
      expect(() => quoteMerchantService({ basePrice: invalid, factionBps: 11000 })).toThrow(RangeError);
      expect(() => quoteMerchantService({ basePrice: 3, factionBps: invalid })).toThrow(RangeError);
    }
  });

  it('rejects overflowing basis-point products instead of using floating point', () => {
    expect(() => quoteMerchantPurchase({
      basePrice: Number.MAX_SAFE_INTEGER, merchantBps: 10000, factionBps: 10000,
    })).toThrow(RangeError);
    expect(() => quoteMerchantSale({
      basePrice: Number.MAX_SAFE_INTEGER, merchantBps: 10000, factionBps: 10000,
    })).toThrow(RangeError);
    expect(() => quoteMerchantService({ basePrice: Number.MAX_SAFE_INTEGER, factionBps: 10000 })).toThrow(RangeError);
  });
});

describe('faction reputation', () => {
  it('reads the authored starting value while no record exists', () => {
    expect(factionReputation(runWithReputations([]), faction)).toBe(faction.startingReputation);
    expect(factionReputation(runWithReputations([{ factionId: faction.id, value: 77 }]), faction)).toBe(77);
  });

  it('materializes the starting value once with sorted insertion', () => {
    const run = runWithReputations([
      { factionId: 'npc-faction.aaa', value: 5 },
      { factionId: 'npc-faction.zzz', value: -5 },
    ]);
    const ensured = ensureFactionReputation(run, faction);
    expect(ensured.reputations).toEqual([
      { factionId: 'npc-faction.aaa', value: 5 },
      { factionId: faction.id, value: faction.startingReputation },
      { factionId: 'npc-faction.zzz', value: -5 },
    ]);
    expect(run.reputations).toHaveLength(2);
    expect(ensureFactionReputation(ensured, faction)).toBe(ensured);
  });

  it('selects tiers by inclusive boundaries', () => {
    expect(reputationTier(-251, faction).tierId).toBe('refused');
    expect(reputationTier(-250, faction).tierId).toBe('wary');
    expect(reputationTier(-1, faction).tierId).toBe('wary');
    expect(reputationTier(0, faction).tierId).toBe('neutral');
    expect(reputationTier(249, faction).tierId).toBe('neutral');
    expect(reputationTier(250, faction).tierId).toBe('trusted');
    expect(reputationTier(faction.maximumReputation, faction).tierId).toBe('trusted');
    expect(() => reputationTier(faction.maximumReputation + 1, faction)).toThrow(RangeError);
  });

  it('starts a missing record from the authored starting value and emits exact deltas', () => {
    const run = runWithReputations([]);
    const changed = changeReputation({ run, faction, delta: 25, reason: 'commerce', eventId: 'event.commerce-1' });
    expect(changed.event).toEqual({
      type: 'reputation.changed', eventId: 'event.commerce-1', factionId: faction.id,
      previous: faction.startingReputation, delta: 25, value: faction.startingReputation + 25, reason: 'commerce',
    });
    expect(changed.state.reputations).toEqual([{ factionId: faction.id, value: faction.startingReputation + 25 }]);
    expect(run.reputations).toEqual([]);
  });

  it('clamps to the faction maximum and minimum while reporting the requested delta', () => {
    const atMaximum = runWithReputations([{ factionId: faction.id, value: faction.maximumReputation }]);
    const raised = changeReputation({ run: atMaximum, faction, delta: 50, reason: 'commerce', eventId: 'event.commerce-2' });
    expect(raised.event.value).toBe(faction.maximumReputation);
    expect(raised.event).toMatchObject({ previous: faction.maximumReputation, delta: 50, reason: 'commerce' });
    expect(raised.state.reputations).toEqual([{ factionId: faction.id, value: faction.maximumReputation }]);

    const nearMinimum = runWithReputations([{ factionId: faction.id, value: faction.minimumReputation + 10 }]);
    const lowered = changeReputation({ run: nearMinimum, faction, delta: -300, reason: 'death', eventId: 'event.death-1' });
    expect(lowered.event).toMatchObject({
      previous: faction.minimumReputation + 10, delta: -300, value: faction.minimumReputation, reason: 'death',
    });
    expect(lowered.state.reputations).toEqual([{ factionId: faction.id, value: faction.minimumReputation }]);
  });

  it('keeps changed records sorted by code-unit faction identifier', () => {
    const run = runWithReputations([
      { factionId: 'npc-faction.aaa', value: 1 },
      { factionId: 'npc-faction.zzz', value: 2 },
    ]);
    const changed = changeReputation({ run, faction, delta: -10, reason: 'aggression', eventId: 'event.aggression-1' });
    expect(changed.state.reputations.map((entry) => entry.factionId)).toEqual([
      'npc-faction.aaa', faction.id, 'npc-faction.zzz',
    ]);
  });

  it('rejects noninteger and overflowing deltas without partial mutation', () => {
    const boundless = { ...faction, minimumReputation: Number.MIN_SAFE_INTEGER, maximumReputation: Number.MAX_SAFE_INTEGER };
    const run = runWithReputations([{ factionId: faction.id, value: Number.MAX_SAFE_INTEGER }]);
    for (const delta of [0.5, Number.NaN, 2 ** 53, 1]) {
      expect(() => changeReputation({ run, faction: boundless, delta, reason: 'commerce', eventId: 'event.overflow' }))
        .toThrow(RangeError);
    }
    expect(run.reputations).toEqual([{ factionId: faction.id, value: Number.MAX_SAFE_INTEGER }]);
  });

  it('never mutates the incoming run state', () => {
    const run = runWithReputations([{ factionId: faction.id, value: 100 }]);
    const snapshot = structuredClone(run);
    ensureFactionReputation(run, faction);
    changeReputation({ run, faction, delta: 25, reason: 'commerce', eventId: 'event.immutable' });
    expect(run).toEqual(snapshot);
  });
});

describe('merchant item acceptance', () => {
  it('accepts a backpack-owned, positively priced item in an accepted category', () => {
    expect(merchantAcceptsItem(backpackItem(sword), sword, encounter, new Set())).toBe(true);
  });

  it('requires backpack ownership at command time', () => {
    const onFloor = backpackItem(sword, { location: { type: 'floor', floorId: 'floor.demo', x: 1, y: 1 } });
    const inStock = backpackItem(sword, { location: { type: 'merchant-stock', populationId: 'population.merchant' } });
    expect(merchantAcceptsItem(onFloor, sword, encounter, new Set())).toBe(false);
    expect(merchantAcceptsItem(inStock, sword, encounter, new Set())).toBe(false);
  });

  it('rejects nonpositive prices and unaccepted categories', () => {
    expect(merchantAcceptsItem(backpackItem(sword), { ...sword, price: 0 }, encounter, new Set())).toBe(false);
    expect(encounter.definition.acceptedCategories).not.toContain(ring.category);
    expect(merchantAcceptsItem(backpackItem(ring), ring, encounter, new Set())).toBe(false);
  });

  it('rejects protected content tags and heirloom metadata', () => {
    for (const tag of ['heirloom', 'quest', 'objective', 'nontransferable']) {
      expect(merchantAcceptsItem(backpackItem(sword), { ...sword, tags: [...sword.tags, tag] }, encounter, new Set()))
        .toBe(false);
    }
    const heirloom = backpackItem(sword, { heirloom: {
      displayName: 'Ada’s Blade', glyph: '/', color: '#c2c6c8',
      originatingHallRecordId: 'hall.record-1', originatingRank: 1, sourceItemId: null,
    } });
    expect(merchantAcceptsItem(heirloom, sword, encounter, new Set())).toBe(false);
  });

  it('rejects boss-guaranteed unique items derived from authored encounters', () => {
    const uniqueIds = guaranteedUniqueItemIds(content);
    expect(uniqueIds.has('item.warden-ember')).toBe(true);
    expect(merchantAcceptsItem(backpackItem(sword), sword, encounter, uniqueIds)).toBe(true);
    expect(merchantAcceptsItem(backpackItem(sword), sword, encounter, new Set([sword.id]))).toBe(false);
  });

  it('rejects a definition that does not match the item instance', () => {
    expect(() => merchantAcceptsItem(backpackItem(sword), ring, encounter, new Set())).toThrow(/does not match/);
  });
});
