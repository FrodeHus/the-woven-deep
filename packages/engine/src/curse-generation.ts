import type { CompiledContentPack, CurseContentEntry, ItemCategory } from '@woven-deep/content';
import { balanceEntry } from './balance.js';
import { requireItem } from './content-index.js';
import type { ItemInstance } from './item-model.js';
import type { DepthBand } from './loot-placement.js';
import type { Uint32State } from './model.js';
import { rollDie } from './random.js';
import { compareCodeUnits } from './stable-json.js';

const BPS_RESOLUTION = 10000;

/** Categories a curse may ever land on -- everything else (potions, scrolls, food, gold, ...)
 * is never eligible regardless of the roll. */
export const CURSE_ELIGIBLE_CATEGORIES: readonly ItemCategory[] = [
  'weapon',
  'armor',
  'shield',
  'ring',
  'light',
];

/** True for a generated instance that may carry a curse: an eligible category, not an artifact. */
export function curseEligible(content: CompiledContentPack, item: ItemInstance): boolean {
  const entry = requireItem(content, item.contentId);
  return (
    (CURSE_ELIGIBLE_CATEGORIES as readonly string[]).includes(entry.category) &&
    entry.artifact === null
  );
}

/**
 * Bps chance an eligible item generates cursed, before the eligibility gate: the band's base rate,
 * doubled (via `enchantedMultiplierBps`) when the item is enchanted, and capped at `capBps` either
 * way. `Math.trunc` on the exact integer quotient is the codebase's checked quotient-division
 * idiom -- no float ever survives the expression.
 */
export function curseChanceBps(
  input: Readonly<{
    balance: Readonly<{
      chanceBps: Readonly<Record<DepthBand, number>>;
      enchantedMultiplierBps: number;
      capBps: number;
    }>;
    band: DepthBand;
    enchanted: boolean;
  }>,
): number {
  const base = input.balance.chanceBps[input.band];
  if (!Number.isSafeInteger(base) || base < 0) {
    throw new RangeError(`curse chance for band ${input.band} must be a non-negative safe integer`);
  }
  if (!input.enchanted) return Math.min(base, input.balance.capBps);
  const numerator = base * input.balance.enchantedMultiplierBps;
  if (!Number.isSafeInteger(numerator)) throw new RangeError('curse chance overflowed');
  const scaled = Math.trunc(numerator / BPS_RESOLUTION);
  if (!Number.isSafeInteger(scaled)) throw new RangeError('curse chance overflowed');
  return Math.min(scaled, input.balance.capBps);
}

/**
 * Rolls one curse chance per eligible item, in `compareCodeUnits` itemId order, threading the
 * caller's own loot stream. Ineligible items consume nothing; zero eligible items consume
 * nothing. Items are returned in their original order with `curse` attached where the roll
 * succeeded.
 */
export function applyCurseRolls(
  input: Readonly<{
    content: CompiledContentPack;
    items: readonly ItemInstance[];
    band: DepthBand;
    state: Uint32State;
  }>,
): Readonly<{ items: readonly ItemInstance[]; state: Uint32State }> {
  const { content, items, band, state } = input;
  const eligibleOrder = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => curseEligible(content, item))
    .sort((left, right) => compareCodeUnits(left.item.itemId, right.item.itemId));

  if (eligibleOrder.length === 0) return { items, state };

  const balance = balanceEntry(content).curses;
  const curseIds = content.entries
    .filter((entry): entry is CurseContentEntry => entry.kind === 'curse')
    .map((entry) => entry.id)
    .sort(compareCodeUnits);

  let cursor = state;
  const cursedByIndex = new Map<number, ItemInstance>();
  for (const { item, index } of eligibleOrder) {
    const enchanted = item.enchantment !== null;
    const chance = curseChanceBps({ balance, band, enchanted });
    const roll = rollDie(cursor, BPS_RESOLUTION);
    cursor = roll.state;
    if (roll.value > chance) continue;
    if (curseIds.length === 0) {
      throw new Error(
        'internal invariant: curse roll succeeded but the pack defines no curse entries',
      );
    }
    // Conditional draw: the identity roll below is only spent when the chance roll just above
    // succeeded, so how far the caller's stream advances depends on the pack's curse content (how
    // many curse entries exist) as well as on how many chance rolls landed. That is safe -- not a
    // determinism hole -- because `run.contentHash` binds the exact pack a run replays against;
    // the stream position is deterministic *for that pack*, which is the only replay contract this
    // engine makes. A pack edit that adds/removes a curse entry, or changes a `curses` balance
    // knob, is content-hash-visible and is expected to move every downstream roll, the same as any
    // other loot-table edit.
    const pick = rollDie(cursor, curseIds.length);
    cursor = pick.state;
    const curseId = curseIds[pick.value - 1]!;
    cursedByIndex.set(index, { ...item, curse: { curseId, revealed: false } });
  }

  if (cursedByIndex.size === 0) return { items, state: cursor };
  const resultItems = items.map((item, index) => cursedByIndex.get(index) ?? item);
  return { items: resultItems, state: cursor };
}
