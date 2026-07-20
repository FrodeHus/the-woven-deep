import fastifyCookie from '@fastify/cookie';
import fastifyCsrf from '@fastify/csrf-protection';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  decorateProfileId,
  requireCsrf,
  requireOrigin,
  requireSession,
  SESSION_COOKIE_NAME,
} from '../../src/auth/http-guards.js';
import type { AuthenticatedProfile, SessionService } from '../../src/auth/session-service.js';

const PUBLIC_URL = 'http://localhost:3000';

function fakeSessionService(profileByToken: Record<string, AuthenticatedProfile>): SessionService {
  return {
    authenticate(sessionToken) {
      return profileByToken[sessionToken] ?? null;
    },
    revoke() {
      // Not exercised by these guard tests.
    },
  };
}

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(fastifyCookie, { secret: 'test-cookie-secret-that-is-long-enough-32' });
  await app.register(fastifyCsrf, {
    getToken: (req) => req.headers['x-csrf-token'] as string | undefined,
  });
  decorateProfileId(app);
  return app;
}

describe('http guards', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('requireOrigin', () => {
    it('rejects a request with a mismatched Origin header', async () => {
      app = await buildTestApp();
      app.get('/guarded', { preHandler: requireOrigin(PUBLIC_URL) }, async () => ({ ok: true }));

      const response = await app.inject({
        method: 'GET',
        url: '/guarded',
        headers: { origin: 'https://evil.example.com' },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'origin_mismatch' });
    });

    it('rejects a request with no Origin or Referer header', async () => {
      app = await buildTestApp();
      app.get('/guarded', { preHandler: requireOrigin(PUBLIC_URL) }, async () => ({ ok: true }));

      const response = await app.inject({ method: 'GET', url: '/guarded' });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'origin_mismatch' });
    });

    it('allows a request whose Origin matches the configured publicUrl', async () => {
      app = await buildTestApp();
      app.get('/guarded', { preHandler: requireOrigin(PUBLIC_URL) }, async () => ({ ok: true }));

      const response = await app.inject({
        method: 'GET',
        url: '/guarded',
        headers: { origin: PUBLIC_URL },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
    });
  });

  describe('requireSession', () => {
    it('rejects a request with no session cookie and does not set profileId', async () => {
      app = await buildTestApp();
      const session = fakeSessionService({});
      app.get('/guarded', { preHandler: requireSession(session) }, async (request) => ({
        profileId: request.profileId ?? null,
      }));

      const response = await app.inject({ method: 'GET', url: '/guarded' });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'unauthenticated' });
    });

    it('sets request.profileId when the session cookie is valid', async () => {
      app = await buildTestApp();
      const session = fakeSessionService({
        'valid-token': { profileId: 'profile-123', email: 'a@example.com' },
      });
      app.get('/guarded', { preHandler: requireSession(session) }, async (request) => ({
        profileId: request.profileId ?? null,
      }));

      const signed = app.signCookie('valid-token');
      const response = await app.inject({
        method: 'GET',
        url: '/guarded',
        headers: { cookie: `${SESSION_COOKIE_NAME}=${signed}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ profileId: 'profile-123' });
    });
  });

  describe('requireCsrf', () => {
    it('rejects a request missing a CSRF token', async () => {
      app = await buildTestApp();
      app.post('/guarded', { preHandler: requireCsrf(app) }, async () => ({ ok: true }));

      const response = await app.inject({ method: 'POST', url: '/guarded' });

      expect(response.statusCode).toBe(403);
    });

    it('allows a request with a valid CSRF token for the session', async () => {
      app = await buildTestApp();
      app.get('/csrf-token', async (_request, reply) => ({
        csrfToken: await reply.generateCsrf(),
      }));
      app.post('/guarded', { preHandler: requireCsrf(app) }, async () => ({ ok: true }));

      const tokenResponse = await app.inject({ method: 'GET', url: '/csrf-token' });
      const { csrfToken } = tokenResponse.json() as { csrfToken: string };
      const setCookie = tokenResponse.headers['set-cookie'];
      const cookies = Array.isArray(setCookie) ? setCookie : [String(setCookie)];
      const cookieHeader = cookies.map((c) => c.split(';')[0]).join('; ');

      const response = await app.inject({
        method: 'POST',
        url: '/guarded',
        headers: { cookie: cookieHeader, 'x-csrf-token': csrfToken },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
    });
  });
});
