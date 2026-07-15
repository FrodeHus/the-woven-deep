import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CompiledContentPack, MerchantEncounterContentEntry } from '@woven-deep/content';
import {
  allocateIdentificationMap, createDemoContentPack, createDemoRun, decodeActiveRun,
  encodeActiveRun, materializeMerchant,
  projectGameplayState, resolveCommand, stableJson, validateMerchantInvariants,
  type ActiveRun, type DomainEvent, type GameCommand, type ItemInstance, type MerchantPopulation,
  type PublicEvent,
} from '../src/index.js';
import { merchantPropertyScenarioArbitrary, type MerchantPropertyScenario } from './arbitraries.js';

const POPULATION_ID = 'population.merchant-property';
const MERCHANT_ACTOR_ID = `actor.${POPULATION_ID}.001`;
const HERO_ID = 'hero.demo';
const SELL_ITEM_ID = 'item.property-hero-stack';
const TRINKET_ITEM_ID = 'item.property-hero-trinket';

/** Persisted merchant fields the hidden-state-safe public projection must never leak. */
const HIDDEN_MERCHANT_FIELDS = [
  'departureAt', 'rolledLifetime', 'initialStockItemIds', 'emittedWarningThresholds',
  'aggressionPenaltyApplied', 'deathPenaltyApplied', 'stockLossResolved', 'commerceBonusApplied',
] as const;

function scenarioPack(scenario: MerchantPropertyScenario): CompiledContentPack {
  const base = createDemoContentPack();
  return { ...base, entries: [...base.entries, ...scenario.entries] };
}

function scenarioRun(scenario: MerchantPropertyScenario, pack: CompiledContentPack): ActiveRun {
  const base = createDemoRun();
  const identified = allocateIdentificationMap({ content: pack, rng: base.rng });
  const run: ActiveRun = {
    ...base,
    hero: { ...base.hero, currency: scenario.heroCurrency },
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
      entry.kind === 'encounter' && entry.model === 'merchant')!,
    populationId: POPULATION_ID, floorId: 'floor.demo', position: { x: 2, y: 1 },
  });
  const stockDefinition = pack.entries.find((entry) =>
    entry.kind === 'item' && entry.id === 'item.property-stock');
  const stackLimit = stockDefinition?.kind === 'item' ? stockDefinition.stackLimit : 1;
  const heroItems: ItemInstance[] = [
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
    actors: [...run.actors, materialized.actor]
      .sort((left, right) => left.actorId < right.actorId ? -1 : 1),
    items: [...materialized.items, ...heroItems]
      .sort((left, right) => left.itemId < right.itemId ? -1 : 1),
    populations: [materialized.population],
  };
}

function merchantPopulation(run: ActiveRun): MerchantPopulation {
  return run.populations.find((population): population is MerchantPopulation =>
    population.model === 'merchant')!;
}

function planCommand(state: ActiveRun, scenario: MerchantPropertyScenario, index: number): GameCommand {
  const plan = scenario.plans[index]!;
  const common = { commandId: `command.merchant-property-${index}`, expectedRevision: state.revision };
  const merchant = merchantPopulation(state);
  if (plan.kind === 'open') return { ...common, type: 'trade-open', merchantActorId: MERCHANT_ACTOR_ID };
  if (plan.kind === 'close') return { ...common, type: 'trade-close', merchantPopulationId: merchant.populationId };
  if (plan.kind === 'buy') {
    const stock = merchant.stockItemIds;
    const itemId = stock.length === 0 ? 'item.absent' : stock[plan.pick % stock.length]!;
    return {
      ...common, type: 'trade-buy', merchantPopulationId: merchant.populationId,
      itemId, quantity: plan.quantity,
    };
  }
  if (plan.kind === 'sell') {
    return {
      ...common, type: 'trade-sell', merchantPopulationId: merchant.populationId,
      itemId: SELL_ITEM_ID, quantity: plan.quantity,
    };
  }
  if (plan.kind === 'service') {
    return {
      ...common, type: 'trade-service', merchantPopulationId: merchant.populationId,
      serviceId: 'merchant-service.identify',
      targetItemId: plan.pick % 2 === 0 ? TRINKET_ITEM_ID : SELL_ITEM_ID,
    };
  }
  if (plan.kind === 'attack') return { ...common, type: 'attack', targetActorId: MERCHANT_ACTOR_ID };
  return { ...common, type: 'wait' };
}

