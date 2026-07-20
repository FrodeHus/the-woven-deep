import { describe, expect, it } from 'vitest';
import type { CompiledContentPack, ContentEntry } from '@woven-deep/content';
import { entryById, requireEncounter, requireItem } from '../src/index.js';

function entry(kind: string, id: string, extra: Record<string, unknown> = {}): ContentEntry {
  return { kind, id, name: id, tags: [], ...extra } as unknown as ContentEntry;
}

function pack(entries: readonly ContentEntry[]): CompiledContentPack {
  return { schemaVersion: 1, hash: 'x', entries, generationReport: { foundationalCategories: [] } } as unknown as CompiledContentPack;
}

const content = pack([
  entry('monster', 'monster.rat'),
  entry('item', 'item.sword'),
  entry('encounter', 'encounter.pack', { model: 'group' }),
  entry('encounter', 'encounter.overlord', { model: 'boss' }),
  entry('condition', 'condition.burning'),
]);

describe('entryById', () => {
  it('returns the entry with the matching id', () => {
    expect(entryById(content, 'item.sword')?.kind).toBe('item');
  });

  it('returns undefined for an unknown id', () => {
    expect(entryById(content, 'item.missing')).toBeUndefined();
  });

  it('returns the same cached entry object across calls on the same pack', () => {
    expect(entryById(content, 'monster.rat')).toBe(entryById(content, 'monster.rat'));
  });
});

describe('requireItem', () => {
  it('returns the item entry', () => {
    expect(requireItem(content, 'item.sword').id).toBe('item.sword');
  });

  it('throws when the id is unknown', () => {
    expect(() => requireItem(content, 'item.missing')).toThrow(/item definition item.missing does not exist/);
  });

  it('throws when the id resolves to a different kind', () => {
    expect(() => requireItem(content, 'monster.rat')).toThrow(/item definition monster.rat does not exist/);
  });
});

describe('requireEncounter', () => {
  it('returns the encounter of the requested model', () => {
    expect(requireEncounter(content, 'encounter.pack', 'group').model).toBe('group');
  });

  it('throws when the encounter has a different model', () => {
    expect(() => requireEncounter(content, 'encounter.pack', 'boss')).toThrow(/boss encounter encounter.pack does not exist/);
  });

  it('throws when the id is unknown', () => {
    expect(() => requireEncounter(content, 'encounter.void', 'group')).toThrow(/group encounter encounter.void does not exist/);
  });

  it('throws when the id resolves to a non-encounter kind', () => {
    expect(() => requireEncounter(content, 'item.sword', 'group')).toThrow(/group encounter item.sword does not exist/);
  });
});
