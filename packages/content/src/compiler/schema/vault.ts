import { z } from 'zod';
import {
  base, glyph, itemRarities, rgb, safeNonNegative, safePositive, slugSchema, stableIdSchema, tags,
  vaultPlacementKinds, vaultTerrainNames,
} from './common.js';

export const TOWN_VAULT_REQUIRED_SLOT_IDS = [
  'dungeon-entrance', 'house-door', 'merchant-provisioner', 'merchant-arms', 'merchant-curios',
] as const;

const slot = z.strictObject({
  id: slugSchema,
  kind: z.enum(vaultPlacementKinds),
  required: z.boolean().default(false),
  tags,
  lootTableId: stableIdSchema.nullable().default(null),
  contentId: stableIdSchema.nullable().default(null),
});
const light = z.strictObject({
  idSuffix: slugSchema,
  glyph,
  presentationToken: stableIdSchema,
  color: rgb,
  radius: safePositive.max(32),
  strength: safePositive.max(255),
  enabled: z.boolean().default(true),
});
const legendEntry = z.strictObject({
  terrain: z.enum(vaultTerrainNames),
  entrance: z.boolean().default(false),
  light: light.nullable().default(null),
  slot: slot.nullable().default(null),
}).superRefine((entry, context) => {
  const actionCount = Number(entry.entrance) + Number(entry.light !== null) + Number(entry.slot !== null);
  if (actionCount > 1) context.addIssue({ code: 'custom', path: [], message: 'legend entry may declare at most one entrance, light, or slot action' });
});
const rotations = z.array(z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]))
  .min(1).max(4).superRefine((values, context) => {
    for (let index = 1; index < values.length; index += 1) {
      if (values[index - 1]! >= values[index]!) {
        context.addIssue({ code: 'custom', path: [index], message: 'rotations must be unique and sorted in numeric order' });
        return;
      }
    }
  });
const layoutRow = z.string().min(1).refine((value) => [...value].length <= 160, 'layout row exceeds 160 code points');

export const vaultEntry = z.strictObject({
  ...base,
  // Ordinary vaults require a positive depth range; the surface town vault is the sole
  // exception and is pinned to minDepth 0 / maxDepth 0 by the tag-scoped rule below.
  minDepth: safeNonNegative,
  maxDepth: safeNonNegative,
  kind: z.literal('vault'),
  rarity: z.enum(itemRarities),
  weight: safePositive,
  maxPerFloor: safePositive,
  margin: safeNonNegative,
  transforms: z.strictObject({ rotations, reflectHorizontal: z.boolean().default(false) }),
  layout: z.array(layoutRow).min(1).max(100),
  legend: z.record(z.string(), legendEntry),
}).superRefine((entry, context) => {
  const isTown = entry.tags.includes('town');
  if (isTown) {
    if (entry.minDepth !== 0 || entry.maxDepth !== 0) {
      context.addIssue({ code: 'custom', path: ['minDepth'], message: 'a town vault requires minDepth 0 and maxDepth 0' });
    }
  } else {
    if (entry.minDepth <= 0) {
      context.addIssue({ code: 'custom', path: ['minDepth'], message: 'Too small: expected number to be >0' });
    }
    if (entry.maxDepth <= 0) {
      context.addIssue({ code: 'custom', path: ['maxDepth'], message: 'Too small: expected number to be >0' });
    }
  }
  if (entry.maxDepth < entry.minDepth) context.addIssue({ code: 'custom', path: ['maxDepth'], message: 'maximum depth must be greater than or equal to minimum depth' });
});
