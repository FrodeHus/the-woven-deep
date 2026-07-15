import { z } from 'zod';
import { CONDITION_TRAIT_IDS, CONTENT_SCHEMA_VERSION, DERIVED_STAT_NAMES } from '../model.js';

export const stableIdSchema = z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/);
export const slugSchema = z.string().regex(/^[a-z][a-z0-9-]*$/);
const glyph = z.string().refine((value) => [...value].length === 1, 'must be one Unicode glyph');
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const safeInteger = z.number().int().safe();
const safeNonNegative = safeInteger.nonnegative();
const safePositive = safeInteger.positive();
const probability = z.number().finite().min(0).max(1);
const jsonObject = z.record(z.string(), z.json());
const tags = z.array(slugSchema).default([]);

export const damageTypes = ['physical', 'fire', 'cold', 'lightning', 'poison', 'arcane'] as const;
export const targetingIds = ['target.self', 'target.actor', 'target.line', 'target.cell'] as const;
export const equipmentSlots = ['main-hand', 'off-hand', 'body', 'head', 'hands', 'feet', 'neck', 'left-ring', 'right-ring'] as const;
export const vaultPlacementKinds = ['monster', 'item', 'trap', 'npc', 'fixture', 'objective'] as const;
export const encounterModels = ['individual', 'group', 'swarm', 'boss', 'merchant'] as const;
export const encounterFormations = ['cluster', 'line', 'screen', 'wedge', 'surround'] as const;
export const formationPreferences = ['front', 'center', 'rear', 'flank', 'free'] as const;
export const leaderDeathResponses = ['weaken', 'panic', 'disband', 'surrender', 'frenzy', 'collapse'] as const;
export const swarmDestructionResponses = ['stop', 'flee', 'decay', 'frenzy'] as const;

export const diceSchema = z.strictObject({
  count: safePositive.max(100),
  sides: safePositive.max(10_000),
  bonus: safeInteger,
});

const attributes = z.strictObject({
  might: safeNonNegative,
  agility: safeNonNegative,
  vitality: safeNonNegative,
  wits: safeNonNegative,
  resolve: safeNonNegative,
});
const positiveAttributes = z.strictObject({
  might: safePositive, agility: safePositive, vitality: safePositive, wits: safePositive, resolve: safePositive,
});

const resistances = z.strictObject({
  physical: safeInteger.min(-100).max(100),
  fire: safeInteger.min(-100).max(100),
  cold: safeInteger.min(-100).max(100),
  lightning: safeInteger.min(-100).max(100),
  poison: safeInteger.min(-100).max(100),
  arcane: safeInteger.min(-100).max(100),
});

const effect = z.strictObject({
  effectId: stableIdSchema,
  parameters: jsonObject.default({}),
  requiresLivingTarget: z.boolean().default(false),
});

const base = {
  id: stableIdSchema,
  name: z.string().trim().min(1).max(80),
  tags,
} as const;

const presented = {
  ...base,
  glyph,
  color,
} as const;

const depthRange = {
  minDepth: safePositive,
  maxDepth: safePositive,
} as const;

const monsterEntry = z.strictObject({
  ...presented,
  ...depthRange,
  kind: z.literal('monster'),
  attributes,
  health: safePositive,
  speed: safePositive,
  accuracy: safeInteger,
  defense: safeInteger,
  perception: safeNonNegative,
  damage: diceSchema,
  armor: safeNonNegative,
  resistances,
  disposition: z.enum(['friendly', 'neutral', 'hostile']),
  behaviorId: stableIdSchema,
  behaviorParameters: jsonObject.default({}),
  rarity: z.enum(['common', 'uncommon', 'rare', 'legendary']),
}).superRefine((entry, context) => {
  if (entry.maxDepth < entry.minDepth) context.addIssue({ code: 'custom', path: ['maxDepth'], message: 'maximum depth must be greater than or equal to minimum depth' });
});

const equipment = z.strictObject({
  slots: z.array(z.enum(equipmentSlots)).min(1),
  handedness: z.enum(['one-handed', 'two-handed', 'none']),
  reservedSlots: z.array(z.enum(equipmentSlots)),
});

const combat = z.strictObject({
  accuracy: safeInteger,
  defense: safeInteger,
  armor: safeNonNegative,
  damage: diceSchema.nullable(),
  range: safeNonNegative,
  ammunitionTag: slugSchema.nullable(),
});

