import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type {
  CompiledContentPack, ContentEntry, FallenChampionTemplateContentEntry, ItemContentEntry,
  LootTableContentEntry, MerchantEncounterContentEntry, MonsterContentEntry,
} from '@woven-deep/content';
import {
  allocateIdentificationMap, createDemoContentPack, createDemoRun,
  createInMemoryRunRecordRepository, decodeActiveRun, encodeActiveRun, finalizeRun,
  materializeMerchant, projectGameplayState, resolveCommand, scoreRun, stableJson,
  validateActiveRun,
  type ActiveRun, type DomainEvent, type GameCommand, type ItemInstance, type MerchantPopulation,
  type RunMetrics,
} from '../src/index.js';
import { merchantPropertyScenarioArbitrary, type MerchantPropertyScenario } from './arbitraries.js';

const POPULATION_ID = 'population.run-records-property';
const MERCHANT_ACTOR_ID = `actor.${POPULATION_ID}.001`;
const HERO_ID = 'hero.demo';
const SELL_ITEM_ID = 'item.property-hero-stack';
const TRINKET_ITEM_ID = 'item.property-hero-trinket';
const EQUIPPED_ITEM_ID = 'item.property-hero-blade';
const FALLBACK_ITEM_ID = 'item.property-fallback-relic';
const EQUIP_CONTENT_ID = 'item.property-blade';

const METRIC_COUNTERS = [
  'kills', 'bossKills', 'championKills', 'echoKills', 'threatDefeated', 'damageDealt', 'damageTaken',
  'itemsCollected', 'itemsIdentified', 'currencyEarned', 'currencySpent', 'tradesCompleted',
  'floorsEntered', 'discoveriesRevealed', 'turnsElapsed', 'restsCompleted',
] as const;

/** Persisted fields the hidden-state-safe public projection must never leak. */
const HIDDEN_FIELDS = ['fallenHeroDecisions', 'encounterDecisions', 'concludedAtRevision',
  'run-records', 'standings', 'departureAt', 'rolledLifetime'] as const;

function blade(): ItemContentEntry {
  return {
    kind: 'item', id: EQUIP_CONTENT_ID, name: 'Property Blade', tags: ['weapon'], glyph: '/', color: '#cccccc',
    category: 'weapon', stackLimit: 1, price: 20, rarity: 'common', heirloomEligible: true,
    minDepth: 1, maxDepth: 10, actionCost: 100,
    equipment: { slots: ['main-hand'], handedness: 'one-handed', reservedSlots: [] },
    combat: { accuracy: 1, defense: 0, armor: 0, damage: { count: 1, sides: 4, bonus: 0 }, range: 1, ammunitionTag: null },
    light: null, identification: { mode: 'known', poolId: null }, effects: [],
  };
}

function fallbackRelic(): ItemContentEntry {
  return { ...blade(), id: FALLBACK_ITEM_ID, name: 'Property Fallback Relic', heirloomEligible: false };
}

function template(): FallenChampionTemplateContentEntry {
  return {
    kind: 'fallen-champion-template', id: 'fallen-champion-template.property', name: 'Property Champion',
    tags: [], fallbackMonsterId: 'monster.property', fallbackItemId: FALLBACK_ITEM_ID,
    minimumHealth: 18, maximumHealth: 180, attributeMaximum: 30, damageMaximum: 30, abilityLimit: 3,
    echoAppearanceChance: 0.08, maximumEchoesPerRun: 2, echoHealthPercent: 65, echoDamagePercent: 70,
    echoDefensePercent: 80, echoAbilityLimit: 2, echoLootTableId: 'loot-table.property-echo',
    heirloomSelection: {
      rarityWeights: { common: 1, uncommon: 3, rare: 8, legendary: 16 }, qualityRankBonus: 2,
    },
  } as FallenChampionTemplateContentEntry;
}

function fallbackMonster(): MonsterContentEntry {
  return {
    kind: 'monster', id: 'monster.property', name: 'Property Monster', glyph: 'm', color: '#aa4444', tags: [],
    minDepth: 1, maxDepth: 20, attributes: { might: 5, agility: 5, vitality: 5, wits: 5, resolve: 5 },
    health: 10, speed: 100, accuracy: 100, defense: 8, perception: 8,
    damage: { count: 1, sides: 1, bonus: 0 }, armor: 0,
    resistances: { physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0, arcane: 0 },
    disposition: 'hostile', behaviorId: 'behavior.approach-and-attack', behaviorParameters: {},
    rarity: 'common', threat: 4,
  };
}

