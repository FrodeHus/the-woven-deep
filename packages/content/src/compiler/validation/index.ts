import type { ContentCompileIssue } from '../error.js';
import { achievementIssues } from './achievement.js';
import { backgroundEntriesIssues } from './background.js';
import { balanceEntriesIssues } from './balance.js';
import { championTemplateEntriesIssues } from './champion-template.js';
import { classEntriesIssues } from './class.js';
import { encounterEntriesIssues } from './encounter.js';
import { npcFactionIssues } from './faction.js';
import { identificationEntriesIssues } from './identification.js';
import { itemIssues } from './item.js';
import { lootIssues } from './loot.js';
import { monsterIssues } from './monster.js';
import { npcIssues } from './npc.js';
import { buildById, compareCodeUnits, type LocatedContentEntry } from './shared.js';
import { spellTrapIssues } from './spell-trap.js';
import { buildVaultTags } from './vault-tags.js';

export type { LocatedContentEntry } from './shared.js';
export { referencedKindIssue } from './shared.js';

export function validateContentEntries(locatedEntries: readonly LocatedContentEntry[]): ContentCompileIssue[] {
  const issues: ContentCompileIssue[] = [];
  issues.push(...achievementIssues(locatedEntries));
  const byId = buildById(locatedEntries);
  const vaultTags = buildVaultTags(locatedEntries);
  issues.push(...monsterIssues(locatedEntries, byId));
  issues.push(...npcIssues(locatedEntries, byId));
  issues.push(...npcFactionIssues(locatedEntries));
  issues.push(...itemIssues(locatedEntries, byId));
  issues.push(...classEntriesIssues(locatedEntries, byId));
  issues.push(...backgroundEntriesIssues(locatedEntries, byId));
  issues.push(...spellTrapIssues(locatedEntries, byId));
  issues.push(...encounterEntriesIssues(locatedEntries, byId, vaultTags));
  issues.push(...identificationEntriesIssues(locatedEntries, byId));
  issues.push(...lootIssues(locatedEntries, byId));
  issues.push(...championTemplateEntriesIssues(locatedEntries, byId));
  issues.push(...balanceEntriesIssues(locatedEntries));
  return issues.sort((left, right) => compareCodeUnits(left.file, right.file)
    || compareCodeUnits(left.path, right.path)
    || compareCodeUnits(left.message, right.message));
}
