import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyContentStartupGate } from '../../../scripts/content-startup-gate-runner.mjs';

function runtime(overrides: Partial<Parameters<typeof verifyContentStartupGate>[0]> = {}) {
  const calls: string[] = [];
  const implementation = {
    async startValid() { calls.push('start-valid'); },
    async assertReadOnly() { calls.push('assert-read-only'); },
    async smokeValid() {
      calls.push('smoke-valid');
      return { contentHash: 'a'.repeat(64), entries: 39 };
    },
    async stopValid() { calls.push('stop-valid'); },
    async snapshotPublications() {
      calls.push('snapshot-publications');
      return [{ hash: 'a'.repeat(64), schemaVersion: 3 }];
    },
    async runInvalid() {
      calls.push('run-invalid');
      return { exitCode: 1, output: 'Unsupported content schema version 2; expected 3' };
    },
    ...overrides,
  };
  return { calls, implementation };
}

describe('content startup integration gate orchestration', () => {
  it('publishes a repeatable root gate and a read-only compose content mount', async () => {
    const root = resolve(import.meta.dirname, '../../..');
    const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const compose = await readFile(resolve(root, 'compose.yaml'), 'utf8');
    expect(packageJson.scripts['content:startup-gate'])
      .toBe('node scripts/content-startup-gate.mjs');
    expect(compose).toContain('${CONTENT_SOURCE:-./content}:/app/content:ro');
  });

  it('checks a read-only valid startup before proving invalid content is not published', async () => {
    const fake = runtime();
    await expect(verifyContentStartupGate(fake.implementation)).resolves.toEqual({
      contentHash: 'a'.repeat(64),
      entries: 39,
      publications: 1,
    });
    expect(fake.calls).toEqual([
      'start-valid', 'assert-read-only', 'smoke-valid', 'stop-valid',
      'snapshot-publications', 'run-invalid', 'snapshot-publications',
    ]);
  });

  it('fails when the invalid schema starts', async () => {
    const fake = runtime({ runInvalid: async () => ({ exitCode: 0, output: '' }) });
    await expect(verifyContentStartupGate(fake.implementation))
      .rejects.toThrow('invalid content pack unexpectedly started');
  });

  it('fails when rejected content changes immutable publication', async () => {
    let snapshots = 0;
    const fake = runtime({
      snapshotPublications: async () => snapshots++ === 0
        ? [{ hash: 'a'.repeat(64), schemaVersion: 3 }]
        : [
            { hash: 'a'.repeat(64), schemaVersion: 3 },
            { hash: 'b'.repeat(64), schemaVersion: 3 },
          ],
    });
    await expect(verifyContentStartupGate(fake.implementation))
      .rejects.toThrow('rejected content changed published packs');
  });
});