const rgb = z.tuple([
  z.number().int().min(0).max(255),
  z.number().int().min(0).max(255),
  z.number().int().min(0).max(255),
]);

const itemLight = z.strictObject({
  color: rgb,
  radius: safePositive.max(32),
  strength: safePositive.max(255),
  fuelCapacity: safePositive,
  fuelPerTime: safePositive,
  warningThresholds: z.array(safeNonNegative),
  fuelTags: z.array(slugSchema),
});

const identification = z.strictObject({
  mode: z.enum(['known', 'shuffled', 'instance']),
  poolId: stableIdSchema.nullable(),
});

const identificationPoolEntry = z.strictObject({
  ...base,
  kind: z.literal('identification-pool'),
  category: z.enum(['weapon', 'ammunition', 'armor', 'shield', 'light', 'fuel', 'food', 'potion', 'scroll', 'ring', 'misc']),
  verbs: z.array(z.string().trim().min(1).max(40)).min(1),
  nouns: z.array(z.string().trim().min(1).max(40)).min(1),
  visuals: z.array(z.strictObject({
    id: stableIdSchema,
    glyph,
    color,
  })).min(1),
});

const itemEntry = z.strictObject({
  ...presented,
  ...depthRange,
  kind: z.literal('item'),
  category: z.enum(['weapon', 'ammunition', 'armor', 'shield', 'light', 'fuel', 'food', 'potion', 'scroll', 'ring', 'misc']),
  stackLimit: safePositive,
  price: safeNonNegative,
  rarity: z.enum(['common', 'uncommon', 'rare', 'legendary']),
  heirloomEligible: z.boolean().default(true),
  actionCost: safeNonNegative,
  equipment: equipment.nullable(),
  combat: combat.nullable(),
  light: itemLight.nullable(),
  identification,
  effects: z.array(effect),
});

const spellEntry = z.strictObject({
  ...base,
  kind: z.literal('spell'),
  targetingId: z.enum(targetingIds),
  range: safeNonNegative,
  actionCost: safePositive,
  effects: z.array(effect).min(1),
});

const trapEntry = z.strictObject({
  ...presented,
  kind: z.literal('trap'),
  targetingId: z.enum(targetingIds),
  discoveryDifficulty: safeNonNegative,
  disarmDifficulty: safeNonNegative,
  disarmOutcomes: z.strictObject({
    failure: z.enum(['safe', 'tool-damage', 'trigger']),
    criticalFailure: z.enum(['safe', 'tool-damage', 'trigger']),
    toolDamage: safePositive,
  }),
  resetMode: z.enum(['once', 'reset', 'disabled']),
  effects: z.array(effect).min(1),
});

const lootChoice = z.strictObject({
  contentId: stableIdSchema.nullable(),
  lootTableId: stableIdSchema.nullable(),
  weight: safePositive,
  minimumQuantity: safePositive,
  maximumQuantity: safePositive,
});

const lootTableEntry = z.strictObject({
  ...base,
  kind: z.literal('loot-table'),
  rolls: safePositive,
  choices: z.array(lootChoice).min(1),
});

const balanceEntry = z.strictObject({
  ...base,
  kind: z.literal('balance'),
  startingCurrency: safeNonNegative,
  readinessThreshold: safePositive,
  normalActionCost: safePositive,
  speedMinimum: safePositive,
  speedMaximum: safePositive,
  energyMinimum: safeInteger,
  energyMaximum: safeInteger,
  attributeMinimum: safeNonNegative,
  attributeMaximum: safeNonNegative,
  hungerMaximum: safePositive,
  hungerThresholds: z.strictObject({ hungry: safeNonNegative, weak: safeNonNegative, starving: safeNonNegative }),
  starvationInterval: safePositive,
  starvationDamage: safePositive,
  recoveryInterval: safePositive,
  recoveryAmount: safeNonNegative,
  restMaximumDuration: safePositive,
  recoveryByHungerStage: z.strictObject({
    sated: safeNonNegative.max(100), hungry: safeNonNegative.max(100),
    weak: safeNonNegative.max(100), starving: safeNonNegative.max(100),
  }),
  hungerStageModifiers: z.strictObject({
    sated: z.partialRecord(z.enum(DERIVED_STAT_NAMES), safeInteger),
    hungry: z.partialRecord(z.enum(DERIVED_STAT_NAMES), safeInteger),
    weak: z.partialRecord(z.enum(DERIVED_STAT_NAMES), safeInteger),
    starving: z.partialRecord(z.enum(DERIVED_STAT_NAMES), safeInteger),
  }),
  formulas: z.record(z.string(), z.record(z.string(), safeInteger)),
  actionCosts: z.record(stableIdSchema, safeNonNegative),
}).superRefine((entry, context) => {
  const { starving, weak, hungry } = entry.hungerThresholds;
  if (!(starving <= weak && weak <= hungry && hungry < entry.hungerMaximum)) {
    context.addIssue({ code: 'custom', path: ['hungerThresholds'],
      message: 'hunger thresholds must satisfy starving <= weak <= hungry < hungerMaximum' });
  }
});

