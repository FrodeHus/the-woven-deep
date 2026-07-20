import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { runMigrations } from '../../src/database.js';
import { LoginTokenRepository } from '../../src/db/login-token-repository.js';
import { ProfileRepository } from '../../src/db/profile-repository.js';
import { SessionRepository } from '../../src/db/session-repository.js';
import { createLoginService } from '../../src/auth/login-service.js';
import { createVerifyService } from '../../src/auth/verify-service.js';
import { createSessionService } from '../../src/auth/session-service.js';
import { createSettingsService } from '../../src/auth/settings-service.js';
import { generateToken, hashToken } from '../../src/auth/tokens.js';
import type { Clock } from '../../src/auth/rate-limiter.js';
import type { AuthConfig } from '../../src/config.js';
import type { AuthBundle } from '../../src/routes/auth.js';
import type { MailTransport } from '../../src/auth/mail-transport.js';

const pack = {
  schemaVersion: 3 as const,
  hash: 'b'.repeat(64),
  entries: [],
  generationReport: { foundationalCategories: [] },
};

const PUBLIC_URL = 'http://localhost:3000';

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

function fakeTransport(): MailTransport & { links: Map<string, string> } {
  const links = new Map<string, string>();
  return {
    links,
    async sendLoginLink({ email, link }) {
      links.set(email, link);
    },
  };
}

function makeBundle(): {
  bundle: AuthBundle;
  database: Database.Database;
  transport: ReturnType<typeof fakeTransport>;
} {
  const database = freshDatabase();
  const tokens = new LoginTokenRepository(database);
  const profiles = new ProfileRepository(database);
  const sessions = new SessionRepository(database);
  const clock = new FakeClock('2026-07-17T00:00:00.000Z');
  const transport = fakeTransport();

  const config: AuthConfig = {
    publicUrl: PUBLIC_URL,
    cookieSecret: 'test-cookie-secret-that-is-long-enough-32',
    cookieSecure: false,
    mailgun: null,
    loginRateLimit: { perEmailPerHour: 5, perSourcePerHour: 20 },
  };

  const login = createLoginService({ clock, tokens, transport, config, generateToken, hashToken });
  const verify = createVerifyService({
    clock,
    tokens,
    profiles,
    sessions,
    generateToken,
    hashToken,
    newId: () => randomUUID(),
    transaction: (fn) => database.transaction(fn)(),
  });
  const session = createSessionService({
    clock,
    sessions,
    profiles,
    hashToken,
    sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
  });
  const settings = createSettingsService({ clock, profiles });

  return { bundle: { config, login, verify, session, settings, transport }, database, transport };
}

