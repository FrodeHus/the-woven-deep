import fastifyCookie from '@fastify/cookie';
import fastifyCsrf from '@fastify/csrf-protection';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import type { CompiledContentPack } from '@woven-deep/content';
import { registerAuthRoutes, type AuthBundle } from './routes/auth.js';
import { registerProfileRoutes } from './routes/profile.js';
import { registerDevRoutes } from './routes/dev.js';
import { registerWsPlayRoute } from './routes/ws-play.js';
import { decorateProfileId } from './auth/http-guards.js';
import { ActiveRunRepository } from './db/active-run-repository.js';

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
  database?: Database.Database;
}): FastifyInstance {
  const app = Fastify({ logger: false });
  app.get('/api/health', () => ({
    status: 'ok' as const,
    contentHash: input.pack.hash,
    entries: input.pack.entries.length,
  }));
  app.get('/api/content/guest', () => input.pack);
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
    // The play WebSocket needs both auth (to authenticate the upgrade) and a database (to
    // persist the authoritative run) — tests that only exercise the HTTP auth/profile routes
    // build an `AuthBundle` without a database wired in here, so this stays additionally gated.
    if (input.database) {
      const repo = new ActiveRunRepository(input.database);
      void app.register(fastifyWebsocket);
      void app.register((instance, _opts, done) => {
        registerWsPlayRoute(instance, { auth, pack: input.pack, repo });
        done();
      });
    }
  }
  if (input.webDistDir) {
    void app.register(fastifyStatic, { root: input.webDistDir, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !isReservedApiUrl(request.url))
        return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'not_found' });
    });
  }
  return app;
}
