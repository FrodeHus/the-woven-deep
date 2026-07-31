import { describe, expect, it } from 'vitest';
import {
  applyArtifactDeltas,
  emptyArtifactLedger,
  reconcileArtifactLedger,
  undiscoveredArtifactIds,
  type ArtifactDeltas,
  type ArtifactLedger,
  type ArtifactStint,
} from '../src/index.js';
import type { FallenHeroStandingSnapshot } from '../src/population-model.js';
import { emptyLifetimeState, type LifetimeState } from '../src/run-records-model.js';

const ARTIFACT_A = 'artifact.aaaaaaaa00000000.aaaaaaaaaaaaaaaa';
const ARTIFACT_B = 'artifact.bbbbbbbb00000000.bbbbbbbbbbbbbbbb';
const ARTIFACT_C = 'artifact.cccccccc00000000.cccccccccccccccc';

const RECORD_1 = 'record.11111111.1111111111111111';
const RECORD_2 = 'record.22222222.2222222222222222';
const RECORD_3 = 'record.33333333.3333333333333333';

function stint(overrides: Partial<ArtifactStint> = {}): ArtifactStint {
  return {
    heroName: 'Ada',
    recordId: RECORD_1,
    outcome: 'died-with',
    depth: 3,
    ...overrides,
  };
}

function deltas(recordId: string, entries: ArtifactDeltas['stints']): ArtifactDeltas {
  return { recordId, stints: entries };
}

function standing(hallRecordId: string, rank = 1): FallenHeroStandingSnapshot {
  return {
    rank,
    hallRecordId,
    heroName: 'Standing Hero',
    portraitGlyph: '@',
    classTags: ['fighter'],
    attributes: { might: 10, agility: 10, vitality: 10, wits: 10, resolve: 10 },
    equippedItemContentIds: [],
    signatureAbilityIds: [],
    deathDepth: 1,
    sourceContentHash: 'a'.repeat(64),
    heirloom: {
      contentId: 'item.iron-sword',
      sourceItemId: null,
      enchantment: null,
      condition: 100,
      charges: null,
      fuel: null,
      qualityRank: 1,
      displayName: 'Sword',
      glyph: ')',
      color: '#fff',
      originatingHallRecordId: hallRecordId,
    },
  };
}

function assertSingleton(ledger: ArtifactLedger): void {
  for (const entry of ledger) {
    if (entry.status === 'lost') {
      expect(entry.holderRecordId).not.toBeNull();
    } else {
      expect(entry.holderRecordId).toBeNull();
    }
  }
}

describe('emptyArtifactLedger', () => {
  it('returns an empty array', () => {
    expect(emptyArtifactLedger()).toEqual([]);
  });
});

describe('applyArtifactDeltas', () => {
  it('creates entries for unknown artifact ids', () => {
    const ledger = applyArtifactDeltas(
      emptyArtifactLedger(),
      deltas(RECORD_1, [
        {
          artifactId: ARTIFACT_A,
          stint: stint({ recordId: RECORD_1 }),
          newStatus: 'lost',
          holderRecordId: RECORD_1,
        },
      ]),
    );

    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toEqual({
      artifactId: ARTIFACT_A,
      status: 'lost',
      holderRecordId: RECORD_1,
      provenance: [stint({ recordId: RECORD_1 })],
    });
  });

  it('is deterministic and shape-preserving when applying the same recordId twice (pure function; repo enforces idempotence)', () => {
    const initial = emptyArtifactLedger();
    const delta = deltas(RECORD_1, [
      {
        artifactId: ARTIFACT_A,
        stint: stint({ recordId: RECORD_1 }),
        newStatus: 'lost',
        holderRecordId: RECORD_1,
      },
    ]);

    const once = applyArtifactDeltas(initial, delta);
    const twice = applyArtifactDeltas(once, delta);

    // applyArtifactDeltas itself is pure and reapplies deterministically (repo layer, Task 4,
    // is responsible for not calling it twice for the same recordId).
    expect(twice[0].provenance).toHaveLength(2);
    expect(twice[0].status).toBe('lost');
    expect(twice[0].holderRecordId).toBe(RECORD_1);
  });

  it('produces sorted output by artifactId', () => {
    const ledger = applyArtifactDeltas(
      emptyArtifactLedger(),
      deltas(RECORD_1, [
        {
          artifactId: ARTIFACT_C,
          stint: stint({ recordId: RECORD_1 }),
          newStatus: 'lost',
          holderRecordId: RECORD_1,
        },
        {
          artifactId: ARTIFACT_A,
          stint: stint({ recordId: RECORD_1 }),
          newStatus: 'lost',
          holderRecordId: RECORD_1,
        },
      ]),
    );

    expect(ledger.map((entry) => entry.artifactId)).toEqual([ARTIFACT_A, ARTIFACT_C]);
  });

  it('updates status and holder for an existing entry and appends provenance', () => {
    const withA = applyArtifactDeltas(
      emptyArtifactLedger(),
      deltas(RECORD_1, [
        {
          artifactId: ARTIFACT_A,
          stint: stint({ recordId: RECORD_1, outcome: 'recovered' }),
          newStatus: 'undiscovered',
          holderRecordId: null,
        },
      ]),
    );

    const withB = applyArtifactDeltas(
      withA,
      deltas(RECORD_2, [
        {
          artifactId: ARTIFACT_A,
          stint: stint({ recordId: RECORD_2, heroName: 'Bryn', outcome: 'died-with' }),
          newStatus: 'lost',
          holderRecordId: RECORD_2,
        },
      ]),
    );

    expect(withB).toHaveLength(1);
    expect(withB[0].status).toBe('lost');
    expect(withB[0].holderRecordId).toBe(RECORD_2);
    expect(withB[0].provenance).toHaveLength(2);
    assertSingleton(withB);
  });
});

