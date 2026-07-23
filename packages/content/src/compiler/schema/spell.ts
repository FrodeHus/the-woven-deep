import { z } from 'zod';
import { base, effect, safeNonNegative, safePositive, targetingIds } from './common.js';

const aoe = z.strictObject({
  shape: z.enum(['burst', 'line', 'cone']),
  radius: safePositive.max(32),
});

export const spellEntry = z.strictObject({
  ...base,
  kind: z.literal('spell'),
  targetingId: z.enum(targetingIds),
  range: safeNonNegative,
  actionCost: safePositive,
  weaveCost: safeNonNegative,
  aoe: aoe.optional(),
  effects: z.array(effect).min(1),
});
