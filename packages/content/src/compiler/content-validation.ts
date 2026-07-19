import type { z } from 'zod';
import type {
  BalanceContentEntry, ContentEntry, EffectDefinition, ItemContentEntry, LootTableContentEntry,
  MonsterContentEntry, IdentificationPoolContentEntry, EncounterContentEntry,
  FallenChampionTemplateContentEntry,
  NpcFactionContentEntry,
  ClassContentEntry, BackgroundContentEntry, ClassKitBackpackItem, EquipmentSlot,
} from '../model.js';
import type { ContentCompileIssue } from './error.js';
import {
  ACTION_COST_IDS, BEHAVIOR_PARAMETER_SCHEMAS, BOSS_PHASE_EFFECT_IDS, EFFECT_PARAMETER_SCHEMAS,
  LEADER_RESPONSE_PARAMETER_SCHEMAS, SWARM_RESPONSE_PARAMETER_SCHEMAS,
  NPC_BEHAVIOR_PARAMETER_SCHEMAS,
} from './registries.js';
import {
  checkedTotalWithin, MAX_ENCOUNTER_MEMBERS, MAX_RANDOM_WEIGHT_TOTAL,
  MAX_SWARM_FLOOR_ACTORS, MAX_SWARM_LIVING_CHILDREN, MAX_SWARM_LIVING_MEMBERS,
  MAX_SWARM_SPAWN_QUANTITY,
} from '../population-limits.js';
import {
  boundedProduct, MAX_LOOT_CHOICE_QUANTITY, MAX_LOOT_CREATED_UNITS, MAX_LOOT_TABLE_ROLLS,
  MAX_LOOT_WEIGHT_TOTAL,
} from '../loot-limits.js';

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export interface LocatedContentEntry {
  readonly entry: ContentEntry;
  readonly file: string;
}

function issue(file: string, path: string, message: string): ContentCompileIssue {
  return { file, path, message };
}

function validateParameters(
  file: string,
  path: string,
  identifier: string,
  parameters: Readonly<Record<string, unknown>>,
  schemas: Readonly<Record<string, z.ZodTypeAny>>,
  label: string,
): ContentCompileIssue[] {
  const schema = schemas[identifier];
  if (!schema) return [issue(file, path, `unregistered ${label} ${identifier}`)];
  const result = schema.safeParse(parameters);
  if (result.success) return [];
  return result.error.issues.map((problem) => issue(
    file,
    `${path}.parameters${problem.path.length > 0 ? `.${problem.path.join('.')}` : ''}`,
    problem.message,
  ));
}

function conditionReferenceIssues(
  file: string,
  path: string,
  effect: EffectDefinition,
  byId: ReadonlyMap<string, ContentEntry>,
): ContentCompileIssue[] {
  if (effect.effectId !== 'effect.condition.apply' && effect.effectId !== 'effect.condition.remove') return [];
  const conditionId = effect.parameters.conditionId;
  const target = typeof conditionId === 'string' ? byId.get(conditionId) : undefined;
  if (!target) return [issue(file, `${path}.parameters.conditionId`, `unknown condition reference ${String(conditionId)}`)];
  if (target.kind !== 'condition') {
    return [issue(file, `${path}.parameters.conditionId`, `condition reference ${conditionId} resolves to ${target.kind}`)];
  }
  if (effect.effectId !== 'effect.condition.apply') return [];
  const duration = effect.parameters.duration;
  if (target.duration.mode === 'permanent' && duration !== undefined) {
    return [issue(file, `${path}.parameters.duration`, 'permanent condition rejects a duration override')];
  }
  if (target.duration.mode === 'timed' && typeof duration === 'number' && duration > target.duration.maximum) {
    return [issue(file, `${path}.parameters.duration`, `duration ${duration} exceeds maximum ${target.duration.maximum}`)];
  }
  return [];
}

function effectIssues(
  file: string,
  entryId: string,
  effects: readonly EffectDefinition[],
  byId: ReadonlyMap<string, ContentEntry>,
): ContentCompileIssue[] {
  return effects.flatMap((effect, index) => {
    const path = `$.entries.${entryId}.effects.${index}`;
    const parameterIssues = validateParameters(
      file, path, effect.effectId, effect.parameters, EFFECT_PARAMETER_SCHEMAS, 'effect',
    );
    return parameterIssues.length > 0
      ? parameterIssues
      : conditionReferenceIssues(file, path, effect, byId);
  });
}