const conditionDuration = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('timed'), default: safePositive, maximum: safePositive })
    .refine((value) => value.default <= value.maximum, {
      path: ['default'], message: 'default duration must not exceed maximum duration',
    }),
  z.strictObject({ mode: z.literal('permanent'), default: z.null(), maximum: z.null() }),
]);

const conditionEntry = z.strictObject({
  ...base,
  kind: z.literal('condition'),
  description: z.string().trim().min(1).max(500),
  color,
  duration: conditionDuration,
  stacking: z.strictObject({
    mode: z.enum(['replace', 'refresh', 'intensify']),
    maximumStacks: safePositive.max(100),
  }),
  modifiersPerStack: z.partialRecord(z.enum(DERIVED_STAT_NAMES), safeInteger).default({}),
  traits: z.array(z.enum(CONDITION_TRAIT_IDS)).default([]),
}).superRefine((entry, context) => {
  if (entry.stacking.mode !== 'intensify' && entry.stacking.maximumStacks !== 1) {
    context.addIssue({
      code: 'custom', path: ['stacking', 'maximumStacks'],
      message: 'replace and refresh conditions require maximumStacks 1',
    });
  }
  for (let index = 1; index < entry.traits.length; index += 1) {
    if (entry.traits[index - 1]! >= entry.traits[index]!) {
      context.addIssue({
        code: 'custom', path: ['traits', index],
        message: 'condition traits must be unique and sorted',
      });
      break;
    }
  }
});

const slot = z.strictObject({
  id: slugSchema,
  kind: z.enum(vaultPlacementKinds),
  required: z.boolean().default(false),
  tags,
});
const light = z.strictObject({
  idSuffix: slugSchema,
  glyph,
  presentationToken: stableIdSchema,
  color: rgb,
  radius: safePositive.max(32),
  strength: safePositive.max(255),
  enabled: z.boolean().default(true),
});
const legendEntry = z.strictObject({
  terrain: z.enum(['wall', 'floor', 'closed-door', 'pillar', 'stair-up', 'stair-down', 'void']),
  entrance: z.boolean().default(false),
  light: light.nullable().default(null),
  slot: slot.nullable().default(null),
}).superRefine((entry, context) => {
  const actionCount = Number(entry.entrance) + Number(entry.light !== null) + Number(entry.slot !== null);
  if (actionCount > 1) context.addIssue({ code: 'custom', path: [], message: 'legend entry may declare at most one entrance, light, or slot action' });
});
const rotations = z.array(z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]))
  .min(1).max(4).superRefine((values, context) => {
    for (let index = 1; index < values.length; index += 1) {
      if (values[index - 1]! >= values[index]!) {
        context.addIssue({ code: 'custom', path: [index], message: 'rotations must be unique and sorted in numeric order' });
        return;
      }
    }
  });
const layoutRow = z.string().min(1).refine((value) => [...value].length <= 160, 'layout row exceeds 160 code points');
const vaultEntry = z.strictObject({
  ...base,
  ...depthRange,
  kind: z.literal('vault'),
  rarity: z.enum(['common', 'uncommon', 'rare', 'legendary']),
  weight: safePositive,
  maxPerFloor: safePositive,
  margin: safeNonNegative,
  transforms: z.strictObject({ rotations, reflectHorizontal: z.boolean().default(false) }),
  layout: z.array(layoutRow).min(1).max(100),
  legend: z.record(z.string(), legendEntry),
}).superRefine((entry, context) => {
  if (entry.maxDepth < entry.minDepth) context.addIssue({ code: 'custom', path: ['maxDepth'], message: 'maximum depth must be greater than or equal to minimum depth' });
});

