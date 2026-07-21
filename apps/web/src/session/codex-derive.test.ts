import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import type { StoredHallRecord } from '@woven-deep/engine';
import { emptyRunMetrics } from '@woven-deep/engine';
import { deriveCodexState } from './codex-derive.js';
import type { Sightings } from './codex-storage.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../../content'),
  });
});

const EMPTY_SIGHTINGS: Sightings = { monsterIds: [], itemIds: [], landmarks: [] };

function record(overrides: Partial<StoredHallRecord> = {}): StoredHallRecord {
  return {
    recordId: 'record.aaaaaaaa00000000.aaaaaaaaaaaaaaaa',
    heroName: 'Ada',
    classTags: ['wayfarer'],
    completionType: 'died',
    cause: { killerContentId: 'monster.cave-rat', depth: 3, turn: 12, worldTime: 12 },
    deepestDepth: 3,
    score: { lines: [], total: 40 },
    metrics: emptyRunMetrics(),
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
    enrichment: { achievedAt: 'Run #1', portraitGlyph: '@' },
    ...overrides,
  };
}

function loreCategory(
  records: readonly StoredHallRecord[],
  sightings: Sightings = EMPTY_SIGHTINGS,
) {
  const state = deriveCodexState({ records, snapshot: null, sightings, pack });
  return state.categories.find((category) => category.kind === 'lore')!;
}

describe('deriveCodexState — lore category', () => {
  it('includes a discovered lore-bearing monster and item, with their lore text resolved', () => {
    const category = loreCategory([record()]);
    const names = category.entries.map((entry) => (entry.discovered ? entry.name : '???'));
    expect(names).toContain('Cave rat');
    expect(names).toContain('Iron sword');

    const rat = category.entries.find((entry) => entry.discovered && entry.name === 'Cave rat');
    expect(rat).toBeDefined();
    expect(rat && rat.discovered && rat.lore).toMatch(/dark taught it everything/);
  });

  it('excludes an undiscovered lore-bearing monster (training beetle) even though its content has lore', () => {
    const category = loreCategory([record()]);
    const html = JSON.stringify(category);
    expect(html).not.toContain('monster.training-beetle');
    expect(html).not.toContain('Training beetle');
  });

  it('excludes a discovered lore-less item (wooden arrows) from the lore category, though it is discovered', () => {
    const sightings: Sightings = { ...EMPTY_SIGHTINGS, itemIds: ['item.wooden-arrows'] };
    const category = loreCategory([record()], sightings);
    const names = category.entries.map((entry) => (entry.discovered ? entry.name : '???'));
    expect(names).not.toContain('Wooden arrows');
  });

  it('gives every discovered lore-bearing entry a non-null lore string and every other category entry null lore', () => {
    const state = deriveCodexState({
      records: [record()],
      snapshot: null,
      sightings: EMPTY_SIGHTINGS,
      pack,
    });
    const lore = state.categories.find((category) => category.kind === 'lore')!;
    for (const entry of lore.entries) {
      expect(entry.discovered).toBe(true);
      if (entry.discovered) expect(entry.lore).not.toBeNull();
    }
  });
});
