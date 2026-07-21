import fc from 'fast-check';
import {
  createDemoContentPack,
  emptyEquipment,
  type ActorState,
  type FactionReputation,
  type MerchantServiceState,
  type Uint32State,
} from '../src/index.js';
import type {
  ContentEntry,
  EncounterContentEntry,
  ItemContentEntry,
  LootTableContentEntry,
  MerchantEncounterContentEntry,
  NpcContentEntry,
  NpcFactionContentEntry,
} from '@woven-deep/content';

const identifierPart = fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/);

// fast-check's synchronous runner never yields between property runs, so a 500-run block of
// full gameplay simulations blocks the Vitest worker's event loop for many seconds. On a
// 2-core CI runner that outlasts the worker-RPC heartbeat and surfaces as "Timeout calling
// onTaskUpdate". Cap the run count under CI so each block stays well under that window while
// still exercising ~100 seeds per property; local and pre-merge runs keep the full count.
export const propertyRuns = (full: number): number => (process.env.CI ? Math.min(full, 100) : full);

export const currencyArbitrary = fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER });

export const factionReputationArbitrary: fc.Arbitrary<FactionReputation> = fc.record({
  factionId: identifierPart.map((suffix) => `npc-faction.${suffix}`),
  value: fc.integer({ min: -1_000, max: 1_000 }),
});

export const merchantServiceStateArbitrary: fc.Arbitrary<MerchantServiceState> = fc.record({
  serviceId: fc.constant('merchant-service.identify' as const),
  basePrice: currencyArbitrary,
  remainingUses: fc.integer({ min: 0, max: 100 }),
  tierIds: fc.uniqueArray(identifierPart, { maxLength: 8 }).map((ids) => ids.sort()),
});

function actor(
  input: Readonly<{
    actorId: string;
    playerControlled: boolean;
    health: number;
    energy: number;
    speed: number;
  }>,
): ActorState {
  return {
    actorId: input.actorId,
    contentId: input.playerControlled ? 'hero.adventurer' : 'monster.test',
    playerControlled: input.playerControlled,
    floorId: 'floor.test',
    x: 0,
    y: 0,
    attributes: { might: 10, agility: 10, vitality: 10, wits: 10, resolve: 10 },
    health: input.health,
    maxHealth: Math.max(1, input.health),
    weave: input.playerControlled ? Math.max(1, input.health) : 0,
    maxWeave: input.playerControlled ? Math.max(1, input.health) : 0,
    energy: input.energy,
    speed: input.speed,
    reactionReady: true,
    disposition: input.playerControlled ? 'friendly' : 'hostile',
    awareActorIds: [],
    conditions: [],
    equipment: emptyEquipment(),
    behaviorId: input.playerControlled ? null : 'behavior.approach-and-attack',
    behaviorState: { intent: 'hold', goal: null, lastKnownTargets: [], investigation: null },
    populationId: null,
    populationRoleId: null,
    populationPresentation: null,
  };
}

export const actorStateArbitrary: fc.Arbitrary<ActorState> = fc
  .record({
    suffix: identifierPart,
    playerControlled: fc.boolean(),
    health: fc.integer({ min: 0, max: 100 }),
    energy: fc.integer({ min: -10_000, max: 10_000 }),
    speed: fc.integer({ min: 1, max: 400 }),
  })
  .map(({ suffix, ...input }) => actor({ actorId: `actor.${suffix}`, ...input }));

export const schedulerStateArbitrary = fc
  .record({
    worldTime: fc.integer({ min: 0, max: 1_000_000 }),
    hero: fc.record({
      health: fc.integer({ min: 1, max: 100 }),
      energy: fc.integer({ min: -10_000, max: 10_000 }),
      speed: fc.integer({ min: 1, max: 400 }),
    }),
    enemies: fc.uniqueArray(
      fc.record({
        suffix: identifierPart,
        health: fc.integer({ min: 0, max: 100 }),
        energy: fc.integer({ min: -10_000, max: 10_000 }),
        speed: fc.integer({ min: 1, max: 400 }),
      }),
      { selector: ({ suffix }) => suffix, maxLength: 12 },
    ),
  })
  .map(({ worldTime, hero, enemies }) => ({
    worldTime,
    content: createDemoContentPack(),
    actors: [
      actor({ actorId: 'hero.test', playerControlled: true, ...hero }),
      ...enemies.map(({ suffix, ...enemy }) =>
        actor({ actorId: `monster.${suffix}`, playerControlled: false, ...enemy }),
      ),
    ].sort((left, right) =>
      left.actorId < right.actorId ? -1 : left.actorId > right.actorId ? 1 : 0,
    ),
  }));