function echoLootTable(): LootTableContentEntry {
  return {
    kind: 'loot-table', id: 'loot-table.property-echo', name: 'Property Echo', tags: [], rolls: 1,
    choices: [{ contentId: FALLBACK_ITEM_ID, lootTableId: null, weight: 1, minimumQuantity: 1, maximumQuantity: 1 }],
  };
}

function scenarioPack(scenario: MerchantPropertyScenario): CompiledContentPack {
  const base = createDemoContentPack();
  return {
    ...base,
    entries: [...base.entries, ...scenario.entries, blade(), fallbackRelic(), fallbackMonster(),
      echoLootTable(), template()] as readonly ContentEntry[],
  };
}

function scenarioRun(scenario: MerchantPropertyScenario, pack: CompiledContentPack): ActiveRun {
  const base = createDemoRun();
  const identified = allocateIdentificationMap({ content: pack, rng: base.rng });
  const heroActor = base.actors[0]!;
  const run: ActiveRun = {
    ...base,
    hero: { ...base.hero, currency: scenario.heroCurrency },
    actors: [{ ...heroActor, equipment: { ...heroActor.equipment, 'main-hand': EQUIPPED_ITEM_ID } }],
    identification: identified.identification,
    rng: identified.rng,
    encounterDecisions: [{
      encounterId: scenario.encounterId, baseProbability: 1, protectionBonus: 0,
      effectiveProbability: 1, eligible: true, reachedEligibleDepth: false,
      encountered: false, instancesCreated: 1,
    }],
  };
  const materialized = materializeMerchant({
    run, content: pack,
    encounter: pack.entries.find((entry): entry is MerchantEncounterContentEntry =>
      entry.kind === 'encounter' && entry.model === 'merchant' && !entry.definition.permanent)!,
    populationId: POPULATION_ID, floorId: 'floor.demo', position: { x: 2, y: 1 },
  });
  const stockDefinition = pack.entries.find((entry) => entry.kind === 'item' && entry.id === 'item.property-stock');
  const stackLimit = stockDefinition?.kind === 'item' ? stockDefinition.stackLimit : 1;
  const heroItems: ItemInstance[] = [
    {
      itemId: EQUIPPED_ITEM_ID, contentId: EQUIP_CONTENT_ID, quantity: 1, condition: 100,
      enchantment: null, identified: true, charges: null, fuel: null, enabled: null,
      location: { type: 'equipped', actorId: HERO_ID, slot: 'main-hand' },
    },
    {
      itemId: SELL_ITEM_ID, contentId: 'item.property-stock', quantity: Math.min(3, stackLimit), condition: 100,
      enchantment: null, identified: true, charges: null, fuel: null, enabled: null,
      location: { type: 'backpack', actorId: HERO_ID },
    },
    {
      itemId: TRINKET_ITEM_ID, contentId: 'item.property-trinket', quantity: 1, condition: 100,
      enchantment: null, identified: false, charges: null, fuel: null, enabled: null,
      location: { type: 'backpack', actorId: HERO_ID },
    },
  ];
  return {
    ...run,
    rng: { ...run.rng, 'merchant-stock': materialized.nextMerchantStockState },
    actors: [...run.actors, materialized.actor].sort((left, right) => left.actorId < right.actorId ? -1 : 1),
    items: [...materialized.items, ...heroItems].sort((left, right) => left.itemId < right.itemId ? -1 : 1),
    populations: [materialized.population],
  };
}

function merchantPopulation(run: ActiveRun): MerchantPopulation {
  return run.populations.find((population): population is MerchantPopulation => population.model === 'merchant')!;
}

