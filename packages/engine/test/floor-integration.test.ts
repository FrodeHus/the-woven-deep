import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { compileContentDirectory, type CompiledContentPack, type EncounterContentEntry,
  type MerchantEncounterContentEntry } from '@woven-deep/content/compiler';
import {
  addGeneratedFloor,
  allocateFloorSeed,
  createDemoRun,
  decodeActiveRun,
  encodeActiveRun,
  heroActor,
  integrateGeneratedFloor,
  projectDomainEvents,
  heroPerception,
  refreshKnowledge,
  stableJson,
  type ActiveRun,
  type FloorSeedAllocation,
  type GeneratedFloor,
} from '../src/index.js';

let content: CompiledContentPack;

beforeAll(async () => {
  content = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
});

function generatedFloor(
  floorId = 'floor.generated-01',
  floorSeed: FloorSeedAllocation['floorSeed'] = allocateFloorSeed(createDemoRun().rng.generation).floorSeed,
): GeneratedFloor {
  const floor = JSON.parse(readFileSync(new URL('./fixtures/generated-floor-seed-1.json', import.meta.url), 'utf8')) as GeneratedFloor['floor'];
  return {
    floor: { ...floor, floorId, seed: floorSeed },
    report: {
      generatorVersion: 2, attempt: 0, fallback: false, roomCount: 8, corridorCount: 7,
      vaults: [], stairUp: floor.stairUp!, stairDown: floor.stairDown!, stairDistance: 42,
      traversableCellCount: 400, connected: true, rejectionCounts: { 'topology.empty': 1 },
    },
  };
}

function allocation(run: ActiveRun = createDemoRun()): FloorSeedAllocation {
  return allocateFloorSeed(run.rng.generation);
}

