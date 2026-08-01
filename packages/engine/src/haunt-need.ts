import type {
  CompiledContentPack,
  FallenChampionTemplateContentEntry,
  ItemCategory,
} from '@woven-deep/content';
import type { FallenHeroStandingSnapshot } from './population-model.js';
import { compareCodeUnits } from './stable-json.js';

/**
 * The pack's single fallen-champion template. Lives here rather than in `run-finalize.ts` so the
 * three consumers that need it outside run finalization -- offer validation, the haunt projection,
 * and finalization itself -- share one lookup instead of three copies of the same four lines.
 */
export function fallenChampionTemplate(
  content: CompiledContentPack,
): FallenChampionTemplateContentEntry {
  const template = content.entries.find(
    (entry): entry is FallenChampionTemplateContentEntry =>
      entry.kind === 'fallen-champion-template',
  );
  if (!template)
    throw new Error('internal invariant: content pack is missing a fallen-champion-template entry');
  return template;
}

/**
 * The item categories a haunt accepts as an offering, derived deterministically from its standing
 * and the champion template: the union of every favored category for the standing's class tags,
 * plus the causeless categories when the record names no killer, falling back to the template's
 * defaults when the class tags contribute nothing. Sorted and deduplicated, so engine validation
 * and the client's UI hint can never disagree. Pure; consumes no randomness and no run state.
 */
export function hauntNeed(
  input: Readonly<{
    standing: FallenHeroStandingSnapshot;
    template: FallenChampionTemplateContentEntry;
  }>,
): readonly ItemCategory[] {
  const { classFavors, causelessCategories, defaultCategories } = input.template.appeasement;
  const favored = input.standing.classTags.flatMap((tag) => classFavors[tag] ?? []);
  // A record with no cause at all, or a death with no killer entity (the dark, the light going
  // out, starvation), wants light -- the spec's one universal rule, authored rather than hardcoded.
  const causeless =
    input.standing.cause === null || input.standing.cause.killerContentId === null
      ? causelessCategories
      : [];
  const union = [...favored, ...causeless];
  // Every haunt must be appeasable: a class whose tags the template does not map falls back to the
  // defaults rather than becoming an unanswerable riddle.
  const resolved = union.length === 0 ? [...defaultCategories] : union;
  return [...new Set(resolved)].sort(compareCodeUnits);
}
