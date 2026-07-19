import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SessionService } from './session-service.js';

declare module 'fastify' {
  interface FastifyRequest {
    profileId?: string;
  }
}

const SESSION_COOKIE_NAME = 'wd_session';

/**
 * Adds the typed `profileId` property to the Fastify request prototype so `requireSession`
 * can populate it and downstream handlers can read it as a typed field.
 */
export function decorateProfileId(app: FastifyInstance): void {
  app.decorateRequest('profileId', undefined);
}

/**
 * Compares the request's Origin (falling back to the Referer's origin) against the
 * configured publicUrl's origin. On mismatch (or missing) it replies 403.
 */
export function requireOrigin(
  publicUrl: string,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const expectedOrigin = new URL(publicUrl).origin;

  return async (request, reply) => {
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
    }
  };
}

/**
 * Reads and unsigns the `wd_session` cookie.
 */
export function readSessionToken(request: FastifyRequest): string | null {
  const raw = (request.cookies as Record<string, string | undefined>)[SESSION_COOKIE_NAME];
  if (!raw) {
    return null;
  }
  const unsigned = request.unsignCookie(raw);
  return unsigned.valid ? unsigned.value : null;
}

/**
 * Authenticates the `wd_session` cookie and stashes the resolved profile id on
 * `request.profileId`. Replies 401 with `{ error: 'unauthenticated' }` when there is
 * no valid session.
 */
export function requireSession(
  session: SessionService,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request, reply) => {
    const token = readSessionToken(request);
    const authenticated = token ? session.authenticate(token) : null;
    if (!authenticated) {
      reply.code(401).send({ error: 'unauthenticated' });
      return;
    }
    request.profileId = authenticated.profileId;
  };
}

/**
 * Builds the deferred `app.csrfProtection` preHandler. `@fastify/csrf-protection`
 * decorates `app.csrfProtection` asynchronously when it's registered with
 * `void app.register(...)`, so it isn't available yet at route-registration time.
 * Wrapping the lookup in a closure defers it until a route actually handles a
 * request, by which point Fastify has resolved the plugin tree.
 */
export function requireCsrf(
  app: FastifyInstance,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request, reply) => {
    await app.csrfProtection(request, reply, () => undefined);
  };
}

export { SESSION_COOKIE_NAME };
