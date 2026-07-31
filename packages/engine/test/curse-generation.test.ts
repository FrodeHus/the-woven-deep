import { beforeAll, describe, expect, it } from 'vitest';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { resolve } from 'node:path';
import type { BalanceContentEntry, CompiledContentPack } from '@woven-deep/content';
import {
  applyCurseRolls,
  balanceEntry,
  createFloorItem,
  curseChanceBps,
  type DepthBand,
  type ItemInstance,
  type Uint32State,
} from '../src/index.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

function floorItem(contentId: string, itemId: string): ItemInstance {
  return createFloorItem({ content: pack, contentId, itemId, floorId: 'floor.test', x: 0, y: 0 });
}

function sword(index: number): ItemInstance {
  return floorItem('item.iron-sword', `item.sword.${String(index).padStart(4, '0')}`);
}

function swords(count: number): ItemInstance[] {
  return Array.from({ length: count }, (_, index) => sword(index));
}

function potion(): ItemInstance {
  return floorItem('item.ashen-potion', 'item.potion.0');
}

function scroll(): ItemInstance {
  return floorItem('item.arc-lance-scroll', 'item.scroll.0');
}

function artifactInstance(): ItemInstance {
  return floorItem('item.thread-counts-needle', 'item.artifact.0');
}

function packWithCurseChance(chanceBps: number): CompiledContentPack {
  const entries = pack.entries.map((entry) => {
    if (entry.kind !== 'balance') return entry;
    const balance = entry as BalanceContentEntry;
    return {
      ...balance,
      curses: {
        ...balance.curses,
        chanceBps: { shallow: chanceBps, mid: chanceBps, deep: chanceBps },
      },
    };
  });
  return { ...pack, entries };
}

describe('applyCurseRolls', () => {
  it('consumes no randomness when no item is eligible', () => {
    const state: Uint32State = [1, 2, 3, 4];
    const result = applyCurseRolls({
      content: pack,
      items: [potion(), scroll()],
      band: 'deep',
      state,
    });
    expect(result.state).toEqual(state);
    expect(result.items.every((item) => item.curse === undefined)).toBe(true);
  });

  it('never curses an artifact', () => {
    const result = applyCurseRolls({
      content: packWithCurseChance(10000),
      items: [artifactInstance()],
      band: 'deep',
      state: [1, 2, 3, 4],
    });
    expect(result.items[0]!.curse).toBeUndefined();
  });

  it('is deterministic for a fixed stream state', () => {
    const first = applyCurseRolls({
      content: pack,
      items: swords(8),
      band: 'mid',
      state: [7, 7, 7, 7],
    });
    const second = applyCurseRolls({
      content: pack,
      items: swords(8),
      band: 'mid',
      state: [7, 7, 7, 7],
    });
    expect(first.items).toEqual(second.items);
    expect(first.state).toEqual(second.state);
  });

  it('curses more often in deep bands than shallow ones', () => {
    const rate = (band: DepthBand): number => {
      let state: Uint32State = [3, 1, 4, 1];
      let cursed = 0;
      for (let index = 0; index < 400; index += 1) {
        const rolled = applyCurseRolls({ content: pack, items: [sword(index)], band, state });
        if (rolled.items[0]!.curse) cursed += 1;
        state = rolled.state;
      }
      return cursed;
    };
    expect(rate('deep')).toBeGreaterThan(rate('shallow'));
  });

  it('creates a curse instance that names a real pack curse and starts unrevealed', () => {
    const forced = applyCurseRolls({
      content: packWithCurseChance(10000),
      items: [sword(0)],
      band: 'deep',
      state: [9, 9, 9, 9],
    });
    const curse = forced.items[0]!.curse!;
    expect(curse.revealed).toBe(false);
    expect(pack.entries.some((entry) => entry.kind === 'curse' && entry.id === curse.curseId)).toBe(
      true,
    );
  });

  it('is independent of input order: a shuffled item array assigns the same curse per itemId and advances the stream identically', () => {
    const items = swords(8);
    const shuffled = [...items].reverse();
    const forward = applyCurseRolls({ content: pack, items, band: 'deep', state: [5, 9, 1, 3] });
    const reversed = applyCurseRolls({
      content: pack,
      items: shuffled,
      band: 'deep',
      state: [5, 9, 1, 3],
    });
    const byItemId = (result: readonly ItemInstance[]): ReadonlyMap<string, unknown> =>
      new Map(result.map((item) => [item.itemId, item.curse]));
    expect(byItemId(forward.items)).toEqual(byItemId(reversed.items));
    expect(forward.state).toEqual(reversed.state);
  });
});

describe('curseChanceBps', () => {
  it('doubles the chance for an enchanted item and caps it', () => {
    // capBps 5000, deep chanceBps 3500 -> 7000 doubled, capped to 5000.
    expect(
      curseChanceBps({ balance: balanceEntry(pack).curses, band: 'deep', enchanted: true }),
    ).toBe(5000);
    expect(
      curseChanceBps({ balance: balanceEntry(pack).curses, band: 'shallow', enchanted: true }),
    ).toBe(2000);
  });
});
