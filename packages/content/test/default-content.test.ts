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
      'condition.disengaged',
      'condition.incapacitated',
      'condition.reaction-suppressed',
      'condition.restless',
      'item.brass-lantern',
      'monster.cave-rat',
      'vault.lampwright-cache',
    ]);
    expect(pack.generationReport.foundationalCategories).toEqual(['light']);
    expect(validateCompiledContentPack(JSON.parse(JSON.stringify(pack)))).toEqual(pack);
    expect(pack.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('revalidates condition references in a stored compiled pack', async () => {
    const pack = await compileContentDirectory({
      rootDir: resolve(import.meta.dirname, '../../../content'),
    });
    const corrupted = structuredClone(pack) as any;
    const lantern = corrupted.entries.find((entry: any) => entry.id === 'item.brass-lantern');
    lantern.effects = [{
      effectId: 'effect.condition.apply',
      parameters: { conditionId: 'condition.missing' },
      requiresLivingTarget: true,
    }];
    expect(() => validateCompiledContentPack(corrupted)).toThrow(/unknown condition reference condition\.missing/i);
  });
});
