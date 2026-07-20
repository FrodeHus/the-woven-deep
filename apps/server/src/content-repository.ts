import { validateCompiledContentPack, type CompiledContentPack } from '@woven-deep/content';
import type Database from 'better-sqlite3';

export class ContentPackRepository {
  constructor(private readonly database: Database.Database) {}

  put(pack: CompiledContentPack): void {
    this.database
      .prepare(
        `
      insert into content_packs(hash, schema_version, content_json, created_at)
      values (?, ?, ?, ?)
      on conflict(hash) do nothing
    `,
      )
      .run(pack.hash, pack.schemaVersion, JSON.stringify(pack), new Date().toISOString());
  }

  get(hash: string): CompiledContentPack | undefined {
    const row = this.database
      .prepare('select content_json from content_packs where hash = ?')
      .get(hash) as { content_json: string } | undefined;
    return row ? validateCompiledContentPack(JSON.parse(row.content_json)) : undefined;
  }
}
