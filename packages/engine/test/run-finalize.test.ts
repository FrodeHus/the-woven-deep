import { describe, expect, it } from 'vitest';
import type {
  AchievementContentEntry,
  CompiledContentPack,
  ContentEntry,
  EncounterContentEntry,
  FallenChampionTemplateContentEntry,
  ItemContentEntry,
} from '@woven-deep/content';
import {
  createDemoContentPack,
  createDemoRun,
  deriveHallRecordId,
  emptyRunMetrics,
  encodeRunSeed,
  evaluateDiscoveryProtection,
  finalizeRun,
  scoreRun,
  selectHeirloom,
  type ActiveRun,
  type EncounterRunDecision,
  type FallenHeroRunDecision,
  type ItemInstance,
  type LifetimeState,
} from '../src/index.js';

function itemDef(id: string, overrides: Partial<ItemContentEntry> = {}): ItemContentEntry {
  return {
    kind: 'item',
    id,
    name: `Name of ${id}`,
    tags: [],
    glyph: ')',
    color: '#c0c0c0',
    category: 'weapon',
    stackLimit: 1,
    price: 10,
    rarity: 'rare',
    heirloomEligible: true,
    minDepth: 1,
    maxDepth: 20,
    actionCost: 100,
    equipment: { slots: ['main-hand'], handedness: 'one-handed', reservedSlots: [] },
    combat: null,
    light: null,
    identification: { mode: 'known', poolId: null },
    effects: [],
    ...overrides,
  };
}

const template: FallenChampionTemplateContentEntry = {
  kind: 'fallen-champion-template',
  id: 'fallen-champion-template.core',
  name: "The Deep's Champion",
  tags: ['champion'],
  fallbackMonsterId: 'monster.boss',
  fallbackItemId: 'item.fallback',
  minimumHealth: 30,
  maximumHealth: 100,
  attributeMaximum: 20,
  damageMaximum: 24,
  abilityLimit: 2,
  echoAppearanceChance: 0.5,
  maximumEchoesPerRun: 2,
  echoHealthPercent: 65,
  echoDamagePercent: 70,
  echoDefensePercent: 80,
  echoAbilityLimit: 1,
  echoLootTableId: 'loot-table.boss',
  heirloomSelection: {
    rarityWeights: { common: 1, uncommon: 3, rare: 8, legendary: 16 },
    qualityRankBonus: 2,
  },
};

// Chosen so sorted achievement-ID order (echo first) differs from criteria declaration order.
const championAchievement: AchievementContentEntry = {
  kind: 'achievement',
  id: 'achievement.z-champion',
  name: 'Defeated the Champion',
  tags: [],
  description: 'First champion defeat.',
  criteriaId: 'first-champion-defeat',
};
const echoAchievement: AchievementContentEntry = {
  kind: 'achievement',
  id: 'achievement.a-echo',
  name: 'Silenced an Echo',
  tags: [],
  description: 'First echo defeat.',
  criteriaId: 'first-echo-defeat',
};

function encounterDef(id: string): EncounterContentEntry {
  return {
    kind: 'encounter',
    id,
    name: `Encounter ${id}`,
    tags: [],
    adminDescription: null,
    model: 'individual',
    minDepth: 1,
    maxDepth: 20,
    environmentTags: [],
    requiredVaultTags: [],
    weight: 1,
    rarity: 'common',
    runAppearanceChance: 0.5,
    discoveryProtectionIncrement: 0.1,
    discoveryProtectionCap: 0.5,
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
    definition: { monsterId: 'monster.boss', minimumQuantity: 1, maximumQuantity: 1 },
  };
}

function pack(extra: readonly ContentEntry[] = []): CompiledContentPack {
  const base = createDemoContentPack();
  return {
    ...base,
    entries: [...base.entries, template, itemDef('item.fallback', { rarity: 'common' }), ...extra],
  };
}

function equippedItem(itemId: string, contentId: string): ItemInstance {
  return {
    itemId,
    contentId,
    quantity: 1,
    condition: 100,
    enchantment: null,
    identified: true,
    charges: null,
    fuel: null,
    enabled: null,
    location: { type: 'equipped', actorId: 'hero.demo', slot: 'main-hand' },
  };
}

