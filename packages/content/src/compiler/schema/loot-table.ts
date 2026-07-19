import { z } from 'zod';
import { base, safeNonNegative, safePositive, stableIdSchema } from './common.js';

const lootChoice = z.strictObject({
  contentId: stableIdSchema.nullable(),
  lootTableId: stableIdSchema.nullable(),
  weight: safePositive,
  minimumQuantity: safePositive,
  maximumQuantity: safePositive,
  minDepth: safeNonNegative.max(999).optional(),
  maxDepth: safeNonNegative.max(999).optional(),
});

export const lootTableEntry = z.strictObject({
  ...base,
  kind: z.literal('loot-table'),
  rolls: safePositive,
  choices: z.array(lootChoice).min(1),
});
