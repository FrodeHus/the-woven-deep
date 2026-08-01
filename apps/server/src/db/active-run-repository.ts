import type Database from 'better-sqlite3';

export interface ActiveRunRow {
  profileId: string;
  runBlob: string;
  revision: number;
  contentHash: string;
  updatedAt: string;
  /** A Wanderer run's floor-entry rewind blob, or `null` -- always `null` for a Classic run. */
  checkpointBlob: string | null;
}

interface ActiveRunTableRow {
  profile_id: string;
  run_blob: string;
  revision: number;
  content_hash: string;
  updated_at: string;
  checkpoint_blob: string | null;
}

function toRow(row: ActiveRunTableRow): ActiveRunRow {
  return {
    profileId: row.profile_id,
    runBlob: row.run_blob,
    revision: row.revision,
    contentHash: row.content_hash,
    updatedAt: row.updated_at,
    checkpointBlob: row.checkpoint_blob,
  };
}

export class ActiveRunRepository {
  private readonly getStatement;
  private readonly upsertStatement;
  private readonly clearStatement;

  constructor(private readonly database: Database.Database) {
    this.getStatement = this.database.prepare('select * from active_runs where profile_id = ?');
    this.upsertStatement = this.database.prepare(`
      insert into active_runs(profile_id, run_blob, revision, content_hash, updated_at, checkpoint_blob)
      values (?, ?, ?, ?, ?, ?)
      on conflict(profile_id) do update set
        run_blob = excluded.run_blob,
        revision = excluded.revision,
        content_hash = excluded.content_hash,
        updated_at = excluded.updated_at,
        checkpoint_blob = excluded.checkpoint_blob
    `);
    this.clearStatement = this.database.prepare('delete from active_runs where profile_id = ?');
  }

  get(profileId: string): ActiveRunRow | undefined {
    const row = this.getStatement.get(profileId) as ActiveRunTableRow | undefined;
    return row ? toRow(row) : undefined;
  }

  upsert(input: {
    profileId: string;
    runBlob: string;
    revision: number;
    contentHash: string;
    updatedAt: string;
    checkpointBlob: string | null;
  }): void {
    this.upsertStatement.run(
      input.profileId,
      input.runBlob,
      input.revision,
      input.contentHash,
      input.updatedAt,
      input.checkpointBlob,
    );
  }

  clear(profileId: string): void {
    this.clearStatement.run(profileId);
  }
}
