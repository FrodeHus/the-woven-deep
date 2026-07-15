import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  compileContentDirectory,
  type CompiledContentPack,
  type MerchantEncounterContentEntry,
  type NpcContentEntry,
  type NpcFactionContentEntry,
} from '@woven-deep/content/compiler';
import {
  allocateFloorSeed,
  allocateIdentificationMap,
  chooseBehaviorAction,
  createDemoRun,
  decodeActiveRun,
  emptyEquipment,
  encodeActiveRun,
  integrateGeneratedFloor,
  materializeMerchant,
  merchantBehaviorAction,
  provokeMerchant,
  relationshipBetween,
  resolveCommand,
  resolveMerchantCombatOutcomes,
  resolveMerchantDeath,
  setRelationship,
  stableJson,
  eligibleOpportunityAttackers,
  type ActiveRun,
  type ActorState,
  type DomainEvent,
  type FloorSeedAllocation,
  type GameCommand,
  type GeneratedFloor,
  type ItemInstance,
  type MerchantPopulation,
} from '../src/index.js';

let content: CompiledContentPack;
let encounter: MerchantEncounterContentEntry;
let npc: NpcContentEntry;
let faction: NpcFactionContentEntry;

const POPULATION_ID = 'population.merchant-demo';
const MERCHANT_ACTOR_ID = `actor.${POPULATION_ID}.001`;
const HERO_ID = 'hero.demo';
const BEETLE_ID = 'monster.threat-01';

beforeAll(async () => {
  content = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
  encounter = content.entries.find((entry): entry is MerchantEncounterContentEntry =>
    entry.kind === 'encounter' && entry.model === 'merchant')!;
  npc = content.entries.find((entry): entry is NpcContentEntry => entry.kind === 'npc')!;
  faction = content.entries.find((entry): entry is NpcFactionContentEntry => entry.kind === 'npc-faction')!;
});

const context = () => ({ content });

function item(itemId: string, contentId: string, quantity: number, location: ItemInstance['location']): ItemInstance {
  return { itemId, contentId, quantity, condition: 100, enchantment: null, identified: true,
    charges: null, fuel: null, enabled: null, location };
}

function merchantDecisions(encountered: boolean, instancesCreated: number) {
  return content.entries.filter((entry) => entry.kind === 'encounter')
    .sort((left, right) => left.id < right.id ? -1 : 1)
    .map((entry) => ({
      encounterId: entry.id, baseProbability: entry.runAppearanceChance, protectionBonus: 0,
      effectiveProbability: entry.runAppearanceChance, eligible: true,
      reachedEligibleDepth: entry.id === encounter.id && encountered,
      encountered: entry.id === encounter.id ? encountered : false,
      instancesCreated: entry.id === encounter.id ? instancesCreated : 0,
    }));
}

/** Merchant adjacent to the hero on the active demo floor, already encountered. Stock: 4 + 2 units. */
function merchantRun(): ActiveRun {
  const base = createDemoRun();
  const identified = allocateIdentificationMap({ content, rng: base.rng });
  const run: ActiveRun = {
    ...base,
    contentHash: content.hash,
    identification: identified.identification,
    rng: identified.rng,
    reputations: [{ factionId: faction.id, value: 0 }],
    encounterDecisions: merchantDecisions(true, 1),
  };
  const materialized = materializeMerchant({
    run, content, encounter, populationId: POPULATION_ID,
    floorId: 'floor.demo', position: { x: 2, y: 1 },
  });
  const stock: ItemInstance[] = [
    item('item.stock.lamp-oil', 'item.lamp-oil', 4, { type: 'merchant-stock', populationId: POPULATION_ID }),
    item('item.stock.ration', 'item.travel-ration', 2, { type: 'merchant-stock', populationId: POPULATION_ID }),
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
    items: stock,
    populations: [population],
  };
}

