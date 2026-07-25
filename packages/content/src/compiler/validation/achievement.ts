import type { ContentCompileIssue } from '../error.js';
import { issue, type LocatedContentEntry } from './shared.js';

export function achievementIssues(
  locatedEntries: readonly LocatedContentEntry[],
): ContentCompileIssue[] {
  const issues: ContentCompileIssue[] = [];
  const bossMonsterIds = new Set(
    locatedEntries
      .filter(({ entry }) => entry.kind === 'monster' && entry.tags.includes('boss'))
      .map(({ entry }) => entry.id),
  );
  for (const { entry, file } of locatedEntries) {
    if (entry.kind !== 'achievement') continue;
    if (entry.criteria.type === 'defeat-boss' && !bossMonsterIds.has(entry.criteria.monsterId)) {
      issues.push(
        issue(
          file,
          `$.entries.${entry.id}.criteria.monsterId`,
          `defeat-boss achievement references ${entry.criteria.monsterId}, which is not a boss-tagged monster`,
        ),
      );
    }
  }
  return issues;
}
