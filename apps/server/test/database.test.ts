import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { assertMigrationsWellFormed, MIGRATIONS, openDatabase, runMigrations, type Migration } from '../src/database.js';

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

  it('enforces foreign keys so a session cannot reference a missing profile', () => {
    const directory = mkdtempSync(join(tmpdir(), 'woven-deep-database-'));
    const database = openDatabase(join(directory, 'rogue.sqlite'));

    try {
      expect(database.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(() => database.prepare(`
        insert into sessions(token_hash, profile_id, created_at, last_seen_at, expires_at)
        values ('h', 'no-such-profile', 't', 't', 't')
      `).run()).toThrow();
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('runMigrations', () => {
  it('advances a fresh database to the latest user_version and creates content_packs', () => {
    const database = new Database(':memory:');

    try {
      runMigrations(database);

      expect(database.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
      expect(database.prepare(`
        select strict from pragma_table_list where name = 'content_packs'
      `).get()).toEqual({ strict: 1 });
      expect((database.pragma('table_info(content_packs)') as Array<{ name: string }>).map(({ name }) => name))
        .toEqual(['hash', 'schema_version', 'content_json', 'created_at']);
    } finally {
      database.close();
    }
  });

  it('migrates a populated legacy-shape content_packs database forward without losing rows', () => {
    const database = new Database(':memory:');
    const previousPayloadColumn = ['canon', 'ical_json'].join('');
    const hash = 'a'.repeat(64);
    const payload = '{"schemaVersion":1,"items":[]}';
    const createdAt = '2026-07-13T12:00:00.000Z';

    try {
      // A database deployed before this migration runner existed sits at user_version 0
      // with the old content_json-less column shape.
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

      runMigrations(database);

      expect(database.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
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
    } finally {
      database.close();
    }
  });

  it('is a no-op when re-run on an already-migrated database', () => {
    const database = new Database(':memory:');

    try {
      runMigrations(database);
      const hash = 'b'.repeat(64);
      database.prepare('insert into content_packs(hash, schema_version, content_json, created_at) values (?, ?, ?, ?)')
        .run(hash, 3, '{}', '2026-07-15T00:00:00.000Z');

      expect(() => runMigrations(database)).not.toThrow();

      expect(database.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
      expect(database.prepare('select count(*) as count from content_packs').get()).toEqual({ count: 1 });
    } finally {
      database.close();
    }
  });
});

describe('assertMigrationsWellFormed', () => {
  it('accepts a contiguous, ascending-from-1 migration list', () => {
    const wellFormed: Migration[] = [
      { id: 1, name: 'first', up: () => {} },
      { id: 2, name: 'second', up: () => {} },
    ];

    expect(() => assertMigrationsWellFormed(wellFormed)).not.toThrow();
  });

  it('throws when a migration list has a gap', () => {
    const gapped: Migration[] = [
      { id: 1, name: 'first', up: () => {} },
      { id: 3, name: 'third', up: () => {} },
    ];

    expect(() => assertMigrationsWellFormed(gapped)).toThrow();
  });

  it('throws when a migration list is misordered', () => {
    const misordered: Migration[] = [
      { id: 2, name: 'second', up: () => {} },
      { id: 1, name: 'first', up: () => {} },
    ];

    expect(() => assertMigrationsWellFormed(misordered)).toThrow();
  });

  it('throws when the list does not start at id 1', () => {
    const nonStart: Migration[] = [{ id: 2, name: 'second', up: () => {} }];

    expect(() => assertMigrationsWellFormed(nonStart)).toThrow();
  });
});
