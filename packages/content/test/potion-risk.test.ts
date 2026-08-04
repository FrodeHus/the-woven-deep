import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileContentDirectory } from '../src/compiler/index.js';
import type {
  ConditionContentEntry,
  ContentEntry,
  ItemContentEntry,
  LootTableContentEntry,
} from '../src/model.js';

const POTION_POOL_ID = 'identification-pool.potions';

/** Tables the town merchants stock from. Per the potion-risk design (rule 5) the dealer vouches
 * for what they sell, so a harmful draught may never appear in one of these. */
const TOWN_TABLE_IDS = [
  'loot-table.town-curios',
  'loot-table.town-provisioner',
  'loot-table.early-provisions',
];

async function loadPack() {
  return compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
}

function potionsOf(entries: readonly ContentEntry[]): ItemContentEntry[] {
  return entries.filter(
    (entry): entry is ItemContentEntry =>
      entry.kind === 'item' && entry.identification.poolId === POTION_POOL_ID,
  );
}

/** A potion leaves the hero worse off when it deals damage or applies a condition tagged `debuff`. */
function isHarmful(potion: ItemContentEntry, entries: readonly ContentEntry[]): boolean {
  return potion.effects.some((effect) => {
    if (effect.effectId === 'effect.damage') return true;
    if (effect.effectId !== 'effect.condition.apply') return false;
    const conditionId = (effect.parameters as { conditionId?: string }).conditionId;
    const condition = entries.find(
      (entry): entry is ConditionContentEntry =>
        entry.kind === 'condition' && entry.id === conditionId,
    );
    return condition?.tags.includes('debuff') ?? false;
  });
}

describe('potion risk', () => {
  it('offers at least six potions in the shuffled pool', async () => {
    const pack = await loadPack();
    expect(potionsOf(pack.entries).length).toBeGreaterThanOrEqual(6);
  });

  it('makes at least a third of the pool able to leave the hero worse off', async () => {
    const pack = await loadPack();
    const potions = potionsOf(pack.entries);
    const harmful = potions.filter((potion) => isHarmful(potion, pack.entries));
    expect(harmful.length * 3).toBeGreaterThanOrEqual(potions.length);
  });

  it('offers an outcome that is neither a heal nor a harm', async () => {
    const pack = await loadPack();
    const potions = potionsOf(pack.entries);
    const utility = potions.filter(
      (potion) =>
        !isHarmful(potion, pack.entries) &&
        !potion.effects.some((effect) => effect.effectId === 'effect.heal'),
    );
    expect(utility.length).toBeGreaterThanOrEqual(1);
  });

  it('prices every potion inside one band so price cannot identify it', async () => {
    const pack = await loadPack();
    const prices = [...new Set(potionsOf(pack.entries).map((potion) => potion.price))].sort(
      (left, right) => left - right,
    );
    expect(prices).toEqual([10, 12]);
  });

  it('keeps every potion in circulation somewhere in the Deep', async () => {
    const pack = await loadPack();
    const tables = pack.entries.filter(
      (entry): entry is LootTableContentEntry => entry.kind === 'loot-table',
    );
    const stocked = new Set(
      tables.flatMap((table) =>
        table.choices.filter((choice) => choice.weight > 0).map((choice) => choice.contentId),
      ),
    );
    for (const potion of potionsOf(pack.entries)) {
      expect({ id: potion.id, stocked: stocked.has(potion.id) }).toEqual({
        id: potion.id,
        stocked: true,
      });
    }
  });

  it('never sells a harmful potion in town', async () => {
    const pack = await loadPack();
    const harmfulIds = new Set(
      potionsOf(pack.entries)
        .filter((potion) => isHarmful(potion, pack.entries))
        .map((potion) => potion.id),
    );
    const townStock = pack.entries
      .filter(
        (entry): entry is LootTableContentEntry =>
          entry.kind === 'loot-table' && TOWN_TABLE_IDS.includes(entry.id),
      )
      .flatMap((table) => table.choices.map((choice) => choice.contentId));
    expect(
      townStock.filter((contentId) => contentId !== null && harmfulIds.has(contentId)),
    ).toEqual([]);
  });
});
