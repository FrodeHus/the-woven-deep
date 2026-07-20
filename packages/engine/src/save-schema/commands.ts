import { z } from 'zod';
import {
  direction,
  equipmentSlot,
  identifier,
  merchantServiceId,
  point,
  positiveQuantity,
  safeNonNegative,
} from './primitives.js';

export const moveCommand = z.strictObject({
  type: z.literal('move'),
  commandId: identifier,
  expectedRevision: safeNonNegative,
  direction,
});
export const waitCommand = z.strictObject({
  type: z.literal('wait'),
  commandId: identifier,
  expectedRevision: safeNonNegative,
});
export const commandBase = { commandId: identifier, expectedRevision: safeNonNegative } as const;
export const commandBaseOptions = [
  moveCommand,
  waitCommand,
  z.strictObject({ ...commandBase, type: z.literal('attack'), targetActorId: identifier }),
  z.strictObject({ ...commandBase, type: z.literal('fire'), itemId: identifier, target: point }),
  z.strictObject({
    ...commandBase,
    type: z.literal('cast'),
    spellId: identifier,
    target: point.nullable(),
  }),
  z.strictObject({
    ...commandBase,
    type: z.literal('throw-item'),
    itemId: identifier,
    quantity: positiveQuantity,
    target: point,
  }),
  z.strictObject({
    ...commandBase,
    type: z.literal('use-item'),
    itemId: identifier,
    target: point.nullable(),
  }),
  z.strictObject({
    ...commandBase,
    type: z.literal('equip'),
    itemId: identifier,
    slot: equipmentSlot,
  }),
  z.strictObject({ ...commandBase, type: z.literal('unequip'), slot: equipmentSlot }),
  z.strictObject({
    ...commandBase,
    type: z.literal('pickup'),
    itemId: identifier,
    quantity: positiveQuantity,
  }),
  z.strictObject({
    ...commandBase,
    type: z.literal('drop'),
    itemId: identifier,
    quantity: positiveQuantity,
  }),
  z.strictObject({
    ...commandBase,
    type: z.literal('split-stack'),
    itemId: identifier,
    quantity: positiveQuantity,
    newItemId: identifier,
  }),
  z.strictObject({
    ...commandBase,
    type: z.literal('refuel'),
    itemId: identifier,
    fuelItemId: identifier,
    quantity: positiveQuantity,
  }),
  z.strictObject({
    ...commandBase,
    type: z.literal('toggle-light'),
    itemId: identifier,
    enabled: z.boolean(),
  }),
  z.strictObject({ ...commandBase, type: z.literal('open-door'), featureId: identifier }),
  z.strictObject({ ...commandBase, type: z.literal('close-door'), featureId: identifier }),
  z.strictObject({ ...commandBase, type: z.literal('search') }),
  z.strictObject({ ...commandBase, type: z.literal('disarm'), featureId: identifier }),
  z.strictObject({ ...commandBase, type: z.literal('pick-lock'), featureId: identifier }),
  z.strictObject({
    ...commandBase,
    type: z.literal('rest'),
    until: z.enum(['healed', 'interrupted']),
    maximumDuration: positiveQuantity,
  }),
  z.strictObject({ ...commandBase, type: z.literal('trade-open'), merchantActorId: identifier }),
  z.strictObject({
    ...commandBase,
    type: z.literal('trade-buy'),
    merchantPopulationId: identifier,
    itemId: identifier,
    quantity: positiveQuantity,
  }),
  z.strictObject({
    ...commandBase,
    type: z.literal('trade-sell'),
    merchantPopulationId: identifier,
    itemId: identifier,
    quantity: positiveQuantity,
  }),
  z.strictObject({
    ...commandBase,
    type: z.literal('trade-close'),
    merchantPopulationId: identifier,
  }),
] as const;
export const tradeServiceCommandV7 = z.strictObject({
  ...commandBase,
  type: z.literal('trade-service'),
  merchantPopulationId: identifier,
  serviceId: z.literal('merchant-service.identify'),
  targetItemId: identifier,
});
export const tradeServiceCommand = z.strictObject({
  ...commandBase,
  type: z.literal('trade-service'),
  merchantPopulationId: identifier,
  serviceId: merchantServiceId,
  targetItemId: identifier.nullable(),
});
export const houseDepositCommand = z.strictObject({
  ...commandBase,
  type: z.literal('house-deposit'),
  itemId: identifier,
  quantity: positiveQuantity,
});
export const houseWithdrawCommand = z.strictObject({
  ...commandBase,
  type: z.literal('house-withdraw'),
  itemId: identifier,
  quantity: positiveQuantity,
});
export const commandV7 = z.discriminatedUnion('type', [
  ...commandBaseOptions,
  tradeServiceCommandV7,
]);
export const command = z.discriminatedUnion('type', [
  ...commandBaseOptions,
  tradeServiceCommand,
  houseDepositCommand,
  houseWithdrawCommand,
]);

import type { GameCommand } from '../model.js';
import type { Expect, SchemaMatches } from './drift.js';
type _CommandDrift = Expect<SchemaMatches<z.infer<typeof command>, GameCommand>>;
