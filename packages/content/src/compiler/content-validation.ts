import type {
  BalanceContentEntry, ContentEntry, EffectDefinition, ItemContentEntry, LootTableContentEntry,
  MonsterContentEntry, IdentificationPoolContentEntry, EncounterContentEntry,
  FallenChampionTemplateContentEntry,
} from '../model.js';
import type { ContentCompileIssue } from './error.js';
import {
  ACTION_COST_IDS, BEHAVIOR_PARAMETER_SCHEMAS, BOSS_PHASE_EFFECT_IDS, EFFECT_PARAMETER_SCHEMAS,
  LEADER_RESPONSE_PARAMETER_SCHEMAS, SWARM_RESPONSE_PARAMETER_SCHEMAS,
} from './registries.js';

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
  schemas: Readonly<Record<string, { safeParse(value: unknown): { success: boolean; error?: { issues: readonly { path: PropertyKey[]; message: string }[] } } }>>,
  label: string,
): ContentCompileIssue[] {
  const schema = schemas[identifier];
  if (!schema) return [issue(file, path, `unregistered ${label} ${identifier}`)];
  const result = schema.safeParse(parameters);
  if (result.success) return [];
  return result.error!.issues.map((problem) => issue(
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

function referencedKindIssue(
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
  const definition = encounter.definition;
  issues.push(...referencedKindIssue(file, `${path}.monsterId`, definition.monsterId, 'monster', byId));
  issues.push(...referencedKindIssue(file, `${path}.uniqueItemId`, definition.uniqueItemId, 'item', byId));
  issues.push(...referencedKindIssue(file, `${path}.enhancedLootTableId`, definition.enhancedLootTableId, 'loot-table', byId));
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
  const graph = new Map<string, string[]>();
  for (const { entry, file } of tables) {
    const edges: string[] = [];
    entry.choices.forEach((choice, index) => {
      const path = `$.entries.${entry.id}.choices.${index}`;
      if ((choice.contentId === null) === (choice.lootTableId === null)) {
        issues.push(issue(file, path, 'loot choice must reference exactly one content item or loot table'));
      }
      if (choice.minimumQuantity > choice.maximumQuantity) {
        issues.push(issue(file, `${path}.maximumQuantity`, 'maximum quantity must be at least minimum quantity'));
      }
      if (choice.contentId !== null && !byId.has(choice.contentId)) {
        issues.push(issue(file, `${path}.contentId`, `unknown content reference ${choice.contentId}`));
      } else if (choice.contentId !== null && byId.get(choice.contentId)?.kind !== 'item') {
        issues.push(issue(file, `${path}.contentId`,
          `content reference ${choice.contentId} resolves to ${byId.get(choice.contentId)!.kind}; expected item`));
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

export function validateContentEntries(locatedEntries: readonly LocatedContentEntry[]): ContentCompileIssue[] {
  const issues: ContentCompileIssue[] = [];
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
    }
    if (entry.kind === 'item') {
      issues.push(...equipmentIssues(file, entry), ...itemCompatibilityIssues(file, entry, allItems),
        ...effectIssues(file, entry.id, entry.effects, byId));
    }
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
