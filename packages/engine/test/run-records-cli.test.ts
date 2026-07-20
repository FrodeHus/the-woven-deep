import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const script = fileURLToPath(new URL('../../../scripts/run-records-demo.mjs', import.meta.url));
const reviewedHashesPath = fileURLToPath(
  new URL('./fixtures/run-records-demo-hashes.json', import.meta.url),
);

function runDemo(...arguments_: string[]) {
  return spawnSync(process.execPath, [script, ...arguments_], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
}

describe('run records demonstration CLI', () => {
  it('repeats reviewed hashes across separate processes and visibly proves every milestone outcome', () => {
    const first = runDemo('--verify');
    const second = runDemo('--verify');

    expect(first.status, first.stderr).toBe(0);
    expect(second.status, second.stderr).toBe(0);
    expect(first.stdout).toBe(second.stdout);
    expect(first.stdout).toMatch(
      /leader group felled by a production attack[\s\S]*group\.leader-defeated/,
    );
    expect(first.stdout).toMatch(
      /swarm contained by destroying its source[\s\S]*swarm\.source-destroyed/,
    );
    expect(first.stdout).toMatch(
      /rare boss encountered and phase-changed[\s\S]*boss\.phase-changed/,
    );
    expect(first.stdout).toMatch(/travelling merchant trade session[\s\S]*merchantPopulationId/);
    expect(first.stdout).toMatch(
      /merchant provoked by a production attack[\s\S]*merchant\.provoked/,
    );
    expect(first.stdout).toMatch(/hero dies with a credited killer[\s\S]*run\.concluded/);
    expect(first.stdout).toMatch(/finalized exactly once[\s\S]*run\.finalized/);
    expect(first.stdout).toMatch(/itemized score breakdown and total[\s\S]*"total"/);
    expect(first.stdout).toMatch(/metrics snapshot[\s\S]*"deepestDepth"/);
    expect(first.stdout).toMatch(/heirloom snapshot[\s\S]*"sourceItemId"/);
    expect(first.stdout).toMatch(/granted achievements/);
    expect(first.stdout).toMatch(/hall record id\nrecord\./);
    expect(first.stdout).toMatch(/ranked standings[\s\S]*"rank":1/);
    expect(first.stdout).toMatch(/heart lineage\nnull/);
    expect(first.stdout).toMatch(/split execution equivalent\ntrue/);
    expect(first.stdout).toMatch(
      /first process hashes\n(?:(?:saveHash|eventHash|projectionHash|recordHash) [a-f0-9]{64}\n){4}/,
    );
    expect(first.stdout).toMatch(
      /second process hashes\n(?:(?:saveHash|eventHash|projectionHash|recordHash) [a-f0-9]{64}\n){4}/,
    );
    expect(first.stdout).toContain('run records milestone verified\n');

    const reviewed = JSON.parse(readFileSync(reviewedHashesPath, 'utf8')) as Record<string, string>;
    expect(Object.keys(reviewed).sort()).toEqual([
      'eventHash',
      'projectionHash',
      'recordHash',
      'saveHash',
    ]);
    for (const [label, value] of Object.entries(reviewed)) {
      expect(value).toMatch(/^[a-f0-9]{64}$/);
      expect(first.stdout).toContain(`${label} ${value}`);
    }
  });

  it('never prints hidden run-records or scheduling state', () => {
    const result = runDemo('--verify');
    expect(result.status, result.stderr).toBe(0);
    for (const field of [
      'fallenHeroDecisions',
      'encounterDecisions',
      'concludedAtRevision',
      'run-records',
      'departureAt',
      'rolledLifetime',
    ]) {
      expect(result.stdout).not.toContain(`"${field}"`);
    }
  });

  it('rejects a reviewed-hash mismatch when the content drifts', () => {
    const drifted = mkdtempSync(join(tmpdir(), 'run-records-demo-drift-'));
    try {
      cpSync(resolve(repositoryRoot, 'content'), drifted, { recursive: true });
      const lampOilPath = join(drifted, 'items', 'lamp-oil.yaml');
      writeFileSync(
        lampOilPath,
        readFileSync(lampOilPath, 'utf8').replace('name: Lamp oil', 'name: Drifted lamp oil'),
        'utf8',
      );
      const result = runDemo('--verify', '--content-dir', drifted);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        'run records demo failed: reviewed run records demo hashes do not match',
      );
    } finally {
      rmSync(drifted, { recursive: true, force: true });
    }
  });

  it('rejects unknown arguments without a stack trace', () => {
    const result = runDemo('--surprise');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('run records demo failed: unknown argument --surprise');
    expect(result.stderr).not.toMatch(/\n\s+at /);
  });
});
