import { z } from 'zod';
import {
  base, diceSchema, jsonObject, merchantServiceIds, positiveAttributes, presented,
  resistances, safeInteger, safeNonNegative, safePositive, slugSchema, stableIdSchema,
} from './common.js';

const reputationTier = z.strictObject({
  tierId: slugSchema, name: z.string().trim().min(1).max(80), minimum: safeInteger, maximum: safeInteger,
  purchasePriceBps: safePositive, salePriceBps: safePositive, acceptsTrade: z.boolean(),
  serviceIds: z.array(z.enum(merchantServiceIds)),
});
export const npcFactionEntry = z.strictObject({
  ...base, kind: z.literal('npc-faction'), minimumReputation: safeInteger, maximumReputation: safeInteger,
  startingReputation: safeInteger, tiers: z.array(reputationTier).min(1),
});
export const npcEntry = z.strictObject({
  ...presented, kind: z.literal('npc'), factionId: stableIdSchema, attributes: positiveAttributes,
  health: safePositive, speed: safePositive, perception: safePositive, accuracy: safePositive,
  defense: safePositive, damage: diceSchema, armor: safeNonNegative, resistances,
  disposition: z.literal('neutral'), behaviorId: z.literal('npc-behavior.travelling-merchant'),
  behaviorParameters: jsonObject.default({}), selfPreservationThresholdBps: safePositive.max(10_000),
});