function concludedRun(overrides: Partial<ActiveRun> = {}): ActiveRun {
  const base = createDemoRun();
  return {
    ...base,
    metrics: {
      ...emptyRunMetrics(),
      kills: 3,
      threatDefeated: 12,
      deepestDepth: 4,
      turnsElapsed: 120,
      discoveriesRevealed: 2,
    },
    reputations: [{ factionId: 'faction.lampwrights', value: 5 }],
    conclusion: {
      completionType: 'died',
      cause: { killerContentId: null, depth: 4, turn: 120, worldTime: 12_000 },
      concludedAtRevision: 9,
      finalized: false,
    },
    ...overrides,
  };
}

function emptyLifetime(overrides: Partial<LifetimeState> = {}): LifetimeState {
  return {
    conqueredChampionRecordIds: [],
    grantedAchievementIds: [],
    discoveryProtection: [],
    totals: emptyRunMetrics(),
    ...overrides,
  };
}

const championRecordId = `record.${'1'.repeat(32)}.${'b'.repeat(16)}`;
const echoRecordId = `record.${'2'.repeat(32)}.${'c'.repeat(16)}`;

function decision(
  role: 'champion' | 'echo',
  overrides: Partial<FallenHeroRunDecision> = {},
): FallenHeroRunDecision {
  return {
    hallRecordId: role === 'champion' ? championRecordId : echoRecordId,
    rank: role === 'champion' ? 1 : 2,
    role,
    gateRoll: null,
    retained: true,
    encountered: true,
    defeated: true,
    ...overrides,
  };
}

