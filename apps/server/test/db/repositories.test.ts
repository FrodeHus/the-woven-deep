import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/database.js';
import { ProfileRepository } from '../../src/db/profile-repository.js';
import { LoginTokenRepository } from '../../src/db/login-token-repository.js';
import { SessionRepository } from '../../src/db/session-repository.js';

function freshDatabase(): Database.Database {
  const database = new Database(':memory:');
  runMigrations(database);
  return database;
}

describe('migration 2 (auth tables)', () => {
  it('creates profiles, login_tokens, and sessions as strict tables', () => {
    const database = freshDatabase();

    try {
      const tables = database
        .prepare(
          `
          select sqlite_master.name as name, pragma_table_list.strict as strict
          from sqlite_master
          join pragma_table_list on sqlite_master.name = pragma_table_list.name
          where sqlite_master.type = 'table' and sqlite_master.name in ('profiles','login_tokens','sessions')
        `,
        )
        .all() as Array<{ name: string; strict: number }>;

      expect(tables).toHaveLength(3);
      for (const table of tables) {
        expect(table.strict).toBe(1);
      }
    } finally {
      database.close();
    }
  });
});

describe('ProfileRepository', () => {
  let database: Database.Database;
  let repository: ProfileRepository;

  beforeEach(() => {
    database = freshDatabase();
    repository = new ProfileRepository(database);
  });

  it('creates a profile and finds it by email and id', () => {
    const created = repository.create({
      id: 'p1',
      normalizedEmail: 'a@example.com',
      nowIso: '2026-07-17T00:00:00.000Z',
    });

    expect(created).toEqual({
      id: 'p1',
      normalizedEmail: 'a@example.com',
      progressionJson: '{}',
      settingsJson: null,
      settingsVersion: 0,
      createdAt: '2026-07-17T00:00:00.000Z',
      updatedAt: '2026-07-17T00:00:00.000Z',
    });

    expect(repository.findByEmail('a@example.com')).toEqual(created);
    expect(repository.findById('p1')).toEqual(created);
    expect(repository.findByEmail('nope@example.com')).toBeUndefined();
    expect(repository.findById('nope')).toBeUndefined();
  });

  it('enforces the normalized_email UNIQUE constraint', () => {
    repository.create({
      id: 'p1',
      normalizedEmail: 'dup@example.com',
      nowIso: '2026-07-17T00:00:00.000Z',
    });

    expect(() =>
      repository.create({
        id: 'p2',
        normalizedEmail: 'dup@example.com',
        nowIso: '2026-07-17T00:00:00.000Z',
      }),
    ).toThrow();
  });

  it('updateSettings persists blob, version, and updated_at', () => {
    repository.create({
      id: 'p1',
      normalizedEmail: 'a@example.com',
      nowIso: '2026-07-17T00:00:00.000Z',
    });

    repository.updateSettings({
      id: 'p1',
      settingsJson: '{"theme":"dark"}',
      settingsVersion: 3,
      nowIso: '2026-07-17T01:00:00.000Z',
    });

    const updated = repository.findById('p1');
    expect(updated).toEqual({
      id: 'p1',
      normalizedEmail: 'a@example.com',
      progressionJson: '{}',
      settingsJson: '{"theme":"dark"}',
      settingsVersion: 3,
      createdAt: '2026-07-17T00:00:00.000Z',
      updatedAt: '2026-07-17T01:00:00.000Z',
    });
  });
});

