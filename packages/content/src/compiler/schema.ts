import { z } from 'zod';
import { CONDITION_TRAIT_IDS, DERIVED_STAT_NAMES } from '../model.js';

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
  runAppearanceChance: probability,
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
  groupId: stableIdSchema.nullable(),
  appearances: z.array(stableIdSchema),
});

const itemEntry = z.strictObject({
  ...presented,
  ...depthRange,
  kind: z.literal('item'),
  category: z.enum(['weapon', 'ammunition', 'armor', 'shield', 'light', 'fuel', 'food', 'potion', 'scroll', 'ring', 'misc']),
  stackLimit: safePositive,
  price: safeNonNegative,
  rarity: z.enum(['common', 'uncommon', 'rare', 'legendary']),
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
  formulas: z.record(z.string(), z.record(z.string(), safeInteger)),
  actionCosts: z.record(stableIdSchema, safeNonNegative),
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

const rawContentEntrySchema = z.discriminatedUnion('kind', [
  monsterEntry,
  itemEntry,
  spellEntry,
  trapEntry,
  lootTableEntry,
  balanceEntry,
  vaultEntry,
  conditionEntry,
]);

export const contentEntrySchema = rawContentEntrySchema.transform((entry) => {
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
  schemaVersion: z.literal(2),
  entries: z.array(contentEntrySchema).min(1),
});