export const encounterGateInputArbitrary = fc
  .uniqueArray(
    fc.record({
      suffix: identifierPart,
      baseUnits: fc.integer({ min: 0, max: 80 }),
      roomUnits: fc.integer({ min: 0, max: 20 }),
      incrementUnits: fc.integer({ min: 0, max: 20 }),
    }),
    { selector: ({ suffix }) => suffix, minLength: 1, maxLength: 12 },
  )
  .chain((definitions) => {
    const encounters = definitions.map(
      ({ suffix, baseUnits, roomUnits, incrementUnits }): EncounterContentEntry => ({
        kind: 'encounter',
        id: `encounter.${suffix}`,
        name: suffix,
        adminDescription: null,
        tags: [],
        model: 'individual',
        minDepth: 1,
        maxDepth: 10,
        environmentTags: [],
        requiredVaultTags: [],
        weight: 1,
        rarity: 'common',
        runAppearanceChance: baseUnits / 100,
        discoveryProtectionIncrement: incrementUnits / 100,
        discoveryProtectionCap: (baseUnits + roomUnits) / 100,
        maximumInstancesPerRun: 1,
        placement: {
          minimumStairDistance: 0,
          minimumObjectiveDistance: 0,
          maximumMemberDistance: 0,
          allowedTerrainTags: [],
          requiresVaultSlot: false,
          failureMode: 'optional',
        },
        intentPresentation: { visible: true },
        definition: { monsterId: 'monster.test', minimumQuantity: 1, maximumQuantity: 1 },
      }),
    );
    return fc
      .tuple(
        fc.constant(encounters),
        fc.array(fc.integer({ min: 0, max: 20 }), {
          minLength: encounters.length,
          maxLength: encounters.length,
        }),
        fc.tuple(fc.nat(), fc.nat(), fc.nat(), fc.integer({ min: 1, max: 0xffff_ffff })),
      )
      .map(([entries, bonusUnits, randomState]) => ({
        encounters: entries,
        bonuses: entries
          .map((entry, index) => ({
            encounterId: entry.id,
            bonus: Math.min(
              bonusUnits[index]! / 100,
              entry.discoveryProtectionCap - entry.runAppearanceChance,
            ),
          }))
          .sort((left, right) =>
            left.encounterId < right.encounterId
              ? -1
              : left.encounterId > right.encounterId
                ? 1
                : 0,
          ),
        state: randomState as Uint32State,
      }));
  });

export interface MerchantCommandPlan {
  readonly kind: 'open' | 'buy' | 'sell' | 'service' | 'close' | 'wait' | 'attack';
  readonly pick: number;
  readonly quantity: number;
}

export interface MerchantPropertyScenario {
  readonly entries: readonly ContentEntry[];
  readonly encounterId: 'encounter.property-merchant';
  readonly factionId: 'npc-faction.property';
  readonly heroCurrency: number;
  readonly plans: readonly MerchantCommandPlan[];
}

const merchantCommandPlanArbitrary: fc.Arbitrary<MerchantCommandPlan> = fc.record({
  kind: fc.constantFrom('open', 'buy', 'sell', 'service', 'close', 'wait', 'attack'),
  pick: fc.nat({ max: 15 }),
  quantity: fc.integer({ min: 1, max: 3 }),
});

/**
 * Valid-by-construction merchant content inside compiler bounds (positive prices/bps within
 * basis-point limits, tiers exactly covering the faction range, warnings strictly descending
 * below the minimum lifetime, drop fraction in [0, 1]) plus a mixed ordinary/trade command plan.
 */
