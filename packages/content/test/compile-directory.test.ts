import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compileContentDirectory,
  ContentCompileError,
  type ContentCompileIssue,
} from '../src/compiler/index.js';

const registries = {
  ai: new Set(['ai.skittish']),
  effects: new Set(['effect.light-source']),
};

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'woven-content-'));
  for (const [path, source] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, source);
  }
  return root;
}

async function expectCompileIssues(
  compilation: Promise<unknown>,
  expected: readonly ContentCompileIssue[],
): Promise<void> {
  let caught: unknown;
  try {
    await compilation;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ContentCompileError);
  expect((caught as ContentCompileError).issues).toEqual(expected);
}

describe('compileContentDirectory', () => {
  it('produces the same hash regardless of YAML formatting and filenames', async () => {
    const compact = await fixture({
      'z.yaml': 'schemaVersion: 1\nentries: [{kind: monster, id: monster.rat, name: Rat, glyph: r, color: "#aaaaaa", ai: ai.skittish, stats: {health: 4, attack: 2, defense: 0}}, {kind: item, id: item.lantern, name: Lantern, glyph: "¤", color: "#eeeeaa", effect: effect.light-source, price: 4}]\n',
    });
    const expanded = await fixture({
      'nested/a.yml': 'schemaVersion: 1\nentries:\n  - kind: monster\n    id: monster.rat\n    name: Rat\n    glyph: r\n    color: "#aaaaaa"\n    ai: ai.skittish\n    stats:\n      health: 4\n      attack: 2\n      defense: 0\n  - kind: item\n    id: item.lantern\n    name: Lantern\n    glyph: "¤"\n    color: "#eeeeaa"\n    effect: effect.light-source\n    price: 4\n',
    });

    const left = await compileContentDirectory({ rootDir: compact, registries });
    const right = await compileContentDirectory({ rootDir: expanded, registries });
    expect(left.hash).toBe(right.hash);
    expect(left.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects duplicate IDs in code-unit path order', async () => {
    const root = await fixture({
      'z.yaml': 'schemaVersion: 1\nentries: [{kind: monster, id: monster.rat, name: Rat, glyph: r, color: "#aaaaaa", ai: ai.skittish, stats: {health: 4, attack: 2, defense: 0}}, {kind: item, id: item.lantern, name: Lantern, glyph: "¤", color: "#eeeeaa", effect: effect.light-source, price: 4}]\n',
      'ä.yaml': 'schemaVersion: 1\nentries: [{kind: monster, id: monster.rat, name: Rat Two, glyph: R, color: "#bbbbbb", ai: ai.skittish, stats: {health: 5, attack: 2, defense: 0}}]\n',
    });

    await expectCompileIssues(
      compileContentDirectory({ rootDir: root, registries }),
      [{
        file: 'ä.yaml',
        path: '$.entries.id',
        message: 'duplicate monster.rat; first declared in z.yaml',
      }],
    );
  });

  it('rejects an unregistered behavior reference', async () => {
    const root = await fixture({
      'content.yaml': 'schemaVersion: 1\nentries: [{kind: monster, id: monster.rat, name: Rat, glyph: r, color: "#aaaaaa", ai: ai.unknown, stats: {health: 4, attack: 2, defense: 0}}, {kind: item, id: item.lantern, name: Lantern, glyph: "¤", color: "#eeeeaa", effect: effect.light-source, price: 4}]\n',
    });

    await expectCompileIssues(
      compileContentDirectory({ rootDir: root, registries }),
      [{
        file: 'content.yaml',
        path: '$.entries.monster.rat.ai',
        message: 'unregistered AI ai.unknown',
      }],
    );
  });

  it('rejects every invalid registry key before compiling files', async () => {
    const root = await fixture({ 'invalid.yaml': ': invalid YAML' });
    const invalidRegistries = {
      ai: new Set(['skittish', 'effect.wrong']),
      effects: new Set(['light-source', 'ai.wrong']),
    };

    await expectCompileIssues(
      compileContentDirectory({ rootDir: root, registries: invalidRegistries }),
      [
        {
          file: root,
          path: '$.registries.ai',
          message: 'invalid AI registry key effect.wrong; expected ai.* namespaced ID',
        },
        {
          file: root,
          path: '$.registries.ai',
          message: 'invalid AI registry key skittish; expected ai.* namespaced ID',
        },
        {
          file: root,
          path: '$.registries.effects',
          message: 'invalid effect registry key ai.wrong; expected effect.* namespaced ID',
        },
        {
          file: root,
          path: '$.registries.effects',
          message: 'invalid effect registry key light-source; expected effect.* namespaced ID',
        },
      ],
    );
  });

  it('rejects content missing a foundational kind', async () => {
    const root = await fixture({
      'monster.yaml': 'schemaVersion: 1\nentries: [{kind: monster, id: monster.rat, name: Rat, glyph: r, color: "#aaaaaa", ai: ai.skittish, stats: {health: 4, attack: 2, defense: 0}}]\n',
    });

    await expectCompileIssues(
      compileContentDirectory({ rootDir: root, registries }),
      [{
        file: root,
        path: '$.entries',
        message: 'missing foundational item content',
      }],
    );
  });
});
