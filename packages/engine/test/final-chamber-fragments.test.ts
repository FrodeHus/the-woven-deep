import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createDemoRun,
  heroHoldsAllFragments,
  tabletFragmentIds,
  TABLET_FRAGMENT_TAG,
  type ActiveRun,
  type ItemInstance,
} from '../src/index.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

const FRAGMENT_IDS = ['item.tablet-fragment.a', 'item.tablet-fragment.b', 'item.tablet-fragment.c'];

function fragment(contentId: string, overrides: Partial<ItemInstance> = {}): ItemInstance {
  return {
    itemId: `${contentId}.instance`,
    contentId,
    quantity: 1,
    condition: 100,
    enchantment: null,
    identified: true,
    charges: null,
    fuel: null,
    enabled: null,
    location: { type: 'backpack', actorId: 'hero.demo' },
    ...overrides,
  };
}

function runWithItems(items: readonly ItemInstance[]): ActiveRun {
  const run = createDemoRun();
  return { ...run, items };
}

describe('tabletFragmentIds', () => {
  it('returns exactly the 3 authored fragment ids, each carrying the tablet-fragment tag', () => {
    const ids = tabletFragmentIds(pack);
    expect([...ids].sort()).toEqual(FRAGMENT_IDS);
    for (const id of ids) {
      const entry = pack.entries.find((candidate) => candidate.id === id);
      expect(entry?.kind).toBe('item');
      expect(entry?.tags).toContain(TABLET_FRAGMENT_TAG);
    }
  });
});

describe('heroHoldsAllFragments', () => {
  it('is true when the hero backpack holds all 3 fragments', () => {
    const run = runWithItems(FRAGMENT_IDS.map((id) => fragment(id)));
    expect(heroHoldsAllFragments(run, pack)).toBe(true);
  });

  it('is false when one fragment is missing', () => {
    const run = runWithItems(FRAGMENT_IDS.slice(0, 2).map((id) => fragment(id)));
    expect(heroHoldsAllFragments(run, pack)).toBe(false);
  });

  it('is false when a fragment sits on the floor rather than the hero backpack', () => {
    const items = [
      fragment(FRAGMENT_IDS[0]),
      fragment(FRAGMENT_IDS[1]),
      fragment(FRAGMENT_IDS[2], {
        location: { type: 'floor', floorId: 'floor.demo', x: 1, y: 1 },
      }),
    ];
    const run = runWithItems(items);
    expect(heroHoldsAllFragments(run, pack)).toBe(false);
  });

  it('is false when content defines zero fragments (guard against a vacuous true)', () => {
    const emptyPack: CompiledContentPack = { ...pack, entries: [] };
    const run = runWithItems(FRAGMENT_IDS.map((id) => fragment(id)));
    expect(heroHoldsAllFragments(run, emptyPack)).toBe(false);
  });
});
