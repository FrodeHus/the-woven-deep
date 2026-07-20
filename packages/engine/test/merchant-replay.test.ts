import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  MERCHANT_REPLAY_BOUNDARIES,
  createMerchantDemoRun,
  decodeActiveRun,
  encodeActiveRun,
  merchantDemoCommands,
  merchantDemoEquivalent,
  resolveCommand,
  resolveMerchantDemoCommand,
  runMerchantDemo,
  stableJson,
  type MerchantDemoInput,
  type MerchantPopulation,
} from '../src/index.js';

let pack: CompiledContentPack;
beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

describe('merchant continuous-versus-split replay', () => {
  it.each(MERCHANT_REPLAY_BOUNDARIES)('is byte-identical at %s', (boundary) => {
    const index = MERCHANT_REPLAY_BOUNDARIES.indexOf(boundary);
    const continuous = runMerchantDemo(pack);
    const split = runMerchantDemo(pack, new Set([index]));
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
    const continuous = runMerchantDemo(pack);
    const split = runMerchantDemo(
      pack,
      new Set(MERCHANT_REPLAY_BOUNDARIES.map((_, index) => index)),
    );
    expect(merchantDemoEquivalent(split, continuous)).toBe(true);
  });

  it('replays serialized inputs through production command resolution', () => {
    const initial = createMerchantDemoRun(pack);
    const serialized = JSON.stringify(merchantDemoCommands(initial));
    const inputs = JSON.parse(serialized) as MerchantDemoInput[];
    let state = decodeActiveRun(encodeActiveRun(initial));
    for (const input of inputs) state = resolveMerchantDemoCommand(state, input, pack).state;
    const expected = runMerchantDemo(pack, new Set());
    expect(encodeActiveRun(state)).toBe(encodeActiveRun(expected.state));
    expect(stableJson(state.recentCommands)).toBe(stableJson(expected.state.recentCommands));
  });

  it('covers every merchant transition the milestone requires', () => {
    const result = runMerchantDemo(pack);
    const types = new Set(
      result.records.flatMap((record) => record.authoritativeEvents.map((event) => event.type)),
    );
    for (const type of [
      'trade.opened',
      'trade.bought',
      'trade.sold',
      'trade.service-purchased',
      'trade.closed',
      'reputation.changed',
      'merchant.departure-warning',
      'merchant.provoked',
      'merchant.stock-dropped',
      'merchant.died',
      'merchant.departed',
    ])
      expect([...types], `expected ${type}`).toContain(type);

    const merchants = result.state.populations.filter(
      (population): population is MerchantPopulation => population.model === 'merchant',
    );
    expect(merchants).toHaveLength(2);
    expect(new Set(merchants.map((merchant) => merchant.factionId)).size).toBe(1);
    expect(merchants.map((merchant) => merchant.lifecycle).sort()).toEqual(['dead', 'departed']);

    const refusal = result.records.find((record) => record.boundary === 'before-refusal')!;
    expect(refusal.commandResult).toMatchObject({ status: 'invalid', reason: 'merchant.refuses' });
    expect(refusal.authoritativeEvents).toEqual([
      {
        type: 'action.invalid',
        eventId: refusal.command.commandId,
        commandId: refusal.command.commandId,
        reason: 'merchant.refuses',
      },
    ]);

    const provoke = result.records.find((record) => record.boundary === 'before-provoke')!;
    const provoked = provoke.authoritativeEvents.find(
      (event) => event.type === 'merchant.provoked',
    );
    expect(provoked).toMatchObject({ response: 'flee' });
    const dropped = provoke.authoritativeEvents.find(
      (event) => event.type === 'merchant.stock-dropped',
    );
    expect(dropped).toBeDefined();

    const departure = result.records.find((record) => record.boundary === 'before-departure')!;
    const departed = departure.authoritativeEvents.find(
      (event) => event.type === 'merchant.departed',
    );
    expect(departed).toBeDefined();
    const departedMerchant = merchants.find((merchant) => merchant.lifecycle === 'departed')!;
    // The departure resolved while its floor was inactive: no actor turn for the merchant.
    expect(departedMerchant.floorId).not.toBe(result.state.activeFloorId);
    expect(
      departure.authoritativeEvents.some(
        (event) =>
          event.type === 'actor.turn.completed' && event.actorId === departedMerchant.actorId,
      ),
    ).toBe(false);
  });

  it('advances no world time from any modal trade command', () => {
    const initial = createMerchantDemoRun(pack);
    const tradeBoundaries = [
      'before-open',
      'before-buy',
      'before-sell',
      'before-identify',
      'before-close',
      'before-refusal',
    ];
    let state = initial;
    for (const input of merchantDemoCommands(initial)) {
      const before = state.worldTime;
      state = resolveMerchantDemoCommand(state, input, pack).state;
      if (tradeBoundaries.includes(input.boundary)) {
        expect(state.worldTime, input.boundary).toBe(before);
      }
    }
  });

  it('deduplicates a persisted trade command after save and reload', () => {
    const result = runMerchantDemo(pack);
    const reloaded = decodeActiveRun(encodeActiveRun(result.state));
    const record = result.records[1]!;
    const duplicate = resolveCommand(reloaded, record.command, { content: pack });
    expect(encodeActiveRun(duplicate.state)).toBe(encodeActiveRun(reloaded));
    expect(duplicate.result).toEqual(record.commandResult);
    expect(duplicate.events).toEqual(record.publicEvents);
  });

  it('records the home-floor entry at creation and every away/home crossing thereafter', () => {
    const initial = createMerchantDemoRun(pack);
    expect(initial.metrics.floorsEntered).toBe(1);
    expect(initial.metrics.deepestDepth).toBe(2);
    const result = runMerchantDemo(pack);
    // before-refusal moves the hero to the away floor (depth 3), before-return moves back home (depth 2).
    expect(result.state.metrics.floorsEntered).toBe(3);
    expect(result.state.metrics.deepestDepth).toBe(3);
  });
});
