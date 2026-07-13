import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileContentDirectory, ContentCompileError } from '../src/compiler/index.js';

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
  });

  it('rejects duplicates and unregistered behaviors', async () => {
    const root = await fixture({
      'a.yaml': 'schemaVersion: 1\nentries: [{kind: monster, id: monster.rat, name: Rat, glyph: r, color: "#aaaaaa", ai: ai.unknown, stats: {health: 4, attack: 2, defense: 0}}]\n',
      'b.yaml': 'schemaVersion: 1\nentries: [{kind: monster, id: monster.rat, name: Rat Two, glyph: R, color: "#bbbbbb", ai: ai.skittish, stats: {health: 5, attack: 2, defense: 0}}]\n',
    });
    await expect(compileContentDirectory({ rootDir: root, registries })).rejects.toBeInstanceOf(ContentCompileError);
  });
});
