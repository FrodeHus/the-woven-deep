import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileContentDirectory } from '../src/compiler/index.js';

describe('trait-tag taxonomy', () => {
  it('gives every chargen trait exactly one category tag alongside chargen', async () => {
    const pack = await compileContentDirectory({
      rootDir: resolve(import.meta.dirname, '../../../content'),
    });
    const traits = pack.entries.filter((entry) => entry.kind === 'trait') as Array<{
      id: string;
      tags?: string[];
    }>;

    const expectedCategoryById: Record<string, string> = {
      'trait.brawler': 'combat',
      'trait.sharpshooter': 'combat',
      'trait.sure-footed': 'survival',
      'trait.steady-hands': 'survival',
      'trait.keen-eyed': 'perception',
      'trait.born-in-the-dark': 'darkness',
      'trait.living-compass': 'darkness',
      'trait.dungeon-sense': 'darkness',
    };

    expect(traits.map((trait) => trait.id).sort()).toEqual(
      Object.keys(expectedCategoryById).sort(),
    );

    const categoryTags = new Set<string>();
    for (const trait of traits) {
      const tags = trait.tags ?? [];
      expect(tags).toContain('chargen');

      const expectedCategory = expectedCategoryById[trait.id];
      expect(tags).toContain(expectedCategory);

      const nonChargenTags = tags.filter((tag) => tag !== 'chargen');
      expect(nonChargenTags).toEqual([expectedCategory]);
      categoryTags.add(expectedCategory);
    }

    expect(categoryTags).toEqual(new Set(['combat', 'survival', 'perception', 'darkness']));
  });
});
