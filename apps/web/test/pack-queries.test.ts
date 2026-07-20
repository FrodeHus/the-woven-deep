import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type {
  BackgroundContentEntry,
  BalanceContentEntry,
  ClassContentEntry,
  CompiledContentPack,
  ItemContentEntry,
  MonsterContentEntry,
  SpellContentEntry,
  TraitContentEntry,
} from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  backgroundById,
  backgroundEntries,
  balanceEntry,
  classById,
  classEntries,
  entriesByKind,
  entryById,
  itemById,
  itemEntries,
  monsterEntries,
  spellEntries,
  traitById,
  traitEntries,
} from '../src/session/pack-queries.js';

// Every helper is exercised against a REAL compiled pack and pinned to the exact entry (or entries,
// in pack order) a hand-written `entries.find`/`entries.filter` kind guard would return.

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

describe('entriesByKind', () => {
  it("returns every entry of the kind in the pack's own order", () => {
    const expected = pack.entries.filter(
      (entry): entry is ClassContentEntry => entry.kind === 'class',
    );
    expect(entriesByKind(pack, 'class')).toEqual(expected);
  });

  it('returns an empty list for a kind with no entries', () => {
    const expected = pack.entries.filter((entry) => entry.kind === 'achievement');
    expect(entriesByKind(pack, 'achievement')).toEqual(expected);
  });
});

describe('entryById', () => {
  it('finds the entry matching kind and id', () => {
    const first = pack.entries.find((entry): entry is ItemContentEntry => entry.kind === 'item');
    expect(first).toBeDefined();
    expect(entryById(pack, 'item', first!.id)).toBe(first);
  });

  it('returns undefined when the id belongs to a different kind', () => {
    const item = pack.entries.find((entry): entry is ItemContentEntry => entry.kind === 'item');
    expect(item).toBeDefined();
    expect(entryById(pack, 'monster', item!.id)).toBeUndefined();
  });

  it('returns undefined for an unknown id', () => {
    expect(entryById(pack, 'item', 'item.does-not-exist')).toBeUndefined();
  });
});

describe('typed helpers match their hand-written predicates', () => {
  it('balanceEntry returns the first balance entry', () => {
    const expected = pack.entries.find(
      (entry): entry is BalanceContentEntry => entry.kind === 'balance',
    );
    expect(balanceEntry(pack)).toBe(expected);
  });

  it('classById / classEntries', () => {
    const all = pack.entries.filter((entry): entry is ClassContentEntry => entry.kind === 'class');
    expect(classEntries(pack)).toEqual(all);
    expect(classById(pack, all[0]!.id)).toBe(all[0]);
  });

  it('backgroundById / backgroundEntries', () => {
    const all = pack.entries.filter(
      (entry): entry is BackgroundContentEntry => entry.kind === 'background',
    );
    expect(backgroundEntries(pack)).toEqual(all);
    expect(backgroundById(pack, all[0]!.id)).toBe(all[0]);
  });

  it('traitById / traitEntries', () => {
    const all = pack.entries.filter((entry): entry is TraitContentEntry => entry.kind === 'trait');
    expect(traitEntries(pack)).toEqual(all);
    expect(traitById(pack, all[0]!.id)).toBe(all[0]);
  });

  it('itemById / itemEntries', () => {
    const all = pack.entries.filter((entry): entry is ItemContentEntry => entry.kind === 'item');
    expect(itemEntries(pack)).toEqual(all);
    expect(itemById(pack, all[0]!.id)).toBe(all[0]);
  });

  it('monsterEntries', () => {
    const all = pack.entries.filter(
      (entry): entry is MonsterContentEntry => entry.kind === 'monster',
    );
    expect(monsterEntries(pack)).toEqual(all);
  });

  it('spellEntries', () => {
    const all = pack.entries.filter((entry): entry is SpellContentEntry => entry.kind === 'spell');
    expect(spellEntries(pack)).toEqual(all);
  });
});
