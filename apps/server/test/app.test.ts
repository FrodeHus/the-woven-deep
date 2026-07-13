import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const pack = { schemaVersion: 1 as const, hash: 'b'.repeat(64), entries: [] };

describe('content API', () => {
  it('reports readiness and serves the guest pack', async () => {
    const app = buildApp({ pack });
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.json()).toEqual({ status: 'ok', contentHash: pack.hash, entries: 0 });
    const content = await app.inject({ method: 'GET', url: '/api/content/guest' });
    expect(content.json()).toEqual(pack);
    await app.close();
  });
});
