import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/database.js';
import { ContentPackRepository } from '../src/content-repository.js';

describe('ContentPackRepository', () => {
  it('deduplicates immutable packs by hash', () => {
    const database = new Database(':memory:');
    migrateDatabase(database);
    const repository = new ContentPackRepository(database);
    const pack = { schemaVersion: 1 as const, hash: 'a'.repeat(64), entries: [] };
    const conflictingPack = {
      ...pack,
      entries: [{
        id: 'item.changed',
        kind: 'item' as const,
        name: 'Changed item',
        glyph: '!',
        color: '#ffffff',
        tags: [],
        effect: 'effect.changed',
        price: 1,
      }],
    };
    repository.put(pack);
    repository.put(conflictingPack);
    expect(repository.get(pack.hash)).toEqual(pack);
    expect(database.prepare('select count(*) as count from content_packs').get()).toEqual({ count: 1 });
  });
});
