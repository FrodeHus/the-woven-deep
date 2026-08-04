import { describe, expect, it } from 'vitest';
import type {
  AchievementContentEntry,
  CompiledContentPack,
  ContentEntry,
  FallenChampionTemplateContentEntry,
  ItemContentEntry,
} from '@woven-deep/content';
import {
  createDemoContentPack,
  createDemoRun,
  finalizeRun,
  type ActiveRun,
  type FallenHeroRunDecision,
  type LifetimeState,
} from '../src/index.js';

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

function itemDef(id: string): ItemContentEntry {
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
    rarity: 'common',
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
  };
}

function pack(extra: readonly ContentEntry[] = []): CompiledContentPack {
  const base = createDemoContentPack();
  return {
    ...base,
    entries: [...base.entries, template, itemDef('item.fallback'), ...extra],
  };
}

function concludedRun(overrides: Partial<ActiveRun> = {}): ActiveRun {
  const base = createDemoRun();
  return {
    ...base,
    metrics: { ...base.metrics, deepestDepth: 4 },
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
    totals: createDemoRun().metrics,
    ...overrides,
  };
}

const championRecordId = `record.${'1'.repeat(32)}.${'b'.repeat(16)}`;

function championDecision(overrides: Partial<FallenHeroRunDecision> = {}): FallenHeroRunDecision {
  return {
    hallRecordId: championRecordId,
    rank: 1,
    role: 'champion',
    gateRoll: null,
    retained: true,
    encountered: true,
    defeated: true,
    ...overrides,
  };
}

function achievement(
  id: string,
  criteria: AchievementContentEntry['criteria'],
): AchievementContentEntry {
  return {
    kind: 'achievement',
    id,
    name: `Achievement ${id}`,
    tags: [],
    description: 'A test achievement.',
    criteria,
  };
}

function grantedIds(finalized: ReturnType<typeof finalizeRun>): readonly string[] {
  return finalized.deltas.achievementGrants.map((grant) => grant.achievementId);
}

function runWithMetrics(overrides: Partial<ActiveRun['metrics']>): ActiveRun {
  const base = concludedRun();
  return { ...base, metrics: { ...base.metrics, ...overrides } };
}

describe('achievement criteria evaluation', () => {
  it('defeat-boss grants only when the run defeated that boss monster', () => {
    const content = pack([
      achievement('achievement.slay-ashfather', {
        type: 'defeat-boss',
        monsterId: 'monster.ashfather',
      }),
    ]);
    const defeated = finalizeRun({
      run: runWithMetrics({ defeatedBossMonsterIds: ['monster.ashfather'] }),
      content,
      lifetime: emptyLifetime(),
    });
    expect(grantedIds(defeated)).toEqual(['achievement.slay-ashfather']);

    const notDefeated = finalizeRun({
      run: runWithMetrics({ defeatedBossMonsterIds: [] }),
      content,
      lifetime: emptyLifetime(),
    });
    expect(grantedIds(notDefeated)).toEqual([]);

    const otherBoss = finalizeRun({
      run: runWithMetrics({ defeatedBossMonsterIds: ['monster.other'] }),
      content,
      lifetime: emptyLifetime(),
    });
    expect(grantedIds(otherBoss)).toEqual([]);
  });

  it('reach-depth grants at or above the threshold, never below', () => {
    const content = pack([
      achievement('achievement.reach-15', { type: 'reach-depth', depth: 15 }),
      achievement('achievement.reach-20', { type: 'reach-depth', depth: 20 }),
    ]);
    const finalized = finalizeRun({
      run: runWithMetrics({ deepestDepth: 15 }),
      content,
      lifetime: emptyLifetime(),
    });
    expect(grantedIds(finalized)).toEqual(['achievement.reach-15']);

    const shallow = finalizeRun({
      run: runWithMetrics({ deepestDepth: 14 }),
      content,
      lifetime: emptyLifetime(),
    });
    expect(grantedIds(shallow)).toEqual([]);
  });

  it('complete-ending grants only for the matching completion type', () => {
    const content = pack([
      achievement('achievement.broke-cycle', { type: 'complete-ending', ending: 'broke-cycle' }),
    ]);
    const matching = finalizeRun({
      run: concludedRun({
        conclusion: {
          completionType: 'broke-cycle',
          cause: { killerContentId: null, depth: 4, turn: 120, worldTime: 12_000 },
          concludedAtRevision: 9,
          finalized: false,
        },
      }),
      content,
      lifetime: emptyLifetime(),
    });
    expect(grantedIds(matching)).toEqual(['achievement.broke-cycle']);

    const nonMatching = finalizeRun({
      run: concludedRun(), // completionType: 'died'
      content,
      lifetime: emptyLifetime(),
    });
    expect(grantedIds(nonMatching)).toEqual([]);
  });

  it('defeat-fallen-hero grants on a champion first defeat', () => {
    const content = pack([
      achievement('achievement.champion-first', {
        type: 'defeat-fallen-hero',
        role: 'champion',
      }),
    ]);
    const finalized = finalizeRun({
      run: concludedRun({ fallenHeroDecisions: [championDecision()] }),
      content,
      lifetime: emptyLifetime(),
    });
    expect(grantedIds(finalized)).toEqual(['achievement.champion-first']);
  });

  it('grant-once: an already-granted achievement never regrants even though its criterion is still met', () => {
    const content = pack([
      achievement('achievement.champion-first', {
        type: 'defeat-fallen-hero',
        role: 'champion',
      }),
    ]);
    const finalized = finalizeRun({
      run: concludedRun({ fallenHeroDecisions: [championDecision()] }),
      content,
      lifetime: emptyLifetime({ grantedAchievementIds: ['achievement.champion-first'] }),
    });
    expect(grantedIds(finalized)).toEqual([]);
  });
});
