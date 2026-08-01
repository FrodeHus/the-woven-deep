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
  stableJson,
  unequipItem,
  type ActiveRun,
  type GameCommand,
  type ItemInstance,
  type MerchantPopulation,
} from '../src/index.js';

let content: CompiledContentPack;
let encounter: MerchantEncounterContentEntry;
let faction: NpcFactionContentEntry;
let ring: ItemContentEntry;
let sword: ItemContentEntry;

const POPULATION_ID = 'population.curios-demo';
const MERCHANT_ACTOR_ID = `actor.${POPULATION_ID}.001`;
const HERO_ID = 'hero.demo';

beforeAll(async () => {
  content = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
  encounter = content.entries.find(
    (entry): entry is MerchantEncounterContentEntry =>
      entry.kind === 'encounter' && entry.model === 'merchant' && entry.id === 'encounter.town-curios-dealer',
  )!;
  faction = content.entries.find(
    (entry): entry is NpcFactionContentEntry => entry.id === 'npc-faction.town-curios-dealer',
  )!;
  ring = content.entries.find(
    (entry): entry is ItemContentEntry => entry.kind === 'item' && entry.id === 'item.etched-ring',
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

const CURSE_ID = 'curse.hungering-edge';

function curiosRun(options: FixtureOptions = {}): ActiveRun {
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
    item('item.hero.clean', ring.id, { type: 'backpack', actorId: HERO_ID }),
    item('item.hero.unidentified', ring.id, { type: 'backpack', actorId: HERO_ID }, { identified: false }),
    item(
      'item.hero.hidden-cursed',
      ring.id,
      { type: 'backpack', actorId: HERO_ID },
      { curse: { curseId: CURSE_ID, revealed: false } },
    ),
    item(
      'item.hero.revealed-cursed',
      ring.id,
      { type: 'backpack', actorId: HERO_ID },
      { curse: { curseId: CURSE_ID, revealed: true } },
    ),
    item(
      'item.hero.worn-cursed',
      sword.id,
      { type: 'equipped', actorId: HERO_ID, slot: 'main-hand' },
      { curse: { curseId: CURSE_ID, revealed: true } },
    ),
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
      { ...heroActor, equipment: { ...heroActor.equipment, 'main-hand': 'item.hero.worn-cursed' } },
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
  const run = curiosRun(options);
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

function removeCurseCommand(
  overrides: Partial<Extract<GameCommand, { type: 'trade-service' }>> = {},
): GameCommand {
  return {
    type: 'trade-service',
    commandId: 'command.remove-curse',
    expectedRevision: 1,
    merchantPopulationId: POPULATION_ID,
    serviceId: 'merchant-service.remove-curse',
    targetItemId: 'item.hero.revealed-cursed',
    ...overrides,
  };
}

function removeCursePrice(): number {
  const service = encounter.definition.services.find(
    (candidate) => candidate.serviceId === 'merchant-service.remove-curse',
  )!;
  return quoteMerchantService({
    basePrice: service.basePrice,
    factionBps: reputationTier(faction.startingReputation, faction).purchasePriceBps,
  });
}

describe('trade-service remove-curse projection', () => {
  it('lists identify and remove-curse targets separately, never leaking an unrevealed curse', () => {
    const run = openedRun();
    const projection = projectGameplayState({ state: run, content }).trade!;
    const identify = projection.services.find((s) => s.serviceId === 'merchant-service.identify')!;
    const removeCurse = projection.services.find(
      (s) => s.serviceId === 'merchant-service.remove-curse',
    )!;
    expect(identify.targetItemIds).toEqual(['item.hero.unidentified']);
    expect(removeCurse.targetItemIds).toEqual(['item.hero.revealed-cursed', 'item.hero.worn-cursed']);
  });
});

describe('trade-service remove-curse', () => {
  it('removes the curse and keeps everything else about the item', () => {
    const runWithTrade = openedRun();
    const before = itemOf(runWithTrade, 'item.hero.revealed-cursed');
    const resolved = resolveCommand(runWithTrade, removeCurseCommand(), context());
    expect(resolved.result).toMatchObject({ status: 'applied' });
    const healed = itemOf(resolved.state, 'item.hero.revealed-cursed');
    expect(healed.curse).toBeUndefined();
    expect(healed.enchantment).toEqual(before.enchantment);
    expect(healed.identified).toBe(before.identified);
    expect(healed.location).toEqual(before.location);
    expect(healed.condition).toBe(before.condition);
  });

  it('makes an equipped cursed item unequippable again after removal', () => {
    const runWithTrade = openedRun();
    const resolved = resolveCommand(
      runWithTrade,
      removeCurseCommand({ targetItemId: 'item.hero.worn-cursed' }),
      context(),
    );
    expect(resolved.result).toMatchObject({ status: 'applied' });
    const transition = unequipItem({
      run: resolved.state,
      actorId: HERO_ID,
      slot: 'main-hand',
    });
    expect(transition.ok).toBe(true);
  });

  it('rejects remove-curse on an item with no curse', () => {
    const runWithTrade = openedRun();
    const resolved = resolveCommand(
      runWithTrade,
      removeCurseCommand({ targetItemId: 'item.hero.clean' }),
      context(),
    );
    expect(resolved.result).toMatchObject({ status: 'invalid', reason: 'trade.target-invalid' });
  });

  it('rejects remove-curse on an unrevealed curse', () => {
    const runWithTrade = openedRun();
    const resolved = resolveCommand(
      runWithTrade,
      removeCurseCommand({ targetItemId: 'item.hero.hidden-cursed' }),
      context(),
    );
    expect(resolved.result).toMatchObject({ status: 'invalid', reason: 'trade.target-invalid' });
  });

  it('charges the authored price and consumes a use, without drawing randomness', () => {
    const runWithTrade = openedRun();
    const price = removeCursePrice();
    const resolved = resolveCommand(runWithTrade, removeCurseCommand(), context());
    expect(resolved.result).toMatchObject({ status: 'applied' });
    expect(resolved.state.hero.currency).toBe(runWithTrade.hero.currency - price);
    expect(resolved.state.rng).toEqual(runWithTrade.rng);
    expect(resolved.events).toContainEqual(
      expect.objectContaining({
        type: 'trade.service-purchased',
        serviceId: 'merchant-service.remove-curse',
        targetItemId: 'item.hero.revealed-cursed',
        price,
      }),
    );
  });
});
