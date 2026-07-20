import type { FastifyInstance } from 'fastify';
import type { AuthBundle } from './auth.js';
import { requireOrigin, requireSession, requireCsrf } from '../auth/http-guards.js';

export function registerProfileRoutes(app: FastifyInstance, auth: AuthBundle): void {
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

  app.put(
    '/api/profile/settings',
    { preHandler: [originPreHandler, sessionPreHandler, csrfPreHandler] },
    async (request, reply) => {
      const profileId = request.profileId;
      if (profileId === undefined) {
        return;
      }

      const body = request.body as { settingsJson?: unknown; settingsVersion?: unknown } | undefined;
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
}
