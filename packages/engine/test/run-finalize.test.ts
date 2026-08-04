import { describe, expect, it } from 'vitest';
import type {
  AchievementContentEntry,
  CompiledContentPack,
  ContentEntry,
  CurseContentEntry,
  EncounterContentEntry,
  FallenChampionTemplateContentEntry,
  ItemContentEntry,
  SpellContentEntry,
} from '@woven-deep/content';
import {
  createDemoContentPack,
  createDemoRun,
  deriveHallRecordId,
  emptyRunMetrics,
  encodeRunSeed,
  equippedInstanceSnapshots,
  evaluateDiscoveryProtection,
  finalizeRun,
  rollDie,
  scoreRun,
  selectHeirloom,
  compareCodeUnits,
  selectRecordHeirloom,
  standingsFromRecords,
  TABLET_FRAGMENT_TAG,
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
    artifact: null,
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
  appeasement: {
    classFavors: { loomcaller: ['scroll', 'potion'] },
    causelessCategories: ['light'],
    defaultCategories: ['food', 'potion'],
  },
};

// Chosen so sorted achievement-ID order (echo first) differs from criteria declaration order.
const championAchievement: AchievementContentEntry = {
  kind: 'achievement',
  id: 'achievement.z-champion',
  name: 'Defeated the Champion',
  tags: [],
  description: 'First champion defeat.',
  criteria: { type: 'defeat-fallen-hero', role: 'champion' },
};
const echoAchievement: AchievementContentEntry = {
  kind: 'achievement',
  id: 'achievement.a-echo',
  name: 'Silenced an Echo',
  tags: [],
  description: 'First echo defeat.',
  criteria: { type: 'defeat-fallen-hero', role: 'echo' },
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

function artifactDef(id: string, overrides: Partial<ItemContentEntry> = {}): ItemContentEntry {
  return itemDef(id, {
    rarity: 'legendary',
    equipment: { slots: ['off-hand'], handedness: 'one-handed', reservedSlots: [] },
    artifact: { canon: true, signature: null, drawbackModifiers: { defense: -1 }, light: null },
    ...overrides,
  });
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
    collectedFragmentIds: [],
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
    const deathInventory = equippedInstanceSnapshots({ run, content, recordId });
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
      deathInventory,
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

  describe('death inventory', () => {
    const leadenWeightCurse: CurseContentEntry = {
      kind: 'curse',
      id: 'curse.leaden-weight',
      name: 'Leaden Weight',
      tags: ['curse'],
      revealText: 'It grows heavier the longer you carry it.',
      drawbackModifiers: { defense: -1 },
      trigger: null,
    };

    it('captures every equipped item as an instance snapshot', () => {
      const content = pack([
        itemDef('item.iron-sword'),
        itemDef('item.leather-armor', {
          equipment: { slots: ['body'], handedness: 'one-handed', reservedSlots: [] },
        }),
        itemDef('item.lantern', {
          equipment: { slots: ['off-hand'], handedness: 'one-handed', reservedSlots: [] },
        }),
      ]);
      const run = concludedRun({
        items: [
          equippedItem('item.hero.sword', 'item.iron-sword'),
          {
            ...equippedItem('item.hero.armor', 'item.leather-armor'),
            location: { type: 'equipped', actorId: 'hero.demo', slot: 'body' },
          },
          {
            ...equippedItem('item.hero.lantern', 'item.lantern'),
            location: { type: 'equipped', actorId: 'hero.demo', slot: 'off-hand' },
          },
        ],
      });
      const { record } = finalizeRun({ run, content, lifetime: emptyLifetime() });
      expect(record.deathInventory.map((entry) => entry.contentId).sort()).toEqual([
        'item.iron-sword',
        'item.lantern',
        'item.leather-armor',
      ]);
    });

    it('excludes backpack items', () => {
      const content = pack([itemDef('item.healing-draught', { equipment: null })]);
      const run = concludedRun({
        items: [
          {
            ...equippedItem('item.hero.draught', 'item.healing-draught'),
            location: { type: 'backpack', actorId: 'hero.demo' },
          },
        ],
      });
      const { record } = finalizeRun({ run, content, lifetime: emptyLifetime() });
      expect(
        record.deathInventory.some((entry) => entry.contentId === 'item.healing-draught'),
      ).toBe(false);
    });

    it('preserves enchantment, curse, charges, and fuel on each captured piece', () => {
      const content = pack([itemDef('item.iron-sword'), leadenWeightCurse]);
      const run = concludedRun({
        items: [
          {
            ...equippedItem('item.hero.sword', 'item.iron-sword'),
            enchantment: { enchantmentId: 'enchantment.honed', modifiers: { accuracy: 1 } },
            charges: 3,
            fuel: 7,
            curse: { curseId: 'curse.leaden-weight', revealed: false },
          },
        ],
      });
      const { record } = finalizeRun({ run, content, lifetime: emptyLifetime() });
      const sword = record.deathInventory.find((entry) => entry.contentId === 'item.iron-sword')!;
      expect(sword.enchantment).not.toBeNull();
      expect(sword.charges).toBe(3);
      expect(sword.fuel).toBe(7);
      expect(sword.curse).toEqual({ curseId: 'curse.leaden-weight', revealed: true });
      expect(sword.originatingHallRecordId).toBe(record.recordId);
    });

    it('captures an equipped artifact exactly as the heirloom snapshot would', () => {
      const content = pack([artifactDef('item.marias-grace')]);
      const run = concludedRun({
        items: [equippedItem('item.hero.grace', 'item.marias-grace')],
      });
      const recordId = deriveHallRecordId(run.runSeed, run.contentHash);
      const expected = equippedInstanceSnapshots({ run, content, recordId }).find(
        (entry) => entry.contentId === 'item.marias-grace',
      )!;
      const { record } = finalizeRun({ run, content, lifetime: emptyLifetime() });
      const artifact = record.deathInventory.find(
        (entry) => entry.contentId === 'item.marias-grace',
      )!;
      expect(artifact).toEqual(expected);
      expect(artifact.sourceItemId).toBe('item.hero.grace');
    });

    it('keeps the heirloom as a distinguished member of the inventory', () => {
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
      const { record } = finalizeRun({ run, content, lifetime: emptyLifetime() });
      expect(
        record.deathInventory.some((entry) => entry.sourceItemId === record.heirloom.sourceItemId),
      ).toBe(true);
    });

    it('records the fallback relic alone when the hero died with nothing equipped', () => {
      const content = pack();
      const run = concludedRun({ items: [] });
      const { record } = finalizeRun({ run, content, lifetime: emptyLifetime() });
      expect(record.deathInventory).toEqual([record.heirloom]);
    });

    it('consumes no additional randomness to capture the inventory', () => {
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
      const finalized = finalizeRun({ run, content, lifetime: emptyLifetime() });
      // One roll at most, the pre-existing heirloom selection: capture itself draws nothing.
      expect(finalized.run.rng['run-records']).toEqual(
        selectRecordHeirloom({ run, content, template, recordId, heldArtifactIds: [] })
          .nextRunRecordsState,
      );
    });
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
          name: 'Silenced an Echo',
        },
        {
          achievementId: 'achievement.z-champion',
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
        name: 'Silenced an Echo',
      },
      {
        type: 'achievement.granted',
        eventId,
        achievementId: 'achievement.z-champion',
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

  describe('artifact deltas', () => {
    it('records no stints when the hero held no artifact', () => {
      const content = pack([itemDef('item.sword')]);
      const run = concludedRun({ items: [equippedItem('item.hero.sword', 'item.sword')] });
      const finalized = finalizeRun({ run, content, lifetime: emptyLifetime() });
      expect(finalized.artifactDeltas).toEqual({
        recordId: deriveHallRecordId(run.runSeed, run.contentHash),
        stints: [],
      });
      // the ordinary heirloom roll still runs
      expect(finalized.record.heirloom.contentId).toBe('item.sword');
    });

    it('makes a held artifact the record heirloom and loses it to this record', () => {
      const content = pack([itemDef('item.sword'), artifactDef('item.marias-grace')]);
      const run = concludedRun({
        items: [
          equippedItem('item.hero.sword', 'item.sword'),
          {
            ...equippedItem('item.hero.grace', 'item.marias-grace'),
            location: { type: 'backpack', actorId: 'hero.demo' },
          },
        ],
      });
      const recordId = deriveHallRecordId(run.runSeed, run.contentHash);
      const finalized = finalizeRun({ run, content, lifetime: emptyLifetime() });
      expect(finalized.record.heirloom.contentId).toBe('item.marias-grace');
      expect(finalized.artifactDeltas).toEqual({
        recordId,
        stints: [
          {
            artifactId: 'item.marias-grace',
            stint: {
              heroName: run.hero.name,
              recordId,
              outcome: 'died-with',
              depth: run.conclusion!.cause.depth,
            },
            newStatus: 'lost',
            holderRecordId: recordId,
          },
        ],
      });
      // a single held artifact needs no roll: the run-records stream never moves
      expect(finalized.run.rng['run-records']).toEqual(run.rng['run-records']);
    });

    it('reclaims every held artifact the roll did not choose', () => {
      const content = pack([
        artifactDef('item.a-needle', {
          equipment: { slots: ['left-ring'], handedness: 'one-handed', reservedSlots: [] },
        }),
        artifactDef('item.z-grace'),
      ]);
      const run = concludedRun({
        items: [
          equippedItem('item.hero.a-needle', 'item.a-needle'),
          {
            ...equippedItem('item.hero.z-grace', 'item.z-grace'),
            location: { type: 'backpack', actorId: 'hero.demo' },
          },
        ],
      });
      const recordId = deriveHallRecordId(run.runSeed, run.contentHash);
      const finalized = finalizeRun({ run, content, lifetime: emptyLifetime() });
      const chosen = finalized.record.heirloom.contentId;
      expect(['item.a-needle', 'item.z-grace']).toContain(chosen);
      expect(finalized.artifactDeltas.stints.map((entry) => entry.artifactId)).toEqual([
        'item.a-needle',
        'item.z-grace',
      ]);
      const lost = finalized.artifactDeltas.stints.find((entry) => entry.artifactId === chosen)!;
      const reclaimed = finalized.artifactDeltas.stints.find(
        (entry) => entry.artifactId !== chosen,
      )!;
      expect(lost).toEqual({
        artifactId: chosen,
        stint: {
          heroName: run.hero.name,
          recordId,
          outcome: 'died-with',
          depth: run.conclusion!.cause.depth,
        },
        newStatus: 'lost',
        holderRecordId: recordId,
      });
      expect(reclaimed).toEqual({
        artifactId: reclaimed.artifactId,
        stint: {
          heroName: run.hero.name,
          recordId,
          outcome: 'reclaimed-by-the-deep',
          depth: run.conclusion!.cause.depth,
        },
        newStatus: 'undiscovered',
        holderRecordId: null,
      });
      // exactly one roll over the two equally-weighted artifacts
      expect(finalized.run.rng['run-records']).toEqual(rollDie(run.rng['run-records'], 2).state);
    });

    it('records escaped-with when the run ended in anything but death while holding an artifact', () => {
      const content = pack([artifactDef('item.marias-grace')]);
      const run = concludedRun({
        items: [equippedItem('item.hero.grace', 'item.marias-grace')],
        conclusion: {
          completionType: 'broke-cycle',
          cause: { killerContentId: null, depth: 6, turn: 200, worldTime: 20_000 },
          concludedAtRevision: 11,
          finalized: false,
        },
      });
      const recordId = deriveHallRecordId(run.runSeed, run.contentHash);
      const finalized = finalizeRun({ run, content, lifetime: emptyLifetime() });
      expect(finalized.artifactDeltas.stints).toEqual([
        {
          artifactId: 'item.marias-grace',
          stint: { heroName: run.hero.name, recordId, outcome: 'escaped-with', depth: 6 },
          newStatus: 'lost',
          holderRecordId: recordId,
        },
      ]);
      expect(finalized.record.heirloom.contentId).toBe('item.marias-grace');
    });
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

describe('signature abilities recorded on the build snapshot', () => {
  function spellDef(id: string, weaveCost: number): SpellContentEntry {
    return {
      kind: 'spell',
      id,
      name: `Name of ${id}`,
      description: '',
      tags: [],
      targetingId: 'target.actor',
      range: 5,
      actionCost: 100,
      weaveCost,
      effects: [],
    };
  }

  const spells: readonly SpellContentEntry[] = [
    spellDef('spell.gale', 5),
    spellDef('spell.ember', 4),
    spellDef('spell.mend', 2),
    spellDef('spell.spark', 1),
    spellDef('spell.a-tie', 3),
    spellDef('spell.b-tie', 3),
  ];

  /** The shared pack plus the spell set, with the template's ability limit made explicit. */
  function casterPack(abilityLimit: number): CompiledContentPack {
    const base = pack(spells);
    return {
      ...base,
      entries: base.entries.map((entry) =>
        entry.kind === 'fallen-champion-template' ? { ...entry, abilityLimit } : entry,
      ),
    };
  }

  function concludedHeroKnowing(knownSpellIds: readonly string[]): ActiveRun {
    const base = concludedRun();
    return { ...base, hero: { ...base.hero, knownSpellIds } };
  }

  it('records the hero known spells as signature abilities', () => {
    const { record } = finalizeRun({
      run: concludedHeroKnowing(['spell.ember', 'spell.mend']),
      content: casterPack(3),
      lifetime: emptyLifetime(),
    });
    expect(record.build.signatureAbilityIds).toEqual(['spell.ember', 'spell.mend']);
  });

  it('caps the recorded abilities at the template limit, keeping the highest weave costs', () => {
    const { record } = finalizeRun({
      run: concludedHeroKnowing(['spell.spark', 'spell.mend', 'spell.ember', 'spell.gale']),
      content: casterPack(3),
      lifetime: emptyLifetime(),
    });
    // Selection is by cost (spark, the cheapest, is the one dropped); STORAGE is canonical id
    // order, which the save schema requires of this list -- see the ordering test below.
    expect(record.build.signatureAbilityIds).toEqual(['spell.ember', 'spell.gale', 'spell.mend']);
  });

  it('records the selection in canonical id order, which the save schema requires', () => {
    // `save-schema/run-record.ts` validates `standing.signatureAbilityIds` (and a placed
    // population's `abilityIds`) as unique and strictly increasing. A list recorded in weave-cost
    // order would make every run carrying that standing unsavable.
    const { record } = finalizeRun({
      run: concludedHeroKnowing(['spell.gale', 'spell.ember', 'spell.mend']),
      content: casterPack(3),
      lifetime: emptyLifetime(),
    });
    const ids = [...record.build.signatureAbilityIds];
    expect(ids).toEqual([...ids].sort(compareCodeUnits));
    expect(ids).toEqual(['spell.ember', 'spell.gale', 'spell.mend']);
  });

  it('honors a smaller template limit', () => {
    const { record } = finalizeRun({
      run: concludedHeroKnowing(['spell.spark', 'spell.mend', 'spell.ember', 'spell.gale']),
      content: casterPack(1),
      lifetime: emptyLifetime(),
    });
    expect(record.build.signatureAbilityIds).toEqual(['spell.gale']);
  });

  it('breaks weave-cost ties deterministically by spell id', () => {
    // The tie has to CROSS THE CAP for the comparator's tie-break to matter: with a limit that
    // takes both, the final canonical sort would produce the same answer either way. A limit of one
    // forces the selection itself to choose, and the choice must not depend on the order the hero
    // happened to learn them in -- hence both orderings below.
    const forwards = finalizeRun({
      run: concludedHeroKnowing(['spell.b-tie', 'spell.a-tie']),
      content: casterPack(1),
      lifetime: emptyLifetime(),
    });
    const backwards = finalizeRun({
      run: concludedHeroKnowing(['spell.a-tie', 'spell.b-tie']),
      content: casterPack(1),
      lifetime: emptyLifetime(),
    });
    expect(forwards.record.build.signatureAbilityIds).toEqual(['spell.a-tie']);
    expect(backwards.record.build.signatureAbilityIds).toEqual(['spell.a-tie']);
  });

  it('keeps both sides of a tie when the cap has room for them', () => {
    const { record } = finalizeRun({
      run: concludedHeroKnowing(['spell.b-tie', 'spell.a-tie']),
      content: casterPack(3),
      lifetime: emptyLifetime(),
    });
    expect(record.build.signatureAbilityIds).toEqual(['spell.a-tie', 'spell.b-tie']);
  });

  it('records a spell the hero somehow knows twice exactly once', () => {
    // `hero.knownSpellIds` is the one list here with no `validateOrderedIds` behind it, so a
    // duplicate would write a perfectly good record and only explode on the first SAVE of a LATER
    // run that loaded the resulting standing -- a long way from the cause.
    const { record } = finalizeRun({
      run: concludedHeroKnowing(['spell.ember', 'spell.ember', 'spell.mend']),
      content: casterPack(3),
      lifetime: emptyLifetime(),
    });
    expect(record.build.signatureAbilityIds).toEqual(['spell.ember', 'spell.mend']);
  });

  it('records nothing for a hero who knew no spells', () => {
    const { record } = finalizeRun({
      run: concludedHeroKnowing([]),
      content: casterPack(3),
      lifetime: emptyLifetime(),
    });
    expect(record.build.signatureAbilityIds).toEqual([]);
  });

  it('records nothing for a hero with no knownSpellIds key at all', () => {
    const { record } = finalizeRun({
      run: concludedRun(),
      content: casterPack(3),
      lifetime: emptyLifetime(),
    });
    expect(record.build.signatureAbilityIds).toEqual([]);
  });

  it('drops a spell the current pack no longer defines', () => {
    const { record } = finalizeRun({
      run: concludedHeroKnowing(['spell.ember', 'spell.deleted']),
      content: casterPack(3),
      lifetime: emptyLifetime(),
    });
    expect(record.build.signatureAbilityIds).toEqual(['spell.ember']);
  });

  it('consumes no additional randomness', () => {
    // The selection is a pure sort over content the run already carries -- a caster's finalization
    // must leave every stream exactly where a non-caster's does.
    const content = casterPack(3);
    const caster = finalizeRun({
      run: concludedHeroKnowing(['spell.ember', 'spell.mend', 'spell.gale']),
      content,
      lifetime: emptyLifetime(),
    });
    const silent = finalizeRun({
      run: concludedHeroKnowing([]),
      content,
      lifetime: emptyLifetime(),
    });
    expect(caster.run.rng).toEqual(silent.run.rng);
    expect(caster.record.build.signatureAbilityIds).not.toEqual([]);
  });

  it('round-trips the abilities through a standing', () => {
    const { record } = finalizeRun({
      run: concludedHeroKnowing(['spell.ember']),
      content: casterPack(3),
      lifetime: emptyLifetime(),
    });
    const standings = standingsFromRecords(
      [{ ...record, enrichment: { achievedAt: 'Run #1', portraitGlyph: '@' } }],
      10,
    );
    expect(standings[0]!.signatureAbilityIds).toEqual(['spell.ember']);
  });
});

describe('finalizeRun lifetime fragment collection', () => {
  const FRAGMENT_A = 'item.fragment.a';
  const FRAGMENT_B = 'item.fragment.b';

  function fragmentDef(id: string): ItemContentEntry {
    return itemDef(id, {
      tags: [TABLET_FRAGMENT_TAG],
      category: 'misc',
      heirloomEligible: false,
      equipment: null,
      minDepth: 15,
    });
  }

  function fragmentPack(): CompiledContentPack {
    return pack([fragmentDef(FRAGMENT_A), fragmentDef(FRAGMENT_B)]);
  }

  function carried(contentId: string): ItemInstance {
    return {
      ...equippedItem(`${contentId}.instance`, contentId),
      location: { type: 'backpack', actorId: 'hero.demo' },
    };
  }

  it('banks every fragment the hero holds when the run concludes', () => {
    const run = concludedRun({ items: [carried(FRAGMENT_A), carried(FRAGMENT_B)] });
    const { deltas } = finalizeRun({
      run,
      content: fragmentPack(),
      lifetime: emptyLifetime(),
    });
    expect(deltas.newlyCollectedFragmentIds).toEqual([FRAGMENT_A, FRAGMENT_B]);
  });

  it('banks a fragment carried by a hero who died holding it', () => {
    const run = concludedRun({ items: [carried(FRAGMENT_B)] });
    expect(run.conclusion?.completionType).toBe('died');
    const { deltas } = finalizeRun({
      run,
      content: fragmentPack(),
      lifetime: emptyLifetime(),
    });
    expect(deltas.newlyCollectedFragmentIds).toEqual([FRAGMENT_B]);
  });

  it('omits fragments lifetime already banked', () => {
    const run = concludedRun({ items: [carried(FRAGMENT_A), carried(FRAGMENT_B)] });
    const { deltas } = finalizeRun({
      run,
      content: fragmentPack(),
      lifetime: emptyLifetime({ collectedFragmentIds: [FRAGMENT_A] }),
    });
    expect(deltas.newlyCollectedFragmentIds).toEqual([FRAGMENT_B]);
  });

  it('banks nothing for a fragment left lying on the floor', () => {
    const onFloor: ItemInstance = {
      ...carried(FRAGMENT_A),
      location: { type: 'floor', floorId: 'floor.demo', x: 2, y: 2 },
    };
    const { deltas } = finalizeRun({
      run: concludedRun({ items: [onFloor] }),
      content: fragmentPack(),
      lifetime: emptyLifetime(),
    });
    expect(deltas.newlyCollectedFragmentIds).toEqual([]);
  });

  it('banks nothing when the hero carried no fragments', () => {
    const { deltas } = finalizeRun({
      run: concludedRun(),
      content: fragmentPack(),
      lifetime: emptyLifetime(),
    });
    expect(deltas.newlyCollectedFragmentIds).toEqual([]);
  });
});