describe('reconcileArtifactLedger', () => {
  it('flips a lost entry whose holder is standings-evicted to undiscovered with a reclaimed stint', () => {
    const ledger = applyArtifactDeltas(
      emptyArtifactLedger(),
      deltas(RECORD_1, [
        {
          artifactId: ARTIFACT_A,
          stint: stint({ recordId: RECORD_1, heroName: 'Ada', outcome: 'died-with', depth: 5 }),
          newStatus: 'lost',
          holderRecordId: RECORD_1,
        },
      ]),
    );

    const reconciled = reconcileArtifactLedger({
      ledger,
      standings: [standing(RECORD_2)], // RECORD_1 no longer among standings
      lifetime: emptyLifetimeState(),
    });

    expect(reconciled[0].status).toBe('undiscovered');
    expect(reconciled[0].holderRecordId).toBeNull();
    const lastStint = reconciled[0].provenance[reconciled[0].provenance.length - 1];
    expect(lastStint).toEqual({
      heroName: 'Ada',
      recordId: RECORD_1,
      outcome: 'reclaimed-by-the-deep',
      depth: 0,
    });
    assertSingleton(reconciled);
  });

  it('flips a lost entry whose holder is conquered even if still in standings', () => {
    const ledger = applyArtifactDeltas(
      emptyArtifactLedger(),
      deltas(RECORD_1, [
        {
          artifactId: ARTIFACT_A,
          stint: stint({ recordId: RECORD_1, heroName: 'Ada' }),
          newStatus: 'lost',
          holderRecordId: RECORD_1,
        },
      ]),
    );

    const lifetime: LifetimeState = {
      ...emptyLifetimeState(),
      conqueredChampionRecordIds: [RECORD_1],
    };

    const reconciled = reconcileArtifactLedger({
      ledger,
      standings: [standing(RECORD_1)], // still present in standings, but conquered
      lifetime,
    });

    expect(reconciled[0].status).toBe('undiscovered');
    expect(reconciled[0].holderRecordId).toBeNull();
    assertSingleton(reconciled);
  });

  it('leaves entries whose holder is still a live, unconquered standing untouched', () => {
    const ledger = applyArtifactDeltas(
      emptyArtifactLedger(),
      deltas(RECORD_1, [
        {
          artifactId: ARTIFACT_A,
          stint: stint({ recordId: RECORD_1 }),
          newStatus: 'lost',
          holderRecordId: RECORD_1,
        },
      ]),
    );

    const reconciled = reconcileArtifactLedger({
      ledger,
      standings: [standing(RECORD_1)],
      lifetime: emptyLifetimeState(),
    });

    expect(reconciled).toEqual(ledger);
  });

  it('is idempotent: reconciling twice equals reconciling once', () => {
    const ledger = applyArtifactDeltas(
      emptyArtifactLedger(),
      deltas(RECORD_1, [
        {
          artifactId: ARTIFACT_A,
          stint: stint({ recordId: RECORD_1 }),
          newStatus: 'lost',
          holderRecordId: RECORD_1,
        },
      ]),
    );

    const once = reconcileArtifactLedger({
      ledger,
      standings: [],
      lifetime: emptyLifetimeState(),
    });
    const twice = reconcileArtifactLedger({
      ledger: once,
      standings: [],
      lifetime: emptyLifetimeState(),
    });

    expect(twice).toEqual(once);
  });

  it('documents the delta-before-reconcile ordering: a conquered-and-recovered artifact never matches', () => {
    // Task 4's contract: on a conquest-with-pickup finalize, the deltas for the recovering run
    // (a new died-with/escaped-with stint under the NEW recordId) are applied to the ledger
    // BEFORE reconcile ever runs. So by the time reconcile inspects the entry, its holder is the
    // new recordId, not the stale conquered one -- reconcile must not flip it.
    const afterOriginalPickup = applyArtifactDeltas(
      emptyArtifactLedger(),
      deltas(RECORD_1, [
        {
          artifactId: ARTIFACT_A,
          stint: stint({ recordId: RECORD_1, heroName: 'Ada', outcome: 'died-with' }),
          newStatus: 'lost',
          holderRecordId: RECORD_1,
        },
      ]),
    );

    // RECORD_1's champion gets conquered by RECORD_3, who recovers the artifact: the delta from
    // RECORD_3's finalize is applied first (per Task 4 contract), giving the artifact a new holder.
    const afterRecoveringPickup = applyArtifactDeltas(
      afterOriginalPickup,
      deltas(RECORD_3, [
        {
          artifactId: ARTIFACT_A,
          stint: stint({ recordId: RECORD_3, heroName: 'Cato', outcome: 'died-with' }),
          newStatus: 'lost',
          holderRecordId: RECORD_3,
        },
      ]),
    );

    const lifetime: LifetimeState = {
      ...emptyLifetimeState(),
      conqueredChampionRecordIds: [RECORD_1],
    };

    const reconciled = reconcileArtifactLedger({
      ledger: afterRecoveringPickup,
      standings: [standing(RECORD_3)],
      lifetime,
    });

    // The stale conquered holder (RECORD_1) is gone from the entry -- the delta-first ordering
    // means reconcile never sees it, so the artifact stays with RECORD_3.
    expect(reconciled[0].status).toBe('lost');
    expect(reconciled[0].holderRecordId).toBe(RECORD_3);
    assertSingleton(reconciled);
  });

  it('singleton property holds across a scripted apply+reconcile scenario', () => {
    let ledger = emptyArtifactLedger();

    ledger = applyArtifactDeltas(
      ledger,
      deltas(RECORD_1, [
        {
          artifactId: ARTIFACT_A,
          stint: stint({ recordId: RECORD_1, heroName: 'Ada' }),
          newStatus: 'lost',
          holderRecordId: RECORD_1,
        },
        {
          artifactId: ARTIFACT_B,
          stint: stint({ recordId: RECORD_1, heroName: 'Ada', outcome: 'escaped-with' }),
          newStatus: 'lost',
          holderRecordId: RECORD_1,
        },
      ]),
    );
    assertSingleton(ledger);

    ledger = reconcileArtifactLedger({
      ledger,
      standings: [standing(RECORD_1)],
      lifetime: emptyLifetimeState(),
    });
    assertSingleton(ledger);

    ledger = applyArtifactDeltas(
      ledger,
      deltas(RECORD_2, [
        {
          artifactId: ARTIFACT_A,
          stint: stint({ recordId: RECORD_2, heroName: 'Bryn', outcome: 'recovered' }),
          newStatus: 'undiscovered',
          holderRecordId: null,
        },
      ]),
    );
    assertSingleton(ledger);

    ledger = reconcileArtifactLedger({
      ledger,
      standings: [],
      lifetime: emptyLifetimeState(),
    });
    assertSingleton(ledger);

    ledger = reconcileArtifactLedger({
      ledger,
      standings: [],
      lifetime: emptyLifetimeState(),
    });
    assertSingleton(ledger);

    expect(ledger.map((entry) => entry.artifactId)).toEqual([ARTIFACT_A, ARTIFACT_B]);
  });
});

