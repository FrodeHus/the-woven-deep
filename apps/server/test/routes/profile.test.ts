import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { emptyRunMetrics, type StoredHallRecord } from '@woven-deep/engine';
import { buildApp } from '../../src/app.js';
import { runMigrations } from '../../src/database.js';
import { LoginTokenRepository } from '../../src/db/login-token-repository.js';
import { ProfileRepository } from '../../src/db/profile-repository.js';
import { ServerRunRecordRepository } from '../../src/db/hall-repository.js';
import { ActiveRunRepository } from '../../src/db/active-run-repository.js';
import { createAuthBundle } from '../../src/auth/bundle.js';
import { generateToken, hashToken } from '../../src/auth/tokens.js';
import type { AuthConfig } from '../../src/config.js';
import type { AuthBundle } from '../../src/routes/auth.js';

const pack = {
  schemaVersion: 3 as const,
  hash: 'b'.repeat(64),
  entries: [],
  generationReport: { foundationalCategories: [] },
};

const PUBLIC_URL = 'http://localhost:3000';

function freshDatabase(): Database.Database {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  runMigrations(database);
  return database;
}

function makeConfig(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    publicUrl: PUBLIC_URL,
    cookieSecret: 'test-cookie-secret-that-is-long-enough-32',
    cookieSecure: false,
    mailgun: null,
    loginRateLimit: { perEmailPerHour: 5, perSourcePerHour: 20 },
    ...overrides,
  };
}

function cookieHeader(setCookies: string[]): string {
  return setCookies.map((c) => c.split(';')[0]).join('; ');
}

async function verifyAndGetCookies(
  app: FastifyInstance,
  database: Database.Database,
  email: string,
): Promise<string[]> {
  const rawToken = generateToken();
  const tokens = new LoginTokenRepository(database);
  const now = new Date();
  tokens.insert({
    tokenHash: hashToken(rawToken),
    normalizedEmail: email,
    expiresAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
    createdAt: now.toISOString(),
  });
  const response = await app.inject({
    method: 'GET',
    url: `/api/auth/verify?token=${encodeURIComponent(rawToken)}`,
  });
  const setCookie = response.headers['set-cookie'];
  return Array.isArray(setCookie) ? setCookie : [String(setCookie)];
}

/** A minimal but fully-typed `StoredHallRecord` fixture -- hand-built rather than routed through
 * the engine's `finalizeRun` (unnecessary machinery for a route test that only needs a record
 * to round-trip through `records()`). */
function fixtureHallRecord(recordId: string): StoredHallRecord {
  return {
    recordId,
    heroName: 'Test Hero',
    classTags: ['class.warden'],
    completionType: 'died',
    cause: { killerContentId: null, depth: 3, turn: 50, worldTime: 5000 },
    deepestDepth: 3,
    score: { lines: [], total: 0 },
    metrics: emptyRunMetrics(),
    reputations: [],
    heirloom: {
      contentId: 'item.fallback',
      sourceItemId: null,
      enchantment: null,
      condition: 1,
      charges: null,
      fuel: null,
      qualityRank: 1,
      displayName: 'Test Heirloom',
      glyph: ')',
      color: '#c0c0c0',
      originatingHallRecordId: recordId,
    },
    build: {
      attributes: { might: 5, agility: 5, vitality: 5, wits: 5, resolve: 5 },
      equippedItemContentIds: [],
      signatureAbilityIds: [],
    },
    runSeed: '00000000000000000000000000000000',
    contentHash: 'a'.repeat(64),
    enrichment: { achievedAt: '2026-07-23T00:00:00.000Z', portraitGlyph: '@' },
  };
}

async function getCsrfToken(
  app: FastifyInstance,
  sessionCookies: string[],
): Promise<{ csrfToken: string; cookies: string[] }> {
  const response = await app.inject({
    method: 'GET',
    url: '/api/auth/session',
    headers: { cookie: cookieHeader(sessionCookies) },
  });
  const csrfToken = response.json().csrfToken as string;
  const setCookie = response.headers['set-cookie'];
  const csrfCookies = Array.isArray(setCookie) ? setCookie : [String(setCookie)];
  return { csrfToken, cookies: [...sessionCookies, ...csrfCookies] };
}

