import { z } from 'zod';

export const identifier = z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,127}$/);
export const heroName = z
  .string()
  .refine(
    (name) =>
      [...name].length >= 1 &&
      [...name].length <= 40 &&
      name.normalize('NFC') === name &&
      !/[\p{Cc}\p{Cf}]/u.test(name),
  );
export const safeNonNegative = z.number().int().safe().nonnegative();
export const safeInteger = z.number().int().safe();
export const uint8 = z.number().int().min(0).max(255);
export const uint32 = z.number().int().min(0).max(0xffff_ffff);
export const uint32Tuple = z.tuple([uint32, uint32, uint32, uint32]);
export const uint32State = uint32Tuple.refine(
  (state) => state.some((word) => word !== 0),
  'state must not be all zero',
);
export const point = z.strictObject({ x: safeNonNegative, y: safeNonNegative });
export const direction = z.enum([
  'north',
  'northeast',
  'east',
  'southeast',
  'south',
  'southwest',
  'west',
  'northwest',
]);
export const equipmentSlot = z.enum([
  'main-hand',
  'off-hand',
  'body',
  'head',
  'hands',
  'feet',
  'neck',
  'left-ring',
  'right-ring',
]);
export const positiveQuantity = z.number().int().safe().positive();
export const merchantServiceId = z.enum([
  'merchant-service.identify',
  'merchant-service.strongbox',
]);
export const blockReason = z.enum([
  'blocked.bounds',
  'blocked.wall',
  'blocked.door',
  'blocked.chest',
  'blocked.pillar',
  'blocked.void',
  'blocked.corner',
  'blocked.actor',
  'action.unavailable',
  'inventory.full',
  'item.missing',
  'item.unavailable',
  'item.quantity',
  'item.incompatible',
  'item.id-conflict',
  'target.not_visible',
  'target.out_of_range',
  'target.blocked',
  'target.invalid',
  'cast.insufficient-weave',
  'cast.no-aptitude',
  'learn.no-aptitude',
  'learn.already-known',
  'trade.active',
  'trade.required',
  'merchant.unavailable',
  'merchant.out-of-range',
  'merchant.refuses',
  'trade.merchant-mismatch',
  'trade.insufficient-funds',
  'trade.stock-unavailable',
  'trade.item-unacceptable',
  'trade.capacity',
  'trade.service-unavailable',
  'trade.target-invalid',
  'run.concluded',
  'town.truce',
  'town.rest',
  'house.full',
  'door.missing',
  'door.not-adjacent',
  'door.locked',
  'door.already-open',
  'door.already-closed',
  'door.occupied',
  'final-chamber.unavailable',
  'final-chamber.fragments-required',
  'final-chamber.boss-active',
]);
export const completionType = z.enum(['died', 'became-heart', 'refused', 'broke-cycle']);
export const runConclusionCause = z.strictObject({
  killerContentId: identifier.nullable(),
  depth: safeNonNegative,
  turn: safeNonNegative,
  worldTime: safeNonNegative,
});
export const nullableIdentifier = identifier.nullable();
export const attributes = z.strictObject({
  might: safeNonNegative,
  agility: safeNonNegative,
  vitality: safeNonNegative,
  wits: safeNonNegative,
  resolve: safeNonNegative,
});
export const populationBase = {
  populationId: identifier,
  encounterId: identifier,
  floorId: identifier,
  createdAt: safeNonNegative,
  livingMemberIds: z.array(identifier).readonly(),
  formerMemberIds: z.array(identifier).readonly(),
} as const;
