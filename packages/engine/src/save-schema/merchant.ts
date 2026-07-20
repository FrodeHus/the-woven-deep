import { z } from 'zod';
import { identifier, merchantServiceId, populationBase, safeNonNegative } from './primitives.js';

export const merchantService = z.strictObject({
  serviceId: merchantServiceId,
  basePrice: safeNonNegative,
  remainingUses: safeNonNegative,
  tierIds: z.array(z.string().min(1).max(80)).readonly(),
});
export const merchantPopulationFields = {
  ...populationBase,
  model: z.literal('merchant'),
  actorId: identifier,
  npcId: identifier,
  factionId: identifier,
  rolledLifetime: safeNonNegative,
  emittedWarningThresholds: z.array(safeNonNegative).readonly(),
  initialStockItemIds: z.array(identifier).readonly(),
  stockItemIds: z.array(identifier).readonly(),
  services: z.array(merchantService).readonly(),
  lifecycle: z.enum(['available', 'fleeing', 'defending', 'departed', 'dead']),
  provoked: z.boolean(),
  aggressionPenaltyApplied: z.boolean(),
  deathPenaltyApplied: z.boolean(),
  stockLossResolved: z.boolean(),
  commerceBonusApplied: z.boolean(),
} as const;
export const merchantPopulationV7 = z.strictObject({
  ...merchantPopulationFields,
  departureAt: safeNonNegative,
});
export const merchantPopulation = z.strictObject({
  ...merchantPopulationFields,
  departureAt: safeNonNegative.nullable(),
});
