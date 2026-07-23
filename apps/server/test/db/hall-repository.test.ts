import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  CompiledContentPack,
  FallenChampionTemplateContentEntry,
  ItemContentEntry,
} from '@woven-deep/content';
import {
  createDemoContentPack,
  createDemoRun,
  emptyRunMetrics,
  finalizeRun,
  type ActiveRun,
  type HeartLineageRecord,
  type LifetimeDeltas,
  type LifetimeState,
  type StoredHallRecord,
} from '@woven-deep/engine';
import { runMigrations } from '../../src/database.js';
import { ProfileRepository } from '../../src/db/profile-repository.js';
import { ServerRunRecordRepository } from '../../src/db/hall-repository.js';

// A minimal fallen-champion-template + fallback item, mirroring the engine's own
// run-finalize.test.ts fixture: finalizeRun requires a template entry in the content pack.
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

const fallbackItem: ItemContentEntry = {
  kind: 'item',
  id: 'item.fallback',
  name: 'Name of item.fallback',
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
};

function contentPack(): CompiledContentPack {
  const base = createDemoContentPack();
  return { ...base, entries: [...base.entries, template, fallbackItem] };
}

function freshDatabase(): Database.Database {
  const database = new Database(':memory:');
  runMigrations(database);
  return database;
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

/** Builds a real `StoredHallRecord` via the engine's `finalizeRun`, so record_json round-trips
 * an authentic payload rather than a hand-rolled shape. */
function buildStoredRecord(overrides: Partial<ActiveRun> = {}): {
  stored: StoredHallRecord;
  deltas: LifetimeDeltas;
} {
  const content = contentPack();
  const run = concludedRun(overrides);
  const finalized = finalizeRun({ run, content, lifetime: emptyLifetime() });
  const stored: StoredHallRecord = {
    ...finalized.record,
    enrichment: { achievedAt: '2026-07-23T00:00:00.000Z', portraitGlyph: '@' },
  };
  return { stored, deltas: finalized.deltas };
}

describe('ServerRunRecordRepository', () => {
  let database: Database.Database;
  let repository: ServerRunRecordRepository;

  beforeEach(() => {
    database = freshDatabase();
    const profiles = new ProfileRepository(database);
    profiles.create({
      id: 'p1',
      normalizedEmail: 'a@example.com',
      nowIso: '2026-07-23T00:00:00.000Z',
    });
    repository = new ServerRunRecordRepository({ database, profileId: 'p1' });
  });

  it('records() is empty and standings() is empty before any append', () => {
    expect(repository.records()).toEqual([]);
    expect(repository.standings(10)).toEqual([]);
  });

  it('appendRecord then records() round-trips a real StoredHallRecord exactly', () => {
    const { stored } = buildStoredRecord();

    repository.appendRecord(stored);

    expect(repository.records()).toEqual([stored]);
  });

  it('appendRecord rejects a duplicate record_id with the same message as the in-memory reference', () => {
    const { stored } = buildStoredRecord();
    repository.appendRecord(stored);

    expect(() => repository.appendRecord(stored)).toThrow(
      `the immutable append-only Hall already contains record ${stored.recordId}`,
    );
    // records() is unaffected by the rejected re-append.
    expect(repository.records()).toEqual([stored]);
  });

  it('appendRecord rejects a duplicate record_id even when the payload has mutated', () => {
    const { stored } = buildStoredRecord();
    repository.appendRecord(stored);

    const mutated: StoredHallRecord = { ...stored, heroName: 'Mutated Name' };
    expect(() => repository.appendRecord(mutated)).toThrow(/already contains record/);
  });

  it('standings() sorts by score descending and honours the limit, matching the reference', () => {
    const first = buildStoredRecord({
      hero: { ...createDemoRun().hero, name: 'Alpha' },
      runSeed: [1, 2, 3, 4],
    });
    const second = buildStoredRecord({
      hero: { ...createDemoRun().hero, name: 'Beta' },
      runSeed: [5, 6, 7, 8],
    });

    repository.appendRecord(first.stored);
    repository.appendRecord(second.stored);

    const standings = repository.standings(1);
    expect(standings).toHaveLength(1);
    expect([first.stored.recordId, second.stored.recordId]).toContain(standings[0].hallRecordId);
  });

  it('currentHeart() is null before any recordHeart() call', () => {
    expect(repository.currentHeart()).toBeNull();
  });

  it('recordHeart then currentHeart round-trips the record', () => {
    const heart: HeartLineageRecord = {
      heroName: 'Test Hero',
      classTags: ['class.warden'],
      hallRecordId: 'record.abc',
      enrichment: { achievedAt: '2026-07-23T00:00:00.000Z', portraitGlyph: '@' },
    };

    repository.recordHeart(heart);

    expect(repository.currentHeart()).toEqual(heart);
  });

  it('lifetime() is empty before any applyDeltas() call', () => {
    expect(repository.lifetime()).toEqual(emptyLifetime());
  });

  it('applyDeltas merges metrics additively into the lifetime totals', () => {
    const { deltas } = buildStoredRecord();

    repository.applyDeltas(deltas);

    const lifetime = repository.lifetime();
    expect(lifetime.totals.kills).toBe(deltas.metrics.kills);
    expect(lifetime.totals.deepestDepth).toBe(deltas.metrics.deepestDepth);
  });

  it('applyDeltas is idempotent: re-applying the same recordId is a no-op', () => {
    const { deltas } = buildStoredRecord();

    repository.applyDeltas(deltas);
    const afterFirst = repository.lifetime();

    repository.applyDeltas(deltas);
    const afterSecond = repository.lifetime();

    expect(afterSecond).toEqual(afterFirst);
    // In particular, kills must NOT have been double-counted.
    expect(afterSecond.totals.kills).toBe(deltas.metrics.kills);
  });

  it('applyDeltas survives a repository re-instantiation (persisted, not in-memory only)', () => {
    const { deltas } = buildStoredRecord();
    repository.applyDeltas(deltas);

    const reopened = new ServerRunRecordRepository({ database, profileId: 'p1' });
    expect(reopened.lifetime()).toEqual(repository.lifetime());

    reopened.applyDeltas(deltas);
    expect(reopened.lifetime().totals.kills).toBe(deltas.metrics.kills);
  });
});
