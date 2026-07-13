import Database from 'better-sqlite3';

export function migrateDatabase(database: Database.Database): void {
  database.pragma('journal_mode = WAL');
  database.exec(`
    create table if not exists content_packs (
      hash text primary key check(length(hash) = 64),
      schema_version integer not null,
      canonical_json text not null,
      created_at text not null
    ) strict;
  `);
}

export function openDatabase(path: string): Database.Database {
  const database = new Database(path);
  migrateDatabase(database);
  return database;
}
