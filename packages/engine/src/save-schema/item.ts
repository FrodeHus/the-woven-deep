import { z } from 'zod';
import { heroName, identifier, nullableIdentifier, safeNonNegative } from './primitives.js';
import { tile } from './floor.js';

export const legacyItemLocation = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('backpack'), actorId: identifier }),
  z.strictObject({
    type: z.literal('equipped'),
    actorId: identifier,
    slot: z.enum([
      'main-hand',
      'off-hand',
      'body',
      'head',
      'hands',
      'feet',
      'neck',
      'left-ring',
      'right-ring',
    ]),
  }),
  z.strictObject({
    type: z.literal('floor'),
    floorId: identifier,
    x: safeNonNegative,
    y: safeNonNegative,
  }),
]);
export const itemLocationV7 = z.discriminatedUnion('type', [
  ...legacyItemLocation.options,
  z.strictObject({ type: z.literal('merchant-stock'), populationId: identifier }),
]);
export const itemLocation = z.discriminatedUnion('type', [
  ...itemLocationV7.options,
  z.strictObject({ type: z.literal('house') }),
]);
export const enchantment = z.strictObject({
  enchantmentId: identifier,
  modifiers: z.record(z.string(), z.number().int().safe()).readonly(),
});
export const heirloomItemMetadata = z.strictObject({
  displayName: heroName,
  glyph: z.string().refine((value) => [...value].length === 1, 'must be one Unicode glyph'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  originatingHallRecordId: identifier,
  originatingRank: z.literal(1),
  sourceItemId: nullableIdentifier,
});
export const itemFields = {
  itemId: identifier,
  contentId: identifier,
  quantity: z.number().int().safe().positive(),
  condition: safeNonNegative,
  enchantment: enchantment.nullable(),
  identified: z.boolean(),
  charges: safeNonNegative.nullable(),
  fuel: safeNonNegative.nullable(),
  enabled: z.boolean().nullable(),
  heirloom: heirloomItemMetadata.optional(),
} as const;
export const item = z.strictObject({ ...itemFields, location: itemLocation });
export const discovery = z.strictObject({
  discoveredByActorIds: z.array(identifier).readonly(),
  progressByActorId: z.record(identifier, safeNonNegative).readonly(),
  attemptedContextKeys: z.array(z.string().min(1).max(256)).readonly(),
});
export const lockData = z.strictObject({
  difficulty: safeNonNegative,
  keyContentId: nullableIdentifier,
});
export const featureBase = {
  featureId: identifier,
  floorId: identifier,
  x: safeNonNegative,
  y: safeNonNegative,
  contentId: nullableIdentifier,
  coverTileId: tile,
} as const;
export const feature = z.discriminatedUnion('type', [
  z.strictObject({
    ...featureBase,
    type: z.literal('door'),
    state: z.enum(['open', 'closed', 'locked']),
    lock: lockData.optional(),
  }),
  z.strictObject({
    ...featureBase,
    type: z.literal('trap'),
    state: z.enum(['armed', 'disabled', 'spent']),
    discoveryDifficulty: safeNonNegative,
    discovery,
  }),
  z.strictObject({
    ...featureBase,
    type: z.literal('secret'),
    state: z.enum(['hidden', 'revealed']),
    discoveryDifficulty: safeNonNegative,
    discovery,
  }),
  z.strictObject({
    ...featureBase,
    type: z.literal('chest'),
    state: z.enum(['locked', 'closed', 'looted', 'jammed']),
    lock: lockData.nullable(),
    lootTableId: nullableIdentifier,
    lootContentId: nullableIdentifier,
  }),
]);

import type { ItemInstance } from '../item-model.js';
import type { DungeonFeature } from '../feature-model.js';
import type { Expect, SchemaMatches } from './drift.js';
type _ItemDrift = Expect<SchemaMatches<z.infer<typeof item>, ItemInstance>>;
type _FeatureDrift = Expect<SchemaMatches<z.infer<typeof feature>, DungeonFeature>>;
