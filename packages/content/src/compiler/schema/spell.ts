import { z } from 'zod';
import { base, effect, safeNonNegative, safePositive, targetingIds } from './common.js';

export const spellEntry = z.strictObject({
  ...base,
  kind: z.literal('spell'),
  targetingId: z.enum(targetingIds),
  range: safeNonNegative,
  actionCost: safePositive,
  effects: z.array(effect).min(1),
});
