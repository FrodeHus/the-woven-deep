import { z } from 'zod';
import {
  depthRange, diceSchema, effect, equipmentSlots, itemCategories, itemRarities, presented, rgb,
  safeInteger, safeNonNegative, safePositive, slugSchema, stableIdSchema,
} from './common.js';

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

export const itemEntry = z.strictObject({
  ...presented,
  ...depthRange,
  kind: z.literal('item'),
  category: z.enum(itemCategories),
  stackLimit: safePositive,
  price: safeNonNegative,
  rarity: z.enum(itemRarities),
  heirloomEligible: z.boolean().default(true),
  actionCost: safeNonNegative,
  equipment: equipment.nullable(),
  combat: combat.nullable(),
  light: itemLight.nullable(),
  identification,
  effects: z.array(effect),
});
