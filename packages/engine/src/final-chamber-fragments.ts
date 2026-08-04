import type { CompiledContentPack } from '@woven-deep/content';
import type { ActiveRun } from './model.js';

export const TABLET_FRAGMENT_TAG = 'tablet-fragment';

export function tabletFragmentIds(content: CompiledContentPack): readonly string[] {
  return content.entries
    .filter((entry) => entry.kind === 'item' && entry.tags.includes(TABLET_FRAGMENT_TAG))
    .map((entry) => entry.id);
}

/**
 * True iff the hero's backpack presently holds the given fragment content id — the strictly
 * run-local question. The deep-floor fragment spawn's no-duplicate rule asks it so a fragment
 * already carried this run never respawns.
 */
export function heroHoldsFragment(run: ActiveRun, fragmentId: string): boolean {
  return run.items.some(
    (item) =>
      item.location.type === 'backpack' &&
      item.location.actorId === run.hero.actorId &&
      item.contentId === fragmentId,
  );
}

/**
 * True iff the hero can assemble the Ancient Tablet: every fragment content id the pack defines is
 * either carried right now or banked by an earlier run (`run.collectedFragmentIds`, seeded from the
 * player's `LifetimeState`). The tablet is assembled ACROSS runs — a full set found in a single
 * dive is rarer by orders of magnitude than the ending it unlocks was ever meant to be.
 *
 * An empty fragment set never trivially satisfies this — it returns false rather than vacuously
 * true, so content that ships with zero fragments cannot unlock `broke-cycle`.
 */
export function canAssembleTablet(run: ActiveRun, content: CompiledContentPack): boolean {
  const fragmentIds = tabletFragmentIds(content);
  if (fragmentIds.length === 0) return false;
  return fragmentIds.every(
    (fragmentId) =>
      heroHoldsFragment(run, fragmentId) || run.collectedFragmentIds.includes(fragmentId),
  );
}
