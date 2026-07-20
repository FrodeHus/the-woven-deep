import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  POPULATION_REPLAY_BOUNDARIES,
  createPopulationDemoRun,
  decodeActiveRun,
  encodeActiveRun,
  populationDemoCommands,
  populationDemoEquivalent,
  populationDemoScenario,
  resolveCommand,
  resolvePopulationDemoCommand,
  runPopulationDemo,
  stableJson,
  type PopulationDemoInput,
} from '../src/index.js';

let pack: CompiledContentPack;
beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

describe('population continuous-versus-split replay', () => {
  it.each(POPULATION_REPLAY_BOUNDARIES)('is byte-identical at %s', (boundary) => {
    const index = POPULATION_REPLAY_BOUNDARIES.indexOf(boundary);
    const continuous = runPopulationDemo(pack);
    const split = runPopulationDemo(pack, new Set([index]));
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
    const continuous = runPopulationDemo(pack);
    const split = runPopulationDemo(
      pack,
      new Set(POPULATION_REPLAY_BOUNDARIES.map((_, index) => index)),
    );
    expect(populationDemoEquivalent(split, continuous)).toBe(true);
  });

  it('replays serialized fixture inputs through production command resolution', () => {
    const scenario = populationDemoScenario(73);
    const initial = createPopulationDemoRun(pack, scenario.seed);
    const serialized = JSON.stringify(populationDemoCommands(initial, scenario));
    const inputs = JSON.parse(serialized) as PopulationDemoInput[];
    let state = decodeActiveRun(encodeActiveRun(initial));
    for (const input of inputs) state = resolvePopulationDemoCommand(state, input, pack).state;
    const expected = runPopulationDemo(pack, new Set(), scenario);
    expect(encodeActiveRun(state)).toBe(encodeActiveRun(expected.state));
    expect(stableJson(state.recentCommands)).toBe(stableJson(expected.state.recentCommands));
  });

  it('persists varied production commands and their authoritative/public artifacts', () => {
    const result = runPopulationDemo(pack);
    expect(new Set(result.records.map((record) => record.command.type))).toEqual(
      new Set(['wait', 'attack']),
    );
    const attackRecords = result.records.filter((record) => record.command.type === 'attack');
    expect(attackRecords).toHaveLength(5);
    expect(
      attackRecords.every((record) =>
        record.authoritativeEvents.some(
          (event) => event.type === 'actor.died' && event.actorId === record.command.targetActorId,
        ),
      ),
    ).toBe(true);
    expect(result.state.recentCommands).toHaveLength(POPULATION_REPLAY_BOUNDARIES.length);
    expect(stableJson(result.state.recentCommands.map((record) => record.command))).toBe(
      stableJson(result.records.map((record) => record.command)),
    );
    expect(stableJson(result.state.recentCommands.map((record) => record.events))).toBe(
      stableJson(result.records.map((record) => record.authoritativeEvents)),
    );
    expect(stableJson(result.state.recentCommands.map((record) => record.publicEvents))).toBe(
      stableJson(result.records.map((record) => record.publicEvents)),
    );
  });

  it('deduplicates a persisted command after save and reload', () => {
    const result = runPopulationDemo(pack);
    const reloaded = decodeActiveRun(encodeActiveRun(result.state));
    const record = result.records[2]!;
    const duplicate = resolveCommand(reloaded, record.command, { content: pack });
    expect(encodeActiveRun(duplicate.state)).toBe(encodeActiveRun(reloaded));
    expect(duplicate.result).toEqual(record.commandResult);
    expect(duplicate.events).toEqual(record.publicEvents);
  });

  it('rejects stale new command ids without changing persisted history', () => {
    const result = runPopulationDemo(pack);
    const stale = resolveCommand(
      result.state,
      {
        type: 'wait',
        commandId: 'command.population-demo-stale',
        expectedRevision: result.initial.revision,
      },
      { content: pack },
    );
    expect(stale.result).toMatchObject({ status: 'rejected', reason: 'stale_revision' });
    expect(encodeActiveRun(stale.state)).toBe(encodeActiveRun(result.state));
  });

  it('records the starting floor entry at creation and the boss re-entry crossing', () => {
    const initial = createPopulationDemoRun(pack);
    expect(initial.metrics.floorsEntered).toBe(1);
    expect(initial.metrics.deepestDepth).toBe(4);
    const result = runPopulationDemo(pack);
    // before-boss-re-entry moves the hero onto the deeper boss arena floor (depth 5).
    expect(result.state.metrics.floorsEntered).toBe(2);
    expect(result.state.metrics.deepestDepth).toBe(5);
  });
});
