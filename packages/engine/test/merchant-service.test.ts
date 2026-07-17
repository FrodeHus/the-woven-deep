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
  decodeActiveRun,
  encodeActiveRun,
  materializeMerchant,
  quoteMerchantService,
  reputationTier,
  resolveCommand,
  stableJson,
  validateActiveRun,
  validateTradeCommand,
  type ActiveRun,
  type GameCommand,
  type ItemInstance,
  type MerchantPopulation,
  type MerchantServiceState,
} from '../src/index.js';

let content: CompiledContentPack;
let encounter: MerchantEncounterContentEntry;
let faction: NpcFactionContentEntry;
let ring: ItemContentEntry;
let potion: ItemContentEntry;

const POPULATION_ID = 'population.merchant-demo';
const MERCHANT_ACTOR_ID = `actor.${POPULATION_ID}.001`;
const HERO_ID = 'hero.demo';

beforeAll(async () => {
  content = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
  encounter = content.entries.find((entry): entry is MerchantEncounterContentEntry =>
    entry.kind === 'encounter' && entry.model === 'merchant' && !entry.definition.permanent)!;
  faction = content.entries.find((entry): entry is NpcFactionContentEntry => entry.kind === 'npc-faction')!;
  ring = content.entries.find((entry): entry is ItemContentEntry => entry.kind === 'item' && entry.id === 'item.etched-ring')!;
  potion = content.entries.find((entry): entry is ItemContentEntry => entry.kind === 'item' && entry.id === 'item.crimson-potion')!;
});

function item(itemId: string, contentId: string, quantity: number, location: ItemInstance['location'],
  overrides: Partial<ItemInstance> = {}): ItemInstance {
  return { itemId, contentId, quantity, condition: 100, enchantment: null, identified: true,
    charges: null, fuel: null, enabled: null, location, ...overrides };
}

interface FixtureOptions {
  readonly reputation?: number;
  readonly currency?: number;
  readonly uses?: number;
}

function merchantRun(options: FixtureOptions = {}): ActiveRun {
  const base = createDemoRun();
  const identified = allocateIdentificationMap({ content, rng: base.rng });
  const run: ActiveRun = {
    ...base,
    contentHash: content.hash,
    hero: { ...base.hero, currency: options.currency ?? base.hero.currency },
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
    floorId: 'floor.demo', position: { x: 2, y: 1 },
  });
  const heroItems: ItemInstance[] = [
    item('item.hero.unknown', ring.id, 1, { type: 'backpack', actorId: HERO_ID }, { identified: false }),
    item('item.hero.worn', ring.id, 1, { type: 'equipped', actorId: HERO_ID, slot: 'left-ring' }, { identified: false }),
    item('item.hero.potion', potion.id, 1, { type: 'backpack', actorId: HERO_ID }, { identified: false }),
    item('item.hero.sword', 'item.iron-sword', 1, { type: 'backpack', actorId: HERO_ID }),
    item('item.foreign.ring', ring.id, 1, { type: 'backpack', actorId: MERCHANT_ACTOR_ID }, { identified: false }),
    item('item.stock.ring', ring.id, 1, { type: 'merchant-stock', populationId: POPULATION_ID }, { identified: false }),
  ];
  const stockIds = ['item.stock.ring'];
  const population: MerchantPopulation = {
    ...materialized.population,
    initialStockItemIds: stockIds, stockItemIds: stockIds,
    services: materialized.population.services.map((entry) => ({ ...entry, remainingUses: options.uses ?? 2 })),
  };
  const heroActor = run.actors.find((actor) => actor.actorId === HERO_ID)!;
  return {
    ...run,
    rng: { ...run.rng, 'merchant-stock': materialized.nextMerchantStockState },
    actors: [
      { ...heroActor, equipment: { ...heroActor.equipment, 'left-ring': 'item.hero.worn' } },
      ...run.actors.filter((actor) => actor.actorId !== HERO_ID),
      materialized.actor,
    ].sort((left, right) => left.actorId < right.actorId ? -1 : 1),
    items: heroItems.sort((left, right) => left.itemId < right.itemId ? -1 : 1),
    populations: [population],
  };
}

const context = () => ({ content });

function merchantPopulation(run: ActiveRun): MerchantPopulation {
  return run.populations.find((population): population is MerchantPopulation =>
    population.model === 'merchant')!;
}

function service(run: ActiveRun): MerchantServiceState {
  return merchantPopulation(run).services.find((entry) => entry.serviceId === 'merchant-service.identify')!;
}

