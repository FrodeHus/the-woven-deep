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
  allocateIdentificationMap,
  createDemoRun,
  materializeMerchant,
  projectGameplayState,
  projectItem,
  quoteMerchantPurchase,
  quoteMerchantSale,
  quoteMerchantService,
  resolveCommand,
  stableJson,
  type ActiveRun,
  type GameCommand,
  type ItemInstance,
  type MerchantPopulation,
} from '../src/index.js';

let content: CompiledContentPack;
let encounter: MerchantEncounterContentEntry;
let faction: NpcFactionContentEntry;
let lampOil: ItemContentEntry;
let ration: ItemContentEntry;
let sword: ItemContentEntry;

const POPULATION_ID = 'population.merchant-demo';
const MERCHANT_ACTOR_ID = `actor.${POPULATION_ID}.001`;
const HERO_ID = 'hero.demo';

beforeAll(async () => {
  content = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
  encounter = content.entries.find((entry): entry is MerchantEncounterContentEntry =>
    entry.kind === 'encounter' && entry.model === 'merchant' && !entry.definition.permanent)!;
  faction = content.entries.find((entry): entry is NpcFactionContentEntry => entry.kind === 'npc-faction')!;
  lampOil = content.entries.find((entry): entry is ItemContentEntry => entry.kind === 'item' && entry.id === 'item.lamp-oil')!;
  ration = content.entries.find((entry): entry is ItemContentEntry => entry.kind === 'item' && entry.id === 'item.travel-ration')!;
  sword = content.entries.find((entry): entry is ItemContentEntry => entry.kind === 'item' && entry.id === 'item.iron-sword')!;
});

function item(itemId: string, contentId: string, quantity: number, location: ItemInstance['location'],
  overrides: Partial<ItemInstance> = {}): ItemInstance {
  return { itemId, contentId, quantity, condition: 100, enchantment: null, identified: true,
    charges: null, fuel: null, enabled: null, location, ...overrides };
}

interface FixtureOptions {
  readonly position?: Readonly<{ x: number; y: number }>;
  readonly reputation?: number;
  readonly unidentifiedStock?: boolean;
}

function merchantRun(options: FixtureOptions = {}): ActiveRun {
  const base = createDemoRun();
  const identified = allocateIdentificationMap({ content, rng: base.rng });
  const run: ActiveRun = {
    ...base,
    contentHash: content.hash,
    identification: identified.identification,
    rng: identified.rng,
    reputations: options.reputation === undefined ? [] : [{ factionId: faction.id, value: options.reputation }],
    encounterDecisions: content.entries.filter((entry) => entry.kind === 'encounter')
      .sort((left, right) => left.id < right.id ? -1 : 1)
      .map((entry) => ({
        encounterId: entry.id, baseProbability: entry.runAppearanceChance, protectionBonus: 0,
        effectiveProbability: entry.runAppearanceChance, eligible: true, reachedEligibleDepth: false,
        encountered: false, instancesCreated: entry.id === encounter.id ? 1 : 0,
      })),
  };
  const materialized = materializeMerchant({
    run, content, encounter, populationId: POPULATION_ID,
    floorId: 'floor.demo', position: options.position ?? { x: 2, y: 1 },
  });
  const stock: ItemInstance[] = [
    item('item.stock.lamp-oil', lampOil.id, 4, { type: 'merchant-stock', populationId: POPULATION_ID }),
    item('item.stock.ration', ration.id, 2, { type: 'merchant-stock', populationId: POPULATION_ID }),
    ...(options.unidentifiedStock ? [item('item.stock.ring', 'item.etched-ring', 1,
      { type: 'merchant-stock', populationId: POPULATION_ID }, { identified: false })] : []),
  ];
  const heroItems: ItemInstance[] = [
    item('item.hero.oil', lampOil.id, 2, { type: 'backpack', actorId: HERO_ID }),
    item('item.hero.ring', 'item.etched-ring', 1, { type: 'backpack', actorId: HERO_ID }, { identified: false }),
    item('item.hero.sword', sword.id, 1, { type: 'backpack', actorId: HERO_ID }),
  ];
  const stockIds = stock.map((entry) => entry.itemId).sort();
  const population: MerchantPopulation = {
    ...materialized.population, initialStockItemIds: stockIds, stockItemIds: stockIds,
  };
  return {
    ...run,
    rng: { ...run.rng, 'merchant-stock': materialized.nextMerchantStockState },
    actors: [...run.actors, materialized.actor]
      .sort((left, right) => left.actorId < right.actorId ? -1 : 1),
    items: [...stock, ...heroItems].sort((left, right) => left.itemId < right.itemId ? -1 : 1),
    populations: [population],
  };
}

