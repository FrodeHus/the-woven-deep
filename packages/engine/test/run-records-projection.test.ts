import { describe, expect, it } from 'vitest';
import type { FallenChampionTemplateContentEntry, ItemContentEntry } from '@woven-deep/content';
import {
  createDemoContentPack,
  createDemoRun,
  deriveHallRecordId,
  emptyRunMetrics,
  finalizeRun,
  projectGameplayState,
  projectRunConclusion,
  stableJson,
  type ActiveRun,
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
    rarity: 'common',
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

function pack() {
  const base = createDemoContentPack();
  return { ...base, entries: [...base.entries, template, itemDef('item.fallback')] };
}

function emptyLifetime(): LifetimeState {
  return {
    conqueredChampionRecordIds: [],
    grantedAchievementIds: [],
    discoveryProtection: [],
    totals: emptyRunMetrics(),
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
    conclusion: {
      completionType: 'died',
      cause: { killerContentId: null, depth: 4, turn: 120, worldTime: 12_000 },
      concludedAtRevision: 9,
      finalized: false,
    },
    ...overrides,
  };
}

describe('gameplay projection: metrics and conclusion', () => {
  it('exposes the exact current metrics and a null conclusion for a living run', () => {
    const run = createDemoRun();
    const projected = projectGameplayState({ state: run, content: createDemoContentPack() });
    expect(projected.metrics).toEqual(run.metrics);
    expect(projected.conclusion).toBeNull();
  });

  it('exposes completion type and cause once concluded, and reveals no other hidden state', () => {
    const run = concludedRun();
    const projected = projectGameplayState({ state: run, content: createDemoContentPack() });
    expect(projected.conclusion).toEqual({ completionType: 'died', cause: run.conclusion!.cause });
    const projectedJson = stableJson(projected);
    for (const field of [
      'run-records',
      'fallenHeroStandings',
      'fallenHeroDecisions',
      'encounterDecisions',
      'concludedAtRevision',
    ]) {
      expect(projectedJson, field).not.toContain(field);
    }
  });
});

describe('projectRunConclusion', () => {
  it('returns null while the run has not concluded', () => {
    expect(
      projectRunConclusion({ run: createDemoRun(), record: null, achievements: [] }),
    ).toBeNull();
  });

  it('exposes completion facts and metrics, but no score or heirloom, before finalization', () => {
    const run = concludedRun();
    const projected = projectRunConclusion({ run, record: null, achievements: [] });
    expect(projected).toMatchObject({
      completionType: 'died',
      cause: run.conclusion!.cause,
      metrics: run.metrics,
      finalized: false,
      score: null,
      heirloom: null,
      achievements: [],
    });
  });

  it('exposes the full score breakdown, heirloom, and achievement grants once finalized', () => {
    const content = pack();
    const run = concludedRun();
    const finalized = finalizeRun({ run, content, lifetime: emptyLifetime() });
    const grants = finalized.deltas.achievementGrants;
    const projected = projectRunConclusion({
      run: finalized.run,
      record: finalized.record,
      achievements: grants,
    });
    expect(projected).toMatchObject({
      completionType: 'died',
      finalized: true,
      score: finalized.record.score,
      heirloom: finalized.record.heirloom,
      metrics: finalized.run.metrics,
      achievements: grants,
    });
  });

  it("throws when the supplied record does not carry this run's derived record ID", () => {
    const content = pack();
    const run = concludedRun();
    const finalized = finalizeRun({ run, content, lifetime: emptyLifetime() });
    const mismatched = {
      ...finalized.record,
      recordId: deriveHallRecordId([9, 9, 9, 9], run.contentHash),
    };
    expect(() =>
      projectRunConclusion({ run: finalized.run, record: mismatched, achievements: [] }),
    ).toThrow(/record/i);
  });
});
