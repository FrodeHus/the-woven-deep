import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileContentDirectory } from '../src/compiler/index.js';
import type { ContentEntry, LootTableContentEntry } from '../src/model.js';

const TORCH_ID = 'item.pitch-torch';

/** Floor scatter, shallow to deep. Chests are a separate supply and not part of this curve. */
const SCATTER_TABLES = [
  'loot-table.floor-scatter-shallow',
  'loot-table.floor-scatter-mid',
  'loot-table.floor-scatter-deep',
] as const;

async function loadPack() {
  return compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
}

function tableById(entries: readonly ContentEntry[], id: string): LootTableContentEntry {
  const table = entries.find(
    (entry): entry is LootTableContentEntry => entry.kind === 'loot-table' && entry.id === id,
  );
  if (table === undefined) throw new Error(`content pack has no ${id}`);
  return table;
}

/** Share of this table's total weight that rolls a torch, in basis points to stay integral. */
function torchShareBps(table: LootTableContentEntry): number {
  const total = table.choices.reduce((sum, choice) => sum + choice.weight, 0);
  if (total === 0) throw new Error(`${table.id} has zero total weight`);
  const torch = table.choices
    .filter((choice) => choice.contentId === TORCH_ID)
    .reduce((sum, choice) => sum + choice.weight, 0);
  return Math.round((torch * 10_000) / total);
}

describe('torch curve', () => {
  it('thins torch supply strictly with depth and cuts it off in the deep band', async () => {
    const pack = await loadPack();
    const [shallow, mid, deep] = SCATTER_TABLES.map((id) =>
      torchShareBps(tableById(pack.entries, id)),
    );
    expect({
      deepIsZero: deep === 0,
      shallowOverMid: shallow! > mid!,
      midOverDeep: mid! > deep!,
    }).toEqual({ deepIsZero: true, shallowOverMid: true, midOverDeep: true });
  });

  it('keeps the shallow band the most torch-rich floor scatter in the run', async () => {
    const pack = await loadPack();
    const shallow = torchShareBps(tableById(pack.entries, 'loot-table.floor-scatter-shallow'));
    expect(shallow).toBeGreaterThanOrEqual(1500);
  });

  it('never stacks torches, which are stack-limited to one', async () => {
    const pack = await loadPack();
    const overstacked = pack.entries
      .filter((entry): entry is LootTableContentEntry => entry.kind === 'loot-table')
      .flatMap((table) =>
        table.choices
          .filter((choice) => choice.contentId === TORCH_ID && choice.maximumQuantity > 1)
          .map((choice) => `${table.id}: max ${choice.maximumQuantity}`),
      );
    expect(overstacked).toEqual([]);
  });
});
