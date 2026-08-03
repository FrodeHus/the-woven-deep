import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type {
  CompiledContentPack,
  ItemContentEntry,
  MerchantEncounterContentEntry,
  NpcFactionContentEntry,
} from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  allocateIdentificationMap,
  createDemoRun,
  materializeMerchant,
  projectGameplayState,
  quoteMerchantService,
  reputationTier,
  resolveCommand,
  scaledServiceBasePrice,
  serviceTargetItemIds,
  stableJson,
  RNG_STREAM_NAMES,
  type ActiveRun,
  type GameCommand,
  type ItemInstance,
  type MerchantPopulation,
} from '../src/index.js';

let content: CompiledContentPack;
let encounter: MerchantEncounterContentEntry;
let faction: NpcFactionContentEntry;
let sword: ItemContentEntry;

const POPULATION_ID = 'population.armorer-demo';
const MERCHANT_ACTOR_ID = `actor.${POPULATION_ID}.001`;
const HERO_ID = 'hero.demo';
const CURSE_ID = 'curse.hungering-edge';
const ARTIFACT_ID = 'item.thread-counts-needle';
const POTION_ID = 'item.crimson-potion';

beforeAll(async () => {
  content = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
  encounter = content.entries.find(
    (entry): entry is MerchantEncounterContentEntry =>
      entry.kind === 'encounter' &&
      entry.model === 'merchant' &&
      entry.id === 'encounter.town-armorer',
  )!;
  faction = content.entries.find(
    (entry): entry is NpcFactionContentEntry => entry.id === 'npc-faction.town-armorer',
  )!;
  sword = content.entries.find(
    (entry): entry is ItemContentEntry => entry.kind === 'item' && entry.id === 'item.iron-sword',
  )!;
});

function item(
  itemId: string,
  contentId: string,
  location: ItemInstance['location'],
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
    location,
    ...overrides,
  };
}

interface FixtureOptions {
  readonly currency?: number;
  readonly uses?: number;
}

function armorerRun(options: FixtureOptions = {}): ActiveRun {
  const base = createDemoRun();
  const identified = allocateIdentificationMap({ content, rng: base.rng });
  const run: ActiveRun = {
    ...base,
    contentHash: content.hash,
    hero: { ...base.hero, currency: options.currency ?? base.hero.currency },
    identification: identified.identification,
    rng: identified.rng,
    encounterDecisions: content.entries
      .filter((entry) => entry.kind === 'encounter')
      .sort((left, right) => (left.id < right.id ? -1 : 1))
      .map((entry) => ({
        encounterId: entry.id,
        baseProbability: entry.runAppearanceChance,
        protectionBonus: 0,
        effectiveProbability: entry.runAppearanceChance,
        eligible: true,
        reachedEligibleDepth: false,
        encountered: false,
        instancesCreated: entry.id === encounter.id ? 1 : 0,
      })),
  };
  const materialized = materializeMerchant({
    run,
    content,
    encounter,
    populationId: POPULATION_ID,
    floorId: 'floor.demo',
    position: { x: 2, y: 1 },
  });
  const heroItems: ItemInstance[] = [
    item('item.hero.sword', sword.id, { type: 'backpack', actorId: HERO_ID }),
    item('item.hero.artifact', ARTIFACT_ID, { type: 'backpack', actorId: HERO_ID }),
    item(
      'item.hero.cursed-sword',
      sword.id,
      { type: 'backpack', actorId: HERO_ID },
      { curse: { curseId: CURSE_ID, revealed: true } },
    ),
    item('item.hero.potion', POTION_ID, { type: 'backpack', actorId: HERO_ID }),
  ];
  const stockIds: string[] = [];
  const population: MerchantPopulation = {
    ...materialized.population,
    initialStockItemIds: stockIds,
    stockItemIds: stockIds,
    services: materialized.population.services.map((entry) => ({
      ...entry,
      remainingUses: Math.min(options.uses ?? 2, entry.maximumUses),
    })),
  };
  const heroActor = run.actors.find((actor) => actor.actorId === HERO_ID)!;
  return {
    ...run,
    rng: { ...run.rng, 'merchant-stock': materialized.nextMerchantStockState },
    actors: [
      heroActor,
      ...run.actors.filter((actor) => actor.actorId !== HERO_ID),
      materialized.actor,
    ].sort((left, right) => (left.actorId < right.actorId ? -1 : 1)),
    items: heroItems.sort((left, right) => (left.itemId < right.itemId ? -1 : 1)),
    populations: [population],
  };
}

const context = () => ({ content });

function itemOf(run: ActiveRun, itemId: string): ItemInstance {
  return run.items.find((entry) => entry.itemId === itemId)!;
}