function planCommand(state: ActiveRun, scenario: MerchantPropertyScenario, index: number): GameCommand {
  const plan = scenario.plans[index]!;
  const common = { commandId: `command.run-records-property-${index}`, expectedRevision: state.revision };
  const merchant = merchantPopulation(state);
  if (plan.kind === 'open') return { ...common, type: 'trade-open', merchantActorId: MERCHANT_ACTOR_ID };
  if (plan.kind === 'close') return { ...common, type: 'trade-close', merchantPopulationId: merchant.populationId };
  if (plan.kind === 'buy') {
    const stock = merchant.stockItemIds;
    const itemId = stock.length === 0 ? 'item.absent' : stock[plan.pick % stock.length]!;
    return { ...common, type: 'trade-buy', merchantPopulationId: merchant.populationId, itemId, quantity: plan.quantity };
  }
  if (plan.kind === 'sell') {
    return { ...common, type: 'trade-sell', merchantPopulationId: merchant.populationId, itemId: SELL_ITEM_ID, quantity: plan.quantity };
  }
  if (plan.kind === 'service') {
    return {
      ...common, type: 'trade-service', merchantPopulationId: merchant.populationId,
      serviceId: 'merchant-service.identify', targetItemId: plan.pick % 2 === 0 ? TRINKET_ITEM_ID : SELL_ITEM_ID,
    };
  }
  if (plan.kind === 'attack') return { ...common, type: 'attack', targetActorId: MERCHANT_ACTOR_ID };
  return { ...common, type: 'wait' };
}

function metricsNonDecreasing(previous: RunMetrics, next: RunMetrics): void {
  for (const counter of METRIC_COUNTERS) {
    expect(next[counter], `metric ${counter} decreased`).toBeGreaterThanOrEqual(previous[counter]);
  }
  expect(next.deepestDepth, 'deepestDepth fell').toBeGreaterThanOrEqual(previous.deepestDepth);
}

function assertMetricsValid(metrics: RunMetrics): void {
  for (const counter of METRIC_COUNTERS) {
    expect(Number.isSafeInteger(metrics[counter]) && metrics[counter] >= 0, `metric ${counter} invalid`).toBe(true);
  }
  const modelSum = metrics.killsByModel.individual + metrics.killsByModel.group
    + metrics.killsByModel.swarm + metrics.killsByModel.boss;
  expect(metrics.kills, 'kills below killsByModel sum').toBeGreaterThanOrEqual(modelSum);
}

function assertHiddenProjection(state: ActiveRun, pack: CompiledContentPack): void {
  const projection = stableJson(projectGameplayState({ state, content: pack }));
  for (const field of HIDDEN_FIELDS) {
    expect(projection, `public projection leaked ${field}`).not.toContain(`"${field}"`);
  }
}

interface Execution {
  readonly state: ActiveRun;
  readonly publicEvents: readonly (readonly DomainEvent[])[];
  readonly projections: readonly string[];
}

function execute(scenario: MerchantPropertyScenario, pack: CompiledContentPack, initial: ActiveRun,
  reload: boolean, observe?: (state: ActiveRun, previous: ActiveRun) => void): Execution {
  let state = initial;
  const publicEvents: (readonly DomainEvent[])[] = [];
  const projections: string[] = [];
  for (let index = 0; index < scenario.plans.length; index += 1) {
    if (reload) state = decodeActiveRun(encodeActiveRun(state));
    const previous = state;
    const command = planCommand(state, scenario, index);
    const resolution = resolveCommand(state, command, { content: pack });
    state = resolution.state;
    publicEvents.push(resolution.events);
    projections.push(stableJson(projectGameplayState({ state, content: pack })));
    if (resolution.result.status === 'applied' && observe) observe(state, previous);
  }
  return { state, publicEvents, projections };
}

/** Forces a `died` conclusion by starving the (still-living) hero on a fresh wait. */
function forceHeroDeath(state: ActiveRun, pack: CompiledContentPack): ActiveRun {
  const dying: ActiveRun = {
    ...state,
    activeTrade: null,
    actors: state.actors.map((actor) => actor.actorId === state.hero.actorId
      ? { ...actor, health: 1 } : actor),
    survival: { ...state.survival, hungerReserve: 0, hungerStage: 'starving', nextStarvationAt: state.worldTime + 1 },
  };
  const killing = resolveCommand(dying, {
    type: 'wait', commandId: 'command.run-records-property-death', expectedRevision: dying.revision,
  }, { content: pack });
  expect(killing.result.status).toBe('applied');
  return killing.state;
}