describe('auth routes', () => {
  let app: FastifyInstance;
  let bundle: AuthBundle;
  let database: Database.Database;
  let transport: ReturnType<typeof fakeTransport>;

  beforeEach(() => {
    const built = makeBundle();
    bundle = built.bundle;
    database = built.database;
    transport = built.transport;
    app = buildApp({ pack, auth: bundle });
  });

  afterEach(async () => {
    await app.close();
  });

  it('login returns identical 200 {ok:true} for an existing and a non-existing email', async () => {
    const responseA = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: PUBLIC_URL, 'content-type': 'application/json' },
      payload: { email: 'known@example.com' },
    });
    const responseB = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: PUBLIC_URL, 'content-type': 'application/json' },
      payload: { email: 'unknown@example.com' },
    });

    expect(responseA.statusCode).toBe(200);
    expect(responseA.json()).toEqual({ ok: true });
    expect(responseB.statusCode).toBe(200);
    expect(responseB.json()).toEqual({ ok: true });
  });

  it('rejects login from a mismatched Origin with 403', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://evil.example.com', 'content-type': 'application/json' },
      payload: { email: 'a@example.com' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('verify with a valid token sets a session cookie and redirects to ?auth=ok, and reuse redirects to ?auth=failed with no cookie', async () => {
    const rawToken = generateToken();
    const tokens = new LoginTokenRepository(database);
    tokens.insert({
      tokenHash: hashToken(rawToken),
      normalizedEmail: 'verify@example.com',
      expiresAt: '2026-07-17T00:15:00.000Z',
      createdAt: '2026-07-17T00:00:00.000Z',
    });

    const first = await app.inject({
      method: 'GET',
      url: `/api/auth/verify?token=${encodeURIComponent(rawToken)}`,
    });
    expect(first.statusCode).toBe(303);
    expect(first.headers.location).toBe(`${PUBLIC_URL}/?auth=ok`);
    expect(first.headers['set-cookie']).toBeDefined();
    expect(String(first.headers['set-cookie'])).toContain('wd_session=');

    const second = await app.inject({
      method: 'GET',
      url: `/api/auth/verify?token=${encodeURIComponent(rawToken)}`,
    });
    expect(second.statusCode).toBe(303);
    expect(second.headers.location).toBe(`${PUBLIC_URL}/?auth=failed`);
    expect(second.headers['set-cookie']).toBeUndefined();
  });

  it('verify with an unknown token redirects to ?auth=failed', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/auth/verify?token=garbage' });
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe(`${PUBLIC_URL}/?auth=failed`);
  });

  it('session with no cookie returns 401 {authenticated:false}', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/auth/session' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ authenticated: false });
  });

  async function verifyAndGetCookies(email: string): Promise<string[]> {
    const rawToken = generateToken();
    const tokens = new LoginTokenRepository(database);
    tokens.insert({
      tokenHash: hashToken(rawToken),
      normalizedEmail: email,
      expiresAt: '2026-07-17T00:15:00.000Z',
      createdAt: '2026-07-17T00:00:00.000Z',
    });
    const response = await app.inject({
      method: 'GET',
      url: `/api/auth/verify?token=${encodeURIComponent(rawToken)}`,
    });
    const setCookie = response.headers['set-cookie'];
    return Array.isArray(setCookie) ? setCookie : [String(setCookie)];
  }

  function cookieHeader(setCookies: string[]): string {
    return setCookies.map((c) => c.split(';')[0]).join('; ');
  }

  it('session with a valid cookie returns {authenticated:true, email} and a csrfToken', async () => {
    const setCookies = await verifyAndGetCookies('session-ok@example.com');
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie: cookieHeader(setCookies) },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.authenticated).toBe(true);
    expect(body.email).toBe('session-ok@example.com');
    expect(typeof body.csrfToken).toBe('string');
    expect(body.csrfToken.length).toBeGreaterThan(0);
  });

  it('logout without a CSRF token returns 403', async () => {
    const setCookies = await verifyAndGetCookies('logout-no-csrf@example.com');
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { origin: PUBLIC_URL, cookie: cookieHeader(setCookies) },
    });
    expect(response.statusCode).toBe(403);
  });

  it('logout with cookie+CSRF revokes the session (subsequent /session -> 401) and clears the cookie', async () => {
    const verifyCookies = await verifyAndGetCookies('logout-ok@example.com');
    const sessionResponse = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie: cookieHeader(verifyCookies) },
    });
    const csrfToken = sessionResponse.json().csrfToken as string;
    const sessionSetCookies = sessionResponse.headers['set-cookie'];
    const csrfCookies = Array.isArray(sessionSetCookies)
      ? sessionSetCookies
      : [String(sessionSetCookies)];

    const allCookies = cookieHeader([...verifyCookies, ...csrfCookies]);

    const logoutResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { origin: PUBLIC_URL, cookie: allCookies, 'x-csrf-token': csrfToken },
    });
    expect(logoutResponse.statusCode).toBe(200);
    expect(logoutResponse.json()).toEqual({ ok: true });
    expect(String(logoutResponse.headers['set-cookie'])).toContain('wd_session=;');

    const afterLogout = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie: cookieHeader(verifyCookies) },
    });
    expect(afterLogout.statusCode).toBe(401);
  });

  it('rejects logout from a mismatched Origin with 403', async () => {
    const setCookies = await verifyAndGetCookies('logout-bad-origin@example.com');
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { origin: 'https://evil.example.com', cookie: cookieHeader(setCookies) },
    });
    expect(response.statusCode).toBe(403);
  });

  it('logout with a wrong/forged CSRF token returns 403, but the real token from the same setup returns 200', async () => {
    const verifyCookies = await verifyAndGetCookies('logout-wrong-csrf@example.com');
    const sessionResponse = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie: cookieHeader(verifyCookies) },
    });
    const csrfToken = sessionResponse.json().csrfToken as string;
    const sessionSetCookies = sessionResponse.headers['set-cookie'];
    const csrfCookies = Array.isArray(sessionSetCookies)
      ? sessionSetCookies
      : [String(sessionSetCookies)];

    const allCookies = cookieHeader([...verifyCookies, ...csrfCookies]);

    // Negative case: a garbage token with a real _csrf cookie present must hit the
    // InvalidCSRFTokenError branch (not MissingCSRFSecretError), and still 403.
    const forgedResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { origin: PUBLIC_URL, cookie: allCookies, 'x-csrf-token': 'forged-wrong-token' },
    });
    expect(forgedResponse.statusCode).toBe(403);

    // Positive control: same cookies, real csrfToken -> 200. Proves the 403 above was
    // caused by the token value, not by some other difference in the request setup.
    const realResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { origin: PUBLIC_URL, cookie: allCookies, 'x-csrf-token': csrfToken },
    });
    expect(realResponse.statusCode).toBe(200);
    expect(realResponse.json()).toEqual({ ok: true });
  });

  it('session with a tampered signed session cookie returns 401 {authenticated:false}', async () => {
    const setCookies = await verifyAndGetCookies('tampered-cookie@example.com');
    const sessionCookie = setCookies.find((c) => c.startsWith('wd_session='));
    expect(sessionCookie).toBeDefined();
    const [, value] = String(sessionCookie).split(';')[0].split('=');
    const decoded = decodeURIComponent(value);
    // Flip a character in the middle of the signed cookie value to invalidate the signature
    // without producing an empty/undefined cookie.
    const mid = Math.floor(decoded.length / 2);
    const midChar = decoded[mid];
    const replacement = midChar === 'a' ? 'b' : 'a';
    const tampered = decoded.slice(0, mid) + replacement + decoded.slice(mid + 1);

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie: `wd_session=${encodeURIComponent(tampered)}` },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ authenticated: false });
  });

  it('verify sets the session cookie with HttpOnly, SameSite=Lax, and (localhost) no Secure flag', async () => {
    const rawToken = generateToken();
    const tokens = new LoginTokenRepository(database);
    tokens.insert({
      tokenHash: hashToken(rawToken),
      normalizedEmail: 'cookie-flags@example.com',
      expiresAt: '2026-07-17T00:15:00.000Z',
      createdAt: '2026-07-17T00:00:00.000Z',
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/auth/verify?token=${encodeURIComponent(rawToken)}`,
    });
    const setCookie = response.headers['set-cookie'];
    const cookies = Array.isArray(setCookie) ? setCookie : [String(setCookie)];
    const sessionCookie = cookies.find((c) => c.startsWith('wd_session='));
    expect(sessionCookie).toBeDefined();
    expect(String(sessionCookie)).toContain('HttpOnly');
    expect(String(sessionCookie)).toContain('SameSite=Lax');
    expect(String(sessionCookie)).not.toContain('Secure');
  });

  it('rejects a login body missing email with 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: PUBLIC_URL, 'content-type': 'application/json' },
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_body' });
  });

  it('rejects a login body with a non-string email with 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: PUBLIC_URL, 'content-type': 'application/json' },
      payload: { email: 12345 },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_body' });
  });
});
