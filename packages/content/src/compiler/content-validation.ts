import type {
  BalanceContentEntry, ContentEntry, EffectDefinition, ItemContentEntry, LootTableContentEntry,
  MonsterContentEntry,
} from '../model.js';
import type { ContentCompileIssue } from './error.js';
import { ACTION_COST_IDS, BEHAVIOR_PARAMETER_SCHEMAS, EFFECT_PARAMETER_SCHEMAS } from './registries.js';

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

function identificationIssues(items: readonly LocatedContentEntry[]): ContentCompileIssue[] {
  const issues: ContentCompileIssue[] = [];
  const groups = new Map<string, Array<{ item: ItemContentEntry; file: string }>>();
  for (const located of items) {
    const item = located.entry as ItemContentEntry;
    const path = `$.entries.${item.id}.identification`;
    if (item.identification.mode === 'known') {
      if (item.identification.groupId !== null || item.identification.appearances.length > 0) {
        issues.push(issue(located.file, path, 'known items cannot declare an identification group or appearances'));
      }
      continue;
    }
    if (item.identification.mode === 'shuffled' && item.identification.groupId === null) {
      issues.push(issue(located.file, `${path}.groupId`, 'shuffled identification requires a group ID'));
      continue;
    }
    if (item.identification.mode === 'instance' && item.identification.groupId !== null) {
      issues.push(issue(located.file, `${path}.groupId`, 'instance identification cannot declare a group ID'));
    }
    if (item.identification.appearances.length === 0) {
      issues.push(issue(located.file, `${path}.appearances`, 'unidentified items require at least one appearance'));
    }
    if (item.identification.groupId) {
      const group = groups.get(item.identification.groupId) ?? [];
      group.push({ item, file: located.file });
      groups.set(item.identification.groupId, group);
    }
  }
  for (const [groupId, members] of groups) {
    const categories = new Set(members.map(({ item }) => item.category));
    const pools = new Set(members.map(({ item }) => JSON.stringify(item.identification.appearances)));
    const appearances = members[0]?.item.identification.appearances ?? [];
    const bijective = new Set(appearances).size === appearances.length && appearances.length === members.length;
    if (categories.size === 1 && pools.size === 1 && bijective) continue;
    for (const { item, file } of members) {
      const message = categories.size !== 1 || pools.size !== 1
        ? `identification group ${groupId} must use one category and the same ordered appearance pool`
        : `identification group ${groupId} must form a bijection between ${members.length} items and appearances`;
      issues.push(issue(file, `$.entries.${item.id}.identification`, message));
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
  }
  const itemEntries = locatedEntries.filter(({ entry }) => entry.kind === 'item');
  issues.push(...identificationIssues(itemEntries));
  issues.push(...lootIssues(locatedEntries, byId));
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
