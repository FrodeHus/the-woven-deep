import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/database.js';
import { ProfileRepository } from '../../src/db/profile-repository.js';
import { createSettingsService, SETTINGS_MAX_BYTES } from '../../src/auth/settings-service.js';
import type { Clock } from '../../src/auth/rate-limiter.js';

class FakeClock implements Clock {
  private current: Date;

  constructor(start: string) {
    this.current = new Date(start);
  }

  now(): Date {
    return this.current;
  }
}

function freshDatabase(): Database.Database {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  runMigrations(database);
  return database;
}

describe('createSettingsService', () => {
  let database: Database.Database;
  let profiles: ProfileRepository;
  let clock: FakeClock;
  let profileId: string;

  beforeEach(() => {
    database = freshDatabase();
    profiles = new ProfileRepository(database);
    clock = new FakeClock('2026-07-17T00:00:00.000Z');
    profileId = 'profile-settings-1';
    profiles.create({
      id: profileId,
      normalizedEmail: 'settings@example.com',
      nowIso: clock.now().toISOString(),
    });
  });

  function makeService() {
    return createSettingsService({ clock, profiles });
  }

  it('returns the empty marker for an unset profile', () => {
    const service = makeService();
    expect(service.read(profileId)).toEqual({ settingsJson: null, settingsVersion: 0 });
  });

  it('round-trips a valid settings blob through read after write', () => {
    const service = makeService();
    const settingsJson = JSON.stringify({ theme: 'high-contrast' });

    const result = service.write({ profileId, settingsJson, settingsVersion: 1 });
    expect(result).toEqual({ ok: true });
    expect(service.read(profileId)).toEqual({ settingsJson, settingsVersion: 1 });
  });

  it('rejects an over-size blob without overwriting an existing one', () => {
    const service = makeService();
    const goodJson = JSON.stringify({ theme: 'high-contrast' });
    expect(service.write({ profileId, settingsJson: goodJson, settingsVersion: 1 })).toEqual({
      ok: true,
    });

    const tooLargeJson = JSON.stringify({ padding: 'x'.repeat(SETTINGS_MAX_BYTES) });
    const result = service.write({ profileId, settingsJson: tooLargeJson, settingsVersion: 2 });

    expect(result).toEqual({ ok: false, reason: 'too-large' });
    expect(service.read(profileId)).toEqual({ settingsJson: goodJson, settingsVersion: 1 });
  });

  it('rejects a bare-string JSON payload', () => {
    const service = makeService();
    const result = service.write({
      profileId,
      settingsJson: JSON.stringify('just a string'),
      settingsVersion: 1,
    });
    expect(result).toEqual({ ok: false, reason: 'not-json-object' });
  });

  it('rejects an array JSON payload', () => {
    const service = makeService();
    const result = service.write({
      profileId,
      settingsJson: JSON.stringify([1, 2]),
      settingsVersion: 1,
    });
    expect(result).toEqual({ ok: false, reason: 'not-json-object' });
  });

  it('rejects syntactically-invalid JSON', () => {
    const service = makeService();
    const result = service.write({
      profileId,
      settingsJson: '{not valid json',
      settingsVersion: 1,
    });
    expect(result).toEqual({ ok: false, reason: 'not-json-object' });
  });

  it('rejects a bare number and a literal null payload', () => {
    const service = makeService();
    expect(service.write({ profileId, settingsJson: '5', settingsVersion: 1 })).toEqual({
      ok: false,
      reason: 'not-json-object',
    });
    expect(service.write({ profileId, settingsJson: 'null', settingsVersion: 1 })).toEqual({
      ok: false,
      reason: 'not-json-object',
    });
  });

  it('accepts an empty object', () => {
    const service = makeService();
    expect(service.write({ profileId, settingsJson: '{}', settingsVersion: 1 })).toEqual({
      ok: true,
    });
    expect(service.read(profileId)).toEqual({ settingsJson: '{}', settingsVersion: 1 });
  });

  it('measures the size limit in bytes, not characters', () => {
    const service = makeService();
    // A multi-byte string that is well under 8192 CHARS but over 8192 BYTES (each 'あ' is 3 UTF-8 bytes).
    const multiByte = JSON.stringify({ padding: 'あ'.repeat(3000) });
    expect(multiByte.length).toBeLessThan(SETTINGS_MAX_BYTES);
    const result = service.write({ profileId, settingsJson: multiByte, settingsVersion: 1 });
    expect(result).toEqual({ ok: false, reason: 'too-large' });
  });
});
