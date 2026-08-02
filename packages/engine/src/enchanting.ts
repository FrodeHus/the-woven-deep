import type {
  CompiledContentPack,
  EnchantmentContentEntry,
  ItemCategory,
  ItemRarity,
} from '@woven-deep/content';
import { balanceEntry } from './balance.js';
import { requireItem } from './content-index.js';
import type { ItemEnchantmentState, ItemInstance } from './item-model.js';
import type { OpaqueId, Uint32State } from './model.js';
import { rollDie } from './random.js';
import { compareCodeUnits } from './stable-json.js';

const BPS_RESOLUTION = 10000;

/** Categories an item may ever carry an enchantment on -- everything else (potions, scrolls,
 * food, ammunition, fuel, currency, ...) is never eligible regardless of content. Mirrors
 * `CURSE_ELIGIBLE_CATEGORIES` in `curse-generation.ts` on purpose: the same set of slots a curse
 * can land on is the set an enchantment can land on. */
export const ENCHANTABLE_CATEGORIES: readonly ItemCategory[] = [
  'weapon',
  'armor',
  'shield',
  'ring',
  'light',
];

/**
 * True for an item the enchant service and scroll may target: an ordinary equipment category, not
 * an artifact, not carrying a REVEALED curse, and not heirloom provenance. An unrevealed curse is
 * invisible to hero and merchant alike, which is the same gamble the identify service exists to
 * resolve. Heirloom exclusion mirrors `merchantAcceptsItem`'s exclusion and the haunts offer
 * guard: a relic's identity IS its recorded provenance, so the Armorer must never re-forge a dead
 * hero's recorded heirloom or a haunt's dropped piece -- doing so would both destroy the recorded
 * enchantment and break the haunts `materializedPieceMatches` invariant, which pins a champion
 * reward's `enchantment` field against the record it was created from.
 */
export function enchantable(content: CompiledContentPack, item: ItemInstance): boolean {
  const definition = requireItem(content, item.contentId);
  return (
    (ENCHANTABLE_CATEGORIES as readonly string[]).includes(definition.category) &&
    definition.artifact === null &&
    item.curse?.revealed !== true &&
    item.heirloom === undefined
  );
}

/**
 * Scales an authored modifier value by a rarity's `rarityMagnitudeBps`, in basis points of the
 * authored value. Quotient division on an exact integer numerator -- the codebase's no-float
 * idiom -- with a floor of 1 so a low-rarity scaling can never erase a modifier the author
 * declared.
 */
function scaledMagnitude(authored: number, bps: number): number {
  const numerator = authored * bps;
  if (!Number.isSafeInteger(numerator)) throw new RangeError('enchantment magnitude overflowed');
  return Math.max(1, Math.trunc(numerator / BPS_RESOLUTION));
}

/**
 * The scaled modifier magnitudes a given `(enchantmentId, rarity)` pair produces: every authored
 * modifier value scaled by the rarity's `rarityMagnitudeBps`, floored at 1. Shared by
 * `drawEnchantment` (the generation path, below) and content-bound validation (the round-trip
 * check that a live item's stored magnitudes still match what the current pack would derive), so
 * both compute the identical numbers from the identical three inputs -- one definition of "what
 * this enchantment is worth on this rarity," not two that could drift apart.
 */
export function deriveEnchantmentModifiers(
  content: CompiledContentPack,
  enchantmentId: OpaqueId,
  rarity: ItemRarity,
): Readonly<Record<string, number>> {
  const entry = content.entries.find(
    (candidate): candidate is EnchantmentContentEntry =>
      candidate.kind === 'enchantment' && candidate.id === enchantmentId,
  );
  if (!entry) {
    throw new Error(`internal invariant: enchantment definition ${enchantmentId} does not exist`);
  }
  const bps = balanceEntry(content).enchanting.rarityMagnitudeBps[rarity];
  return Object.fromEntries(
    Object.entries(entry.modifiers).map(([stat, authored]) => [
      stat,
      scaledMagnitude(authored, bps),
    ]),
  );
}

/**
 * Draws one enchantment for `item` on the `enchanting` stream: a single weighted pick over the
 * pack's `enchantment` entries eligible for the item's category, with each modifier scaled by the
 * item rarity's `rarityMagnitudeBps`. Exactly ONE draw, always -- an ineligible item must be
 * rejected by the caller (`enchantable`) before this is reached, never here, so the stream
 * position is a function of accepted enchants alone. Throws only when the pack defines no
 * eligible entries at all for the item's category, an authoring bug the shipping-pack coverage
 * test exists to keep unreachable in practice -- never a per-item eligibility decision, which is
 * `enchantable`'s job.
 */
export function drawEnchantment(
  input: Readonly<{ content: CompiledContentPack; item: ItemInstance; state: Uint32State }>,
): Readonly<{ enchantment: ItemEnchantmentState; state: Uint32State }> {
  const { content, item, state } = input;
  const definition = requireItem(content, item.contentId);
  const eligible = content.entries
    .filter(
      (entry): entry is EnchantmentContentEntry =>
        entry.kind === 'enchantment' && entry.categories.includes(definition.category),
    )
    .sort((left, right) => compareCodeUnits(left.id, right.id));
  if (eligible.length === 0) {
    throw new Error(
      `internal invariant: content pack defines no enchantment entries for category ${definition.category}`,
    );
  }
  const totalWeight = eligible.reduce((sum, entry) => sum + entry.weight, 0);
  const roll = rollDie(state, totalWeight);
  let cumulative = 0;
  let chosen = eligible[eligible.length - 1]!;
  for (const entry of eligible) {
    cumulative += entry.weight;
    if (roll.value <= cumulative) {
      chosen = entry;
      break;
    }
  }
  const modifiers = deriveEnchantmentModifiers(content, chosen.id, definition.rarity);
  return {
    enchantment: { enchantmentId: chosen.id, modifiers },
    state: roll.state,
  };
}