function beetle(overrides: Partial<ActorState> = {}): ActorState {
  return {
    actorId: BEETLE_ID, contentId: 'monster.training-beetle', playerControlled: false,
    floorId: 'floor.demo', x: 5, y: 3,
    attributes: { might: 4, agility: 3, vitality: 6, wits: 1, resolve: 3 },
    health: 7, maxHealth: 7, energy: 0, speed: 75, reactionReady: true, disposition: 'hostile',
    awareActorIds: [], conditions: [], equipment: emptyEquipment(),
    behaviorId: 'behavior.approach-and-attack',
    behaviorState: { intent: 'hold', goal: null, lastKnownTargets: [], investigation: null },
    populationId: null, populationRoleId: null, populationPresentation: null,
    ...overrides,
  };
}

function withActor(run: ActiveRun, actor: ActorState): ActiveRun {
  return {
    ...run,
    actors: [...run.actors, actor].sort((left, right) => left.actorId < right.actorId ? -1 : 1),
  };
}

function updateActor(run: ActiveRun, actorId: string, overrides: Partial<ActorState>): ActiveRun {
  return {
    ...run,
    actors: run.actors.map((actor) => actor.actorId === actorId ? { ...actor, ...overrides } : actor),
  };
}

function merchantPopulation(run: ActiveRun): MerchantPopulation {
  return run.populations.find((population): population is MerchantPopulation =>
    population.model === 'merchant' && population.populationId === POPULATION_ID)
    ?? run.populations.find((population): population is MerchantPopulation => population.model === 'merchant')!;
}

function merchantActor(run: ActiveRun): ActorState {
  return run.actors.find((actor) => actor.actorId === merchantPopulation(run).actorId)!;
}

function withMerchantDefinition(
  overrides: Partial<MerchantEncounterContentEntry['definition']>,
): CompiledContentPack {
  return {
    ...content,
    entries: content.entries.map((entry) => entry.kind === 'encounter' && entry.model === 'merchant'
      ? { ...entry, definition: { ...entry.definition, ...overrides } } : entry),
  };
}

function groundUnits(run: ActiveRun): number {
  return run.items.filter((entry) => entry.location.type === 'floor')
    .reduce((total, entry) => total + entry.quantity, 0);
}

function stockUnits(run: ActiveRun): number {
  return run.items.filter((entry) => entry.location.type === 'merchant-stock')
    .reduce((total, entry) => total + entry.quantity, 0);
}

function openCommand(): GameCommand {
  return { type: 'trade-open', commandId: 'command.trade-open', expectedRevision: 0,
    merchantActorId: MERCHANT_ACTOR_ID };
}

function openedRun(): ActiveRun {
  const run = merchantRun();
  const opened = resolveCommand(run, openCommand(), context());
  if (opened.result.status !== 'applied') throw new Error(`fixture open failed: ${stableJson(opened.result)}`);
  return opened.state;
}

function generatedFloor(
  floorId = 'floor.generated-01',
  floorSeed: FloorSeedAllocation['floorSeed'] = allocateFloorSeed(createDemoRun().rng.generation).floorSeed,
): GeneratedFloor {
  const floor = JSON.parse(readFileSync(new URL('./fixtures/generated-floor-seed-1.json', import.meta.url), 'utf8')) as GeneratedFloor['floor'];
  return {
    floor: {
      ...floor, floorId, seed: floorSeed,
      vaults: floor.vaults.map((vault) => ({ ...vault, placementId: `${vault.placementId}.${floorId}` })),
      placementSlots: floor.placementSlots.map((slot) => ({ ...slot,
        slotId: `${slot.slotId}.${floorId}`, vaultPlacementId: `${slot.vaultPlacementId}.${floorId}` })),
      lights: floor.lights.map((light) => ({ ...light,
        lightId: `${light.lightId}.${floorId}`,
        ...(light.vaultPlacementId === undefined ? {} : { vaultPlacementId: `${light.vaultPlacementId}.${floorId}` }) })),
    },
    report: {
      generatorVersion: 2, attempt: 0, fallback: false, roomCount: 8, corridorCount: 7,
      vaults: [], stairUp: floor.stairUp!, stairDown: floor.stairDown!, stairDistance: 42,
      traversableCellCount: 400, connected: true, rejectionCounts: { 'topology.empty': 1 },
    },
  };
}

