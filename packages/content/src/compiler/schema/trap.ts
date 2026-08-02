import { z } from 'zod';
import {
  nonItemEffect,
  presented,
  safeNonNegative,
  safePositive,
  targetingIds,
  trapDisarmOutcomes,
  trapResetModes,
} from './common.js';

export const trapEntry = z.strictObject({
  ...presented,
  kind: z.literal('trap'),
  targetingId: z.enum(targetingIds),
  discoveryDifficulty: safeNonNegative,
  disarmDifficulty: safeNonNegative,
  disarmOutcomes: z.strictObject({
    failure: z.enum(trapDisarmOutcomes),
    criticalFailure: z.enum(trapDisarmOutcomes),
    toolDamage: safePositive,
  }),
  resetMode: z.enum(trapResetModes),
  effects: z.array(nonItemEffect).min(1),
});
