import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { CONTENT_SCHEMA_VERSION } from '@woven-deep/content';
import { runMigrations } from '../src/database.js';
import { ContentPackRepository } from '../src/content-repository.js';

describe('ContentPackRepository', () => {
  it('deduplicates immutable packs by hash', () => {
    const database = new Database(':memory:');
    runMigrations(database);
    const repository = new ContentPackRepository(database);
    const pack = {
      schemaVersion: CONTENT_SCHEMA_VERSION,
      hash: 'a'.repeat(64),
      entries: [],
      generationReport: { foundationalCategories: [] },
    };
    const conflictingPack = {
      ...pack,
      generationReport: { foundationalCategories: ['changed'] },
    };
    repository.put(pack);
    repository.put(conflictingPack);
    expect(repository.get(pack.hash)).toEqual(pack);
    expect(database.prepare('select count(*) as count from content_packs').get()).toEqual({
      count: 1,
    });
  });

  it('rejects unsupported stored packs before returning entries', () => {
    const database = new Database(':memory:');
    runMigrations(database);
    database
      .prepare(
        'insert into content_packs(hash, schema_version, content_json, created_at) values (?, ?, ?, ?)',
      )
      .run(
        'd'.repeat(64),
        1,
        JSON.stringify({ schemaVersion: 1, hash: 'd'.repeat(64), entries: [] }),
        new Date().toISOString(),
      );
    const repository = new ContentPackRepository(database);
    expect(() => repository.get('d'.repeat(64))).toThrow(/unsupported content schema version 1/i);
  });
});
