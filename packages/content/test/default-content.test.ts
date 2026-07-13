import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateCompiledContentPack } from '../src/index.js';
import { compileContentDirectory } from '../src/compiler/index.js';

describe('bundled content', () => {
  it('compiles foundational entries in stable identifier order', async () => {
    const pack = await compileContentDirectory({
      rootDir: resolve(import.meta.dirname, '../../../content'),
    });
    expect(pack.entries.map((entry) => entry.id)).toEqual([
      'balance.core-gameplay',
      'item.brass-lantern',
      'monster.cave-rat',
      'vault.lampwright-cache',
    ]);
    expect(pack.generationReport.foundationalCategories).toEqual(['light']);
    expect(validateCompiledContentPack(JSON.parse(JSON.stringify(pack)))).toEqual(pack);
    expect(pack.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
