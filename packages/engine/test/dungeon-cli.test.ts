import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const script = fileURLToPath(new URL('../../../scripts/dungeon-demo.mjs', import.meta.url));
const missingContent = fileURLToPath(new URL('./fixtures/missing-content', import.meta.url));
const reviewedHashesPath = new URL('./fixtures/dungeon-demo-hashes.json', import.meta.url);
const hashLinePattern =
  /^(floor-state|projection (?:absolute-darkness|low-ambient|overlapping-color|sealed-corner|remembered)) ([a-f0-9]{64})$/gm;

function run(...arguments_: string[]) {
  return spawnSync(process.execPath, [script, ...arguments_], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
}

describe('dungeon demo CLI', () => {
  it('demonstrates deterministic generated darkness, light, and memory', () => {
    const first = run('--verify');
    const second = run('--verify');

    expect(first.status, first.stderr).toBe(0);
    expect(second.status, second.stderr).toBe(0);
    expect(first.stdout).toMatch(
      /floor floor\.generated-01 80x25 generator 2\nseed (?:[a-f0-9]{8} ){3}[a-f0-9]{8} attempt (?:\d+|fallback)\nrooms [1-9]\d* corridors [1-9]\d* vault vault\.lampwright-cache\nstairs \d+,\d+ -> \d+,\d+ distance (?:2\d|[3-9]\d|[1-9]\d{2,})\nview absolute-darkness\n[\s\S]*view low-ambient\n[\s\S]*preview torch radius 3\n[\s\S]*preview torch radius 7\n[\s\S]*view overlapping-color\n[\s\S]*view sealed-corner\n[\s\S]*view remembered\n/,
    );
    for (const glyph of ['#', '.', '<', '>', '+', 'O']) expect(first.stdout).toContain(glyph);
    expect(first.stdout).toMatch(/[%,:;={}o]/);
    // eslint-disable-next-line no-control-regex -- intentionally matches the ANSI ESC (\x1b) control byte to assert the CLI emits no color-escape sequences.
    expect(first.stdout).not.toMatch(/\x1b\[/);
    expect(first.stdout).not.toMatch(/slot\.|random|rng/i);

    const reviewed = JSON.parse(readFileSync(reviewedHashesPath, 'utf8')) as Record<string, string>;
    const expectedHashLines = Object.entries(reviewed).map(([label, value]) => `${label} ${value}`);
    const firstHashLines = [...first.stdout.matchAll(hashLinePattern)].map((match) => match[0]);
    const secondHashLines = [...second.stdout.matchAll(hashLinePattern)].map((match) => match[0]);
    expect(firstHashLines.join('\n')).toBe(secondHashLines.join('\n'));
    expect(firstHashLines).toEqual(expectedHashLines);
    expect(secondHashLines).toEqual(expectedHashLines);
    expect(first.stdout).toContain('deterministic dungeon, visibility, and light verified\n');
    expect(second.stdout).toContain('deterministic dungeon, visibility, and light verified\n');
  });

  it('rejects unknown arguments without a stack trace', () => {
    const result = run('--verify', '--surprise');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('dungeon demo failed: unknown argument --surprise');
    expect(result.stderr).not.toMatch(/\n\s+at /);
  });

  it('rejects a missing content directory without a stack trace', () => {
    const result = run('--verify', '--content-dir', missingContent);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('dungeon demo failed:');
    expect(result.stderr).not.toMatch(/\n\s+at /);
  });

  it('rejects a missing content directory argument value', () => {
    const result = run('--verify', '--content-dir');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('dungeon demo failed: --content-dir requires a path');
    expect(result.stderr).not.toMatch(/\n\s+at /);
  });
});
