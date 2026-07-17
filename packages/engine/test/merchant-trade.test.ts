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
  closeTradeIfInvalid,
  createDemoRun,
  materializeMerchant,
  quoteMerchantPurchase,
  quoteMerchantSale,
  reputationTier,
  resolveCommand,
  stableJson,
  validateActiveRun,
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
  // Permanent (town) merchants are never materialized through population placement, so this
  // suite exercises a non-permanent, dungeon-wandering merchant encounter.
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
  readonly currency?: number;
  readonly sightRadius?: number;
  readonly backpackCapacity?: number;
}

function merchantRun(options: FixtureOptions = {}): ActiveRun {
  const base = createDemoRun();
  const identified = allocateIdentificationMap({ content, rng: base.rng });
  const run: ActiveRun = {
    ...base,
    contentHash: content.hash,
    hero: {
      ...base.hero,
      currency: options.currency ?? base.hero.currency,
      sightRadius: options.sightRadius ?? base.hero.sightRadius,
      backpackCapacity: options.backpackCapacity ?? base.hero.backpackCapacity,
    },
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

const context = () => ({ content });

function merchantPopulation(run: ActiveRun): MerchantPopulation {
  return run.populations.find((population): population is MerchantPopulation =>
    population.model === 'merchant')!;
}

function openCommand(overrides: Partial<Extract<GameCommand, { type: 'trade-open' }>> = {}): GameCommand {
  return { type: 'trade-open', commandId: 'command.trade-open', expectedRevision: 0,
    merchantActorId: MERCHANT_ACTOR_ID, ...overrides };
}

function openedRun(options: FixtureOptions = {}): ActiveRun {
  const run = merchantRun(options);
  const opened = resolveCommand(run, openCommand(), context());
  if (opened.result.status !== 'applied') throw new Error(`fixture open failed: ${stableJson(opened.result)}`);
  return opened.state;
}

function buyCommand(overrides: Partial<Extract<GameCommand, { type: 'trade-buy' }>> = {}): GameCommand {
  return { type: 'trade-buy', commandId: 'command.trade-buy', expectedRevision: 1,
    merchantPopulationId: POPULATION_ID, itemId: 'item.stock.lamp-oil', quantity: 4, ...overrides };
}

function sellCommand(overrides: Partial<Extract<GameCommand, { type: 'trade-sell' }>> = {}): GameCommand {
  return { type: 'trade-sell', commandId: 'command.trade-sell', expectedRevision: 1,
    merchantPopulationId: POPULATION_ID, itemId: 'item.hero.sword', quantity: 1, ...overrides };
}

function closeCommand(overrides: Partial<Extract<GameCommand, { type: 'trade-close' }>> = {}): GameCommand {
  return { type: 'trade-close', commandId: 'command.trade-close', expectedRevision: 1,
    merchantPopulationId: POPULATION_ID, ...overrides };
}

/** Ignores the recorded-command log so atomicity compares only world state. */
function worldSnapshot(run: ActiveRun): string {
  return stableJson({ ...run, recentCommands: [] });
}

function expectUnchangedWorld(before: ActiveRun, after: ActiveRun): void {
  expect(worldSnapshot(after)).toBe(worldSnapshot(before));
  expect(after.rng).toEqual(before.rng);
}

function buyUnitPrice(definition: ItemContentEntry, reputation: number): number {
  return quoteMerchantPurchase({
    basePrice: definition.price, merchantBps: encounter.definition.merchantSaleBps,
    factionBps: reputationTier(reputation, faction).purchasePriceBps,
  });
}

function sellUnitPrice(definition: ItemContentEntry, reputation: number): number {
  return quoteMerchantSale({
    basePrice: definition.price, merchantBps: encounter.definition.merchantPurchaseBps,
    factionBps: reputationTier(reputation, faction).salePriceBps,
  });
}

describe('trade-open', () => {
  it('opens a trade advancing only the revision', () => {
    const run = merchantRun();
    const opened = resolveCommand(run, openCommand(), context());
    expect(opened.result).toMatchObject({ status: 'applied', revision: 1, turn: run.turn });
    expect(opened.state.worldTime).toBe(run.worldTime);
    expect(opened.state.turn).toBe(run.turn);
    expect(opened.state.revision).toBe(1);
    expect(opened.state.activeTrade).toEqual({
      merchantPopulationId: POPULATION_ID, merchantActorId: MERCHANT_ACTOR_ID,
      openedByCommandId: 'command.trade-open', openedAtRevision: 1, completedCommerce: false,
    });
    expect(opened.state.rng).toEqual(run.rng);
    expect(opened.state.survival).toEqual(run.survival);
    expect(opened.state.actors).toEqual(run.actors);
    expect(opened.state.items).toEqual(run.items);
    expect(opened.events).toEqual([{
      type: 'trade.opened', eventId: 'command.trade-open',
      merchantPopulationId: POPULATION_ID, merchantActorId: MERCHANT_ACTOR_ID,
    }]);
  });

  it('rejects a missing, dead, busy, hostile, or departure-due merchant', () => {
    const missing = resolveCommand(merchantRun(), openCommand({ merchantActorId: 'actor.absent' }), context());
    expect(missing.result).toMatchObject({ status: 'invalid', reason: 'merchant.unavailable', revision: 0, turn: 0 });

    const base = merchantRun();
    const dead = {
      ...base,
      actors: base.actors.map((actor) => actor.actorId === MERCHANT_ACTOR_ID ? { ...actor, health: 0 } : actor),
    };
    expect(resolveCommand(dead, openCommand(), context()).result)
      .toMatchObject({ status: 'invalid', reason: 'merchant.unavailable' });

    const fleeing = {
      ...base,
      populations: base.populations.map((population) => ({ ...population, lifecycle: 'fleeing' as const })),
    };
    expect(resolveCommand(fleeing, openCommand(), context()).result)
      .toMatchObject({ status: 'invalid', reason: 'merchant.unavailable' });

    const hostile = {
      ...base,
      relationships: [{ leftActorId: MERCHANT_ACTOR_ID, rightActorId: HERO_ID, relationship: 'hostile' as const }],
    };
    expect(resolveCommand(hostile, openCommand(), context()).result)
      .toMatchObject({ status: 'invalid', reason: 'merchant.unavailable' });

    const due = { ...base, worldTime: merchantPopulation(base).departureAt };
    expect(resolveCommand(due, openCommand(), context()).result)
      .toMatchObject({ status: 'invalid', reason: 'merchant.unavailable' });
  });

  it('rejects a merchant beyond adjacency or perception', () => {
    const far = resolveCommand(merchantRun({ position: { x: 4, y: 1 } }), openCommand(), context());
    expect(far.result).toMatchObject({ status: 'invalid', reason: 'merchant.out-of-range' });

    const blind = resolveCommand(merchantRun({ sightRadius: 0 }), openCommand(), context());
    expect(blind.result).toMatchObject({ status: 'invalid', reason: 'merchant.out-of-range' });
  });

  it('rejects a faction tier that refuses trade', () => {
    const refused = resolveCommand(merchantRun({ reputation: -300 }), openCommand(), context());
    expect(refused.result).toMatchObject({ status: 'invalid', reason: 'merchant.refuses' });
  });

  it('never opens two trades and consumes no randomness on failure', () => {
    const before = merchantRun();
    const opened = resolveCommand(before, openCommand(), context()).state;
    const again = resolveCommand(opened, openCommand({ commandId: 'command.trade-open-2', expectedRevision: 1 }), context());
    expect(again.result).toMatchObject({ status: 'invalid', reason: 'trade.active' });
    expect(again.state.activeTrade).toEqual(opened.activeTrade);
    expectUnchangedWorld(opened, again.state);
  });

  it('replays identical commands, rejects conflicting reuse, and rejects stale revisions', () => {
    const run = merchantRun();
    const first = resolveCommand(run, openCommand(), context());
    const replayed = resolveCommand(first.state, openCommand(), context());
    expect(replayed.state).toBe(first.state);
    expect(replayed.result).toEqual(first.result);
    expect(replayed.events).toEqual(first.events);

    const conflict = resolveCommand(first.state, openCommand({ merchantActorId: 'actor.other' }), context());
    expect(conflict.result).toMatchObject({ status: 'rejected', reason: 'command_id_conflict' });

    const stale = resolveCommand(first.state, openCommand({ commandId: 'command.trade-open-stale' }), context());
    expect(stale.result).toMatchObject({ status: 'rejected', reason: 'stale_revision' });
  });

  it('rejects every ordinary command while a trade is open', () => {
    const opened = openedRun();
    const ordinary: readonly GameCommand[] = [
      { type: 'move', commandId: 'command.blocked-move', expectedRevision: 1, direction: 'south' },
      { type: 'wait', commandId: 'command.blocked-wait', expectedRevision: 1 },
      { type: 'pickup', commandId: 'command.blocked-pickup', expectedRevision: 1, itemId: 'item.hero.oil', quantity: 1 },
      { type: 'rest', commandId: 'command.blocked-rest', expectedRevision: 1, until: 'healed', maximumDuration: 100 },
    ];
    for (const command of ordinary) {
      const rejected = resolveCommand(opened, command, context());
      expect(rejected.result).toMatchObject({ status: 'invalid', reason: 'trade.active', revision: 1, turn: 0 });
      expect(rejected.state.activeTrade).toEqual(opened.activeTrade);
      expect(rejected.state.worldTime).toBe(opened.worldTime);
      expectUnchangedWorld(opened, rejected.state);
    }
  });

  it('closes explicitly without commerce and grants no reputation', () => {
    const opened = openedRun();
    const closed = resolveCommand(opened, closeCommand(), context());
    expect(closed.result).toMatchObject({ status: 'applied', revision: 2, turn: 0 });
    expect(closed.state.activeTrade).toBeNull();
    expect(closed.state.reputations).toEqual([]);
    expect(merchantPopulation(closed.state).commerceBonusApplied).toBe(false);
    expect(closed.events).toEqual([{
      type: 'trade.closed', eventId: 'command.trade-close',
      merchantPopulationId: POPULATION_ID, reason: 'player', completedCommerce: false,
    }]);
  });
});

describe('trade-buy', () => {
  it('buys a full stock stack, merging into compatible backpack stacks at current-tier prices', () => {
    const opened = openedRun();
    const unit = buyUnitPrice(lampOil, faction.startingReputation);
    const bought = resolveCommand(opened, buyCommand(), context());
    expect(bought.result).toMatchObject({ status: 'applied', revision: 2, turn: 0 });
    expect(bought.state.worldTime).toBe(opened.worldTime);
    expect(bought.state.rng).toEqual(opened.rng);
    expect(bought.state.hero.currency).toBe(opened.hero.currency - unit * 4);
    expect(bought.state.items.find((entry) => entry.itemId === 'item.stock.lamp-oil')).toBeUndefined();
    expect(bought.state.items.find((entry) => entry.itemId === 'item.hero.oil'))
      .toMatchObject({ quantity: 6, location: { type: 'backpack', actorId: HERO_ID } });
    expect(merchantPopulation(bought.state).stockItemIds).toEqual(['item.stock.ration']);
    expect(bought.state.activeTrade?.completedCommerce).toBe(true);
    expect(bought.events).toEqual([{
      type: 'trade.bought', eventId: 'command.trade-buy', merchantPopulationId: POPULATION_ID,
      itemId: 'item.stock.lamp-oil', contentId: lampOil.id, quantity: 4,
      unitPrice: unit, total: unit * 4, currency: opened.hero.currency - unit * 4,
    }]);
  });

  it('buys a partial stack into a new backpack stack derived from the command id', () => {
    const opened = openedRun();
    const unit = buyUnitPrice(ration, faction.startingReputation);
    const bought = resolveCommand(opened,
      buyCommand({ itemId: 'item.stock.ration', quantity: 1 }), context());
    expect(bought.result).toMatchObject({ status: 'applied', revision: 2, turn: 0 });
    expect(bought.state.hero.currency).toBe(opened.hero.currency - unit);
    expect(bought.state.items.find((entry) => entry.itemId === 'item.stock.ration'))
      .toMatchObject({ quantity: 1, location: { type: 'merchant-stock', populationId: POPULATION_ID } });
    expect(bought.state.items.find((entry) => entry.itemId === 'command.trade-buy'))
      .toMatchObject({ contentId: ration.id, quantity: 1, location: { type: 'backpack', actorId: HERO_ID } });
    expect(merchantPopulation(bought.state).stockItemIds).toEqual(['item.stock.lamp-oil', 'item.stock.ration']);
    expect(bought.events).toEqual([{
      type: 'trade.bought', eventId: 'command.trade-buy', merchantPopulationId: POPULATION_ID,
      itemId: 'item.stock.ration', contentId: ration.id, quantity: 1,
      unitPrice: unit, total: unit, currency: opened.hero.currency - unit,
    }]);
  });

  it('relocates a fully bought stack that cannot merge, keeping its item id', () => {
    const opened = openedRun();
    const bought = resolveCommand(opened,
      buyCommand({ itemId: 'item.stock.ration', quantity: 2 }), context());
    expect(bought.result).toMatchObject({ status: 'applied' });
    expect(bought.state.items.find((entry) => entry.itemId === 'item.stock.ration'))
      .toMatchObject({ quantity: 2, location: { type: 'backpack', actorId: HERO_ID } });
    expect(merchantPopulation(bought.state).stockItemIds).toEqual(['item.stock.lamp-oil']);
  });

  it('quotes with the current reputation tier', () => {
    const trusted = openedRun({ reputation: 250 });
    const unit = buyUnitPrice(ration, 250);
    expect(unit).not.toBe(buyUnitPrice(ration, faction.startingReputation));
    const bought = resolveCommand(trusted,
      buyCommand({ itemId: 'item.stock.ration', quantity: 1 }), context());
    expect(bought.result).toMatchObject({ status: 'applied' });
    expect(bought.state.hero.currency).toBe(trusted.hero.currency - unit);
  });

  it.each([
    ['without an open session', {}, buyCommand({ expectedRevision: 0 }), 'trade.required', false],
    ['with a mismatched merchant', {}, buyCommand({ merchantPopulationId: 'population.other' }), 'trade.merchant-mismatch', true],
    ['for an item outside the merchant stock', {}, buyCommand({ itemId: 'item.hero.oil' }), 'trade.stock-unavailable', true],
    ['for a missing item', {}, buyCommand({ itemId: 'item.absent' }), 'trade.stock-unavailable', true],
    ['for more than the stock quantity', {}, buyCommand({ quantity: 5 }), 'item.quantity', true],
    ['for a nonpositive quantity', {}, buyCommand({ quantity: 0 }), 'item.quantity', true],
    ['without sufficient funds', { currency: 0 }, buyCommand(), 'trade.insufficient-funds', true],
    ['without backpack capacity', { backpackCapacity: 3 }, buyCommand({ itemId: 'item.stock.ration', quantity: 1 }), 'trade.capacity', true],
    ['with a conflicting split id', {}, buyCommand({ commandId: 'item.hero.sword', itemId: 'item.stock.ration', quantity: 1 }), 'item.id-conflict', true],
  ] as const)('rejects a buy %s atomically', (_label, options, command, reason, open) => {
    const before = open ? openedRun(options) : merchantRun(options);
    const result = resolveCommand(before, command, context());
    expect(result.result).toMatchObject({ status: 'invalid', reason });
    expectUnchangedWorld(before, result.state);
  });
});

describe('trade-sell', () => {
  it('sells a full backpack stack into merchant stock at current-tier prices', () => {
    const opened = openedRun();
    const unit = sellUnitPrice(sword, faction.startingReputation);
    const sold = resolveCommand(opened, sellCommand(), context());
    expect(sold.result).toMatchObject({ status: 'applied', revision: 2, turn: 0 });
    expect(sold.state.worldTime).toBe(opened.worldTime);
    expect(sold.state.rng).toEqual(opened.rng);
    expect(sold.state.hero.currency).toBe(opened.hero.currency + unit);
    expect(sold.state.items.find((entry) => entry.itemId === 'item.hero.sword'))
      .toMatchObject({ location: { type: 'merchant-stock', populationId: POPULATION_ID }, quantity: 1 });
    expect(merchantPopulation(sold.state).stockItemIds)
      .toEqual(['item.hero.sword', 'item.stock.lamp-oil', 'item.stock.ration']);
    expect(sold.state.activeTrade?.completedCommerce).toBe(true);
    expect(sold.events).toEqual([{
      type: 'trade.sold', eventId: 'command.trade-sell', merchantPopulationId: POPULATION_ID,
      itemId: 'item.hero.sword', contentId: sword.id, quantity: 1,
      unitPrice: unit, total: unit, currency: opened.hero.currency + unit,
    }]);
  });

  it('sells a partial stack into a new stock item derived from the command id', () => {
    const opened = openedRun();
    const unit = sellUnitPrice(lampOil, faction.startingReputation);
    const sold = resolveCommand(opened, sellCommand({ itemId: 'item.hero.oil', quantity: 1 }), context());
    expect(sold.result).toMatchObject({ status: 'applied' });
    expect(sold.state.hero.currency).toBe(opened.hero.currency + unit);
    expect(sold.state.items.find((entry) => entry.itemId === 'item.hero.oil'))
      .toMatchObject({ quantity: 1, location: { type: 'backpack', actorId: HERO_ID } });
    expect(sold.state.items.find((entry) => entry.itemId === 'command.trade-sell'))
      .toMatchObject({ contentId: lampOil.id, quantity: 1, location: { type: 'merchant-stock', populationId: POPULATION_ID } });
    expect(merchantPopulation(sold.state).stockItemIds)
      .toEqual(['command.trade-sell', 'item.stock.lamp-oil', 'item.stock.ration']);
  });

  it('quotes sales with the current reputation tier', () => {
    const trusted = openedRun({ reputation: 250 });
    const unit = sellUnitPrice(sword, 250);
    expect(unit).not.toBe(sellUnitPrice(sword, faction.startingReputation));
    const sold = resolveCommand(trusted, sellCommand(), context());
    expect(sold.result).toMatchObject({ status: 'applied' });
    expect(sold.state.hero.currency).toBe(trusted.hero.currency + unit);
  });

  it('rejects an equipped item without partial mutation', () => {
    const base = openedRun();
    const equipped = {
      ...base,
      actors: base.actors.map((actor) => actor.actorId === HERO_ID
        ? { ...actor, equipment: { ...actor.equipment, 'main-hand': 'item.hero.sword' } } : actor),
      items: base.items.map((entry) => entry.itemId === 'item.hero.sword'
        ? { ...entry, location: { type: 'equipped', actorId: HERO_ID, slot: 'main-hand' } as const } : entry),
    };
    const result = resolveCommand(equipped, sellCommand(), context());
    expect(result.result).toMatchObject({ status: 'invalid', reason: 'trade.item-unacceptable' });
    expectUnchangedWorld(equipped, result.state);
  });

  it('rejects an item in another actor\'s backpack', () => {
    const base = openedRun();
    const foreign = {
      ...base,
      items: base.items.map((entry) => entry.itemId === 'item.hero.sword'
        ? { ...entry, location: { type: 'backpack', actorId: MERCHANT_ACTOR_ID } as const } : entry),
    };
    const result = resolveCommand(foreign, sellCommand(), context());
    expect(result.result).toMatchObject({ status: 'invalid', reason: 'trade.item-unacceptable' });
    expectUnchangedWorld(foreign, result.state);
  });

  it.each([
    ['without an open session', sellCommand({ expectedRevision: 0 }), 'trade.required', false, {}],
    ['with a mismatched merchant', sellCommand({ merchantPopulationId: 'population.other' }), 'trade.merchant-mismatch', true, {}],
    ['for a missing item', sellCommand({ itemId: 'item.absent' }), 'item.missing', true, {}],
    ['for an unaccepted category', sellCommand({ itemId: 'item.hero.ring' }), 'trade.item-unacceptable', true, {}],
    ['for more than the held quantity', sellCommand({ itemId: 'item.hero.oil', quantity: 3 }), 'item.quantity', true, {}],
    ['for a nonpositive quantity', sellCommand({ quantity: 0 }), 'item.quantity', true, {}],
    ['when the payout would overflow currency', sellCommand(), 'trade.insufficient-funds', true, { currency: Number.MAX_SAFE_INTEGER }],
    ['with a conflicting split id', sellCommand({ commandId: 'item.stock.ration', itemId: 'item.hero.oil', quantity: 1 }), 'item.id-conflict', true, {}],
  ] as const)('rejects a sell %s atomically', (_label, command, reason, open, options) => {
    const before = open ? openedRun(options) : merchantRun(options);
    const result = resolveCommand(before, command, context());
    expect(result.result).toMatchObject({ status: 'invalid', reason });
    expectUnchangedWorld(before, result.state);
  });
});

describe('trade-close and commerce consequence', () => {
  function boughtRun(): ActiveRun {
    const opened = openedRun();
    return resolveCommand(opened, buyCommand({ itemId: 'item.stock.ration', quantity: 1 }), context()).state;
  }

  it('grants the commerce delta exactly once on explicit close after commerce', () => {
    const bought = boughtRun();
    const closed = resolveCommand(bought, closeCommand({ expectedRevision: 2 }), context());
    expect(closed.result).toMatchObject({ status: 'applied', revision: 3, turn: 0 });
    expect(closed.state.activeTrade).toBeNull();
    expect(merchantPopulation(closed.state).commerceBonusApplied).toBe(true);
    expect(closed.state.reputations).toEqual([{
      factionId: faction.id, value: faction.startingReputation + encounter.definition.commerceReputationDelta,
    }]);
    expect(closed.events).toEqual([
      { type: 'trade.closed', eventId: 'command.trade-close', merchantPopulationId: POPULATION_ID,
        reason: 'player', completedCommerce: true },
      { type: 'reputation.changed', eventId: 'command.trade-close', factionId: faction.id,
        previous: faction.startingReputation, delta: encounter.definition.commerceReputationDelta,
        value: faction.startingReputation + encounter.definition.commerceReputationDelta, reason: 'commerce' },
    ]);

    const reopened = resolveCommand(closed.state,
      openCommand({ commandId: 'command.trade-open-2', expectedRevision: 3 }), context()).state;
    const resold = resolveCommand(reopened,
      sellCommand({ commandId: 'command.trade-sell-2', expectedRevision: 4 }), context()).state;
    const closedAgain = resolveCommand(resold,
      closeCommand({ commandId: 'command.trade-close-2', expectedRevision: 5 }), context());
    expect(closedAgain.result).toMatchObject({ status: 'applied' });
    expect(closedAgain.events).toEqual([
      { type: 'trade.closed', eventId: 'command.trade-close-2', merchantPopulationId: POPULATION_ID,
        reason: 'player', completedCommerce: true },
    ]);
    expect(closedAgain.state.reputations).toEqual([{
      factionId: faction.id, value: faction.startingReputation + encounter.definition.commerceReputationDelta,
    }]);
  });

  it('rejects close without a session or against the wrong merchant', () => {
    const closedWithoutSession = resolveCommand(merchantRun(), closeCommand({ expectedRevision: 0 }), context());
    expect(closedWithoutSession.result).toMatchObject({ status: 'invalid', reason: 'trade.required' });

    const opened = openedRun();
    const mismatched = resolveCommand(opened,
      closeCommand({ merchantPopulationId: 'population.other' }), context());
    expect(mismatched.result).toMatchObject({ status: 'invalid', reason: 'trade.merchant-mismatch' });
    expectUnchangedWorld(opened, mismatched.state);
  });

  it('keeps a valid session untouched in the automatic-close helper', () => {
    const opened = openedRun();
    const normalized = closeTradeIfInvalid({ state: opened, content, eventId: 'event.normalize' });
    expect(normalized.state).toBe(opened);
    expect(normalized.events).toEqual([]);
  });

  it('closes an invalidated session without granting the commerce bonus', () => {
    const bought = boughtRun();
    const merchantDead = {
      ...bought,
      actors: bought.actors.map((actor) => actor.actorId === MERCHANT_ACTOR_ID ? { ...actor, health: 0 } : actor),
    };
    const normalized = closeTradeIfInvalid({ state: merchantDead, content, eventId: 'event.normalize' });
    expect(normalized.state.activeTrade).toBeNull();
    expect(normalized.state.reputations).toEqual([]);
    expect(merchantPopulation(normalized.state).commerceBonusApplied).toBe(false);
    expect(normalized.events).toEqual([{
      type: 'trade.closed', eventId: 'event.normalize', merchantPopulationId: POPULATION_ID,
      reason: 'death', completedCommerce: true,
    }]);

    const moved = {
      ...bought,
      actors: bought.actors.map((actor) => actor.actorId === MERCHANT_ACTOR_ID ? { ...actor, x: 4, y: 3 } : actor),
    };
    const outOfRange = closeTradeIfInvalid({ state: moved, content, eventId: 'event.normalize' });
    expect(outOfRange.state.activeTrade).toBeNull();
    expect(outOfRange.events).toEqual([{
      type: 'trade.closed', eventId: 'event.normalize', merchantPopulationId: POPULATION_ID,
      reason: 'unavailable', completedCommerce: true,
    }]);
  });

  it('emits the automatic close before resolving the next ordinary command', () => {
    const opened = openedRun();
    const merchantDead = {
      ...opened,
      actors: opened.actors.map((actor) => actor.actorId === MERCHANT_ACTOR_ID ? { ...actor, health: 0 } : actor),
    };
    const waited = resolveCommand(merchantDead,
      { type: 'wait', commandId: 'command.wait-after-close', expectedRevision: 1 }, context());
    expect(waited.result).toMatchObject({ status: 'applied', revision: 2, turn: 1 });
    expect(waited.state.activeTrade).toBeNull();
    expect(waited.events[0]).toEqual({
      type: 'trade.closed', eventId: 'command.wait-after-close', merchantPopulationId: POPULATION_ID,
      reason: 'death', completedCommerce: false,
    });
    expect(waited.events.some((event) => event.type === 'hero.waited')).toBe(true);
  });

  it('keeps the automatic close when the next command only requires a decision', () => {
    // Reputation dropped to the refused tier invalidates the open session; the next command bumps
    // the still-neutral adjacent merchant, which requires an aggression decision instead of
    // resolving. The normalization must not be discarded with the unrecorded command.
    const opened = openedRun();
    const refused = { ...opened, reputations: [{ factionId: faction.id, value: -500 }] };
    const resolution = resolveCommand(refused,
      { type: 'move', commandId: 'command.bump-merchant', expectedRevision: 1, direction: 'east' },
      context());
    expect(resolution.result).toMatchObject({
      status: 'decision_required', revision: 1,
      decision: { type: 'confirm-aggression', targetActorId: MERCHANT_ACTOR_ID },
    });
    expect(resolution.state.activeTrade).toBeNull();
    expect(resolution.events).toEqual([expect.objectContaining({
      type: 'trade.closed', merchantPopulationId: POPULATION_ID, reason: 'unavailable',
    })]);
  });

  it('keeps a full trade session valid under save validation', () => {
    const opened = openedRun();
    let state = resolveCommand(opened, buyCommand({ itemId: 'item.stock.ration', quantity: 1 }), context()).state;
    state = resolveCommand(state, sellCommand({ expectedRevision: 2 }), context()).state;
    state = resolveCommand(state, closeCommand({ expectedRevision: 3 }), context()).state;
    expect(state.revision).toBe(4);
    expect(state.turn).toBe(0);
    expect(() => validateActiveRun(structuredClone(state))).not.toThrow();
  });
});
