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
    issues.push(
      ...validateParameters(
        file,
        `$.entries.${entry.id}.behavior`,
        entry.behaviorId,
        entry.behaviorParameters,
        BEHAVIOR_PARAMETER_SCHEMAS,
        'behavior',
      ),
    );
    entry.onHitConditions.forEach((rider, index) => {
      const path = `$.entries.${entry.id}.onHitConditions.${index}`;
      const referenceIssues = referencedKindIssue(
        file,
        `${path}.conditionId`,
        rider.conditionId,
        'condition',
        byId,
      );
      issues.push(...referenceIssues);
      if (referenceIssues.length > 0) return;
      const condition = byId.get(rider.conditionId);
      if (condition?.kind !== 'condition' || rider.duration === null) return;
      if (condition.duration.mode === 'permanent') {
        issues.push({
          file,
          path: `${path}.duration`,
          message: 'permanent condition rejects a duration override',
        });
        return;
      }
      if (rider.duration > condition.duration.maximum) {
        issues.push({
          file,
          path: `${path}.duration`,
          message: `duration ${rider.duration} exceeds maximum ${condition.duration.maximum}`,
        });
      }
    });
    if (entry.lootTableId !== null) {
      issues.push(
        ...referencedKindIssue(
          file,
          `$.entries.${entry.id}.lootTableId`,
          entry.lootTableId,
          'loot-table',
          byId,
        ),
      );
    }
  }
  return issues;
}
