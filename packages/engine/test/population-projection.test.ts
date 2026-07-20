import { describe, expect, it } from 'vitest';
import type {
  EncounterContentEntry,
  MonsterContentEntry,
  NpcFactionContentEntry,
} from '@woven-deep/content';
import {
  createDemoContentPack,
  createDemoRun,
  projectGameplayState,
  stableJson,
  type ActiveRun,
  type MerchantPopulation,
} from '../src/index.js';

const monster: MonsterContentEntry = {
  kind: 'monster',
  id: 'monster.population',
  name: 'Watch Beetle',
  glyph: 'b',
  color: '#884422',
  tags: [],
  minDepth: 1,
  maxDepth: 20,
  attributes: { might: 5, agility: 5, vitality: 5, wits: 5, resolve: 5 },
  health: 12,
  speed: 100,
  accuracy: 1,
  defense: 8,
  perception: 8,
  damage: { count: 1, sides: 1, bonus: 0 },
  armor: 0,
  resistances: { physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0, arcane: 0 },
  disposition: 'hostile',
  behaviorId: 'behavior.approach-and-attack',
  behaviorParameters: {},
  rarity: 'common',
};

const encounter: EncounterContentEntry = {
  kind: 'encounter',
  id: 'encounter.population',
  name: 'Watch',
  adminDescription: null,
  tags: [],
  model: 'group',
  minDepth: 1,
  maxDepth: 10,
  environmentTags: [],
  requiredVaultTags: [],
  weight: 1,
  rarity: 'common',
  runAppearanceChance: 1,
  discoveryProtectionIncrement: 0,
  discoveryProtectionCap: 1,
  maximumInstancesPerRun: 1,
  placement: {
    minimumDistanceFromStairs: 1,
    minimumDistanceFromObjectives: 1,
    maximumInitialMemberDistance: 4,
    allowedTerrainTags: ['walkable'],
    requiresVaultSlot: false,
    failureMode: 'optional',
  },
  intentPresentation: { visible: true },
  definition: {
    roles: [
      {
        roleId: 'guard',
        monsterId: monster.id,
        minimumQuantity: 1,
        maximumQuantity: 1,
        formationPosition: 'front',
        behaviorParameters: {},
      },
    ],
    formation: 'line',
    communicationRadius: 3,
    leaderChance: 1,
    leaderRoleId: 'guard',
    leaderAccentColor: '#ffcc00',
    leaderAlternateGlyph: 'L',
    coordinationModifiers: { accuracy: 2 },
    leaderDeathResponse: 'panic',
    supernaturalBond: false,
    collapseRewards: 'none',
    responseParameters: {},
  },
};

function fixture(visible: boolean): {
  state: ActiveRun;
  content: ReturnType<typeof createDemoContentPack>;
} {
  const base = createDemoRun();
  const actor = {
    ...base.actors[0]!,
    actorId: 'actor.population',
    contentId: monster.id,
    playerControlled: false,
    disposition: 'hostile' as const,
    x: visible ? 2 : 5,
    y: visible ? 1 : 3,
    health: 7,
    maxHealth: 12,
    populationId: 'population.watch',
    populationRoleId: 'guard',
    populationPresentation: { name: 'Watch Captain', glyph: 'L', color: '#ffcc00', leader: true },
    behaviorState: {
      intent: 'protect' as const,
      goal: { type: 'cell' as const, floorId: base.activeFloorId, x: 6, y: 3 },
      lastKnownTargets: [
        {
          targetActorId: base.hero.actorId,
          floorId: base.activeFloorId,
          x: 1,
          y: 1,
          observedAt: 8,
          source: 'group' as const,
          observerActorId: 'actor.secret',
        },
      ],
      investigation: { floorId: base.activeFloorId, x: 6, y: 3, startedAt: 8, expiresAt: 40 },
    },
  };
  const population = {
    populationId: 'population.watch',
    encounterId: encounter.id,
    floorId: base.activeFloorId,
    createdAt: 0,
    model: 'group' as const,
    livingMemberIds: [actor.actorId],
    formerMemberIds: [],
    leaderActorId: actor.actorId,
    bonusActive: true,
    roleMembership: [{ actorId: actor.actorId, roleId: 'guard' }],
    sharedKnowledge: actor.behaviorState.lastKnownTargets,
    leaderResponseApplied: false,
    leaderResponseExpiresAt: null,
  };
  const content = {
    ...createDemoContentPack(),
    entries: [...createDemoContentPack().entries, monster, encounter],
  };
  return {
    state: { ...base, actors: [base.actors[0]!, actor], populations: [population] },
    content,
  };
}

