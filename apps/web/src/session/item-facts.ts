import type { ItemContentEntry } from '@woven-deep/content';
import { DERIVED_STAT_NAMES } from '@woven-deep/content';
import { DERIVED_STAT_LABELS } from '../ui/derived-stats-display.js';
import { formatDice } from '../ui/labels.js';

/** A single known-fact row: a label and its display value, in the fixed order the inventory
 * `DetailPane` has always shown them (Damage, Armor, Light radius, Worth). Shared by `DetailPane`
 * and `AssetPopover` so a ground item's hover popover reveals exactly the same known facts as
 * opening it. */
export interface ItemFact {
  readonly label: string;
  readonly value: string;
}

/** The static per-content facts (damage/armor/light radius/worth) revealed once an item's content
 * entry is known -- callers gate the `content` lookup itself on identification (absent for an
 * unidentified item), so this never has to re-check that. */
export function itemKnownFacts(content: ItemContentEntry): readonly ItemFact[] {
  const facts: ItemFact[] = [];
  if (content.combat?.damage != null) {
    facts.push({ label: 'Damage', value: formatDice(content.combat.damage) });
  }
  if (content.combat != null && content.combat.armor > 0) {
    facts.push({ label: 'Armor', value: String(content.combat.armor) });
  }
  if (content.light != null) {
    facts.push({ label: 'Light radius', value: String(content.light.radius) });
  }
  // Intrinsic modifiers are printed on the definition, so they are known facts the moment the
  // entry is. Listed even for stats the character sheet hides (`weaveRegen`): the sheet omits
  // them as un-formulaic internal knobs, but on the item that grants one it is the whole point
  // of picking the item up. Walked in `DERIVED_STAT_NAMES` order so two items never disagree.
  for (const name of DERIVED_STAT_NAMES) {
    const amount = content.modifiers?.[name];
    if (amount === undefined) continue;
    facts.push({ label: DERIVED_STAT_LABELS[name], value: `+${String(amount)}` });
  }
  facts.push({ label: 'Worth', value: String(content.price) });
  return facts;
}
