import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import type {
  BalanceContentEntry,
  CompiledContentPack,
  EnchantmentContentEntry,
  ItemContentEntry,
} from '@woven-deep/content';
import {
  createDemoContentPack,
  createDemoRun,
  deriveRngStreams,
  drawEnchantment,
  enchantable,
  ENCHANTABLE_CATEGORIES,
  heroActor,
  resolveCommand,
  rollDie,
  synchronizeDerivedMaxima,
  type ActiveRun,
  type GameCommand,
  type ItemInstance,
  type Uint32State,
} from '../src/index.js';

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
    rarity: 'common',
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

function enchantmentDef(
  id: string,
  overrides: Partial<EnchantmentContentEntry> = {},
): EnchantmentContentEntry {
  return {
    kind: 'enchantment',
    id,
    name: `Name of ${id}`,
    tags: [],
    categories: ['weapon'],
    modifiers: { meleeAccuracy: 1 },
    weight: 1,
    ...overrides,
  };
}

const weaponA = enchantmentDef('enchantment.a-weapon', {
  modifiers: { meleeAccuracy: 1 },
  weight: 3,
});
const weaponB = enchantmentDef('enchantment.b-weapon', {
  modifiers: { meleeDamageBonus: 2 },
  weight: 5,
});

function pack(
  extra: readonly EnchantmentContentEntry[] = [],
  items: readonly ItemContentEntry[] = [],
): CompiledContentPack {
  const base = createDemoContentPack();
  return {
    ...base,
    entries: [...base.entries, weaponA, weaponB, ...extra, ...items],
  };
}

function totalEligibleWeightFor(pack: CompiledContentPack, category: string): number {
  return pack.entries
    .filter(
      (entry): entry is EnchantmentContentEntry =>
        entry.kind === 'enchantment' && entry.categories.includes(category as never),
    )
    .reduce((sum, entry) => sum + entry.weight, 0);
}

function ironSword(overrides: Partial<ItemInstance> = {}): ItemInstance {
  return {
    itemId: 'item.sword.1',
    contentId: 'item.sword',
    quantity: 1,
    condition: 100,
    enchantment: null,
    identified: true,
    charges: null,
    fuel: null,
    enabled: null,
    location: { type: 'backpack', actorId: 'hero.demo' },
    ...overrides,
  };
}

function commonSword(): ItemInstance {
  return ironSword({ contentId: 'item.sword-common' });
}

function legendarySword(): ItemInstance {
  return ironSword({ contentId: 'item.sword-legendary' });
}

function healingPotion(): ItemInstance {
  return ironSword({
    contentId: 'item.potion',
    location: { type: 'backpack', actorId: 'hero.demo' },
  });
}

function artifactInstance(): ItemInstance {
  return ironSword({ contentId: 'item.artifact' });
}

function revealedCursedSword(): ItemInstance {
  return ironSword({ curse: { curseId: 'curse.leaden-weight', revealed: true } });
}

function unrevealedCursedSword(): ItemInstance {
  return ironSword({ curse: { curseId: 'curse.leaden-weight', revealed: false } });
}

const items: readonly ItemContentEntry[] = [
  itemDef('item.sword'),
  itemDef('item.sword-common', { rarity: 'common' }),
  itemDef('item.sword-legendary', { rarity: 'legendary' }),
  itemDef('item.potion', { category: 'potion', equipment: null }),
  itemDef('item.artifact', {
    rarity: 'legendary',
    equipment: { slots: ['off-hand'], handedness: 'one-handed', reservedSlots: [] },
    artifact: { canon: true, signature: null, drawbackModifiers: { defense: -1 }, light: null },
  }),
];

const content = pack([], items);

describe('drawEnchantment', () => {
  it('draws an enchantment eligible for the item category', () => {
    const { enchantment } = drawEnchantment({ content, item: ironSword(), state: [1, 2, 3, 4] });
    const entry = content.entries.find((candidate) => candidate.id === enchantment.enchantmentId)!;
    expect(entry.kind).toBe('enchantment');
    expect((entry as EnchantmentContentEntry).categories).toContain('weapon');
  });

  it('is deterministic for a fixed stream state', () => {
    const first = drawEnchantment({ content, item: ironSword(), state: [7, 7, 7, 7] });
    const second = drawEnchantment({ content, item: ironSword(), state: [7, 7, 7, 7] });
    expect(first).toEqual(second);
  });

  it('consumes exactly one draw', () => {
    const state: Uint32State = [1, 2, 3, 4];
    expect(drawEnchantment({ content, item: ironSword(), state }).state).toEqual(
      rollDie(state, totalEligibleWeightFor(content, 'weapon')).state,
    );
  });

  it('scales magnitude by item rarity', () => {
    const common = drawEnchantment({ content, item: commonSword(), state: [5, 5, 5, 5] });
    const legendary = drawEnchantment({ content, item: legendarySword(), state: [5, 5, 5, 5] });
    expect(legendary.enchantment.enchantmentId).toBe(common.enchantment.enchantmentId);
    for (const [stat, value] of Object.entries(legendary.enchantment.modifiers)) {
      expect(value).toBeGreaterThanOrEqual(common.enchantment.modifiers[stat]!);
    }
  });

  it('never scales a modifier below 1', () => {
    const tinyEnchantment = enchantmentDef('enchantment.tiny', {
      modifiers: { meleeAccuracy: 1 },
      weight: 1,
    });
    const tinyBalancePack: CompiledContentPack = {
      ...pack([tinyEnchantment], items),
      entries: pack([tinyEnchantment], items).entries.map((entry) =>
        entry.kind === 'balance'
          ? {
              ...(entry as BalanceContentEntry),
              enchanting: {
                rarityMagnitudeBps: { common: 1, uncommon: 1, rare: 1, legendary: 1 },
              },
            }
          : entry,
      ),
    };
    const { enchantment } = drawEnchantment({
      content: tinyBalancePack,
      item: commonSword(),
      state: [1, 1, 1, 1],
    });
    expect(Object.values(enchantment.modifiers).every((value) => value >= 1)).toBe(true);
  });

  it('throws when the pack defines no eligible entries for the item category', () => {
    const noEnchantmentsPack: CompiledContentPack = {
      ...createDemoContentPack(),
      entries: [...createDemoContentPack().entries, ...items],
    };
    expect(() =>
      drawEnchantment({ content: noEnchantmentsPack, item: ironSword(), state: [1, 2, 3, 4] }),
    ).toThrow(/no enchantment entries/);
  });
});