describe('mixed ordinary/trade run-records properties', () => {
  it('holds every run-records invariant across 512 seeded scenarios', () => {
    fc.assert(fc.property(merchantPropertyScenarioArbitrary, (scenario) => {
      const pack = scenarioPack(scenario);
      const initial = scenarioRun(scenario, pack);
      validateActiveRun(initial);

      let previousMetrics = initial.metrics;
      const continuous = execute(scenario, pack, initial, false, (state) => {
        // Schema-v6 validity and metric health after every accepted command.
        validateActiveRun(state);
        assertMetricsValid(state.metrics);
        metricsNonDecreasing(previousMetrics, state.metrics);
        previousMetrics = state.metrics;
        // Conclusion consistency: no living hero has a conclusion during ordinary play.
        const heroAlive = state.actors.find((actor) => actor.actorId === state.hero.actorId)!.health > 0;
        if (heroAlive) expect(state.conclusion).toBeNull();
        // Hidden state never reaches the public projection.
        assertHiddenProjection(state, pack);
      });

      // Conclude the run and prove the closed post-conclusion contract.
      const concluded = forceHeroDeath(continuous.state, pack);
      expect(concluded.conclusion).not.toBeNull();
      expect(concluded.conclusion!.completionType).toBe('died');
      expect(concluded.actors.find((actor) => actor.actorId === concluded.hero.actorId)!.health).toBe(0);
      const cause = concluded.conclusion!.cause;
      expect(Number.isSafeInteger(cause.depth) && cause.depth >= 0).toBe(true);
      expect(Number.isSafeInteger(cause.turn) && cause.turn >= 0).toBe(true);
      expect(Number.isSafeInteger(cause.worldTime) && cause.worldTime >= 0).toBe(true);
      for (const command of [
        { type: 'wait' as const, commandId: 'command.after-1', expectedRevision: concluded.revision },
        { type: 'move' as const, direction: 'east' as const, commandId: 'command.after-2', expectedRevision: concluded.revision },
      ]) {
        const rejected = resolveCommand(concluded, command, { content: pack });
        expect(rejected.result).toMatchObject({ status: 'invalid', reason: 'run.concluded' });
        expect(rejected.state.revision).toBe(concluded.revision);
      }

      // Record determinism: finalizing the same save twice is deep-equal.
      const savedConcluded = decodeActiveRun(encodeActiveRun(concluded));
      const finalizedA = finalizeRun({ run: savedConcluded, content: pack, lifetime: createInMemoryRunRecordRepository().lifetime() });
      const finalizedB = finalizeRun({
        run: decodeActiveRun(encodeActiveRun(concluded)), content: pack,
        lifetime: createInMemoryRunRecordRepository().lifetime(),
      });
      expect(stableJson(finalizedA.record)).toBe(stableJson(finalizedB.record));
      expect(stableJson(finalizedA.deltas)).toBe(stableJson(finalizedB.deltas));

      // Finalize-once: the returned finalized run rejects a second finalization.
      expect(() => finalizeRun({ run: finalizedA.run, content: pack, lifetime: createInMemoryRunRecordRepository().lifetime() }))
        .toThrow();

      // Heirloom eligibility: a recorded source item was equipped, never backpack, never excluded.
      const heirloom = finalizedA.record.heirloom;
      if (heirloom.sourceItemId !== null) {
        const source = savedConcluded.items.find((item) => item.itemId === heirloom.sourceItemId)!;
        expect(source.location.type).toBe('equipped');
      }

      // Score: every line non-negative, total equals the sum of line amounts.
      const score = scoreRun({ run: savedConcluded, content: pack });
      for (const line of score.lines) expect(line.amount).toBeGreaterThanOrEqual(0);
      expect(score.total).toBe(score.lines.reduce((sum, line) => sum + line.amount, 0));
      expect(score.total).toBeGreaterThanOrEqual(0);

      // Delta idempotence at the repository: applying twice equals applying once.
      const once = createInMemoryRunRecordRepository();
      once.applyDeltas(finalizedA.deltas);
      const onceLifetime = stableJson(once.lifetime());
      once.applyDeltas(finalizedA.deltas);
      expect(stableJson(once.lifetime())).toBe(onceLifetime);

      // Split-replay equality across the ordinary/trade command sequence.
      const split = execute(scenario, pack, initial, true);
      expect(encodeActiveRun(split.state)).toBe(encodeActiveRun(continuous.state));
      expect(stableJson(split.publicEvents)).toBe(stableJson(continuous.publicEvents));
      expect(stableJson(split.projections)).toBe(stableJson(continuous.projections));
    }), { seed: 0x4b03, numRuns: 512 });
  }, 120_000);
});
