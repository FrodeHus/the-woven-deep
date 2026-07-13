import { z } from 'zod';

export const stableIdSchema = z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/);
const slug = z.string().regex(/^[a-z][a-z0-9-]*$/);
const glyph = z.string().refine((value) => [...value].length === 1, 'must be one Unicode glyph');
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const rgb = z.tuple([
  z.number().int().min(0).max(255),
  z.number().int().min(0).max(255),
  z.number().int().min(0).max(255),
]);
const slot = z.strictObject({
  id: slug,
  kind: z.enum(['monster', 'item', 'trap', 'npc', 'fixture', 'objective']),
  required: z.boolean().default(false),
  tags: z.array(slug).default([]),
});
const light = z.strictObject({
  idSuffix: slug,
  glyph,
  presentationToken: stableIdSchema,
  color: rgb,
  radius: z.number().int().min(1).max(32),
  strength: z.number().int().min(1).max(255),
  enabled: z.boolean().default(true),
});
const legendEntry = z.strictObject({
  terrain: z.enum(['wall', 'floor', 'closed-door', 'pillar', 'stair-up', 'stair-down', 'void']),
  entrance: z.boolean().default(false),
  light: light.nullable().default(null),
  slot: slot.nullable().default(null),
}).superRefine((entry, context) => {
  const actionCount = Number(entry.entrance) + Number(entry.light !== null) + Number(entry.slot !== null);
  if (actionCount > 1) {
    context.addIssue({
      code: 'custom',
      path: [],
      message: 'legend entry may declare at most one entrance, light, or slot action',
    });
  }
});
const common = {
  id: stableIdSchema,
  name: z.string().trim().min(1).max(80),
  glyph,
  color,
  tags: z.array(slug).default([]),
};

const rotations = z.array(z.union([
  z.literal(0), z.literal(90), z.literal(180), z.literal(270),
])).min(1).max(4).superRefine((values, context) => {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1]! >= values[index]!) {
      context.addIssue({
        code: 'custom',
        path: [index],
        message: 'rotations must be unique and sorted in numeric order',
      });
      return;
    }
  }
});

const layoutRow = z.string()
  .min(1)
  .refine((value) => [...value].length <= 160, 'layout row exceeds 160 code points');

const vaultEntry = z.strictObject({
  kind: z.literal('vault'),
  id: stableIdSchema,
  name: z.string().trim().min(1).max(80),
  tags: z.array(slug).default([]),
  minDepth: z.number().int().safe().positive(),
  maxDepth: z.number().int().safe().positive(),
  rarity: z.enum(['common', 'uncommon', 'rare', 'legendary']),
  weight: z.number().int().safe().positive(),
  maxPerFloor: z.number().int().safe().positive(),
  margin: z.number().int().safe().nonnegative(),
  transforms: z.strictObject({
    rotations,
    reflectHorizontal: z.boolean().default(false),
  }),
  layout: z.array(layoutRow).min(1).max(100),
  legend: z.record(z.string(), legendEntry),
}).superRefine((entry, context) => {
  if (entry.maxDepth < entry.minDepth) {
    context.addIssue({
      code: 'custom',
      path: ['maxDepth'],
      message: 'maximum depth must be greater than or equal to minimum depth',
    });
  }
});

const rawContentEntrySchema = z.discriminatedUnion('kind', [
  z.object({
    ...common,
    kind: z.literal('monster'),
    ai: stableIdSchema,
    runAppearanceChance: z.number().min(0).max(1).default(1),
    stats: z.object({
      health: z.number().int().positive(),
      attack: z.number().int().nonnegative(),
      defense: z.number().int().nonnegative(),
    }).strict(),
  }).strict(),
  z.object({
    ...common,
    kind: z.literal('item'),
    effect: stableIdSchema,
    price: z.number().int().nonnegative(),
  }).strict(),
  vaultEntry,
]);

export const contentEntrySchema = rawContentEntrySchema.transform((entry) => {
  if (entry.kind !== 'vault') return entry;
  let entranceCount = 0;
  const requiredSlotIds = new Set<string>();
  for (const row of entry.layout) {
    for (const symbol of row) {
      const legend = entry.legend[symbol];
      if (legend?.entrance) entranceCount += 1;
      if (legend?.slot?.required) requiredSlotIds.add(legend.slot.id);
    }
  }
  return {
    ...entry,
    entranceCount,
    requiredSlotIds: [...requiredSlotIds].sort((left, right) => left < right ? -1 : left > right ? 1 : 0),
  };
});

export const contentFileSchema = z.object({
  schemaVersion: z.literal(1),
  entries: z.array(contentEntrySchema).min(1),
}).strict();