function effectsAtPath(
  file: string,
  path: string,
  effects: readonly EffectDefinition[],
  byId: ReadonlyMap<string, ContentEntry>,
): ContentCompileIssue[] {
  return effects.flatMap((effect, index) => {
    const effectPath = `${path}.${index}`;
    const parameterIssues = validateParameters(
      file, effectPath, effect.effectId, effect.parameters, EFFECT_PARAMETER_SCHEMAS, 'effect',
    );
    return parameterIssues.length > 0
      ? parameterIssues
      : conditionReferenceIssues(file, effectPath, effect, byId);
  });
}

export function referencedKindIssue(
  file: string,
  path: string,
  id: string,
  kind: ContentEntry['kind'],
  byId: ReadonlyMap<string, ContentEntry>,
): ContentCompileIssue[] {
  const target = byId.get(id);
  if (!target) return [issue(file, path, `unknown ${kind} reference ${id}`)];
  if (target.kind !== kind) return [issue(file, path, `${kind} reference ${id} resolves to ${target.kind}`)];
  return [];
}

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

function factionIssues(file: string, faction: NpcFactionContentEntry): ContentCompileIssue[] {
  const path = `$.entries.${faction.id}`;
  const issues: ContentCompileIssue[] = [];
  if (faction.minimumReputation > faction.maximumReputation) issues.push(issue(file, `${path}.minimumReputation`, 'minimum reputation must not exceed maximum reputation'));
  if (faction.startingReputation < faction.minimumReputation || faction.startingReputation > faction.maximumReputation) {
    issues.push(issue(file, `${path}.startingReputation`, 'starting reputation must be within faction bounds'));
  }
  const sorted = faction.tiers.map((tier, authoredIndex) => ({ tier, authoredIndex }))
    .sort((left, right) => left.tier.minimum - right.tier.minimum);
  const tierIds = new Set<string>();
  sorted.forEach(({ tier, authoredIndex }, index) => {
    if (tierIds.has(tier.tierId)) issues.push(issue(file, `${path}.tiers.${authoredIndex}.tierId`, `duplicate reputation tier ${tier.tierId}`));
    tierIds.add(tier.tierId);
    if (new Set(tier.serviceIds).size !== tier.serviceIds.length) {
      issues.push(issue(file, `${path}.tiers.${authoredIndex}.serviceIds`, `duplicate service ID in reputation tier ${tier.tierId}`));
    }
    if (tier.maximum < tier.minimum) issues.push(issue(file, `${path}.tiers.${authoredIndex}.maximum`, 'tier maximum must be at least minimum'));
    if (index === 0 ? tier.minimum !== faction.minimumReputation : tier.minimum !== sorted[index - 1]!.tier.maximum + 1) {
      issues.push(issue(file, `${path}.tiers.${authoredIndex}`, 'reputation tiers must cover every value without gaps or overlaps'));
    }
  });
  if (sorted.at(-1)?.tier.maximum !== faction.maximumReputation) issues.push(issue(file, `${path}.tiers`, 'reputation tiers must cover every value through maximum reputation'));
  return issues;
}

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

function equipmentIssues(file: string, item: ItemContentEntry): ContentCompileIssue[] {
  const equipment = item.equipment;
  if (!equipment) return [];
  const path = `$.entries.${item.id}.equipment`;
  const slots = new Set(equipment.slots);
  const reserved = new Set(equipment.reservedSlots);
  const issues: ContentCompileIssue[] = [];
  if (equipment.handedness === 'one-handed' && !slots.has('main-hand') && !slots.has('off-hand')) {
    issues.push(issue(file, `${path}.handedness`, 'one-handed equipment must fit a hand slot'));
  }
  if (equipment.handedness === 'one-handed' && reserved.size > 0) {
    issues.push(issue(file, `${path}.reservedSlots`, 'one-handed equipment cannot reserve another slot'));
  }
  if (equipment.handedness === 'two-handed') {
    if (!slots.has('main-hand')) issues.push(issue(file, `${path}.slots`, 'two-handed equipment must use the main-hand slot'));
    if (!reserved.has('off-hand')) issues.push(issue(file, `${path}.reservedSlots`, 'two-handed equipment must reserve the off-hand slot'));
  }
  if (equipment.handedness === 'none' && ([...slots].some((slot) => slot.endsWith('hand')) || reserved.size > 0)) {
    issues.push(issue(file, `${path}.handedness`, 'non-handed equipment cannot use or reserve hand slots'));
  }
  for (const slot of slots) {
    if (reserved.has(slot)) issues.push(issue(file, `${path}.reservedSlots`, `slot ${slot} cannot be both equipped and reserved`));
  }
  return issues;
}

