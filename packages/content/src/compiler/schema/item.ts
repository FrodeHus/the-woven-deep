import { z } from 'zod';
import { DERIVED_STAT_NAMES } from '../../model/common.js';
import {
  depthRange,
  diceSchema,
  effect,
  equipmentSlots,
  identificationModes,
  itemCategories,
  itemHandedness,
  itemRarities,
  negativeDerivedStatModifiers,
  presented,
  rgb,
  safeInteger,
  safeNonNegative,
  safePositive,
  slugSchema,
  stableIdSchema,
} from './common.js';

const equipment = z.strictObject({
  slots: z.array(z.enum(equipmentSlots)).min(1),
  handedness: z.enum(itemHandedness),
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
  mode: z.enum(identificationModes),
  poolId: stableIdSchema.nullable(),
});

const artifactSignature = z.strictObject({
  spellId: stableIdSchema,
  charges: safePositive,
  rechargePerFloor: safeNonNegative,
});

const artifactLight = z.strictObject({
  fuelless: z.boolean(),
  inextinguishable: z.boolean(),
});

const itemArtifact = z.strictObject({
  canon: z.literal(true),
  signature: artifactSignature.nullable(),
  drawbackModifiers: negativeDerivedStatModifiers,
  light: artifactLight.nullable(),
});

// Positive only, and named "positive" explicitly for the same reason the enchantment schema does:
// zod4's default `.positive()` message never uses the word, and the compile test asserts on it.
// An item's own drawbacks ride `artifact.drawbackModifiers`; a rolled one rides a curse.
const intrinsicModifiers = z.partialRecord(
  z.enum(DERIVED_STAT_NAMES),
  z
    .number()
    .int()
    .safe()
    .positive({ message: 'intrinsic item modifiers must be positive safe integers' }),
);

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
  spellId: stableIdSchema.optional(),
  modifiers: intrinsicModifiers.default({}),
  equipment: equipment.nullable(),
  combat: combat.nullable(),
  light: itemLight.nullable(),
  artifact: itemArtifact.nullable(),
  identification,
  effects: z.array(effect),
}).superRefine((value, context) => {
  // `equipmentModifiers` is the sole stat path, so modifiers on an item with no slot to fill
  // would be silently inert — exactly the authoring mistake #157 is about. Fail the compile.
  if (Object.keys(value.modifiers).length > 0 && value.equipment === null) {
    context.addIssue({
      code: 'custom',
      path: ['modifiers'],
      message: 'intrinsic modifiers require an equipment block; they apply only while equipped',
    });
  }
});
