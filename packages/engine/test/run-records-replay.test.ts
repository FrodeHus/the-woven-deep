import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  RUN_RECORDS_REPLAY_BOUNDARIES, createRunRecordsDemoRun, encodeActiveRun,
  runRecordsDemoEquivalent, runRunRecordsDemo, stableJson,
} from '../src/index.js';

let pack: CompiledContentPack;
beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
});

describe('run-records continuous-versus-split replay', () => {
  it.each(RUN_RECORDS_REPLAY_BOUNDARIES)('is byte-identical when reloading at %s', (boundary) => {
    const index = RUN_RECORDS_REPLAY_BOUNDARIES.indexOf(boundary);
    const continuous = runRunRecordsDemo(pack);
    const split = runRunRecordsDemo(pack, new Set([index]));

    // Byte-identical final saves after finalizeRun on both sides.
    expect(encodeActiveRun(split.state)).toBe(encodeActiveRun(continuous.state));
    // Identical records, authoritative events, public events, and projections.
    expect(stableJson(split.records.map((entry) => entry.commandResult)))
      .toBe(stableJson(continuous.records.map((entry) => entry.commandResult)));
    expect(stableJson(split.records.map((entry) => entry.authoritativeEvents)))
      .toBe(stableJson(continuous.records.map((entry) => entry.authoritativeEvents)));
    expect(stableJson(split.records.map((entry) => entry.publicEvents)))
      .toBe(stableJson(continuous.records.map((entry) => entry.publicEvents)));
    expect(stableJson(split.records.map((entry) => entry.projection)))
      .toBe(stableJson(continuous.records.map((entry) => entry.projection)));
    // Identical finalization record, deltas, and authoritative finalization events.
    expect(stableJson(split.finalization?.record)).toBe(stableJson(continuous.finalization?.record));
    expect(stableJson(split.finalization?.deltas)).toBe(stableJson(continuous.finalization?.deltas));
    expect(stableJson(split.finalization?.events)).toBe(stableJson(continuous.finalization?.events));
  });

  it('is equivalent when every named boundary reloads', () => {
    const continuous = runRunRecordsDemo(pack);
    const split = runRunRecordsDemo(pack, new Set(RUN_RECORDS_REPLAY_BOUNDARIES.map((_, index) => index)));
    expect(runRecordsDemoEquivalent(split, continuous)).toBe(true);
  });

  it('drives the full milestone scenario through production command resolution', () => {
    const result = runRunRecordsDemo(pack);
    const types = new Set(result.records.flatMap((record) =>
      record.authoritativeEvents.map((event) => event.type)));
    for (const type of [
      'group.leader-defeated', 'swarm.source-destroyed', 'boss.phase-changed',
      'trade.opened', 'merchant.provoked', 'run.concluded',
    ]) expect([...types], `expected ${type}`).toContain(type);

    // Every command boundary applied; the run concluded with a credited killer.
    for (const record of result.records) {
      expect(record.commandResult.status, record.boundary).toBe('applied');
    }
    const conclusion = result.records.find((record) => record.boundary === 'before-death')!;
    const concluded = conclusion.authoritativeEvents.find((event) => event.type === 'run.concluded');
    expect(concluded).toMatchObject({ completionType: 'died' });

    // Finalized exactly once into a deterministic record whose ID matches the recorded conclusion.
    expect(result.finalization).not.toBeNull();
    expect(result.finalization!.record.completionType).toBe('died');
    expect(result.finalization!.record.cause.killerContentId).not.toBeNull();
    expect(result.finalization!.record.heirloom.sourceItemId).toBe('item.run-records-demo.sword');
    expect(result.state.conclusion?.finalized).toBe(true);
    const finalizedEvents = result.finalization!.events.filter((event) => event.type === 'run.finalized');
    expect(finalizedEvents).toHaveLength(1);
  });

  it('records the home-floor entry at creation and each floor crossing thereafter', () => {
    const initial = createRunRecordsDemoRun(pack);
    expect(initial.metrics.floorsEntered).toBe(1);
    expect(initial.metrics.deepestDepth).toBe(4);
    const result = runRunRecordsDemo(pack);
    // before-boss enters the boss floor (depth 5); before-trade returns to the home floor (depth 4).
    expect(result.state.metrics.floorsEntered).toBe(3);
    expect(result.state.metrics.deepestDepth).toBe(5);
  });

  it('never exposes hidden state in any projection or finalization record', () => {
    const result = runRunRecordsDemo(pack);
    const projectionsJson = stableJson(result.records.map((record) => record.projection));
    const recordJson = stableJson(result.finalization?.record);
    for (const field of ['fallenHeroDecisions', 'encounterDecisions', 'concludedAtRevision', 'run-records']) {
      expect(projectionsJson, `projection leaked ${field}`).not.toContain(`"${field}"`);
      expect(recordJson, `record leaked ${field}`).not.toContain(`"${field}"`);
    }
  });
});
