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

const compactVault = '{kind: vault, id: vault.test-room, name: Test room, tags: [test], minDepth: 1, maxDepth: 5, rarity: common, weight: 10, maxPerFloor: 1, margin: 1, transforms: {rotations: [0, 180], reflectHorizontal: true}, layout: ["#####", "#+m.#", "#####"], legend: {"#": {terrain: wall}, ".": {terrain: floor}, "+": {terrain: floor, entrance: true}, m: {terrain: floor, slot: {id: monster-main, kind: monster, required: true, tags: [guard]}}}}';

const compactMonster = '{kind: monster, id: monster.rat, name: Rat, glyph: r, color: "#aaaaaa", ai: ai.skittish, stats: {health: 4, attack: 2, defense: 0}}';
const compactItem = '{kind: item, id: item.lantern, name: Lantern, glyph: "¤", color: "#eeeeaa", effect: effect.light-source, price: 4}';

function contentFile(...entries: readonly string[]): string {
  return `schemaVersion: 1\nentries: [${entries.join(', ')}]\n`;
}

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
      'z.yaml': contentFile(compactMonster, compactItem, compactVault),
    });
    const expanded = await fixture({
      'nested/a.yml': 'schemaVersion: 1\nentries:\n  - kind: monster\n    id: monster.rat\n    name: Rat\n    glyph: r\n    color: "#aaaaaa"\n    ai: ai.skittish\n    stats:\n      health: 4\n      attack: 2\n      defense: 0\n  - kind: item\n    id: item.lantern\n    name: Lantern\n    glyph: "¤"\n    color: "#eeeeaa"\n    effect: effect.light-source\n    price: 4\n',
      'vaults/test.yaml': contentFile(compactVault),
    });

    const left = await compileContentDirectory({ rootDir: compact, registries });
    const right = await compileContentDirectory({ rootDir: expanded, registries });
    expect(left.hash).toBe(right.hash);
    expect(left.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects duplicate IDs in code-unit path order', async () => {
    const root = await fixture({
      'z.yaml': contentFile(compactMonster, compactItem, compactVault),
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
      'content.yaml': contentFile(
        '{kind: monster, id: monster.rat, name: Rat, glyph: r, color: "#aaaaaa", ai: ai.unknown, stats: {health: 4, attack: 2, defense: 0}}',
        compactItem,
        compactVault,
      ),
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

  it('rejects content missing foundational item content', async () => {
    const root = await fixture({
      'content.yaml': contentFile(compactMonster, compactVault),
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

  it('rejects content missing foundational monster content', async () => {
    const root = await fixture({ 'content.yaml': contentFile(compactItem, compactVault) });

    await expectCompileIssues(compileContentDirectory({ rootDir: root, registries }), [{
      file: root,
      path: '$.entries',
      message: 'missing foundational monster content',
    }]);
  });

  it('rejects content missing foundational vault content', async () => {
    const root = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem) });

    await expectCompileIssues(compileContentDirectory({ rootDir: root, registries }), [{
      file: root,
      path: '$.entries',
      message: 'missing foundational vault content',
    }]);
  });

  it.each([
    ['minimum depth', compactVault.replace('minDepth: 1', 'minDepth: 0')],
    ['fractional depth', compactVault.replace('minDepth: 1', 'minDepth: 1.5')],
    ['unsafe depth', compactVault.replace('maxDepth: 5', `maxDepth: ${Number.MAX_SAFE_INTEGER + 1}`)],
    ['depth range', compactVault.replace('minDepth: 1, maxDepth: 5', 'minDepth: 2, maxDepth: 1')],
    ['rarity', compactVault.replace('rarity: common', 'rarity: mythical')],
    ['weight', compactVault.replace('weight: 10', 'weight: 0')],
    ['fractional weight', compactVault.replace('weight: 10', 'weight: 1.5')],
    ['unsafe weight', compactVault.replace('weight: 10', `weight: ${Number.MAX_SAFE_INTEGER + 1}`)],
    ['margin', compactVault.replace('margin: 1', 'margin: -1')],
    ['fractional margin', compactVault.replace('margin: 1', 'margin: 0.5')],
    ['unsafe margin', compactVault.replace('margin: 1', `margin: ${Number.MAX_SAFE_INTEGER + 1}`)],
    ['placement limit', compactVault.replace('maxPerFloor: 1', 'maxPerFloor: 0')],
    ['fractional placement limit', compactVault.replace('maxPerFloor: 1', 'maxPerFloor: 1.5')],
    ['unsafe placement limit', compactVault.replace('maxPerFloor: 1', `maxPerFloor: ${Number.MAX_SAFE_INTEGER + 1}`)],
    ['placement values', compactVault.replace('required: true', 'required: later')],
    ['light radius', compactVault.replace('slot: {id: monster-main, kind: monster, required: true, tags: [guard]}', 'light: {idSuffix: amber, glyph: "*", presentationToken: fixture.lamp, color: [255, 180, 64], radius: 0, strength: 180}')],
    ['light color', compactVault.replace('slot: {id: monster-main, kind: monster, required: true, tags: [guard]}', 'light: {idSuffix: amber, glyph: "*", presentationToken: fixture.lamp, color: [256, 180, 64], radius: 6, strength: 180}')],
    ['light strength', compactVault.replace('slot: {id: monster-main, kind: monster, required: true, tags: [guard]}', 'light: {idSuffix: amber, glyph: "*", presentationToken: fixture.lamp, color: [255, 180, 64], radius: 6, strength: 256}')],
    ['duplicate rotations', compactVault.replace('[0, 180]', '[0, 0]')],
    ['unsorted rotations', compactVault.replace('[0, 180]', '[180, 0]')],
    ['multi-code-point legend key', compactVault.replace('legend: {', 'legend: {xy: {terrain: floor}, ')],
    ['duplicate fixture suffix', compactVault
      .replace('"#+m.#"', '"#+mm#"')
      .replace('slot: {id: monster-main, kind: monster, required: true, tags: [guard]}', 'light: {idSuffix: amber, glyph: "*", presentationToken: fixture.lamp, color: [255, 180, 64], radius: 6, strength: 180}')],
    ['declared-width overflow', compactVault.replace('["#####", "#+m.#", "#####"]', `["+${'.'.repeat(160)}"]`).replace('legend: {"#": {terrain: wall}, ', 'legend: {')],
    ['declared-height overflow', compactVault
      .replace('["#####", "#+m.#", "#####"]', `[${Array.from({ length: 101 }, () => '"+"').join(', ')}]`)
      .replace('legend: {"#": {terrain: wall}, ".": {terrain: floor}, ', 'legend: {')
      .replace(', m: {terrain: floor, slot: {id: monster-main, kind: monster, required: true, tags: [guard]}}', '')],
  ])('rejects invalid vault %s', async (_name, invalidVault) => {
    const root = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem, invalidVault) });
    await expect(compileContentDirectory({ rootDir: root, registries })).rejects.toBeInstanceOf(ContentCompileError);
  });

  it('includes vault IDs and values in global uniqueness and content hashing', async () => {
    const duplicateRoot = await fixture({
      'a.yaml': contentFile(compactMonster, compactItem, compactVault),
      'b.yaml': contentFile(compactVault),
    });
    await expect(compileContentDirectory({ rootDir: duplicateRoot, registries })).rejects.toThrow(/duplicate vault\.test-room/);

    const changedRoot = await fixture({
      'content.yaml': contentFile(compactMonster, compactItem, compactVault.replace('weight: 10', 'weight: 11')),
    });
    const originalRoot = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem, compactVault) });
    const [changed, original] = await Promise.all([
      compileContentDirectory({ rootDir: changedRoot, registries }),
      compileContentDirectory({ rootDir: originalRoot, registries }),
    ]);
    expect(changed.hash).not.toBe(original.hash);
  });

  it('aborts between content discovery and file processing boundaries', async () => {
    const root = await fixture({
      'a.yaml': 'schemaVersion: 1\nentries: [{kind: monster, id: monster.rat, name: Rat, glyph: r, color: "#aaaaaa", ai: ai.skittish, stats: {health: 4, attack: 2, defense: 0}}]\n',
      'b.yaml': contentFile(compactItem, compactVault),
    });
    const controller = new AbortController();
    const nativeThrow = controller.signal.throwIfAborted.bind(controller.signal);
    let boundaries = 0;
    controller.signal.throwIfAborted = () => {
      boundaries += 1;
      if (boundaries === 10) controller.abort();
      nativeThrow();
    };

    await expect(
      compileContentDirectory({ rootDir: root, registries, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(boundaries).toBe(10);
  });
});
