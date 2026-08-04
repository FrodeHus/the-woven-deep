import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileContentDirectory } from '../src/compiler/index.js';
import type { BalanceContentEntry, ContentEntry } from '../src/model.js';

/**
 * Out-of-danger recovery is authored in world-time units, but the scheduler advances the clock by
 * `ceil(normalActionCost / speed)` per action -- so a hero at baseline speed (`readinessThreshold`)
 * burns exactly one world-time unit per turn. That makes `recoveryInterval` a turn count for the
 * baseline hero, and these bounds pin the cadence a player actually feels while walking a floor.
 */
const MAXIMUM_TURNS_PER_TICK = 100;
const SAMPLE_TURNS = 100;

async function loadBalance(): Promise<BalanceContentEntry> {
  const pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
  const entry = (pack.entries as readonly ContentEntry[]).find(
    (candidate): candidate is BalanceContentEntry => candidate.kind === 'balance',
  );
  if (entry === undefined) throw new Error('content pack has no balance entry');
  return entry;
}

/** World-time units a baseline-speed hero spends on one ordinary action. */
function worldTimePerTurn(balance: BalanceContentEntry): number {
  return Math.ceil(balance.normalActionCost / balance.readinessThreshold);
}

describe('out-of-danger recovery cadence', () => {
  it('ticks health and Weave at least once within a walkable number of turns', async () => {
    const balance = await loadBalance();
    const turnsPerTick = balance.recoveryInterval * worldTimePerTurn(balance);
    expect(turnsPerTick).toBeLessThanOrEqual(MAXIMUM_TURNS_PER_TICK);
  });

  it('restores health and Weave a sated hero can notice over a hundred turns', async () => {
    const balance = await loadBalance();
    const ticks = Math.floor(SAMPLE_TURNS / (balance.recoveryInterval * worldTimePerTurn(balance)));
    const health =
      ticks * Math.floor((balance.recoveryAmount * balance.recoveryByHungerStage.sated) / 100);
    const weave = ticks * balance.weaveRegenAmount;
    expect(health).toBeGreaterThanOrEqual(2);
    expect(weave).toBeGreaterThanOrEqual(2);
  });

  it('still restores a hungry hero at least one health per tick', async () => {
    const balance = await loadBalance();
    const perTick = Math.floor(
      (balance.recoveryAmount * balance.recoveryByHungerStage.hungry) / 100,
    );
    expect(perTick).toBeGreaterThanOrEqual(1);
  });
});
