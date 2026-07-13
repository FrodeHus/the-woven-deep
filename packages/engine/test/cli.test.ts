import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../../../scripts/engine-demo.mjs', import.meta.url));
const commands = fileURLToPath(new URL('../fixtures/demo.commands', import.meta.url));
const divergentCommands = fileURLToPath(new URL('../fixtures/demo.divergent.commands', import.meta.url));
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

  it('fails safely when the uninterrupted comparison diverges', () => {
    const result = spawnSync(process.execPath, [script, '--verify', commands, divergentCommands], { encoding: 'utf8' });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('engine demo failed: deterministic replay diverged');
  });

  it.each([
    ['unknown directive', '\nteleport\n', 'line 2: unknown directive teleport'],
    ['unsafe revision', '\n\nwait command.bad 9007199254740992\n', 'line 3: revision must be a non-negative safe integer'],
  ])('reports the line number for an %s', async (_label, source, summary) => {
    const directory = await mkdtemp(join(tmpdir(), 'engine-demo-'));
    const path = join(directory, 'commands.txt');
    try {
      await writeFile(path, source, 'utf8');
      const result = spawnSync(process.execPath, [script, '--verify', path], { encoding: 'utf8' });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(`engine demo failed: ${summary}`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
