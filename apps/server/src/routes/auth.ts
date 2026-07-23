import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import type { AuthConfig } from '../config.js';
import type { LoginService } from '../auth/login-service.js';
import type { VerifyService } from '../auth/verify-service.js';
import type { SessionService } from '../auth/session-service.js';
import type { SettingsService } from '../auth/settings-service.js';
import type { MailTransport } from '../auth/mail-transport.js';
import { ServerRunRecordRepository } from '../db/hall-repository.js';
import {
  requireOrigin,
  requireCsrf,
  readSessionToken,
  SESSION_COOKIE_NAME,
} from '../auth/http-guards.js';

const SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export interface AuthBundle {
  config: AuthConfig;
  login: LoginService;
  verify: VerifyService;
  session: SessionService;
  settings: SettingsService;
  transport: MailTransport;
}

export function registerAuthRoutes(
  app: FastifyInstance,
  auth: AuthBundle,
  database?: Database.Database,
): void {
  const { config, login, verify, session } = auth;

  const originPreHandler = requireOrigin(config.publicUrl);

  app.post('/api/auth/login', { preHandler: originPreHandler }, async (request, reply) => {
    const body = request.body as { email?: unknown } | undefined;
    if (typeof body?.email !== 'string' || body.email.length === 0) {
      reply.code(400).send({ error: 'invalid_body' });
      return;
    }

    try {
      await login.request({ email: body.email, sourceAddress: request.ip });
    } catch {
      // Uniform response even on unexpected transport/service failure.
    }

    reply.send({ ok: true });
  });

  app.get('/api/auth/verify', async (request, reply) => {
    const query = request.query as { token?: unknown };
    const token = typeof query.token === 'string' ? query.token : '';
    const result = verify.verify({ token });

    if (!result) {
      reply.redirect(`${config.publicUrl}/?auth=failed`, 303);
      return;
    }

    reply.setCookie(SESSION_COOKIE_NAME, result.sessionToken, {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
      signed: true,
    });
    reply.redirect(`${config.publicUrl}/?auth=ok`, 303);
  });

  app.get('/api/auth/session', async (request, reply) => {
    const token = readSessionToken(request);
    const authenticated = token ? session.authenticate(token) : null;

    if (!authenticated) {
      reply.code(401).send({ authenticated: false });
      return;
    }

    const csrfToken = reply.generateCsrf();
    // The profile's persisted, `evaluateUnlocks`-derived unlock set (source of truth is what the
    // run-conclusion finalize step already wrote to `hall_state.unlocks_json`) -- never
    // re-evaluated here, and empty when there is no database wired in (isolated auth-route tests)
    // or the profile has no `hall_state` row yet (a profile that has never finished a run).
    const unlockedClassIds = database
      ? new ServerRunRecordRepository({ database, profileId: authenticated.profileId }).unlocks()
      : [];
    reply.send({ authenticated: true, email: authenticated.email, csrfToken, unlockedClassIds });
  });

  const csrfPreHandler = requireCsrf(app);

  app.post(
    '/api/auth/logout',
    { preHandler: [originPreHandler, csrfPreHandler] },
    async (request, reply) => {
      const token = readSessionToken(request);
      if (token) {
        session.revoke(token);
      }

      reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
      reply.send({ ok: true });
    },
  );
}
