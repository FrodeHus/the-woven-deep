import type { CompiledContentPack } from '@woven-deep/content';
import type Database from 'better-sqlite3';

export class ContentPackRepository {
  constructor(private readonly database: Database.Database) {}

  put(pack: CompiledContentPack): void {
    this.database.prepare(`
      insert into content_packs(hash, schema_version, canonical_json, created_at)
      values (?, ?, ?, ?)
      on conflict(hash) do nothing
    `).run(pack.hash, pack.schemaVersion, JSON.stringify(pack), new Date().toISOString());
  }

  get(hash: string): CompiledContentPack | undefined {
    const row = this.database
      .prepare('select canonical_json from content_packs where hash = ?')
      .get(hash) as { canonical_json: string } | undefined;
    return row ? JSON.parse(row.canonical_json) as CompiledContentPack : undefined;
  }
}
