import type { ContentEntry } from '../../model.js';
import type { ContentCompileIssue } from '../error.js';
import { effectIssues, type LocatedContentEntry } from './shared.js';

/**
 * Runs a curse's trigger effect through the same reference and duration checks every item, spell,
 * and trap effect already gets. Without this a curse could name an unknown condition, or hand a
 * timed condition a duration past its authored `maximum` -- which `applyCondition` rejects with a
 * RangeError at runtime, crashing mid-run the first time the trigger's chance roll happens to hit.
 * That is a failure no seed is guaranteed to surface, so it belongs at compile time.
 */
export function curseIssues(
  locatedEntries: readonly LocatedContentEntry[],
  byId: ReadonlyMap<string, ContentEntry>,
): ContentCompileIssue[] {
  const issues: ContentCompileIssue[] = [];
  for (const { entry, file } of locatedEntries) {
    // A curse need not carry a trigger at all -- a pure `drawbackModifiers` curse has none.
    if (entry.kind !== 'curse' || !entry.trigger) continue;
    issues.push(...effectIssues(file, entry.id, [entry.trigger.effect], byId));
  }
  return issues;
}