/** Merchant placed on the inactive floor.generated-01 while the hero stays on floor.demo. */
function offFloorRun(): ActiveRun {
  const base = createDemoRun();
  const identified = allocateIdentificationMap({ content, rng: base.rng });
  const run: ActiveRun = {
    ...base,
    contentHash: content.hash,
    identification: identified.identification,
    rng: identified.rng,
    reputations: [{ factionId: faction.id, value: 0 }],
    encounterDecisions: merchantDecisions(false, 0),
  };
  const integrated = integrateGeneratedFloor(run, generatedFloor(), allocateFloorSeed(run.rng.generation), {
    content, forcedEncounterId: encounter.id,
  });
  return {
    ...integrated.state,
    encounterDecisions: integrated.state.encounterDecisions.map((decision) =>
      decision.encounterId === encounter.id
        ? { ...decision, encountered: true, reachedEligibleDepth: true }
        : decision),
  };
}

describe('merchant neutral threat response', () => {
  it('keeps unrelated hostile monsters neutral toward merchants so they ignore them', () => {
    const run = withActor(merchantRun(), beetle({ x: 3, y: 1, awareActorIds: [MERCHANT_ACTOR_ID] }));
    expect(relationshipBetween(run, BEETLE_ID, MERCHANT_ACTOR_ID)).toBe('neutral');
    const action = chooseBehaviorAction({ state: run, actorId: BEETLE_ID, content });
    expect(action.type).toBe('wait');
  });

  it('creates a threat from monster damage without any hero reputation or stock consequence', () => {
    const base = withActor(merchantRun(), beetle({ x: 3, y: 1 }));
    const damaged: DomainEvent = {
      type: 'actor.damaged', eventId: 'event.monster-hit', actorId: MERCHANT_ACTOR_ID,
      sourceActorId: BEETLE_ID, amount: 2, health: 18,
    };
    const outcome = resolveMerchantCombatOutcomes({
      state: base, content, events: [damaged], eventId: 'event.monster-hit',
    });
    expect(outcome.events.map((event) => event.type)).toEqual(['relationship.changed']);
    expect(relationshipBetween(outcome.state, BEETLE_ID, MERCHANT_ACTOR_ID)).toBe('hostile');
    const population = merchantPopulation(outcome.state);
    expect(population.lifecycle).toBe('available');
    expect(population.provoked).toBe(false);
    expect(population.stockLossResolved).toBe(false);
    expect(outcome.state.reputations).toEqual(base.reputations);
    expect(groundUnits(outcome.state)).toBe(0);
    // The remembered damage makes the beetle a known threat the merchant now flees.
    const action = merchantBehaviorAction({ state: outcome.state, content, actorId: MERCHANT_ACTOR_ID });
    expect(action).toMatchObject({ type: 'move', to: { x: 1, y: 2 } });
  });

  it('flees along the step with the greatest Chebyshev distance from known threats', () => {
    let run = withActor(merchantRun(), beetle({ x: 3, y: 1 }));
    run = setRelationship(run, BEETLE_ID, MERCHANT_ACTOR_ID, 'hostile');
    run = updateActor(run, MERCHANT_ACTOR_ID, { awareActorIds: [BEETLE_ID] });
    const action = merchantBehaviorAction({ state: run, content, actorId: MERCHANT_ACTOR_ID });
    // Candidates from (2,1): stay (distance 1), (2,2) (1), (1,2) (2). (1,1) and (3,1) are occupied.
    expect(action).toMatchObject({ type: 'move', to: { x: 1, y: 2 } });
  });

  it('holds when no hostile threat is known', () => {
    const run = withActor(merchantRun(), beetle({ x: 3, y: 1 }));
    const action = merchantBehaviorAction({ state: run, content, actorId: MERCHANT_ACTOR_ID });
    expect(action.type).toBe('wait');
  });

  it('attacks only hostile known threats under the authored self-defense response', () => {
    const selfDefense = withMerchantDefinition({ aggressionResponse: 'self-defense' });
    let run = withActor(merchantRun(), beetle({ x: 3, y: 1 }));
    run = updateActor(run, MERCHANT_ACTOR_ID, { awareActorIds: [BEETLE_ID] });
    // Aware but neutral: no attack.
    expect(merchantBehaviorAction({ state: run, content: selfDefense, actorId: MERCHANT_ACTOR_ID }).type).toBe('wait');
    const hostile = setRelationship(run, BEETLE_ID, MERCHANT_ACTOR_ID, 'hostile');
    expect(merchantBehaviorAction({ state: hostile, content: selfDefense, actorId: MERCHANT_ACTOR_ID }))
      .toMatchObject({ type: 'bump-attack', targetActorId: BEETLE_ID });
  });

  it('never attacks a remembered position after the target escapes perception', () => {
    const selfDefense = withMerchantDefinition({ aggressionResponse: 'self-defense' });
    // Hero (1,1) provokes while adjacent to the merchant (2,1): the merchant remembers the
    // hero at the adjacent cell and switches to the defending lifecycle.
    const provoked = provokeMerchant({
      state: merchantRun(), content: selfDefense, merchantPopulationId: POPULATION_ID,
      sourceActorId: HERO_ID, eventId: 'event.provoke',
    });
    expect(merchantPopulation(provoked.state).lifecycle).toBe('defending');
    // The hero steps away out of the merchant's perception; only the stale memory remains.
    let run = updateActor(provoked.state, HERO_ID, { x: 5, y: 3 });
    run = updateActor(run, MERCHANT_ACTOR_ID, {
      awareActorIds: merchantActor(run).awareActorIds.filter((actorId) => actorId !== HERO_ID),
    });
    const action = merchantBehaviorAction({ state: run, content: selfDefense, actorId: MERCHANT_ACTOR_ID });
    // The live hero is far away: attacking the remembered cell would hit at arbitrary range.
    expect(action.type).not.toBe('bump-attack');
    expect(action).toMatchObject({ type: 'move', to: { x: 1, y: 1 } });
  });

  it('falls back to fleeing below the authored self-preservation threshold', () => {
    const selfDefense = withMerchantDefinition({ aggressionResponse: 'self-defense' });
    let run = withActor(merchantRun(), beetle({ x: 3, y: 1 }));
    run = setRelationship(run, BEETLE_ID, MERCHANT_ACTOR_ID, 'hostile');
    // 6 / 20 health = 3000 bps, below the authored 3500 bps threshold.
    run = updateActor(run, MERCHANT_ACTOR_ID, { awareActorIds: [BEETLE_ID], health: 6 });
    const action = merchantBehaviorAction({ state: run, content: selfDefense, actorId: MERCHANT_ACTOR_ID });
    expect(action).toMatchObject({ type: 'move', to: { x: 1, y: 2 } });
  });

  it('never grants a neutral merchant movement an opportunity reaction', () => {
    let run = withActor(merchantRun(), beetle({ x: 3, y: 1, awareActorIds: [MERCHANT_ACTOR_ID] }));
    run = updateActor(run, MERCHANT_ACTOR_ID, { x: 2, y: 2 });
    expect(eligibleOpportunityAttackers({
      run, content, moverActorId: MERCHANT_ACTOR_ID,
      from: { x: 2, y: 2 }, to: { x: 1, y: 2 },
    })).toEqual([]);
  });

  it('does not act on inactive floors', () => {
    const base = offFloorRun();
    const population = merchantPopulation(base);
    const before = base.actors.find((actor) => actor.actorId === population.actorId)!;
    const stepped = resolveCommand(base, { type: 'wait', commandId: 'command.wait-1', expectedRevision: 0 }, context());
    expect(stepped.result.status).toBe('applied');
    const after = stepped.state.actors.find((actor) => actor.actorId === population.actorId)!;
    expect({ ...after, energy: before.energy }).toEqual(before);
  });
});

