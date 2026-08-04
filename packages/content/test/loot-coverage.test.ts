import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileContentDirectory } from '../src/compiler/index.js';
import type {
  BalanceContentEntry,
  ContentEntry,
  ItemContentEntry,
  LootTableContentEntry,
} from '../src/model.js';

/**
 * Items that intentionally appear in no loot table because another system places them. Each is
 * named individually rather than matched by tag, so adding an item here is a deliberate act that
 * shows up in review.
 */
const PLACED_ELSEWHERE: Readonly<Record<string, string>> = {
  // Artifact singleton circulation (one instance per world, provenance-tracked).
  'item.bound-signet': 'artifact circulation',
  'item.marias-grace': 'artifact circulation',
  'item.thread-counts-needle': 'artifact circulation',
  'item.last-cartographers-compass': 'artifact circulation',
  'item.champion-fallback-relic': 'artifact circulation',
  // Encounter reward tables under content/encounters/.
  'item.ashfather-cinder': 'encounter reward',
  'item.heart-cinder': 'encounter reward',
  'item.warden-ember': 'encounter reward',
  'item.tide-crown': 'encounter reward',
  'item.herald-sigil': 'encounter reward',
  'item.echo-heartstone': 'encounter reward',
  // Placed by packages/engine/src/final-chamber-fragments.ts.
  'item.tablet-fragment.a': 'final chamber fragments',
  'item.tablet-fragment.b': 'final chamber fragments',
  'item.tablet-fragment.c': 'final chamber fragments',
};

/** The six tables the engine resolves by constructed id, one per kind per depth band. */
const BAND_TABLES = [
  { id: 'loot-table.floor-scatter-shallow', band: 'shallow' },
  { id: 'loot-table.floor-scatter-mid', band: 'mid' },
  { id: 'loot-table.floor-scatter-deep', band: 'deep' },
  { id: 'loot-table.chest-shallow', band: 'shallow' },
  { id: 'loot-table.chest-mid', band: 'mid' },
  { id: 'loot-table.chest-deep', band: 'deep' },
] as const;

async function loadPack() {
  return compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
}

function itemsOf(entries: readonly ContentEntry[]): ItemContentEntry[] {
  return entries.filter((entry): entry is ItemContentEntry => entry.kind === 'item');
}

function tablesOf(entries: readonly ContentEntry[]): LootTableContentEntry[] {
  return entries.filter((entry): entry is LootTableContentEntry => entry.kind === 'loot-table');
}

/**
 * The shallowest depth each band can roll at. Mirrors `representativeDepth` in
 * packages/engine/src/loot-placement.ts so retuning `floorLoot.depthBands` retunes this with it.
 */
function bandFloors(entries: readonly ContentEntry[]): Readonly<Record<string, number>> {
  const balance = entries.find((entry): entry is BalanceContentEntry => entry.kind === 'balance');
  if (balance === undefined) throw new Error('content pack has no balance entry');
  const { shallowMaxDepth, midMaxDepth } = balance.floorLoot.depthBands;
  return { shallow: 1, mid: shallowMaxDepth + 1, deep: midMaxDepth + 1 };
}

describe('loot coverage', () => {
  it('makes every item obtainable somewhere, or names the system that places it', async () => {
    const pack = await loadPack();
    const stocked = new Set(
      tablesOf(pack.entries).flatMap((table) =>
        table.choices
          .filter((choice) => choice.weight > 0 && choice.contentId !== null)
          .map((choice) => choice.contentId as string),
      ),
    );
    const orphans = itemsOf(pack.entries)
      .map((item) => item.id)
      .filter((id) => !stocked.has(id) && PLACED_ELSEWHERE[id] === undefined)
      .sort();
    expect(orphans).toEqual([]);
  });

  it('never offers an item in a band shallower than the item itself allows', async () => {
    const pack = await loadPack();
    const floors = bandFloors(pack.entries);
    const itemsById = new Map(itemsOf(pack.entries).map((item) => [item.id, item]));
    const violations: string[] = [];
    for (const { id: tableId, band } of BAND_TABLES) {
      const table = tablesOf(pack.entries).find((entry) => entry.id === tableId);
      if (table === undefined) throw new Error(`content pack has no ${tableId}`);
      for (const choice of table.choices) {
        if (choice.contentId === null) continue;
        const item = itemsById.get(choice.contentId);
        if (item === undefined) continue;
        const lowestReachable = Math.max(floors[band]!, choice.minDepth ?? 0);
        if (item.minDepth > lowestReachable) {
          violations.push(
            `${tableId} offers ${item.id} (minDepth ${item.minDepth}) at depth ${lowestReachable}`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
