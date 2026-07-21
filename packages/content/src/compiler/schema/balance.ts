import { z } from 'zod';
import { DERIVED_STAT_NAMES } from '../../model.js';
import { base, safeInteger, safeNonNegative, safePositive, stableIdSchema } from './common.js';

const scoreCoefficients = z.strictObject({
  depthCoefficient: safeNonNegative,
  bossDefeatCoefficient: safeNonNegative,
  threatCoefficient: safeNonNegative,
  discoveryCoefficient: safeNonNegative,
  completionBonus: z.strictObject({
    died: safeNonNegative,
    'became-heart': safeNonNegative,
    refused: safeNonNegative,
    'broke-cycle': safeNonNegative,
  }),
  turnEfficiencyBudget: safeNonNegative,
  turnEfficiencyDecayInterval: safePositive,
});

export const balanceEntry = z
  .strictObject({
    ...base,
    kind: z.literal('balance'),
    startingCurrency: safeNonNegative,
    readinessThreshold: safePositive,
    normalActionCost: safePositive,
    speedMinimum: safePositive,
    speedMaximum: safePositive,
    energyMinimum: safeInteger,
    energyMaximum: safeInteger,
    attributeMinimum: safeNonNegative,
    attributeMaximum: safeNonNegative,
    hungerMaximum: safePositive,
    hungerThresholds: z.strictObject({
      hungry: safeNonNegative,
      weak: safeNonNegative,
      starving: safeNonNegative,
    }),
    starvationInterval: safePositive,
    starvationDamage: safePositive,
    recoveryInterval: safePositive,
    recoveryAmount: safeNonNegative,
    weaveRegenAmount: safeNonNegative,
    restMaximumDuration: safePositive,
    recoveryByHungerStage: z.strictObject({
      sated: safeNonNegative.max(100),
      hungry: safeNonNegative.max(100),
      weak: safeNonNegative.max(100),
      starving: safeNonNegative.max(100),
    }),
    hungerStageModifiers: z.strictObject({
      sated: z.partialRecord(z.enum(DERIVED_STAT_NAMES), safeInteger),
      hungry: z.partialRecord(z.enum(DERIVED_STAT_NAMES), safeInteger),
      weak: z.partialRecord(z.enum(DERIVED_STAT_NAMES), safeInteger),
      starving: z.partialRecord(z.enum(DERIVED_STAT_NAMES), safeInteger),
    }),
    formulas: z.record(z.string(), z.record(z.string(), safeInteger)),
    actionCosts: z.record(stableIdSchema, safeNonNegative),
    score: scoreCoefficients,
    pointBuy: z.strictObject({
      budget: safePositive,
      costs: z.array(z.strictObject({ value: safeInteger, cost: safeNonNegative })),
    }),
    restockMilestones: z.array(safePositive),
    house: z.strictObject({
      baseCapacity: safePositive,
      strongboxIncrement: safePositive,
    }),
    encounterDensity: z.strictObject({
      cellsPerEncounter: safePositive,
    }),
  })
  .superRefine((entry, context) => {
    let previousMilestone = 0;
    entry.restockMilestones.forEach((milestone, index) => {
      if (milestone <= previousMilestone) {
        context.addIssue({
          code: 'custom',
          path: ['restockMilestones', index],
          message: 'restock milestones must be strictly increasing positive integers',
        });
      }
      previousMilestone = milestone;
    });
    const { starving, weak, hungry } = entry.hungerThresholds;
    if (!(starving <= weak && weak <= hungry && hungry < entry.hungerMaximum)) {
      context.addIssue({
        code: 'custom',
        path: ['hungerThresholds'],
        message: 'hunger thresholds must satisfy starving <= weak <= hungry < hungerMaximum',
      });
    }
    const costs = entry.pointBuy.costs;
    const expectedValues: number[] = [];
    for (let value = entry.attributeMinimum; value <= entry.attributeMaximum; value += 1)
      expectedValues.push(value);
    const actualValues = costs.map((row) => row.value);
    const coversRange =
      expectedValues.length === actualValues.length &&
      expectedValues.every((value, index) => value === actualValues[index]);
    if (!coversRange) {
      context.addIssue({
        code: 'custom',
        path: ['pointBuy', 'costs'],
        message: `point-buy costs must cover every value from attributeMinimum to attributeMaximum without gaps or duplicates`,
      });
    } else {
      for (let index = 1; index < costs.length; index += 1) {
        if (costs[index]!.cost < costs[index - 1]!.cost) {
          context.addIssue({
            code: 'custom',
            path: ['pointBuy', 'costs', index, 'cost'],
            message: 'point-buy costs must be non-decreasing across the attribute value range',
          });
          break;
        }
      }
    }
  });