const merchantFaction: NpcFactionContentEntry = {
  kind: 'npc-faction',
  id: 'npc-faction.test',
  name: 'Test Lampwrights',
  tags: [],
  minimumReputation: -1000,
  maximumReputation: 1000,
  startingReputation: 0,
  tiers: [
    {
      tierId: 'neutral',
      name: 'Neutral',
      minimum: -1000,
      maximum: 1000,
      purchasePriceBps: 10000,
      salePriceBps: 10000,
      acceptsTrade: true,
      serviceIds: ['merchant-service.identify'],
    },
  ],
};

function merchantFixture(visible: boolean): {
  state: ActiveRun;
  content: ReturnType<typeof createDemoContentPack>;
} {
  const base = createDemoRun();
  const actor = {
    ...base.actors[0]!,
    actorId: 'actor.merchant',
    contentId: 'npc.test-merchant',
    playerControlled: false,
    disposition: 'neutral' as const,
    x: visible ? 2 : 5,
    y: visible ? 1 : 3,
    populationId: 'population.merchant',
    populationRoleId: null,
    populationPresentation: {
      name: 'Test Lampwright',
      glyph: 'L',
      color: '#ffd166',
      leader: false,
    },
  };
  const population: MerchantPopulation = {
    populationId: 'population.merchant',
    encounterId: 'encounter.test-merchant',
    floorId: base.activeFloorId,
    createdAt: 0,
    livingMemberIds: [actor.actorId],
    formerMemberIds: [],
    model: 'merchant',
    actorId: actor.actorId,
    npcId: actor.contentId,
    factionId: merchantFaction.id,
    rolledLifetime: 4000,
    departureAt: 4000,
    emittedWarningThresholds: [1000, 500],
    initialStockItemIds: ['item.secret-stock'],
    stockItemIds: ['item.secret-stock'],
    services: [
      {
        serviceId: 'merchant-service.identify',
        basePrice: 10,
        remainingUses: 2,
        tierIds: ['neutral'],
      },
    ],
    lifecycle: 'available',
    provoked: false,
    aggressionPenaltyApplied: false,
    deathPenaltyApplied: false,
    stockLossResolved: false,
    commerceBonusApplied: false,
  };
  const content = {
    ...createDemoContentPack(),
    entries: [...createDemoContentPack().entries, merchantFaction],
  };
  return {
    state: { ...base, actors: [base.actors[0]!, actor], populations: [population] },
    content,
  };
}