const populationModifiers = z.strictObject({
  accuracy: safeInteger,
  defense: safeInteger,
  damage: safeInteger,
});

const encounterPlacement = z.strictObject({
  minimumStairDistance: safeNonNegative,
  minimumObjectiveDistance: safeNonNegative,
  maximumMemberDistance: safeNonNegative,
  allowedTerrainTags: z.array(slugSchema).min(1),
  requiresVaultSlot: z.boolean(),
  failureMode: z.enum(['optional', 'required']),
});

const encounterIntentPresentation = z.strictObject({ visible: z.boolean() });

const encounterCommon = {
  ...base,
  ...depthRange,
  kind: z.literal('encounter'),
  adminDescription: z.string().trim().min(1).max(500).nullable().default(null),
  environmentTags: z.array(slugSchema),
  requiredVaultTags: z.array(slugSchema),
  weight: safePositive,
  rarity: z.enum(['common', 'uncommon', 'rare', 'legendary']),
  runAppearanceChance: probability,
  discoveryProtectionIncrement: probability.optional(),
  discoveryProtectionCap: probability.optional(),
  maximumInstancesPerRun: safePositive,
  placement: encounterPlacement,
  intentPresentation: encounterIntentPresentation,
} as const;

const quantityRange = {
  minimumQuantity: safePositive,
  maximumQuantity: safePositive,
} as const;

const individualEncounterEntry = z.strictObject({
  ...encounterCommon,
  model: z.literal('individual'),
  definition: z.strictObject({
    monsterId: stableIdSchema,
    ...quantityRange,
  }),
});

const groupEncounterEntry = z.strictObject({
  ...encounterCommon,
  model: z.literal('group'),
  definition: z.strictObject({
    roles: z.array(z.strictObject({
      roleId: slugSchema,
      monsterId: stableIdSchema,
      ...quantityRange,
      formationPreference: z.enum(formationPreferences),
      behaviorParameters: jsonObject.default({}),
    })).min(1),
    formation: z.enum(encounterFormations),
    communicationRadius: safePositive,
    leaderChance: probability,
    leaderRoleId: slugSchema,
    leaderAccentColor: color,
    leaderAlternateGlyph: glyph.nullable(),
    coordinationModifiers: populationModifiers,
    leaderDeathResponse: z.enum(leaderDeathResponses),
    responseParameters: jsonObject.default({}),
    supernaturalBond: z.boolean(),
    collapseRewards: z.enum(['none', 'individual']),
  }),
});

const swarmEncounterEntry = z.strictObject({
  ...encounterCommon,
  model: z.literal('swarm'),
  definition: z.strictObject({
    sourceMonsterId: stableIdSchema,
    spawnRoles: z.array(z.strictObject({
      roleId: slugSchema,
      monsterId: stableIdSchema,
      weight: safePositive,
    })).min(1),
    spawnInterval: safePositive,
    minimumSpawnQuantity: safePositive,
    maximumSpawnQuantity: safePositive,
    placementRadius: safePositive,
    allowedTerrainTags: z.array(slugSchema).min(1),
    maximumLivingChildren: safePositive,
    maximumLivingMembers: safePositive,
    maximumFloorActors: safePositive,
    sourceDestructionResponse: z.enum(swarmDestructionResponses),
    responseParameters: jsonObject.default({}),
  }),
});

const bossEncounterEntry = z.strictObject({
  ...encounterCommon,
  model: z.literal('boss'),
  definition: z.strictObject({
    monsterId: stableIdSchema,
    phases: z.array(z.strictObject({
      phaseId: slugSchema,
      healthThresholdPercent: safePositive.max(99),
      behaviorId: stableIdSchema,
      behaviorParameters: jsonObject.default({}),
      modifiers: populationModifiers,
      effects: z.array(effect),
    })),
    recoveryPerWorldTime: z.number().finite().nonnegative(),
    recoveryCapPercent: safeNonNegative.max(100),
    uniqueItemId: stableIdSchema,
    enhancedLootTableId: stableIdSchema,
    vaultTags: z.array(slugSchema),
  }),
});

