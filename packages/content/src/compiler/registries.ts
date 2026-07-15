import { z } from 'zod';
import { damageTypes, diceSchema, stableIdSchema, targetingIds } from './schema.js';

const safePositive = z.number().int().safe().positive();
const safeInteger = z.number().int().safe();
const populationModifiers = z.strictObject({
  accuracy: safeInteger,
  defense: safeInteger,
  damage: safeInteger,
});

export const TARGETING_REGISTRY = targetingIds;

export const ACTION_COST_IDS = [
  'action.attack', 'action.cast', 'action.close-door', 'action.disarm', 'action.drop', 'action.equip',
  'action.fire', 'action.move', 'action.open-door', 'action.pickup', 'action.refuel', 'action.search',
  'action.split-stack', 'action.throw-item', 'action.toggle-light', 'action.unequip', 'action.use-item',
  'action.wait', 'action.spawn',
] as const;

export const BEHAVIOR_PARAMETER_SCHEMAS = {
  'behavior.approach-and-attack': z.strictObject({}),
  'behavior.patrol': z.strictObject({
    waypoints: z.array(z.strictObject({ x: safeInteger, y: safeInteger })).min(1),
  }),
} as const;

export const NPC_BEHAVIOR_PARAMETER_SCHEMAS = {
  'npc-behavior.travelling-merchant': z.strictObject({}),
} as const;

export const MERCHANT_SERVICE_IDS = ['merchant-service.identify'] as const;
export const MERCHANT_AGGRESSION_RESPONSES = ['flee', 'self-defense'] as const;

export { ACHIEVEMENT_CRITERIA_IDS } from '../model.js';

export const LEADER_RESPONSE_PARAMETER_SCHEMAS = {
  weaken: z.strictObject({ modifiers: populationModifiers }),
  panic: z.strictObject({ duration: safePositive }),
  disband: z.strictObject({}),
  surrender: z.strictObject({}),
  frenzy: z.strictObject({ duration: safePositive, modifiers: populationModifiers }),
  collapse: z.strictObject({}),
} as const;

export const SWARM_RESPONSE_PARAMETER_SCHEMAS = {
  stop: z.strictObject({}),
  flee: z.strictObject({}),
  decay: z.strictObject({ interval: safePositive, damage: safePositive }),
  frenzy: z.strictObject({ duration: safePositive, modifiers: populationModifiers }),
} as const;

export const EFFECT_PARAMETER_SCHEMAS = {
  'effect.damage': z.strictObject({ damageType: z.enum(damageTypes), dice: diceSchema }),
  'effect.heal': z.strictObject({ dice: diceSchema }),
  'effect.hunger.restore': z.strictObject({ amount: safePositive }),
  'effect.condition.apply': z.strictObject({ conditionId: stableIdSchema, duration: safePositive.optional() }),
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

/** Effects with a well-defined immutable self/arena target contract during boss phase changes. */
export const BOSS_PHASE_EFFECT_IDS = [
  'effect.damage',
  'effect.heal',
  'effect.condition.apply',
  'effect.condition.remove',
  'effect.reveal',
  'effect.fuel.transfer',
  'effect.light.toggle',
  'effect.feature.mutate',
] as const satisfies readonly EffectId[];
