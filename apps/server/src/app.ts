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

/**
 * `permessage-deflate` for `/ws/play`. Off by default in `ws` because it costs CPU and memory, but
 * a command reply on a dungeon floor is dominated by `floor.cells` -- thousands of near-identical
 * cell objects -- which deflate collapses dramatically. Measured against the real content pack on a
 * depth-1 reply (526,923 B raw), single message, no window carried between messages:
 *
 *   level 1 -> 49,328 B (10.7x, 0.43 ms)   level 3 -> 35,276 B (14.9x, 0.51 ms)
 *   level 6 -> 31,674 B (16.6x, 2.39 ms)   level 9 -> 31,644 B (16.7x, 12.38 ms)
 *
 * Level 3 is the knee: 93% of level 6's ratio for 21% of its CPU, and level 9 buys nothing at all
 * for 24x the cost of level 3. Compression happens on the event loop, so the per-message cost is
 * paid against every other connection's latency -- the cheap-and-nearly-as-good point is the right
 * one here, not the best ratio.
 *
 * Context takeover (retaining the zlib window across messages) is DISABLED in both directions. It
 * would improve the ratio for successive similar replies, but costs a few hundred KB of retained
 * window per connection per direction, and the measured win above is already intra-message -- the
 * redundancy is inside a single reply, not between replies. Bounded memory per connection is worth
 * more here than the remainder.
 */
const PER_MESSAGE_DEFLATE = {
  zlibDeflateOptions: { level: 3 },
  // Below roughly a MTU there is nothing to win, and deflate would still cost a zlib round trip.
  threshold: 1024,
  clientNoContextTakeover: true,
  serverNoContextTakeover: true,
} as const;

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
    registerAuthRoutes(app, auth, input.database);
    registerProfileRoutes(app, auth, input.database);
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
      void app.register(fastifyWebsocket, { options: { perMessageDeflate: PER_MESSAGE_DEFLATE } });
      const database = input.database;
      void app.register((instance, _opts, done) => {
        registerWsPlayRoute(instance, { auth, pack: input.pack, repo, database });
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
