import { describe, expect, it } from 'vitest';
import type {
  CompiledContentPack,
  CurseContentEntry,
  EnchantmentContentEntry,
  ItemContentEntry,
} from '@woven-deep/content';
import {
  createDemoContentPack,
  hauntDropSnapshots,
  materializeDeathInventory,
  type ItemInstance,
  type RecordedHeirloomSnapshot,
  type Uint32State,
} from '../src/index.js';

const floorId = 'floor.depth-007';
const originatingHallRecordId = `record.${'3'.repeat(32)}.${'d'.repeat(16)}`;

function itemDefinition(id: string, overrides: Partial<ItemContentEntry> = {}): ItemContentEntry {
  return {
    kind: 'item',
    id,
    name: id,
    glyph: ')',
    color: '#c0c0c0',
    tags: [],
    category: 'weapon',
    stackLimit: 1,
    price: 10,
    rarity: 'rare',
    heirloomEligible: true,
    minDepth: 1,
    maxDepth: 20,
    actionCost: 100,
    equipment: { slots: ['main-hand'], handedness: 'one-handed', reservedSlots: [] },
    combat: null,
    light: null,
    artifact: null,
    identification: { mode: 'known', poolId: null },
    effects: [],
    ...overrides,
  };
}

const leadenWeight: CurseContentEntry = {
  kind: 'curse',
  id: 'curse.leaden-weight',
  name: 'Leaden Weight',
  tags: ['curse'],
  revealText: 'It grows heavier the longer you carry it.',
  drawbackModifiers: { defense: -1 },
  trigger: null,
};

const honedEnchantment: EnchantmentContentEntry = {
  kind: 'enchantment',
  id: 'enchantment.honed',
  name: 'Honed',
  tags: ['enchantment', 'weapon'],
  categories: ['weapon'],
  modifiers: { meleeDamageBonus: 2 },
  weight: 1,
};

function pack(): CompiledContentPack {
  const base = createDemoContentPack();
  return {
    ...base,
    entries: [
      ...base.entries,
      itemDefinition('item.iron-sword', { name: 'Iron sword' }),
      itemDefinition('item.leather-armor', {
        name: 'Leather armor',
        category: 'armor',
        glyph: '[',
        color: '#a08050',
        equipment: { slots: ['torso'], handedness: 'one-handed', reservedSlots: [] },
      }),
      itemDefinition('item.lantern', {
        name: 'Lantern',
        category: 'light',
        glyph: '(',
        color: '#ffd9a0',
        equipment: { slots: ['off-hand'], handedness: 'one-handed', reservedSlots: [] },
        light: {
          color: [255, 217, 160],
          radius: 6,
          strength: 160,
          fuelCapacity: 2400,
          fuelPerTime: 1,
          warningThresholds: [600],
          fuelTags: ['lamp-oil'],
        },
      }),
      itemDefinition('item.relic', {
        name: 'Bound Signet',
        category: 'ring',
        glyph: '"',
        color: '#88ddff',
        rarity: 'legendary',
        equipment: { slots: ['neck'], handedness: 'one-handed', reservedSlots: [] },
        artifact: { canon: true, signature: null, drawbackModifiers: {}, light: null },
      }),
      itemDefinition('item.champion-fallback-relic', {
        name: 'Fallback relic',
        rarity: 'common',
        glyph: '"',
        color: '#7788aa',
        category: 'misc',
        equipment: { slots: ['neck'], handedness: 'one-handed', reservedSlots: [] },
      }),
      leadenWeight,
      honedEnchantment,
    ],
  };
}

function snapshot(overrides: Partial<RecordedHeirloomSnapshot> = {}): RecordedHeirloomSnapshot {
  return {
    contentId: 'item.iron-sword',
    sourceItemId: 'item.hero.sword',
    enchantment: { enchantmentId: 'enchantment.honed', modifiers: { meleeDamageBonus: 2 } },
    condition: 73,
    charges: null,
    fuel: null,
    curse: null,
    qualityRank: 2,
    displayName: "Hero's Blade",
    glyph: ')',
    color: '#ddeeff',
    originatingHallRecordId,
    ...overrides,
  };
}

const heirloomFixture = (): RecordedHeirloomSnapshot => snapshot();
const armorFixture = (): RecordedHeirloomSnapshot =>
  snapshot({
    contentId: 'item.leather-armor',
    sourceItemId: 'item.hero.armor',
    enchantment: null,
    condition: 61,
    displayName: 'Scarred Jerkin',
    glyph: '[',
    color: '#a08050',
  });
