import { z } from 'zod';
import { CONDITION_TRAIT_IDS, DERIVED_STAT_NAMES } from '../../model.js';
import { base, color, safeInteger, safePositive } from './common.js';

const conditionDuration = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('timed'), default: safePositive, maximum: safePositive })
    .refine((value) => value.default <= value.maximum, {
      path: ['default'], message: 'default duration must not exceed maximum duration',
    }),
  z.strictObject({ mode: z.literal('permanent'), default: z.null(), maximum: z.null() }),
]);

export const conditionEntry = z.strictObject({
  ...base,
  kind: z.literal('condition'),
  description: z.string().trim().min(1).max(500),
  color,
  duration: conditionDuration,
  stacking: z.strictObject({
    mode: z.enum(['replace', 'refresh', 'intensify']),
    maximumStacks: safePositive.max(100),
  }),
  modifiersPerStack: z.partialRecord(z.enum(DERIVED_STAT_NAMES), safeInteger).default({}),
  traits: z.array(z.enum(CONDITION_TRAIT_IDS)).default([]),
}).superRefine((entry, context) => {
  if (entry.stacking.mode !== 'intensify' && entry.stacking.maximumStacks !== 1) {
    context.addIssue({
      code: 'custom', path: ['stacking', 'maximumStacks'],
      message: 'replace and refresh conditions require maximumStacks 1',
    });
  }
  for (let index = 1; index < entry.traits.length; index += 1) {
    if (entry.traits[index - 1]! >= entry.traits[index]!) {
      context.addIssue({
        code: 'custom', path: ['traits', index],
        message: 'condition traits must be unique and sorted',
      });
      break;
    }
  }
});
