import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  POPULATION_REPLAY_BOUNDARIES, encodeActiveRun, runPopulationDemo, stableJson,
  validatePopulationInvariants,
} from '../src/index.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
});

describe('population encounter seeded invariants', () => {
  it('holds after every transition in 512 seeded split schedules', () => {
    for (let seed = 0; seed < 512; seed += 1) {
      const reloads = new Set<number>();
      for (let boundary = 0; boundary < POPULATION_REPLAY_BOUNDARIES.length; boundary += 1) {
        if ((seed & (1 << boundary)) !== 0) reloads.add(boundary);
      }
      const result = runPopulationDemo(pack, reloads);
      validatePopulationInvariants(result.state, pack);
      expect(result.records, `seed ${seed}`).toHaveLength(POPULATION_REPLAY_BOUNDARIES.length);
      expect(() => JSON.parse(encodeActiveRun(result.state)), `seed ${seed}`).not.toThrow();
      expect(stableJson(result.records), `seed ${seed}`).not.toMatch(
        /lastKnownTargets|sharedKnowledge|goal\":|rng\":|gateRoll|sourceContentHash/,
      );
    }
  }, 120_000);

  it('regression: inactive floors do not accumulate missed swarm births', () => {
    const result = runPopulationDemo(pack);
    const swarm = result.state.populations.find((population) => population.model === 'swarm')!;
    expect(swarm.spawnedCount).toBeGreaterThan(0);
    expect(swarm.spawnedCount).toBeLessThanOrEqual(8);
  });

  it('regression: terminal rewards are singletons with no Echo heirloom', () => {
    const result = runPopulationDemo(pack);
    const champion = result.state.populations.find((population) => population.model === 'champion')!;
    const echo = result.state.populations.find((population) => population.model === 'echo')!;
    expect(champion).toMatchObject({ defeated: true, rewardCreated: true });
    expect(echo).toMatchObject({ defeated: true, lootCreated: true });
    expect(result.state.items.filter((item) => item.heirloom !== undefined)).toHaveLength(1);
    expect(result.state.items.filter((item) => item.itemId.includes(echo.populationId)))
      .not.toContainEqual(expect.objectContaining({ heirloom: expect.anything() }));
  });
});