describe('addGeneratedFloor', () => {
  it('atomically commits merchant actor, population, stock, decisions, and both owned RNG streams', () => {
    const encounter = content.entries.find((entry): entry is MerchantEncounterContentEntry =>
      entry.kind === 'encounter' && entry.model === 'merchant')!;
    const base = createDemoRun();
    const run: ActiveRun = { ...base, contentHash: content.hash, encounterDecisions: [{
      encounterId: encounter.id, baseProbability: 1, protectionBonus: 0, effectiveProbability: 1,
      eligible: true, reachedEligibleDepth: false, encountered: false, instancesCreated: 0,
    }] };

    const integrated = integrateGeneratedFloor(run, generatedFloor(), allocation(run), {
      content, forcedEncounterId: encounter.id,
    });
    const merchant = integrated.state.populations.find((entry) => entry.model === 'merchant');

    expect(merchant?.model).toBe('merchant');
    if (!merchant || merchant.model !== 'merchant') return;
    expect(integrated.state.actors.some((actor) => actor.actorId === merchant.actorId)).toBe(true);
    expect(integrated.state.items.filter((item) => item.location.type === 'merchant-stock'
      && item.location.populationId === merchant.populationId).map((item) => item.itemId))
      .toEqual(merchant.stockItemIds);
    expect(integrated.state.rng.encounters).toEqual(run.rng.encounters);
    expect(integrated.state.rng['merchant-stock']).not.toEqual(run.rng['merchant-stock']);
    expect(integrated.state.rng.combat).toEqual(run.rng.combat);
    expect(integrated.state.rng.loot).toEqual(run.rng.loot);
    expect(integrated.events).toEqual([expect.objectContaining({ type: 'population.created',
      populationId: merchant.populationId, model: 'merchant' })]);
  });

  it('preserves merchant lifetime, stock, and service uses across save/load without re-rolling', () => {
    const encounter = content.entries.find((entry): entry is MerchantEncounterContentEntry =>
      entry.kind === 'encounter' && entry.model === 'merchant')!;
    const base = createDemoRun();
    const run: ActiveRun = { ...base, contentHash: content.hash, encounterDecisions: [{
      encounterId: encounter.id, baseProbability: 1, protectionBonus: 0, effectiveProbability: 1,
      eligible: true, reachedEligibleDepth: false, encountered: false, instancesCreated: 0,
    }] };
    const integrated = integrateGeneratedFloor(run, generatedFloor(), allocation(run), {
      content, forcedEncounterId: encounter.id,
    });
    const merchant = integrated.state.populations.find((entry) => entry.model === 'merchant');
    expect(merchant?.model).toBe('merchant');
    if (!merchant || merchant.model !== 'merchant') return;

    const restored = decodeActiveRun(encodeActiveRun(integrated.state));
    const restoredMerchant = restored.populations.find((entry) => entry.model === 'merchant');

    expect(restored).toEqual(integrated.state);
    expect(restoredMerchant).toEqual(merchant);
    if (!restoredMerchant || restoredMerchant.model !== 'merchant') return;
    expect(restoredMerchant.rolledLifetime).toBe(merchant.rolledLifetime);
    expect(restoredMerchant.departureAt).toBe(merchant.departureAt);
    expect(restoredMerchant.stockItemIds).toEqual(merchant.stockItemIds);
    expect(restoredMerchant.initialStockItemIds).toEqual(merchant.initialStockItemIds);
    expect(restoredMerchant.services).toEqual(merchant.services);
    expect(restored.items.filter((item) => item.location.type === 'merchant-stock'))
      .toEqual(integrated.state.items.filter((item) => item.location.type === 'merchant-stock'));
    // The merchant-stock stream must round-trip untouched: loading never re-rolls stock.
    expect(restored.rng['merchant-stock']).toEqual(integrated.state.rng['merchant-stock']);
    expect(decodeActiveRun(encodeActiveRun(restored))).toEqual(restored);
  });

  it('does not advance merchant stock or create items when merchant placement is skipped', () => {
    const source = content.entries.find((entry): entry is MerchantEncounterContentEntry =>
      entry.kind === 'encounter' && entry.model === 'merchant')!;
    const impossible = { ...source, placement: { ...source.placement, minimumStairDistance: 10_000 } };
    const pack = { ...content, entries: content.entries.map((entry) => entry.id === source.id ? impossible : entry) };
    const base = createDemoRun();
    const run: ActiveRun = { ...base, contentHash: pack.hash, encounterDecisions: [{
      encounterId: source.id, baseProbability: 1, protectionBonus: 0, effectiveProbability: 1,
      eligible: true, reachedEligibleDepth: false, encountered: false, instancesCreated: 0,
    }] };

    const integrated = integrateGeneratedFloor(run, generatedFloor(), allocation(run), {
      content: pack, forcedEncounterId: source.id,
    });

    expect(integrated.state.items).toEqual(run.items);
    expect(integrated.state.rng['merchant-stock']).toEqual(run.rng['merchant-stock']);
    expect(integrated.state.rng.encounters).toEqual(run.rng.encounters);
    expect(integrated.state.populations).toEqual([]);
  });
  it('emits a committed population creation exactly once from floor integration', () => {
    const encounter = content.entries.find((entry): entry is EncounterContentEntry =>
      entry.kind === 'encounter' && entry.id === 'encounter.cave-rat-individuals')!;
    const base = createDemoRun();
    const run: ActiveRun = { ...base, contentHash: content.hash, encounterDecisions: [{
      encounterId: encounter.id, baseProbability: 1, protectionBonus: 0, effectiveProbability: 1,
      eligible: true, reachedEligibleDepth: false, encountered: false, instancesCreated: 0,
    }] };
    const integrated = integrateGeneratedFloor(run, generatedFloor(), allocation(run), {
      content, forcedEncounterId: encounter.id,
    });
    const population = integrated.state.populations[0]!;
    expect(integrated.events).toEqual([{
      type: 'population.created', eventId: 'event.floor.generated-01.population',
      populationId: population.populationId, encounterId: encounter.id, floorId: population.floorId,
      model: 'individual', actorIds: population.livingMemberIds,
    }]);
    expect(projectDomainEvents({ state: integrated.state, content, heroId: integrated.state.hero.actorId,
      events: integrated.events })).toEqual([]);
    expect(() => integrateGeneratedFloor(integrated.state, generatedFloor('floor.generated-01'),
      allocation(integrated.state), { content, forcedEncounterId: encounter.id })).toThrow();
  });

  it('emits group leader creation only when a committed placement has a leader', () => {
    const encounter = content.entries.find((entry): entry is EncounterContentEntry =>
      entry.kind === 'encounter' && entry.id === 'encounter.beetle-patrol')!;
    const base = createDemoRun();
    const run: ActiveRun = { ...base, contentHash: content.hash, rng: { ...base.rng, encounters: [1, 2, 3, 4] },
      encounterDecisions: [{ encounterId: encounter.id, baseProbability: 1, protectionBonus: 0,
        effectiveProbability: 1, eligible: true, reachedEligibleDepth: false, encountered: false, instancesCreated: 0 }] };
    const integrated = integrateGeneratedFloor(run, generatedFloor(), allocation(run), {
      content, forcedEncounterId: encounter.id,
    });
    const population = integrated.state.populations[0]!;
    expect(population.model).toBe('group');
    if (population.model !== 'group') throw new Error('expected group');
    expect(population.leaderActorId).not.toBeNull();
    expect(integrated.events.map((event) => event.type)).toEqual(['population.created', 'group.leader-created']);
    expect(integrated.events[1]).toMatchObject({ actorId: population.leaderActorId, roleId: 'guard' });
  });

  it('emits an optional placement skip but never publishes rejected draft work', () => {
    const source = content.entries.find((entry): entry is EncounterContentEntry =>
      entry.kind === 'encounter' && entry.id === 'encounter.cave-rat-individuals')!;
    const impossible = { ...source, placement: { ...source.placement, minimumStairDistance: 10_000 } };
    const pack = { ...content, entries: content.entries.map((entry) => entry.id === source.id ? impossible : entry) };
    const base = createDemoRun();
    const run: ActiveRun = { ...base, contentHash: pack.hash, encounterDecisions: [{
      encounterId: source.id, baseProbability: 1, protectionBonus: 0, effectiveProbability: 1,
      eligible: true, reachedEligibleDepth: false, encountered: false, instancesCreated: 0,
    }] };
    const integrated = integrateGeneratedFloor(run, generatedFloor(), allocation(run), {
      content: pack, forcedEncounterId: source.id,
    });
    expect(integrated.state.populations).toEqual([]);
    expect(integrated.events).toEqual([{
      type: 'population.placement-skipped', eventId: 'event.floor.generated-01.population',
      encounterId: source.id, floorId: 'floor.generated-01', reason: 'no-valid-placement',
    }]);
    expect(projectDomainEvents({ state: integrated.state, content: pack, heroId: integrated.state.hero.actorId,
      events: integrated.events })).toEqual([]);
    const requiredPack = { ...pack, entries: pack.entries.map((entry) => entry.id === source.id
      ? { ...impossible, placement: { ...impossible.placement, failureMode: 'required' as const } } : entry) };
    expect(() => integrateGeneratedFloor({ ...run, contentHash: requiredPack.hash }, generatedFloor(), allocation(run), {
      content: requiredPack, forcedEncounterId: source.id,
    })).toThrow(/rejected/);
  });
  it('atomically publishes a generated floor population and advances both owned streams', () => {
    const encounter = content.entries.find((entry): entry is EncounterContentEntry =>
      entry.kind === 'encounter' && entry.id === 'encounter.cave-rat-individuals')!;
    const base = createDemoRun();
    const run: ActiveRun = {
      ...base,
      contentHash: content.hash,
      encounterDecisions: [{
        encounterId: encounter.id, baseProbability: 1, protectionBonus: 0, effectiveProbability: 1,
        eligible: true, reachedEligibleDepth: false, encountered: false, instancesCreated: 0,
      }],
    };
    const generated = generatedFloor();

    const result = addGeneratedFloor(run, generated, allocation(run), {
      content, forcedEncounterId: encounter.id,
    });

    expect(result.floors[1]!.entities).toHaveLength(0);
    expect(result.actors.filter((actor) => actor.populationId !== null).length).toBeGreaterThan(0);
    expect(result.populations).toHaveLength(1);
    expect(result.populations[0]!.floorId).toBe(generated.floor.floorId);
    expect(result.encounterDecisions[0]!.instancesCreated).toBe(1);
    expect(result.rng.generation).toEqual(allocation(run).nextGenerationState);
    expect(result.rng.encounters).not.toEqual(run.rng.encounters);
  });

  it('appends a complete floor and advances only the generation stream', () => {
    const run = createDemoRun();
    const generated = generatedFloor();
    const result = addGeneratedFloor(run, generated, allocation());

    expect(result.floors.map((floor) => floor.floorId)).toEqual(['floor.demo', 'floor.generated-01']);
    expect(result.floors[1]).toEqual(generated.floor);
    expect(result.rng).toEqual({ ...run.rng, generation: allocation(run).nextGenerationState });
    expect(result.activeFloorId).toBe(run.activeFloorId);
    expect(result.hero).toEqual(run.hero);
    expect(result.floors[0]).toEqual(run.floors[0]);
    expect(stableJson(result)).not.toMatch(/report|rejection|room|corridor/);
  });

  it('refreshes inserted-floor knowledge only for the deliberate transitional active-floor state', () => {
    const run = createDemoRun();
    const generated = generatedFloor();
    const stair = generated.floor.stairUp!;
    const transitional: ActiveRun = {
      ...run,
      activeFloorId: generated.floor.floorId,
      actors: [{ ...run.actors[0]!, floorId: generated.floor.floorId, ...stair }],
    };
    const result = addGeneratedFloor(transitional, generated, allocation());
    const inserted = result.floors[1]!;
    const actor = heroActor(transitional);
    const expected = refreshKnowledge({
      floor: generated.floor,
      hero: heroPerception(transitional.hero, actor),
      actors: new Map([[actor.actorId, actor]]),
    }).knowledge;

    expect(inserted.knowledge).toEqual(expected);
    expect(inserted.knowledge).not.toEqual(generated.floor.knowledge);
  });

  it('does not refresh an inactive inserted floor', () => {
    const generated = generatedFloor();
    const result = addGeneratedFloor(createDemoRun(), generated, allocation());
    expect(result.floors[1]!.knowledge).toEqual(generated.floor.knowledge);
  });

  it('records exactly one floor entry and the reached depth when the hero transitions onto the inserted floor', () => {
    const run = createDemoRun();
    const generated = generatedFloor();
    const stair = generated.floor.stairUp!;
    const transitional: ActiveRun = {
      ...run,
      activeFloorId: generated.floor.floorId,
      actors: [{ ...run.actors[0]!, floorId: generated.floor.floorId, ...stair }],
    };
    const result = addGeneratedFloor(transitional, generated, allocation());

    expect(result.metrics.floorsEntered).toBe(run.metrics.floorsEntered + 1);
    expect(result.metrics.deepestDepth).toBe(generated.floor.depth);
  });

  it('does not record a floor entry when appending a floor the hero has not transitioned onto', () => {
    const run = createDemoRun();
    const generated = generatedFloor();
    const result = addGeneratedFloor(run, generated, allocation());

    expect(result.metrics.floorsEntered).toBe(run.metrics.floorsEntered);
    expect(result.metrics.deepestDepth).toBe(run.metrics.deepestDepth);
  });

  it.each([
    [[0, 2, 3, 4], 'seed'],
    [[1, 0, 3, 4], 'seed'],
    [[1, 2, 0, 4], 'seed'],
    [[1, 2, 3, 0], 'seed'],
  ] as const)('rejects allocation seed corruption %j', (floorSeed, message) => {
    expect(() => addGeneratedFloor(createDemoRun(), generatedFloor(), {
      floorSeed, nextGenerationState: allocation().nextGenerationState,
    })).toThrow(message);
  });

  it('rejects a zero next generation state', () => {
    expect(() => addGeneratedFloor(createDemoRun(), generatedFloor(), {
      floorSeed: generatedFloor().floor.seed, nextGenerationState: [0, 0, 0, 0],
    })).toThrow(/generation state|all zero/);
  });

  it.each([
    ['floor.demo', /duplicate|append|increasing/],
    ['floor.aaa', /append|increasing|order/],
  ])('rejects non-append floor id %s', (floorId, message) => {
    expect(() => addGeneratedFloor(createDemoRun(), generatedFloor(floorId), allocation())).toThrow(message);
  });

  it('rejects invalid completed runs', () => {
    const generated = generatedFloor();
    const corrupted = { ...generated, floor: { ...generated.floor, tiles: generated.floor.tiles.slice(1) } };
    expect(() => addGeneratedFloor(createDemoRun(), corrupted, allocation())).toThrow(/tiles/);
  });

  it('does not mutate any input on success or rejection', () => {
    const run = createDemoRun();
    const generated = generatedFloor();
    const allocated = allocation();
    const before = [stableJson(run), stableJson(generated), stableJson(allocated)];

    addGeneratedFloor(run, generated, allocated);
    expect(() => addGeneratedFloor(run, generated, { ...allocated, nextGenerationState: [0, 0, 0, 0] })).toThrow();

    expect([stableJson(run), stableJson(generated), stableJson(allocated)]).toEqual(before);
  });

  it('rejects a forged allocation paired to its generated floor without mutating inputs', () => {
    const run = createDemoRun();
    const forged: FloorSeedAllocation = {
      floorSeed: [11, 12, 13, 14],
      nextGenerationState: [21, 22, 23, 24],
    };
    const generated = generatedFloor('floor.generated-01', forged.floorSeed);
    const before = [stableJson(run), stableJson(generated), stableJson(forged)];

    expect(() => addGeneratedFloor(run, generated, forged)).toThrow(/generation stream|allocation/);
    expect([stableJson(run), stableJson(generated), stableJson(forged)]).toEqual(before);
  });

  it('rejects reuse of a consumed allocation for another appended floor without mutating inputs', () => {
    const run = createDemoRun();
    const allocated = allocation(run);
    const advanced = addGeneratedFloor(run, generatedFloor('floor.generated-01', allocated.floorSeed), allocated);
    const reusedGenerated = generatedFloor('floor.generated-02', allocated.floorSeed);
    const before = [stableJson(advanced), stableJson(reusedGenerated), stableJson(allocated)];

    expect(() => addGeneratedFloor(advanced, reusedGenerated, allocated)).toThrow(/generation stream|allocation/);
    expect([stableJson(advanced), stableJson(reusedGenerated), stableJson(allocated)]).toEqual(before);
  });
});