describe('population actor projection', () => {
  it('projects readable visible presentation and broad intent', () => {
    const { state, content } = fixture(true);
    expect(projectGameplayState({ state, content }).actors).toEqual([
      expect.objectContaining({
        actorId: 'actor.population',
        name: 'Watch Captain',
        glyph: 'L',
        color: '#ffcc00',
        leader: true,
        healthPresentation: { current: 7, maximum: 12, band: 'wounded' },
        disposition: 'hostile',
        intent: 'protect',
        intentPresentation: 'intent.protect',
        leadershipRole: 'guard',
      }),
    ]);
  });

  it('projects no living actor state from remembered or unseen cells', () => {
    const { state, content } = fixture(false);
    expect(projectGameplayState({ state, content }).actors).toEqual([]);
  });

  it('shows visible source warnings, boss phases, and observed Champion identity', () => {
    const { state: base, content } = fixture(true);
    const prototype = base.actors.find((actor) => actor.actorId === 'actor.population')!;
    const source = {
      ...prototype,
      actorId: 'actor.source',
      x: 1,
      y: 2,
      populationId: 'population.swarm',
      populationRoleId: 'source',
      populationPresentation: { name: 'Brood Nest', glyph: 'N', color: '#55aa55', leader: false },
    };
    const boss = {
      ...prototype,
      actorId: 'actor.boss',
      x: 2,
      y: 2,
      populationId: 'population.boss',
      populationRoleId: null,
      populationPresentation: { name: 'Stone Regent', glyph: 'R', color: '#aa5555', leader: false },
    };
    const champion = {
      ...prototype,
      actorId: 'actor.champion',
      x: 3,
      y: 1,
      populationId: 'population.champion',
      populationRoleId: null,
      populationPresentation: {
        name: "Brynja, the Deep's Champion",
        glyph: '@',
        color: '#ffeeaa',
        leader: false,
      },
    };
    const common = {
      encounterId: encounter.id,
      floorId: base.activeFloorId,
      createdAt: 0,
      formerMemberIds: [],
    };
    const state = {
      ...base,
      actors: [base.actors[0]!, source, boss, champion],
      populations: [
        {
          ...common,
          populationId: 'population.swarm',
          model: 'swarm' as const,
          livingMemberIds: [source.actorId],
          sourceActorId: source.actorId,
          nextSpawnAt: 100,
          spawnedCount: 0,
          peakLivingSize: 1,
          shutdownState: null,
          emittedCapLevels: [],
          shutdownExpiresAt: null,
        },
        {
          ...common,
          populationId: 'population.boss',
          model: 'boss' as const,
          livingMemberIds: [boss.actorId],
          actorId: boss.actorId,
          currentPhaseId: 'enraged',
          crossedPhaseIds: ['enraged'],
          lastFloorExitAt: null,
          rewardCreated: false,
          rewardReceipt: null,
          recoveryHistory: [],
        },
        {
          ...common,
          populationId: 'population.champion',
          model: 'champion' as const,
          livingMemberIds: [champion.actorId],
          actorId: champion.actorId,
          hallRecordId: 'hall.brynja',
          rank: 1 as const,
          defeated: false,
          rewardCreated: false,
          equipmentContentIds: ['item.iron-sword'],
          abilityIds: ['ability.cleave'],
        },
      ],
    } as ActiveRun;
    const actors = projectGameplayState({ state, content }).actors;
    expect(actors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorId: source.actorId,
          source: true,
          sourceState: 'active',
          growthWarning: 'may-spawn',
        }),
        expect.objectContaining({ actorId: boss.actorId, bossPhase: 'enraged' }),
        expect.objectContaining({
          actorId: champion.actorId,
          name: "Brynja, the Deep's Champion",
          equipmentContentIds: ['item.iron-sword'],
          abilityIds: ['ability.cleave'],
        }),
      ]),
    );
  });

  it('extends a visible merchant with qualitative commerce state only', () => {
    const { state, content } = merchantFixture(true);
    expect(projectGameplayState({ state, content }).actors).toEqual([
      expect.objectContaining({
        actorId: 'actor.merchant',
        name: 'Test Lampwright',
        glyph: 'L',
        color: '#ffd166',
        disposition: 'neutral',
        factionName: 'Test Lampwrights',
        reputationTier: 'neutral',
        tradeAvailable: true,
        departureWarning: 500,
      }),
    ]);
    const json = stableJson(projectGameplayState({ state, content }));
    for (const secret of [
      'departureAt',
      'rolledLifetime',
      'emittedWarningThresholds',
      'stockItemIds',
      'item.secret-stock',
      'services',
      'remainingUses',
      'npcId',
      'merchant-stock',
    ]) {
      expect(json, secret).not.toContain(secret);
    }
  });

  it('projects no merchant state at all from an unseen merchant', () => {
    const { state, content } = merchantFixture(false);
    const projected = projectGameplayState({ state, content });
    expect(projected.actors).toEqual([]);
    const json = stableJson(projected);
    for (const secret of [
      'Lampwright',
      'merchant',
      'departureAt',
      'tradeAvailable',
      'departureWarning',
    ]) {
      expect(json, secret).not.toContain(secret);
    }
  });

  it('recursively excludes private decisions, knowledge, goals, paths, and target cells', () => {
    const { state, content } = fixture(true);
    const json = stableJson(
      projectGameplayState({
        state: {
          ...state,
          encounterDecisions: [
            {
              encounterId: encounter.id,
              baseProbability: 0.123,
              protectionBonus: 0.234,
              effectiveProbability: 0.357,
              eligible: true,
              reachedEligibleDepth: true,
              encountered: true,
              instancesCreated: 1,
            },
          ],
        },
        content,
      }),
    );
    for (const privateToken of [
      'baseProbability',
      'protectionBonus',
      'effectiveProbability',
      'goal',
      'path',
      'lastKnownTargets',
      'sharedKnowledge',
      'observerActorId',
      'observedAt',
      'targetActorId',
      'investigation',
      'coordinationModifiers',
      'leaderChance',
      'runAppearanceChance',
    ])
      expect(json).not.toContain(privateToken);
    expect(json).not.toContain('actor.secret');
  });
});
