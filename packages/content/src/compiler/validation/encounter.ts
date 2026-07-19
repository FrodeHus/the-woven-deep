import type { ContentEntry, EncounterContentEntry, NpcFactionContentEntry } from '../../model.js';
import type { ContentCompileIssue } from '../error.js';
import { BEHAVIOR_PARAMETER_SCHEMAS, BOSS_PHASE_EFFECT_IDS, LEADER_RESPONSE_PARAMETER_SCHEMAS, SWARM_RESPONSE_PARAMETER_SCHEMAS } from '../registries.js';
import {
  checkedTotalWithin, MAX_ENCOUNTER_MEMBERS, MAX_RANDOM_WEIGHT_TOTAL,
  MAX_SWARM_FLOOR_ACTORS, MAX_SWARM_LIVING_CHILDREN, MAX_SWARM_LIVING_MEMBERS,
  MAX_SWARM_SPAWN_QUANTITY,
} from '../../population-limits.js';
import { effectsAtPath, issue, referencedKindIssue, validateParameters, type LocatedContentEntry } from './shared.js';

function encounterIssues(
  file: string,
  encounter: EncounterContentEntry,
  byId: ReadonlyMap<string, ContentEntry>,
): ContentCompileIssue[] {
  const path = `$.entries.${encounter.id}.definition`;
  const issues: ContentCompileIssue[] = [];
  if (encounter.model === 'individual') {
    issues.push(...referencedKindIssue(file, `${path}.monsterId`, encounter.definition.monsterId, 'monster', byId));
    if (encounter.definition.maximumQuantity > MAX_ENCOUNTER_MEMBERS) {
      issues.push(issue(file, `${path}.maximumQuantity`,
        `individual quantity exceeds runtime-safe limit ${MAX_ENCOUNTER_MEMBERS}`));
    }
    return issues;
  }
  if (encounter.model === 'group') {
    const definition = encounter.definition;
    const roleIds = new Set<string>();
    definition.roles.forEach((role, index) => {
      if (roleIds.has(role.roleId)) issues.push(issue(file, `${path}.roles.${index}.roleId`, `duplicate group role ${role.roleId}`));
      roleIds.add(role.roleId);
      issues.push(...referencedKindIssue(file, `${path}.roles.${index}.monsterId`, role.monsterId, 'monster', byId));
      const monster = byId.get(role.monsterId);
      if (monster?.kind === 'monster') {
        issues.push(...validateParameters(file, `${path}.roles.${index}.behavior`, monster.behaviorId,
          role.behaviorParameters, BEHAVIOR_PARAMETER_SCHEMAS, 'behavior'));
      }
    });
    if (!roleIds.has(definition.leaderRoleId)) {
      issues.push(issue(file, `${path}.leaderRoleId`, `leader role ${definition.leaderRoleId} is not declared in roles`));
    }
    if (!checkedTotalWithin(definition.roles.map((role) => role.maximumQuantity), MAX_ENCOUNTER_MEMBERS)) {
      issues.push(issue(file, `${path}.roles`, `group maximum quantity exceeds runtime-safe limit ${MAX_ENCOUNTER_MEMBERS}`));
    }
    if (definition.leaderDeathResponse === 'collapse' && !definition.supernaturalBond) {
      issues.push(issue(file, `${path}.supernaturalBond`, 'collapse requires supernaturalBond: true'));
    }
    if (definition.leaderDeathResponse === 'collapse' && definition.collapseRewards === 'individual'
      && encounter.adminDescription === null) {
      issues.push(issue(file, `$.entries.${encounter.id}.adminDescription`,
        'collapse with individual rewards requires an admin description of the reward behavior'));
    }
    issues.push(...validateParameters(file, `${path}.response`, definition.leaderDeathResponse,
      definition.responseParameters, LEADER_RESPONSE_PARAMETER_SCHEMAS, 'leader response'));
    return issues;
  }
  if (encounter.model === 'swarm') {
    const definition = encounter.definition;
    issues.push(...referencedKindIssue(file, `${path}.sourceMonsterId`, definition.sourceMonsterId, 'monster', byId));
    const source = byId.get(definition.sourceMonsterId);
    if (source?.kind === 'monster' && !source.tags.includes('swarm-source')) {
      issues.push(issue(file, `${path}.sourceMonsterId`, `swarm source ${source.id} requires tag swarm-source`));
    }
    const roleIds = new Set<string>();
    definition.spawnRoles.forEach((role, index) => {
      if (roleIds.has(role.roleId)) issues.push(issue(file, `${path}.spawnRoles.${index}.roleId`, `duplicate swarm role ${role.roleId}`));
      roleIds.add(role.roleId);
      issues.push(...referencedKindIssue(file, `${path}.spawnRoles.${index}.monsterId`, role.monsterId, 'monster', byId));
    });
    if (!checkedTotalWithin(definition.spawnRoles.map((role) => role.weight), MAX_RANDOM_WEIGHT_TOTAL)) {
      issues.push(issue(file, `${path}.spawnRoles`, `spawn-role weight total exceeds rollDie maximum 2^32`));
    }
    if (definition.maximumSpawnQuantity > MAX_SWARM_SPAWN_QUANTITY) {
      issues.push(issue(file, `${path}.maximumSpawnQuantity`,
        `spawn quantity exceeds runtime-safe limit ${MAX_SWARM_SPAWN_QUANTITY}`));
    }
    if (definition.maximumLivingChildren > MAX_SWARM_LIVING_CHILDREN) {
      issues.push(issue(file, `${path}.maximumLivingChildren`,
        `maximum living children exceeds runtime-safe limit ${MAX_SWARM_LIVING_CHILDREN}`));
    }
    if (definition.maximumLivingMembers > MAX_SWARM_LIVING_MEMBERS) {
      issues.push(issue(file, `${path}.maximumLivingMembers`,
        `maximum living members exceeds runtime-safe limit ${MAX_SWARM_LIVING_MEMBERS}`));
    }
    if (definition.maximumFloorActors > MAX_SWARM_FLOOR_ACTORS) {
      issues.push(issue(file, `${path}.maximumFloorActors`,
        `maximum floor actors exceeds runtime-safe limit ${MAX_SWARM_FLOOR_ACTORS}`));
    }
    if (definition.maximumSpawnQuantity > definition.maximumLivingChildren) {
      issues.push(issue(file, `${path}.maximumSpawnQuantity`, 'maximum spawn quantity must not exceed maximum living children'));
    }
    if (definition.maximumLivingMembers < definition.maximumLivingChildren + 1) {
      issues.push(issue(file, `${path}.maximumLivingMembers`, 'maximum living members must allow the source plus all living children'));
    }
    if (definition.maximumFloorActors < definition.maximumLivingMembers) {
      issues.push(issue(file, `${path}.maximumFloorActors`, 'maximum floor actors must be at least maximum living members'));
    }
    issues.push(...validateParameters(file, `${path}.response`, definition.sourceDestructionResponse,
      definition.responseParameters, SWARM_RESPONSE_PARAMETER_SCHEMAS, 'swarm response'));
    return issues;
  }
  if (encounter.model === 'merchant') {
    const definition = encounter.definition;
    issues.push(...referencedKindIssue(file, `${path}.npcId`, definition.npcId, 'npc', byId));
    issues.push(...referencedKindIssue(file, `${path}.stockLootTableId`, definition.stockLootTableId, 'loot-table', byId));
    if (definition.maximumStockRolls < definition.minimumStockRolls) {
      issues.push(issue(file, `${path}.maximumStockRolls`, 'maximum stock rolls must be at least minimum stock rolls'));
    }
    if (!definition.permanent && definition.maximumLifetime !== undefined && definition.minimumLifetime !== undefined
      && definition.maximumLifetime < definition.minimumLifetime) {
      issues.push(issue(file, `${path}.maximumLifetime`, 'maximum lifetime must be at least minimum lifetime'));
    }
    if (!definition.permanent && definition.departureWarningThresholds !== undefined && definition.minimumLifetime !== undefined) {
      let previous = Number.POSITIVE_INFINITY;
      const minimumLifetime = definition.minimumLifetime;
      definition.departureWarningThresholds.forEach((threshold, index) => {
        if (threshold >= previous || threshold >= minimumLifetime) {
          issues.push(issue(file, `${path}.departureWarningThresholds.${index}`,
            'departure warning thresholds must be unique, strictly descending, and below minimum lifetime'));
        }
        previous = threshold;
      });
    }
    const npc = byId.get(definition.npcId);
    const faction = npc?.kind === 'npc' ? byId.get(npc.factionId) : undefined;
    const factionTiers = faction?.kind === 'npc-faction'
      ? new Map(faction.tiers.map((tier) => [tier.tierId, tier]))
      : new Map<string, NpcFactionContentEntry['tiers'][number]>();
    const serviceIds = new Set<string>();
    definition.services.forEach((service, index) => {
      if (serviceIds.has(service.serviceId)) issues.push(issue(file, `${path}.services.${index}.serviceId`, `duplicate merchant service ${service.serviceId}`));
      serviceIds.add(service.serviceId);
      if (service.maximumUses < service.minimumUses) issues.push(issue(file, `${path}.services.${index}.maximumUses`, 'maximum service uses must be at least minimum uses'));
      const tiers = new Set<string>();
      service.tierIds.forEach((tierId, tierIndex) => {
        if (tiers.has(tierId)) issues.push(issue(file, `${path}.services.${index}.tierIds.${tierIndex}`, `duplicate service tier ${tierId}`));
        tiers.add(tierId);
        const factionTier = factionTiers.get(tierId);
        if (!factionTier) issues.push(issue(file, `${path}.services.${index}.tierIds.${tierIndex}`, `service tier ${tierId} is absent from NPC faction`));
        else if (!factionTier.serviceIds.includes(service.serviceId)) {
          issues.push(issue(file, `${path}.services.${index}.tierIds.${tierIndex}`,
            `service ${service.serviceId} is not enabled for faction tier ${tierId}`));
        }
      });
    });
    const bossUniqueIds = new Set([...byId.values()].filter((candidate) => candidate.kind === 'encounter' && candidate.model === 'boss')
      .map((candidate) => candidate.definition.uniqueItemId));
    const visited = new Set<string>();
    const visit = (tableId: string): void => {
      if (visited.has(tableId)) return;
      visited.add(tableId);
      const table = byId.get(tableId);
      if (table?.kind !== 'loot-table') return;
      for (const choice of table.choices) {
        if (choice.contentId !== null) {
          const item = byId.get(choice.contentId);
          if (item?.kind === 'item') {
            if (item.price <= 0) issues.push(issue(file, `${path}.stockLootTableId`, `merchant stock item ${item.id} requires positive price`));
            if (bossUniqueIds.has(item.id)) issues.push(issue(file, `${path}.stockLootTableId`, `merchant stock item ${item.id} is guaranteed unique`));
            const reserved = item.tags.find((tag) => ['heirloom', 'quest', 'objective', 'nontransferable'].includes(tag));
            if (reserved) issues.push(issue(file, `${path}.stockLootTableId`, `merchant stock item ${item.id} has reserved ${reserved} tag`));
          }
        }
        if (choice.lootTableId !== null) visit(choice.lootTableId);
      }
    };
    visit(definition.stockLootTableId);
    return issues;
  }
  const definition = encounter.definition;
  issues.push(...referencedKindIssue(file, `${path}.monsterId`, definition.monsterId, 'monster', byId));
  issues.push(...referencedKindIssue(file, `${path}.uniqueItemId`, definition.uniqueItemId, 'item', byId));
  issues.push(...referencedKindIssue(file, `${path}.enhancedLootTableId`, definition.enhancedLootTableId, 'loot-table', byId));
  const visitLootForUnique = (tableId: string, visited = new Set<string>()): boolean => {
    if (visited.has(tableId)) return false;
    visited.add(tableId);
    const table = byId.get(tableId);
    if (table?.kind !== 'loot-table') return false;
    return table.choices.some((choice) => choice.contentId === definition.uniqueItemId
      || (choice.lootTableId !== null && visitLootForUnique(choice.lootTableId, visited)));
  };
  if (visitLootForUnique(definition.enhancedLootTableId)) {
    issues.push(issue(file, `${path}.enhancedLootTableId`,
      `boss enhanced loot graph reaches guaranteed unique item ${definition.uniqueItemId}`));
  }
  const duplicateUnique = [...byId.values()].filter((candidate) => candidate.kind === 'encounter'
    && candidate.model === 'boss' && candidate.id !== encounter.id
    && candidate.definition.uniqueItemId === definition.uniqueItemId);
  if (duplicateUnique.length > 0) {
    issues.push(issue(file, `${path}.uniqueItemId`, `boss guaranteed unique item ${definition.uniqueItemId} is shared`));
  }
  if (encounter.maximumInstancesPerRun !== 1) {
    issues.push(issue(file, `$.entries.${encounter.id}.maximumInstancesPerRun`, 'boss encounters require maximumInstancesPerRun 1'));
  }
  const phaseIds = new Set<string>();
  let previousThreshold = 100;
  definition.phases.forEach((phase, index) => {
    if (phaseIds.has(phase.phaseId)) issues.push(issue(file, `${path}.phases.${index}.phaseId`, `duplicate boss phase ${phase.phaseId}`));
    phaseIds.add(phase.phaseId);
    if (phase.healthThresholdPercent >= previousThreshold) {
      issues.push(issue(file, `${path}.phases.${index}.healthThresholdPercent`, 'boss phase thresholds must be unique and strictly descending'));
    }
    previousThreshold = phase.healthThresholdPercent;
    issues.push(...validateParameters(file, `${path}.phases.${index}.behavior`, phase.behaviorId,
      phase.behaviorParameters, BEHAVIOR_PARAMETER_SCHEMAS, 'behavior'));
    phase.effects.forEach((effect, effectIndex) => {
      if (!(BOSS_PHASE_EFFECT_IDS as readonly string[]).includes(effect.effectId)) {
        issues.push(issue(file, `${path}.phases.${index}.effects.${effectIndex}.effectId`,
          `boss phases do not support effect ${effect.effectId}`));
      }
    });
    issues.push(...effectsAtPath(file, `${path}.phases.${index}.effects`, phase.effects, byId));
  });
  return issues;
}