describe('merchant provocation and stock loss', () => {
  it('closes trade, applies one aggression penalty, turns hostile, and drops the stock fraction', () => {
    const state = openedRun();
    const provoked = provokeMerchant({
      state, content, merchantPopulationId: merchantPopulation(state).populationId,
      sourceActorId: state.hero.actorId, eventId: 'command.attack',
    });
    expect(provoked.events.map((event) => event.type)).toEqual([
      'trade.closed', 'reputation.changed', 'relationship.changed',
      'merchant.provoked', 'merchant.stock-dropped',
    ]);
    expect(groundUnits(provoked.state)).toBe(Math.ceil(stockUnits(state) * encounter.definition.stockDropFraction));
    expect(provoked.state.activeTrade).toBeNull();
    expect(provoked.events[0]).toMatchObject({ type: 'trade.closed', reason: 'aggression' });
    expect(provoked.events[1]).toMatchObject({
      type: 'reputation.changed', reason: 'aggression',
      delta: encounter.definition.aggressionReputationDelta,
    });
    expect(relationshipBetween(provoked.state, HERO_ID, MERCHANT_ACTOR_ID)).toBe('hostile');
    const population = merchantPopulation(provoked.state);
    expect(population.lifecycle).toBe('fleeing');
    expect(population.provoked).toBe(true);
    expect(population.aggressionPenaltyApplied).toBe(true);
    expect(population.stockLossResolved).toBe(true);
    expect(provoked.state.rng['merchant-runtime']).not.toEqual(state.rng['merchant-runtime']);
    // Dropped units land on the merchant cell; the remainder stays in merchant stock.
    expect(stockUnits(provoked.state)).toBe(stockUnits(state) - groundUnits(provoked.state));
    for (const dropped of provoked.state.items.filter((entry) => entry.location.type === 'floor')) {
      expect(dropped.location).toMatchObject({ floorId: 'floor.demo', x: 2, y: 1 });
    }
  });

  it('uses split identifiers under the population drop namespace and selects units deterministically', () => {
    const state = merchantRun();
    const first = provokeMerchant({
      state, content, merchantPopulationId: POPULATION_ID,
      sourceActorId: HERO_ID, eventId: 'command.attack',
    });
    const second = provokeMerchant({
      state, content, merchantPopulationId: POPULATION_ID,
      sourceActorId: HERO_ID, eventId: 'command.attack',
    });
    expect(stableJson(first.state)).toBe(stableJson(second.state));
    // 3 of 6 units drop, so the 4-unit lamp-oil stack always splits into a drop-namespaced stack.
    const dropIds = first.state.items
      .filter((entry) => entry.itemId.startsWith(`item.${POPULATION_ID}.drop.`))
      .map((entry) => entry.itemId);
    expect(dropIds.length).toBeGreaterThan(0);
    for (const dropId of dropIds) {
      expect(dropId).toMatch(new RegExp(`^item\\.${POPULATION_ID.replaceAll('.', '\\.')}\\.drop\\.\\d+$`));
    }
    const stockDropped = first.events.find((event) => event.type === 'merchant.stock-dropped')!;
    expect(stockDropped).toMatchObject({ populationId: POPULATION_ID, units: 3 });
    // The population stock list matches the retained merchant-stock items exactly.
    const retained = first.state.items.filter((entry) => entry.location.type === 'merchant-stock')
      .map((entry) => entry.itemId).sort();
    expect([...merchantPopulation(first.state).stockItemIds]).toEqual(retained);
  });

  it('drops nothing at fraction zero and everything at fraction one', () => {
    const state = merchantRun();
    const zero = provokeMerchant({
      state, content: withMerchantDefinition({ stockDropFraction: 0 }),
      merchantPopulationId: POPULATION_ID, sourceActorId: HERO_ID, eventId: 'command.attack',
    });
    expect(groundUnits(zero.state)).toBe(0);
    expect(stockUnits(zero.state)).toBe(6);
    expect(merchantPopulation(zero.state).stockLossResolved).toBe(true);
    expect(zero.events.find((event) => event.type === 'merchant.stock-dropped'))
      .toMatchObject({ units: 0, itemIds: [] });

    const everything = provokeMerchant({
      state, content: withMerchantDefinition({ stockDropFraction: 1 }),
      merchantPopulationId: POPULATION_ID, sourceActorId: HERO_ID, eventId: 'command.attack',
    });
    expect(groundUnits(everything.state)).toBe(6);
    expect(stockUnits(everything.state)).toBe(0);
    expect(merchantPopulation(everything.state).stockItemIds).toEqual([]);
  });

  it('grants the aggression and stock consequences at most once per merchant', () => {
    const state = merchantRun();
    const first = provokeMerchant({
      state, content, merchantPopulationId: POPULATION_ID,
      sourceActorId: HERO_ID, eventId: 'command.attack',
    });
    const again = provokeMerchant({
      state: first.state, content, merchantPopulationId: POPULATION_ID,
      sourceActorId: HERO_ID, eventId: 'command.attack-2',
    });
    expect(again.events).toEqual([]);
    expect(again.state).toBe(first.state);
  });

  it('uses the defending lifecycle for the authored self-defense response', () => {
    const selfDefense = withMerchantDefinition({ aggressionResponse: 'self-defense' });
    const provoked = provokeMerchant({
      state: merchantRun(), content: selfDefense, merchantPopulationId: POPULATION_ID,
      sourceActorId: HERO_ID, eventId: 'command.attack',
    });
    expect(merchantPopulation(provoked.state).lifecycle).toBe('defending');
    expect(provoked.events.find((event) => event.type === 'merchant.provoked'))
      .toMatchObject({ response: 'self-defense', sourceActorId: HERO_ID });
    // Once perception confirms the adjacent hero (as prepareMerchantTurn does before every
    // scheduled turn), the provoked merchant attacks the hero it stands next to.
    const aware = updateActor(provoked.state, MERCHANT_ACTOR_ID, { awareActorIds: [HERO_ID] });
    expect(merchantBehaviorAction({ state: aware, content: selfDefense, actorId: MERCHANT_ACTOR_ID }))
      .toMatchObject({ type: 'bump-attack', targetActorId: HERO_ID });
  });

  it('provokes before the ordinary explicit adjacent attack resolves, even on a miss', () => {
    const run = merchantRun();
    const attacked = resolveCommand(run, {
      type: 'attack', commandId: 'command.attack', expectedRevision: 0,
      targetActorId: MERCHANT_ACTOR_ID,
    }, context());
    expect(attacked.result.status).toBe('applied');
    const record = attacked.state.recentCommands.at(-1)!;
    const types = record.events.map((event) => event.type);
    const attackIndex = types.findIndex((type) => type === 'attack.hit' || type === 'attack.missed');
    expect(attackIndex).toBeGreaterThan(-1);
    for (const provocation of ['reputation.changed', 'relationship.changed', 'merchant.provoked', 'merchant.stock-dropped']) {
      const index = types.indexOf(provocation as DomainEvent['type']);
      expect(index).toBeGreaterThan(-1);
      expect(index).toBeLessThan(attackIndex);
    }
    expect(merchantPopulation(attacked.state).provoked).toBe(true);
    expect(groundUnits(attacked.state)).toBe(3);
    // The provoked state satisfies every save invariant, survives a round trip, and replays.
    const restored = decodeActiveRun(encodeActiveRun(attacked.state));
    expect(restored).toEqual(attacked.state);
    const replayed = resolveCommand(attacked.state, {
      type: 'attack', commandId: 'command.attack', expectedRevision: 0,
      targetActorId: MERCHANT_ACTOR_ID,
    }, context());
    expect(replayed.result).toEqual(attacked.result);
    expect(replayed.state).toBe(attacked.state);
  });

  it('provokes on the first hero-sourced ranged or effect damage', () => {
    const state = merchantRun();
    const damaged: DomainEvent = {
      type: 'actor.damaged', eventId: 'command.fire', actorId: MERCHANT_ACTOR_ID,
      sourceActorId: HERO_ID, amount: 3, health: 17,
    };
    const outcome = resolveMerchantCombatOutcomes({
      state, content, events: [damaged], eventId: 'command.fire',
    });
    expect(outcome.events.map((event) => event.type)).toEqual([
      'reputation.changed', 'relationship.changed', 'merchant.provoked', 'merchant.stock-dropped',
    ]);
    expect(merchantPopulation(outcome.state).provoked).toBe(true);
    // A second hero-sourced hit adds no further consequence.
    const again = resolveMerchantCombatOutcomes({
      state: outcome.state, content, events: [damaged], eventId: 'command.fire-2',
    });
    expect(again.events).toEqual([]);
  });
});

