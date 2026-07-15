import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const script = fileURLToPath(new URL('../../../scripts/merchant-demo.mjs', import.meta.url));
const reviewedHashesPath = fileURLToPath(new URL('./fixtures/merchant-demo-hashes.json', import.meta.url));

function runMerchantDemo(...arguments_: string[]) {
  return spawnSync(process.execPath, [script, ...arguments_], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
}

describe('travelling merchant demonstration CLI', () => {
  it('repeats reviewed hashes across separate processes and visibly proves every milestone outcome', () => {
    const first = runMerchantDemo('--verify');
    const second = runMerchantDemo('--verify');

    expect(first.status, first.stderr).toBe(0);
    expect(second.status, second.stderr).toBe(0);
    expect(first.stdout).toBe(second.stdout);
    expect(first.stdout).toContain('two forced eligible Lampwright merchant placements');
    expect(first.stdout).toMatch(/observable trade session[\s\S]*buy, sell, and identify at quoted prices/);
    expect(first.stdout).toMatch(/trade\.bought[\s\S]*trade\.sold[\s\S]*trade\.service-purchased/);
    expect(first.stdout).toMatch(/explicit close grants the one-time commerce delta[\s\S]*reputation\.changed/);
    expect(first.stdout).toMatch(/departure warnings crossed[\s\S]*merchant\.departure-warning/);
    expect(first.stdout).toMatch(/provokes, drops exact ceil-fraction stock[\s\S]*merchant\.stock-dropped/);
    expect(first.stdout).toMatch(/killing the provoked merchant[\s\S]*merchant\.died/);
    expect(first.stdout).toMatch(/same-faction merchant refuses trade[\s\S]*merchant\.refuses/);
    expect(first.stdout).toMatch(/off-floor departure without actor turns[\s\S]*merchant\.departed/);
    expect(first.stdout).toMatch(/split execution equivalent\ntrue/);
    expect(first.stdout).toMatch(
      /first process hashes\n(?:(?:saveHash|eventHash|projectionHash) [a-f0-9]{64}\n){3}/,
    );
    expect(first.stdout).toMatch(
      /second process hashes\n(?:(?:saveHash|eventHash|projectionHash) [a-f0-9]{64}\n){3}/,
    );
    expect(first.stdout).toContain('travelling merchant milestone verified\n');

    const reviewed = JSON.parse(readFileSync(reviewedHashesPath, 'utf8')) as Record<string, string>;
    for (const [label, value] of Object.entries(reviewed)) {
      expect(first.stdout).toContain(`${label} ${value}`);
    }
  });

  it('never prints hidden merchant scheduling state', () => {
    const result = runMerchantDemo('--verify');
    expect(result.status, result.stderr).toBe(0);
    for (const field of ['departureAt', 'rolledLifetime', 'initialStockItemIds', 'emittedWarningThresholds']) {
      expect(result.stdout).not.toContain(`"${field}"`);
    }
  });

  it('rejects a reviewed-hash mismatch when the content drifts', () => {
    const reviewed = JSON.parse(readFileSync(reviewedHashesPath, 'utf8')) as Record<string, string>;
    expect(Object.keys(reviewed).sort()).toEqual(['eventHash', 'projectionHash', 'saveHash']);
    for (const value of Object.values(reviewed)) expect(value).toMatch(/^[a-f0-9]{64}$/);

    const drifted = mkdtempSync(join(tmpdir(), 'merchant-demo-drift-'));
    try {
      cpSync(resolve(repositoryRoot, 'content'), drifted, { recursive: true });
      const lampOilPath = join(drifted, 'items', 'lamp-oil.yaml');
      writeFileSync(lampOilPath,
        readFileSync(lampOilPath, 'utf8').replace('name: Lamp oil', 'name: Drifted lamp oil'), 'utf8');
      const result = runMerchantDemo('--verify', '--content-dir', drifted);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('merchant demo failed: reviewed merchant demo hashes do not match');
    } finally {
      rmSync(drifted, { recursive: true, force: true });
    }
  });

  it('rejects unknown arguments without a stack trace', () => {
    const result = runMerchantDemo('--surprise');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('merchant demo failed: unknown argument --surprise');
    expect(result.stderr).not.toMatch(/\n\s+at /);
  });
});
