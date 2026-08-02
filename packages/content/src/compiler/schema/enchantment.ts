import { z } from 'zod';
import type { ItemCategory } from '../../model/common.js';
import { DERIVED_STAT_NAMES, ITEM_CATEGORIES } from '../../model/common.js';
import { base } from './common.js';

const ENCHANTABLE_CATEGORIES: ReadonlySet<string> = new Set(
  ITEM_CATEGORIES.filter((category) => category !== 'currency'),
);

// A positive integer with a message that names "positive" explicitly: zod4's default `.positive()`
// message ("Too big: expected number to be <0" / "Too small: expected number to be >0") never uses
// the word, and the compile test asserts on it.
const positiveModifierAmount = z
  .number()
  .int()
  .safe()
  .positive({ message: 'enchantment modifiers must be positive safe integers' });

// zod4's `z.enum(...)` invalid-option issue for an array element never echoes the offending value
// into the message text (only into `path`, a bare numeric index here, not a record key like
// #121's curse-drawback lookup), so "unknown category" is enforced with a superRefine that names
// the value explicitly, matching the pattern `schema/champion.ts`'s `categoryList` already uses.
const categories = z
  .array(z.string())
  .min(1)
  .readonly()
  .superRefine((values, context) => {
    values.forEach((value, index) => {
      if (!ENCHANTABLE_CATEGORIES.has(value)) {
        context.addIssue({
          code: 'custom',
          path: [index],
          message: `${value} is not an enchantable item category (currency is never a valid target)`,
        });
      }
    });
  }) as unknown as z.ZodType<readonly ItemCategory[]>;

export const enchantmentEntry = z.strictObject({
  ...base,
  kind: z.literal('enchantment'),
  categories,
  // Positive only: enchanting gambles on magnitude, never on sign. A drawback is a curse's job,
  // and #121's compile rule already owns that half of the design. `partialRecord` (not `record`)
  // because zod4's `record(enum, ...)` requires every enum member present, and an enchantment
  // legitimately grants a subset of derived stats.
  modifiers: z
    .partialRecord(z.enum(DERIVED_STAT_NAMES), positiveModifierAmount)
    .refine((value) => Object.keys(value).length > 0, {
      message: 'an enchantment must grant at least one positive modifier',
    }),
  weight: z.number().int().safe().positive(),
});