function itemCompatibilityIssues(
  file: string,
  item: ItemContentEntry,
  allItems: readonly ItemContentEntry[],
): ContentCompileIssue[] {
  const path = `$.entries.${item.id}`;
  const issues: ContentCompileIssue[] = [];
  if (item.category === 'weapon' && (!item.equipment || !item.combat?.damage)) {
    issues.push(issue(file, `${path}.category`, 'weapon items require equipment and combat damage'));
  }
  if ((item.category === 'armor' || item.category === 'shield')
    && (!item.equipment || !item.combat || item.combat.damage !== null)) {
    issues.push(issue(file, `${path}.category`, `${item.category} items require equipment and non-damaging combat values`));
  }
  if (item.category === 'light' && item.light === null) {
    issues.push(issue(file, `${path}.category`, 'light items require light values'));
  }
  if (item.category === 'ammunition' && (item.equipment !== null || item.light !== null)) {
    issues.push(issue(file, `${path}.category`, 'ammunition cannot be equipped or emit light'));
  }
  const ammunitionTag = item.combat?.ammunitionTag;
  if (ammunitionTag && !allItems.some((candidate) => candidate.category === 'ammunition'
    && candidate.tags.includes(ammunitionTag))) {
    issues.push(issue(file, `${path}.combat.ammunitionTag`,
      `ammunition tag ${ammunitionTag} has no matching ammunition item`));
  }
  if (item.light) {
    let previous = item.light.fuelCapacity + 1;
    item.light.warningThresholds.forEach((threshold, index) => {
      if (threshold >= previous || threshold > item.light!.fuelCapacity) {
        issues.push(issue(file, `${path}.light.warningThresholds.${index}`,
          'light warning thresholds must be unique, descending, and no greater than fuelCapacity'));
      }
      previous = threshold;
    });
  }
  return issues;
}

function identificationIssues(
  items: readonly LocatedContentEntry[],
  pools: readonly LocatedContentEntry[],
  byId: ReadonlyMap<string, ContentEntry>,
): ContentCompileIssue[] {
  const issues: ContentCompileIssue[] = [];
  const usersByPool = new Map<string, Array<{ item: ItemContentEntry; file: string }>>();
  for (const located of pools) {
    const pool = located.entry as IdentificationPoolContentEntry;
    const path = `$.entries.${pool.id}`;
    if (new Set(pool.verbs).size !== pool.verbs.length) {
      issues.push(issue(located.file, `${path}.verbs`, 'identification pool verbs must be unique'));
    }
    if (new Set(pool.nouns).size !== pool.nouns.length) {
      issues.push(issue(located.file, `${path}.nouns`, 'identification pool nouns must be unique'));
    }
    if (new Set(pool.visuals.map((visual) => visual.id)).size !== pool.visuals.length) {
      issues.push(issue(located.file, `${path}.visuals`, 'identification pool visual IDs must be unique'));
    }
  }
  for (const located of items) {
    const item = located.entry as ItemContentEntry;
    const path = `$.entries.${item.id}.identification`;
    if (item.identification.mode === 'known') {
      if (item.identification.poolId !== null) {
        issues.push(issue(located.file, `${path}.poolId`, 'known items cannot declare an identification pool'));
      }
      continue;
    }
    if (item.identification.poolId === null) {
      issues.push(issue(located.file, `${path}.poolId`, 'unidentified items require an identification pool'));
      continue;
    }
    const pool = byId.get(item.identification.poolId);
    if (!pool) {
      issues.push(issue(located.file, `${path}.poolId`, `unknown identification pool ${item.identification.poolId}`));
      continue;
    }
    if (pool.kind !== 'identification-pool') {
      issues.push(issue(located.file, `${path}.poolId`,
        `identification pool reference ${item.identification.poolId} resolves to ${pool.kind}`));
      continue;
    }
    if (pool.category !== item.category) {
      issues.push(issue(located.file, `${path}.poolId`,
        `identification pool ${pool.id} is for ${pool.category}, not ${item.category}`));
    }
    const users = usersByPool.get(pool.id) ?? [];
    users.push({ item, file: located.file });
    usersByPool.set(pool.id, users);
  }
  for (const [poolId, users] of usersByPool) {
    const pool = byId.get(poolId) as IdentificationPoolContentEntry;
    if (pool.verbs.length * pool.nouns.length >= users.length) continue;
    for (const { item, file } of users) {
      issues.push(issue(file, `$.entries.${item.id}.identification.poolId`,
        `identification pool ${poolId} can create ${pool.verbs.length * pool.nouns.length} unique names for ${users.length} items`));
    }
  }
  return issues;
}

