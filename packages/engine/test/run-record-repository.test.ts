import { describe, expect, it } from 'vitest';
import {
  compareHallRecords, createInMemoryRunRecordRepository, emptyRunMetrics, standingsFromRecords,
  type HallRecordOrdering, type HeartLineageRecord, type LifetimeDeltas, type RunMetrics, type StoredHallRecord,
} from '../src/index.js';

function metrics(overrides: Partial<RunMetrics> = {}): RunMetrics {
  return { ...emptyRunMetrics(), ...overrides };
}

function storedRecord(overrides: Partial<StoredHallRecord> = {}): StoredHallRecord {
  return {
    recordId: 'record.aaaaaaaa00000000.aaaaaaaaaaaaaaaa',
    heroName: 'Ada',
    classTags: ['fighter'],
    completionType: 'died',
    cause: { killerContentId: 'monster.cave-rat', depth: 3, turn: 12, worldTime: 12 },
    deepestDepth: 3,
    score: { lines: [], total: 40 },
    metrics: metrics({ deepestDepth: 3 }),
    reputations: [],
    heirloom: {
      contentId: 'item.iron-sword', sourceItemId: null, enchantment: null, condition: 100,
      charges: null, fuel: null, qualityRank: 1, displayName: "Ada's Iron Sword",
      glyph: ')', color: '#d8d8d8', originatingHallRecordId: 'record.aaaaaaaa00000000.aaaaaaaaaaaaaaaa',
    },
    build: {
      attributes: { might: 14, agility: 12, vitality: 16, wits: 10, resolve: 12 },
      equippedItemContentIds: ['item.iron-sword'],
      signatureAbilityIds: [],
    },
    runSeed: 'aaaaaaaa00000000',
    contentHash: 'b'.repeat(64),
    enrichment: { achievedAt: '2026-01-01', portraitGlyph: '@' },
    ...overrides,
  };
}

function secondStoredRecord(): StoredHallRecord {
  return storedRecord({
    recordId: 'record.bbbbbbbb00000000.bbbbbbbbbbbbbbbb',
    heroName: 'Bryn',
    score: { lines: [], total: 90 },
    cause: { killerContentId: 'monster.cave-rat', depth: 5, turn: 20, worldTime: 20 },
    deepestDepth: 5,
    heirloom: {
      contentId: 'item.iron-sword', sourceItemId: null, enchantment: null, condition: 100,
      charges: null, fuel: null, qualityRank: 1, displayName: "Bryn's Iron Sword",
      glyph: ')', color: '#d8d8d8', originatingHallRecordId: 'record.bbbbbbbb00000000.bbbbbbbbbbbbbbbb',
    },
  });
}

describe('compareHallRecords sanity for fixtures', () => {
  it('ranks the higher score first', () => {
    const left: HallRecordOrdering = { recordId: 'a', completionType: 'died', score: { lines: [], total: 90 } };
    const right: HallRecordOrdering = { recordId: 'b', completionType: 'died', score: { lines: [], total: 40 } };
    expect(compareHallRecords(left, right)).toBeLessThan(0);
  });
});