function openedRun(options: FixtureOptions = {}): ActiveRun {
  const run = merchantRun(options);
  const opened = resolveCommand(run, { type: 'trade-open', commandId: 'command.trade-open',
    expectedRevision: 0, merchantActorId: MERCHANT_ACTOR_ID }, context());
  if (opened.result.status !== 'applied') throw new Error(`fixture open failed: ${stableJson(opened.result)}`);
  return opened.state;
}

function serviceCommand(overrides: Partial<Extract<GameCommand, { type: 'trade-service' }>> = {}): GameCommand {
  return { type: 'trade-service', commandId: 'command.identify', expectedRevision: 1,
    merchantPopulationId: POPULATION_ID, serviceId: 'merchant-service.identify',
    targetItemId: 'item.hero.unknown', ...overrides };
}

/** Ignores the recorded-command log so atomicity compares only world state. */
function worldSnapshot(run: ActiveRun): string {
  return stableJson({ ...run, recentCommands: [] });
}

function expectUnchangedWorld(before: ActiveRun, after: ActiveRun): void {
  expect(worldSnapshot(after)).toBe(worldSnapshot(before));
  expect(after.rng).toEqual(before.rng);
}

function servicePrice(reputation: number): number {
  return quoteMerchantService({
    basePrice: encounter.definition.services[0]!.basePrice,
    factionBps: reputationTier(reputation, faction).purchasePriceBps,
  });
}