describe('undiscoveredArtifactIds', () => {
  it('merges absent ids and explicitly undiscovered entries, sorted', () => {
    const ledger = applyArtifactDeltas(
      emptyArtifactLedger(),
      deltas(RECORD_1, [
        {
          artifactId: ARTIFACT_B,
          stint: stint({ recordId: RECORD_1 }),
          newStatus: 'lost',
          holderRecordId: RECORD_1,
        },
        {
          artifactId: ARTIFACT_C,
          stint: stint({ recordId: RECORD_1, outcome: 'recovered' }),
          newStatus: 'undiscovered',
          holderRecordId: null,
        },
      ]),
    );

    const all = new Set([ARTIFACT_A, ARTIFACT_B, ARTIFACT_C]);
    const result = undiscoveredArtifactIds(ledger, all);

    // ARTIFACT_A is absent from the ledger entirely, ARTIFACT_C is explicitly undiscovered,
    // ARTIFACT_B is lost and must be excluded.
    expect(result).toEqual([ARTIFACT_A, ARTIFACT_C]);
  });

  it('returns an empty array when every artifact is lost', () => {
    const ledger = applyArtifactDeltas(
      emptyArtifactLedger(),
      deltas(RECORD_1, [
        {
          artifactId: ARTIFACT_A,
          stint: stint({ recordId: RECORD_1 }),
          newStatus: 'lost',
          holderRecordId: RECORD_1,
        },
      ]),
    );

    expect(undiscoveredArtifactIds(ledger, new Set([ARTIFACT_A]))).toEqual([]);
  });
});
