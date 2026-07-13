import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/database.js';

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
});
