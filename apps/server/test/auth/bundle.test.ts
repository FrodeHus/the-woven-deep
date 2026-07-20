import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { createAuthBundle } from '../../src/auth/bundle.js';
import { runMigrations } from '../../src/database.js';
import { LoginTokenRepository } from '../../src/db/login-token-repository.js';
import { ProfileRepository } from '../../src/db/profile-repository.js';
import { SessionRepository } from '../../src/db/session-repository.js';
import type { AuthConfig } from '../../src/config.js';

function freshDatabase(): Database.Database {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  runMigrations(database);
  return database;
}

function makeConfig(): AuthConfig {
  return {
    publicUrl: 'http://localhost:3000',
    cookieSecret: 'test-cookie-secret-that-is-long-enough-32',
    cookieSecure: false,
    mailgun: null,
    loginRateLimit: { perEmailPerHour: 5, perSourcePerHour: 20 },
  };
}

describe('createAuthBundle', () => {
  it('sweeps already-expired login tokens and sessions at construction time', () => {
    const database = freshDatabase();
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const evenEarlier = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    const tokens = new LoginTokenRepository(database);
    tokens.insert({
      tokenHash: 'a'.repeat(64),
      normalizedEmail: 'expired@example.com',
      expiresAt: past,
      createdAt: evenEarlier,
    });

    const profiles = new ProfileRepository(database);
    profiles.create({
      id: 'profile-1',
      normalizedEmail: 'expired@example.com',
      nowIso: evenEarlier,
    });

    const sessions = new SessionRepository(database);
    sessions.insert({
      tokenHash: 'b'.repeat(64),
      profileId: 'profile-1',
      createdAt: evenEarlier,
      lastSeenAt: evenEarlier,
      expiresAt: past,
    });

    expect(tokens.findUnconsumed('a'.repeat(64))).toBeDefined();
    expect(sessions.find('b'.repeat(64))).toBeDefined();

    createAuthBundle({ db: database, config: makeConfig() });

    expect(tokens.findUnconsumed('a'.repeat(64))).toBeUndefined();
    expect(sessions.find('b'.repeat(64))).toBeUndefined();
  });
});
