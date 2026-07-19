import type { ContentCompileIssue } from '../error.js';
import { issue, type LocatedContentEntry } from './shared.js';

export function achievementIssues(locatedEntries: readonly LocatedContentEntry[]): ContentCompileIssue[] {
  const issues: ContentCompileIssue[] = [];
  const firstByCriteria = new Map<string, string>();
  for (const { entry, file } of locatedEntries) {
    if (entry.kind !== 'achievement') continue;
    const first = firstByCriteria.get(entry.criteriaId);
    if (first === undefined) {
      firstByCriteria.set(entry.criteriaId, entry.id);
      continue;
    }
    issues.push(issue(file, `$.entries.${entry.id}.criteriaId`,
      `at most one achievement per criterion; ${entry.criteriaId} is already claimed by ${first}`));
  }
  return issues;
}