describe('profile routes', () => {
  let app: FastifyInstance;
  let database: Database.Database;
  let bundle: AuthBundle;

  beforeEach(() => {
    database = freshDatabase();
    bundle = createAuthBundle({ db: database, config: makeConfig() });
    app = buildApp({ pack, auth: bundle });
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET settings without a session returns 401', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/profile/settings' });
    expect(response.statusCode).toBe(401);
  });

  it('PUT settings without a session returns 401', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/profile/settings',
      headers: { origin: PUBLIC_URL, 'content-type': 'application/json' },
      payload: { settingsJson: '{}', settingsVersion: 1 },
    });
    expect(response.statusCode).toBe(401);
  });

  it('PUT settings with a session but no CSRF token returns 403', async () => {
    const sessionCookies = await verifyAndGetCookies(app, database, 'csrf-missing@example.com');
    const response = await app.inject({
      method: 'PUT',
      url: '/api/profile/settings',
      headers: {
        origin: PUBLIC_URL,
        cookie: cookieHeader(sessionCookies),
        'content-type': 'application/json',
      },
      payload: { settingsJson: '{}', settingsVersion: 1 },
    });
    expect(response.statusCode).toBe(403);
  });

  it('PUT settings from a mismatched Origin returns 403', async () => {
    const sessionCookies = await verifyAndGetCookies(app, database, 'bad-origin@example.com');
    const { csrfToken, cookies } = await getCsrfToken(app, sessionCookies);
    const response = await app.inject({
      method: 'PUT',
      url: '/api/profile/settings',
      headers: {
        origin: 'https://evil.example.com',
        cookie: cookieHeader(cookies),
        'x-csrf-token': csrfToken,
        'content-type': 'application/json',
      },
      payload: { settingsJson: '{}', settingsVersion: 1 },
    });
    expect(response.statusCode).toBe(403);
  });

  it('PUT then GET round-trips the settings blob for the authenticated profile', async () => {
    const sessionCookies = await verifyAndGetCookies(app, database, 'roundtrip@example.com');
    const { csrfToken, cookies } = await getCsrfToken(app, sessionCookies);

    const putResponse = await app.inject({
      method: 'PUT',
      url: '/api/profile/settings',
      headers: {
        origin: PUBLIC_URL,
        cookie: cookieHeader(cookies),
        'x-csrf-token': csrfToken,
        'content-type': 'application/json',
      },
      payload: { settingsJson: '{"theme":"dark"}', settingsVersion: 1 },
    });
    expect(putResponse.statusCode).toBe(200);
    expect(putResponse.json()).toEqual({ ok: true });

    const getResponse = await app.inject({
      method: 'GET',
      url: '/api/profile/settings',
      headers: { cookie: cookieHeader(sessionCookies) },
    });
    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json()).toEqual({ settings: '{"theme":"dark"}', settingsVersion: 1 });
  });

  it('GET settings for a fresh profile with no settings returns null settings and version 0', async () => {
    const sessionCookies = await verifyAndGetCookies(app, database, 'fresh-profile@example.com');
    const response = await app.inject({
      method: 'GET',
      url: '/api/profile/settings',
      headers: { cookie: cookieHeader(sessionCookies) },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ settings: null, settingsVersion: 0 });
  });

  it('PUT with an oversized settings blob returns 400 too-large', async () => {
    const sessionCookies = await verifyAndGetCookies(app, database, 'too-large@example.com');
    const { csrfToken, cookies } = await getCsrfToken(app, sessionCookies);

    const huge = JSON.stringify({ padding: 'x'.repeat(9000) });
    const response = await app.inject({
      method: 'PUT',
      url: '/api/profile/settings',
      headers: {
        origin: PUBLIC_URL,
        cookie: cookieHeader(cookies),
        'x-csrf-token': csrfToken,
        'content-type': 'application/json',
      },
      payload: { settingsJson: huge, settingsVersion: 1 },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'too-large' });
  });

  it('PUT with non-JSON-object settings returns 400 not-json-object', async () => {
    const sessionCookies = await verifyAndGetCookies(app, database, 'not-json@example.com');
    const { csrfToken, cookies } = await getCsrfToken(app, sessionCookies);

    const response = await app.inject({
      method: 'PUT',
      url: '/api/profile/settings',
      headers: {
        origin: PUBLIC_URL,
        cookie: cookieHeader(cookies),
        'x-csrf-token': csrfToken,
        'content-type': 'application/json',
      },
      payload: { settingsJson: '[1,2,3]', settingsVersion: 1 },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'not-json-object' });
  });

  it('PUT with a non-integer settingsVersion returns 400 invalid_body', async () => {
    const sessionCookies = await verifyAndGetCookies(
      app,
      database,
      'non-integer-version@example.com',
    );
    const { csrfToken, cookies } = await getCsrfToken(app, sessionCookies);

    const response = await app.inject({
      method: 'PUT',
      url: '/api/profile/settings',
      headers: {
        origin: PUBLIC_URL,
        cookie: cookieHeader(cookies),
        'x-csrf-token': csrfToken,
        'content-type': 'application/json',
      },
      payload: { settingsJson: '{}', settingsVersion: 1.5 },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_body' });
  });

  it('dev-link endpoint returns the stored link in dev mode (mailgun: null)', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: PUBLIC_URL, 'content-type': 'application/json' },
      payload: { email: 'dev-link@example.com' },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/dev/last-login-link?email=${encodeURIComponent('dev-link@example.com')}`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(typeof body.link).toBe('string');
    expect(body.link).toContain('/api/auth/verify?token=');
  });

  it('dev-link endpoint returns 404 for an email with no stored link', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/dev/last-login-link?email=${encodeURIComponent('no-link@example.com')}`,
    });
    expect(response.statusCode).toBe(404);
  });

  it('dev-link endpoint is absent (404 from the SPA/notFound handler) when mailgun is configured', async () => {
    const mailgunDatabase = freshDatabase();
    const mailgunBundle = createAuthBundle({
      db: mailgunDatabase,
      config: makeConfig({
        mailgun: { apiKey: 'key', domain: 'mg.example.com', sender: 'noreply@example.com' },
      }),
    });
    const mailgunApp = buildApp({ pack, auth: mailgunBundle });

    const response = await mailgunApp.inject({
      method: 'GET',
      url: `/api/dev/last-login-link?email=${encodeURIComponent('x@example.com')}`,
    });
    expect(response.statusCode).toBe(404);

    await mailgunApp.close();
    mailgunDatabase.close();
  });
});

