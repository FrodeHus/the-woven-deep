import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { assertOrigin, makeCsrfPreHandler, readSessionToken, type AuthBundle } from './auth.js';
import { normalizeEmail } from '../auth/email.js';

type RequestWithProfileId = FastifyRequest & { profileId?: string };

/**
 * Resolves the authenticated profile id from the session cookie, replying 401 and
 * returning null when there is no valid session. Shared by both profile routes.
 */
function requireProfileId(request: FastifyRequest, reply: FastifyReply, auth: AuthBundle): string | null {
  const token = readSessionToken(request);
  const authenticated = token ? auth.session.authenticate(token) : null;
  if (!authenticated) {
    reply.code(401).send({ error: 'unauthenticated' });
    return null;
  }
  return authenticated.profileId;
}

export function registerProfileRoutes(app: FastifyInstance, auth: AuthBundle): void {
  app.get('/api/profile/settings', async (request, reply) => {
    const profileId = requireProfileId(request, reply, auth);
    if (profileId === null) {
      return;
    }

    const { settingsJson, settingsVersion } = auth.settings.read(profileId);
    reply.send({ settings: settingsJson, settingsVersion });
  });

  const originPreHandler = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    assertOrigin(request, reply, auth.config.publicUrl);
  };
  // Session is checked as its own preHandler (before CSRF) so a request with neither a
  // session nor a CSRF token surfaces the more specific 401 (unauthenticated), not a
  // generic 403 from the CSRF check. The resolved profileId rides on the request object
  // for the main handler to pick up.
  const sessionPreHandler = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const profileId = requireProfileId(request, reply, auth);
    if (profileId !== null) {
      (request as RequestWithProfileId).profileId = profileId;
    }
  };
  const csrfPreHandler = makeCsrfPreHandler(app);

  app.put(
    '/api/profile/settings',
    { preHandler: [originPreHandler, sessionPreHandler, csrfPreHandler] },
    async (request, reply) => {
      const profileId = (request as RequestWithProfileId).profileId;
      if (profileId === undefined) {
        return;
      }

      const body = request.body as { settingsJson?: unknown; settingsVersion?: unknown } | undefined;
      if (typeof body?.settingsJson !== 'string' || typeof body?.settingsVersion !== 'number') {
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

  if (auth.config.mailgun === null) {
    app.get('/api/dev/last-login-link', async (request, reply) => {
      const query = request.query as { email?: unknown };
      const email = typeof query.email === 'string' ? query.email : '';
      const link = auth.transport.lastLinkFor?.(normalizeEmail(email));

      if (!link) {
        reply.code(404).send({ error: 'not_found' });
        return;
      }

      reply.send({ link });
    });
  }
}
