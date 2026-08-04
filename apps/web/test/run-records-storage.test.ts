import { describe, expect, it } from 'vitest';
import type {
  FallenChampionTemplateContentEntry,
  ItemContentEntry,
  MonsterContentEntry,
} from '@woven-deep/content';
import {
  createDemoContentPack,
  createDemoRun,
  finalizeRun,
  emptyRunMetrics,
  resolveCommand,
  type ActiveRun,
  type GameCommand,
  type HeartLineageRecord,
  type LifetimeDeltas,
  type ArtifactDeltas,
  type OpaqueId,
  type RunMetrics,
  type StoredHallRecord,
} from '@woven-deep/engine';
import {
  createSessionRunRecordRepository,
  RECORDS_KEY,
  SessionHallCorruptError,
} from '../src/session/run-records-storage.js';
import type { SessionStorageLike } from '../src/session/storage.js';

function fakeStorage(): SessionStorageLike & { peek(key: string): string | null } {
  const values = new Map<string, string>();
  return {
    get: (key: string) => values.get(key) ?? null,
    set: (key: string, value: string) => {
      values.set(key, value);
    },
    peek: (key: string) => values.get(key) ?? null,
  };
}

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
    curse: null,
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
    enrichment: { achievedAt: 'Run #1', portraitGlyph: '@' },
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
    curse: null,
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

const fallenChampionTemplate: FallenChampionTemplateContentEntry = {
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
    classFavors: {},
    causelessCategories: [],
    defaultCategories: ['food'],
  },
};

const fallbackItem: ItemContentEntry = {
  kind: 'item',
  id: 'item.fallback',
  name: 'Fallback item',
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
  modifiers: {},
  equipment: { slots: ['main-hand'], handedness: 'one-handed', reservedSlots: [] },
  combat: null,
  light: null,
  artifact: null,
  identification: { mode: 'known', poolId: null },
  effects: [],
};

const fallbackMonster: MonsterContentEntry = {
  kind: 'monster',
  id: 'monster.boss',
  name: 'Boss',
  glyph: 'B',
  color: '#aa4444',
  tags: [],
  minDepth: 1,
  maxDepth: 20,
  attributes: { might: 5, agility: 5, vitality: 5, wits: 5, resolve: 5 },
  health: 10,
  speed: 100,
  accuracy: 100,
  defense: 8,
  perception: 8,
  damage: { count: 1, sides: 1, bonus: 0 },
  armor: 0,
  resistances: { physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0, arcane: 0 },
  disposition: 'hostile',
  behaviorId: 'behavior.approach-and-attack',
  behaviorParameters: {},
  rarity: 'common',
  threat: 4,
  lootTableId: null,
  dropChance: 1,
  onHitConditions: [],
};

/** Builds a genuine `StoredHallRecord` by driving a real demo run to death via `resolveCommand`
 * and finalizing it through the real engine — following `run-finalize.test.ts`'s fixtures. */
function realHallRecord(): StoredHallRecord {
  const base = createDemoContentPack();
  const content = {
    ...base,
    entries: [...base.entries, fallenChampionTemplate, fallbackItem, fallbackMonster],
  };
  const demo = createDemoRun();
  const hero = { ...demo.actors[0]!, health: 1 };
  const starving: ActiveRun = {
    ...demo,
    actors: [hero],
    survival: { ...demo.survival, hungerReserve: 0, hungerStage: 'starving', nextStarvationAt: 1 },
  };
  const command: GameCommand = { type: 'wait', commandId: 'command.fatal', expectedRevision: 0 };
  const killing = resolveCommand(starving, command, { content });
  const finalized = finalizeRun({
    run: killing.state,
    content,
    lifetime: {
      conqueredChampionRecordIds: [],
      grantedAchievementIds: [],
      discoveryProtection: [],
      totals: emptyRunMetrics(),
    },
  });
  return { ...finalized.record, enrichment: { achievedAt: 'Run #1', portraitGlyph: '@' } };
}

