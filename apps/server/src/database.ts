import Database from 'better-sqlite3';

const createContentPacksTable = `
  create table if not exists content_packs (
    hash text primary key check(length(hash) = 64),
    schema_version integer not null,
    content_json text not null,
    created_at text not null
  ) strict;
`;

export function migrateDatabase(database: Database.Database): void {
  database.pragma('journal_mode = WAL');
  const columns = database.prepare(`
    select name from pragma_table_info('content_packs') order by cid
  `).all() as Array<{ name: string }>;

  if (columns.length > 0 && !columns.some(({ name }) => name === 'content_json')) {
    database.transaction(() => {
      database.exec('alter table content_packs rename to content_packs_legacy');
      database.exec(createContentPacksTable);
      database.exec(`
        insert into content_packs(hash, schema_version, content_json, created_at)
        select * from content_packs_legacy
      `);
      database.exec('drop table content_packs_legacy');
    })();
    return;
  }

  database.exec(createContentPacksTable);
}

export function openDatabase(path: string): Database.Database {
  const database = new Database(path);
  migrateDatabase(database);
  return database;
}
