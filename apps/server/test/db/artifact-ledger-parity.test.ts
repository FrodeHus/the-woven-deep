import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  createInMemoryRunRecordRepository,
  emptyRunMetrics,
  type ArtifactDeltas,
  type ArtifactLedger,
  type RunRecordRepository,
  type StoredHallRecord,
} from '@woven-deep/engine';
import { runMigrations } from '../../src/database.js';
import { ProfileRepository } from '../../src/db/profile-repository.js';
import { ServerRunRecordRepository } from '../../src/db/hall-repository.js';
// The guest repository lives in the web client; importing it here (test-only, never from
// `apps/server/src`) is what makes this a genuine cross-implementation parity check rather
// than three separately-asserted expectations that could drift apart.
import { createSessionRunRecordRepository } from '../../../web/src/session/run-records-storage.js';
import type { SessionStorageLike } from '../../../web/src/session/storage.js';

const ARTIFACT_ID = 'artifact.sundered-crown';

function record(recordId: string, heroName: string, total: number): StoredHallRecord {
  return {
    recordId,
    heroName,
    classTags: ['fighter'],
    completionType: 'died',
    cause: { killerContentId: 'monster.cave-rat', depth: 3, turn: 12, worldTime: 12 },
    deepestDepth: 3,
    score: { lines: [], total },
    metrics: { ...emptyRunMetrics(), deepestDepth: 3 },
    reputations: [],
    heirloom: null,
    build: {
      attributes: { might: 14, agility: 12, vitality: 16, wits: 10, resolve: 12 },
      equippedItemContentIds: ['item.iron-sword'],
      signatureAbilityIds: [],
    },
    runSeed: 'aaaaaaaa00000000',
    contentHash: 'b'.repeat(64),
    enrichment: { achievedAt: '2026-07-31T00:00:00.000Z', portraitGlyph: '@' },
  };
}

/**
 * find → die-with → recover → evict → re-lose → conquer, scripted once and replayed against every
 * `RunRecordRepository` implementation. The ordering matters: Bram is still standing when Cleo
 * recovers the artifact from him, so Bram never earns a `reclaimed-by-the-deep` stint — only
 * Cleo does, once the ten rivals push her out of the Hall.
 *
 * The closing conquest step exercises the *other* release branch: Dain outranks every rival and
 * stays in the standings throughout, so only `lifetime.conqueredChampionRecordIds` can release
 * his artifact. Lifetime deltas are applied before the artifact batch that reconciles, matching
 * the ordering hosts must use.
 */
function runScenario(repository: RunRecordRepository): ArtifactLedger {
  const ada = record('record.ada', 'Ada', 40);
  const bram = record('record.bram', 'Bram', 60);
  const cleo = record('record.cleo', 'Cleo', 80);

  const found: ArtifactDeltas = {
    recordId: ada.recordId,
    stints: [
      {
        artifactId: ARTIFACT_ID,
        stint: { heroName: 'Ada', recordId: ada.recordId, outcome: 'escaped-with', depth: 4 },
        newStatus: 'undiscovered',
        holderRecordId: null,
      },
    ],
  };
  const diedWith: ArtifactDeltas = {
    recordId: bram.recordId,
    stints: [
      {
        artifactId: ARTIFACT_ID,
        stint: { heroName: 'Bram', recordId: bram.recordId, outcome: 'died-with', depth: 6 },
        newStatus: 'lost',
        holderRecordId: bram.recordId,
      },
    ],
  };
  const recovered: ArtifactDeltas = {
    recordId: cleo.recordId,
    stints: [
      {
        artifactId: ARTIFACT_ID,
        stint: { heroName: 'Cleo', recordId: cleo.recordId, outcome: 'recovered', depth: 7 },
        newStatus: 'lost',
        holderRecordId: cleo.recordId,
      },
    ],
  };

  repository.appendRecord(ada);
  repository.applyArtifactDeltas(found);
  repository.appendRecord(bram);
  repository.applyArtifactDeltas(diedWith);
  repository.appendRecord(cleo);
  repository.applyArtifactDeltas(recovered);

  // A re-applied delta must never double-count, whichever implementation is running.
  repository.applyArtifactDeltas(recovered);

  for (let index = 0; index < 10; index += 1) {
    repository.appendRecord(record(`record.rival${index}`, `Rival ${index}`, 500 + index));
  }

  // Dain re-finds it and dies with it. He tops the Hall and stays there, so the eviction branch
  // can never release this stint — only conquering his champion record can.
  const dain = record('record.dain', 'Dain', 900);
  repository.appendRecord(dain);
  repository.applyArtifactDeltas({
    recordId: dain.recordId,
    stints: [
      {
        artifactId: ARTIFACT_ID,
        stint: { heroName: 'Dain', recordId: dain.recordId, outcome: 'died-with', depth: 9 },
        newStatus: 'lost',
        holderRecordId: dain.recordId,
      },
    ],
  });

  const conqueror = record('record.conqueror', 'Enid', 100);
  repository.applyDeltas({
    recordId: conqueror.recordId,
    newlyConqueredChampionRecordIds: [dain.recordId],
    achievementGrants: [],
    discoveryProtectionUpdates: [],
    metrics: emptyRunMetrics(),
  });
  repository.appendRecord(conqueror);

  return repository.artifactLedger();
}

const expectedLedger: ArtifactLedger = [
  {
    artifactId: ARTIFACT_ID,
    status: 'undiscovered',
    holderRecordId: null,
    provenance: [
      { heroName: 'Ada', recordId: 'record.ada', outcome: 'escaped-with', depth: 4 },
      { heroName: 'Bram', recordId: 'record.bram', outcome: 'died-with', depth: 6 },
      { heroName: 'Cleo', recordId: 'record.cleo', outcome: 'recovered', depth: 7 },
      { heroName: 'Cleo', recordId: 'record.cleo', outcome: 'reclaimed-by-the-deep', depth: 0 },
      { heroName: 'Dain', recordId: 'record.dain', outcome: 'died-with', depth: 9 },
      { heroName: 'Dain', recordId: 'record.dain', outcome: 'reclaimed-by-the-deep', depth: 0 },
    ],
  },
];

function fakeStorage(): SessionStorageLike {
  const values = new Map<string, string>();
  return {
    get: (key: string) => values.get(key) ?? null,
    set: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

function serverRepository(): ServerRunRecordRepository {
  const database = new Database(':memory:');
  runMigrations(database);
  new ProfileRepository(database).create({
    id: 'p1',
    normalizedEmail: 'a@example.com',
    nowIso: '2026-07-31T00:00:00.000Z',
  });
  return new ServerRunRecordRepository({ database, profileId: 'p1' });
}

describe('artifact ledger parity across every RunRecordRepository', () => {
  it('in-memory produces the scripted ledger', () => {
    expect(runScenario(createInMemoryRunRecordRepository())).toEqual(expectedLedger);
  });

  it('guest (session storage) produces the same ledger', () => {
    expect(runScenario(createSessionRunRecordRepository(fakeStorage()))).toEqual(expectedLedger);
  });

  it('server (sqlite) produces the same ledger', () => {
    expect(runScenario(serverRepository())).toEqual(expectedLedger);
  });

  it('all three agree deep-equal', () => {
    const inMemory = runScenario(createInMemoryRunRecordRepository());
    const guest = runScenario(createSessionRunRecordRepository(fakeStorage()));
    const server = runScenario(serverRepository());

    expect(guest).toEqual(inMemory);
    expect(server).toEqual(inMemory);
  });
});
