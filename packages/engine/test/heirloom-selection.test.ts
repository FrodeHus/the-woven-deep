import { describe, expect, it } from 'vitest';
import type {
  CompiledContentPack,
  EncounterContentEntry,
  FallenChampionTemplateContentEntry,
  ItemContentEntry,
  LootTableContentEntry,
  MonsterContentEntry,
} from '@woven-deep/content';
import {
  createDemoContentPack,
  createDemoRun,
  rollDie,
  selectHeirloom,
  type ActiveRun,
  type EquipmentSlot,
  type ItemInstance,
} from '../src/index.js';

const recordId = `record.${'0'.repeat(32)}.${'a'.repeat(16)}`;

function itemDef(id: string, overrides: Partial<ItemContentEntry> = {}): ItemContentEntry {
  return {
    kind: 'item',
    id,
    name: `Name of ${id}`,
    tags: [],
    glyph: ')',
    color: '#c0c0c0',
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
    identification: { mode: 'known', poolId: null },
    effects: [],
    ...overrides,
  };
}

const monster: MonsterContentEntry = {
  kind: 'monster',
  id: 'monster.boss',
  name: 'Boss',
  tags: ['boss'],
  glyph: 'B',
  color: '#aa7755',
  attributes: { might: 18, agility: 12, vitality: 20, wits: 10, resolve: 16 },
  health: 120,
  speed: 100,
  accuracy: 18,
  defense: 16,
  perception: 10,
  damage: { count: 2, sides: 6, bonus: 2 },
  armor: 8,
  resistances: { physical: 10, fire: 20, cold: 0, lightning: 0, poison: 30, arcane: 0 },
  disposition: 'hostile',
  behaviorId: 'behavior.approach-and-attack',
  behaviorParameters: {},
  minDepth: 1,
  maxDepth: 20,
  threat: 12,
  rarity: 'legendary',
};
const bossLoot: LootTableContentEntry = {
  kind: 'loot-table',
  id: 'loot-table.boss',
  name: 'Boss loot',
  tags: [],
  rolls: 1,
  choices: [
    {
      contentId: 'item.fallback',
      lootTableId: null,
      weight: 1,
      minimumQuantity: 1,
      maximumQuantity: 1,
    },
  ],
};
const bossEncounter: EncounterContentEntry = {
  kind: 'encounter',
  id: 'encounter.boss',
  name: 'Boss',
  tags: [],
  adminDescription: null,
  model: 'boss',
  minDepth: 1,
  maxDepth: 20,
  environmentTags: [],
  requiredVaultTags: [],
  weight: 1,
  rarity: 'legendary',
  runAppearanceChance: 1,
  discoveryProtectionIncrement: 0,
  discoveryProtectionCap: 1,
  maximumInstancesPerRun: 1,
  placement: {
    minimumStairDistance: 0,
    minimumObjectiveDistance: 0,
    maximumMemberDistance: 0,
    allowedTerrainTags: ['floor'],
    requiresVaultSlot: false,
    failureMode: 'optional',
  },
  intentPresentation: { visible: true },
  definition: {
    monsterId: monster.id,
    phases: [],
    recoveryPerWorldTime: 0,
    recoveryCapPercent: 0,
    uniqueItemId: 'item.boss-unique',
    enhancedLootTableId: bossLoot.id,
    vaultTags: [],
  },
};

const template: FallenChampionTemplateContentEntry = {
  kind: 'fallen-champion-template',
  id: 'fallen-champion-template.core',
  name: "The Deep's Champion",
  tags: ['champion'],
  fallbackMonsterId: monster.id,
  fallbackItemId: 'item.fallback',
  minimumHealth: 30,
  maximumHealth: 100,
  attributeMaximum: 20,
  damageMaximum: 24,
  abilityLimit: 2,
  echoAppearanceChance: 0.5,
  maximumEchoesPerRun: 2,
  echoHealthPercent: 65,
  echoDamagePercent: 70,
  echoDefensePercent: 80,
  echoAbilityLimit: 1,
  echoLootTableId: bossLoot.id,
  heirloomSelection: {
    rarityWeights: { common: 1, uncommon: 3, rare: 8, legendary: 16 },
    qualityRankBonus: 2,
  },
};