const merchantService = z.strictObject({
  serviceId: z.literal('merchant-service.identify'), basePrice: safeNonNegative,
  minimumUses: safeNonNegative, maximumUses: safeNonNegative, tierIds: z.array(slugSchema).min(1),
});
const merchantEncounterDefinition = z.strictObject({
  npcId: stableIdSchema, stockLootTableId: stableIdSchema,
  minimumStockRolls: safePositive, maximumStockRolls: safePositive,
  merchantSaleBps: safePositive, merchantPurchaseBps: safePositive,
  acceptedCategories: z.array(z.enum(['weapon', 'ammunition', 'armor', 'shield', 'light', 'fuel', 'food', 'potion', 'scroll', 'ring', 'misc'])).min(1),
  services: z.array(merchantService), minimumLifetime: safePositive, maximumLifetime: safePositive,
  departureWarningThresholds: z.array(safePositive), aggressionResponse: z.enum(['flee', 'self-defense']),
  commerceReputationDelta: safeInteger, aggressionReputationDelta: safeInteger,
  deathReputationDelta: safeInteger, stockDropFraction: probability,
});

const encounterEntry = z.strictObject({
  ...encounterCommon,
  model: z.enum(encounterModels),
  definition: z.union([
    individualEncounterEntry.shape.definition,
    groupEncounterEntry.shape.definition,
    swarmEncounterEntry.shape.definition,
    bossEncounterEntry.shape.definition,
    merchantEncounterDefinition,
  ]),
}).superRefine((entry, context) => {
  if (entry.maxDepth < entry.minDepth) {
    context.addIssue({ code: 'custom', path: ['maxDepth'], message: 'maximum depth must be greater than or equal to minimum depth' });
  }
  if (entry.model !== 'merchant' && entry.discoveryProtectionIncrement === undefined) {
    context.addIssue({ code: 'custom', path: ['discoveryProtectionIncrement'], message: 'Invalid input: expected number, received undefined' });
  }
  if (entry.model !== 'merchant' && entry.discoveryProtectionCap === undefined) {
    context.addIssue({ code: 'custom', path: ['discoveryProtectionCap'], message: 'Invalid input: expected number, received undefined' });
  }
  if (entry.model !== 'merchant' && entry.discoveryProtectionCap !== undefined
    && entry.discoveryProtectionCap < entry.runAppearanceChance) {
    context.addIssue({ code: 'custom', path: ['discoveryProtectionCap'], message: 'discovery protection cap must not be below run appearance chance' });
  }
  const definition = entry.definition;
  const matchesModel = (entry.model === 'individual' && 'monsterId' in definition && 'minimumQuantity' in definition)
    || (entry.model === 'group' && 'roles' in definition)
    || (entry.model === 'swarm' && 'sourceMonsterId' in definition)
    || (entry.model === 'boss' && 'phases' in definition)
    || (entry.model === 'merchant' && 'npcId' in definition);
  if (!matchesModel) {
    context.addIssue({ code: 'custom', path: ['definition'], message: `definition does not match encounter model ${entry.model}` });
    return;
  }
  if ('minimumQuantity' in definition && definition.maximumQuantity < definition.minimumQuantity) {
    context.addIssue({ code: 'custom', path: ['definition', 'maximumQuantity'], message: 'maximum quantity must be at least minimum quantity' });
  }
  if (entry.model === 'group' && 'roles' in definition) {
    for (let index = 0; index < definition.roles.length; index += 1) {
      const role = definition.roles[index]!;
      if (role.maximumQuantity < role.minimumQuantity) {
        context.addIssue({ code: 'custom', path: ['definition', 'roles', index, 'maximumQuantity'], message: 'maximum quantity must be at least minimum quantity' });
      }
    }
  }
  if (entry.model === 'swarm' && 'maximumSpawnQuantity' in definition
    && definition.maximumSpawnQuantity < definition.minimumSpawnQuantity) {
    context.addIssue({ code: 'custom', path: ['definition', 'maximumSpawnQuantity'], message: 'maximum spawn quantity must be at least minimum spawn quantity' });
  }
});

