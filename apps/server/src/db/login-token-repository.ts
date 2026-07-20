import type Database from 'better-sqlite3';

export interface LoginTokenRow {
  tokenHash: string;
  normalizedEmail: string;
  expiresAt: string;
  createdAt: string;
  consumedAt: string | null;
}

interface LoginTokenTableRow {
  token_hash: string;
  normalized_email: string;
  expires_at: string;
  created_at: string;
  consumed_at: string | null;
}

function toRow(row: LoginTokenTableRow): LoginTokenRow {
  return {
    tokenHash: row.token_hash,
    normalizedEmail: row.normalized_email,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    consumedAt: row.consumed_at,
  };
}

export class LoginTokenRepository {
  private readonly insertStatement;
  private readonly findUnconsumedStatement;
  private readonly markConsumedStatement;
  private readonly deleteExpiredStatement;

  constructor(private readonly database: Database.Database) {
    this.insertStatement = this.database.prepare(`
      insert into login_tokens(token_hash, normalized_email, expires_at, created_at, consumed_at)
      values (?, ?, ?, ?, null)
    `);
    this.findUnconsumedStatement = this.database.prepare(
      'select * from login_tokens where token_hash = ? and consumed_at is null',
    );
    this.markConsumedStatement = this.database.prepare(
      'update login_tokens set consumed_at = ? where token_hash = ? and consumed_at is null',
    );
    this.deleteExpiredStatement = this.database.prepare(
      'delete from login_tokens where expires_at <= ?',
    );
  }

  insert(row: Omit<LoginTokenRow, 'consumedAt'>): void {
    this.insertStatement.run(row.tokenHash, row.normalizedEmail, row.expiresAt, row.createdAt);
  }

  findUnconsumed(tokenHash: string): LoginTokenRow | undefined {
    const row = this.findUnconsumedStatement.get(tokenHash) as LoginTokenTableRow | undefined;
    return row ? toRow(row) : undefined;
  }

  markConsumed(input: { tokenHash: string; nowIso: string }): boolean {
    const result = this.markConsumedStatement.run(input.nowIso, input.tokenHash);
    return result.changes === 1;
  }

  deleteExpired(nowIso: string): number {
    const result = this.deleteExpiredStatement.run(nowIso);
    return result.changes;
  }
}
