import type { ContentEntry } from '../../model.js';
import type { ContentCompileIssue } from '../error.js';
import { BEHAVIOR_PARAMETER_SCHEMAS } from '../registries.js';
import { referencedKindIssue, validateParameters, type LocatedContentEntry } from './shared.js';

export function monsterIssues(
  locatedEntries: readonly LocatedContentEntry[],
  byId: ReadonlyMap<string, ContentEntry>,
): ContentCompileIssue[] {
  const issues: ContentCompileIssue[] = [];
  for (const { entry, file } of locatedEntries) {
    if (entry.kind !== 'monster') continue;
    issues.push(...validateParameters(file, `$.entries.${entry.id}.behavior`, entry.behaviorId, entry.behaviorParameters, BEHAVIOR_PARAMETER_SCHEMAS, 'behavior'));
    if (entry.lootTableId !== null) {
      issues.push(...referencedKindIssue(file, `$.entries.${entry.id}.lootTableId`, entry.lootTableId, 'loot-table', byId));
    }
  }
  return issues;
}
