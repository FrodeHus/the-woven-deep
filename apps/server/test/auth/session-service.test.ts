import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/database.js';
import { ProfileRepository } from '../../src/db/profile-repository.js';
import { SessionRepository } from '../../src/db/session-repository.js';
import { createSessionService } from '../../src/auth/session-service.js';
import { generateToken, hashToken } from '../../src/auth/tokens.js';
import type { Clock } from '../../src/auth/rate-limiter.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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
  database.pragma('foreign_keys = ON');
  runMigrations(database);
  return database;
}

describe('createSessionService', () => {
  let database: Database.Database;
  let profiles: ProfileRepository;
  let sessions: SessionRepository;
  let clock: FakeClock;

  beforeEach(() => {
    database = freshDatabase();
    profiles = new ProfileRepository(database);
    sessions = new SessionRepository(database);
    clock = new FakeClock('2026-07-17T00:00:00.000Z');
  });

  function makeService() {
    return createSessionService({ clock, sessions, profiles, hashToken, sessionTtlMs: SESSION_TTL_MS });
  }

  function seedSessionFor(profileEmail: string): string {
    const profile = profiles.create({ id: `profile-${profileEmail}`, normalizedEmail: profileEmail, nowIso: clock.now().toISOString() });
    const token = generateToken();
    const now = clock.now().toISOString();
    sessions.insert({
      tokenHash: hashToken(token),
      profileId: profile.id,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(clock.now().getTime() + SESSION_TTL_MS).toISOString(),
    });
    return token;
  }

  it('authenticates a freshly minted session token to its profile', () => {
    const token = seedSessionFor('fresh@example.com');
    const service = makeService();

    const result = service.authenticate(token);
    expect(result).toEqual({ profileId: `profile-fresh@example.com`, email: 'fresh@example.com' });
  });

  it('returns null for a revoked session', () => {
    const token = seedSessionFor('revoked@example.com');
    const service = makeService();
    service.revoke(token);

    expect(service.authenticate(token)).toBeNull();
  });

  it('returns null for an expired session', () => {
    const token = seedSessionFor('expired@example.com');
    clock.advance(SESSION_TTL_MS + 1000);
    const service = makeService();

    expect(service.authenticate(token)).toBeNull();
  });

  it('returns null for a garbage token', () => {
    const service = makeService();
    expect(service.authenticate('not-a-real-token')).toBeNull();
  });

  it('slides expiry via a bounded touch: no write within 60s of last touch, a write once past the threshold', () => {
    const token = seedSessionFor('bounded@example.com');
    const service = makeService();
    const tokenHash = hashToken(token);

    const rowBefore = database.prepare('select last_seen_at, expires_at from sessions where token_hash = ?').get(tokenHash) as {
      last_seen_at: string;
      expires_at: string;
    };

    clock.advance(30_000); // under the 60s threshold
    service.authenticate(token);

    const rowAfterShortDelay = database.prepare('select last_seen_at, expires_at from sessions where token_hash = ?').get(tokenHash) as {
      last_seen_at: string;
      expires_at: string;
    };
    expect(rowAfterShortDelay).toEqual(rowBefore);

    clock.advance(31_000); // now cumulatively 61s past last touch
    service.authenticate(token);

    const rowAfterThreshold = database.prepare('select last_seen_at, expires_at from sessions where token_hash = ?').get(tokenHash) as {
      last_seen_at: string;
      expires_at: string;
    };
    expect(rowAfterThreshold.last_seen_at).toBe(clock.now().toISOString());
    expect(rowAfterThreshold.expires_at).toBe(new Date(clock.now().getTime() + SESSION_TTL_MS).toISOString());
    expect(rowAfterThreshold).not.toEqual(rowBefore);
  });

  it('makes revoke idempotent', () => {
    const token = seedSessionFor('idempotent@example.com');
    const service = makeService();

    service.revoke(token);
    expect(() => service.revoke(token)).not.toThrow();
    expect(service.authenticate(token)).toBeNull();
  });

  it('never stores the plaintext session token, only its hash', () => {
    const token = seedSessionFor('hashed@example.com');
    const rows = database.prepare('select token_hash from sessions').all() as Array<{ token_hash: string }>;
    expect(rows.map((r) => r.token_hash)).toContain(hashToken(token));
    expect(rows.map((r) => r.token_hash)).not.toContain(token);
  });
});
