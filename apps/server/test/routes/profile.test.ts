import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { runMigrations } from '../../src/database.js';
import { LoginTokenRepository } from '../../src/db/login-token-repository.js';
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