export function encounterEntriesIssues(
  locatedEntries: readonly LocatedContentEntry[],
  byId: ReadonlyMap<string, ContentEntry>,
  vaultTags: ReadonlySet<string>,
): ContentCompileIssue[] {
  const issues: ContentCompileIssue[] = [];
  const encounters = locatedEntries.filter(({ entry }) => entry.kind === 'encounter');
  if (!checkedTotalWithin(encounters.map(({ entry }) => (entry as EncounterContentEntry).weight), MAX_RANDOM_WEIGHT_TOTAL)) {
    const located = encounters.at(-1)!;
    issues.push(issue(located.file, '$.entries', 'encounter weight total exceeds rollDie maximum 2^32'));
  }
  for (const { entry, file } of locatedEntries) {
    if (entry.kind !== 'encounter') continue;
    issues.push(...encounterIssues(file, entry, byId));
    entry.requiredVaultTags.forEach((tag, index) => {
      if (!vaultTags.has(tag)) issues.push(issue(file, `$.entries.${entry.id}.requiredVaultTags.${index}`,
        `unknown vault tag ${tag}`));
    });
    if (entry.model === 'boss') entry.definition.vaultTags.forEach((tag, index) => {
      if (!vaultTags.has(tag)) issues.push(issue(file, `$.entries.${entry.id}.definition.vaultTags.${index}`,
        `unknown vault tag ${tag}`));
    });
  }
  return issues;
}