describe('createSessionRunRecordRepository', () => {
  it('records() returns an immutable snapshot in insertion order', () => {
    const repository = createSessionRunRecordRepository(fakeStorage());
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
    const repository = createSessionRunRecordRepository(fakeStorage());
    const storedRecordA = storedRecord();
    repository.appendRecord(storedRecordA);
    expect(() => repository.appendRecord({ ...storedRecordA, heroName: 'Impostor' })).toThrow(
      /immutable append-only Hall/,
    );
    expect(() => repository.appendRecord(storedRecordA)).toThrow(/immutable append-only Hall/);
  });

  it('deep-freezes appended records so mutations of the caller original do not affect the Hall', () => {
    const repository = createSessionRunRecordRepository(fakeStorage());
    const mutableRecord = structuredClone(storedRecord()) as StoredHallRecord;
    repository.appendRecord(mutableRecord);

    (mutableRecord.build.equippedItemContentIds as OpaqueId[]).push('item.fake-item' as OpaqueId);

    const hallRecords = repository.records();
    expect(hallRecords[0]?.build.equippedItemContentIds).toEqual(['item.iron-sword']);
  });

  it('standings(limit) reflects appended records', () => {
    const repository = createSessionRunRecordRepository(fakeStorage());
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
    const repository = createSessionRunRecordRepository(fakeStorage());
    expect(repository.currentHeart()).toBeNull();
    const first: HeartLineageRecord = {
      heroName: 'Ada',
      classTags: ['fighter'],
      hallRecordId: 'record.aaaaaaaa00000000.aaaaaaaaaaaaaaaa',
      enrichment: { achievedAt: 'Run #1', portraitGlyph: '@' },
    };
    const second: HeartLineageRecord = {
      heroName: 'Bryn',
      classTags: ['ranger'],
      hallRecordId: 'record.bbbbbbbb00000000.bbbbbbbbbbbbbbbb',
      enrichment: { achievedAt: 'Run #2', portraitGlyph: '&' },
    };
    repository.recordHeart(first);
    expect(repository.currentHeart()).toEqual(first);
    repository.recordHeart(second);
    expect(repository.currentHeart()).toEqual(second);
  });

  it('deep-freezes recorded Hearts so mutations of the caller original do not affect currentHeart', () => {
    const repository = createSessionRunRecordRepository(fakeStorage());
    const mutableHeart = structuredClone({
      heroName: 'Ada',
      classTags: ['fighter'],
      hallRecordId: 'record.aaaaaaaa00000000.aaaaaaaaaaaaaaaa',
      enrichment: { achievedAt: 'Run #1', portraitGlyph: '@' },
    }) as HeartLineageRecord;
    repository.recordHeart(mutableHeart);

    (mutableHeart.enrichment as { achievedAt: string }).achievedAt = 'Run #99';

    expect(repository.currentHeart()?.enrichment.achievedAt).toBe('Run #1');
  });

  it('applyDeltas merges conquered/achievement IDs as sorted unions, replaces discovery-protection bonuses by encounter ID, and merges metrics additively except deepestDepth (maximum); reapplying an already-applied recordId is idempotent', () => {
    const repository = createSessionRunRecordRepository(fakeStorage());
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

    repository.applyDeltas(deltas);
    expect(repository.lifetime()).toEqual(afterFirst);
  });

  it('persists every mutation under RECORDS_KEY: a second repository over the same storage sees the same records and lifetime', () => {
    const storage = fakeStorage();
    const first = createSessionRunRecordRepository(storage);
    const storedRecordA = storedRecord();
    first.appendRecord(storedRecordA);
    first.applyDeltas({
      recordId: storedRecordA.recordId,
      newlyConqueredChampionRecordIds: [],
      achievementGrants: [],
      discoveryProtectionUpdates: [],
      metrics: metrics({ kills: 2 }),
    });
    const heart: HeartLineageRecord = {
      heroName: 'Ada',
      classTags: [],
      hallRecordId: storedRecordA.recordId,
      enrichment: { achievedAt: 'Run #1', portraitGlyph: '@' },
    };
    first.recordHeart(heart);

    expect(storage.peek(RECORDS_KEY)).not.toBeNull();

    const second = createSessionRunRecordRepository(storage);
    expect(second.records()).toEqual(first.records());
    expect(second.lifetime()).toEqual(first.lifetime());
    expect(second.currentHeart()).toEqual(first.currentHeart());

    // Re-applying the same delta a second time (against the reloaded instance) stays idempotent.
    second.applyDeltas({
      recordId: storedRecordA.recordId,
      newlyConqueredChampionRecordIds: [],
      achievementGrants: [],
      discoveryProtectionUpdates: [],
      metrics: metrics({ kills: 99 }),
    });
    expect(second.lifetime()).toEqual(first.lifetime());
  });

  it('persists a genuine engine-produced StoredHallRecord across repository instances', () => {
    const storage = fakeStorage();
    const record = realHallRecord();
    const first = createSessionRunRecordRepository(storage);
    first.appendRecord(record);

    const second = createSessionRunRecordRepository(storage);
    expect(second.records()).toEqual([record]);
    expect(second.standings(10)[0]).toMatchObject({ hallRecordId: record.recordId });
  });

  it('a corrupt blob throws SessionHallCorruptError at creation and leaves the storage key cleared', () => {
    const storage = fakeStorage();
    storage.set(RECORDS_KEY, '{"not": "a valid hall blob"}');

    expect(() => createSessionRunRecordRepository(storage)).toThrow(SessionHallCorruptError);

    // The key no longer holds the corrupt blob: a subsequent construction succeeds with an empty Hall.
    const recovered = createSessionRunRecordRepository(storage);
    expect(recovered.records()).toEqual([]);
    expect(recovered.currentHeart()).toBeNull();
  });

  it('a non-JSON blob also throws SessionHallCorruptError and clears the key', () => {
    const storage = fakeStorage();
    storage.set(RECORDS_KEY, 'not even json{{{');

    expect(() => createSessionRunRecordRepository(storage)).toThrow(SessionHallCorruptError);
    expect(() => createSessionRunRecordRepository(storage)).not.toThrow();
  });

  it('migrates a legacy (pre-versioning, pre-7C) stored Hall without throwing', () => {
    // Simulates a blob written before `version` and `defeatedBossMonsterIds` existed: no
    // `version` field, `lifetime.totals` lacks `defeatedBossMonsterIds` entirely (the exact
    // shape that used to hit `mergedSortedUnion(totals.defeatedBossMonsterIds, undefined)` and
    // throw a TypeError on the next merge) plus a missing numeric field (`restsCompleted`), and
    // a stored record whose `metrics` is likewise incomplete.
    const legacyTotals = { ...metrics({ kills: 4, bossKills: 1 }) } as Record<string, unknown>;
    delete legacyTotals['defeatedBossMonsterIds'];
    delete legacyTotals['restsCompleted'];

    const legacyRecordMetrics = { ...metrics({ kills: 2 }) } as Record<string, unknown>;
    delete legacyRecordMetrics['defeatedBossMonsterIds'];
    const legacyRecord = { ...storedRecord(), metrics: legacyRecordMetrics };

    const legacyBlob = {
      // no `version` field
      records: [legacyRecord],
      heart: null,
      lifetime: {
        conqueredChampionRecordIds: [],
        grantedAchievementIds: [],
        discoveryProtection: [],
        totals: legacyTotals,
      },
      appliedDeltaRecordIds: [],
    };

    const storage = fakeStorage();
    storage.set(RECORDS_KEY, JSON.stringify(legacyBlob));

    let repository: ReturnType<typeof createSessionRunRecordRepository>;
    expect(() => {
      repository = createSessionRunRecordRepository(storage);
    }).not.toThrow();

    const lifetime = repository!.lifetime();
    expect(lifetime.totals.kills).toBe(4);
    expect(lifetime.totals.bossKills).toBe(1);
    expect(lifetime.totals.defeatedBossMonsterIds).toEqual([]);
    expect(lifetime.totals.restsCompleted).toBe(0);
    expect(repository!.records()[0]?.metrics.defeatedBossMonsterIds).toEqual([]);

    // Applying a fresh delta on top of the migrated totals must also succeed and merge additively
    // — this is exactly the `mergedSortedUnion(undefined, ...)` regression the issue names.
    expect(() =>
      repository!.applyDeltas({
        recordId: 'record.new',
        newlyConqueredChampionRecordIds: [],
        achievementGrants: [],
        discoveryProtectionUpdates: [],
        metrics: metrics({ kills: 3, defeatedBossMonsterIds: ['monster.boss.new'] }),
      }),
    ).not.toThrow();
    expect(repository!.lifetime().totals.kills).toBe(7);
    expect(repository!.lifetime().totals.defeatedBossMonsterIds).toEqual(['monster.boss.new']);
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

describe('session run record repository artifact ledger', () => {
  it('starts with an empty ledger', () => {
    expect(createSessionRunRecordRepository(fakeStorage()).artifactLedger()).toEqual([]);
  });

  it('persists the ledger and the applied ids across a reconstruction', () => {
    const storage = fakeStorage();
    const first = createSessionRunRecordRepository(storage);
    const record = storedRecord();
    first.appendRecord(record);
    first.applyArtifactDeltas(lostToDeltas(record.recordId, record.heroName));

    const persisted = JSON.parse(storage.peek(RECORDS_KEY) ?? '{}') as Record<string, unknown>;
    expect(persisted['version']).toBe(4);
    expect(persisted['appliedArtifactRecordIds']).toEqual([record.recordId]);

    const reopened = createSessionRunRecordRepository(storage);
    expect(reopened.artifactLedger()).toEqual(first.artifactLedger());

    // Idempotence survives the reload: the same deltas must not double-append provenance.
    reopened.applyArtifactDeltas(lostToDeltas(record.recordId, record.heroName));
    expect(reopened.artifactLedger()[0]?.provenance).toHaveLength(1);
  });

  it('reconciles on appendRecord: an evicted holder releases the artifact back to the deep', () => {
    const repository = createSessionRunRecordRepository(fakeStorage());
    const holder = storedRecord();
    repository.appendRecord(holder);
    repository.applyArtifactDeltas(lostToDeltas(holder.recordId, holder.heroName));
    expect(repository.artifactLedger()[0]?.status).toBe('lost');

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

  it('migrates a version-1 blob by defaulting the ledger keys', () => {
    const storage = fakeStorage();
    storage.set(
      RECORDS_KEY,
      JSON.stringify({
        version: 1,
        records: [],
        heart: null,
        lifetime: {
          conqueredChampionRecordIds: [],
          grantedAchievementIds: [],
          discoveryProtection: [],
          totals: metrics(),
        },
        appliedDeltaRecordIds: [],
        // no artifactLedger / appliedArtifactRecordIds
      }),
    );

    const repository = createSessionRunRecordRepository(storage);
    expect(repository.artifactLedger()).toEqual([]);

    repository.recordHeart({
      heroName: 'Ada',
      classTags: ['fighter'],
      hallRecordId: 'record.aaaaaaaa00000000.aaaaaaaaaaaaaaaa',
      enrichment: { achievedAt: 'Run #1', portraitGlyph: '@' },
    });
    const persisted = JSON.parse(storage.peek(RECORDS_KEY) ?? '{}') as Record<string, unknown>;
    expect(persisted['version']).toBe(4);
    expect(persisted['artifactLedger']).toEqual([]);
    expect(persisted['appliedArtifactRecordIds']).toEqual([]);
  });

  it('migrates a version-2 blob (pre-curse) by defaulting every recorded heirloom curse to null and round-trips', () => {
    // A genuine version-2 blob predates `RecordedHeirloomSnapshot.curse` entirely: no `curse` key
    // on the record's heirloom, not merely `curse: null`.
    const preCurseHeirloom = { ...storedRecord().heirloom } as Record<string, unknown>;
    delete preCurseHeirloom['curse'];
    const preCurseRecord = { ...storedRecord(), heirloom: preCurseHeirloom };

    const v2Blob = {
      version: 2,
      records: [preCurseRecord],
      heart: null,
      lifetime: {
        conqueredChampionRecordIds: [],
        grantedAchievementIds: [],
        discoveryProtection: [],
        totals: metrics(),
      },
      appliedDeltaRecordIds: [],
      artifactLedger: [],
      appliedArtifactRecordIds: [],
    };

    const storage = fakeStorage();
    storage.set(RECORDS_KEY, JSON.stringify(v2Blob));

    const repository = createSessionRunRecordRepository(storage);
    expect(repository.records()[0]?.heirloom.curse).toBeNull();

    // Persisting after load must round-trip the migrated blob at the current version.
    repository.recordHeart({
      heroName: 'Ada',
      classTags: ['fighter'],
      hallRecordId: 'record.aaaaaaaa00000000.aaaaaaaaaaaaaaaa',
      enrichment: { achievedAt: 'Run #1', portraitGlyph: '@' },
    });
    const persisted = JSON.parse(storage.peek(RECORDS_KEY) ?? '{}') as Record<string, unknown>;
    expect(persisted['version']).toBe(4);
    const persistedRecords = persisted['records'] as readonly Record<string, unknown>[];
    const persistedHeirloom = persistedRecords[0]?.['heirloom'] as Record<string, unknown>;
    expect(persistedHeirloom['curse']).toBeNull();

    const reloaded = createSessionRunRecordRepository(storage);
    expect(reloaded.records()[0]?.heirloom.curse).toBeNull();
  });

  it('migrates a version-3 hall blob by defaulting deathInventory to the heirloom', () => {
    // A genuine version-3 blob predates the equipped-set capture entirely: no `deathInventory` key
    // on the record at all, not merely an empty array.
    const legacyRecord = { ...storedRecord() } as Record<string, unknown>;
    delete legacyRecord['deathInventory'];

    const v3Blob = {
      version: 3,
      records: [legacyRecord],
      heart: null,
      lifetime: {
        conqueredChampionRecordIds: [],
        grantedAchievementIds: [],
        discoveryProtection: [],
        totals: metrics(),
      },
      appliedDeltaRecordIds: [],
      artifactLedger: [],
      appliedArtifactRecordIds: [],
    };

    const storage = fakeStorage();
    storage.set(RECORDS_KEY, JSON.stringify(v3Blob));

    const repository = createSessionRunRecordRepository(storage);
    for (const record of repository.records()) {
      expect(record.deathInventory).toEqual([record.heirloom]);
    }

    repository.recordHeart({
      heroName: 'Ada',
      classTags: ['fighter'],
      hallRecordId: 'record.aaaaaaaa00000000.aaaaaaaaaaaaaaaa',
      enrichment: { achievedAt: 'Run #1', portraitGlyph: '@' },
    });
    const persisted = JSON.parse(storage.peek(RECORDS_KEY) ?? '{}') as Record<string, unknown>;
    expect(persisted['version']).toBe(4);
    const persistedRecords = persisted['records'] as readonly Record<string, unknown>[];
    expect(persistedRecords[0]?.['deathInventory']).toEqual([persistedRecords[0]?.['heirloom']]);
  });

  it('writes back at version 4', () => {
    const storage = fakeStorage();
    const repository = createSessionRunRecordRepository(storage);
    repository.appendRecord(storedRecord());
    const persisted = JSON.parse(storage.peek(RECORDS_KEY) ?? '{}') as Record<string, unknown>;
    expect(persisted['version']).toBe(4);
  });

  it('rejects a blob whose artifact ledger keys have the wrong shape', () => {
    const storage = fakeStorage();
    storage.set(
      RECORDS_KEY,
      JSON.stringify({
        version: 2,
        records: [],
        heart: null,
        lifetime: {
          conqueredChampionRecordIds: [],
          grantedAchievementIds: [],
          discoveryProtection: [],
          totals: metrics(),
        },
        appliedDeltaRecordIds: [],
        artifactLedger: 'not an array',
        appliedArtifactRecordIds: [],
      }),
    );

    expect(() => createSessionRunRecordRepository(storage)).toThrow(SessionHallCorruptError);
  });

  it('rejects a blob whose applied artifact ids have the wrong shape', () => {
    const storage = fakeStorage();
    storage.set(
      RECORDS_KEY,
      JSON.stringify({
        version: 2,
        records: [],
        heart: null,
        lifetime: {
          conqueredChampionRecordIds: [],
          grantedAchievementIds: [],
          discoveryProtection: [],
          totals: metrics(),
        },
        appliedDeltaRecordIds: [],
        artifactLedger: [],
        appliedArtifactRecordIds: 'not an array',
      }),
    );

    expect(() => createSessionRunRecordRepository(storage)).toThrow(SessionHallCorruptError);
  });
});
