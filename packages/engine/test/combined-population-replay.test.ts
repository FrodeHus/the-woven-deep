import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  COMBINED_POPULATION_REPLAY_BOUNDARIES,
  combinedPopulationDemoCommands,
  combinedPopulationDemoEquivalent,
  createCombinedPopulationDemoRun,
  decodeActiveRun,
  encodeActiveRun,
  populationDemoScenario,
  resolveCombinedPopulationDemoCommand,
  resolveCommand,
  runCombinedPopulationDemo,
  stableJson,
  type CombinedDemoInput,
  type MerchantPopulation,
} from '../src/index.js';

let pack: CompiledContentPack;
beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

describe('combined population (boss+swarm+group+champion+merchant) replay', () => {
  it.each(COMBINED_POPULATION_REPLAY_BOUNDARIES)('is byte-identical at %s', (boundary) => {
    const index = COMBINED_POPULATION_REPLAY_BOUNDARIES.indexOf(boundary);
    const continuous = runCombinedPopulationDemo(pack);
    const split = runCombinedPopulationDemo(pack, new Set([index]));
    expect(encodeActiveRun(split.state)).toBe(encodeActiveRun(continuous.state));
    expect(stableJson(split.records.map((record) => record.commandResult))).toBe(
      stableJson(continuous.records.map((record) => record.commandResult)),
    );
    expect(stableJson(split.records.map((record) => record.authoritativeEvents))).toBe(
      stableJson(continuous.records.map((record) => record.authoritativeEvents)),
    );
    expect(stableJson(split.records.map((record) => record.publicEvents))).toBe(
      stableJson(continuous.records.map((record) => record.publicEvents)),
    );
    expect(stableJson(split.records.map((record) => record.projection))).toBe(
      stableJson(continuous.records.map((record) => record.projection)),
    );
  });

  it('is equivalent when every named boundary reloads', () => {
    const continuous = runCombinedPopulationDemo(pack);
    const split = runCombinedPopulationDemo(
      pack,
      new Set(COMBINED_POPULATION_REPLAY_BOUNDARIES.map((_, index) => index)),
    );
    expect(combinedPopulationDemoEquivalent(split, continuous)).toBe(true);
  });

  it('replays serialized fixture inputs through production command resolution', () => {
    const scenario = populationDemoScenario(41);
    const initial = createCombinedPopulationDemoRun(pack, scenario.seed);
    const serialized = JSON.stringify(combinedPopulationDemoCommands(initial, scenario));
    const inputs = JSON.parse(serialized) as readonly CombinedDemoInput[];
    let state = decodeActiveRun(encodeActiveRun(initial));
    for (const input of inputs)
      state = resolveCombinedPopulationDemoCommand(state, input, pack).state;
    const expected = runCombinedPopulationDemo(pack, new Set(), scenario);
    expect(encodeActiveRun(state)).toBe(encodeActiveRun(expected.state));
    expect(stableJson(state.recentCommands)).toBe(stableJson(expected.state.recentCommands));
  });

  it('drives a boss, swarm, group, champion (fallen hero echo/champion) and merchant in one run', () => {
    const result = runCombinedPopulationDemo(pack);
    const models = new Set(result.initial.populations.map((population) => population.model));
    expect(models).toEqual(new Set(['group', 'swarm', 'boss', 'champion', 'echo', 'merchant']));

    const merchant = result.initial.populations.find(
      (population): population is MerchantPopulation => population.model === 'merchant',
    )!;
    expect(
      result.records.some(
        (record) =>
          record.boundary === 'before-trade-open' &&
          record.authoritativeEvents.some((event) => event.type === 'trade.opened'),
      ),
    ).toBe(true);
    expect(
      result.records.some(
        (record) =>
          record.boundary === 'before-trade-buy' &&
          record.authoritativeEvents.some((event) => event.type === 'trade.bought'),
      ),
    ).toBe(true);
    expect(
      result.records.some(
        (record) =>
          record.boundary === 'before-trade-close' &&
          record.authoritativeEvents.some((event) => event.type === 'trade.closed'),
      ),
    ).toBe(true);
    const finalMerchant = result.state.populations.find(
      (population): population is MerchantPopulation =>
        population.populationId === merchant.populationId,
    )!;
    expect(finalMerchant.lifecycle).toBe('available');

    const attackRecords = result.records.filter((record) => record.command.type === 'attack');
    expect(
      attackRecords.every((record) =>
        record.authoritativeEvents.some(
          (event) => event.type === 'actor.died' && event.actorId === record.command.targetActorId,
        ),
      ),
    ).toBe(true);
    expect(result.state.recentCommands).toHaveLength(COMBINED_POPULATION_REPLAY_BOUNDARIES.length);
  });

  it('deduplicates a persisted command after save and reload', () => {
    const result = runCombinedPopulationDemo(pack);
    const reloaded = decodeActiveRun(encodeActiveRun(result.state));
    const record = result.records[1]!;
    const duplicate = resolveCommand(reloaded, record.command, { content: pack });
    expect(encodeActiveRun(duplicate.state)).toBe(encodeActiveRun(reloaded));
    expect(duplicate.result).toEqual(record.commandResult);
    expect(duplicate.events).toEqual(record.publicEvents);
  });
});
