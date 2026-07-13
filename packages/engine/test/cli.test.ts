import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../../../scripts/engine-demo.mjs', import.meta.url));
const commands = fileURLToPath(new URL('../fixtures/demo.commands', import.meta.url));
const missingCommands = fileURLToPath(new URL('../fixtures/missing.commands', import.meta.url));

describe('engine demo CLI', () => {
  it('verifies deterministic replay across a real save and reload', () => {
    const result = spawnSync(process.execPath, [script, '--verify', commands], { encoding: 'utf8' });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('hero (2,1) turn 4 revision 4');
    expect(result.stdout).toMatch(/state [a-f0-9]{64}/);
    expect(result.stdout).toContain('invalid blocked.wall');
    expect(result.stdout).toContain('rejected stale_revision');
    expect(result.stdout).toContain('event hero.moved');
    expect(result.stdout).toContain('event action.invalid');
    expect(result.stdout).toContain('event hero.waited');
    expect(result.stdout).toContain('deterministic replay verified');
  });

  it('fails safely when the command file is missing', () => {
    const result = spawnSync(process.execPath, [script, '--verify', missingCommands], { encoding: 'utf8' });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('engine demo failed');
  });
});
