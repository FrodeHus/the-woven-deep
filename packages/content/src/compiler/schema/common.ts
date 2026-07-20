import { z } from 'zod';
import {
  DAMAGE_TYPES, DISPOSITIONS, ENCOUNTER_FORMATIONS, ENCOUNTER_MODELS, EQUIPMENT_SLOTS,
  FORMATION_PREFERENCES, ITEM_CATEGORIES, ITEM_RARITIES, LEADER_DEATH_RESPONSES,
  MERCHANT_SERVICE_IDS, SWARM_DESTRUCTION_RESPONSES, TARGETING_IDS, VAULT_PLACEMENT_KINDS,
  VAULT_TERRAIN_NAMES,
} from '../../model.js';

export const stableIdSchema = z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/);
export const slugSchema = z.string().regex(/^[a-z][a-z0-9-]*$/);
export const glyph = z.string().refine((value) => [...value].length === 1, 'must be one Unicode glyph');
export const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const safeInteger = z.number().int().safe();
export const safeNonNegative = safeInteger.nonnegative();
export const safePositive = safeInteger.positive();
export const safeNonZeroInteger = safeInteger.refine((value) => value !== 0, 'must be non-zero');
export const probability = z.number().finite().min(0).max(1);
export const jsonObject = z.record(z.string(), z.json());
export const tags = z.array(slugSchema).default([]);

export const damageTypes = DAMAGE_TYPES;
export const targetingIds = TARGETING_IDS;
export const equipmentSlots = EQUIPMENT_SLOTS;
export const vaultPlacementKinds = VAULT_PLACEMENT_KINDS;
export const vaultTerrainNames = VAULT_TERRAIN_NAMES;
export const encounterModels = ENCOUNTER_MODELS;
export const encounterFormations = ENCOUNTER_FORMATIONS;
export const formationPreferences = FORMATION_PREFERENCES;
export const leaderDeathResponses = LEADER_DEATH_RESPONSES;
export const swarmDestructionResponses = SWARM_DESTRUCTION_RESPONSES;
export const itemCategories = ITEM_CATEGORIES;
export const itemRarities = ITEM_RARITIES;
export const merchantServiceIds = MERCHANT_SERVICE_IDS;
export const dispositions = DISPOSITIONS;

export const diceSchema = z.strictObject({
  count: safePositive.max(100),
  sides: safePositive.max(10_000),
  bonus: safeInteger,
});

export const attributes = z.strictObject({
  might: safeNonNegative,
  agility: safeNonNegative,
  vitality: safeNonNegative,
  wits: safeNonNegative,
  resolve: safeNonNegative,
});
export const positiveAttributes = z.strictObject({
  might: safePositive, agility: safePositive, vitality: safePositive, wits: safePositive, resolve: safePositive,
});

export const resistances = z.strictObject({
  physical: safeInteger.min(-100).max(100),
  fire: safeInteger.min(-100).max(100),
  cold: safeInteger.min(-100).max(100),
  lightning: safeInteger.min(-100).max(100),
  poison: safeInteger.min(-100).max(100),
  arcane: safeInteger.min(-100).max(100),
});

export const effect = z.strictObject({
  effectId: stableIdSchema,
  parameters: jsonObject.default({}),
  requiresLivingTarget: z.boolean().default(false),
});

export const base = {
  id: stableIdSchema,
  name: z.string().trim().min(1).max(80),
  tags,
} as const;

export const presented = {
  ...base,
  glyph,
  color,
} as const;

export const depthRange = {
  minDepth: safePositive,
  maxDepth: safePositive,
} as const;

export const rgb = z.tuple([
  z.number().int().min(0).max(255),
  z.number().int().min(0).max(255),
  z.number().int().min(0).max(255),
]);
