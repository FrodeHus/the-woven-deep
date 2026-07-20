import type { ContentEntry } from '../../model.js';
import type { ContentCompileIssue } from '../error.js';
import { effectIssues, type LocatedContentEntry } from './shared.js';

export function spellTrapIssues(
  locatedEntries: readonly LocatedContentEntry[],
  byId: ReadonlyMap<string, ContentEntry>,
): ContentCompileIssue[] {
  const issues: ContentCompileIssue[] = [];
  for (const { entry, file } of locatedEntries) {
    if (entry.kind === 'spell' || entry.kind === 'trap')
      issues.push(...effectIssues(file, entry.id, entry.effects, byId));
  }
  return issues;
}