describe('standingsFromRecords', () => {
  it('filters to died records with positive depth, ranks by compareHallRecords, and maps every field', () => {
    const storedRecordA = storedRecord();
    const second = secondStoredRecord();
    const standings = standingsFromRecords([storedRecordA, second], 10);
    expect(standings).toHaveLength(2);
    expect(standings[0]).toMatchObject({
      rank: 1, hallRecordId: second.recordId, heroName: second.heroName, portraitGlyph: second.enrichment.portraitGlyph,
      classTags: second.classTags, attributes: second.build.attributes,
      equippedItemContentIds: second.build.equippedItemContentIds, signatureAbilityIds: second.build.signatureAbilityIds,
      deathDepth: second.cause.depth, sourceContentHash: second.contentHash, heirloom: second.heirloom,
    });
    expect(standings[1]).toMatchObject({ rank: 2, hallRecordId: storedRecordA.recordId, deathDepth: storedRecordA.cause.depth });
  });

  it('excludes non-died records and non-positive death depth, and caps at 10 with contiguous ranks', () => {
    const conquered = storedRecord({ recordId: 'record.cccccccc00000000.cccccccccccccccc', completionType: 'broke-cycle', score: { lines: [], total: 999 } });
    const zeroDepth = storedRecord({ recordId: 'record.dddddddd00000000.dddddddddddddddd', cause: { killerContentId: null, depth: 0, turn: 1, worldTime: 1 } });
    const many = Array.from({ length: 12 }, (_, index) => storedRecord({
      recordId: `record.${(index + 10).toString(16).padStart(8, '0')}00000000.${'e'.repeat(16)}`,
      score: { lines: [], total: index },
    }));
    const standings = standingsFromRecords([conquered, zeroDepth, ...many], 100);
    expect(standings).toHaveLength(10);
    expect(standings.map((entry) => entry.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('a conquered record that remains the high scorer stays out of standings (no promotion)', () => {
    const conquered = storedRecord({ recordId: 'record.cccccccc00000000.cccccccccccccccc', completionType: 'broke-cycle', score: { lines: [], total: 999 } });
    const died = storedRecord();
    const standings = standingsFromRecords([conquered, died], 10);
    expect(standings).toHaveLength(1);
    expect(standings[0]?.rank).toBe(1);
    expect(standings[0]?.hallRecordId).toBe(died.recordId);
  });
});

describe('createInMemoryRunRecordRepository', () => {
  it('records() returns an immutable snapshot in insertion order', () => {
    const repository = createInMemoryRunRecordRepository();
    const storedRecordA = storedRecord();
    const second = secondStoredRecord();
    repository.appendRecord(storedRecordA);
    repository.appendRecord(second);
    const records = repository.records();
    expect(records).toEqual([storedRecordA, second]);
    expect(Object.isFrozen(records[0])).toBe(true);
    expect(() => { (records as StoredHallRecord[]).push(storedRecordA); }).toThrow();
  });

  it('rejects appending a duplicate record ID, including a mutated re-append', () => {
    const repository = createInMemoryRunRecordRepository();
    const storedRecordA = storedRecord();
    repository.appendRecord(storedRecordA);
    expect(() => repository.appendRecord({ ...storedRecordA, heroName: 'Impostor' }))
      .toThrow(/immutable append-only Hall/);
    expect(() => repository.appendRecord(storedRecordA)).toThrow(/immutable append-only Hall/);
  });

  it('standings(limit) reflects appended records', () => {
    const repository = createInMemoryRunRecordRepository();
    const storedRecordA = storedRecord();
    repository.appendRecord(storedRecordA);
    expect(repository.standings(10)[0]).toMatchObject({
      rank: 1, hallRecordId: storedRecordA.recordId, deathDepth: storedRecordA.cause.depth,
      heirloom: storedRecordA.heirloom, sourceContentHash: storedRecordA.contentHash,
    });
  });

  it('currentHeart starts null and recordHeart replaces most-recent-wins with at most one current Heart', () => {
    const repository = createInMemoryRunRecordRepository();
    expect(repository.currentHeart()).toBeNull();
    const first: HeartLineageRecord = {
      heroName: 'Ada', classTags: ['fighter'], hallRecordId: 'record.aaaaaaaa00000000.aaaaaaaaaaaaaaaa',
      enrichment: { achievedAt: '2026-01-01', portraitGlyph: '@' },
    };
    const second: HeartLineageRecord = {
      heroName: 'Bryn', classTags: ['ranger'], hallRecordId: 'record.bbbbbbbb00000000.bbbbbbbbbbbbbbbb',
      enrichment: { achievedAt: '2026-01-02', portraitGlyph: '&' },
    };
    repository.recordHeart(first);
    expect(repository.currentHeart()).toEqual(first);
    repository.recordHeart(second);
    expect(repository.currentHeart()).toEqual(second);
  });

  it('applyDeltas merges conquered/achievement IDs as sorted unions, replaces discovery-protection bonuses by encounter ID, and merges metrics additively except deepestDepth (maximum); reapplying an already-applied recordId is idempotent', () => {
    const repository = createInMemoryRunRecordRepository();
    const deltas: LifetimeDeltas = {
      recordId: 'record.aaaaaaaa00000000.aaaaaaaaaaaaaaaa',
      newlyConqueredChampionRecordIds: ['record.champ-b', 'record.champ-a'],
      achievementGrants: [
        { achievementId: 'achievement.b', criteriaId: 'first-echo-defeat', name: 'B' },
        { achievementId: 'achievement.a', criteriaId: 'first-champion-defeat', name: 'A' },
      ],
      discoveryProtectionUpdates: [
        { encounterId: 'encounter.rats', previousBonus: 0, nextBonus: 0.2, outcome: 'unreached' },
      ],
      metrics: metrics({ kills: 3, deepestDepth: 4, damageDealt: 50 }),
    };
    repository.applyDeltas(deltas);
    const afterFirst = repository.lifetime();
    expect(afterFirst.conqueredChampionRecordIds).toEqual(['record.champ-a', 'record.champ-b']);
    expect(afterFirst.grantedAchievementIds).toEqual(['achievement.a', 'achievement.b']);
    expect(afterFirst.discoveryProtection).toEqual([{ encounterId: 'encounter.rats', bonus: 0.2 }]);
    expect(afterFirst.totals).toEqual(metrics({ kills: 3, deepestDepth: 4, damageDealt: 50 }));

    const secondDeltas: LifetimeDeltas = {
      recordId: 'record.bbbbbbbb00000000.bbbbbbbbbbbbbbbb',
      newlyConqueredChampionRecordIds: ['record.champ-c'],
      achievementGrants: [],
      discoveryProtectionUpdates: [
        { encounterId: 'encounter.rats', previousBonus: 0.2, nextBonus: 0.3, outcome: 'unreached' },
        { encounterId: 'encounter.bats', previousBonus: 0, nextBonus: 0.1, outcome: 'reached-unseen' },
      ],
      metrics: metrics({ kills: 2, deepestDepth: 2, damageDealt: 10 }),
    };
    repository.applyDeltas(secondDeltas);
    const afterSecond = repository.lifetime();
    expect(afterSecond.conqueredChampionRecordIds).toEqual(['record.champ-a', 'record.champ-b', 'record.champ-c']);
    expect(afterSecond.discoveryProtection).toEqual([
      { encounterId: 'encounter.bats', bonus: 0.1 },
      { encounterId: 'encounter.rats', bonus: 0.3 },
    ]);
    expect(afterSecond.totals).toEqual(metrics({ kills: 5, deepestDepth: 4, damageDealt: 60 }));

    repository.applyDeltas(deltas);
    const mergedOnce = afterSecond.totals;
    expect(repository.lifetime().totals).toEqual(mergedOnce);
    expect(repository.lifetime()).toEqual(afterSecond);
  });
});
