import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateCompiledContentPack } from '../src/index.js';
import { compileContentDirectory } from '../src/compiler/index.js';

describe('bundled content', () => {
  it('contains every core gameplay kind and one balance entry', async () => {
    const pack = await compileContentDirectory({
      rootDir: resolve(import.meta.dirname, '../../../content'),
    });
    const kinds = ['monster', 'item', 'spell', 'trap', 'loot-table', 'balance', 'vault', 'identification-pool'] as const;
    expect(Object.fromEntries(kinds.map((kind) => [kind,
      pack.entries.filter((entry) => entry.kind === kind).length]))).toEqual({
      monster: 2, item: 13, spell: 1, trap: 1, 'loot-table': 1, balance: 1, vault: 1,
      'identification-pool': 2,
    });
    expect(pack.entries.filter((entry) => entry.kind === 'condition')).toHaveLength(4);
    expect(pack.entries.map((entry) => entry.id)).toEqual([...pack.entries.map((entry) => entry.id)].sort());
    expect(validateCompiledContentPack(JSON.parse(JSON.stringify(pack)))).toEqual(pack);
    expect(pack.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reports every foundational gameplay category', async () => {
    const pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
    expect(pack.generationReport.foundationalCategories)
      .toEqual(['defense', 'food', 'healing', 'identification', 'light', 'offense']);
  });

  it('ships coherent early loot, identification pools, and distinct light fuel models', async () => {
    const pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
    const entries = new Map(pack.entries.map((entry) => [entry.id, entry]));
    const loot = entries.get('loot-table.early-provisions');
    expect(loot?.kind).toBe('loot-table');
    if (loot?.kind !== 'loot-table') throw new Error('expected early provisions loot table');
    const accessibleTags = new Set(loot.choices.flatMap((choice) => {
      const entry = choice.contentId === null ? undefined : entries.get(choice.contentId);
      return entry?.kind === 'item' && choice.weight > 0 ? entry.tags : [];
    }));
    expect([...accessibleTags].filter((tag) => ['food', 'healing', 'light', 'offense', 'defense'].includes(tag)).sort())
      .toEqual(['defense', 'food', 'healing', 'light', 'offense']);

    const potions = ['item.ashen-potion', 'item.crimson-potion'].map((id) => entries.get(id));
    expect(potions.map((entry) => entry?.kind === 'item' ? entry.identification : null)).toEqual([
      { mode: 'shuffled', poolId: 'identification-pool.potions' },
      { mode: 'shuffled', poolId: 'identification-pool.potions' },
    ]);
    const potionPool = entries.get('identification-pool.potions');
    expect(potionPool?.kind === 'identification-pool'
      ? potionPool.verbs.length * potionPool.nouns.length : 0).toBeGreaterThan(2);
    const ring = entries.get('item.etched-ring');
    expect(ring?.kind === 'item' ? ring.identification.mode : null).toBe('instance');
    const lantern = entries.get('item.brass-lantern');
    const torch = entries.get('item.pitch-torch');
    expect(lantern?.kind === 'item' ? lantern.light?.fuelTags : null).toEqual(['lamp-oil']);
    expect(torch?.kind === 'item' ? torch.light?.fuelTags : null).toEqual([]);
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
