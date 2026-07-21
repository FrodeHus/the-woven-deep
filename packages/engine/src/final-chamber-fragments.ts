import type { CompiledContentPack } from '@woven-deep/content';
import type { ActiveRun } from './model.js';

export const TABLET_FRAGMENT_TAG = 'tablet-fragment';

export function tabletFragmentIds(content: CompiledContentPack): readonly string[] {
  return content.entries
    .filter((entry) => entry.kind === 'item' && entry.tags.includes(TABLET_FRAGMENT_TAG))
    .map((entry) => entry.id);
}

/**
 * True iff the hero's backpack presently holds the given fragment content id. Shared by
 * `heroHoldsAllFragments` (the full-set gate) and the deep-floor fragment spawn's run-local
 * no-duplicate rule (a fragment already carried this run never respawns).
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
 * True iff the hero's backpack presently holds every Ancient Tablet fragment defined by content.
 * An empty fragment set never trivially satisfies this — it returns false rather than vacuously
 * true, so content that ships with zero fragments cannot unlock `broke-cycle`.
 */
export function heroHoldsAllFragments(run: ActiveRun, content: CompiledContentPack): boolean {
  const fragmentIds = tabletFragmentIds(content);
  if (fragmentIds.length === 0) return false;
  return fragmentIds.every((fragmentId) => heroHoldsFragment(run, fragmentId));
}