function merchantPopulation(run: ActiveRun): MerchantPopulation {
  return run.populations.find((population): population is MerchantPopulation =>
    population.model === 'merchant')!;
}

function openedRun(options: FixtureOptions = {}): ActiveRun {
  const run = merchantRun(options);
  const open: GameCommand = { type: 'trade-open', commandId: 'command.trade-open', expectedRevision: 0,
    merchantActorId: MERCHANT_ACTOR_ID };
  const opened = resolveCommand(run, open, { content });
  if (opened.result.status !== 'applied') throw new Error(`fixture open failed: ${stableJson(opened.result)}`);
  return opened.state;
}

const neutralTier = () => faction.tiers.find((tier) => tier.tierId === 'neutral')!;

describe('visible merchant projection', () => {
  it('projects qualitative merchant state on the visible actor only', () => {
    const run = merchantRun();
    const projected = projectGameplayState({ state: run, content });
    expect(projected.actors).toEqual([expect.objectContaining({
      actorId: MERCHANT_ACTOR_ID, name: 'Travelling Lampwright', glyph: 'L', color: '#ffd166',
      disposition: 'neutral', intent: 'hold',
      healthPresentation: { current: 20, maximum: 20, band: 'healthy' },
      factionName: 'Lampwrights', reputationTier: 'neutral', tradeAvailable: true,
    })]);
    expect(projected.actors[0]).not.toHaveProperty('departureWarning');
    const json = stableJson(projected);
    for (const secret of ['departureAt', 'rolledLifetime', 'emittedWarningThresholds', 'stockItemIds',
      'merchant-stock', 'remainingUses', 'basePrice', 'item.stock.lamp-oil', 'item.stock.ration',
      'commerceBonusApplied', 'npcId']) {
      expect(json, secret).not.toContain(secret);
    }
  });

  it('derives only the most urgent emitted departure warning, never the deadline', () => {
    const base = merchantRun();
    const population = merchantPopulation(base);
    const run: ActiveRun = {
      ...base,
      populations: [{ ...population, emittedWarningThresholds: [1000, 500] }],
    };
    const projected = projectGameplayState({ state: run, content });
    expect(projected.actors[0]).toMatchObject({ departureWarning: 500 });
    const json = stableJson(projected);
    expect(json).not.toContain('departureAt');
    expect(json).not.toContain('1000');
    expect(json).not.toContain(String(population.departureAt));
  });

  it('projects nothing at all for an unseen merchant', () => {
    const run = merchantRun({ position: { x: 5, y: 3 } });
    const projected = projectGameplayState({ state: run, content });
    expect(projected.actors).toEqual([]);
    const json = stableJson(projected);
    for (const secret of ['Lampwright', 'lampwrights', 'merchant', 'departureAt', 'item.stock',
      'factionName', 'tradeAvailable', 'departureWarning', 'services']) {
      expect(json, secret).not.toContain(secret);
    }
  });
});

