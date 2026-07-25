import { z } from 'zod';
import { ACHIEVEMENT_ENDINGS } from '../../model.js';
import { base, stableIdSchema } from './common.js';

export const achievementEntry = z.strictObject({
  ...base,
  kind: z.literal('achievement'),
  description: z.string().trim().min(1).max(200),
  criteria: z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('defeat-boss'), monsterId: stableIdSchema }),
    z.strictObject({ type: z.literal('defeat-fallen-hero'), role: z.enum(['champion', 'echo']) }),
    z.strictObject({ type: z.literal('reach-depth'), depth: z.number().int().min(1).max(20) }),
    z.strictObject({ type: z.literal('complete-ending'), ending: z.enum(ACHIEVEMENT_ENDINGS) }),
  ]),
});
