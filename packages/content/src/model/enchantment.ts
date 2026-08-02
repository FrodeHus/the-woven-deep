import type { BaseContentEntry, DerivedStatName, ItemCategory } from './common.js';

export interface EnchantmentContentEntry extends BaseContentEntry {
  readonly kind: 'enchantment';
  /** Item categories this enchantment may be drawn for. Never includes `currency`. */
  readonly categories: readonly ItemCategory[];
  /** Strictly POSITIVE derived-stat modifiers. Enchanting is a gamble about magnitude, never
   * about sign: a drawback is what a curse is for. */
  readonly modifiers: Readonly<Record<DerivedStatName, number>>;
  /** Relative draw weight within its eligible pool. */
  readonly weight: number;
}
