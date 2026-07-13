import { z } from 'zod';
import { damageTypes, diceSchema, stableIdSchema, targetingIds } from './schema.js';

const safePositive = z.number().int().safe().positive();

export const TARGETING_REGISTRY = targetingIds;

export const BEHAVIOR_PARAMETER_SCHEMAS = {
  'behavior.approach-and-attack': z.strictObject({}),
} as const;

export const EFFECT_PARAMETER_SCHEMAS = {
  'effect.damage': z.strictObject({ damageType: z.enum(damageTypes), dice: diceSchema }),
  'effect.heal': z.strictObject({ dice: diceSchema }),
  'effect.condition.apply': z.strictObject({ conditionId: stableIdSchema, duration: safePositive }),
  'effect.condition.remove': z.strictObject({ conditionId: stableIdSchema }),
  'effect.force-move': z.strictObject({ distance: safePositive.max(8) }),
  'effect.reveal': z.strictObject({ radius: safePositive.max(32) }),
  'effect.fuel.transfer': z.strictObject({ maximum: safePositive }),
  'effect.light.toggle': z.strictObject({ enabled: z.boolean() }),
  'effect.item.consume': z.strictObject({ quantity: safePositive }),
  'effect.feature.mutate': z.strictObject({ state: stableIdSchema }),
} as const;

export type BehaviorId = keyof typeof BEHAVIOR_PARAMETER_SCHEMAS;
export type EffectId = keyof typeof EFFECT_PARAMETER_SCHEMAS;
