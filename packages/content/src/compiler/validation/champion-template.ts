import type { ContentEntry, EncounterContentEntry, FallenChampionTemplateContentEntry } from '../../model.js';
import type { ContentCompileIssue } from '../error.js';
import { issue, referencedKindIssue, type LocatedContentEntry } from './shared.js';

function championTemplateIssues(
  located: readonly (LocatedContentEntry & { entry: FallenChampionTemplateContentEntry })[],
  byId: ReadonlyMap<string, ContentEntry>,
): ContentCompileIssue[] {
  if (located.length === 0) return [];
  const issues: ContentCompileIssue[] = [];
  if (located.length > 1) {
    issues.push(issue(located[1]!.file, '$.entries', `expected at most one fallen champion template; found ${located.length}`));
  }
  for (const { entry, file } of located) {
    const path = `$.entries.${entry.id}`;
    issues.push(...referencedKindIssue(file, `${path}.fallbackMonsterId`, entry.fallbackMonsterId, 'monster', byId));
    issues.push(...referencedKindIssue(file, `${path}.fallbackItemId`, entry.fallbackItemId, 'item', byId));
    const fallbackItem = byId.get(entry.fallbackItemId);
    if (fallbackItem?.kind === 'item' && !fallbackItem.heirloomEligible) {
      issues.push(issue(file, `${path}.fallbackItemId`, 'Champion fallback item must be heirloom eligible'));
    }
    issues.push(...referencedKindIssue(file, `${path}.echoLootTableId`, entry.echoLootTableId, 'loot-table', byId));
    const fallbackMonster = byId.get(entry.fallbackMonsterId);
    if (entry.echoAppearanceChance > 0 && fallbackMonster?.kind === 'monster') {
      const championHealth = Math.max(entry.minimumHealth, Math.min(entry.maximumHealth, fallbackMonster.health));
      const championDamage = Math.min(entry.damageMaximum,
        fallbackMonster.damage.count * fallbackMonster.damage.sides + fallbackMonster.damage.bonus);
      const championDefense = Math.min(entry.attributeMaximum, fallbackMonster.defense);
      const championAccuracy = Math.min(entry.attributeMaximum, fallbackMonster.accuracy);
      if (championHealth <= 1 || championDamage <= 0 || championDefense <= 0 || championAccuracy <= 0) {
        issues.push(issue(file, path,
          'Echoes require Champion health, damage, defense, and accuracy boundaries above their strict minimums'));
      }
    }
    const bossUniqueIds = new Set([...byId.values()].filter((candidate): candidate is Extract<EncounterContentEntry, { readonly model: 'boss' }> =>
      candidate.kind === 'encounter' && candidate.model === 'boss')
      .map((candidate) => candidate.definition.uniqueItemId));
    const visitLoot = (tableId: string, visited = new Set<string>()): string | null => {
      if (visited.has(tableId)) return null;
      visited.add(tableId);
      const table = byId.get(tableId);
      if (table?.kind !== 'loot-table') return null;
      for (const choice of table.choices) {
        if (choice.contentId !== null && bossUniqueIds.has(choice.contentId)) return choice.contentId;
        if (choice.lootTableId !== null) {
          const found = visitLoot(choice.lootTableId, visited);
          if (found !== null) return found;
        }
      }
      return null;
    };
    const uniqueEchoReward = visitLoot(entry.echoLootTableId);
    if (uniqueEchoReward !== null) {
      issues.push(issue(file, `${path}.echoLootTableId`,
        `Echo loot graph reaches guaranteed boss-unique item ${uniqueEchoReward}; Echo rewards must be ordinary`));
    }
  }
  return issues;
}

export function championTemplateEntriesIssues(
  locatedEntries: readonly LocatedContentEntry[],
  byId: ReadonlyMap<string, ContentEntry>,
): ContentCompileIssue[] {
  const championTemplates = locatedEntries.filter((located): located is LocatedContentEntry & { entry: FallenChampionTemplateContentEntry } =>
    located.entry.kind === 'fallen-champion-template');
  return championTemplateIssues(championTemplates, byId);
}