describe('merchant death consequences', () => {
  function deadMerchantRun(): ActiveRun {
    return updateActor(merchantRun(), MERCHANT_ACTOR_ID, { health: 0 });
  }

  it('destroys held stock, applies one hero-credited death penalty, and marks the merchant dead', () => {
    const state = deadMerchantRun();
    const death = resolveMerchantDeath({
      state, content, merchantPopulationId: POPULATION_ID,
      killerActorId: HERO_ID, eventId: 'event.death',
    });
    expect(death.events.map((event) => event.type)).toEqual(['reputation.changed', 'merchant.died']);
    expect(death.events[0]).toMatchObject({
      type: 'reputation.changed', reason: 'death', delta: encounter.definition.deathReputationDelta,
    });
    // Held stock is destroyed, never dropped.
    expect(death.state.items).toEqual([]);
    const population = merchantPopulation(death.state);
    expect(population.lifecycle).toBe('dead');
    expect(population.deathPenaltyApplied).toBe(true);
    expect(population.stockLossResolved).toBe(true);
    expect(population.livingMemberIds).toEqual([]);
    expect(population.formerMemberIds).toEqual([MERCHANT_ACTOR_ID]);
    expect(population.stockItemIds).toEqual([]);
    // The dead actor stays as a health-zero former member and the state round-trips.
    expect(death.state.actors.some((actor) => actor.actorId === MERCHANT_ACTOR_ID)).toBe(true);
    const restored = decodeActiveRun(encodeActiveRun(death.state));
    expect(restored).toEqual(death.state);
    // The consequence resolves at most once.
    const again = resolveMerchantDeath({
      state: death.state, content, merchantPopulationId: POPULATION_ID,
      killerActorId: HERO_ID, eventId: 'event.death-2',
    });
    expect(again.events).toEqual([]);
    expect(again.state).toBe(death.state);
  });

  it('applies no reputation delta when a monster is credited with the kill', () => {
    const state = withActor(deadMerchantRun(), beetle({ x: 3, y: 1 }));
    const death = resolveMerchantDeath({
      state, content, merchantPopulationId: POPULATION_ID,
      killerActorId: BEETLE_ID, eventId: 'event.death',
    });
    expect(death.events.map((event) => event.type)).toEqual(['merchant.died']);
    expect(death.state.reputations).toEqual(state.reputations);
    expect(merchantPopulation(death.state).lifecycle).toBe('dead');
    const restored = decodeActiveRun(encodeActiveRun(death.state));
    expect(restored).toEqual(death.state);
  });

  it('clears an active trade with the death reason before the penalty', () => {
    const opened = openedRun();
    const state = updateActor(opened, MERCHANT_ACTOR_ID, { health: 0 });
    const death = resolveMerchantDeath({
      state, content, merchantPopulationId: POPULATION_ID,
      killerActorId: HERO_ID, eventId: 'event.death',
    });
    expect(death.events.map((event) => event.type)).toEqual(['trade.closed', 'reputation.changed', 'merchant.died']);
    expect(death.events[0]).toMatchObject({ type: 'trade.closed', reason: 'death' });
    expect(death.state.activeTrade).toBeNull();
  });

  it('resolves hero provocation and death together when one hit kills an unprovoked merchant', () => {
    const state = deadMerchantRun();
    const events: readonly DomainEvent[] = [
      { type: 'actor.damaged', eventId: 'command.fire', actorId: MERCHANT_ACTOR_ID,
        sourceActorId: HERO_ID, amount: 20, health: 0 },
      { type: 'actor.died', eventId: 'command.fire', actorId: MERCHANT_ACTOR_ID,
        contentId: npc.id, killerActorId: HERO_ID },
    ];
    const outcome = resolveMerchantCombatOutcomes({ state, content, events, eventId: 'command.fire' });
    const reputationReasons = outcome.events
      .filter((event) => event.type === 'reputation.changed')
      .map((event) => (event as Extract<DomainEvent, { type: 'reputation.changed' }>).reason);
    expect(reputationReasons).toEqual(['aggression', 'death']);
    const population = merchantPopulation(outcome.state);
    expect(population.lifecycle).toBe('dead');
    expect(population.provoked).toBe(true);
    // The provocation drop survives on the floor; the retained remainder is destroyed.
    expect(groundUnits(outcome.state)).toBe(3);
    expect(stockUnits(outcome.state)).toBe(0);
    const restored = decodeActiveRun(encodeActiveRun(outcome.state));
    expect(restored).toEqual(outcome.state);
  });
});

