import { z } from 'zod';
import { DERIVED_STAT_NAMES } from '../../model.js';
import {
  base,
  equipmentSlots,
  glyph,
  safeNonZeroInteger,
  safePositive,
  slugSchema,
  stableIdSchema,
} from './common.js';

const derivedStatModifiers = z.partialRecord(z.enum(DERIVED_STAT_NAMES), safeNonZeroInteger);

const classKitEquippedItem = z.strictObject({
  contentId: stableIdSchema,
  slot: z.enum(equipmentSlots),
  // Optional (not defaulted): only light items may carry `enabled` at all --
  // content-validation's classIssues rule rejects it on any other item. Kit
  // authors must omit it entirely for non-light equipped lines.
  enabled: z.boolean().optional(),
});
const classKitBackpackItem = z.strictObject({
  contentId: stableIdSchema,
  quantity: safePositive.default(1),
});
const classKitDefinition = z.strictObject({
  kitId: slugSchema,
  name: z.string().trim().min(1).max(80),
  equipped: z.array(classKitEquippedItem),
  backpack: z.array(classKitBackpackItem),
});

export const classEntry = z
  .strictObject({
    ...base,
    kind: z.literal('class'),
    description: z.string().trim().min(1).max(300),
    playable: z.boolean(),
    silhouetteGlyph: glyph,
    unlockHint: z.string().trim().min(1).max(200).nullable(),
    classTags: z.array(slugSchema).min(1),
    kits: z.array(classKitDefinition).max(3),
    modifiers: derivedStatModifiers.optional(),
    startingSpellIds: z.array(stableIdSchema).optional(),
  })
  .superRefine((entry, context) => {
    if (entry.playable) {
      if (entry.unlockHint !== null) {
        context.addIssue({
          code: 'custom',
          path: ['unlockHint'],
          message: 'a playable class must not declare an unlockHint',
        });
      }
    } else if (entry.unlockHint === null) {
      context.addIssue({
        code: 'custom',
        path: ['unlockHint'],
        message: 'a locked class requires a non-empty unlockHint',
      });
    }
  });

export const backgroundEntry = z.strictObject({
  ...base,
  kind: z.literal('background'),
  description: z.string().trim().min(1).max(300),
  modifiers: derivedStatModifiers,
  extraItems: z.array(classKitBackpackItem),
});

export const traitEntry = z
  .strictObject({
    ...base,
    kind: z.literal('trait'),
    description: z.string().trim().min(1).max(300),
    modifiers: derivedStatModifiers,
  })
  .superRefine((entry, context) => {
    if (Object.keys(entry.modifiers).length !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['modifiers'],
        message: 'a trait must declare exactly one modifier',
      });
    }
  });