function pack(extra: readonly ItemContentEntry[] = []): CompiledContentPack {
  const base = createDemoContentPack();
  return {
    ...base,
    entries: [
      ...base.entries,
      monster,
      bossLoot,
      bossEncounter,
      template,
      itemDef('item.fallback', { rarity: 'common' }),
      ...extra,
    ],
  };
}

function equippedItem(
  itemId: string,
  contentId: string,
  slot: EquipmentSlot,
  overrides: Partial<ItemInstance> = {},
): ItemInstance {
  return {
    itemId,
    contentId,
    quantity: 1,
    condition: 100,
    enchantment: null,
    identified: true,
    charges: null,
    fuel: null,
    enabled: null,
    location: { type: 'equipped', actorId: 'hero.demo', slot },
    ...overrides,
  };
}

function deadRun(items: readonly ItemInstance[]): ActiveRun {
  const base = createDemoRun();
  return {
    ...base,
    items: [...items],
    conclusion: {
      completionType: 'died',
      cause: { killerContentId: null, depth: 1, turn: 10, worldTime: 1000 },
      concludedAtRevision: 1,
      finalized: false,
    },
  };
}

describe('selectHeirloom', () => {
  it('selects deterministically from equipped items and advances only the run-records stream', () => {
    const content = pack([
      itemDef('item.sword', { name: 'Hero sword', glyph: '/', color: '#ddeeff' }),
      itemDef('item.crown', {
        rarity: 'legendary',
        equipment: { slots: ['head'], handedness: 'one-handed', reservedSlots: [] },
      }),
    ]);
    const deadHeroRun = deadRun([
      equippedItem('item.hero.sword', 'item.sword', 'main-hand', {
        condition: 62,
        charges: 3,
        fuel: 7,
        enchantment: {
          enchantmentId: 'enchantment.honed',
          modifiers: { meleeDamageBonus: 2, defense: -1, accuracy: 1 },
        },
      }),
      {
        ...equippedItem('item.hero.crown', 'item.crown', 'head'),
        location: { type: 'backpack', actorId: 'hero.demo' },
      },
    ]);
    const before = structuredClone(deadHeroRun.rng);
    const first = selectHeirloom({ run: deadHeroRun, content, template, recordId });
    const second = selectHeirloom({ run: deadHeroRun, content, template, recordId });
    expect(first).toEqual(second);
    expect(first.snapshot.sourceItemId).toBe('item.hero.sword');
    expect(first.snapshot.originatingHallRecordId).toBe(recordId);
    expect(deadHeroRun.rng['run-records']).not.toEqual(first.nextRunRecordsState);
    expect(first.snapshot).toEqual({
      contentId: 'item.sword',
      sourceItemId: 'item.hero.sword',
      enchantment: {
        enchantmentId: 'enchantment.honed',
        modifiers: { meleeDamageBonus: 2, defense: -1, accuracy: 1 },
      },
      condition: 62,
      charges: 3,
      fuel: 7,
      qualityRank: 2,
      displayName: 'Hero sword',
      glyph: '/',
      color: '#ddeeff',
      originatingHallRecordId: recordId,
    });
    // exactly one roll on run-records: rare (8) + qualityRankBonus 2 x qualityRank 2 = 12 total weight
    expect(first.nextRunRecordsState).toEqual(rollDie(deadHeroRun.rng['run-records'], 12).state);
    // no other stream moves: the run is untouched
    expect(deadHeroRun.rng).toEqual(before);
  });

  it('excludes tagged, boss-unique, ineligible, and non-equipment items from candidacy', () => {
    const content = pack([
      itemDef('item.sword'),
      itemDef('item.relic', {
        tags: ['heirloom'],
        equipment: { slots: ['neck'], handedness: 'one-handed', reservedSlots: [] },
      }),
      itemDef('item.quest-seal', {
        tags: ['quest'],
        equipment: { slots: ['left-ring'], handedness: 'one-handed', reservedSlots: [] },
      }),
      itemDef('item.objective-key', {
        tags: ['objective'],
        equipment: { slots: ['right-ring'], handedness: 'one-handed', reservedSlots: [] },
      }),
      itemDef('item.bound-band', {
        tags: ['nontransferable'],
        equipment: { slots: ['hands'], handedness: 'one-handed', reservedSlots: [] },
      }),
      itemDef('item.boss-unique', {
        rarity: 'legendary',
        equipment: { slots: ['head'], handedness: 'one-handed', reservedSlots: [] },
      }),
      itemDef('item.mundane', {
        heirloomEligible: false,
        equipment: { slots: ['body'], handedness: 'one-handed', reservedSlots: [] },
      }),
      itemDef('item.trinket', { equipment: null }),
    ]);
    const deadHeroRun = deadRun([
      equippedItem('item.hero.sword', 'item.sword', 'main-hand'),
      equippedItem('item.hero.relic', 'item.relic', 'neck'),
      equippedItem('item.hero.quest-seal', 'item.quest-seal', 'left-ring'),
      equippedItem('item.hero.objective-key', 'item.objective-key', 'right-ring'),
      equippedItem('item.hero.bound-band', 'item.bound-band', 'hands'),
      equippedItem('item.hero.boss-unique', 'item.boss-unique', 'head'),
      equippedItem('item.hero.mundane', 'item.mundane', 'body'),
      equippedItem('item.hero.trinket', 'item.trinket', 'feet'),
    ]);
    const result = selectHeirloom({ run: deadHeroRun, content, template, recordId });
    expect(result.snapshot.sourceItemId).toBe('item.hero.sword');
    // the sword is the only candidate: one roll over its weight alone (rare = 8)
    expect(result.nextRunRecordsState).toEqual(rollDie(deadHeroRun.rng['run-records'], 8).state);
  });

  it('weights candidates by rarity weight plus quality rank bonus and walks cumulative weights', () => {
    const content = pack([
      itemDef('item.blade', { rarity: 'common' }),
      itemDef('item.spear', {
        rarity: 'rare',
        equipment: { slots: ['off-hand'], handedness: 'one-handed', reservedSlots: [] },
      }),
    ]);
    const deadHeroRun = deadRun([
      equippedItem('item.hero.a-blade', 'item.blade', 'main-hand', {
        enchantment: {
          enchantmentId: 'enchantment.keen',
          modifiers: { accuracy: 1, defense: 2, weight: -3 },
        },
      }),
      equippedItem('item.hero.b-spear', 'item.spear', 'off-hand'),
    ]);
    // candidates sorted by item ID: blade weight = 1 + 2 x 2 = 5, spear weight = 8, total 13
    const roll = rollDie(deadHeroRun.rng['run-records'], 13);
    const expected = roll.value <= 5 ? 'item.hero.a-blade' : 'item.hero.b-spear';
    const result = selectHeirloom({ run: deadHeroRun, content, template, recordId });
    expect(result.snapshot.sourceItemId).toBe(expected);
    expect(result.nextRunRecordsState).toEqual(roll.state);
  });

  it('keeps a depleted common item at positive weight so it can win a forced roll', () => {
    const content = pack([itemDef('item.stub', { rarity: 'common' })]);
    const deadHeroRun = deadRun([
      equippedItem('item.hero.stub', 'item.stub', 'main-hand', {
        condition: 0,
        charges: 0,
        fuel: 0,
      }),
    ]);
    const result = selectHeirloom({ run: deadHeroRun, content, template, recordId });
    expect(result.snapshot.sourceItemId).toBe('item.hero.stub');
    expect(result.snapshot.condition).toBe(0);
    expect(result.snapshot.charges).toBe(0);
    expect(result.snapshot.fuel).toBe(0);
    expect(result.snapshot.qualityRank).toBe(0);
    expect(result.nextRunRecordsState).toEqual(rollDie(deadHeroRun.rng['run-records'], 1).state);
  });

  it('records one unit from a stack and counts the stack as a single candidate', () => {
    const content = pack([
      itemDef('item.dart', { rarity: 'common', stackLimit: 10 }),
      itemDef('item.spear', {
        rarity: 'rare',
        equipment: { slots: ['off-hand'], handedness: 'one-handed', reservedSlots: [] },
      }),
    ]);
    const stacked = deadRun([
      equippedItem('item.hero.darts', 'item.dart', 'main-hand', { quantity: 5 }),
    ]);
    const solo = selectHeirloom({ run: stacked, content, template, recordId });
    expect(solo.snapshot.contentId).toBe('item.dart');
    expect(solo.snapshot.sourceItemId).toBe('item.hero.darts');
    // stack weight counts once: common (1) + rare (8) = 9, not 5 x 1 + 8
    const paired = deadRun([
      equippedItem('item.hero.darts', 'item.dart', 'main-hand', { quantity: 5 }),
      equippedItem('item.hero.spear', 'item.spear', 'off-hand'),
    ]);
    const result = selectHeirloom({ run: paired, content, template, recordId });
    expect(result.nextRunRecordsState).toEqual(rollDie(paired.rng['run-records'], 9).state);
  });

  it('treats a two-handed item as one candidate', () => {
    const content = pack([
      itemDef('item.greatsword', {
        rarity: 'rare',
        equipment: { slots: ['main-hand'], handedness: 'two-handed', reservedSlots: ['off-hand'] },
      }),
      itemDef('item.charm', {
        rarity: 'common',
        equipment: { slots: ['neck'], handedness: 'one-handed', reservedSlots: [] },
      }),
    ]);
    const deadHeroRun = deadRun([
      equippedItem('item.hero.greatsword', 'item.greatsword', 'main-hand'),
      equippedItem('item.hero.charm', 'item.charm', 'neck'),
    ]);
    // total weight 8 + 1 = 9: the greatsword contributes once despite reserving the off-hand
    const result = selectHeirloom({ run: deadHeroRun, content, template, recordId });
    expect(result.nextRunRecordsState).toEqual(rollDie(deadHeroRun.rng['run-records'], 9).state);
  });

  it('returns the template fallback relic without consuming randomness when nothing is eligible', () => {
    const content = pack([itemDef('item.crown', { rarity: 'legendary' })]);
    const deadHeroRun = deadRun([
      {
        ...equippedItem('item.hero.crown', 'item.crown', 'head'),
        location: { type: 'backpack', actorId: 'hero.demo' },
      },
    ]);
    const result = selectHeirloom({ run: deadHeroRun, content, template, recordId });
    expect(result.snapshot).toEqual({
      contentId: 'item.fallback',
      sourceItemId: null,
      enchantment: null,
      condition: 100,
      charges: null,
      fuel: null,
      qualityRank: 0,
      displayName: 'Name of item.fallback',
      glyph: ')',
      color: '#c0c0c0',
      originatingHallRecordId: recordId,
    });
    expect(result.nextRunRecordsState).toEqual(deadHeroRun.rng['run-records']);
  });

  it('throws for a living hero', () => {
    const content = pack([itemDef('item.sword')]);
    const run = {
      ...deadRun([equippedItem('item.hero.sword', 'item.sword', 'main-hand')]),
      conclusion: null,
    };
    expect(() => selectHeirloom({ run, content, template, recordId })).toThrow(/conclud/i);
  });
});
