import type { FastifyInstance } from 'fastify';
import type { AuthConfig } from '../config.js';
import type { LoginService } from '../auth/login-service.js';
import type { VerifyService } from '../auth/verify-service.js';
import type { SessionService } from '../auth/session-service.js';
import type { SettingsService } from '../auth/settings-service.js';
import type { MailTransport } from '../auth/mail-transport.js';
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

export function registerAuthRoutes(app: FastifyInstance, auth: AuthBundle): void {
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
    const result = verify.verify({ token: String(query.token ?? '') });

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

    const csrfToken = await reply.generateCsrf();
    reply.send({ authenticated: true, email: authenticated.email, csrfToken });
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
