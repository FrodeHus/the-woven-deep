import type { NpcFactionContentEntry } from '../../model.js';
import type { ContentCompileIssue } from '../error.js';
import { issue, type LocatedContentEntry } from './shared.js';

function factionIssues(file: string, faction: NpcFactionContentEntry): ContentCompileIssue[] {
  const path = `$.entries.${faction.id}`;
  const issues: ContentCompileIssue[] = [];
  if (faction.minimumReputation > faction.maximumReputation)
    issues.push(
      issue(
        file,
        `${path}.minimumReputation`,
        'minimum reputation must not exceed maximum reputation',
      ),
    );
  if (
    faction.startingReputation < faction.minimumReputation ||
    faction.startingReputation > faction.maximumReputation
  ) {
    issues.push(
      issue(
        file,
        `${path}.startingReputation`,
        'starting reputation must be within faction bounds',
      ),
    );
  }
  const sorted = faction.tiers
    .map((tier, authoredIndex) => ({ tier, authoredIndex }))
    .sort((left, right) => left.tier.minimum - right.tier.minimum);
  const tierIds = new Set<string>();
  sorted.forEach(({ tier, authoredIndex }, index) => {
    if (tierIds.has(tier.tierId))
      issues.push(
        issue(
          file,
          `${path}.tiers.${authoredIndex}.tierId`,
          `duplicate reputation tier ${tier.tierId}`,
        ),
      );
    tierIds.add(tier.tierId);
    if (new Set(tier.serviceIds).size !== tier.serviceIds.length) {
      issues.push(
        issue(
          file,
          `${path}.tiers.${authoredIndex}.serviceIds`,
          `duplicate service ID in reputation tier ${tier.tierId}`,
        ),
      );
    }
    if (tier.maximum < tier.minimum)
      issues.push(
        issue(
          file,
          `${path}.tiers.${authoredIndex}.maximum`,
          'tier maximum must be at least minimum',
        ),
      );
    if (
      index === 0
        ? tier.minimum !== faction.minimumReputation
        : tier.minimum !== sorted[index - 1]!.tier.maximum + 1
    ) {
      issues.push(
        issue(
          file,
          `${path}.tiers.${authoredIndex}`,
          'reputation tiers must cover every value without gaps or overlaps',
        ),
      );
    }
  });
  if (sorted.at(-1)?.tier.maximum !== faction.maximumReputation)
    issues.push(
      issue(
        file,
        `${path}.tiers`,
        'reputation tiers must cover every value through maximum reputation',
      ),
    );
  return issues;
}

export function npcFactionIssues(
  locatedEntries: readonly LocatedContentEntry[],
): ContentCompileIssue[] {
  const issues: ContentCompileIssue[] = [];
  for (const { entry, file } of locatedEntries) {
    if (entry.kind === 'npc-faction') issues.push(...factionIssues(file, entry));
  }
  return issues;
}
