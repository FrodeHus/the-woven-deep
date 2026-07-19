import { z } from 'zod';
import { ACHIEVEMENT_CRITERIA_IDS } from '../../model.js';
import { base } from './common.js';

export const achievementEntry = z.strictObject({
  ...base,
  kind: z.literal('achievement'),
  description: z.string().trim().min(1).max(200),
  criteriaId: z.enum(ACHIEVEMENT_CRITERIA_IDS),
});
