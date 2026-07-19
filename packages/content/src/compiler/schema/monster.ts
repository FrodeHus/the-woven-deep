import { z } from 'zod';
import {
  attributes, diceSchema, depthRange, presented, probability, resistances,
  safeInteger, safeNonNegative, safePositive, stableIdSchema, jsonObject,
} from './common.js';

export const monsterEntry = z.strictObject({
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
  threat: safeNonNegative,
  rarity: z.enum(['common', 'uncommon', 'rare', 'legendary']),
  lootTableId: stableIdSchema.nullable().default(null),
  dropChance: probability.default(1),
}).superRefine((entry, context) => {
  if (entry.maxDepth < entry.minDepth) context.addIssue({ code: 'custom', path: ['maxDepth'], message: 'maximum depth must be greater than or equal to minimum depth' });
});
