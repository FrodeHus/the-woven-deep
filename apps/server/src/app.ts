import Fastify, { type FastifyInstance } from 'fastify';
import type { CompiledContentPack } from '@woven-deep/content';

export function buildApp(input: { pack: CompiledContentPack }): FastifyInstance {
  const app = Fastify({ logger: false });
  app.get('/api/health', async () => ({
    status: 'ok' as const,
    contentHash: input.pack.hash,
    entries: input.pack.entries.length,
  }));
  app.get('/api/content/guest', async () => input.pack);
  return app;
}
