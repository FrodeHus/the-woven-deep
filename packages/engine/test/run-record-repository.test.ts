import { describe, expect, it } from 'vitest';
import {
  compareHallRecords,
  createInMemoryRunRecordRepository,
  emptyRunMetrics,
  standingsFromRecords,
  type ArtifactDeltas,
  type HallRecordOrdering,
  type HeartLineageRecord,
  type LifetimeDeltas,
  type OpaqueId,
  type RunMetrics,
  type StoredHallRecord,
} from '../src/index.js';

function metrics(overrides: Partial<RunMetrics> = {}): RunMetrics {
  return { ...emptyRunMetrics(), ...overrides };
}

function storedRecord(overrides: Partial<StoredHallRecord> = {}): StoredHallRecord {
  const heirloom = {
    contentId: 'item.iron-sword',
    sourceItemId: null,
    enchantment: null,
    condition: 100,
    charges: null,
    fuel: null,
    qualityRank: 1,
    displayName: "Ada's Iron Sword",
    glyph: ')',
    color: '#d8d8d8',
    originatingHallRecordId: 'record.aaaaaaaa00000000.aaaaaaaaaaaaaaaa',
  };
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
    heirloom,
    deathInventory: [heirloom],
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
  const heirloom = {
    contentId: 'item.iron-sword',
    sourceItemId: null,
    enchantment: null,
    condition: 100,
    charges: null,
    fuel: null,
    qualityRank: 1,
    displayName: "Bryn's Iron Sword",
    glyph: ')',
    color: '#d8d8d8',
    originatingHallRecordId: 'record.bbbbbbbb00000000.bbbbbbbbbbbbbbbb',
  };
  return storedRecord({
    recordId: 'record.bbbbbbbb00000000.bbbbbbbbbbbbbbbb',
    heroName: 'Bryn',
    score: { lines: [], total: 90 },
    cause: { killerContentId: 'monster.cave-rat', depth: 5, turn: 20, worldTime: 20 },
    deepestDepth: 5,
    heirloom,
    deathInventory: [heirloom],
  });
}

