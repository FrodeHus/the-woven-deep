import type { CompiledContentPack } from '@woven-deep/content';
import { balanceEntry } from './balance.js';
import type { DomainEvent } from './events-model.js';
import type { ActiveRun, HeroTemperingState, OpaqueId } from './model.js';

/**
 * Milestone tempering: the hero earns one point the first time the run reaches each authored
 * milestone depth. Every fact comes from `metrics.deepestDepth` and the hero's own earned history
 * -- zero randomness, no per-monster data, nothing to grind. Depth is the only currency.
 */

/** Points this run has already earned: banked plus every point already spent. Milestones are
 * idempotent against this total, which is what makes "first time reached" survive spending. */
function earnedPoints(tempering: HeroTemperingState): number {
  return (
    tempering.banked + Object.values(tempering.spent).reduce((total, spent) => total + spent, 0)
  );
}

/**
 * Banks one tempering point for every authored milestone depth the run has now reached but had not
 * before. Reaching several milestones in one transition (theoretical, but a teleport or a rewritten
 * depth curve could do it) banks several points, each with its own event.
 *
 * `previousDeepestDepth` is the pre-transition high-water mark the caller crossed from. It is
 * carried for the caller's benefit and for the log, NOT used to decide what is owed: the decision is
 * a subtraction against the earned total (see below), which is strictly more robust than diffing two
 * depths.
 */
export function grantTemperingMilestones(
  input: Readonly<{
    state: ActiveRun;
    content: CompiledContentPack;
    previousDeepestDepth: number;
    eventId: OpaqueId;
  }>,
): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  const { depths } = balanceEntry(input.content).tempering;
  const reachedNow = depths.filter((depth) => depth <= input.state.metrics.deepestDepth);
  const earned = earnedPoints(input.state.hero.tempering);
  // Milestones are ordered and cumulative, so "how many are owed" is a subtraction, not a diff of
  // two depth sets: it stays correct across a Wanderer rewind (which lowers `deepestDepth` AND
  // restores the earned total together, so re-crossing genuinely re-earns) and across a save
  // written by a build with a shorter milestone list.
  const owed = Math.max(0, reachedNow.length - earned);
  if (owed === 0) return { state: input.state, events: [] };
  const newly = reachedNow.slice(reachedNow.length - owed);
  const banked = input.state.hero.tempering.banked + owed;
  if (!Number.isSafeInteger(banked)) throw new RangeError('banked tempering overflowed');
  return {
    state: {
      ...input.state,
      hero: { ...input.state.hero, tempering: { ...input.state.hero.tempering, banked } },
    },
    events: newly.map((depth, index) => ({
      type: 'hero.tempering-banked' as const,
      eventId: `${input.eventId}.temper-${String(index)}`,
      depth,
      banked: input.state.hero.tempering.banked + index + 1,
    })),
  };
}
