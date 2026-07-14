import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  POPULATION_REPLAY_BOUNDARIES, encodeActiveRun, populationDemoEquivalent, runPopulationDemo, stableJson,
} from '../src/index.js';

let pack: CompiledContentPack;
beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
});

describe('population continuous-versus-split replay', () => {
  it.each(POPULATION_REPLAY_BOUNDARIES)('is byte-identical at %s', (boundary) => {
    const index = POPULATION_REPLAY_BOUNDARIES.indexOf(boundary);
    const continuous = runPopulationDemo(pack);
    const split = runPopulationDemo(pack, new Set([index]));
    expect(encodeActiveRun(split.state)).toBe(encodeActiveRun(continuous.state));
    expect(stableJson(split.records.map((record) => record.commandResult)))
      .toBe(stableJson(continuous.records.map((record) => record.commandResult)));
    expect(stableJson(split.records.map((record) => record.authoritativeEvents)))
      .toBe(stableJson(continuous.records.map((record) => record.authoritativeEvents)));
    expect(stableJson(split.records.map((record) => record.publicEvents)))
      .toBe(stableJson(continuous.records.map((record) => record.publicEvents)));
    expect(stableJson(split.records.map((record) => record.projection)))
      .toBe(stableJson(continuous.records.map((record) => record.projection)));
  });

  it('is equivalent when every named boundary reloads', () => {
    const continuous = runPopulationDemo(pack);
    const split = runPopulationDemo(pack, new Set(POPULATION_REPLAY_BOUNDARIES.map((_, index) => index)));
    expect(populationDemoEquivalent(split, continuous)).toBe(true);
  });
});