describe('compareHallRecords sanity for fixtures', () => {
  it('ranks the higher score first', () => {
    const left: HallRecordOrdering = {
      recordId: 'a',
      completionType: 'died',
      score: { lines: [], total: 90 },
    };
    const right: HallRecordOrdering = {
      recordId: 'b',
      completionType: 'died',
      score: { lines: [], total: 40 },
    };
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
      rank: 1,
      hallRecordId: second.recordId,
      heroName: second.heroName,
      portraitGlyph: second.enrichment.portraitGlyph,
      classTags: second.classTags,
      attributes: second.build.attributes,
      equippedItemContentIds: second.build.equippedItemContentIds,
      signatureAbilityIds: second.build.signatureAbilityIds,
      deathDepth: second.cause.depth,
      sourceContentHash: second.contentHash,
      heirloom: second.heirloom,
    });
    expect(standings[1]).toMatchObject({
      rank: 2,
      hallRecordId: storedRecordA.recordId,
      deathDepth: storedRecordA.cause.depth,
    });
  });

  it('excludes non-died records and non-positive death depth, and caps at 10 with contiguous ranks', () => {
    const conquered = storedRecord({
      recordId: 'record.cccccccc00000000.cccccccccccccccc',
      completionType: 'broke-cycle',
      score: { lines: [], total: 999 },
    });
    const zeroDepth = storedRecord({
      recordId: 'record.dddddddd00000000.dddddddddddddddd',
      cause: { killerContentId: null, depth: 0, turn: 1, worldTime: 1 },
    });
    const many = Array.from({ length: 12 }, (_, index) =>
      storedRecord({
        recordId: `record.${(index + 10).toString(16).padStart(8, '0')}00000000.${'e'.repeat(16)}`,
        score: { lines: [], total: index },
      }),
    );
    const standings = standingsFromRecords([conquered, zeroDepth, ...many], 100);
    expect(standings).toHaveLength(10);
    expect(standings.map((entry) => entry.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('a conquered record that remains the high scorer stays out of standings (no promotion)', () => {
    const conquered = storedRecord({
      recordId: 'record.cccccccc00000000.cccccccccccccccc',
      completionType: 'broke-cycle',
      score: { lines: [], total: 999 },
    });
    const died = storedRecord();
    const standings = standingsFromRecords([conquered, died], 10);
    expect(standings).toHaveLength(1);
    expect(standings[0]?.rank).toBe(1);
    expect(standings[0]?.hallRecordId).toBe(died.recordId);
  });

  it('a limit of 0 returns no standings', () => {
    const standings = standingsFromRecords([storedRecord(), secondStoredRecord()], 0);
    expect(standings).toEqual([]);
  });

  it('a negative limit clamps to no standings rather than returning all-but-last', () => {
    const standings = standingsFromRecords([storedRecord(), secondStoredRecord()], -1);
    expect(standings).toEqual([]);
  });

  it('copies the record cause and death inventory into the standing', () => {
    const secondEquipped = {
      contentId: 'item.leather-cap',
      sourceItemId: null,
      enchantment: null,
      condition: 80,
      charges: null,
      fuel: null,
      qualityRank: 0,
      displayName: 'Worn Leather Cap',
      glyph: '[',
      color: '#8a6d3b',
      originatingHallRecordId: 'record.aaaaaaaa00000000.aaaaaaaaaaaaaaaa',
    };
    const record = storedRecord({
      cause: { killerContentId: 'monster.bone-gnawer', depth: 7, turn: 9, worldTime: 90 },
      deathInventory: [
        {
          contentId: 'item.iron-sword',
          sourceItemId: null,
          enchantment: null,
          condition: 100,
          charges: null,
          fuel: null,
          qualityRank: 1,
          displayName: "Ada's Iron Sword",
          glyph: ')',
          color: '#d8d8d8',
          originatingHallRecordId: 'record.aaaaaaaa00000000.aaaaaaaaaaaaaaaa',
        },
        secondEquipped,
      ],
    });
    const [standing] = standingsFromRecords([record], 10);
    expect(standing!.cause).toEqual(record.cause);
    expect(standing!.deathInventory).toEqual(record.deathInventory);
  });

  it('falls back to the heirloom alone for a record with no death inventory', () => {
    const legacy = { ...storedRecord(), deathInventory: undefined } as unknown as StoredHallRecord;
    const [standing] = standingsFromRecords([legacy], 10);
    expect(standing!.deathInventory).toEqual([legacy.heirloom]);
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
    expect(() => {
      (records as StoredHallRecord[]).push(storedRecordA);
    }).toThrow();
  });

  it('rejects appending a duplicate record ID, including a mutated re-append', () => {
    const repository = createInMemoryRunRecordRepository();
    const storedRecordA = storedRecord();
    repository.appendRecord(storedRecordA);
    expect(() => repository.appendRecord({ ...storedRecordA, heroName: 'Impostor' })).toThrow(
      /immutable append-only Hall/,
    );
    expect(() => repository.appendRecord(storedRecordA)).toThrow(/immutable append-only Hall/);
  });

  it('deep-freezes appended records so mutations of the caller original do not affect the Hall', () => {
    const repository = createInMemoryRunRecordRepository();
    // Create a mutable clone of a record via structuredClone
    const mutableRecord = structuredClone(storedRecord()) as StoredHallRecord;
    repository.appendRecord(mutableRecord);

    // Mutate nested field of the original/mutable record
    (mutableRecord.build.equippedItemContentIds as OpaqueId[]).push('item.fake-item' as OpaqueId);

    // Verify the Hall's stored copy is unaffected
    const hallRecords = repository.records();
    expect(hallRecords[0]?.build.equippedItemContentIds).toEqual(['item.iron-sword']);
  });

  it('standings(limit) reflects appended records', () => {
    const repository = createInMemoryRunRecordRepository();
    const storedRecordA = storedRecord();
    repository.appendRecord(storedRecordA);
    expect(repository.standings(10)[0]).toMatchObject({
      rank: 1,
      hallRecordId: storedRecordA.recordId,
      deathDepth: storedRecordA.cause.depth,
      heirloom: storedRecordA.heirloom,
      sourceContentHash: storedRecordA.contentHash,
    });
  });

  it('currentHeart starts null and recordHeart replaces most-recent-wins with at most one current Heart', () => {
    const repository = createInMemoryRunRecordRepository();
    expect(repository.currentHeart()).toBeNull();
    const first: HeartLineageRecord = {
      heroName: 'Ada',
      classTags: ['fighter'],
      hallRecordId: 'record.aaaaaaaa00000000.aaaaaaaaaaaaaaaa',
      enrichment: { achievedAt: '2026-01-01', portraitGlyph: '@' },
    };
    const second: HeartLineageRecord = {
      heroName: 'Bryn',
      classTags: ['ranger'],
      hallRecordId: 'record.bbbbbbbb00000000.bbbbbbbbbbbbbbbb',
      enrichment: { achievedAt: '2026-01-02', portraitGlyph: '&' },
    };
    repository.recordHeart(first);
    expect(repository.currentHeart()).toEqual(first);
    repository.recordHeart(second);
    expect(repository.currentHeart()).toEqual(second);
  });

  it('deep-freezes recorded Hearts so mutations of the caller original do not affect currentHeart', () => {
    const repository = createInMemoryRunRecordRepository();
    const mutableHeart = structuredClone({
      heroName: 'Ada',
      classTags: ['fighter'],
      hallRecordId: 'record.aaaaaaaa00000000.aaaaaaaaaaaaaaaa',
      enrichment: { achievedAt: '2026-01-01', portraitGlyph: '@' },
    }) as HeartLineageRecord;
    repository.recordHeart(mutableHeart);

    // Mutate a nested field of the original/mutable record
    (mutableHeart.enrichment as { achievedAt: string }).achievedAt = '2099-12-31';

    // Verify the stored Heart is unaffected
    expect(repository.currentHeart()?.enrichment.achievedAt).toBe('2026-01-01');
  });

  it('applyDeltas merges conquered/achievement IDs as sorted unions, replaces discovery-protection bonuses by encounter ID, and merges metrics additively except deepestDepth (maximum); reapplying an already-applied recordId is idempotent', () => {
    const repository = createInMemoryRunRecordRepository();
    const deltas: LifetimeDeltas = {
      recordId: 'record.aaaaaaaa00000000.aaaaaaaaaaaaaaaa',
      newlyConqueredChampionRecordIds: ['record.champ-b', 'record.champ-a'],
      achievementGrants: [
        { achievementId: 'achievement.b', name: 'B' },
        { achievementId: 'achievement.a', name: 'A' },
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
        {
          encounterId: 'encounter.bats',
          previousBonus: 0,
          nextBonus: 0.1,
          outcome: 'reached-unseen',
        },
      ],
      metrics: metrics({ kills: 2, deepestDepth: 2, damageDealt: 10 }),
    };
    repository.applyDeltas(secondDeltas);
    const afterSecond = repository.lifetime();
    expect(afterSecond.conqueredChampionRecordIds).toEqual([
      'record.champ-a',
      'record.champ-b',
      'record.champ-c',
    ]);
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

function outrankingRecords(count: number): readonly StoredHallRecord[] {
  return Array.from({ length: count }, (_unused, index) =>
    storedRecord({
      recordId: `record.rival${index}`,
      heroName: `Rival ${index}`,
      score: { lines: [], total: 500 + index },
    }),
  );
}

function lostToDeltas(recordId: OpaqueId, heroName: string): ArtifactDeltas {
  return {
    recordId,
    stints: [
      {
        artifactId: 'artifact.sundered-crown',
        stint: { heroName, recordId, outcome: 'died-with', depth: 5 },
        newStatus: 'lost',
        holderRecordId: recordId,
      },
    ],
  };
}

describe('in-memory repository artifact ledger', () => {
  it('starts with an empty ledger', () => {
    expect(createInMemoryRunRecordRepository().artifactLedger()).toEqual([]);
  });

  it('applyArtifactDeltas folds a stint onto the ledger', () => {
    const repository = createInMemoryRunRecordRepository();
    const record = storedRecord();
    repository.appendRecord(record);
    repository.applyArtifactDeltas(lostToDeltas(record.recordId, record.heroName));

    expect(repository.artifactLedger()).toEqual([
      {
        artifactId: 'artifact.sundered-crown',
        status: 'lost',
        holderRecordId: record.recordId,
        provenance: [
          {
            heroName: record.heroName,
            recordId: record.recordId,
            outcome: 'died-with',
            depth: 5,
          },
        ],
      },
    ]);
  });

  it('applyArtifactDeltas is idempotent by recordId', () => {
    const repository = createInMemoryRunRecordRepository();
    const record = storedRecord();
    repository.appendRecord(record);
    const deltas = lostToDeltas(record.recordId, record.heroName);

    repository.applyArtifactDeltas(deltas);
    const afterFirst = repository.artifactLedger();
    repository.applyArtifactDeltas(deltas);

    expect(repository.artifactLedger()).toEqual(afterFirst);
    expect(repository.artifactLedger()[0].provenance).toHaveLength(1);
  });

  it('reconciles on appendRecord: an evicted holder releases the artifact back to the deep', () => {
    const repository = createInMemoryRunRecordRepository();
    const holder = storedRecord();
    repository.appendRecord(holder);
    repository.applyArtifactDeltas(lostToDeltas(holder.recordId, holder.heroName));
    expect(repository.artifactLedger()[0].status).toBe('lost');

    for (const rival of outrankingRecords(10)) {
      repository.appendRecord(rival);
    }

    expect(repository.artifactLedger()).toEqual([
      {
        artifactId: 'artifact.sundered-crown',
        status: 'undiscovered',
        holderRecordId: null,
        provenance: [
          { heroName: holder.heroName, recordId: holder.recordId, outcome: 'died-with', depth: 5 },
          {
            heroName: holder.heroName,
            recordId: holder.recordId,
            outcome: 'reclaimed-by-the-deep',
            depth: 0,
          },
        ],
      },
    ]);
  });

  it('rejects a delta whose status and holder disagree', () => {
    const repository = createInMemoryRunRecordRepository();
    expect(() =>
      repository.applyArtifactDeltas({
        recordId: 'record.broken',
        stints: [
          {
            artifactId: 'artifact.sundered-crown',
            stint: {
              heroName: 'Ada',
              recordId: 'record.broken',
              outcome: 'died-with',
              depth: 2,
            },
            newStatus: 'lost',
            holderRecordId: null,
          },
        ],
      }),
    ).toThrow(/holder/i);
  });

  it('a rejected batch does not burn its recordId: a corrected retry still applies', () => {
    const repository = createInMemoryRunRecordRepository();
    const record = storedRecord();
    repository.appendRecord(record);

    const malformed: ArtifactDeltas = {
      recordId: record.recordId,
      stints: [
        {
          artifactId: 'artifact.sundered-crown',
          stint: {
            heroName: record.heroName,
            recordId: record.recordId,
            outcome: 'died-with',
            depth: 5,
          },
          newStatus: 'lost',
          holderRecordId: null,
        },
      ],
    };

    expect(() => repository.applyArtifactDeltas(malformed)).toThrow(/holder/i);
    expect(repository.artifactLedger()).toEqual([]);

    repository.applyArtifactDeltas(lostToDeltas(record.recordId, record.heroName));
    expect(repository.artifactLedger()[0]?.status).toBe('lost');
    expect(repository.artifactLedger()[0]?.provenance).toHaveLength(1);
  });
});
