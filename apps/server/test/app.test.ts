import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const pack = {
  schemaVersion: 2 as const,
  hash: 'b'.repeat(64),
  entries: [],
  generationReport: { foundationalCategories: [] },
};

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

  it.each(['/api', '/api?x=1', '/api%2Fmissing'])('does not serve the SPA for reserved API URL %s', async (url) => {
    const root = await mkdtemp(join(tmpdir(), 'woven-web-'));
    await writeFile(join(root, 'index.html'), '<div id="root"></div>');
    const app = buildApp({ pack, webDistDir: root });
    const response = await app.inject({ method: 'GET', url });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found' });
    await app.close();
  });

  it('rejects malformed URL encoding without serving the SPA', async () => {
    const root = await mkdtemp(join(tmpdir(), 'woven-web-'));
    await writeFile(join(root, 'index.html'), '<div id="root"></div>');
    const app = buildApp({ pack, webDistDir: root });
    const response = await app.inject({ method: 'GET', url: '/api%' });
    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain('application/json');
    await app.close();
  });
});