describe('active-floor merchant world steps', () => {
  it('lets a provoked merchant take a real turn after the hero attack without crashing', () => {
    const run = merchantRun();
    const attacked = resolveCommand(run, {
      type: 'attack', commandId: 'command.attack', expectedRevision: 0,
      targetActorId: MERCHANT_ACTOR_ID,
    }, context());
    expect(attacked.result.status).toBe('applied');
    const record = attacked.state.recentCommands.at(-1)!;
    expect(record.events.some((event) => event.type === 'actor.turn.completed'
      && event.actorId === MERCHANT_ACTOR_ID)).toBe(true);
    // Fleeing lifecycle: the merchant moved away from the hero rather than standing still.
    const survivor = attacked.state.actors.find((actor) => actor.actorId === MERCHANT_ACTOR_ID);
    if (survivor && survivor.health > 0) {
      expect(Math.max(Math.abs(survivor.x - 1), Math.abs(survivor.y - 1))).toBeGreaterThan(1);
    }
    const restored = decodeActiveRun(encodeActiveRun(attacked.state));
    expect(restored).toEqual(attacked.state);
  });

  it('scrubs in-flight intent events when the merchant departs within the same command', () => {
    let run = withActor(merchantRun(), beetle({ x: 5, y: 3 }));
    run = setRelationship(run, BEETLE_ID, MERCHANT_ACTOR_ID, 'hostile');
    const population = merchantPopulation(run);
    // The next world-time boundary crosses the departure deadline.
    run = { ...run, worldTime: population.departureAt - 1, activeFloorEnteredAt: population.departureAt - 1 };
    const stepped = resolveCommand(run, { type: 'wait', commandId: 'command.wait-1', expectedRevision: 0 }, context());
    expect(stepped.result.status).toBe('applied');
    const record = stepped.state.recentCommands.at(-1)!;
    expect(record.events.some((event) => event.type === 'merchant.departed')).toBe(true);
    // The merchant acted (its threat changed its intent) before departing, yet no dangling
    // intent reference survives in the recorded command.
    expect(record.events.some((event) => event.type === 'actor.turn.completed'
      && event.actorId === MERCHANT_ACTOR_ID)).toBe(true);
    expect(record.events.some((event) => event.type === 'actor.intent-changed'
      && event.actorId === MERCHANT_ACTOR_ID)).toBe(false);
    expect(record.publicEvents.some((event) => event.type === 'actor.intent-changed'
      && event.actorId === MERCHANT_ACTOR_ID)).toBe(false);
    expect(stepped.state.actors.some((actor) => actor.actorId === MERCHANT_ACTOR_ID)).toBe(false);
    const restored = decodeActiveRun(encodeActiveRun(stepped.state));
    expect(restored).toEqual(stepped.state);
  });
});
