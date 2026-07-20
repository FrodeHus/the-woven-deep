import type { FastifyInstance } from 'fastify';
import type { AuthBundle } from './auth.js';
import { normalizeEmail } from '../auth/email.js';

/**
 * Registers development-only endpoints that expose internal state directly over HTTP. Callers
 * must only invoke this when running in dev mode; there is no guard inside the route handlers
 * themselves.
 */
export function registerDevRoutes(app: FastifyInstance, auth: AuthBundle): void {
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
