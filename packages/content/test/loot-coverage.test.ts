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
 * Tag the engine selects the Final Chamber's tablet fragments by, rather than by id.
 * Mirrors `TABLET_FRAGMENT_TAG` in packages/engine/src/final-chamber-fragments.ts.
 */
const TABLET_FRAGMENT_TAG = 'tablet-fragment';

/**
 * Items placed by a system other than a loot table. Every exemption below is *derived* from the
 * pack rather than hand-listed, because a hand-maintained list of ids rots silently: an entry
 * that stops being true goes on excusing a genuinely unreachable item forever. Deriving each
 * exemption from the same field the placing system reads means an item can only be excused for
 * as long as it is actually placed.
 */
function placedByAnotherSystem(entries: readonly ContentEntry[]): ReadonlySet<string> {
  const excused = new Set<string>();
  for (const entry of entries) {
    if (entry.kind === 'item') {
      // Artifact singleton circulation indexes on the `artifact` block (commerce.ts, artifactIndex).
      if (entry.artifact !== null) excused.add(entry.id);
      // The Final Chamber selects fragments by tag (final-chamber-fragments.ts).
      if (entry.tags.includes(TABLET_FRAGMENT_TAG)) excused.add(entry.id);
      continue;
    }
    // Loot tables are the thing being measured, not an alternative placement system: letting
    // them excuse their own contents would make a weight-0 choice look like coverage.
    if (entry.kind === 'loot-table') continue;
    // Encounters name boss rewards via `uniqueItemId`, champions name theirs via
    // `fallbackItemId`. Walking for any `item.`-prefixed string keeps this correct as those
    // schemas grow, instead of hard-coding today's two field names.
    for (const id of itemIdsWithin(entry)) excused.add(id);
  }
  return excused;
}

/** Every `item.`-prefixed string value reachable anywhere within a content entry. */
function itemIdsWithin(value: unknown, found: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') {
    if (value.startsWith('item.')) found.add(value);
    return found;
  }
  if (Array.isArray(value)) {
    for (const element of value) itemIdsWithin(element, found);
    return found;
  }
  if (typeof value === 'object' && value !== null) {
    for (const nested of Object.values(value)) itemIdsWithin(nested, found);
  }
  return found;
}

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
  it('makes every item obtainable somewhere, by a loot table or another placement system', async () => {
    const pack = await loadPack();
    const stocked = new Set(
      tablesOf(pack.entries).flatMap((table) =>
        table.choices
          .filter((choice) => choice.weight > 0 && choice.contentId !== null)
          .map((choice) => choice.contentId as string),
      ),
    );
    const excused = placedByAnotherSystem(pack.entries);
    const orphans = itemsOf(pack.entries)
      .map((item) => item.id)
      .filter((id) => !stocked.has(id) && !excused.has(id))
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
