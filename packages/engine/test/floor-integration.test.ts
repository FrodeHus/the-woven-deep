import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  addGeneratedFloor,
  createDemoRun,
  refreshKnowledge,
  stableJson,
  type ActiveRun,
  type FloorSeedAllocation,
  type GeneratedFloor,
} from '../src/index.js';

function generatedFloor(floorId = 'floor.generated-01'): GeneratedFloor {
  const floor = JSON.parse(readFileSync(new URL('./fixtures/generated-floor-seed-1.json', import.meta.url), 'utf8')) as GeneratedFloor['floor'];
  return {
    floor: { ...floor, floorId },
    report: {
      generatorVersion: 2, attempt: 0, fallback: false, roomCount: 8, corridorCount: 7,
      vaults: [], stairUp: floor.stairUp!, stairDown: floor.stairDown!, stairDistance: 42,
      traversableCellCount: 400, connected: true, rejectionCounts: { 'topology.empty': 1 },
    },
  };
}

function allocation(floorSeed: FloorSeedAllocation['floorSeed'] = [1, 2, 3, 4]): FloorSeedAllocation {
  return { floorSeed, nextGenerationState: [9, 8, 7, 6] };
}

describe('addGeneratedFloor', () => {
  it('appends a complete floor and advances only the generation stream', () => {
    const run = createDemoRun();
    const generated = generatedFloor();
    const result = addGeneratedFloor(run, generated, allocation());

    expect(result.floors.map((floor) => floor.floorId)).toEqual(['floor.demo', 'floor.generated-01']);
    expect(result.floors[1]).toEqual(generated.floor);
    expect(result.rng).toEqual({ ...run.rng, generation: [9, 8, 7, 6] });
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
      hero: { ...run.hero, floorId: generated.floor.floorId, ...stair },
    };
    const result = addGeneratedFloor(transitional, generated, allocation());
    const inserted = result.floors[1]!;
    const expected = refreshKnowledge({
      floor: generated.floor,
      hero: transitional.hero,
      actors: new Map([[transitional.hero.heroId, transitional.hero]]),
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
    expect(() => addGeneratedFloor(createDemoRun(), generatedFloor(), allocation(floorSeed))).toThrow(message);
  });

  it('rejects a zero next generation state', () => {
    expect(() => addGeneratedFloor(createDemoRun(), generatedFloor(), {
      floorSeed: [1, 2, 3, 4], nextGenerationState: [0, 0, 0, 0],
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
});
