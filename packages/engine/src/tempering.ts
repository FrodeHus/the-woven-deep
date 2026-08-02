import type { CompiledContentPack } from '@woven-deep/content';
import { heroActor, withActor, type AttributeName } from './actor-model.js';
import { balanceEntry } from './balance.js';
import { synchronizeDerivedMaxima } from './derived-maxima.js';
import type { DomainEvent } from './events-model.js';
import type { ActiveRun, HeroTemperingState, InvalidActionReason, OpaqueId } from './model.js';
import { deriveRunActorStats } from './stats.js';

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

/**
 * `value * newMax / oldMax`, floored, with a living floor of `floor`. Quotient division on safe
 * integers -- never a float that survives the expression.
 */
function rescale(value: number, oldMax: number, newMax: number, floor: number): number {
  if (![value, oldMax, newMax].every(Number.isSafeInteger)) {
    throw new RangeError('rescale operands must be safe integers');
  }
  if (oldMax <= 0) return Math.min(Math.max(floor, value), newMax);
  const numerator = value * newMax;
  if (!Number.isSafeInteger(numerator)) throw new RangeError('rescale overflowed');
  return Math.min(newMax, Math.max(floor, Math.trunc(numerator / oldMax)));
}

export type TemperValidation =
  Readonly<{ ok: true }> | Readonly<{ ok: false; reason: InvalidActionReason }>;

/**
 * Whether one banked point may be spent on `attribute` right now. Two ways to say no, and the
 * second is not an error state: with every attribute at the authored `attributeMaximum`, every
 * choice answers `temper.capped` and the points simply bank forever. Nothing is refunded or lost.
 */
export function validateTemperCommand(
  input: Readonly<{
    state: ActiveRun;
    content: CompiledContentPack;
    attribute: AttributeName;
  }>,
): TemperValidation {
  if (input.state.hero.tempering.banked <= 0) {
    return { ok: false, reason: 'temper.unavailable' };
  }
  const maximum = balanceEntry(input.content).attributeMaximum;
  if (heroActor(input.state).attributes[input.attribute] >= maximum) {
    return { ok: false, reason: 'temper.capped' };
  }
  return { ok: true };
}

/**
 * Spends one banked point on `attribute`: +1 to the attribute, the stored maxima recomputed from
 * the formulas, and current health/weave rescaled proportionally in checked-integer quotient math
 * so a tempered hero is never healed or hurt by the change alone. Pure and randomness-free.
 *
 * The spend is a TRANSFER: `banked` falls by one exactly as `spent[attribute]` rises by one, so
 * `banked + sum(spent)` -- the total the run has ever earned -- is invariant. Nothing here refunds,
 * resets, or mints a point, which is what lets `grantTemperingMilestones` keep deciding what is
 * owed by subtraction against that total.
 */
export function resolveTemper(
  input: Readonly<{
    state: ActiveRun;
    content: CompiledContentPack;
    attribute: AttributeName;
    eventId: OpaqueId;
  }>,
): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  const { attribute } = input;
  const hero = heroActor(input.state);
  const tempering = input.state.hero.tempering;
  const value = hero.attributes[attribute] + 1;
  const banked = tempering.banked - 1;
  const spent = tempering.spent[attribute] + 1;
  if (!Number.isSafeInteger(value) || !Number.isSafeInteger(spent) || banked < 0) {
    throw new RangeError('tempering spend must stay within safe integers');
  }

  const raised: ActiveRun = withActor(
    {
      ...input.state,
      hero: {
        ...input.state.hero,
        tempering: { banked, spent: { ...tempering.spent, [attribute]: spent } },
      },
    },
    { ...hero, attributes: { ...hero.attributes, [attribute]: value } },
  );

  // Derived from the raised attributes, not from the stored cache: the point of the spend is that
  // the formulas now say something different.
  const derived = deriveRunActorStats({
    state: raised,
    content: input.content,
    actor: heroActor(raised),
  });
  const maxHealth = Math.max(1, derived.maxHealth);
  const maxWeave = Math.max(0, derived.maxWeave);
  // A rising maximum must neither heal nor hurt: a full hero stays full, a half-dead one stays
  // half-dead, and the living floor of 1 keeps a barely-standing hero standing. Weave floors at 0 --
  // there is no "minimum living weave".
  const health = hero.health === 0 ? 0 : rescale(hero.health, hero.maxHealth, maxHealth, 1);
  const weave = rescale(hero.weave, hero.maxWeave, maxWeave, 0);

  const state = synchronizeDerivedMaxima(
    withActor(raised, { ...heroActor(raised), maxHealth, maxWeave, health, weave }),
    input.content,
  );
  return {
    state,
    events: [
      { type: 'hero.tempered', eventId: input.eventId, attribute, value, remaining: banked },
    ],
  };
}
