import { z } from 'zod';
import { base, color, glyph, itemCategories, stableIdSchema } from './common.js';

export const identificationPoolEntry = z.strictObject({
  ...base,
  kind: z.literal('identification-pool'),
  category: z.enum(itemCategories),
  verbs: z.array(z.string().trim().min(1).max(40)).min(1),
  nouns: z.array(z.string().trim().min(1).max(40)).min(1),
  visuals: z.array(z.strictObject({
    id: stableIdSchema,
    glyph,
    color,
  })).min(1),
});
