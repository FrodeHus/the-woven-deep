import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { emptyRunMetrics, type LifetimeState } from '@woven-deep/engine';
import type { AuthBundle } from './auth.js';
import { ServerRunRecordRepository } from '../db/hall-repository.js';
import { ProfileRepository } from '../db/profile-repository.js';
import {
  requireOrigin,
  requireSession,
  requireCsrf,
  readSessionToken,
  SESSION_COOKIE_NAME,
} from '../auth/http-guards.js';

/** Matches `auth.ts`'s `EMPTY_LIFETIME`: the zeroed `LifetimeState` a profile with no
 * `hall_state` row (or no database at all, in isolated profile-route tests) gets from
 * `/api/profile/export` -- kept in lockstep with what `ServerRunRecordRepository.lifetime()`
 * itself returns for that same profile. */
const EMPTY_LIFETIME: LifetimeState = {
  conqueredChampionRecordIds: [],
  grantedAchievementIds: [],
  discoveryProtection: [],
  totals: emptyRunMetrics(),
};

export function registerProfileRoutes(
  app: FastifyInstance,
  auth: AuthBundle,
  database?: Database.Database,
): void {
  const sessionPreHandler = requireSession(auth.session);

  app.get('/api/profile/settings', async (request, reply) => {
    await sessionPreHandler(request, reply);
    if (request.profileId === undefined) {
      return;
    }

    const { settingsJson, settingsVersion } = auth.settings.read(request.profileId);
    reply.send({ settings: settingsJson, settingsVersion });
  });

  const originPreHandler = requireOrigin(auth.config.publicUrl);
  const csrfPreHandler = requireCsrf(app);

  // Export is a read (GET), so it's origin-checked like every other authenticated route but
  // skips CSRF -- CSRF protects state-changing requests, not reads. The document contains only
  // the profile's OWN gameplay/settings data (Hall records, lifetime totals, unlocks,
  // achievements, settings) -- never a session token, cookie, CSRF token, or any auth secret.
  app.get(
    '/api/profile/export',
    { preHandler: [originPreHandler, sessionPreHandler] },
    async (request, reply) => {
      const profileId = request.profileId;
      if (profileId === undefined) {
        return;
      }

      const hallRepo = database ? new ServerRunRecordRepository({ database, profileId }) : null;
      const records = hallRepo ? hallRepo.records() : [];
      const lifetime = hallRepo ? hallRepo.lifetime() : EMPTY_LIFETIME;
      const unlocks = hallRepo ? hallRepo.unlocks() : [];
      const achievements = hallRepo ? hallRepo.achievements() : [];
      const { settingsJson, settingsVersion } = auth.settings.read(profileId);

      reply.header('Content-Disposition', 'attachment; filename="woven-deep-profile.json"');
      reply.send({
        records,
        lifetime,
        unlocks,
        achievements,
        settings: { settingsJson, settingsVersion },
      });
    },
  );

  app.put(
    '/api/profile/settings',
    { preHandler: [originPreHandler, sessionPreHandler, csrfPreHandler] },
    async (request, reply) => {
      const profileId = request.profileId;
      if (profileId === undefined) {
        return;
      }

      const body = request.body as
        { settingsJson?: unknown; settingsVersion?: unknown } | undefined;
      if (
        typeof body?.settingsJson !== 'string' ||
        typeof body?.settingsVersion !== 'number' ||
        !Number.isInteger(body.settingsVersion)
      ) {
        reply.code(400).send({ error: 'invalid_body' });
        return;
      }

      const result = auth.settings.write({
        profileId,
        settingsJson: body.settingsJson,
        settingsVersion: body.settingsVersion,
      });

      if (!result.ok) {
        reply.code(400).send({ error: result.reason });
        return;
      }

      reply.send({ ok: true });
    },
  );

  // A destructive, permanent state change -- gated identically to the settings write (auth +
  // origin + CSRF) plus an explicit confirmation in the body, since there is no undo.
  app.delete(
    '/api/profile',
    { preHandler: [originPreHandler, sessionPreHandler, csrfPreHandler] },
    async (request, reply) => {
      const profileId = request.profileId;
      if (profileId === undefined) {
        return;
      }

      const body = request.body as { confirm?: unknown } | undefined;
      const confirmed = body?.confirm === true || body?.confirm === 'delete';
      if (!confirmed) {
        reply.code(400).send({ error: 'confirmation_required' });
        return;
      }

      // Deleting the profile's `sessions` rows (inside the transaction below) already
      // invalidates every session for it -- `SessionService.authenticate` re-reads both tables
      // on every request. This explicit revoke of the CURRENT token is defense-in-depth for the
      // rare case `database` is unset (isolated tests with no db wired into this route), where
      // the cascade delete below doesn't run at all.
      const token = readSessionToken(request);
      if (token) {
        auth.session.revoke(token);
      }

      if (database) {
        new ProfileRepository(database).delete(profileId);
      }

      reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
      reply.code(204).send();
    },
  );
}