describe('GET /api/profile/export', () => {
  let app: FastifyInstance;
  let database: Database.Database;
  let bundle: AuthBundle;

  beforeEach(() => {
    database = freshDatabase();
    bundle = createAuthBundle({ db: database, config: makeConfig() });
    app = buildApp({ pack, auth: bundle, database });
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 401 when unauthenticated', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/profile/export',
      headers: { origin: PUBLIC_URL },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'unauthenticated' });
  });

  it('returns 403 for a mismatched Origin', async () => {
    const sessionCookies = await verifyAndGetCookies(
      app,
      database,
      'export-bad-origin@example.com',
    );
    const response = await app.inject({
      method: 'GET',
      url: '/api/profile/export',
      headers: { origin: 'https://evil.example.com', cookie: cookieHeader(sessionCookies) },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'origin_mismatch' });
  });

  it('returns 403 when neither Origin nor Referer is present', async () => {
    const sessionCookies = await verifyAndGetCookies(app, database, 'export-no-origin@example.com');
    const response = await app.inject({
      method: 'GET',
      url: '/api/profile/export',
      headers: { cookie: cookieHeader(sessionCookies) },
    });
    expect(response.statusCode).toBe(403);
  });

  it('exports empty records/zeroed lifetime/empty unlocks+achievements for a fresh profile with no hall_state', async () => {
    const sessionCookies = await verifyAndGetCookies(app, database, 'export-fresh@example.com');
    const response = await app.inject({
      method: 'GET',
      url: '/api/profile/export',
      headers: { origin: PUBLIC_URL, cookie: cookieHeader(sessionCookies) },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.records).toEqual([]);
    expect(body.unlocks).toEqual([]);
    expect(body.achievements).toEqual([]);
    expect(body.lifetime).toEqual({
      conqueredChampionRecordIds: [],
      grantedAchievementIds: [],
      discoveryProtection: [],
      totals: emptyRunMetrics(),
    });
    expect(body.settings).toEqual({ settingsJson: null, settingsVersion: 0 });
  });

  it("exports the profile's own records, lifetime, unlocks, achievements, and settings", async () => {
    const email = 'export-full@example.com';
    const sessionCookies = await verifyAndGetCookies(app, database, email);
    const profiles = new ProfileRepository(database);
    const profile = profiles.findByEmail(email);
    expect(profile).toBeDefined();

    const hallRepo = new ServerRunRecordRepository({ database, profileId: profile!.id });
    const recordA = fixtureHallRecord('record.aaaaaaaa00000000.aaaaaaaaaaaaaaaa');
    const recordB = fixtureHallRecord('record.bbbbbbbb00000000.bbbbbbbbbbbbbbbb');
    hallRepo.appendRecord(recordA);
    hallRepo.appendRecord(recordB);
    hallRepo.applyDeltas({
      recordId: recordA.recordId,
      newlyConqueredChampionRecordIds: [],
      achievementGrants: [
        {
          achievementId: 'achievement.first-blood',
          criteriaId: 'first-champion-defeat',
          name: 'First Blood',
        },
      ],
      discoveryProtectionUpdates: [],
      metrics: { ...emptyRunMetrics(), kills: 7, deepestDepth: 3 },
    });
    hallRepo.appendAchievements([
      {
        achievementId: 'achievement.first-blood',
        criteriaId: 'first-champion-defeat',
        name: 'First Blood',
      },
    ]);
    hallRepo.setUnlocks(['class.warden']);

    const { csrfToken, cookies } = await getCsrfToken(app, sessionCookies);
    const putResponse = await app.inject({
      method: 'PUT',
      url: '/api/profile/settings',
      headers: {
        origin: PUBLIC_URL,
        cookie: cookieHeader(cookies),
        'x-csrf-token': csrfToken,
        'content-type': 'application/json',
      },
      payload: { settingsJson: '{"theme":"dark"}', settingsVersion: 1 },
    });
    expect(putResponse.statusCode).toBe(200);

    const response = await app.inject({
      method: 'GET',
      url: '/api/profile/export',
      headers: { origin: PUBLIC_URL, cookie: cookieHeader(sessionCookies) },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="woven-deep-profile.json"',
    );

    const body = response.json();
    expect(body.records).toEqual([recordA, recordB]);
    expect(body.unlocks).toEqual(['class.warden']);
    expect(body.achievements).toEqual([
      {
        achievementId: 'achievement.first-blood',
        criteriaId: 'first-champion-defeat',
        name: 'First Blood',
      },
    ]);
    expect(body.lifetime.totals.kills).toBe(7);
    expect(body.lifetime.totals.deepestDepth).toBe(3);
    expect(body.settings).toEqual({ settingsJson: '{"theme":"dark"}', settingsVersion: 1 });
  });

  it('never leaks session/CSRF/auth-secret fields, and exposes exactly the expected safe top-level keys', async () => {
    const sessionCookies = await verifyAndGetCookies(
      app,
      database,
      'export-leak-guard@example.com',
    );
    const response = await app.inject({
      method: 'GET',
      url: '/api/profile/export',
      headers: { origin: PUBLIC_URL, cookie: cookieHeader(sessionCookies) },
    });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(Object.keys(body).sort()).toEqual(
      ['achievements', 'lifetime', 'records', 'settings', 'unlocks'].sort(),
    );

    const raw = response.body;
    const forbiddenSubstrings = [
      'sessionToken',
      'session_token',
      'wd_session',
      'csrfToken',
      'csrf_token',
      'cookie',
      'tokenHash',
      'token_hash',
      'password',
      'magicLink',
      'magic_link',
      'secret',
    ];
    for (const forbidden of forbiddenSubstrings) {
      expect(raw.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});

describe('DELETE /api/profile', () => {
  let app: FastifyInstance;
  let database: Database.Database;
  let bundle: AuthBundle;

  beforeEach(() => {
    database = freshDatabase();
    bundle = createAuthBundle({ db: database, config: makeConfig() });
    app = buildApp({ pack, auth: bundle, database });
  });

  afterEach(async () => {
    await app.close();
  });

  function rowCount(table: string, column: string, value: string): number {
    const row = database
      .prepare(`select count(*) as count from ${table} where ${column} = ?`)
      .get(value) as { count: number };
    return row.count;
  }

  it('returns 401 when unauthenticated', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/profile',
      headers: { origin: PUBLIC_URL, 'content-type': 'application/json' },
      payload: { confirm: true },
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns 403 for a mismatched Origin, and deletes nothing', async () => {
    const email = 'delete-bad-origin@example.com';
    const sessionCookies = await verifyAndGetCookies(app, database, email);
    const { csrfToken, cookies } = await getCsrfToken(app, sessionCookies);
    const profile = new ProfileRepository(database).findByEmail(email);
    expect(profile).toBeDefined();

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/profile',
      headers: {
        origin: 'https://evil.example.com',
        cookie: cookieHeader(cookies),
        'x-csrf-token': csrfToken,
        'content-type': 'application/json',
      },
      payload: { confirm: true },
    });
    expect(response.statusCode).toBe(403);
    expect(new ProfileRepository(database).findById(profile!.id)).toBeDefined();
  });

  it('returns 403 with a missing CSRF token, and deletes nothing', async () => {
    const email = 'delete-no-csrf@example.com';
    const sessionCookies = await verifyAndGetCookies(app, database, email);
    const profile = new ProfileRepository(database).findByEmail(email);
    expect(profile).toBeDefined();

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/profile',
      headers: {
        origin: PUBLIC_URL,
        cookie: cookieHeader(sessionCookies),
        'content-type': 'application/json',
      },
      payload: { confirm: true },
    });
    expect(response.statusCode).toBe(403);
    expect(new ProfileRepository(database).findById(profile!.id)).toBeDefined();
  });

  it('returns 400 confirmation_required when confirm is absent, and deletes nothing', async () => {
    const email = 'delete-unconfirmed@example.com';
    const sessionCookies = await verifyAndGetCookies(app, database, email);
    const { csrfToken, cookies } = await getCsrfToken(app, sessionCookies);
    const profile = new ProfileRepository(database).findByEmail(email);
    expect(profile).toBeDefined();

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/profile',
      headers: {
        origin: PUBLIC_URL,
        cookie: cookieHeader(cookies),
        'x-csrf-token': csrfToken,
        'content-type': 'application/json',
      },
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'confirmation_required' });
    expect(new ProfileRepository(database).findById(profile!.id)).toBeDefined();
  });

  it(
    'deletes every row for the profile (hall records/state, active run, sessions, login tokens, ' +
      'the profile itself), clears the cookie, and a subsequent session check is 401',
    async () => {
      const email = 'delete-full@example.com';
      const sessionCookies = await verifyAndGetCookies(app, database, email);
      const profiles = new ProfileRepository(database);
      const profile = profiles.findByEmail(email);
      expect(profile).toBeDefined();
      const profileId = profile!.id;

      const hallRepo = new ServerRunRecordRepository({ database, profileId });
      hallRepo.appendRecord(fixtureHallRecord('record.dddddddd00000000.dddddddddddddddd'));
      hallRepo.appendRecord(fixtureHallRecord('record.eeeeeeee00000000.eeeeeeeeeeeeeeee'));
      hallRepo.setUnlocks(['class.warden']);

      const activeRuns = new ActiveRunRepository(database);
      activeRuns.upsert({
        profileId,
        runBlob: '{}',
        revision: 1,
        contentHash: 'a'.repeat(64),
        updatedAt: new Date().toISOString(),
      });

      expect(rowCount('hall_records', 'profile_id', profileId)).toBe(2);
      expect(rowCount('hall_state', 'profile_id', profileId)).toBe(1);
      expect(rowCount('active_runs', 'profile_id', profileId)).toBe(1);
      expect(rowCount('sessions', 'profile_id', profileId)).toBeGreaterThan(0);
      expect(rowCount('login_tokens', 'normalized_email', email)).toBeGreaterThan(0);

      const { csrfToken, cookies } = await getCsrfToken(app, sessionCookies);
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/profile',
        headers: {
          origin: PUBLIC_URL,
          cookie: cookieHeader(cookies),
          'x-csrf-token': csrfToken,
          'content-type': 'application/json',
        },
        payload: { confirm: true },
      });
      expect(response.statusCode).toBe(204);
      expect(String(response.headers['set-cookie'])).toContain('wd_session=;');

      expect(rowCount('hall_records', 'profile_id', profileId)).toBe(0);
      expect(rowCount('hall_state', 'profile_id', profileId)).toBe(0);
      expect(rowCount('active_runs', 'profile_id', profileId)).toBe(0);
      expect(rowCount('sessions', 'profile_id', profileId)).toBe(0);
      expect(rowCount('login_tokens', 'normalized_email', email)).toBe(0);
      expect(profiles.findById(profileId)).toBeUndefined();

      const sessionResponse = await app.inject({
        method: 'GET',
        url: '/api/auth/session',
        headers: { cookie: cookieHeader(cookies) },
      });
      expect(sessionResponse.statusCode).toBe(401);
    },
  );

  it('accepts confirm: "delete" as well as confirm: true', async () => {
    const email = 'delete-string-confirm@example.com';
    const sessionCookies = await verifyAndGetCookies(app, database, email);
    const { csrfToken, cookies } = await getCsrfToken(app, sessionCookies);

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/profile',
      headers: {
        origin: PUBLIC_URL,
        cookie: cookieHeader(cookies),
        'x-csrf-token': csrfToken,
        'content-type': 'application/json',
      },
      payload: { confirm: 'delete' },
    });
    expect(response.statusCode).toBe(204);
  });
});
