import fastifyCookie from '@fastify/cookie';
import fastifyCsrf from '@fastify/csrf-protection';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { CompiledContentPack } from '@woven-deep/content';
import { registerAuthRoutes, type AuthBundle } from './routes/auth.js';
import { registerProfileRoutes } from './routes/profile.js';
import { registerDevRoutes } from './routes/dev.js';
import { decorateProfileId } from './auth/http-guards.js';

function isReservedApiUrl(url: string): boolean {
  let pathname = new URL(url, 'http://localhost').pathname;
  try {
    for (;;) {
      const decoded = decodeURIComponent(pathname);
      if (decoded === pathname) break;
      pathname = decoded;
    }
  } catch {
    return true;
  }
  return pathname === '/api' || pathname.startsWith('/api/');
}

export function buildApp(input: {
  pack: CompiledContentPack;
  webDistDir?: string;
  auth?: AuthBundle;
}): FastifyInstance {
  const app = Fastify({ logger: false });
  app.get('/api/health', async () => ({
    status: 'ok' as const,
    contentHash: input.pack.hash,
    entries: input.pack.entries.length,
  }));
  app.get('/api/content/guest', async () => input.pack);
  if (input.auth) {
    const auth = input.auth;
    // Registration is queued (Fastify's encapsulation resolves the plugin tree on
    // ready/inject); registering routes synchronously right after is safe since they
    // don't touch csrfProtection/generateCsrf/cookies until a request is handled.
    void app.register(fastifyCookie, { secret: auth.config.cookieSecret });
    void app.register(fastifyCsrf, {
      getToken: (req) => req.headers['x-csrf-token'] as string | undefined,
    });
    decorateProfileId(app);
    registerAuthRoutes(app, auth);
    registerProfileRoutes(app, auth);
    // Dev mode mirrors the absence of a real mail transport: without Mailgun configured,
    // magic links are only ever delivered through this endpoint, so it must be reachable.
    const isDevMode = auth.config.mailgun === null;
    if (isDevMode) {
      registerDevRoutes(app, auth);
    }
  }
  if (input.webDistDir) {
    void app.register(fastifyStatic, { root: input.webDistDir, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !isReservedApiUrl(request.url)) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'not_found' });
    });
  }
  return app;
}
