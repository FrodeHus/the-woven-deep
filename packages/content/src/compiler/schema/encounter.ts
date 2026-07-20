import { z } from 'zod';
import {
  base,
  color,
  depthRange,
  effect,
  encounterFormations,
  encounterPlacementFailureModes,
  formationPreferences,
  glyph,
  groupCollapseRewards,
  itemCategories,
  itemRarities,
  jsonObject,
  leaderDeathResponses,
  merchantAggressionResponses,
  merchantServiceIds,
  probability,
  safeInteger,
  safeNonNegative,
  safePositive,
  slugSchema,
  stableIdSchema,
  swarmDestructionResponses,
} from './common.js';

const populationModifiers = z.strictObject({
  accuracy: safeInteger,
  defense: safeInteger,
  damage: safeInteger,
});

const encounterPlacement = z.strictObject({
  minimumStairDistance: safeNonNegative,
  minimumObjectiveDistance: safeNonNegative,
  maximumMemberDistance: safeNonNegative,
  allowedTerrainTags: z.array(slugSchema).min(1),
  requiresVaultSlot: z.boolean(),
  failureMode: z.enum(encounterPlacementFailureModes),
});

const encounterIntentPresentation = z.strictObject({ visible: z.boolean() });

const encounterCommon = {
  ...base,
  ...depthRange,
  kind: z.literal('encounter'),
  adminDescription: z.string().trim().min(1).max(500).nullable().default(null),
  environmentTags: z.array(slugSchema),
  requiredVaultTags: z.array(slugSchema),
  weight: safePositive,
  rarity: z.enum(itemRarities),
  runAppearanceChance: probability,
  discoveryProtectionIncrement: probability.optional(),
  discoveryProtectionCap: probability.optional(),
  maximumInstancesPerRun: safePositive,
  placement: encounterPlacement,
  intentPresentation: encounterIntentPresentation,
} as const;

const quantityRange = {
  minimumQuantity: safePositive,
  maximumQuantity: safePositive,
} as const;

type IssueSink = {
  addIssue: (issue: { code: 'custom'; path: (string | number)[]; message: string }) => void;
};
type EncounterDepth = { minDepth: number; maxDepth: number };
type EncounterDiscovery = {
  runAppearanceChance: number;
  discoveryProtectionIncrement?: number | undefined;
  discoveryProtectionCap?: number | undefined;
};

const refineDepth = (entry: EncounterDepth, context: IssueSink): void => {
  if (entry.maxDepth < entry.minDepth) {
    context.addIssue({
      code: 'custom',
      path: ['maxDepth'],
      message: 'maximum depth must be greater than or equal to minimum depth',
    });
  }
};

// The four non-merchant encounter models must declare discovery-protection tuning;
// merchant encounters intentionally omit it (see the merchant branch below).
const refineDiscoveryProtection = (entry: EncounterDiscovery, context: IssueSink): void => {
  if (entry.discoveryProtectionIncrement === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['discoveryProtectionIncrement'],
      message: 'Invalid input: expected number, received undefined',
    });
  }
  if (entry.discoveryProtectionCap === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['discoveryProtectionCap'],
      message: 'Invalid input: expected number, received undefined',
    });
  }
  if (
    entry.discoveryProtectionCap !== undefined &&
    entry.discoveryProtectionCap < entry.runAppearanceChance
  ) {
    context.addIssue({
      code: 'custom',
      path: ['discoveryProtectionCap'],
      message: 'discovery protection cap must not be below run appearance chance',
    });
  }
};

const individualEncounterEntry = z
  .strictObject({
    ...encounterCommon,
    model: z.literal('individual'),
    definition: z.strictObject({
      monsterId: stableIdSchema,
      ...quantityRange,
    }),
  })
  .superRefine((entry, context) => {
    refineDepth(entry, context);
    refineDiscoveryProtection(entry, context);
    if (entry.definition.maximumQuantity < entry.definition.minimumQuantity) {
      context.addIssue({
        code: 'custom',
        path: ['definition', 'maximumQuantity'],
        message: 'maximum quantity must be at least minimum quantity',
      });
    }
  });

const groupEncounterEntry = z
  .strictObject({
    ...encounterCommon,
    model: z.literal('group'),
    definition: z.strictObject({
      roles: z
        .array(
          z.strictObject({
            roleId: slugSchema,
            monsterId: stableIdSchema,
            ...quantityRange,
            formationPreference: z.enum(formationPreferences),
            behaviorParameters: jsonObject.default({}),
          }),
        )
        .min(1),
      formation: z.enum(encounterFormations),
      communicationRadius: safePositive,
      leaderChance: probability,
      leaderRoleId: slugSchema,
      leaderAccentColor: color,
      leaderAlternateGlyph: glyph.nullable(),
      coordinationModifiers: populationModifiers,
      leaderDeathResponse: z.enum(leaderDeathResponses),
      responseParameters: jsonObject.default({}),
      supernaturalBond: z.boolean(),
      collapseRewards: z.enum(groupCollapseRewards),
    }),
  })
  .superRefine((entry, context) => {
    refineDepth(entry, context);
    refineDiscoveryProtection(entry, context);
    for (let index = 0; index < entry.definition.roles.length; index += 1) {
      const role = entry.definition.roles[index]!;
      if (role.maximumQuantity < role.minimumQuantity) {
        context.addIssue({
          code: 'custom',
          path: ['definition', 'roles', index, 'maximumQuantity'],
          message: 'maximum quantity must be at least minimum quantity',
        });
      }
    }
  });