const lanternFixture = (): RecordedHeirloomSnapshot =>
  snapshot({
    contentId: 'item.lantern',
    sourceItemId: 'item.hero.lantern',
    enchantment: null,
    condition: 90,
    fuel: 120,
    displayName: 'Guttering Lantern',
    glyph: '(',
    color: '#ffd9a0',
  });

describe('materializeDeathInventory', () => {
  it('materializes one item per snapshot on the same cell', () => {
    const pieces = materializeDeathInventory({
      content: pack(),
      snapshots: [heirloomFixture(), armorFixture(), lanternFixture()],
      equippedItemContentIds: ['item.iron-sword', 'item.leather-armor', 'item.lantern'],
      fallbackItemId: 'item.champion-fallback-relic',
      existingItems: [],
      itemIdPrefix: 'item.haunt.population.fallen-champion.record.a',
      floorId,
      x: 3,
      y: 4,
    });
    expect(pieces).toHaveLength(3);
    expect(pieces.map((piece) => piece.item.itemId)).toEqual([
      'item.haunt.population.fallen-champion.record.a.0000',
      'item.haunt.population.fallen-champion.record.a.0001',
      'item.haunt.population.fallen-champion.record.a.0002',
    ]);
    // Snapshot order is preserved, so the set is deterministic end to end.
    expect(pieces.map((piece) => piece.item.contentId)).toEqual([
      'item.iron-sword',
      'item.leather-armor',
      'item.lantern',
    ]);
    for (const piece of pieces) {
      expect(piece.item.location).toEqual({ type: 'floor', floorId, x: 3, y: 4 });
      expect(piece.fallback).toBe(false);
    }
  });

  it('degrades only the unresolvable piece to the fallback relic', () => {
    const pieces = materializeDeathInventory({
      content: pack(),
      snapshots: [heirloomFixture(), { ...armorFixture(), contentId: 'item.deleted' }],
      equippedItemContentIds: ['item.iron-sword'],
      fallbackItemId: 'item.champion-fallback-relic',
      existingItems: [],
      itemIdPrefix: 'item.haunt.x',
      floorId,
      x: 1,
      y: 1,
    });
    expect(pieces[0]!.fallback).toBe(false);
    expect(pieces[0]!.item.contentId).toBe('item.iron-sword');
    expect(pieces[1]!.fallback).toBe(true);
    expect(pieces[1]!.item.contentId).toBe('item.champion-fallback-relic');
    // The degraded piece still occupies its own slot in the set: ids never renumber.
    expect(pieces.map((piece) => piece.item.itemId)).toEqual([
      'item.haunt.x.0000',
      'item.haunt.x.0001',
    ]);
  });

  it('preserves a curse on a materialized piece', () => {
    const [piece] = materializeDeathInventory({
      content: pack(),
      snapshots: [
        { ...heirloomFixture(), curse: { curseId: 'curse.leaden-weight', revealed: true } },
      ],
      equippedItemContentIds: ['item.iron-sword'],
      fallbackItemId: 'item.champion-fallback-relic',
      existingItems: [],
      itemIdPrefix: 'item.haunt.x',
      floorId,
      x: 1,
      y: 1,
    });
    expect(piece!.item.curse).toEqual({ curseId: 'curse.leaden-weight', revealed: true });
  });

  it('zero-pads past nine so the ids sort in snapshot order', () => {
    const pieces = materializeDeathInventory({
      content: pack(),
      snapshots: Array.from({ length: 12 }, () => heirloomFixture()),
      equippedItemContentIds: ['item.iron-sword'],
      fallbackItemId: 'item.champion-fallback-relic',
      existingItems: [],
      itemIdPrefix: 'item.haunt.x',
      floorId,
      x: 1,
      y: 1,
    });
    const ids = pieces.map((piece) => piece.item.itemId);
    expect(ids.at(-1)).toBe('item.haunt.x.0011');
    expect([...ids].sort()).toEqual(ids);
  });

  it('consumes no randomness', () => {
    const before: Uint32State = [1, 2, 3, 4];
    materializeDeathInventory({
      content: pack(),
      snapshots: [heirloomFixture(), armorFixture()],
      equippedItemContentIds: ['item.iron-sword', 'item.leather-armor'],
      fallbackItemId: 'item.champion-fallback-relic',
      existingItems: [],
      itemIdPrefix: 'item.haunt.x',
      floorId,
      x: 1,
      y: 1,
    });
    // The function takes no stream at all -- this pins that it never grew one.
    expect(before).toEqual([1, 2, 3, 4]);
  });
});

