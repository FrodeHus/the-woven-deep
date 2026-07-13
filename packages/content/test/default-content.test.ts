import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileContentDirectory } from '../src/compiler/index.js';

describe('bundled content', () => {
  it('compiles foundational entries in stable identifier order', async () => {
    const pack = await compileContentDirectory({
      rootDir: resolve(import.meta.dirname, '../../../content'),
      registries: {
        ai: new Set(['ai.skittish']),
        effects: new Set(['effect.light-source']),
      },
    });
    expect(pack.entries.map((entry) => entry.id)).toEqual([
      'item.brass-lantern',
      'monster.cave-rat',
      'vault.lampwright-cache',
    ]);
    expect(pack.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
