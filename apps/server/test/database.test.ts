import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrateDatabase, openDatabase } from '../src/database.js';

describe('openDatabase', () => {
  it('enables WAL mode', () => {
    const directory = mkdtempSync(join(tmpdir(), 'woven-deep-database-'));
    const database = openDatabase(join(directory, 'rogue.sqlite'));

    try {
      expect(database.pragma('journal_mode', { simple: true })).toBe('wal');
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('creates a strict content packs table', () => {
    const directory = mkdtempSync(join(tmpdir(), 'woven-deep-database-'));
    const database = openDatabase(join(directory, 'rogue.sqlite'));

    try {
      expect(database.prepare(`
        select strict from pragma_table_list where name = 'content_packs'
      `).get()).toEqual({ strict: 1 });
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('migrates existing content packs without changing persisted data', () => {
    const database = new Database(':memory:');
    const previousPayloadColumn = ['canon', 'ical_json'].join('');
    const hash = 'a'.repeat(64);
    const payload = '{"schemaVersion":1,"items":[]}';
    const createdAt = '2026-07-13T12:00:00.000Z';

    try {
      database.exec(`
        create table content_packs (
          hash text primary key check(length(hash) = 64),
          schema_version integer not null,
          ${previousPayloadColumn} text not null,
          created_at text not null
        ) strict;
      `);
      database.prepare('insert into content_packs values (?, ?, ?, ?)')
        .run(hash, 1, payload, createdAt);

      migrateDatabase(database);

      expect(database.pragma('table_info(content_packs)'))
        .toEqual(expect.arrayContaining([
          expect.objectContaining({ cid: 0, name: 'hash' }),
          expect.objectContaining({ cid: 1, name: 'schema_version' }),
          expect.objectContaining({ cid: 2, name: 'content_json' }),
          expect.objectContaining({ cid: 3, name: 'created_at' }),
        ]));
      expect((database.pragma('table_info(content_packs)') as Array<{ name: string }>).map(({ name }) => name))
        .toEqual(['hash', 'schema_version', 'content_json', 'created_at']);
      expect(database.prepare(`
        select strict from pragma_table_list where name = 'content_packs'
      `).get()).toEqual({ strict: 1 });
      expect(database.prepare('select hash, schema_version, content_json, created_at from content_packs').all())
        .toEqual([{ hash, schema_version: 1, content_json: payload, created_at: createdAt }]);
      expect(database.prepare(`
        select count(*) as count from sqlite_schema where type = 'table' and name = 'content_packs_legacy'
      `).get()).toEqual({ count: 0 });

      migrateDatabase(database);

      expect(database.prepare('select hash, schema_version, content_json, created_at from content_packs').all())
        .toEqual([{ hash, schema_version: 1, content_json: payload, created_at: createdAt }]);
    } finally {
      database.close();
    }
  });
});