function commandCurrencyDelta(events: readonly DomainEvent[]): number {
  let delta = 0;
  for (const event of events) {
    if (event.type === 'trade.bought') delta -= event.total;
    else if (event.type === 'trade.sold') delta += event.total;
    else if (event.type === 'trade.service-purchased') delta -= event.price;
  }
  return delta;
}

function assertHiddenProjection(state: ActiveRun, pack: CompiledContentPack): void {
  const projection = stableJson(projectGameplayState({ state, content: pack }));
  for (const field of HIDDEN_MERCHANT_FIELDS) {
    expect(projection, `public projection leaked ${field}`).not.toContain(`"${field}"`);
  }
}

interface ExecutionArtifacts {
  readonly state: ActiveRun;
  readonly publicEvents: readonly (readonly PublicEvent[])[];
  readonly projections: readonly string[];
}

function execute(scenario: MerchantPropertyScenario, pack: CompiledContentPack,
  initial: ActiveRun, reload: boolean, observe?: (state: ActiveRun, events: readonly DomainEvent[],
    command: GameCommand, previous: ActiveRun) => void): ExecutionArtifacts {
  let state = initial;
  const publicEvents: (readonly PublicEvent[])[] = [];
  const projections: string[] = [];
  for (let index = 0; index < scenario.plans.length; index += 1) {
    if (reload) state = decodeActiveRun(encodeActiveRun(state));
    const previous = state;
    const command = planCommand(state, scenario, index);
    const resolution = resolveCommand(state, command, { content: pack });
    state = resolution.state;
    publicEvents.push(resolution.events);
    projections.push(stableJson(projectGameplayState({ state, content: pack })));
    if (resolution.result.status === 'applied' && observe) {
      const recorded = state.recentCommands.find((entry) => entry.command.commandId === command.commandId);
      observe(state, recorded?.events ?? [], command, previous);
    }
  }
  return { state, publicEvents, projections };
}

describe('mixed ordinary/trade merchant properties', () => {
  it('keeps every merchant invariant across 512 seeded mixed-command scenarios', () => {
    fc.assert(fc.property(merchantPropertyScenarioArbitrary, (scenario) => {
      const pack = scenarioPack(scenario);
      const initial = scenarioRun(scenario, pack);
      validateMerchantInvariants(initial, pack);
      const consequenceCounts = new Map<string, number>();
      const continuous = execute(scenario, pack, initial, false, (state, events, command, previous) => {
        // Schema-v5 validity, currency safety, sorted unique stock/reputation/service ids,
        // stock/location bidirectionality, and departed/dead ownership.
        validateMerchantInvariants(state, pack);
        // At most one active trade, and it references the single merchant.
        if (state.activeTrade !== null) {
          expect(state.activeTrade.merchantPopulationId).toBe(POPULATION_ID);
        }
        // Exact currency conservation across quoted transfers.
        expect(state.hero.currency).toBe(previous.hero.currency + commandCurrencyDelta(events));
        for (const event of events) {
          if (event.type === 'trade.bought' || event.type === 'trade.sold'
            || event.type === 'trade.service-purchased') {
            expect(event.currency).toBe(state.hero.currency);
          }
        }
        // No time advancement from modal trade commands.
        if (command.type.startsWith('trade-')) {
          expect(state.worldTime).toBe(previous.worldTime);
          expect(state.turn).toBe(previous.turn);
        }
        // No duplicate one-time consequence.
        for (const event of events) {
          if (event.type === 'reputation.changed') {
            const key = `reputation.${event.reason}`;
            consequenceCounts.set(key, (consequenceCounts.get(key) ?? 0) + 1);
          } else if (event.type === 'merchant.provoked' || event.type === 'merchant.stock-dropped'
            || event.type === 'merchant.died') {
            consequenceCounts.set(event.type, (consequenceCounts.get(event.type) ?? 0) + 1);
          }
        }
        for (const [key, count] of consequenceCounts) {
          expect(count, `${key} must resolve at most once`).toBeLessThanOrEqual(1);
        }
        // Hidden merchant state never reaches the public projection.
        assertHiddenProjection(state, pack);
      });
      // Split replay equality: reloading before every command is byte-identical.
      const split = execute(scenario, pack, initial, true);
      expect(encodeActiveRun(split.state)).toBe(encodeActiveRun(continuous.state));
      expect(stableJson(split.publicEvents)).toBe(stableJson(continuous.publicEvents));
      expect(stableJson(split.projections)).toBe(stableJson(continuous.projections));
    }), { seed: 0x4b02, numRuns: 512 });
  }, 120_000);
});
