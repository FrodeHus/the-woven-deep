import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { emptyLifetimeState, type LifetimeState } from '@woven-deep/engine';
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

/** Minimal self-contained interstitial: one button, no assets, works without JavaScript. The token
 * is a base64url string by construction (`peek` returned 'valid', so it hashed to a stored row),
 * but it is HTML-escaped anyway. */
function continueSignInPage(token: string): string {
  const escaped = token.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Sign in — The Woven Deep</title>
<style>
  body { font-family: system-ui, sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; background: #14120f; color: #e8e0d0; }
  main { text-align: center; padding: 2rem; }
  button { font-size: 1.1rem; padding: 0.75rem 2rem; border-radius: 0.5rem; border: 1px solid #7a6a45; background: #2a2418; color: #e8e0d0; cursor: pointer; }
  button:hover { background: #3a3220; }
</style>
</head>
<body>
<main>
  <h1>The Woven Deep</h1>
  <p>Press the button to finish signing in.</p>
  <form method="post" action="/api/auth/verify">
    <input type="hidden" name="token" value="${escaped}">
    <button type="submit">Continue sign-in</button>
  </form>
</main>
</body>
</html>`;
}

/** The zeroed `LifetimeState` a profile with no `hall_state` row (or no database at all, in
 * isolated auth-route tests) gets from `/api/auth/session` -- matches exactly what
 * `ServerRunRecordRepository.lifetime()` itself returns for that same profile, so the two never
 * drift. */
const EMPTY_LIFETIME: LifetimeState = emptyLifetimeState();

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
    } catch (error) {
      // Uniform response even on unexpected transport/service failure -- but never silent.
      request.log.error({ err: error }, 'login link delivery failed');
    }

    reply.send({ ok: true });
  });

  // Mail providers (Outlook SafeLinks, corporate scanners) GET every link in an incoming message,
  // so the emailed GET must never consume the single-use token: it only serves a continue page
  // whose form POSTs the token back. Only the POST -- which scanners do not perform -- redeems it.
  app.get('/api/auth/verify', async (request, reply) => {
    const query = request.query as { token?: unknown };
    const token = typeof query.token === 'string' ? query.token : '';
    const state = verify.peek({ token });

    if (state !== 'valid') {
      request.log.warn({ tokenState: state }, 'login link rejected');
      reply.redirect(`${config.publicUrl}/?auth=failed`, 303);
      return;
    }

    reply.type('text/html; charset=utf-8').send(continueSignInPage(token));
  });

  // The continue page submits a plain urlencoded form; Fastify has no parser for that out of the
  // box, and none is registered elsewhere in the app.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(String(body))));
    },
  );

  app.post('/api/auth/verify', { preHandler: originPreHandler }, async (request, reply) => {
    const body = request.body as { token?: unknown } | undefined;
    const token = typeof body?.token === 'string' ? body.token : '';
    const result = verify.verify({ token });

    if (!result) {
      request.log.warn({ tokenState: verify.peek({ token }) }, 'login link redemption failed');
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
    // run-conclusion finalize step already wrote to `hall_state.unlocks_json`), the profile's
    // lifetime totals (`hall_state.lifetime_json`, replayed through the engine's in-memory
    // repository -- see `ServerRunRecordRepository.lifetime()`), and its granted achievements
    // (`hall_state.achievements_json`) -- all read from the SAME per-profile repository, never
    // re-derived here, and each empty/zeroed when there is no database wired in (isolated
    // auth-route tests) or the profile has no `hall_state` row yet (a profile that has never
    // finished a run).
    const hallRepo = database
      ? new ServerRunRecordRepository({ database, profileId: authenticated.profileId })
      : null;
    const unlockedClassIds = hallRepo ? hallRepo.unlocks() : [];
    const lifetime = hallRepo ? hallRepo.lifetime() : EMPTY_LIFETIME;
    const achievements = hallRepo ? hallRepo.achievements() : [];
    reply.send({
      authenticated: true,
      email: authenticated.email,
      csrfToken,
      unlockedClassIds,
      lifetime,
      achievements,
    });
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
