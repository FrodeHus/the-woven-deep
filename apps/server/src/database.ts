import Database from 'better-sqlite3';

export type Migration = Readonly<{
  id: number;
  name: string;
  up: (db: Database.Database) => void;
}>;

const createContentPacksTable = `
  create table if not exists content_packs (
    hash text primary key check(length(hash) = 64),
    schema_version integer not null,
    content_json text not null,
    created_at text not null
  ) strict;
`;

export const MIGRATIONS: readonly Migration[] = [
  {
    id: 1,
    name: 'content_packs',
    up: (database) => {
      const columns = database.prepare(`
        select name from pragma_table_info('content_packs') order by cid
      `).all() as Array<{ name: string }>;

      if (columns.length > 0 && !columns.some(({ name }) => name === 'content_json')) {
        database.exec('alter table content_packs rename to content_packs_legacy');
        database.exec(createContentPacksTable);
        database.exec(`
          insert into content_packs(hash, schema_version, content_json, created_at)
          select * from content_packs_legacy
        `);
        database.exec('drop table content_packs_legacy');
        return;
      }

      database.exec(createContentPacksTable);
    },
  },
];

/**
 * Asserts that a migration list is contiguous and ascending starting at id 1,
 * i.e. migrations[i].id === i + 1 for every index. Throws on gaps, duplicates,
 * or misordering. Exported so tests can exercise a deliberately-broken array.
 */
export function assertMigrationsWellFormed(migrations: readonly Migration[]): void {
  migrations.forEach((migration, index) => {
    const expectedId = index + 1;
    if (migration.id !== expectedId) {
      throw new Error(
        `migration order/contiguity violation: expected id ${expectedId} at index ${index}, got ${migration.id} ("${migration.name}")`,
      );
    }
  });
}

assertMigrationsWellFormed(MIGRATIONS);

export function runMigrations(db: Database.Database): void {
  const currentVersion = db.pragma('user_version', { simple: true }) as number;

  for (const migration of MIGRATIONS) {
    if (migration.id > currentVersion) {
      db.transaction(() => {
        migration.up(db);
        db.pragma(`user_version = ${migration.id}`);
      })();
    }
  }
}

/** @deprecated Use {@link runMigrations}; kept as an alias for existing call sites. */
export const migrateDatabase = runMigrations;

export function openDatabase(path: string): Database.Database {
  const database = new Database(path);
  database.pragma('journal_mode = WAL');
  runMigrations(database);
  return database;
}
