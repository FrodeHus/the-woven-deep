import { z } from 'zod';
import {
  attributes,
  depthRange,
  diceSchema,
  dispositions,
  itemRarities,
  jsonObject,
  presented,
  probability,
  resistances,
  safeInteger,
  safeNonNegative,
  safePositive,
  stableIdSchema,
} from './common.js';

/**
 * A condition riding this monster's attacks. Riders are authored sorted and unique by
 * `conditionId` so the engine's per-rider chance rolls always draw in a fixed order.
 */
const onHitCondition = z.strictObject({
  conditionId: stableIdSchema,
  chance: probability,
  duration: safePositive.nullable().default(null),
});

export const monsterEntry = z
  .strictObject({
    ...presented,
    ...depthRange,
    kind: z.literal('monster'),
    attributes,
    health: safePositive,
    speed: safePositive,
    accuracy: safeInteger,
    defense: safeInteger,
    perception: safeNonNegative,
    damage: diceSchema,
    armor: safeNonNegative,
    resistances,
    disposition: z.enum(dispositions),
    behaviorId: stableIdSchema,
    behaviorParameters: jsonObject.default({}),
    threat: safeNonNegative,
    rarity: z.enum(itemRarities),
    lootTableId: stableIdSchema.nullable().default(null),
    dropChance: probability.default(1),
    onHitConditions: z.array(onHitCondition).default([]),
  })
  .superRefine((entry, context) => {
    if (entry.maxDepth < entry.minDepth)
      context.addIssue({
        code: 'custom',
        path: ['maxDepth'],
        message: 'maximum depth must be greater than or equal to minimum depth',
      });
    for (let index = 1; index < entry.onHitConditions.length; index += 1) {
      if (
        entry.onHitConditions[index - 1]!.conditionId >= entry.onHitConditions[index]!.conditionId
      ) {
        context.addIssue({
          code: 'custom',
          path: ['onHitConditions', index],
          message: 'on-hit conditions must be unique and sorted by condition id',
        });
        break;
      }
    }
  });
