import { z } from 'zod';
import { base, probability, safeNonNegative, safePositive, stableIdSchema } from './common.js';

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
