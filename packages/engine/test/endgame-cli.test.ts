import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const script = fileURLToPath(new URL('../../../scripts/endgame-demo.mjs', import.meta.url));

function runEndgameDemo(...arguments_: string[]) {
  return spawnSync(process.execPath, [script, ...arguments_], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
}

describe('endgame demonstration CLI', () => {
  it('verifies the reviewed hashes and proves each Final Chamber ending', () => {
    const result = runEndgameDemo('--verify');

    expect(result.status, result.stderr).toBe(0);
    // The three completion types producible only at the Final Chamber, each reached through it.
    expect(result.stdout).toContain('ending broke-cycle -> completion broke-cycle');
    expect(result.stdout).toContain('ending became-heart -> completion became-heart');
    expect(result.stdout).toContain('ending refused -> completion refused');
    // The demo re-derives the hashes in a second process and prints both blocks identically.
    const firstBlock = result.stdout.indexOf('first process hashes\n');
    const secondBlock = result.stdout.indexOf('second process hashes\n');
    expect(firstBlock).toBeGreaterThanOrEqual(0);
    expect(secondBlock).toBeGreaterThan(firstBlock);
    expect(result.stdout).toContain('endgame milestone verified\n');
  });

  it('rejects unknown arguments without a stack trace', () => {
    const result = runEndgameDemo('--surprise');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('endgame demo failed: unknown argument --surprise');
    expect(result.stderr).not.toMatch(/\n\s+at /);
  });
});
