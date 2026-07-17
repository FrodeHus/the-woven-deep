import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthConfig } from '../config.js';
import type { LoginService } from '../auth/login-service.js';
import type { VerifyService } from '../auth/verify-service.js';
import type { SessionService } from '../auth/session-service.js';
import type { SettingsService } from '../auth/settings-service.js';
import type { MailTransport } from '../auth/mail-transport.js';

const SESSION_COOKIE_NAME = 'wd_session';
const SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export interface AuthBundle {
  config: AuthConfig;
  login: LoginService;
  verify: VerifyService;
  session: SessionService;
  settings: SettingsService; // used by Task 9's routes
  transport: MailTransport; // for the dev-link endpoint (Task 9)
}

/**
 * Compares the request's Origin (falling back to the Referer's origin) against the
 * configured publicUrl's origin. On mismatch (or missing) it replies 403 and returns
 * true so the caller can stop handling the request.
 */
function assertOrigin(request: FastifyRequest, reply: FastifyReply, publicUrl: string): boolean {
  const expectedOrigin = new URL(publicUrl).origin;
  const originHeader = request.headers.origin;
  const refererHeader = request.headers.referer;

  let actualOrigin: string | undefined;
  if (typeof originHeader === 'string') {
    actualOrigin = originHeader;
  } else if (typeof refererHeader === 'string') {
    try {
      actualOrigin = new URL(refererHeader).origin;
    } catch {
      actualOrigin = undefined;
    }
  }

  if (actualOrigin !== expectedOrigin) {
    reply.code(403).send({ error: 'origin_mismatch' });
    return true;
  }

  return false;
}

function readSessionToken(request: FastifyRequest): string | null {
  const raw = (request.cookies as Record<string, string | undefined>)[SESSION_COOKIE_NAME];
  if (!raw) {
    return null;
  }
  const unsigned = request.unsignCookie(raw);
  return unsigned.valid ? unsigned.value : null;
}

export function registerAuthRoutes(app: FastifyInstance, auth: AuthBundle): void {
  const { config, login, verify, session } = auth;

  const originPreHandler = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    assertOrigin(request, reply, config.publicUrl);
  };

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

  // `app.csrfProtection` is decorated asynchronously by @fastify/csrf-protection, which is
  // registered with `void app.register(...)` in app.ts and not yet available at this point
  // in the synchronous call stack. Wrapping the lookup in a closure defers it until the
  // route actually handles a request (by then Fastify has resolved the plugin tree).
  const csrfPreHandler = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await app.csrfProtection(request, reply, () => undefined);
  };

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
