import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { CompiledContentPack } from '@woven-deep/content';

export function buildApp(input: {
  pack: CompiledContentPack;
  webDistDir?: string;
}): FastifyInstance {
  const app = Fastify({ logger: false });
  app.get('/api/health', async () => ({
    status: 'ok' as const,
    contentHash: input.pack.hash,
    entries: input.pack.entries.length,
  }));
  app.get('/api/content/guest', async () => input.pack);
  if (input.webDistDir) {
    void app.register(fastifyStatic, { root: input.webDistDir, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'not_found' });
    });
  }
  return app;
}