export const merchantPropertyScenarioArbitrary: fc.Arbitrary<MerchantPropertyScenario> = fc
  .record({
    price: fc.integer({ min: 1, max: 500 }),
    stackLimit: fc.integer({ min: 1, max: 9 }),
    saleBps: fc.integer({ min: 1, max: 30_000 }),
    purchaseBps: fc.integer({ min: 1, max: 30_000 }),
    stockRollBounds: fc.tuple(fc.integer({ min: 1, max: 3 }), fc.integer({ min: 1, max: 3 })),
    lifetimeBounds: fc.tuple(
      fc.integer({ min: 300, max: 5_000 }),
      fc.integer({ min: 300, max: 5_000 }),
    ),
    warningCount: fc.integer({ min: 0, max: 3 }),
    aggressionResponse: fc.constantFrom('flee', 'self-defense'),
    commerceDelta: fc.integer({ min: 0, max: 60 }),
    aggressionDelta: fc.integer({ min: -400, max: 0 }),
    deathDelta: fc.integer({ min: -400, max: 0 }),
    stockDropPercent: fc.integer({ min: 0, max: 100 }),
    servicePrice: fc.integer({ min: 0, max: 60 }),
    serviceUseBounds: fc.tuple(fc.integer({ min: 0, max: 3 }), fc.integer({ min: 0, max: 3 })),
    tierCut: fc.integer({ min: -99, max: 99 }),
    lowTier: fc.record({
      purchasePriceBps: fc.integer({ min: 1, max: 20_000 }),
      salePriceBps: fc.integer({ min: 1, max: 20_000 }),
      acceptsTrade: fc.boolean(),
      identify: fc.boolean(),
    }),
    highTier: fc.record({
      purchasePriceBps: fc.integer({ min: 1, max: 20_000 }),
      salePriceBps: fc.integer({ min: 1, max: 20_000 }),
      acceptsTrade: fc.boolean(),
      identify: fc.boolean(),
    }),
    startingReputation: fc.integer({ min: -100, max: 100 }),
    heroCurrency: fc.integer({ min: 0, max: 2_000 }),
    plans: fc.array(merchantCommandPlanArbitrary, { minLength: 1, maxLength: 12 }),
  })
  .map((input) => {
    const factionId = 'npc-faction.property' as const;
    const npc: NpcContentEntry = {
      kind: 'npc',
      id: 'npc.property-merchant',
      name: 'Property Merchant',
      tags: ['merchant'],
      glyph: '$',
      color: '#ffaa00',
      factionId,
      attributes: { might: 6, agility: 8, vitality: 9, wits: 10, resolve: 9 },
      health: 18,
      speed: 100,
      perception: 8,
      accuracy: 4,
      defense: 8,
      damage: { count: 1, sides: 3, bonus: 0 },
      armor: 0,
      resistances: { physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0, arcane: 0 },
      disposition: 'neutral',
      behaviorId: 'npc-behavior.travelling-merchant',
      behaviorParameters: {},
      selfPreservationThresholdBps: 3_500,
    };
    const stockItem: ItemContentEntry = {
      kind: 'item',
      id: 'item.property-stock',
      name: 'Property Stock',
      tags: [],
      glyph: '!',
      color: '#ffffff',
      category: 'potion',
      stackLimit: input.stackLimit,
      price: input.price,
      rarity: 'common',
      heirloomEligible: false,
      minDepth: 1,
      maxDepth: 10,
      actionCost: 100,
      equipment: null,
      combat: null,
      light: null,
      identification: { mode: 'known', poolId: null },
      effects: [],
    };
    const trinket: ItemContentEntry = {
      ...stockItem,
      id: 'item.property-trinket',
      name: 'Property Trinket',
      category: 'ring',
      identification: { mode: 'instance', poolId: 'identification-pool.property' },
    };
    const trinketPool: ContentEntry = {
      kind: 'identification-pool',
      id: 'identification-pool.property',
      name: 'Property pool',
      tags: [],
      category: 'ring',
      verbs: ['Odd'],
      nouns: ['band'],
      visuals: [{ id: 'visual.property-band', glyph: '=', color: '#888888' }],
    };
    const stockTable: LootTableContentEntry = {
      kind: 'loot-table',
      id: 'loot-table.property-stock',
      name: 'Property Stock',
      tags: [],
      rolls: 1,
      choices: [
        {
          contentId: stockItem.id,
          lootTableId: null,
          weight: 1,
          minimumQuantity: 1,
          maximumQuantity: Math.min(2, input.stackLimit),
        },
      ],
    };
    const tiers = [
      {
        tierId: 'low',
        name: 'Low',
        minimum: -100,
        maximum: input.tierCut,
        purchasePriceBps: input.lowTier.purchasePriceBps,
        salePriceBps: input.lowTier.salePriceBps,
        acceptsTrade: input.lowTier.acceptsTrade,
        serviceIds: input.lowTier.identify ? ['merchant-service.identify' as const] : [],
      },
      {
        tierId: 'high',
        name: 'High',
        minimum: input.tierCut + 1,
        maximum: 100,
        purchasePriceBps: input.highTier.purchasePriceBps,
        salePriceBps: input.highTier.salePriceBps,
        acceptsTrade: input.highTier.acceptsTrade,
        serviceIds: input.highTier.identify ? ['merchant-service.identify' as const] : [],
      },
    ];
    const faction: NpcFactionContentEntry = {
      kind: 'npc-faction',
      id: factionId,
      name: 'Property Faction',
      tags: [],
      minimumReputation: -100,
      maximumReputation: 100,
      startingReputation: input.startingReputation,
      tiers,
    };
    const serviceTierIds = tiers
      .filter((tier) => tier.serviceIds.length > 0)
      .map((tier) => tier.tierId)
      .sort();
    const [rollA, rollB] = input.stockRollBounds;
    const [lifeA, lifeB] = input.lifetimeBounds;
    const minimumLifetime = Math.min(lifeA, lifeB);
    const [useA, useB] = input.serviceUseBounds;
    const warningThresholds = [
      Math.floor(minimumLifetime / 2),
      Math.floor(minimumLifetime / 4),
      Math.floor(minimumLifetime / 8),
    ]
      .slice(0, input.warningCount)
      .filter((threshold, index, all) => threshold > 0 && all.indexOf(threshold) === index);
    const encounter: MerchantEncounterContentEntry = {
      kind: 'encounter',
      id: 'encounter.property-merchant',
      name: 'Property Merchant',
      adminDescription: null,
      tags: ['merchant'],
      model: 'merchant',
      minDepth: 1,
      maxDepth: 10,
      environmentTags: [],
      requiredVaultTags: [],
      weight: 1,
      rarity: 'uncommon',
      runAppearanceChance: 1,
      discoveryProtectionIncrement: 0,
      discoveryProtectionCap: 1,
      maximumInstancesPerRun: 1,
      placement: {
        minimumStairDistance: 0,
        minimumObjectiveDistance: 0,
        maximumMemberDistance: 0,
        allowedTerrainTags: ['floor'],
        requiresVaultSlot: false,
        failureMode: 'optional',
      },
      intentPresentation: { visible: true },
      definition: {
        npcId: npc.id,
        stockLootTableId: stockTable.id,
        minimumStockRolls: Math.min(rollA, rollB),
        maximumStockRolls: Math.max(rollA, rollB),
        merchantSaleBps: input.saleBps,
        merchantPurchaseBps: input.purchaseBps,
        acceptedCategories: ['potion'],
        services:
          serviceTierIds.length === 0
            ? []
            : [
                {
                  serviceId: 'merchant-service.identify',
                  basePrice: input.servicePrice,
                  minimumUses: Math.min(useA, useB),
                  maximumUses: Math.max(useA, useB),
                  tierIds: serviceTierIds,
                },
              ],
        minimumLifetime,
        maximumLifetime: Math.max(lifeA, lifeB),
        departureWarningThresholds: warningThresholds,
        aggressionResponse: input.aggressionResponse,
        commerceReputationDelta: input.commerceDelta,
        aggressionReputationDelta: input.aggressionDelta,
        deathReputationDelta: input.deathDelta,
        stockDropFraction: input.stockDropPercent / 100,
      },
    } as MerchantEncounterContentEntry;
    return {
      entries: [
        faction,
        npc,
        stockItem,
        trinket,
        trinketPool,
        stockTable,
        encounter,
      ] as readonly ContentEntry[],
      encounterId: encounter.id as 'encounter.property-merchant',
      factionId,
      heroCurrency: input.heroCurrency,
      plans: input.plans,
    };
  });

export { actor };
