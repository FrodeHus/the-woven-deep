import { describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import {
  compareHallRecords,
  createDemoContentPack,
  createDemoRun,
  scoreRun,
  type ActiveRun,
  type HallRecordOrdering,
  type ScoreBreakdown,
} from '../src/index.js';

function withMetrics(run: ActiveRun, metrics: Partial<ActiveRun['metrics']>): ActiveRun {
  return { ...run, metrics: { ...run.metrics, ...metrics } };
}

function withConclusion(run: ActiveRun, conclusion: ActiveRun['conclusion']): ActiveRun {
  return { ...run, conclusion };
}

function concludedRun(_content: CompiledContentPack): ActiveRun {
  const base = createDemoRun();
  const withMetricsSet = withMetrics(base, {
    deepestDepth: 4,
    bossKills: 1,
    threatDefeated: 17,
    discoveriesRevealed: 2,
    turnsElapsed: 8_600,
  });
  return withConclusion(withMetricsSet, {
    completionType: 'died',
    cause: { killerContentId: null, depth: 4, turn: 1, worldTime: 1 },
    concludedAtRevision: 1,
    finalized: false,
  });
}

function breakdownWith(total: number, tail: Partial<Record<string, number>> = {}): ScoreBreakdown {
  return { lines: [], total, ...(tail as object) } as ScoreBreakdown;
}

describe('scoreRun', () => {
  const content = createDemoContentPack();

  it('produces the exact itemized breakdown and total', () => {
    const run = concludedRun(content);
    const breakdown = scoreRun({ run, content });

    expect(breakdown.lines).toEqual([
      { lineId: 'depth', quantity: 4, coefficient: 100, amount: 400 },
      { lineId: 'boss-defeats', quantity: 1, coefficient: 250, amount: 250 },
      { lineId: 'threat', quantity: 17, coefficient: 5, amount: 85 },
      { lineId: 'discoveries', quantity: 2, coefficient: 25, amount: 50 },
      { lineId: 'completion-bonus', quantity: 1, coefficient: 0, amount: 0 },
      { lineId: 'turn-efficiency', quantity: 43, coefficient: 1, amount: 457 },
    ]);
    expect(breakdown.total).toBe(1242);
  });

  it('throws for an unconcluded run', () => {
    const run = createDemoRun();
    expect(() => scoreRun({ run, content })).toThrow();
  });

  it('clamps the turn-efficiency bonus to zero when grinding exceeds the budget', () => {
    const run = withMetrics(concludedRun(content), { turnsElapsed: 999_999 });
    const breakdown = scoreRun({ run, content });
    const line = breakdown.lines.find((candidate) => candidate.lineId === 'turn-efficiency')!;
    expect(line.amount).toBe(0);
  });

  it('never exceeds the turn-efficiency budget when rushing (turnsElapsed = 0)', () => {
    const run = withMetrics(concludedRun(content), { turnsElapsed: 0 });
    const breakdown = scoreRun({ run, content });
    const line = breakdown.lines.find((candidate) => candidate.lineId === 'turn-efficiency')!;
    expect(line.quantity).toBe(0);
    expect(line.amount).toBe(500);
  });

  it('produces zero-amount lines when a coefficient is zero', () => {
    const run = withConclusion(concludedRun(content), {
      completionType: 'died',
      cause: { killerContentId: null, depth: 4, turn: 1, worldTime: 1 },
      concludedAtRevision: 1,
      finalized: false,
    });
    const breakdown = scoreRun({ run, content });
    const completionLine = breakdown.lines.find(
      (candidate) => candidate.lineId === 'completion-bonus',
    )!;
    expect(completionLine.amount).toBe(0);
  });

  it('throws before producing any line when a product would overflow safe integer arithmetic', () => {
    const run = withMetrics(concludedRun(content), { deepestDepth: Number.MAX_SAFE_INTEGER });
    expect(() => scoreRun({ run, content })).toThrow();
  });

  it('sums every line into a checked total', () => {
    const run = concludedRun(content);
    const breakdown = scoreRun({ run, content });
    const expectedTotal = breakdown.lines.reduce((sum, line) => sum + line.amount, 0);
    expect(breakdown.total).toBe(expectedTotal);
  });

  it('never produces a negative line or total', () => {
    const run = concludedRun(content);
    const breakdown = scoreRun({ run, content });
    for (const line of breakdown.lines) {
      expect(line.quantity).toBeGreaterThanOrEqual(0);
      expect(line.amount).toBeGreaterThanOrEqual(0);
    }
    expect(breakdown.total).toBeGreaterThanOrEqual(0);
  });
});

describe('compareHallRecords', () => {
  function record(
    recordId: string,
    completionType: HallRecordOrdering['completionType'],
    total: number,
  ): HallRecordOrdering {
    return { recordId, completionType, score: breakdownWith(total) };
  }

  it('ranks tier dominance over any score difference', () => {
    const died = record('a', 'died', 100_000);
    const refused = record('b', 'refused', 1);
    expect(compareHallRecords(died, refused)).toBeGreaterThan(0);
  });

  it('orders all four tiers correctly: broke-cycle > became-heart > refused > died', () => {
    const brokeCycle = record('a', 'broke-cycle', 0);
    const becameHeart = record('b', 'became-heart', 0);
    const refused = record('c', 'refused', 0);
    const died = record('d', 'died', 0);
    const ordered = [died, refused, becameHeart, brokeCycle];
    const sorted = [...ordered].sort(compareHallRecords);
    expect(sorted.map((entry) => entry.recordId)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('orders by score descending within the same tier', () => {
    const low = record('a', 'died', 10);
    const high = record('b', 'died', 20);
    expect(compareHallRecords(high, low)).toBeLessThan(0);
    expect(compareHallRecords(low, high)).toBeGreaterThan(0);
  });

  it('breaks ties by ascending record id (code units)', () => {
    const first = record('alpha', 'died', 50);
    const second = record('beta', 'died', 50);
    expect(compareHallRecords(first, second)).toBeLessThan(0);
    expect(compareHallRecords(second, first)).toBeGreaterThan(0);
  });

  it('returns 0 for identical records', () => {
    const one = record('same', 'died', 50);
    const other = record('same', 'died', 50);
    expect(compareHallRecords(one, other)).toBe(0);
  });
});