describe('active trade projection', () => {
  it('is absent without an active trade session', () => {
    const projected = projectGameplayState({ state: merchantRun(), content });
    expect(projected).not.toHaveProperty('trade');
    expect(JSON.stringify(projected)).not.toContain('merchant-stock');
  });

  it('exposes exact currency, stock quotes, sale offers, and service targets in a valid session', () => {
    const runWithTrade = openedRun();
    const tier = neutralTier();
    const population = merchantPopulation(runWithTrade);
    const projected = projectGameplayState({ state: runWithTrade, content });
    expect(projected.trade).toMatchObject({
      merchantPopulationId: population.populationId,
      merchantActorId: MERCHANT_ACTOR_ID,
      merchantName: 'Travelling Lampwright',
      factionName: 'Lampwrights',
      reputationTier: 'neutral',
      currency: runWithTrade.hero.currency,
    });
    const stockId = 'item.stock.lamp-oil';
    expect(projected.trade?.stock[0]?.item).toEqual(projectItem({ run: runWithTrade, content, itemId: stockId }));
    expect(projected.trade?.stock).toEqual([
      { item: projectItem({ run: runWithTrade, content, itemId: 'item.stock.lamp-oil' }), quantity: 4,
        unitPrice: quoteMerchantPurchase({ basePrice: lampOil.price,
          merchantBps: encounter.definition.merchantSaleBps, factionBps: tier.purchasePriceBps }) },
      { item: projectItem({ run: runWithTrade, content, itemId: 'item.stock.ration' }), quantity: 2,
        unitPrice: quoteMerchantPurchase({ basePrice: ration.price,
          merchantBps: encounter.definition.merchantSaleBps, factionBps: tier.purchasePriceBps }) },
    ]);
    expect(projected.trade?.saleOffers).toEqual([
      { itemId: 'item.hero.oil', quantity: 2,
        unitPrice: quoteMerchantSale({ basePrice: lampOil.price,
          merchantBps: encounter.definition.merchantPurchaseBps, factionBps: tier.salePriceBps }) },
      { itemId: 'item.hero.sword', quantity: 1,
        unitPrice: quoteMerchantSale({ basePrice: sword.price,
          merchantBps: encounter.definition.merchantPurchaseBps, factionBps: tier.salePriceBps }) },
    ]);
    expect(projected.trade?.services).toEqual([{
      serviceId: 'merchant-service.identify',
      unitPrice: quoteMerchantService({
        basePrice: population.services[0]!.basePrice, factionBps: tier.purchasePriceBps }),
      remainingUses: population.services[0]!.remainingUses,
      targetItemIds: ['item.hero.ring'],
    }]);
    expect(JSON.stringify(projected)).not.toContain('merchant-stock');
  });

  it('projects unidentified stock as its appearance-only representation', () => {
    const runWithTrade = openedRun({ unidentifiedStock: true });
    const projected = projectGameplayState({ state: runWithTrade, content });
    const ring = projected.trade?.stock.find((entry) =>
      (entry.item as { itemId?: string }).itemId === 'item.stock.ring');
    expect(ring).toBeDefined();
    expect(ring?.item).toEqual(projectItem({ run: runWithTrade, content, itemId: 'item.stock.ring' }));
    expect(ring?.item).not.toHaveProperty('contentId');
    expect(ring?.item).not.toHaveProperty('effects');
    expect(ring?.item).toMatchObject({ identified: false });
    expect(JSON.stringify(ring)).not.toContain('item.etched-ring');
  });

  it('omits reputation-refused services from the session', () => {
    const runWithTrade = openedRun({ reputation: -100 });
    const projected = projectGameplayState({ state: runWithTrade, content });
    expect(projected.trade).toMatchObject({ reputationTier: 'wary' });
    expect(projected.trade?.services).toEqual([]);
  });

  it('is absent when the modal session invariants no longer hold', () => {
    const opened = openedRun();
    const separated: ActiveRun = {
      ...opened,
      actors: opened.actors.map((actor) => actor.actorId === HERO_ID ? { ...actor, x: 4, y: 3 } : actor),
    };
    const projected = projectGameplayState({ state: separated, content });
    expect(projected).not.toHaveProperty('trade');
    expect(JSON.stringify(projected)).not.toContain('merchant-stock');
  });
});
