import { z } from 'zod';
import type { ItemCategory } from '../../model.js';
import { ITEM_CATEGORIES } from '../../model.js';
import { base, probability, safeNonNegative, safePositive, stableIdSchema } from './common.js';

// `currency` is excluded structurally: coins are not an offering, they are a transaction, and the
// merchant economy is the place for that. Every other category is authorable.
const OFFERABLE_CATEGORIES = ITEM_CATEGORIES.filter(
  (category) => category !== 'currency',
) as readonly ItemCategory[];

// zod4's `z.enum(...)`/invalid-option issues never echo the offending value into the message
// text (only into `path`, which is useless here since these are array elements, not record
// keys), so the "unknown category" and "currency is excluded" cases are enforced with a
// superRefine that names the value explicitly instead of the brief's literal `z.enum(...)`.
function categoryList(options?: { readonly minLength?: number }) {
  let arraySchema = z.array(z.string());
  if (options?.minLength !== undefined) arraySchema = arraySchema.min(options.minLength);
  return arraySchema.readonly().superRefine((values, context) => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      if (!(OFFERABLE_CATEGORIES as readonly string[]).includes(value)) {
        context.addIssue({
          code: 'custom',
          path: [index],
          message: `${value} is not an offerable item category (currency is never a valid offering)`,
        });
      }
      if (seen.has(value)) {
        context.addIssue({
          code: 'custom',
          path: [index],
          message: `duplicate item category in an appeasement list: ${value}`,
        });
      }
      seen.add(value);
    });
  }) as unknown as z.ZodType<readonly ItemCategory[]>;
}

export const fallenChampionTemplateEntry = z
  .strictObject({
    ...base,
    kind: z.literal('fallen-champion-template'),
    fallbackMonsterId: stableIdSchema,
    fallbackItemId: stableIdSchema,
    minimumHealth: safePositive,
    maximumHealth: safePositive,
    attributeMaximum: safePositive,
    damageMaximum: safePositive,
    abilityLimit: safeNonNegative,
    echoAppearanceChance: probability,
    maximumEchoesPerRun: safePositive.max(9),
    echoHealthPercent: safePositive.max(99),
    echoDamagePercent: safePositive.max(99),
    echoDefensePercent: safePositive.max(99),
    echoAbilityLimit: safeNonNegative,
    echoLootTableId: stableIdSchema,
    heirloomSelection: z.strictObject({
      rarityWeights: z.strictObject({
        common: safePositive,
        uncommon: safePositive,
        rare: safePositive,
        legendary: safePositive,
      }),
      qualityRankBonus: safeNonNegative,
    }),
    appeasement: z.strictObject({
      classFavors: z.record(z.string().min(1).max(80), categoryList()).default({}),
      causelessCategories: categoryList().default([]),
      defaultCategories: categoryList({ minLength: 1 }),
    }),
  })
  .superRefine((entry, context) => {
    if (entry.maximumHealth < entry.minimumHealth) {
      context.addIssue({
        code: 'custom',
        path: ['maximumHealth'],
        message: 'maximum health must be at least minimum health',
      });
    }
    if (entry.echoAppearanceChance > 0 && entry.echoAbilityLimit >= entry.abilityLimit) {
      context.addIssue({
        code: 'custom',
        path: ['echoAbilityLimit'],
        message: 'Echo ability limit must be strictly below Champion ability limit',
      });
    }
    const weights = entry.heirloomSelection.rarityWeights;
    if (!(
      weights.common <= weights.uncommon &&
      weights.uncommon <= weights.rare &&
      weights.rare <= weights.legendary
    )) {
      context.addIssue({
        code: 'custom',
        path: ['heirloomSelection', 'rarityWeights'],
        message: 'rarity weights must be nondecreasing from common through legendary',
      });
    }
  });
