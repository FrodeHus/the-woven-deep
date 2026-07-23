import type { CompiledContentPack } from '@woven-deep/content';
import {
  emptyRunMetrics,
  type LifetimeState,
  type RunMetrics,
  type StoredHallRecord,
} from '@woven-deep/engine';
import { describe, expect, it } from 'vitest';
import { evaluateUnlocks } from '../src/unlocks.js';

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

function emptyLifetime(overrides: Partial<LifetimeState> = {}): LifetimeState {
  return {
    conqueredChampionRecordIds: [],
    grantedAchievementIds: [],
    discoveryProtection: [],
    totals: emptyRunMetrics(),
    ...overrides,
  };
}

function contentPack(): CompiledContentPack {
  return {
    schemaVersion: 1,
    hash: 'a'.repeat(64),
    entries: [
      {
        kind: 'class',
        id: 'class.warden',
        name: 'Warden',
        tags: ['chargen', 'locked'],
        description: 'A stalwart defender.',
        playable: false,
        silhouetteGlyph: 'W',
        unlockHint: 'Reach depth ten.',
        classTags: ['warden'],
        kits: [],
      },
      {
        kind: 'class',
        id: 'class.archivist',
        name: 'Archivist',
        tags: ['chargen', 'locked'],
        description: 'A keeper of forbidden lore.',
        playable: false,
        silhouetteGlyph: 'A',
        unlockHint: 'Defeat three champions.',
        classTags: ['archivist'],
        kits: [],
      },
      {
        kind: 'class',
        id: 'class.fighter',
        name: 'Fighter',
        tags: ['chargen'],
        description: 'A playable class.',
        playable: true,
        silhouetteGlyph: 'F',
        unlockHint: null,
        classTags: ['fighter'],
        kits: [],
      },
    ],
  } as unknown as CompiledContentPack;
}

describe('evaluateUnlocks', () => {
  it('returns nothing for empty records + empty lifetime', () => {
    expect(
      evaluateUnlocks({ records: [], lifetime: emptyLifetime(), content: contentPack() }),
    ).toEqual([]);
  });

  it('unlocks the warden when a record reaches depth 10', () => {
    const records = [storedRecord({ deepestDepth: 10 })];
    expect(evaluateUnlocks({ records, lifetime: emptyLifetime(), content: contentPack() })).toEqual(
      ['class.warden'],
    );
  });

  it('does not unlock the warden at depth 9', () => {
    const records = [storedRecord({ deepestDepth: 9 })];
    expect(evaluateUnlocks({ records, lifetime: emptyLifetime(), content: contentPack() })).toEqual(
      [],
    );
  });

  it('unlocks the archivist at 3 conquered champions', () => {
    const lifetime = emptyLifetime({
      conqueredChampionRecordIds: ['champion.a', 'champion.b', 'champion.c'],
    });
    expect(evaluateUnlocks({ records: [], lifetime, content: contentPack() })).toEqual([
      'class.archivist',
    ]);
  });

  it('does not unlock the archivist at 2 conquered champions', () => {
    const lifetime = emptyLifetime({
      conqueredChampionRecordIds: ['champion.a', 'champion.b'],
    });
    expect(evaluateUnlocks({ records: [], lifetime, content: contentPack() })).toEqual([]);
  });

  it('unlocks both classes, sorted, when both conditions are met', () => {
    const records = [storedRecord({ deepestDepth: 12 })];
    const lifetime = emptyLifetime({
      conqueredChampionRecordIds: ['champion.a', 'champion.b', 'champion.c'],
    });
    expect(evaluateUnlocks({ records, lifetime, content: contentPack() })).toEqual([
      'class.archivist',
      'class.warden',
    ]);
  });

  it('never returns a class that is already playable in content', () => {
    const pack = contentPack();
    const playableWarden: CompiledContentPack = {
      ...pack,
      entries: pack.entries.map((entry) =>
        entry.kind === 'class' && entry.id === 'class.warden'
          ? { ...entry, playable: true }
          : entry,
      ),
    };
    const records = [storedRecord({ deepestDepth: 15 })];
    expect(
      evaluateUnlocks({ records, lifetime: emptyLifetime(), content: playableWarden }),
    ).toEqual([]);
  });

  it('omits a rule-satisfying class id that does not exist in content', () => {
    const pack = contentPack();
    const withoutWarden: CompiledContentPack = {
      ...pack,
      entries: pack.entries.filter(
        (entry) => !(entry.kind === 'class' && entry.id === 'class.warden'),
      ),
    };
    const records = [storedRecord({ deepestDepth: 15 })];
    expect(evaluateUnlocks({ records, lifetime: emptyLifetime(), content: withoutWarden })).toEqual(
      [],
    );
  });
});