function openedRun(options: FixtureOptions = {}): ActiveRun {
  const run = armorerRun(options);
  const opened = resolveCommand(
    run,
    {
      type: 'trade-open',
      commandId: 'command.trade-open',
      expectedRevision: 0,
      merchantActorId: MERCHANT_ACTOR_ID,
    },
    context(),
  );
  if (opened.result.status !== 'applied')
    throw new Error(`fixture open failed: ${stableJson(opened.result)}`);
  return opened.state;
}

function enchantCommand(
  overrides: Partial<Extract<GameCommand, { type: 'trade-service' }>> = {},
): GameCommand {
  return {
    type: 'trade-service',
    commandId: 'command.enchant',
    expectedRevision: 1,
    merchantPopulationId: POPULATION_ID,
    serviceId: 'merchant-service.enchant',
    targetItemId: 'item.hero.sword',
    ...overrides,
  };
}

function enchantService() {
  return encounter.definition.services.find(
    (candidate) => candidate.serviceId === 'merchant-service.enchant',
  )!;
}

function enchantPrice(multiplier: 1 | 2): number {
  return quoteMerchantService({
    basePrice: scaledServiceBasePrice(enchantService().basePrice, multiplier),
    factionBps: reputationTier(faction.startingReputation, faction).purchasePriceBps,
  });
}

describe('trade-service enchant projection', () => {
  it('lists only enchantable owned items as service targets', () => {
    const run = openedRun();
    const targets = serviceTargetItemIds({
      state: run,
      content,
      serviceId: 'merchant-service.enchant',
    });
    expect(targets).toContain('item.hero.sword');
    expect(targets).not.toContain('item.hero.artifact');
    expect(targets).not.toContain('item.hero.cursed-sword');
    expect(targets).not.toContain('item.hero.potion');
  });

  it('excludes a heirloom-provenance equipment item from the service target list', () => {
    const run = openedRun();
    // A recovered heirloom's identity IS its recorded provenance -- the Armorer must never
    // re-forge it. Placed directly (bypassing the haunts drop machinery, which this test does not
    // need to exercise) since `serviceTargetItemIds` is a pure filter over `run.items`.
    const heirloomItem: ItemInstance = item(
      'item.hero.heirloom-sword',
      sword.id,
      { type: 'equipped', actorId: HERO_ID, slot: 'main-hand' },
      {
        heirloom: {
          displayName: 'Ancestral Blade',
          glyph: ')',
          color: '#ddeeff',
          originatingHallRecordId: `record.${'a'.repeat(32)}.${'b'.repeat(16)}`,
          originatingRank: 1,
          sourceItemId: 'item.original.0001',
        },
      },
    );
    const withHeirloom: ActiveRun = { ...run, items: [...run.items, heirloomItem] };
    const targets = serviceTargetItemIds({
      state: withHeirloom,
      content,
      serviceId: 'merchant-service.enchant',
    });
    expect(targets).not.toContain('item.hero.heirloom-sword');
    expect(targets).toContain('item.hero.sword');
  });

  it('the trade projection agrees with serviceTargetItemIds', () => {
    const run = openedRun();
    const projection = projectGameplayState({ state: run, content }).trade!;
    const enchant = projection.services.find((s) => s.serviceId === 'merchant-service.enchant')!;
    expect(enchant.targetItemIds).toEqual(
      serviceTargetItemIds({ state: run, content, serviceId: 'merchant-service.enchant' }),
    );
  });

  it('projects the exact re-enchant quote alongside the base quote (only for the enchant service)', () => {
    // The doubling applies to the BASE price before the faction quote, so a client doubling the
    // quoted unitPrice itself can be off by a rounding step -- the projection carries the true
    // figure so the target picker can show it per already-enchanted target.
    const run = openedRun();
    const projection = projectGameplayState({ state: run, content }).trade!;
    const enchant = projection.services.find((s) => s.serviceId === 'merchant-service.enchant')!;
    expect(enchant.unitPrice).toBe(enchantPrice(1));
    expect(enchant.reEnchantUnitPrice).toBe(enchantPrice(2));
    for (const service of projection.services) {
      if (service.serviceId !== 'merchant-service.enchant') {
        expect(service.reEnchantUnitPrice).toBeUndefined();
      }
    }
  });
});

