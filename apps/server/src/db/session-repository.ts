import type Database from 'better-sqlite3';

export interface SessionRow {
  tokenHash: string;
  profileId: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

interface SessionTableRow {
  token_hash: string;
  profile_id: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at: string | null;
}

function toRow(row: SessionTableRow): SessionRow {
  return {
    tokenHash: row.token_hash,
    profileId: row.profile_id,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

export class SessionRepository {
  private readonly insertStatement;
  private readonly findStatement;
  private readonly touchStatement;
  private readonly revokeStatement;
  private readonly deleteExpiredStatement;

  constructor(private readonly database: Database.Database) {
    this.insertStatement = this.database.prepare(`
      insert into sessions(token_hash, profile_id, created_at, last_seen_at, expires_at, revoked_at)
      values (?, ?, ?, ?, ?, null)
    `);
    this.findStatement = this.database.prepare('select * from sessions where token_hash = ?');
    this.touchStatement = this.database.prepare(
      'update sessions set last_seen_at = ?, expires_at = ? where token_hash = ?',
    );
    this.revokeStatement = this.database.prepare(
      'update sessions set revoked_at = ? where token_hash = ? and revoked_at is null',
    );
    this.deleteExpiredStatement = this.database.prepare(
      'delete from sessions where expires_at <= ?',
    );
  }

  insert(row: Omit<SessionRow, 'revokedAt'>): void {
    this.insertStatement.run(
      row.tokenHash,
      row.profileId,
      row.createdAt,
      row.lastSeenAt,
      row.expiresAt,
    );
  }

  find(tokenHash: string): SessionRow | undefined {
    const row = this.findStatement.get(tokenHash) as SessionTableRow | undefined;
    return row ? toRow(row) : undefined;
  }

  touch(input: { tokenHash: string; lastSeenAt: string; expiresAt: string }): void {
    this.touchStatement.run(input.lastSeenAt, input.expiresAt, input.tokenHash);
  }

  revoke(input: { tokenHash: string; nowIso: string }): void {
    this.revokeStatement.run(input.nowIso, input.tokenHash);
  }

  deleteExpired(nowIso: string): number {
    const result = this.deleteExpiredStatement.run(nowIso);
    return result.changes;
  }
}
