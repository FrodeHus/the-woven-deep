import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const script = fileURLToPath(new URL('../../../scripts/population-demo.mjs', import.meta.url));

function runPopulationDemo(...arguments_: string[]) {
  return spawnSync(process.execPath, [script, '--verify', ...arguments_], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
}

describe('population encounter demonstration CLI', () => {
  it('repeats reviewed hashes and visibly proves every milestone outcome', () => {
    const first = runPopulationDemo();
    const second = runPopulationDemo();

    expect(first.status, first.stderr).toBe(0);
    expect(second.status, second.stderr).toBe(0);
    expect(first.stdout).toBe(second.stdout);
    expect(first.stdout).toMatch(/relay-limited leader group[\s\S]*leader outcome/);
    expect(first.stdout).toMatch(/capped visible swarm source[\s\S]*phased boss and unique reward/);
    expect(first.stdout).toMatch(/Deep's Champion[\s\S]*heirloom[\s\S]*Echo of /);
    expect(first.stdout).toContain('normal production gate rejected; forced optional arena placed; required route remains passable');
    expect(first.stdout).toMatch(/ordinary loot[\s\S]*split execution equivalent/);
    expect(first.stdout).toMatch(/stable hashes\n(?:[^\n]+ [a-f0-9]{64}\n)+/);
    expect(first.stdout).toContain('population encounter milestone verified\n');
  });

  it('rejects unknown arguments without a stack trace', () => {
    const result = runPopulationDemo('--surprise');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('population demo failed: unknown argument --surprise');
    expect(result.stderr).not.toMatch(/\n\s+at /);
  });
});