function lootIssues(locatedEntries: readonly LocatedContentEntry[], byId: ReadonlyMap<string, ContentEntry>): ContentCompileIssue[] {
  const issues: ContentCompileIssue[] = [];
  const tables = locatedEntries.filter(({ entry }) => entry.kind === 'loot-table') as readonly (LocatedContentEntry & { entry: LootTableContentEntry })[];
  const bossUniqueIds = new Set(locatedEntries.filter(({ entry }) => entry.kind === 'encounter' && entry.model === 'boss')
    .map(({ entry }) => (entry as EncounterContentEntry & { model: 'boss' }).definition.uniqueItemId));
  const graph = new Map<string, string[]>();
  for (const { entry, file } of tables) {
    const edges: string[] = [];
    if (entry.rolls > MAX_LOOT_TABLE_ROLLS) {
      issues.push(issue(file, `$.entries.${entry.id}.rolls`, `loot table rolls exceed runtime-safe limit ${MAX_LOOT_TABLE_ROLLS}`));
    }
    if (!checkedTotalWithin(entry.choices.map((choice) => choice.weight), MAX_LOOT_WEIGHT_TOTAL)) {
      issues.push(issue(file, `$.entries.${entry.id}.choices`, 'loot choice weight total exceeds rollDie maximum 2^32'));
    }
    entry.choices.forEach((choice, index) => {
      const path = `$.entries.${entry.id}.choices.${index}`;
      if ((choice.contentId === null) === (choice.lootTableId === null)) {
        issues.push(issue(file, path, 'loot choice must reference exactly one content item or loot table'));
      }
      if (choice.minimumQuantity > choice.maximumQuantity) {
        issues.push(issue(file, `${path}.maximumQuantity`, 'maximum quantity must be at least minimum quantity'));
      }
      if (choice.minDepth !== undefined && choice.maxDepth !== undefined && choice.minDepth > choice.maxDepth) {
        issues.push(issue(file, `${path}.maxDepth`, 'loot choice maxDepth must be at least minDepth'));
      }
      if (choice.maximumQuantity > MAX_LOOT_CHOICE_QUANTITY) {
        issues.push(issue(file, `${path}.maximumQuantity`,
          `loot choice quantity exceeds runtime-safe limit ${MAX_LOOT_CHOICE_QUANTITY}`));
      }
      if (choice.contentId !== null && !byId.has(choice.contentId)) {
        issues.push(issue(file, `${path}.contentId`, `unknown content reference ${choice.contentId}`));
      } else if (choice.contentId !== null && byId.get(choice.contentId)?.kind !== 'item') {
        issues.push(issue(file, `${path}.contentId`,
          `content reference ${choice.contentId} resolves to ${byId.get(choice.contentId)!.kind}; expected item`));
      }
      const itemTarget = choice.contentId === null ? undefined : byId.get(choice.contentId);
      if (itemTarget?.kind === 'item' && choice.maximumQuantity > itemTarget.stackLimit) {
        issues.push(issue(file, `${path}.maximumQuantity`,
          `loot choice quantity exceeds item stack limit ${itemTarget.stackLimit}`));
      }
      if (choice.contentId !== null && bossUniqueIds.has(choice.contentId)) {
        issues.push(issue(file, `${path}.contentId`,
          `guaranteed boss-unique item ${choice.contentId} cannot appear in ordinary loot`));
      }
      if (choice.lootTableId !== null) {
        edges.push(choice.lootTableId);
        if (byId.get(choice.lootTableId)?.kind !== 'loot-table') {
          issues.push(issue(file, `${path}.lootTableId`, `unknown loot-table reference ${choice.lootTableId}`));
        }
      }
    });
    graph.set(entry.id, edges);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string, trail: readonly string[]): void => {
    if (visiting.has(id)) {
      const located = tables.find(({ entry }) => entry.id === id)!;
      issues.push(issue(located.file, `$.entries.${id}.choices`, `loot-table cycle detected: ${[...trail, id].join(' -> ')}`));
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const next of graph.get(id) ?? []) visit(next, [...trail, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of [...graph.keys()].sort(compareCodeUnits)) visit(id, []);
  const worstMemo = new Map<string, number>();
  const worstUnits = (id: string, trail = new Set<string>()): number => {
    const memoized = worstMemo.get(id);
    if (memoized !== undefined) return memoized;
    if (trail.has(id)) return MAX_LOOT_CREATED_UNITS + 1;
    const table = tables.find(({ entry }) => entry.id === id)?.entry;
    if (!table) return MAX_LOOT_CREATED_UNITS + 1;
    const nextTrail = new Set(trail); nextTrail.add(id);
    let worstChoice = 0;
    for (const choice of table.choices) {
      const child = choice.lootTableId === null ? 1 : worstUnits(choice.lootTableId, nextTrail);
      worstChoice = Math.max(worstChoice,
        boundedProduct(choice.maximumQuantity, child, MAX_LOOT_CREATED_UNITS));
    }
    const result = boundedProduct(table.rolls, worstChoice, MAX_LOOT_CREATED_UNITS);
    worstMemo.set(id, result);
    return result;
  };
  for (const { entry, file } of tables) if (worstUnits(entry.id) > MAX_LOOT_CREATED_UNITS) {
    issues.push(issue(file, `$.entries.${entry.id}`,
      `loot table worst-case created units exceed runtime-safe limit ${MAX_LOOT_CREATED_UNITS}`));
  }
  return issues;
}

function balanceIssues(
  located: LocatedContentEntry & { entry: BalanceContentEntry },
  monsters: readonly (LocatedContentEntry & { entry: MonsterContentEntry })[],
): ContentCompileIssue[] {
  const { entry: balance, file } = located;
  const path = `$.entries.${balance.id}`;
  const issues: ContentCompileIssue[] = [];
  if (balance.speedMinimum > balance.speedMaximum) {
    issues.push(issue(file, `${path}.speedMinimum`, 'speedMinimum must not exceed speedMaximum'));
  }
  if (balance.energyMinimum > balance.energyMaximum) {
    issues.push(issue(file, `${path}.energyMinimum`, 'energyMinimum must not exceed energyMaximum'));
  }
  if (balance.attributeMinimum > balance.attributeMaximum) {
    issues.push(issue(file, `${path}.attributeMinimum`, 'attributeMinimum must not exceed attributeMaximum'));
  }
  if (balance.readinessThreshold < balance.energyMinimum || balance.readinessThreshold > balance.energyMaximum) {
    issues.push(issue(file, `${path}.readinessThreshold`, 'readinessThreshold must be within the energy bounds'));
  }
  const registeredCosts = new Set<string>(ACTION_COST_IDS);
  for (const actionId of Object.keys(balance.actionCosts).sort(compareCodeUnits)) {
    if (!registeredCosts.has(actionId)) {
      issues.push(issue(file, `${path}.actionCosts.${actionId}`, `unregistered action cost ${actionId}`));
    }
  }
  for (const monster of monsters) {
    if (monster.entry.speed < balance.speedMinimum || monster.entry.speed > balance.speedMaximum) {
      issues.push(issue(monster.file, `$.entries.${monster.entry.id}.speed`,
        `speed ${monster.entry.speed} is outside balance bounds ${balance.speedMinimum} through ${balance.speedMaximum}`));
    }
    for (const [name, value] of Object.entries(monster.entry.attributes).sort(([left], [right]) => compareCodeUnits(left, right))) {
      if (value < balance.attributeMinimum || value > balance.attributeMaximum) {
        issues.push(issue(monster.file, `$.entries.${monster.entry.id}.attributes.${name}`,
          `attribute ${value} is outside balance bounds ${balance.attributeMinimum} through ${balance.attributeMaximum}`));
      }
    }
  }
  return issues;
}

function achievementIssues(locatedEntries: readonly LocatedContentEntry[]): ContentCompileIssue[] {
  const issues: ContentCompileIssue[] = [];
  const firstByCriteria = new Map<string, string>();
  for (const { entry, file } of locatedEntries) {
    if (entry.kind !== 'achievement') continue;
    const first = firstByCriteria.get(entry.criteriaId);
    if (first === undefined) {
      firstByCriteria.set(entry.criteriaId, entry.id);
      continue;
    }
    issues.push(issue(file, `$.entries.${entry.id}.criteriaId`,
      `at most one achievement per criterion; ${entry.criteriaId} is already claimed by ${first}`));
  }
  return issues;
}

function backpackItemIssues(
  file: string,
  path: string,
  items: readonly ClassKitBackpackItem[],
  byId: ReadonlyMap<string, ContentEntry>,
): ContentCompileIssue[] {
  return items.flatMap((backpackItem, index) => {
    const target = byId.get(backpackItem.contentId);
    if (!target) return [issue(file, `${path}.${index}.contentId`, `unknown item reference ${backpackItem.contentId}`)];
    if (target.kind !== 'item') {
      return [issue(file, `${path}.${index}.contentId`, `item reference ${backpackItem.contentId} resolves to ${target.kind}`)];
    }
    return [];
  });
}

function classIssues(
  located: LocatedContentEntry & { entry: ClassContentEntry },
  byId: ReadonlyMap<string, ContentEntry>,
): ContentCompileIssue[] {
  const { entry: cls, file } = located;
  const path = `$.entries.${cls.id}`;
  const issues: ContentCompileIssue[] = [];
  if (cls.playable && cls.kits.length < 2) {
    issues.push(issue(file, `${path}.kits`, 'a playable class requires at least 2 kits'));
  }
  cls.kits.forEach((kit, kitIndex) => {
    const kitPath = `${path}.kits.${kitIndex}`;
    const occupants: { index: number; slot: EquipmentSlot; occupiedSlots: readonly EquipmentSlot[] }[] = [];
    kit.equipped.forEach((equipped, index) => {
      const equippedPath = `${kitPath}.equipped.${index}`;
      const target = byId.get(equipped.contentId);
      if (!target) {
        issues.push(issue(file, `${equippedPath}.contentId`, `unknown item reference ${equipped.contentId}`));
        return;
      }
      if (target.kind !== 'item') {
        issues.push(issue(file, `${equippedPath}.contentId`, `item reference ${equipped.contentId} resolves to ${target.kind}`));
        return;
      }
      if (!target.equipment) {
        issues.push(issue(file, `${equippedPath}.slot`, `item ${equipped.contentId} cannot be equipped in any slot`));
        return;
      }
      if (!target.equipment.slots.includes(equipped.slot)) {
        issues.push(issue(file, `${equippedPath}.slot`,
          `item ${equipped.contentId} cannot be equipped in slot ${equipped.slot}`));
        return;
      }
      if (equipped.enabled !== undefined && !target.light) {
        issues.push(issue(file, `${equippedPath}.enabled`,
          `kit ${kit.kitId} sets enabled on non-light item ${equipped.contentId}`));
      }
      occupants.push({
        index,
        slot: equipped.slot,
        occupiedSlots: [equipped.slot, ...target.equipment.reservedSlots],
      });
    });
    for (let left = 0; left < occupants.length; left += 1) {
      for (let right = left + 1; right < occupants.length; right += 1) {
        const a = occupants[left]!;
        const b = occupants[right]!;
        const collision = a.occupiedSlots.find((slot) => b.occupiedSlots.includes(slot));
        if (collision) {
          issues.push(issue(file, `${kitPath}.equipped.${b.index}.slot`,
            `kit ${kit.kitId} reserved slot ${collision} conflicts between equipped.${a.index} and equipped.${b.index}`));
        }
      }
    }
    issues.push(...backpackItemIssues(file, `${kitPath}.backpack`, kit.backpack, byId));
  });
  return issues;
}

function backgroundIssues(
  located: LocatedContentEntry & { entry: BackgroundContentEntry },
  byId: ReadonlyMap<string, ContentEntry>,
): ContentCompileIssue[] {
  const { entry: background, file } = located;
  const path = `$.entries.${background.id}`;
  return backpackItemIssues(file, `${path}.extraItems`, background.extraItems, byId);
}

export function validateContentEntries(locatedEntries: readonly LocatedContentEntry[]): ContentCompileIssue[] {
  const issues: ContentCompileIssue[] = [];
  issues.push(...achievementIssues(locatedEntries));
  const encounters = locatedEntries.filter(({ entry }) => entry.kind === 'encounter');
  if (!checkedTotalWithin(encounters.map(({ entry }) => (entry as EncounterContentEntry).weight), MAX_RANDOM_WEIGHT_TOTAL)) {
    const located = encounters.at(-1)!;
    issues.push(issue(located.file, '$.entries', 'encounter weight total exceeds rollDie maximum 2^32'));
  }
  const byId = new Map(locatedEntries.map(({ entry }) => [entry.id, entry]));
  const vaultTags = new Set<string>();
  for (const { entry } of locatedEntries) {
    if (entry.kind !== 'vault') continue;
    entry.tags.forEach((tag) => vaultTags.add(tag));
    Object.values(entry.legend).forEach((legend) => legend.slot?.tags.forEach((tag) => vaultTags.add(tag)));
  }
  const allItems = locatedEntries.filter(({ entry }) => entry.kind === 'item')
    .map(({ entry }) => entry as ItemContentEntry);
  for (const { entry, file } of locatedEntries) {
    if (entry.kind === 'monster') {
      issues.push(...validateParameters(file, `$.entries.${entry.id}.behavior`, entry.behaviorId, entry.behaviorParameters, BEHAVIOR_PARAMETER_SCHEMAS, 'behavior'));
      if (entry.lootTableId !== null) {
        issues.push(...referencedKindIssue(file, `$.entries.${entry.id}.lootTableId`, entry.lootTableId, 'loot-table', byId));
      }
    }
    if (entry.kind === 'npc') {
      issues.push(...referencedKindIssue(file, `$.entries.${entry.id}.factionId`, entry.factionId, 'npc-faction', byId));
      issues.push(...validateParameters(file, `$.entries.${entry.id}.behavior`, entry.behaviorId,
        entry.behaviorParameters, NPC_BEHAVIOR_PARAMETER_SCHEMAS, 'NPC behavior'));
    }
    if (entry.kind === 'npc-faction') issues.push(...factionIssues(file, entry));
    if (entry.kind === 'item') {
      issues.push(...equipmentIssues(file, entry), ...itemCompatibilityIssues(file, entry, allItems),
        ...effectIssues(file, entry.id, entry.effects, byId));
    }
    if (entry.kind === 'class') issues.push(...classIssues({ entry, file }, byId));
    if (entry.kind === 'background') issues.push(...backgroundIssues({ entry, file }, byId));
    if (entry.kind === 'spell' || entry.kind === 'trap') issues.push(...effectIssues(file, entry.id, entry.effects, byId));
    if (entry.kind === 'encounter') issues.push(...encounterIssues(file, entry, byId));
    if (entry.kind === 'encounter') {
      entry.requiredVaultTags.forEach((tag, index) => {
        if (!vaultTags.has(tag)) issues.push(issue(file, `$.entries.${entry.id}.requiredVaultTags.${index}`,
          `unknown vault tag ${tag}`));
      });
      if (entry.model === 'boss') entry.definition.vaultTags.forEach((tag, index) => {
        if (!vaultTags.has(tag)) issues.push(issue(file, `$.entries.${entry.id}.definition.vaultTags.${index}`,
          `unknown vault tag ${tag}`));
      });
    }
  }
  const itemEntries = locatedEntries.filter(({ entry }) => entry.kind === 'item');
  const poolEntries = locatedEntries.filter(({ entry }) => entry.kind === 'identification-pool');
  issues.push(...identificationIssues(itemEntries, poolEntries, byId));
  issues.push(...lootIssues(locatedEntries, byId));
  const championTemplates = locatedEntries.filter((located): located is LocatedContentEntry & { entry: FallenChampionTemplateContentEntry } =>
    located.entry.kind === 'fallen-champion-template');
  issues.push(...championTemplateIssues(championTemplates, byId));
  const balanceEntries = locatedEntries.filter(({ entry }) => entry.kind === 'balance');
  if (balanceEntries.length > 1) {
    issues.push(issue(balanceEntries[1]!.file, '$.entries', `expected exactly one balance entry; found ${balanceEntries.length}`));
  }
  if (balanceEntries.length === 1) {
    const monsters = locatedEntries.filter((located): located is LocatedContentEntry & { entry: MonsterContentEntry } =>
      located.entry.kind === 'monster');
    issues.push(...balanceIssues(balanceEntries[0] as LocatedContentEntry & { entry: BalanceContentEntry }, monsters));
  }
  return issues.sort((left, right) => compareCodeUnits(left.file, right.file)
    || compareCodeUnits(left.path, right.path)
    || compareCodeUnits(left.message, right.message));
}
