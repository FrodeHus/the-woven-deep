import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  addGeneratedFloor,
  allocateFloorSeed,
  createDemoRun,
  heroActor,
  heroPerception,
  refreshKnowledge,
  stableJson,
  type ActiveRun,
  type FloorSeedAllocation,
  type GeneratedFloor,
} from '../src/index.js';

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
