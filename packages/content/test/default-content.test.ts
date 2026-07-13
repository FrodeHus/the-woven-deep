import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileContentDirectory } from '../src/compiler/index.js';

describe('bundled content', () => {
  it('compiles foundational monster and light entries', async () => {
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
    ]);
  });
});
