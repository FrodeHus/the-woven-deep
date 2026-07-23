import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import type { CompiledContentPack } from '@woven-deep/content';
import {
  DEFAULT_GUEST_HERO,
  createNewRun,
  projectGameplayState,
  type ActiveRun,
  type CastableSpellView,
} from '../src/index.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

function castableFor(spellIds: readonly string[]): readonly CastableSpellView[] {
  const run: ActiveRun = createNewRun({ pack, seed: [1, 2, 3, 4], hero: DEFAULT_GUEST_HERO });
  const withSpells: ActiveRun = { ...run, hero: { ...run.hero, knownSpellIds: [...spellIds] } };
  const projection = projectGameplayState({ state: withSpells, content: pack });
  return projection.hero.castableSpells ?? [];
}

describe('CastableSpellView.aoe', () => {
  it('populates aoe for a burst spell', () => {
    const fireball = castableFor(['spell.fireball']).find((s) => s.spellId === 'spell.fireball');
    expect(fireball?.aoe).toEqual({ shape: 'burst', radius: 2 });
  });

  it('omits aoe for a single-target spell', () => {
    const ember = castableFor(['spell.ember-bolt']).find((s) => s.spellId === 'spell.ember-bolt');
    expect(ember).toBeDefined();
    expect(ember && 'aoe' in ember).toBe(false);
  });
});
