import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const script = fileURLToPath(new URL('../../../scripts/gameplay-demo.mjs', import.meta.url));

function runGameplayDemo(...arguments_: string[]) {
  return spawnSync(process.execPath, [script, '--verify', ...arguments_], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
}

describe('gameplay demonstration CLI', () => {
  it('repeats reviewed gameplay hashes across two Node processes', () => {
    const first = runGameplayDemo();
    const second = runGameplayDemo();

    expect(first.status, first.stderr).toBe(0);
    expect(second.status, second.stderr).toBe(0);
    expect(first.stdout).toBe(second.stdout);
    expect(first.stdout).toMatch(/movement and reactions\n[\s\S]*combat\n[\s\S]*items and identity\n/);
    expect(first.stdout).toMatch(/survival and features\n[\s\S]*public projection\n[\s\S]*stable hashes\n/);
    expect(first.stdout).toContain('deterministic core gameplay replay verified\n');
  });

  it('rejects unknown arguments without a stack trace', () => {
    const result = runGameplayDemo('--surprise');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('gameplay demo failed: unknown argument --surprise');
    expect(result.stderr).not.toMatch(/\n\s+at /);
  });
});
