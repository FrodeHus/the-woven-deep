import type { ContentEntry } from '../../model.js';
import type { ContentCompileIssue } from '../error.js';
import { issue, referencedKindIssue, type LocatedContentEntry } from './shared.js';

export function dialogueIssues(
  locatedEntries: readonly LocatedContentEntry[],
  byId: ReadonlyMap<string, ContentEntry>,
): ContentCompileIssue[] {
  const issues: ContentCompileIssue[] = [];
  for (const { entry, file } of locatedEntries) {
    if (entry.kind !== 'dialogue') continue;
    const topicIds = new Set(entry.topics.map((topic) => topic.id));
    const seen = new Set<string>();
    for (const topic of entry.topics) {
      const path = `$.entries.${entry.id}.topics.${topic.id}`;
      if (seen.has(topic.id))
        issues.push(issue(file, `${path}.id`, `duplicate topic id ${topic.id}`));
      seen.add(topic.id);
      for (const target of topic.reveals ?? []) {
        if (!topicIds.has(target))
          issues.push(issue(file, `${path}.reveals`, `unknown topic ${target}`));
      }
      const consequence = topic.consequence;
      if (consequence?.kind === 'reputation')
        issues.push(
          ...referencedKindIssue(
            file,
            `${path}.consequence.factionId`,
            consequence.factionId,
            'npc-faction',
            byId,
          ),
        );
      if (consequence?.kind === 'reveal-lore') {
        const target = byId.get(consequence.contentId);
        if (!target)
          issues.push(
            issue(
              file,
              `${path}.consequence.contentId`,
              `unknown reference ${consequence.contentId}`,
            ),
          );
        else if ((target.kind !== 'monster' && target.kind !== 'item') || target.lore == null)
          issues.push(
            issue(
              file,
              `${path}.consequence.contentId`,
              `reveal-lore ${consequence.contentId} must be a monster or item with authored lore`,
            ),
          );
      }
    }
  }
  return issues;
}