const reputationTier = z.strictObject({
  tierId: slugSchema, name: z.string().trim().min(1).max(80), minimum: safeInteger, maximum: safeInteger,
  purchasePriceBps: safePositive, salePriceBps: safePositive, acceptsTrade: z.boolean(),
  serviceIds: z.array(z.literal('merchant-service.identify')),
});
const npcFactionEntry = z.strictObject({
  ...base, kind: z.literal('npc-faction'), minimumReputation: safeInteger, maximumReputation: safeInteger,
  startingReputation: safeInteger, tiers: z.array(reputationTier).min(1),
});
const npcEntry = z.strictObject({
  ...presented, kind: z.literal('npc'), factionId: stableIdSchema, attributes: positiveAttributes,
  health: safePositive, speed: safePositive, perception: safePositive, accuracy: safePositive,
  defense: safePositive, damage: diceSchema, armor: safeNonNegative, resistances,
  disposition: z.literal('neutral'), behaviorId: z.literal('npc-behavior.travelling-merchant'),
  behaviorParameters: jsonObject.default({}), selfPreservationThresholdBps: safePositive.max(10_000),
});

const fallenChampionTemplateEntry = z.strictObject({
  ...base,
  kind: z.literal('fallen-champion-template'),
  fallbackMonsterId: stableIdSchema,
  fallbackItemId: stableIdSchema,
  minimumHealth: safePositive,
  maximumHealth: safePositive,
  attributeMaximum: safePositive,
  damageMaximum: safePositive,
  abilityLimit: safeNonNegative,
  echoAppearanceChance: probability,
  maximumEchoesPerRun: safePositive.max(9),
  echoHealthPercent: safePositive.max(99),
  echoDamagePercent: safePositive.max(99),
  echoDefensePercent: safePositive.max(99),
  echoAbilityLimit: safeNonNegative,
  echoLootTableId: stableIdSchema,
  heirloomSelection: z.strictObject({
    rarityWeights: z.strictObject({
      common: safePositive,
      uncommon: safePositive,
      rare: safePositive,
      legendary: safePositive,
    }),
    qualityRankBonus: safeNonNegative,
  }),
}).superRefine((entry, context) => {
  if (entry.maximumHealth < entry.minimumHealth) {
    context.addIssue({ code: 'custom', path: ['maximumHealth'], message: 'maximum health must be at least minimum health' });
  }
  if (entry.echoAppearanceChance > 0 && entry.echoAbilityLimit >= entry.abilityLimit) {
    context.addIssue({ code: 'custom', path: ['echoAbilityLimit'], message: 'Echo ability limit must be strictly below Champion ability limit' });
  }
  const weights = entry.heirloomSelection.rarityWeights;
  if (!(weights.common <= weights.uncommon && weights.uncommon <= weights.rare && weights.rare <= weights.legendary)) {
    context.addIssue({ code: 'custom', path: ['heirloomSelection', 'rarityWeights'], message: 'rarity weights must be nondecreasing from common through legendary' });
  }
});

export const contentSourceEntrySchema = z.discriminatedUnion('kind', [
  monsterEntry,
  itemEntry,
  spellEntry,
  trapEntry,
  lootTableEntry,
  balanceEntry,
  vaultEntry,
  conditionEntry,
  identificationPoolEntry,
  encounterEntry,
  fallenChampionTemplateEntry,
  npcEntry,
  npcFactionEntry,
]);

export const contentEntrySchema = contentSourceEntrySchema.transform((entry) => {
  if (entry.kind === 'encounter') return {
    ...entry,
    discoveryProtectionIncrement: entry.discoveryProtectionIncrement ?? 0,
    discoveryProtectionCap: entry.discoveryProtectionCap ?? 0,
  };
  if (entry.kind !== 'vault') return entry;
  let entranceCount = 0;
  const requiredSlotIds = new Set<string>();
  for (const row of entry.layout) {
    for (const symbol of row) {
      const legend = entry.legend[symbol];
      if (legend?.entrance) entranceCount += 1;
      if (legend?.slot?.required) requiredSlotIds.add(legend.slot.id);
    }
  }
  return {
    ...entry,
    entranceCount,
    requiredSlotIds: [...requiredSlotIds].sort((left, right) => left < right ? -1 : left > right ? 1 : 0),
  };
});

export const contentFileSchema = z.strictObject({
  schemaVersion: z.literal(CONTENT_SCHEMA_VERSION),
  entries: z.array(contentEntrySchema).min(1),
});