const swarmEncounterEntry = z
  .strictObject({
    ...encounterCommon,
    model: z.literal('swarm'),
    definition: z.strictObject({
      sourceMonsterId: stableIdSchema,
      spawnRoles: z
        .array(
          z.strictObject({
            roleId: slugSchema,
            monsterId: stableIdSchema,
            weight: safePositive,
          }),
        )
        .min(1),
      spawnInterval: safePositive,
      minimumSpawnQuantity: safePositive,
      maximumSpawnQuantity: safePositive,
      placementRadius: safePositive,
      allowedTerrainTags: z.array(slugSchema).min(1),
      maximumLivingChildren: safePositive,
      maximumLivingMembers: safePositive,
      maximumFloorActors: safePositive,
      sourceDestructionResponse: z.enum(swarmDestructionResponses),
      responseParameters: jsonObject.default({}),
    }),
  })
  .superRefine((entry, context) => {
    refineDepth(entry, context);
    refineDiscoveryProtection(entry, context);
    if (entry.definition.maximumSpawnQuantity < entry.definition.minimumSpawnQuantity) {
      context.addIssue({
        code: 'custom',
        path: ['definition', 'maximumSpawnQuantity'],
        message: 'maximum spawn quantity must be at least minimum spawn quantity',
      });
    }
  });

const bossEncounterEntry = z
  .strictObject({
    ...encounterCommon,
    model: z.literal('boss'),
    definition: z.strictObject({
      monsterId: stableIdSchema,
      phases: z.array(
        z.strictObject({
          phaseId: slugSchema,
          healthThresholdPercent: safePositive.max(99),
          behaviorId: stableIdSchema,
          behaviorParameters: jsonObject.default({}),
          modifiers: populationModifiers,
          effects: z.array(effect),
        }),
      ),
      recoveryPerWorldTime: z.number().finite().nonnegative(),
      recoveryCapPercent: safeNonNegative.max(100),
      uniqueItemId: stableIdSchema,
      enhancedLootTableId: stableIdSchema,
      vaultTags: z.array(slugSchema),
    }),
  })
  .superRefine((entry, context) => {
    refineDepth(entry, context);
    refineDiscoveryProtection(entry, context);
  });

const merchantService = z
  .strictObject({
    serviceId: z.enum(merchantServiceIds),
    basePrice: safeNonNegative,
    minimumUses: safeNonNegative,
    maximumUses: safeNonNegative,
    tierIds: z.array(slugSchema).min(1),
  })
  .superRefine((service, context) => {
    if (
      service.serviceId === 'merchant-service.strongbox' &&
      (service.minimumUses !== 1 || service.maximumUses !== 1)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['minimumUses'],
        message: 'the strongbox service requires minimumUses and maximumUses of exactly 1',
      });
    }
  });
const merchantEncounterDefinition = z
  .strictObject({
    npcId: stableIdSchema,
    stockLootTableId: stableIdSchema,
    minimumStockRolls: safePositive,
    maximumStockRolls: safePositive,
    merchantSaleBps: safePositive,
    merchantPurchaseBps: safePositive,
    acceptedCategories: z.array(z.enum(itemCategories)).min(1),
    services: z.array(merchantService),
    // A permanent (town) merchant never departs and must omit every lifetime field below;
    // a non-permanent (dungeon-wandering) merchant must declare all three.
    permanent: z.boolean(),
    minimumLifetime: safePositive.optional(),
    maximumLifetime: safePositive.optional(),
    departureWarningThresholds: z.array(safePositive).optional(),
    aggressionResponse: z.enum(merchantAggressionResponses),
    commerceReputationDelta: safeInteger,
    aggressionReputationDelta: safeInteger,
    deathReputationDelta: safeInteger,
    stockDropFraction: probability,
  })
  .superRefine((definition, context) => {
    const hasAnyLifetimeField =
      definition.minimumLifetime !== undefined ||
      definition.maximumLifetime !== undefined ||
      definition.departureWarningThresholds !== undefined;
    if (definition.permanent && hasAnyLifetimeField) {
      context.addIssue({
        code: 'custom',
        path: ['permanent'],
        message:
          'a permanent merchant must not declare minimumLifetime, maximumLifetime, or departureWarningThresholds',
      });
    }
    const hasEveryLifetimeField =
      definition.minimumLifetime !== undefined &&
      definition.maximumLifetime !== undefined &&
      definition.departureWarningThresholds !== undefined;
    if (!definition.permanent && !hasEveryLifetimeField) {
      context.addIssue({
        code: 'custom',
        path: ['permanent'],
        message:
          'a non-permanent merchant requires minimumLifetime, maximumLifetime, and departureWarningThresholds',
      });
    }
  });

const merchantEncounterEntry = z
  .strictObject({
    ...encounterCommon,
    model: z.literal('merchant'),
    definition: merchantEncounterDefinition,
  })
  .superRefine((entry, context) => {
    refineDepth(entry, context);
  });

export const encounterEntry = z.discriminatedUnion('model', [
  individualEncounterEntry,
  groupEncounterEntry,
  swarmEncounterEntry,
  bossEncounterEntry,
  merchantEncounterEntry,
]);
