import { z } from 'zod';
import { identifier, point, safeNonNegative, uint8, uint32, uint32Tuple } from './primitives.js';

export const entity = z.strictObject({
  entityId: identifier,
  x: safeNonNegative,
  y: safeNonNegative,
});
export const color = z.tuple([uint8, uint8, uint8]);
export const ambient = z.strictObject({ color, strength: uint8 });
export const knowledge = z.strictObject({
  exploredWords: z.array(uint32).readonly(),
  rememberedTerrainWords: z.array(uint32).readonly(),
});
export const fixturePresentation = z.strictObject({
  glyph: z.string().refine((glyph) => [...glyph].length === 1, 'glyph must be one Unicode glyph'),
  token: identifier,
});
export const fixedLocation = z.strictObject({
  type: z.literal('fixed'),
  x: safeNonNegative,
  y: safeNonNegative,
});
export const actorLocation = z.strictObject({ type: z.literal('actor'), actorId: identifier });
export const light = z.strictObject({
  lightId: identifier,
  location: z.discriminatedUnion('type', [fixedLocation, actorLocation]),
  color,
  radius: z.number().int().safe().min(1).max(32),
  strength: z.number().int().safe().min(1).max(255),
  enabled: z.boolean(),
  falloff: z.literal('linear'),
  vaultPlacementId: identifier.nullable(),
  presentation: fixturePresentation.nullable(),
});
export const vault = z.strictObject({
  placementId: identifier,
  vaultId: identifier,
  x: safeNonNegative,
  y: safeNonNegative,
  width: z.number().int().safe().positive(),
  height: z.number().int().safe().positive(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  reflected: z.boolean(),
  entrances: z.array(point).readonly(),
});
export const slot = z.strictObject({
  slotId: identifier,
  vaultPlacementId: identifier,
  kind: z.enum(['monster', 'item', 'trap', 'npc', 'fixture', 'objective', 'door', 'chest']),
  required: z.boolean(),
  tags: z.array(z.string()).readonly(),
  x: safeNonNegative,
  y: safeNonNegative,
});
export const tile = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);
export const floor = z.strictObject({
  floorId: identifier,
  seed: uint32Tuple,
  generatorVersion: z.union([z.literal(1), z.literal(2)]),
  width: z.number().int().min(1).max(512),
  height: z.number().int().min(1).max(512),
  depth: z.number().int().min(0).max(10_000),
  tiles: z.array(tile).readonly(),
  entities: z.array(entity).readonly(),
  themeId: identifier,
  ambient,
  knowledge,
  lights: z.array(light).readonly(),
  stairUp: point.nullable(),
  stairDown: point.nullable(),
  vaults: z.array(vault).readonly(),
  placementSlots: z.array(slot).readonly(),
});

import type {
  FloorEntityPosition,
  FloorPlacementSlot,
  FloorSnapshot,
  VaultPlacement,
} from '../model.js';
import type { Expect, SchemaMatches } from './drift.js';
type _FloorDrift = Expect<SchemaMatches<z.infer<typeof floor>, FloorSnapshot>>;
type _VaultDrift = Expect<SchemaMatches<z.infer<typeof vault>, VaultPlacement>>;
type _SlotDrift = Expect<SchemaMatches<z.infer<typeof slot>, FloorPlacementSlot>>;
type _EntityDrift = Expect<SchemaMatches<z.infer<typeof entity>, FloorEntityPosition>>;
