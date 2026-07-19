import { DERIVED_STAT_NAMES, type DerivedStatName } from '@woven-deep/engine';

/**
 * Derived stats that must stay in `DERIVED_STAT_NAMES` (so item/trait/class modifiers can target
 * them via `deriveActorStats`) but are internal knobs, not player-facing stats -- showing them in a
 * derived-stat list would just render a raw key or a meaningless label. Currently: the light-out
 * mechanic's reveal radius and memory-persists knobs.
 */
export const PLAYER_HIDDEN_DERIVED_STATS: ReadonlySet<DerivedStatName> = new Set<DerivedStatName>([
  'lightOutRevealRadius', 'lightOutMemoryPersists',
]);

/** `DERIVED_STAT_NAMES` filtered down to the stats a player-facing derived-stat display should show. */
export function playerVisibleDerivedStats(): readonly DerivedStatName[] {
  return DERIVED_STAT_NAMES.filter((name) => !PLAYER_HIDDEN_DERIVED_STATS.has(name));
}
