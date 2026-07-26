import { z } from 'zod';
import { base, stableIdSchema } from './common.js';

const dialogueConsequence = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('reputation'),
    factionId: stableIdSchema,
    amount: z.number().int(),
  }),
  z.strictObject({ kind: z.literal('reveal-lore'), contentId: stableIdSchema }),
  z.strictObject({ kind: z.literal('open-trade') }),
]);

const dialogueTopic = z.strictObject({
  id: z.string().trim().min(1).max(64),
  prompt: z.string().trim().min(1).max(120),
  response: z.string().trim().min(1).max(600),
  reveals: z.array(z.string().trim().min(1)).readonly().optional(),
  consequence: dialogueConsequence.optional(),
  once: z.boolean().optional(),
});

export const dialogueEntry = z.strictObject({
  ...base,
  kind: z.literal('dialogue'),
  greeting: z.string().trim().min(1).max(600),
  topics: z.array(dialogueTopic).min(1).readonly(),
});
