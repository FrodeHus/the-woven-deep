import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const script = fileURLToPath(new URL('../../../scripts/magic-demo.mjs', import.meta.url));
const reviewedHashesPath = fileURLToPath(
  new URL('./fixtures/magic-demo-hashes.json', import.meta.url),
);

function runMagicDemo(...arguments_: string[]) {
  return spawnSync(process.execPath, [script, '--verify', ...arguments_], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
}

describe('magic demonstration CLI', () => {
  it('repeats reviewed magic hashes across two Node processes and matches the checked-in fixture', () => {
    const first = runMagicDemo();
    const second = runMagicDemo();

    expect(first.status, first.stderr).toBe(0);
    expect(second.status, second.stderr).toBe(0);
    expect(first.stdout).toBe(second.stdout);
    expect(first.stdout).toContain('magic milestone verified');

    const reviewed = JSON.parse(readFileSync(reviewedHashesPath, 'utf8')) as Record<string, string>;
    expect(Object.keys(reviewed).sort()).toEqual(['eventHash', 'projectionHash', 'saveHash']);
    for (const [label, value] of Object.entries(reviewed)) {
      expect(value).toMatch(/^[a-f0-9]{64}$/);
      expect(first.stdout).toContain(`${label} ${value}`);
    }
  });

  it('rejects unknown arguments without a stack trace', () => {
    const result = runMagicDemo('--surprise');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('magic demo failed: unknown argument --surprise');
    expect(result.stderr).not.toMatch(/\n\s+at /);
  });
});