describe('trade-service enchant', () => {
  it('enchants an unenchanted item at the base price', () => {
    const runWithTrade = openedRun({ currency: 1000 });
    const price = enchantPrice(1);
    const resolved = resolveCommand(runWithTrade, enchantCommand(), context());
    expect(resolved.result).toMatchObject({ status: 'applied' });
    const enchanted = itemOf(resolved.state, 'item.hero.sword');
    expect(enchanted.enchantment).not.toBeNull();
    expect(enchanted.identified).toBe(true);
    expect(resolved.state.hero.currency).toBe(runWithTrade.hero.currency - price);
    expect(resolved.events).toContainEqual(
      expect.objectContaining({
        type: 'trade.service-purchased',
        serviceId: 'merchant-service.enchant',
        targetItemId: 'item.hero.sword',
        price,
      }),
    );
  });

  it('identifies completely and reveals the curse when enchanting an unrevealed-cursed item, never leaving identified: true with curse.revealed: false', () => {
    const runWithTrade = openedRun({ currency: 1000 });
    const unrevealedCursedSwordId = 'item.hero.unrevealed-cursed-sword';
    const before: ActiveRun = {
      ...runWithTrade,
      items: [
        ...runWithTrade.items,
        item(
          unrevealedCursedSwordId,
          sword.id,
          { type: 'backpack', actorId: HERO_ID },
          { identified: false, curse: { curseId: CURSE_ID, revealed: false } },
        ),
      ],
    };
    const resolved = resolveCommand(
      before,
      enchantCommand({ targetItemId: unrevealedCursedSwordId }),
      context(),
    );
    expect(resolved.result).toMatchObject({ status: 'applied' });
    const enchanted = itemOf(resolved.state, unrevealedCursedSwordId);
    // The #121 invariant every identify path reveals: identified and curse.revealed rise
    // together, never `identified: true` with a hidden curse.
    expect(enchanted.identified).toBe(true);
    expect(enchanted.curse).toEqual({ curseId: CURSE_ID, revealed: true });
    expect(enchanted.enchantment).not.toBeNull();
    // item.iron-sword identifies per-instance (mode: instance, no shared appearance pool), so the
    // Armorer's identify pass has nothing to touch here -- appearance bookkeeping stays exactly
    // as it was, the same as it would for the identify service on this same item.
    expect(resolved.state.identification).toEqual(before.identification);
  });

  it('re-enchants an already-enchanted item at double price, replacing the old draw', () => {
    const runWithTrade = openedRun({ uses: 2, currency: 1000 });
    const once = resolveCommand(runWithTrade, enchantCommand(), context());
    expect(once.result).toMatchObject({ status: 'applied' });
    const first = itemOf(once.state, 'item.hero.sword').enchantment;
    expect(first).not.toBeNull();
    const twicePrice = enchantPrice(2);
    const twice = resolveCommand(
      once.state,
      enchantCommand({ commandId: 'command.enchant-2', expectedRevision: once.state.revision }),
      context(),
    );
    expect(twice.result).toMatchObject({ status: 'applied' });
    const second = itemOf(twice.state, 'item.hero.sword').enchantment;
    expect(second).not.toBeNull();
    // A fresh draw replaces the old one outright -- it may legitimately land the same or worse.
    expect(twice.state.hero.currency).toBe(once.state.hero.currency - twicePrice);
  });

  it('refuses an artifact', () => {
    const runWithTrade = openedRun();
    const resolved = resolveCommand(
      runWithTrade,
      enchantCommand({ targetItemId: 'item.hero.artifact' }),
      context(),
    );
    expect(resolved.result).toMatchObject({ status: 'invalid', reason: 'trade.target-invalid' });
  });

  it('refuses a revealed-cursed item', () => {
    const runWithTrade = openedRun();
    const resolved = resolveCommand(
      runWithTrade,
      enchantCommand({ targetItemId: 'item.hero.cursed-sword' }),
      context(),
    );
    expect(resolved.result).toMatchObject({ status: 'invalid', reason: 'trade.target-invalid' });
  });

  it('refuses an item outside the enchantable categories', () => {
    const runWithTrade = openedRun();
    const resolved = resolveCommand(
      runWithTrade,
      enchantCommand({ targetItemId: 'item.hero.potion' }),
      context(),
    );
    expect(resolved.result).toMatchObject({ status: 'invalid', reason: 'trade.target-invalid' });
  });

  it('advances the enchanting stream and nothing else', () => {
    const before = openedRun({ currency: 1000 });
    const after = resolveCommand(before, enchantCommand(), context());
    expect(after.result).toMatchObject({ status: 'applied' });
    expect(after.state.rng.enchanting).not.toEqual(before.rng.enchanting);
    for (const stream of RNG_STREAM_NAMES.filter((name) => name !== 'enchanting')) {
      expect(after.state.rng[stream]).toEqual(before.rng[stream]);
    }
  });

  it('does not enchant, does not charge, and does not touch the enchanting stream when the hero cannot pay', () => {
    const broke = openedRun({ currency: 0 });
    const resolved = resolveCommand(broke, enchantCommand(), context());
    expect(resolved.result).toMatchObject({
      status: 'invalid',
      reason: 'trade.insufficient-funds',
    });
    expect(itemOf(resolved.state, 'item.hero.sword').enchantment).toBeNull();
    expect(resolved.state.hero.currency).toBe(broke.hero.currency);
    expect(resolved.state.rng.enchanting).toEqual(broke.rng.enchanting);
  });
});
