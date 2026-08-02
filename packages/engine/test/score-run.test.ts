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

/** Two milestone tempering points spent on `vitality` -- `scoreRun` never reads `run.hero`, so
 * this is inert as far as scoring is concerned; the regression this guards is a future score line
 * accidentally keying off hero attributes instead of `run.metrics`/`run.conclusion`. */
function temperTwice(run: ActiveRun): ActiveRun {
  return {
    ...run,
    hero: {
      ...run.hero,
      tempering: {
        banked: 0,
        spent: { ...run.hero.tempering.spent, vitality: run.hero.tempering.spent.vitality + 2 },
      },
    },
  };
}

/** An enchanted weapon added to the hero's equipped set -- `scoreRun` never reads `run.items`
 * either, so this too must leave the breakdown untouched. */
function enchantSword(run: ActiveRun): ActiveRun {
  return {
    ...run,
    items: [
      ...run.items,
      {
        itemId: 'item.demo-enchanted-sword',
        contentId: 'item.demo-sword',
        quantity: 1,
        condition: 100,
        enchantment: { enchantmentId: 'enchantment.demo-keen', modifiers: { meleeAccuracy: 1 } },
        identified: true,
        charges: null,
        fuel: null,
        enabled: null,
        location: { type: 'equipped', actorId: run.hero.actorId, slot: 'main-hand' },
      },
    ],
  };
}

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

  // Task 12 (hero-power-curve) regression pin: tempering, enchanting, and spell power all reach
  // into hero/item state that predates this feature's own `run.metrics`/`run.conclusion` reads --
  // `scoreRun` must stay blind to every one of them.
  it('leaves the score model untouched by tempering, enchanting, and spell power', () => {
    const base = concludedRun(content);
    const tempered = enchantSword(temperTwice(base));
    expect(scoreRun({ run: tempered, content })).toEqual(scoreRun({ run: base, content }));
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
