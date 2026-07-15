import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  compileContentDirectory,
  type CompiledContentPack,
  type MerchantEncounterContentEntry,
  type NpcFactionContentEntry,
} from '@woven-deep/content/compiler';
import {
  advanceMerchantLifecycle,
  allocateFloorSeed,
  allocateIdentificationMap,
  createDemoRun,
  decodeActiveRun,
  encodeActiveRun,
  integrateGeneratedFloor,
  materializeMerchant,
  resolveCommand,
  stableJson,
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
let faction: NpcFactionContentEntry;

const POPULATION_ID = 'population.merchant-demo';
const MERCHANT_ACTOR_ID = `actor.${POPULATION_ID}.001`;
const HERO_ID = 'hero.demo';

beforeAll(async () => {
  content = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
  encounter = content.entries.find((entry): entry is MerchantEncounterContentEntry =>
    entry.kind === 'encounter' && entry.model === 'merchant')!;
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

/** Merchant adjacent to the hero on the active demo floor, already encountered. */
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
function offFloorRun(encountered = true): ActiveRun {
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
        ? { ...decision, encountered, reachedEligibleDepth: encountered || decision.reachedEligibleDepth }
        : decision),
  };
}

function merchantPopulation(run: ActiveRun): MerchantPopulation {
  return run.populations.find((population): population is MerchantPopulation =>
    population.model === 'merchant')!;
}

function merchantActor(run: ActiveRun): ActorState {
  return run.actors.find((actor) => actor.actorId === merchantPopulation(run).actorId)!;
}

function atWorldTime(run: ActiveRun, worldTime: number): ActiveRun {
  return { ...run, worldTime };
}

function openCommand(overrides: Partial<Extract<GameCommand, { type: 'trade-open' }>> = {}): GameCommand {
  return { type: 'trade-open', commandId: 'command.trade-open', expectedRevision: 0,
    merchantActorId: MERCHANT_ACTOR_ID, ...overrides };
}

function openedRun(): ActiveRun {
  const run = merchantRun();
  const opened = resolveCommand(run, openCommand(), context());
  if (opened.result.status !== 'applied') throw new Error(`fixture open failed: ${stableJson(opened.result)}`);
  return opened.state;
}

function waitCommand(overrides: Partial<Extract<GameCommand, { type: 'wait' }>> = {}): GameCommand {
  return { type: 'wait', commandId: 'command.wait-1', expectedRevision: 0, ...overrides };
}

describe('advanceMerchantLifecycle', () => {
  it('emits every crossed warning threshold exactly once, in descending order', () => {
    const run = merchantRun();
    const population = merchantPopulation(run);
    const first = advanceMerchantLifecycle({
      state: atWorldTime(run, population.departureAt - 400),
      content,
      previousWorldTime: population.departureAt - 1500,
      nextWorldTime: population.departureAt - 400,
      eventId: 'event.warnings-1',
    });
    expect(first.events).toEqual([
      { type: 'merchant.departure-warning', eventId: 'event.warnings-1', populationId: POPULATION_ID,
        actorId: MERCHANT_ACTOR_ID, threshold: 1000, remaining: 400 },
      { type: 'merchant.departure-warning', eventId: 'event.warnings-1', populationId: POPULATION_ID,
        actorId: MERCHANT_ACTOR_ID, threshold: 500, remaining: 400 },
    ]);
    expect(merchantPopulation(first.state).emittedWarningThresholds).toEqual([1000, 500]);
    expect(first.state.actors).toEqual(run.actors);
    expect(first.state.items).toEqual(run.items);

    const second = advanceMerchantLifecycle({
      state: atWorldTime(first.state, population.departureAt - 50),
      content,
      previousWorldTime: population.departureAt - 400,
      nextWorldTime: population.departureAt - 50,
      eventId: 'event.warnings-2',
    });
    expect(second.events).toEqual([
      { type: 'merchant.departure-warning', eventId: 'event.warnings-2', populationId: POPULATION_ID,
        actorId: MERCHANT_ACTOR_ID, threshold: 100, remaining: 50 },
    ]);
    expect(merchantPopulation(second.state).emittedWarningThresholds).toEqual([1000, 500, 100]);

    const third = advanceMerchantLifecycle({
      state: atWorldTime(second.state, population.departureAt - 25),
      content,
      previousWorldTime: population.departureAt - 50,
      nextWorldTime: population.departureAt - 25,
      eventId: 'event.warnings-3',
    });
    expect(third.events).toEqual([]);
    expect(merchantPopulation(third.state).emittedWarningThresholds).toEqual([1000, 500, 100]);
  });

  it('processes merchant populations in stable population-id order', () => {
    const base = merchantRun();
    const population = merchantPopulation(base);
    const actor = merchantActor(base);
    const secondId = 'population.zzz-merchant';
    const secondActorId = `actor.${secondId}.001`;
    const second: MerchantPopulation = {
      ...population, populationId: secondId, actorId: secondActorId,
      livingMemberIds: [secondActorId], initialStockItemIds: [], stockItemIds: [],
    };
    const run: ActiveRun = {
      ...base,
      actors: [...base.actors, { ...actor, actorId: secondActorId, populationId: secondId, x: 3, y: 1 }]
        .sort((left, right) => left.actorId < right.actorId ? -1 : 1),
      populations: [second, population],
    };
    const advanced = advanceMerchantLifecycle({
      state: atWorldTime(run, population.departureAt - 900),
      content,
      previousWorldTime: population.departureAt - 1100,
      nextWorldTime: population.departureAt - 900,
      eventId: 'event.ordering',
    });
    expect(advanced.events.map((event) => event.type === 'merchant.departure-warning' ? event.populationId : event.type))
      .toEqual([POPULATION_ID, secondId]);
  });

  it('never repeats a warning threshold after save and load', () => {
    const run = merchantRun();
    const population = merchantPopulation(run);
    const warned = advanceMerchantLifecycle({
      state: atWorldTime(run, population.departureAt - 400),
      content,
      previousWorldTime: 0,
      nextWorldTime: population.departureAt - 400,
      eventId: 'event.before-save',
    });
    expect(warned.events).toHaveLength(2);
    const restored = decodeActiveRun(encodeActiveRun(warned.state));
    expect(merchantPopulation(restored).emittedWarningThresholds).toEqual([1000, 500]);
    const again = advanceMerchantLifecycle({
      state: restored,
      content,
      previousWorldTime: population.departureAt - 400,
      nextWorldTime: population.departureAt - 400,
      eventId: 'event.after-load',
    });
    expect(again.events).toEqual([]);
  });

  it('departs a due off-floor merchant atomically without simulating its turn', () => {
    const run = offFloorRun();
    const population = merchantPopulation(run);
    const before = merchantActor(run);
    const advanced = advanceMerchantLifecycle({
      state: atWorldTime(run, population.departureAt + 300),
      content,
      previousWorldTime: population.departureAt - 100,
      nextWorldTime: population.departureAt + 300,
      eventId: 'event.deadlines',
    });
    expect(advanced.events.map((event) => event.type)).toContain('merchant.departed');
    expect(advanced.events).toEqual([{
      type: 'merchant.departed', eventId: 'event.deadlines', populationId: population.populationId,
      actorId: population.actorId, stockItemIds: population.stockItemIds,
    }]);
    expect(advanced.state.actors).not.toContainEqual(expect.objectContaining({ actorId: before.actorId }));
    expect(advanced.state.items.some((entry) => entry.location.type === 'merchant-stock')).toBe(false);
    const departed = merchantPopulation(advanced.state);
    expect(departed.lifecycle).toBe('departed');
    expect(departed.livingMemberIds).toEqual([]);
    expect(departed.stockItemIds).toEqual([]);
    // The hero and every other actor stay frozen: no energy, position, or behavior change.
    const untouched = run.actors.filter((actor) => actor.actorId !== before.actorId);
    expect(advanced.state.actors).toEqual(untouched);
    expect(advanced.state.floors).toEqual(run.floors);
    expect(advanced.state.rng).toEqual(run.rng);
  });

  it('scrubs recorded intent events referencing the departed merchant so the run stays saveable', () => {
    const opened = openedRun();
    const population = merchantPopulation(opened);
    const closed = resolveCommand(opened, {
      type: 'trade-close', commandId: 'command.trade-close-1', expectedRevision: 1,
      merchantPopulationId: population.populationId,
    }, context());
    expect(closed.result.status).toBe('applied');
    // A provoked merchant records an intent change within the recent-command window.
    const intentEvent: DomainEvent = {
      type: 'actor.intent-changed', eventId: 'command.trade-open',
      actorId: MERCHANT_ACTOR_ID, intent: 'flee', presentation: 'intent.flee', targetCategory: null,
    };
    const provoked: ActiveRun = {
      ...closed.state,
      recentCommands: closed.state.recentCommands.map((record) =>
        record.command.commandId === 'command.trade-open'
          ? { ...record, events: [...record.events, intentEvent] }
          : record),
    };
    // While the merchant still exists the recorded intent event satisfies every save invariant.
    expect(() => encodeActiveRun(provoked)).not.toThrow();
    const advanced = advanceMerchantLifecycle({
      state: atWorldTime(provoked, population.departureAt + 1),
      content,
      previousWorldTime: population.departureAt - 1,
      nextWorldTime: population.departureAt + 1,
      eventId: 'event.depart-intent',
    });
    expect(advanced.events.map((event) => event.type)).toContain('merchant.departed');
    expect(advanced.state.recentCommands.some((record) => record.events.some((event) =>
      event.type === 'actor.intent-changed' && event.actorId === MERCHANT_ACTOR_ID))).toBe(false);
    // The command records themselves survive for dedup and replay, keeping their other events.
    expect(advanced.state.recentCommands.map((record) => record.command.commandId))
      .toEqual(provoked.recentCommands.map((record) => record.command.commandId));
    expect(advanced.state.recentCommands.at(-1)!.events.some((event) =>
      event.type === 'trade.closed')).toBe(true);
    const restored = decodeActiveRun(encodeActiveRun(advanced.state));
    expect(restored).toEqual(advanced.state);
  });

  it('scrubs condition sources referencing the departed merchant so the run stays saveable', () => {
    const run = merchantRun();
    const population = merchantPopulation(run);
    const withCondition: ActiveRun = {
      ...run,
      actors: run.actors.map((actor) => actor.actorId === HERO_ID
        ? { ...actor, conditions: [{ conditionId: 'condition.disengaged', sourceActorId: MERCHANT_ACTOR_ID,
          appliedAt: 0, expiresAt: population.departureAt + 1000, stacks: 1 }] }
        : actor),
    };
    const advanced = advanceMerchantLifecycle({
      state: atWorldTime(withCondition, population.departureAt + 1),
      content,
      previousWorldTime: 0,
      nextWorldTime: population.departureAt + 1,
      eventId: 'event.depart-condition',
    });
    expect(advanced.events.map((event) => event.type)).toContain('merchant.departed');
    const hero = advanced.state.actors.find((actor) => actor.actorId === HERO_ID)!;
    // The condition itself survives departure; only its stale source reference is cleared.
    expect(hero.conditions).toEqual([{ conditionId: 'condition.disengaged', sourceActorId: null,
      appliedAt: 0, expiresAt: population.departureAt + 1000, stacks: 1 }]);
    const restored = decodeActiveRun(encodeActiveRun(advanced.state));
    expect(restored).toEqual(advanced.state);
  });

  it('defers departure while the active trade remains valid', () => {
    const opened = openedRun();
    const population = merchantPopulation(opened);
    const due = atWorldTime(opened, population.departureAt);
    const advanced = advanceMerchantLifecycle({
      state: due,
      content,
      previousWorldTime: population.departureAt,
      nextWorldTime: population.departureAt,
      eventId: 'event.deferral',
    });
    expect(advanced.events).toEqual([]);
    expect(advanced.state.activeTrade).toEqual(opened.activeTrade);
    expect(advanced.state.actors.some((actor) => actor.actorId === population.actorId)).toBe(true);
    expect(merchantPopulation(advanced.state).lifecycle).toBe('available');
  });

  it('closes an invalid trade before departure proceeds', () => {
    const opened = openedRun();
    const population = merchantPopulation(opened);
    const separated: ActiveRun = {
      ...atWorldTime(opened, population.departureAt),
      actors: opened.actors.map((actor) =>
        actor.actorId === population.actorId ? { ...actor, x: 5, y: 3 } : actor),
    };
    const advanced = advanceMerchantLifecycle({
      state: separated,
      content,
      previousWorldTime: population.departureAt,
      nextWorldTime: population.departureAt,
      eventId: 'event.auto-close',
    });
    expect(advanced.events.map((event) => event.type)).toEqual(['trade.closed', 'merchant.departed']);
    expect(advanced.events[0]).toMatchObject({ type: 'trade.closed', merchantPopulationId: population.populationId });
    expect(advanced.state.activeTrade).toBeNull();
    expect(merchantPopulation(advanced.state).lifecycle).toBe('departed');
    expect(advanced.state.actors.some((actor) => actor.actorId === population.actorId)).toBe(false);
  });
});

describe('world-step merchant deadlines', () => {
  it('emits off-floor warnings without altering inactive-floor actors', () => {
    const base = offFloorRun();
    const population = merchantPopulation(base);
    const primed: ActiveRun = {
      ...atWorldTime(base, population.departureAt - 100),
      populations: base.populations.map((candidate) => candidate.populationId === population.populationId
        ? { ...population, emittedWarningThresholds: [1000, 500] } : candidate),
    };
    const before = merchantActor(primed);
    const stepped = resolveCommand(primed, waitCommand(), context());
    expect(stepped.result.status).toBe('applied');
    const record = stepped.state.recentCommands.at(-1)!;
    const warnings = record.events.filter((event) => event.type === 'merchant.departure-warning');
    expect(warnings).toEqual([{
      type: 'merchant.departure-warning', eventId: 'command.wait-1',
      populationId: population.populationId, actorId: population.actorId,
      threshold: 100, remaining: 99,
    }]);
    // The off-floor merchant is not visible, so the player receives no public warning; the
    // authoritative record above still carries it for replay.
    expect(stepped.events).toEqual([expect.objectContaining({ type: 'hero.waited' })]);
    const after = stepped.state.actors.find((actor) => actor.actorId === population.actorId);
    expect(after).toEqual(before);
    expect(merchantPopulation(stepped.state).emittedWarningThresholds).toEqual([1000, 500, 100]);
  });

  it('hides merchant lifecycle notices until the merchant was encountered', () => {
    const base = offFloorRun(false);
    const population = merchantPopulation(base);
    const primed = atWorldTime(base, population.departureAt - 50);
    const stepped = resolveCommand(primed, waitCommand(), context());
    expect(stepped.result.status).toBe('applied');
    const record = stepped.state.recentCommands.at(-1)!;
    expect(record.events.some((event) => event.type === 'merchant.departure-warning')).toBe(true);
    expect(stepped.events.some((event) => event.type === 'merchant.departure-warning')).toBe(false);
  });

  it('departs an off-floor merchant when world time crosses its deadline', () => {
    const base = offFloorRun();
    const population = merchantPopulation(base);
    const primed: ActiveRun = {
      ...atWorldTime(base, population.departureAt - 1),
      populations: base.populations.map((candidate) => candidate.populationId === population.populationId
        ? { ...population, emittedWarningThresholds: [1000, 500, 100] } : candidate),
    };
    const stepped = resolveCommand(primed, waitCommand(), context());
    expect(stepped.result.status).toBe('applied');
    const record = stepped.state.recentCommands.at(-1)!;
    expect(record.events.some((event) => event.type === 'merchant.departed')).toBe(true);
    expect(stepped.state.actors.some((actor) => actor.actorId === population.actorId)).toBe(false);
    expect(stepped.state.items.some((entry) => entry.location.type === 'merchant-stock')).toBe(false);
    expect(merchantPopulation(stepped.state).lifecycle).toBe('departed');
    // The departed state satisfies every save invariant and survives a round trip.
    const restored = decodeActiveRun(encodeActiveRun(stepped.state));
    expect(restored).toEqual(stepped.state);
  });

  it('resolves an already-due merchant on the first world step after load', () => {
    const base = offFloorRun();
    const population = merchantPopulation(base);
    const due = atWorldTime(base, population.departureAt + 10);
    const stepped = resolveCommand(due, waitCommand(), context());
    expect(stepped.result.status).toBe('applied');
    expect(merchantPopulation(stepped.state).lifecycle).toBe('departed');
    expect(stepped.state.actors.some((actor) => actor.actorId === population.actorId)).toBe(false);
  });
});

describe('rest merchant deadlines', () => {
  it('departs a due merchant during rest substeps', () => {
    const base = offFloorRun();
    const population = merchantPopulation(base);
    const primed: ActiveRun = {
      ...atWorldTime(base, population.departureAt - 150),
      actors: base.actors.map((actor) => actor.actorId === HERO_ID ? { ...actor, health: 10 } : actor),
    };
    const rested = resolveCommand(primed, {
      type: 'rest', commandId: 'command.rest-1', expectedRevision: 0,
      until: 'interrupted', maximumDuration: 400,
    }, context());
    expect(rested.result.status).toBe('applied');
    const record = rested.state.recentCommands.at(-1)!;
    expect(record.events.some((event) => event.type === 'merchant.departed')).toBe(true);
    expect(merchantPopulation(rested.state).lifecycle).toBe('departed');
  });

  it('resolves a due merchant even when rest completes immediately', () => {
    const base = offFloorRun();
    const population = merchantPopulation(base);
    const due = atWorldTime(base, population.departureAt);
    const rested = resolveCommand(due, {
      type: 'rest', commandId: 'command.rest-2', expectedRevision: 0,
      until: 'healed', maximumDuration: 400,
    }, context());
    expect(rested.result.status).toBe('applied');
    const record = rested.state.recentCommands.at(-1)!;
    expect(record.events.some((event) => event.type === 'merchant.departed')).toBe(true);
    expect(record.events.some((event) => event.type === 'rest.completed')).toBe(true);
    expect(merchantPopulation(rested.state).lifecycle).toBe('departed');
  });
});

describe('trade boundaries and merchant deadlines', () => {
  it('rejects opening a trade with a due merchant and never departs it mid-command', () => {
    const run = merchantRun();
    const population = merchantPopulation(run);
    const due = atWorldTime(run, population.departureAt);
    const opened = resolveCommand(due, openCommand(), context());
    expect(opened.result).toMatchObject({ status: 'invalid', reason: 'merchant.unavailable' });
    const record = opened.state.recentCommands.at(-1)!;
    expect(record.events.some((event) => event.type === 'merchant.departed')).toBe(false);
    expect(merchantPopulation(opened.state).lifecycle).toBe('available');
  });

  it('closes a due-on-load trade automatically and departs the merchant after closure', () => {
    const opened = openedRun();
    const population = merchantPopulation(opened);
    const due = atWorldTime(opened, population.departureAt);
    const closed = resolveCommand(due, {
      type: 'trade-close', commandId: 'command.trade-close', expectedRevision: 1,
      merchantPopulationId: population.populationId,
    }, context());
    const record = closed.state.recentCommands.at(-1)!;
    expect(record.events.map((event) => event.type).filter((type) =>
      type === 'trade.closed' || type === 'merchant.departed'))
      .toEqual(['trade.closed', 'merchant.departed']);
    expect(record.events.find((event) => event.type === 'trade.closed'))
      .toMatchObject({ reason: 'departure', completedCommerce: false });
    expect(closed.state.activeTrade).toBeNull();
    expect(merchantPopulation(closed.state).lifecycle).toBe('departed');
    expect(closed.state.actors.some((actor) => actor.actorId === population.actorId)).toBe(false);
  });
});

describe('floor-transition merchant deadlines', () => {
  it('departs an already-due merchant when integrating a new floor', () => {
    const base = offFloorRun();
    const population = merchantPopulation(base);
    const due = atWorldTime(base, population.departureAt + 25);
    const integrated = integrateGeneratedFloor(
      due,
      generatedFloor('floor.generated-02', allocateFloorSeed(due.rng.generation).floorSeed),
      allocateFloorSeed(due.rng.generation),
      { content },
    );
    expect(integrated.events.some((event) => event.type === 'merchant.departed')).toBe(true);
    const departed = integrated.state.populations.find((candidate): candidate is MerchantPopulation =>
      candidate.model === 'merchant' && candidate.populationId === population.populationId)!;
    expect(departed.lifecycle).toBe('departed');
    expect(departed.stockItemIds).toEqual([]);
    expect(integrated.state.actors.some((actor) => actor.actorId === population.actorId)).toBe(false);
  });
});
