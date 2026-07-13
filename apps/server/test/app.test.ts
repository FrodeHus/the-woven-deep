import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('serves the client without shadowing API routes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'woven-web-'));
    await writeFile(join(root, 'index.html'), '<div id="root"></div>');
    const app = buildApp({ pack, webDistDir: root });
    expect((await app.inject({ method: 'GET', url: '/adventure' })).body).toContain('id="root"');
    expect((await app.inject({ method: 'GET', url: '/api/missing' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/health' })).json()).toMatchObject({ status: 'ok' });
    await app.close();
  });
});
