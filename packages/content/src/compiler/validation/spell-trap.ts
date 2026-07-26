import type { ContentEntry, SpellContentEntry, TargetingId } from '../../model.js';
import type { ContentCompileIssue } from '../error.js';
import { effectIssues, issue, type LocatedContentEntry } from './shared.js';

const AOE_TARGETING_IDS: Readonly<Record<'burst' | 'line' | 'cone', TargetingId>> = {
  burst: 'target.burst',
  line: 'target.line',
  cone: 'target.cone',
};

function spellAoeShapeIssues(file: string, spell: SpellContentEntry): ContentCompileIssue[] {
  const path = `$.entries.${spell.id}`;
  const isAoeTargeting =
    spell.targetingId === 'target.burst' ||
    spell.targetingId === 'target.line' ||
    spell.targetingId === 'target.cone';
  if (!spell.aoe) {
    if (isAoeTargeting) {
      return [
        issue(
          file,
          `${path}.targetingId`,
          `targeting ${spell.targetingId} requires an aoe descriptor`,
        ),
      ];
    }
    return [];
  }
  const expectedTargetingId = AOE_TARGETING_IDS[spell.aoe.shape];
  if (spell.targetingId !== expectedTargetingId) {
    return [
      issue(
        file,
        `${path}.aoe.shape`,
        `aoe shape ${spell.aoe.shape} does not match targetingId ${spell.targetingId} (expected ${expectedTargetingId})`,
      ),
    ];
  }
  return [];
}

export function spellTrapIssues(
  locatedEntries: readonly LocatedContentEntry[],
  byId: ReadonlyMap<string, ContentEntry>,
): ContentCompileIssue[] {
  const issues: ContentCompileIssue[] = [];
  for (const { entry, file } of locatedEntries) {
    if (entry.kind === 'spell' || entry.kind === 'trap')
      issues.push(...effectIssues(file, entry.id, entry.effects, byId));
    if (entry.kind === 'spell') issues.push(...spellAoeShapeIssues(file, entry));
  }
  return issues;
}
