import { z } from 'zod';

const id = z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/);
const slug = z.string().regex(/^[a-z][a-z0-9-]*$/);
const glyph = z.string().refine((value) => [...value].length === 1, 'must be one Unicode glyph');
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const common = {
  id,
  name: z.string().trim().min(1).max(80),
  glyph,
  color,
  tags: z.array(slug).default([]),
};

export const contentEntrySchema = z.discriminatedUnion('kind', [
  z.object({
    ...common,
    kind: z.literal('monster'),
    ai: id,
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
    effect: id,
    price: z.number().int().nonnegative(),
  }).strict(),
]);

export const contentFileSchema = z.object({
  schemaVersion: z.literal(1),
  entries: z.array(contentEntrySchema).min(1),
}).strict();