describe('hauntDropSnapshots', () => {
  it('drops the death inventory as-is when the heirloom is one of its pieces', () => {
    const inventory = [heirloomFixture(), armorFixture()];
    expect(hauntDropSnapshots({ deathInventory: inventory, heirloom: heirloomFixture() })).toEqual({
      snapshots: inventory,
      heirloomIndex: 0,
    });
  });

  it('appends a heirloom the equipped-only capture missed, keeping the other indices put', () => {
    // `finalizeRun` captures equipped slots only, so an artifact carried in the backpack at death
    // is a recorded heirloom no inventory piece covers. Losing it would strand the artifact: the
    // haunt drop is its one route back into circulation.
    const backpackArtifact = {
      ...heirloomFixture(),
      contentId: 'item.lantern',
      sourceItemId: 'item.hero.backpack-artifact',
    };
    const inventory = [armorFixture()];
    const drop = hauntDropSnapshots({
      deathInventory: inventory,
      heirloom: backpackArtifact,
    });
    expect(drop.snapshots).toEqual([...inventory, backpackArtifact]);
    expect(drop.heirloomIndex).toBe(1);
  });

  it('does not duplicate a sourceItemId-less fallback heirloom that is already the whole inventory', () => {
    const relic = { ...heirloomFixture(), sourceItemId: null };
    expect(hauntDropSnapshots({ deathInventory: [relic], heirloom: relic })).toEqual({
      snapshots: [relic],
      heirloomIndex: 0,
    });
  });
});

describe('materializeDeathInventory artifact singleton guard', () => {
  const relic = (): RecordedHeirloomSnapshot =>
    snapshot({ contentId: 'item.relic', sourceItemId: 'item.hero.relic', enchantment: null });

  function materialize(existingItems: readonly ItemInstance[]) {
    return materializeDeathInventory({
      content: pack(),
      snapshots: [relic(), armorFixture()],
      equippedItemContentIds: ['item.relic', 'item.leather-armor'],
      fallbackItemId: 'item.champion-fallback-relic',
      existingItems,
      itemIdPrefix: 'item.haunt.x',
      floorId,
      x: 1,
      y: 1,
    });
  }

  it('materializes the artifact itself when nothing in the run holds one', () => {
    const [piece] = materialize([]);
    expect(piece!.fallback).toBe(false);
    expect(piece!.item.contentId).toBe('item.relic');
  });

  it('degrades an artifact the run already holds, leaving the rest of the set alone', () => {
    // Two Hall records can both name the same artifact -- it circulated through both heroes. The
    // second haunt held only a memory of it.
    const existing: ItemInstance = {
      itemId: 'item.somewhere-else',
      contentId: 'item.relic',
      quantity: 1,
      condition: 100,
      enchantment: null,
      identified: true,
      charges: null,
      fuel: null,
      enabled: null,
      location: { type: 'floor', floorId, x: 9, y: 9 },
    };
    const pieces = materialize([existing]);
    expect(pieces[0]!.fallback).toBe(true);
    expect(pieces[0]!.item.contentId).toBe('item.champion-fallback-relic');
    // A piece still comes back, and the non-artifact piece is untouched.
    expect(pieces).toHaveLength(2);
    expect(pieces[1]!.fallback).toBe(false);
    expect(pieces[1]!.item.contentId).toBe('item.leather-armor');
  });

  it('ignores an ordinary item the run already holds', () => {
    const existing: ItemInstance = {
      itemId: 'item.another-jerkin',
      contentId: 'item.leather-armor',
      quantity: 1,
      condition: 100,
      enchantment: null,
      identified: true,
      charges: null,
      fuel: null,
      enabled: null,
      location: { type: 'floor', floorId, x: 9, y: 9 },
    };
    // Only singletons are guarded: ordinary gear is minted as often as records name it.
    expect(materialize([existing])[1]!.fallback).toBe(false);
  });

  it('degrades the second of two snapshots naming the same artifact within ONE drop', () => {
    // The unavailable set must accumulate across the set being materialized, not only be computed
    // once from what the run held beforehand -- otherwise a drop composed from two sources that
    // both name the artifact would mint the singleton twice in a single call.
    const pieces = materializeDeathInventory({
      content: pack(),
      snapshots: [relic(), relic()],
      equippedItemContentIds: ['item.relic'],
      fallbackItemId: 'item.champion-fallback-relic',
      existingItems: [],
      itemIdPrefix: 'item.haunt.x',
      floorId,
      x: 1,
      y: 1,
    });
    expect(pieces[0]!.fallback).toBe(false);
    expect(pieces[0]!.item.contentId).toBe('item.relic');
    expect(pieces[1]!.fallback).toBe(true);
    expect(pieces[1]!.item.contentId).toBe('item.champion-fallback-relic');
  });
});
