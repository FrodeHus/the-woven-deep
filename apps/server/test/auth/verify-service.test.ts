import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/database.js';
import { LoginTokenRepository } from '../../src/db/login-token-repository.js';
import { ProfileRepository } from '../../src/db/profile-repository.js';
import { SessionRepository } from '../../src/db/session-repository.js';
import { createVerifyService } from '../../src/auth/verify-service.js';
import { generateToken, hashToken } from '../../src/auth/tokens.js';
import type { Clock } from '../../src/auth/rate-limiter.js';

class FakeClock implements Clock {
  private current: Date;

  constructor(start: string) {
    this.current = new Date(start);
  }

  now(): Date {
    return this.current;
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

function freshDatabase(): Database.Database {
  const database = new Database(':memory:');
  runMigrations(database);
  return database;
}

function idCounter(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}

describe('createVerifyService.verify', () => {
  let database: Database.Database;
  let tokens: LoginTokenRepository;
  let profiles: ProfileRepository;
  let sessions: SessionRepository;
  let clock: FakeClock;

  beforeEach(() => {
    database = freshDatabase();
    tokens = new LoginTokenRepository(database);
    profiles = new ProfileRepository(database);
    sessions = new SessionRepository(database);
    clock = new FakeClock('2026-07-17T00:00:00.000Z');
  });

  function makeService(newId: () => string = idCounter('p')) {
    return createVerifyService({
      clock,
      tokens,
      profiles,
      sessions,
      generateToken,
      hashToken,
      newId,
      transaction: (fn) => database.transaction(fn)(),
    });
  }

  function insertToken(input: { token: string; email: string; expiresAt: string }): void {
    tokens.insert({
      tokenHash: hashToken(input.token),
      normalizedEmail: input.email,
      expiresAt: input.expiresAt,
      createdAt: clock.now().toISOString(),
    });
  }

  it('mints a session and creates a profile on first verify, then reuses the profile for a second token with the same email', () => {
    const service = makeService();

    const tokenA = generateToken();
    insertToken({ token: tokenA, email: 'a@example.com', expiresAt: '2026-07-17T00:15:00.000Z' });

    const resultA = service.verify({ token: tokenA });
    expect(resultA).not.toBeNull();
    expect(resultA?.profile.normalizedEmail).toBe('a@example.com');

    const sessionRowsAfterA = database.prepare('select * from sessions').all();
    expect(sessionRowsAfterA).toHaveLength(1);

    const tokenB = generateToken();
    insertToken({ token: tokenB, email: 'a@example.com', expiresAt: '2026-07-17T00:15:00.000Z' });

    const resultB = service.verify({ token: tokenB });
    expect(resultB).not.toBeNull();
    expect(resultB?.profile.id).toBe(resultA?.profile.id);

    const profileRows = database.prepare('select * from profiles').all();
    expect(profileRows).toHaveLength(1);

    const sessionRowsAfterB = database.prepare('select * from sessions').all();
    expect(sessionRowsAfterB).toHaveLength(2);

    // returned session tokens must not equal the stored hash, and stored rows are hashes.
    expect(resultA?.sessionToken).not.toBe(hashToken(resultA?.sessionToken ?? ''));
    const storedHashes = (sessionRowsAfterB as Array<{ token_hash: string }>).map((r) => r.token_hash);
    expect(storedHashes).toContain(hashToken(resultA!.sessionToken));
    expect(storedHashes).toContain(hashToken(resultB!.sessionToken));
  });

  it('rejects reuse of an already-consumed token and does not create a second session row', () => {
    const service = makeService();
    const token = generateToken();
    insertToken({ token, email: 'reuse@example.com', expiresAt: '2026-07-17T00:15:00.000Z' });

    const first = service.verify({ token });
    expect(first).not.toBeNull();

    const second = service.verify({ token });
    expect(second).toBeNull();

    const sessionRows = database.prepare('select * from sessions').all();
    expect(sessionRows).toHaveLength(1);
  });

  it('returns null and leaves the token unconsumed when the token is expired', () => {
    const service = makeService();
    const token = generateToken();
    insertToken({ token, email: 'expired@example.com', expiresAt: '2026-07-16T23:59:59.000Z' });

    const result = service.verify({ token });
    expect(result).toBeNull();

    const row = database.prepare('select consumed_at from login_tokens where token_hash = ?').get(hashToken(token)) as {
      consumed_at: string | null;
    };
    expect(row.consumed_at).toBeNull();
  });

  it('returns null for a garbage token that does not exist', () => {
    const service = makeService();
    const result = service.verify({ token: 'not-a-real-token' });
    expect(result).toBeNull();
  });

  it('rolls back the whole transaction (no session, token stays consumed-or-not atomically) when session insert fails after consume', () => {
    // Use a real db.transaction to prove atomicity: force sessions.insert to throw by
    // inserting a session that violates the profile_id foreign key via a broken profiles dep.
    const brokenProfiles = {
      findByEmail: () => undefined,
      findById: () => undefined,
      create: () => ({
        id: 'missing-profile-id',
        normalizedEmail: 'atomic@example.com',
        progressionJson: '{}',
        settingsJson: null,
        settingsVersion: 0,
        createdAt: clock.now().toISOString(),
        updatedAt: clock.now().toISOString(),
      }),
    } as unknown as ProfileRepository;

    const service = createVerifyService({
      clock,
      tokens,
      profiles: brokenProfiles,
      sessions,
      generateToken,
      hashToken,
      newId: idCounter('x'),
      transaction: (fn) => database.transaction(fn)(),
    });

    const token = generateToken();
    insertToken({ token, email: 'atomic@example.com', expiresAt: '2026-07-17T00:15:00.000Z' });

    expect(() => service.verify({ token })).toThrow();

    // The transaction must have rolled back: the token should NOT be left consumed.
    const row = database
      .prepare('select consumed_at from login_tokens where token_hash = ?')
      .get(hashToken(token)) as { consumed_at: string | null };
    expect(row.consumed_at).toBeNull();

    const sessionRows = database.prepare('select * from sessions').all();
    expect(sessionRows).toHaveLength(0);
  });
});
