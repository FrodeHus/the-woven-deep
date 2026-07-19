import type { ContentEntry } from '../../model.js';
import type { ContentCompileIssue } from '../error.js';
import { NPC_BEHAVIOR_PARAMETER_SCHEMAS } from '../registries.js';
import { referencedKindIssue, validateParameters, type LocatedContentEntry } from './shared.js';

export function npcIssues(
  locatedEntries: readonly LocatedContentEntry[],
  byId: ReadonlyMap<string, ContentEntry>,
): ContentCompileIssue[] {
  const issues: ContentCompileIssue[] = [];
  for (const { entry, file } of locatedEntries) {
    if (entry.kind !== 'npc') continue;
    issues.push(...referencedKindIssue(file, `$.entries.${entry.id}.factionId`, entry.factionId, 'npc-faction', byId));
    issues.push(...validateParameters(file, `$.entries.${entry.id}.behavior`, entry.behaviorId,
      entry.behaviorParameters, NPC_BEHAVIOR_PARAMETER_SCHEMAS, 'NPC behavior'));
  }
  return issues;
}
