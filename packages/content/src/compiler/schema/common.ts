import { z } from 'zod';

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

export const damageTypes = ['physical', 'fire', 'cold', 'lightning', 'poison', 'arcane'] as const;
export const targetingIds = ['target.self', 'target.actor', 'target.line', 'target.cell'] as const;
export const equipmentSlots = ['main-hand', 'off-hand', 'body', 'head', 'hands', 'feet', 'neck', 'left-ring', 'right-ring'] as const;
export const vaultPlacementKinds = ['monster', 'item', 'trap', 'npc', 'fixture', 'objective'] as const;
export const encounterModels = ['individual', 'group', 'swarm', 'boss', 'merchant'] as const;
export const encounterFormations = ['cluster', 'line', 'screen', 'wedge', 'surround'] as const;
export const formationPreferences = ['front', 'center', 'rear', 'flank', 'free'] as const;
export const leaderDeathResponses = ['weaken', 'panic', 'disband', 'surrender', 'frenzy', 'collapse'] as const;
export const swarmDestructionResponses = ['stop', 'flee', 'decay', 'frenzy'] as const;
export const itemCategories = ['weapon', 'ammunition', 'armor', 'shield', 'light', 'fuel', 'food', 'potion', 'scroll', 'ring', 'misc'] as const;
export const merchantServiceIds = ['merchant-service.identify', 'merchant-service.strongbox'] as const;

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
