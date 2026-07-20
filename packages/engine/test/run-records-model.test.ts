import { describe, expect, it } from 'vitest';
import {
  assertOpaqueId,
  deriveHallRecordId,
  emptyRunMetrics,
  encodeRunSeed,
  type HallRecord,
  type HallRecordEnrichment,
  type HeartLineageRecord,
  type LifetimeDeltas,
  type LifetimeState,
  type StoredHallRecord,
  type Uint32State,
} from '../src/index.js';

const seed: Uint32State = [1, 2, 3, 4];
const hash = 'a'.repeat(64);

describe('deriveHallRecordId', () => {
  it('derives the documented record ID from the run seed and content hash', () => {
    expect(deriveHallRecordId([1, 2, 3, 4], 'a'.repeat(64))).toBe(
      `record.00000001000000020000000300000004.${'a'.repeat(16)}`,
    );
  });

  it('is deterministic and matches the opaque-identifier grammar', () => {
    const first = deriveHallRecordId(seed, hash);
    const second = deriveHallRecordId(seed, hash);
    expect(first).toBe(second);
    expect(() => assertOpaqueId(first, 'hall record ID')).not.toThrow();
  });

  it('differs for a different seed or content hash', () => {
    const base = deriveHallRecordId(seed, hash);
    expect(deriveHallRecordId([1, 2, 3, 5], hash)).not.toBe(base);
    expect(deriveHallRecordId(seed, 'b'.repeat(64))).not.toBe(base);
  });
});

describe('encodeRunSeed', () => {
  it('concatenates each word as eight zero-padded lowercase hex digits', () => {
    expect(encodeRunSeed([0xdead_beef, 0, 1, 0xffff_ffff])).toBe(
      'deadbeef0000000000000001ffffffff',
    );
    expect(encodeRunSeed(seed)).toBe('00000001000000020000000300000004');
    expect(encodeRunSeed(seed)).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('run record shapes', () => {
  const enrichment: HallRecordEnrichment = { achievedAt: '2026-07-15', portraitGlyph: '@' };

  it('closes the enrichment vocabulary to the achieved-at date and portrait glyph', () => {
    expect(Object.keys(enrichment).sort()).toEqual(['achievedAt', 'portraitGlyph']);
    // @ts-expect-error the enrichment vocabulary is closed; a third field is rejected
    const widened: HallRecordEnrichment = {
      achievedAt: '2026-07-15',
      portraitGlyph: '@',
      theme: 'dark',
    };
    expect(widened.achievedAt).toBe('2026-07-15');
  });

  it('combines engine-validated lineage identity with the closed enrichment', () => {
    const lineage: HeartLineageRecord = {
      heroName: 'Ada',
      classTags: ['fighter'],
      hallRecordId: deriveHallRecordId(seed, hash),
      enrichment,
    };
    expect(Object.keys(lineage).sort()).toEqual([
      'classTags',
      'enrichment',
      'hallRecordId',
      'heroName',
    ]);
    const rejected: HeartLineageRecord = {
      heroName: 'Ada',
      classTags: ['fighter'],
      hallRecordId: deriveHallRecordId(seed, hash),
      // @ts-expect-error lineage enrichment stays closed to the two host-supplied display fields
      enrichment: { achievedAt: '2026-07-15', portraitGlyph: '@', title: 'the Bold' },
    };
    expect(rejected.heroName).toBe('Ada');
  });

  it('stores hall records as the engine record plus host enrichment', () => {
    const record: HallRecord = {
      recordId: deriveHallRecordId(seed, hash),
      heroName: 'Ada',
      classTags: ['fighter'],
      completionType: 'died',
      cause: { killerContentId: null, depth: 3, turn: 120, worldTime: 12_000 },
      deepestDepth: 3,
      score: { lines: [], total: 0 },
      metrics: emptyRunMetrics(),
      reputations: [{ factionId: 'faction.lampwrights', value: 5 }],
      heirloom: {
        contentId: 'item.fallback',
        sourceItemId: null,
        enchantment: null,
        condition: 100,
        charges: null,
        fuel: null,
        qualityRank: 0,
        displayName: 'Fallback relic',
        glyph: ')',
        color: '#c0c0c0',
        originatingHallRecordId: deriveHallRecordId(seed, hash),
      },
      build: {
        attributes: { might: 10, agility: 10, vitality: 10, wits: 10, resolve: 10 },
        equippedItemContentIds: ['item.sword'],
        signatureAbilityIds: [],
      },
      runSeed: encodeRunSeed(seed),
      contentHash: hash,
    };
    const stored: StoredHallRecord = { ...record, enrichment };
    expect(stored.enrichment).toEqual(enrichment);
    expect(stored.recordId).toBe(record.recordId);
  });

  it('shapes lifetime state and deltas around the record idempotence key', () => {
    const lifetime: LifetimeState = {
      conqueredChampionRecordIds: [],
      grantedAchievementIds: [],
      discoveryProtection: [],
      totals: emptyRunMetrics(),
    };
    const deltas: LifetimeDeltas = {
      recordId: deriveHallRecordId(seed, hash),
      newlyConqueredChampionRecordIds: [],
      achievementGrants: [
        {
          achievementId: 'achievement.first-champion',
          criteriaId: 'first-champion-defeat',
          name: 'First champion',
        },
      ],
      discoveryProtectionUpdates: [
        {
          encounterId: 'encounter.rats',
          previousBonus: 0,
          nextBonus: 0.05,
          outcome: 'reached-unseen',
        },
      ],
      metrics: emptyRunMetrics(),
    };
    expect(lifetime.totals.kills).toBe(0);
    expect(deltas.recordId).toBe(deriveHallRecordId(seed, hash));
  });
});
