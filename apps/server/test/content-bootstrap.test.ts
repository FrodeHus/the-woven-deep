import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { bootstrapContent } from '../src/content-bootstrap.js';
import { ContentPackRepository } from '../src/content-repository.js';
import { migrateDatabase } from '../src/database.js';

it('compiles and stores the configured content directory', async () => {
  const database = new Database(':memory:');
  migrateDatabase(database);
  const repository = new ContentPackRepository(database);
  const pack = await bootstrapContent(resolve(import.meta.dirname, '../../../content'), repository);
  expect(repository.get(pack.hash)).toEqual(pack);
});
