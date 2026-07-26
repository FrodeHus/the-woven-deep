import type { ContentCompileIssue } from '../error.js';
import { issue, type LocatedContentEntry } from './shared.js';

export function achievementIssues(
  locatedEntries: readonly LocatedContentEntry[],
): ContentCompileIssue[] {
  const issues: ContentCompileIssue[] = [];
  // The run-finalize fold records a defeated boss's monster id from `boss.defeated` events, resolving
  // the event's encounter to `definition.monsterId` — only `model: 'boss'` encounters produce them. So
  // a `defeat-boss` achievement is grantable only if its monster is the `definition.monsterId` of some
  // boss encounter; a boss-tagged monster with no boss encounter would compile yet be permanently
  // ungrantable.
  const spawnableBossMonsterIds = new Set(
    locatedEntries.flatMap(({ entry }) =>
      entry.kind === 'encounter' && entry.model === 'boss' ? [entry.definition.monsterId] : [],
    ),
  );
  for (const { entry, file } of locatedEntries) {
    if (entry.kind !== 'achievement') continue;
    if (
      entry.criteria.type === 'defeat-boss' &&
      !spawnableBossMonsterIds.has(entry.criteria.monsterId)
    ) {
      issues.push(
        issue(
          file,
          `$.entries.${entry.id}.criteria.monsterId`,
          `defeat-boss achievement references ${entry.criteria.monsterId}, which is not spawned by any boss encounter`,
        ),
      );
    }
  }
  return issues;
}