describe('trade-service identification', () => {
  it('identifies an unidentified backpack instance at the current-tier price', () => {
    const runWithTrade = openedRun();
    const price = servicePrice(faction.startingReputation);
    const resolved = resolveCommand(runWithTrade, serviceCommand(), context());
    expect(resolved.result).toMatchObject({ status: 'applied', revision: 2, turn: 0 });
    expect(resolved.state.worldTime).toBe(runWithTrade.worldTime);
    expect(resolved.state.rng).toEqual(runWithTrade.rng);
    expect(resolved.state.hero.currency).toBe(runWithTrade.hero.currency - price);
    expect(resolved.state.items.find((entry) => entry.itemId === 'item.hero.unknown')?.identified).toBe(true);
    expect(service(resolved.state).remainingUses).toBe(service(runWithTrade).remainingUses - 1);
    expect(resolved.state.activeTrade?.completedCommerce).toBe(true);
    // Instance identification never leaks the shared shuffled-appearance map.
    expect(resolved.state.identification.knownAppearanceIds).toEqual([]);
    expect(resolved.events).toEqual([
      { type: 'trade.service-purchased', eventId: 'command.identify', merchantPopulationId: POPULATION_ID,
        serviceId: 'merchant-service.identify', targetItemId: 'item.hero.unknown',
        price, currency: runWithTrade.hero.currency - price, remainingUses: 1 },
      { type: 'item.identified', eventId: 'command.identify', itemId: 'item.hero.unknown' },
    ]);
  });

  it('identifies an equipped unidentified instance', () => {
    const runWithTrade = openedRun();
    const resolved = resolveCommand(runWithTrade, serviceCommand({ targetItemId: 'item.hero.worn' }), context());
    expect(resolved.result).toMatchObject({ status: 'applied', revision: 2, turn: 0 });
    expect(resolved.state.items.find((entry) => entry.itemId === 'item.hero.worn')?.identified).toBe(true);
    expect(service(resolved.state).remainingUses).toBe(1);
    expect(resolved.state.activeTrade?.completedCommerce).toBe(true);
  });

  it('reveals a shuffled appearance and marks the instance identified', () => {
    const runWithTrade = openedRun();
    const price = servicePrice(faction.startingReputation);
    const appearanceId = runWithTrade.identification.appearanceByContentId[potion.id]!;
    const resolved = resolveCommand(runWithTrade, serviceCommand({ targetItemId: 'item.hero.potion' }), context());
    expect(resolved.result).toMatchObject({ status: 'applied', revision: 2, turn: 0 });
    expect(resolved.state.identification.knownAppearanceIds).toEqual([appearanceId]);
    expect(resolved.state.items.find((entry) => entry.itemId === 'item.hero.potion')?.identified).toBe(true);
    expect(resolved.events).toEqual([
      { type: 'trade.service-purchased', eventId: 'command.identify', merchantPopulationId: POPULATION_ID,
        serviceId: 'merchant-service.identify', targetItemId: 'item.hero.potion',
        price, currency: runWithTrade.hero.currency - price, remainingUses: 1 },
      { type: 'identification.appearance-revealed', eventId: 'command.identify',
        appearanceId, contentId: potion.id },
      { type: 'item.identified', eventId: 'command.identify', itemId: 'item.hero.potion' },
    ]);
  });

  it('quotes the service with the current reputation tier, rounding up to at least one', () => {
    const neutral = servicePrice(faction.startingReputation);
    const trusted = servicePrice(250);
    expect(neutral).not.toBe(trusted);
    expect(neutral).toBeGreaterThanOrEqual(1);
    const runWithTrade = openedRun({ reputation: 250 });
    const resolved = resolveCommand(runWithTrade, serviceCommand(), context());
    expect(resolved.result).toMatchObject({ status: 'applied' });
    expect(resolved.state.hero.currency).toBe(runWithTrade.hero.currency - trusted);
  });

  it('decrements exactly one use per success and persists uses across save/load', () => {
    const runWithTrade = openedRun();
    const first = resolveCommand(runWithTrade, serviceCommand(), context());
    expect(service(first.state).remainingUses).toBe(1);
    const reloaded = decodeActiveRun(encodeActiveRun(first.state));
    expect(reloaded).toEqual(first.state);
    expect(service(reloaded).remainingUses).toBe(1);

    const second = resolveCommand(reloaded, serviceCommand({
      commandId: 'command.identify-2', expectedRevision: 2, targetItemId: 'item.hero.worn',
    }), context());
    expect(second.result).toMatchObject({ status: 'applied' });
    expect(service(second.state).remainingUses).toBe(0);

    const exhausted = resolveCommand(second.state, serviceCommand({
      commandId: 'command.identify-3', expectedRevision: 3, targetItemId: 'item.hero.potion',
    }), context());
    expect(exhausted.result).toMatchObject({ status: 'invalid', reason: 'trade.service-unavailable' });
    expectUnchangedWorld(second.state, exhausted.state);
  });

  it.each([
    ['without an open session', {}, serviceCommand({ expectedRevision: 0 }), 'trade.required', false],
    ['with a mismatched merchant', {}, serviceCommand({ merchantPopulationId: 'population.other' }), 'trade.merchant-mismatch', true],
    ['with an exhausted offer', { uses: 0 }, serviceCommand(), 'trade.service-unavailable', true],
    ['at a tier outside the faction allow-list', { reputation: -100 }, serviceCommand(), 'trade.service-unavailable', true],
    ['without sufficient funds', { currency: 0 }, serviceCommand(), 'trade.insufficient-funds', true],
    ['for a missing target', {}, serviceCommand({ targetItemId: 'item.absent' }), 'trade.target-invalid', true],
    ['for an already identified target', {}, serviceCommand({ targetItemId: 'item.hero.sword' }), 'trade.target-invalid', true],
    ['for another actor\'s item', {}, serviceCommand({ targetItemId: 'item.foreign.ring' }), 'trade.target-invalid', true],
    ['for a merchant stock item', {}, serviceCommand({ targetItemId: 'item.stock.ring' }), 'trade.target-invalid', true],
  ] as const)('rejects a service %s atomically', (_label, options, command, reason, open) => {
    const before = open ? openedRun(options) : merchantRun(options);
    const result = resolveCommand(before, command, context());
    expect(result.result).toMatchObject({ status: 'invalid', reason });
    expectUnchangedWorld(before, result.state);
  });

  it('requires both the faction tier allow-list and the merchant offer tier ids', () => {
    const opened = openedRun();
    const withoutOffer = {
      ...opened,
      populations: opened.populations.map((population) => population.model === 'merchant'
        ? { ...population, services: [] } : population),
    };
    expect(validateTradeCommand({ state: withoutOffer, content,
      command: serviceCommand() as Extract<GameCommand, { type: 'trade-service' }> }))
      .toEqual({ ok: false, reason: 'trade.service-unavailable' });

    const tierGated = {
      ...opened,
      populations: opened.populations.map((population) => population.model === 'merchant'
        ? { ...population, services: population.services.map((entry) => ({ ...entry, tierIds: ['trusted'] })) }
        : population),
    };
    expect(validateTradeCommand({ state: tierGated, content,
      command: serviceCommand() as Extract<GameCommand, { type: 'trade-service' }> }))
      .toEqual({ ok: false, reason: 'trade.service-unavailable' });
  });

  it('keeps a full service session valid under save validation', () => {
    const opened = openedRun();
    let state = resolveCommand(opened, serviceCommand(), context()).state;
    state = resolveCommand(state, { type: 'trade-close', commandId: 'command.trade-close',
      expectedRevision: 2, merchantPopulationId: POPULATION_ID }, context()).state;
    expect(state.revision).toBe(3);
    expect(state.turn).toBe(0);
    expect(() => validateActiveRun(structuredClone(state))).not.toThrow();
    expect(decodeActiveRun(encodeActiveRun(state))).toEqual(state);
  });
});
