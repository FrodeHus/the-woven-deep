import type { BackgroundContentEntry, ContentEntry } from '../../model.js';
import type { ContentCompileIssue } from '../error.js';
import { backpackItemIssues, type LocatedContentEntry } from './shared.js';

function backgroundIssues(
  located: LocatedContentEntry & { entry: BackgroundContentEntry },
  byId: ReadonlyMap<string, ContentEntry>,
): ContentCompileIssue[] {
  const { entry: background, file } = located;
  const path = `$.entries.${background.id}`;
  return backpackItemIssues(file, `${path}.extraItems`, background.extraItems, byId);
}

export function backgroundEntriesIssues(
  locatedEntries: readonly LocatedContentEntry[],
  byId: ReadonlyMap<string, ContentEntry>,
): ContentCompileIssue[] {
  const issues: ContentCompileIssue[] = [];
  for (const { entry, file } of locatedEntries) {
    if (entry.kind === 'background') issues.push(...backgroundIssues({ entry, file }, byId));
  }
  return issues;
}