describe('enchantable', () => {
  it('rejects an artifact and a revealed-cursed item as unenchantable', () => {
    expect(enchantable(content, artifactInstance())).toBe(false);
    expect(enchantable(content, revealedCursedSword())).toBe(false);
    expect(enchantable(content, unrevealedCursedSword())).toBe(true);
    expect(enchantable(content, healingPotion())).toBe(false);
    expect(enchantable(content, ironSword())).toBe(true);
  });
});

describe('shipping content', () => {
  let shippingPack: CompiledContentPack;

  beforeAll(async () => {
    shippingPack = await compileContentDirectory({
      rootDir: resolve(import.meta.dirname, '../../../content'),
    });
  });

  it('has a non-empty pool for every enchantable category in the shipping pack', () => {
    for (const category of ENCHANTABLE_CATEGORIES) {
      expect(
        shippingPack.entries.filter(
          (entry) => entry.kind === 'enchantment' && entry.categories.includes(category),
        ).length,
      ).toBeGreaterThan(0);
    }
  });

  it('makes a maxHealth enchantment move the hero bar', () => {
    // enchantment.deep-lungs grants { maxHealth: 3 } on a real `ring`-category shipping item
    // (item.etched-ring) -- the Task 1 derived-maxima fix, exercised here through live content
    // instead of a synthetic test fixture. Isolated by diffing synced-with-ring against
    // synced-without-ring under the SAME (real) formulas, so the assertion does not depend on
    // the demo hero's stale demo-pack-derived baseline.
    const base = createDemoRun();
    const hero = heroActor(base);
    const baseline = synchronizeDerivedMaxima(base, shippingPack);
    const ringItem: ItemInstance = {
      itemId: 'item.ring.enchant-test',
      contentId: 'item.etched-ring',
      quantity: 1,
      condition: 100,
      enchantment: { enchantmentId: 'enchantment.deep-lungs', modifiers: { maxHealth: 3 } },
      identified: true,
      charges: null,
      fuel: null,
      enabled: null,
      location: { type: 'equipped', actorId: hero.actorId, slot: 'left-ring' },
    };
    const withRing = {
      ...base,
      items: [...base.items, ringItem],
      actors: base.actors.map((actor) =>
        actor.actorId === hero.actorId
          ? { ...actor, equipment: { ...actor.equipment, 'left-ring': ringItem.itemId } }
          : actor,
      ),
    };
    const synchronized = synchronizeDerivedMaxima(withRing, shippingPack);
    expect(heroActor(synchronized).maxHealth).toBe(heroActor(baseline).maxHealth + 3);
  });
});

describe('RNG stream isolation (Task 12, hero-power-curve regression pin)', () => {
  /** Drives fifty ordinary `wait` turns -- no enchanting, no tempering, no spell casting, and the
   * demo fixture's floor has no monsters and no loot to trip anything incidental either. Only
   * `drawEnchantment`'s two call sites (an `effect.enchant`-bearing effect and the Armorer trade
   * service) ever draw the `enchanting` stream; neither runs here. */
  function playFiftyTurns(
    run: ActiveRun,
    content: ReturnType<typeof createDemoContentPack>,
  ): ActiveRun {
    let state = run;
    for (let index = 0; index < 50; index += 1) {
      const command: GameCommand = {
        type: 'wait',
        commandId: `command.turn-${String(index)}`,
        expectedRevision: state.revision,
      };
      const resolution = resolveCommand(state, command, { content });
      if (resolution.result.status !== 'applied') {
        throw new Error(`turn ${String(index)} did not apply: ${resolution.result.status}`);
      }
      state = resolution.state;
    }
    return state;
  }

  it('never advances the enchanting stream in a run that never enchants', () => {
    const content = createDemoContentPack();
    const played = playFiftyTurns(createDemoRun(), content);
    expect(played.rng.enchanting).toEqual(deriveRngStreams(played.runSeed).enchanting);
  });
});
