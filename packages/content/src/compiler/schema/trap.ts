import { z } from 'zod';
import { effect, presented, safeNonNegative, safePositive, targetingIds } from './common.js';

export const trapEntry = z.strictObject({
  ...presented,
  kind: z.literal('trap'),
  targetingId: z.enum(targetingIds),
  discoveryDifficulty: safeNonNegative,
  disarmDifficulty: safeNonNegative,
  disarmOutcomes: z.strictObject({
    failure: z.enum(['safe', 'tool-damage', 'trigger']),
    criticalFailure: z.enum(['safe', 'tool-damage', 'trigger']),
    toolDamage: safePositive,
  }),
  resetMode: z.enum(['once', 'reset', 'disabled']),
  effects: z.array(effect).min(1),
});