describe('LoginTokenRepository', () => {
  let database: Database.Database;
  let repository: LoginTokenRepository;

  beforeEach(() => {
    database = freshDatabase();
    repository = new LoginTokenRepository(database);
  });

  it('inserts and finds an unconsumed token, but not a consumed one', () => {
    repository.insert({
      tokenHash: 'hash1',
      normalizedEmail: 'a@example.com',
      expiresAt: '2026-07-17T00:15:00.000Z',
      createdAt: '2026-07-17T00:00:00.000Z',
    });

    expect(repository.findUnconsumed('hash1')).toEqual({
      tokenHash: 'hash1',
      normalizedEmail: 'a@example.com',
      expiresAt: '2026-07-17T00:15:00.000Z',
      createdAt: '2026-07-17T00:00:00.000Z',
      consumedAt: null,
    });

    const consumed = repository.markConsumed({
      tokenHash: 'hash1',
      nowIso: '2026-07-17T00:05:00.000Z',
    });
    expect(consumed).toBe(true);

    expect(repository.findUnconsumed('hash1')).toBeUndefined();
  });

  it('markConsumed is single-use: true once, then false', () => {
    repository.insert({
      tokenHash: 'hash2',
      normalizedEmail: 'a@example.com',
      expiresAt: '2026-07-17T00:15:00.000Z',
      createdAt: '2026-07-17T00:00:00.000Z',
    });

    expect(
      repository.markConsumed({ tokenHash: 'hash2', nowIso: '2026-07-17T00:05:00.000Z' }),
    ).toBe(true);
    expect(
      repository.markConsumed({ tokenHash: 'hash2', nowIso: '2026-07-17T00:06:00.000Z' }),
    ).toBe(false);
  });

  it('markConsumed on an unknown token returns false', () => {
    expect(
      repository.markConsumed({ tokenHash: 'missing', nowIso: '2026-07-17T00:05:00.000Z' }),
    ).toBe(false);
  });

  it('deleteExpired removes only past-expiry rows', () => {
    repository.insert({
      tokenHash: 'expired',
      normalizedEmail: 'a@example.com',
      expiresAt: '2026-07-17T00:00:00.000Z',
      createdAt: '2026-07-16T23:45:00.000Z',
    });
    repository.insert({
      tokenHash: 'active',
      normalizedEmail: 'a@example.com',
      expiresAt: '2026-07-17T01:00:00.000Z',
      createdAt: '2026-07-17T00:45:00.000Z',
    });

    const removed = repository.deleteExpired('2026-07-17T00:30:00.000Z');

    expect(removed).toBe(1);
    expect(repository.findUnconsumed('expired')).toBeUndefined();
    expect(repository.findUnconsumed('active')).toBeDefined();
  });
});

describe('SessionRepository', () => {
  let database: Database.Database;
  let profiles: ProfileRepository;
  let repository: SessionRepository;

  beforeEach(() => {
    database = freshDatabase();
    profiles = new ProfileRepository(database);
    repository = new SessionRepository(database);
    profiles.create({
      id: 'p1',
      normalizedEmail: 'a@example.com',
      nowIso: '2026-07-17T00:00:00.000Z',
    });
  });

  it('inserts, finds, and touches a session', () => {
    repository.insert({
      tokenHash: 'session1',
      profileId: 'p1',
      createdAt: '2026-07-17T00:00:00.000Z',
      lastSeenAt: '2026-07-17T00:00:00.000Z',
      expiresAt: '2026-08-16T00:00:00.000Z',
    });

    expect(repository.find('session1')).toEqual({
      tokenHash: 'session1',
      profileId: 'p1',
      createdAt: '2026-07-17T00:00:00.000Z',
      lastSeenAt: '2026-07-17T00:00:00.000Z',
      expiresAt: '2026-08-16T00:00:00.000Z',
      revokedAt: null,
    });

    repository.touch({
      tokenHash: 'session1',
      lastSeenAt: '2026-07-18T00:00:00.000Z',
      expiresAt: '2026-08-17T00:00:00.000Z',
    });

    expect(repository.find('session1')).toEqual({
      tokenHash: 'session1',
      profileId: 'p1',
      createdAt: '2026-07-17T00:00:00.000Z',
      lastSeenAt: '2026-07-18T00:00:00.000Z',
      expiresAt: '2026-08-17T00:00:00.000Z',
      revokedAt: null,
    });
  });

  it('revoke is idempotent: second revoke leaves the original revoked_at', () => {
    repository.insert({
      tokenHash: 'session2',
      profileId: 'p1',
      createdAt: '2026-07-17T00:00:00.000Z',
      lastSeenAt: '2026-07-17T00:00:00.000Z',
      expiresAt: '2026-08-16T00:00:00.000Z',
    });

    repository.revoke({ tokenHash: 'session2', nowIso: '2026-07-17T01:00:00.000Z' });
    expect(repository.find('session2')?.revokedAt).toBe('2026-07-17T01:00:00.000Z');

    repository.revoke({ tokenHash: 'session2', nowIso: '2026-07-17T02:00:00.000Z' });
    expect(repository.find('session2')?.revokedAt).toBe('2026-07-17T01:00:00.000Z');
  });

  it('deleteExpired removes only past-expiry rows', () => {
    repository.insert({
      tokenHash: 'expired-session',
      profileId: 'p1',
      createdAt: '2026-06-01T00:00:00.000Z',
      lastSeenAt: '2026-06-01T00:00:00.000Z',
      expiresAt: '2026-07-01T00:00:00.000Z',
    });
    repository.insert({
      tokenHash: 'active-session',
      profileId: 'p1',
      createdAt: '2026-07-17T00:00:00.000Z',
      lastSeenAt: '2026-07-17T00:00:00.000Z',
      expiresAt: '2026-08-16T00:00:00.000Z',
    });

    const removed = repository.deleteExpired('2026-07-17T00:00:00.000Z');

    expect(removed).toBe(1);
    expect(repository.find('expired-session')).toBeUndefined();
    expect(repository.find('active-session')).toBeDefined();
  });
});