describe('finalizeRun', () => {
  it('throws for an unconcluded run', () => {
    const run = { ...concludedRun(), conclusion: null };
    expect(() => finalizeRun({ run, content: pack(), lifetime: emptyLifetime() })).toThrow(
      /conclud/i,
    );
  });

  it('finalizes exactly once: a second call throws an invariant error', () => {
    const content = pack();
    const finalized = finalizeRun({ run: concludedRun(), content, lifetime: emptyLifetime() });
    expect(finalized.run.conclusion?.finalized).toBe(true);
    expect(() => finalizeRun({ run: finalized.run, content, lifetime: emptyLifetime() })).toThrow(
      /finalized/,
    );
  });

  it('produces byte-identical outputs for identical inputs', () => {
    const content = pack();
    const run = concludedRun();
    const lifetime = emptyLifetime();
    const finalized = finalizeRun({ run, content, lifetime });
    expect(finalizeRun({ run, content, lifetime })).toEqual(finalized);
  });

  it('advances only the run-records stream and leaves the rest of the run untouched', () => {
    const content = pack([itemDef('item.sword')]);
    const run = concludedRun({ items: [equippedItem('item.hero.sword', 'item.sword')] });
    const before = structuredClone(run);
    const finalized = finalizeRun({ run, content, lifetime: emptyLifetime() });
    expect(run).toEqual(before); // input never mutated
    expect(finalized.run.rng['run-records']).not.toEqual(run.rng['run-records']);
    const { 'run-records': ignoredNext, ...otherNext } = finalized.run.rng;
    const { 'run-records': ignoredPrev, ...otherPrev } = run.rng;
    expect(otherNext).toEqual(otherPrev);
    expect(finalized.run).toEqual({
      ...run,
      rng: { ...run.rng, 'run-records': finalized.run.rng['run-records'] },
      conclusion: { ...run.conclusion, finalized: true },
    });
  });

  it('assembles the hall record from the concluded run', () => {
    const content = pack([
      itemDef('item.sword'),
      itemDef('item.crown', {
        rarity: 'legendary',
        equipment: { slots: ['head'], handedness: 'one-handed', reservedSlots: [] },
      }),
    ]);
    const run = concludedRun({
      items: [
        equippedItem('item.hero.sword', 'item.sword'),
        {
          ...equippedItem('item.hero.crown', 'item.crown'),
          location: { type: 'equipped', actorId: 'hero.demo', slot: 'head' },
        },
      ],
    });
    const recordId = deriveHallRecordId(run.runSeed, run.contentHash);
    const heirloom = selectHeirloom({ run, content, template, recordId }).snapshot;
    const finalized = finalizeRun({ run, content, lifetime: emptyLifetime() });
    expect(finalized.record).toEqual({
      recordId,
      heroName: 'Ada',
      classTags: [],
      completionType: 'died',
      cause: run.conclusion?.cause,
      deepestDepth: run.metrics.deepestDepth,
      score: scoreRun({ run, content }),
      metrics: run.metrics,
      reputations: run.reputations,
      heirloom,
      build: {
        attributes: { might: 10, agility: 10, vitality: 10, wits: 10, resolve: 10 },
        equippedItemContentIds: ['item.crown', 'item.sword'],
        signatureAbilityIds: [],
      },
      runSeed: encodeRunSeed(run.runSeed),
      contentHash: run.contentHash,
    });
    expect(finalized.record.score.total).toEqual(scoreRun({ run, content }).total);
  });

  it('records the hero class tags, sorted', () => {
    const content = pack([itemDef('item.sword')]);
    const run = concludedRun({
      items: [equippedItem('item.hero.sword', 'item.sword')],
      hero: { ...createDemoRun().hero, classTags: ['wayfarer', 'warden'] },
    });
    const finalized = finalizeRun({ run, content, lifetime: emptyLifetime() });
    expect(finalized.record.classTags).toEqual(['warden', 'wayfarer']);
  });

  it('deduplicates and sorts equipped item content IDs in the build snapshot', () => {
    const content = pack([
      itemDef('item.dagger', {
        stackLimit: 2,
        equipment: {
          slots: ['main-hand', 'off-hand'],
          handedness: 'one-handed',
          reservedSlots: [],
        },
      }),
    ]);
    const run = concludedRun({
      items: [
        equippedItem('item.hero.b-dagger', 'item.dagger'),
        {
          ...equippedItem('item.hero.a-dagger', 'item.dagger'),
          location: { type: 'equipped', actorId: 'hero.demo', slot: 'off-hand' },
        },
      ],
    });
    const finalized = finalizeRun({ run, content, lifetime: emptyLifetime() });
    expect(finalized.record.build.equippedItemContentIds).toEqual(['item.dagger']);
  });

  describe('achievement grants', () => {
    interface GrantCase {
      readonly label: string;
      readonly decisions: readonly FallenHeroRunDecision[];
      readonly lifetime: LifetimeState;
      readonly expectedGrantIds: readonly string[];
      readonly expectedNewlyConquered: readonly string[];
    }

    const cases: readonly GrantCase[] = [
      {
        label: 'retained champion defeat grants first-champion-defeat',
        decisions: [decision('champion')],
        lifetime: emptyLifetime(),
        expectedGrantIds: ['achievement.z-champion'],
        expectedNewlyConquered: [championRecordId],
      },
      {
        label: 'champion already conquered in a previous life grants nothing new',
        decisions: [decision('champion')],
        lifetime: emptyLifetime({ conqueredChampionRecordIds: [championRecordId] }),
        expectedGrantIds: [],
        expectedNewlyConquered: [],
      },
      {
        label:
          'already-granted champion achievement never regrants, but the conquest is still recorded',
        decisions: [decision('champion')],
        lifetime: emptyLifetime({ grantedAchievementIds: ['achievement.z-champion'] }),
        expectedGrantIds: [],
        expectedNewlyConquered: [championRecordId],
      },
      {
        label: 'a non-retained champion decision grants nothing',
        decisions: [decision('champion', { retained: false, encountered: false, defeated: false })],
        lifetime: emptyLifetime(),
        expectedGrantIds: [],
        expectedNewlyConquered: [],
      },
      {
        label: 'an undefeated champion grants nothing',
        decisions: [decision('champion', { defeated: false })],
        lifetime: emptyLifetime(),
        expectedGrantIds: [],
        expectedNewlyConquered: [],
      },
      {
        label: 'first lifetime echo defeat grants first-echo-defeat',
        decisions: [decision('echo')],
        lifetime: emptyLifetime(),
        expectedGrantIds: ['achievement.a-echo'],
        expectedNewlyConquered: [],
      },
      {
        label: 'already-granted echo achievement never regrants',
        decisions: [decision('echo')],
        lifetime: emptyLifetime({ grantedAchievementIds: ['achievement.a-echo'] }),
        expectedGrantIds: [],
        expectedNewlyConquered: [],
      },
      {
        label: 'an undefeated echo grants nothing',
        decisions: [decision('echo', { defeated: false })],
        lifetime: emptyLifetime(),
        expectedGrantIds: [],
        expectedNewlyConquered: [],
      },
      {
        label: 'both first defeats grant both achievements in sorted achievement-ID order',
        decisions: [decision('champion'), decision('echo')],
        lifetime: emptyLifetime(),
        expectedGrantIds: ['achievement.a-echo', 'achievement.z-champion'],
        expectedNewlyConquered: [championRecordId],
      },
    ];

    it.each(cases)(
      '$label',
      ({ decisions, lifetime, expectedGrantIds, expectedNewlyConquered }) => {
        const content = pack([championAchievement, echoAchievement]);
        const run = concludedRun({ fallenHeroDecisions: decisions });
        const finalized = finalizeRun({ run, content, lifetime });
        expect(finalized.deltas.achievementGrants.map((grant) => grant.achievementId)).toEqual(
          expectedGrantIds,
        );
        expect(finalized.deltas.newlyConqueredChampionRecordIds).toEqual(expectedNewlyConquered);
      },
    );

    it('grants carry the achievement criteria and name', () => {
      const content = pack([championAchievement, echoAchievement]);
      const run = concludedRun({ fallenHeroDecisions: [decision('champion'), decision('echo')] });
      const finalized = finalizeRun({ run, content, lifetime: emptyLifetime() });
      expect(finalized.deltas.achievementGrants).toEqual([
        {
          achievementId: 'achievement.a-echo',
          criteriaId: 'first-echo-defeat',
          name: 'Silenced an Echo',
        },
        {
          achievementId: 'achievement.z-champion',
          criteriaId: 'first-champion-defeat',
          name: 'Defeated the Champion',
        },
      ]);
    });

    it('a defeated criterion with no authored achievement grants nothing', () => {
      const content = pack(); // no achievement entries authored
      const run = concludedRun({ fallenHeroDecisions: [decision('champion'), decision('echo')] });
      const finalized = finalizeRun({ run, content, lifetime: emptyLifetime() });
      expect(finalized.deltas.achievementGrants).toEqual([]);
      expect(finalized.deltas.newlyConqueredChampionRecordIds).toEqual([championRecordId]);
      expect(finalized.events).toHaveLength(1);
      expect(finalized.events[0]?.type).toBe('run.finalized');
    });
  });

  it('emits run.finalized first, then achievement.granted per grant in sorted achievement-ID order', () => {
    const content = pack([championAchievement, echoAchievement]);
    const run = concludedRun({ fallenHeroDecisions: [decision('champion'), decision('echo')] });
    const finalized = finalizeRun({ run, content, lifetime: emptyLifetime() });
    const eventId = `event.finalize.${finalized.record.recordId}`;
    expect(finalized.events).toEqual([
      {
        type: 'run.finalized',
        eventId,
        recordId: finalized.record.recordId,
        completionType: 'died',
        scoreTotal: finalized.record.score.total,
      },
      {
        type: 'achievement.granted',
        eventId,
        achievementId: 'achievement.a-echo',
        criteriaId: 'first-echo-defeat',
        name: 'Silenced an Echo',
      },
      {
        type: 'achievement.granted',
        eventId,
        achievementId: 'achievement.z-champion',
        criteriaId: 'first-champion-defeat',
        name: 'Defeated the Champion',
      },
    ]);
    expect(finalized.events[0]).toMatchObject({
      type: 'run.finalized',
      scoreTotal: finalized.record.score.total,
    });
  });

  it('carries the run metrics and record ID into the lifetime deltas', () => {
    const content = pack();
    const run = concludedRun();
    const finalized = finalizeRun({ run, content, lifetime: emptyLifetime() });
    expect(finalized.deltas.recordId).toBe(deriveHallRecordId(run.runSeed, run.contentHash));
    expect(finalized.deltas.metrics).toEqual(run.metrics);
  });

  it('computes discovery protection updates over the run decisions, sorted by encounter ID', () => {
    const encounters = [encounterDef('encounter.a-shrine'), encounterDef('encounter.b-warden')];
    const content = pack(encounters);
    const encounterDecisions: readonly EncounterRunDecision[] = [
      {
        encounterId: 'encounter.a-shrine',
        baseProbability: 0.5,
        protectionBonus: 0.1,
        effectiveProbability: 0.4,
        eligible: true,
        reachedEligibleDepth: true,
        encountered: false,
        instancesCreated: 0,
      },
      {
        encounterId: 'encounter.b-warden',
        baseProbability: 0.5,
        protectionBonus: 0.2,
        effectiveProbability: 0.3,
        eligible: true,
        reachedEligibleDepth: true,
        encountered: true,
        instancesCreated: 1,
      },
    ];
    const run = concludedRun({ encounterDecisions });
    const finalized = finalizeRun({ run, content, lifetime: emptyLifetime() });
    expect(finalized.deltas.discoveryProtectionUpdates).toEqual(
      evaluateDiscoveryProtection({ decisions: encounterDecisions, encounters }),
    );
    expect(finalized.deltas.discoveryProtectionUpdates.map((update) => update.encounterId)).toEqual(
      ['encounter.a-shrine', 'encounter.b-warden'],
    );
  });
});
