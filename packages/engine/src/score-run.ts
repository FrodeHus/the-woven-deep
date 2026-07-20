import type { BalanceContentEntry, CompiledContentPack, CompletionType } from '@woven-deep/content';
import type { ActiveRun, OpaqueId } from './model.js';
import { compareCodeUnits } from './stable-json.js';

export type ScoreLineId =
  'depth' | 'boss-defeats' | 'threat' | 'discoveries' | 'completion-bonus' | 'turn-efficiency';

export interface ScoreLine {
  readonly lineId: ScoreLineId;
  readonly quantity: number;
  readonly coefficient: number;
  readonly amount: number;
}

export interface ScoreBreakdown {
  readonly lines: readonly ScoreLine[];
  readonly total: number;
}

export interface HallRecordOrdering {
  readonly recordId: OpaqueId;
  readonly completionType: CompletionType;
  readonly score: ScoreBreakdown;
}

function checkedProduct(left: number, right: number, label: string): number {
  const product = left * right;
  if (!Number.isSafeInteger(product)) {
    throw new RangeError(`${label} exceeds safe integer arithmetic`);
  }
  return product;
}

function checkedSum(values: readonly number[], label: string): number {
  return values.reduce((sum, value) => {
    const next = sum + value;
    if (!Number.isSafeInteger(next)) {
      throw new RangeError(`${label} exceeds safe integer arithmetic`);
    }
    return next;
  }, 0);
}

function checkedSubtract(left: number, right: number, label: string): number {
  const difference = left - right;
  if (!Number.isSafeInteger(difference)) {
    throw new RangeError(`${label} exceeds safe integer arithmetic`);
  }
  return difference;
}

/** Exact floor quotient via quotient/remainder; never routes through fractional floats. */
function floorQuotient(numerator: number, divisor: number): number {
  const remainder = numerator % divisor;
  return (numerator - remainder) / divisor;
}

function multipliedLine(lineId: ScoreLineId, quantity: number, coefficient: number): ScoreLine {
  return { lineId, quantity, coefficient, amount: checkedProduct(quantity, coefficient, lineId) };
}

/**
 * Itemizes a concluded run's score from its metrics and the content pack's balance coefficients.
 * Every line's amount is a checked product (or checked, zero-clamped subtraction for turn
 * efficiency); the total is a checked sum of every line's amount. No floating-point path exists:
 * turn efficiency divides via floor quotient/remainder, matching the commerce style. Consumers
 * never recompute — the breakdown carries every line plus the total.
 */
export function scoreRun(
  input: Readonly<{
    run: ActiveRun;
    content: CompiledContentPack;
  }>,
): ScoreBreakdown {
  const { run, content } = input;
  const conclusion = run.conclusion;
  if (conclusion === null) {
    throw new Error('scoreRun requires a concluded run');
  }

  const balance = content.entries.find(
    (entry): entry is BalanceContentEntry => entry.kind === 'balance',
  );
  if (!balance) {
    throw new Error('internal invariant: content pack is missing a balance entry');
  }
  const coefficients = balance.score;
  const metrics = run.metrics;

  const depthLine = multipliedLine('depth', metrics.deepestDepth, coefficients.depthCoefficient);
  const bossLine = multipliedLine(
    'boss-defeats',
    metrics.bossKills,
    coefficients.bossDefeatCoefficient,
  );
  const threatLine = multipliedLine(
    'threat',
    metrics.threatDefeated,
    coefficients.threatCoefficient,
  );
  const discoveriesLine = multipliedLine(
    'discoveries',
    metrics.discoveriesRevealed,
    coefficients.discoveryCoefficient,
  );
  const completionLine: ScoreLine = {
    lineId: 'completion-bonus',
    quantity: 1,
    coefficient: 0,
    amount: coefficients.completionBonus[conclusion.completionType],
  };
  const turnDecayIntervals = floorQuotient(
    metrics.turnsElapsed,
    coefficients.turnEfficiencyDecayInterval,
  );
  const turnEfficiencyLine: ScoreLine = {
    lineId: 'turn-efficiency',
    quantity: turnDecayIntervals,
    coefficient: 1,
    amount: Math.max(
      0,
      checkedSubtract(coefficients.turnEfficiencyBudget, turnDecayIntervals, 'turn-efficiency'),
    ),
  };

  const lines: readonly ScoreLine[] = [
    depthLine,
    bossLine,
    threatLine,
    discoveriesLine,
    completionLine,
    turnEfficiencyLine,
  ];
  const total = checkedSum(
    lines.map((line) => line.amount),
    'score total',
  );

  return { lines, total };
}

const HALL_TIER_RANK: Readonly<Record<CompletionType, number>> = {
  'broke-cycle': 3,
  'became-heart': 2,
  refused: 1,
  died: 0,
};

/**
 * Total order for the Hall of the Fallen: completion tier dominates any score difference
 * (`broke-cycle` > `became-heart` > `refused` > `died`), then score descending, then record ID
 * ascending by code units as the final tiebreak so the ordering is never ambiguous.
 */
export function compareHallRecords(left: HallRecordOrdering, right: HallRecordOrdering): number {
  const tierDifference = HALL_TIER_RANK[right.completionType] - HALL_TIER_RANK[left.completionType];
  if (tierDifference !== 0) return tierDifference;

  const scoreDifference = right.score.total - left.score.total;
  if (scoreDifference !== 0) return scoreDifference;

  return compareCodeUnits(left.recordId, right.recordId);
}
