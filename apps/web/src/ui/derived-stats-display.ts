import { DERIVED_STAT_NAMES, type AttributeName, type DerivedStatName } from '@woven-deep/engine';

/**
 * Derived stats that must stay in `DERIVED_STAT_NAMES` (so item/trait/class modifiers can target
 * them via `deriveActorStats`) but are internal knobs, not player-facing stats -- showing them in a
 * derived-stat list would just render a raw key or a meaningless label. Currently: the light-out
 * mechanic's reveal radius, memory-persists, and commits-memory knobs.
 */
export const PLAYER_HIDDEN_DERIVED_STATS: ReadonlySet<DerivedStatName> = new Set<DerivedStatName>([
  'lightOutRevealRadius',
  'lightOutMemoryPersists',
  'lightOutCommitsMemory',
]);

/** `DERIVED_STAT_NAMES` filtered down to the stats a player-facing derived-stat display should show. */
export function playerVisibleDerivedStats(): readonly DerivedStatName[] {
  return DERIVED_STAT_NAMES.filter((name) => !PLAYER_HIDDEN_DERIVED_STATS.has(name));
}

/** Display label for each derived stat, used by any player-facing derived-stat list (chargen review,
 * hero record, character sheet). */
export const DERIVED_STAT_LABELS: Readonly<Record<DerivedStatName, string>> = {
  maxHealth: 'Max health',
  meleeAccuracy: 'Melee accuracy',
  meleeDamageBonus: 'Melee damage bonus',
  rangedAccuracy: 'Ranged accuracy',
  defense: 'Defense',
  search: 'Search',
  disarm: 'Disarm',
  lightOutRevealRadius: 'Light-out reveal radius',
  lightOutMemoryPersists: 'Light-out memory persists',
  lightOutCommitsMemory: 'Light-out commits memory',
};

/** Display label for each base attribute, in `ATTRIBUTE_ORDER`, used by any player-facing
 * attribute list (chargen, character sheet). */
export const ATTRIBUTE_LABELS: Readonly<Record<AttributeName, string>> = {
  might: 'Might',
  agility: 'Agility',
  vitality: 'Vitality',
  wits: 'Wits',
  resolve: 'Resolve',
};

/** Summarizes a background/trait's derived-stat modifiers as short `+N Stat` text, e.g. for an
 * option-row's meta line. Only includes player-visible stats; returns `undefined` when there's
 * nothing to show. */
export function modifiersMeta(
  modifiers: Readonly<Partial<Record<DerivedStatName, number>>>,
): string | undefined {
  const parts = playerVisibleDerivedStats()
    .filter((statName) => modifiers[statName] !== undefined)
    .map((statName) => `${modifiers[statName]! >= 0 ? '+' : ''}${modifiers[statName]} ${statName}`);
  return parts.length > 0 ? parts.join(', ') : undefined;
}
