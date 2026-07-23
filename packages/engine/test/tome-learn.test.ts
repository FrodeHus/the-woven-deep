import { beforeAll, describe, expect, it } from 'vitest';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { resolve } from 'node:path';
import type { CompiledContentPack, ItemContentEntry } from '@woven-deep/content';
import {
  createGameplayDemoRun,
  resolveCommand,
  type ActiveRun,
  type ItemInstance,
} from '../src/index.js';

let pack: CompiledContentPack;

const TOME_CONTENT_ID = 'item.test-tome';
const TOME_SPELL_ID = 'spell.ember-bolt';

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

/** Synthetic tome item entry: an item.spell.learn + effect.item.consume pair, mirroring what a
 * real tome (shipped in a later content task) will carry. Exercises the learn loop without
 * depending on that content. */
function tomeDefinition(): ItemContentEntry {
  return {
    kind: 'item',
    id: TOME_CONTENT_ID,
    name: 'Test Tome',
    glyph: '?',
    color: '#ffffff',
    tags: [],
    category: 'misc',
    stackLimit: 1,
    price: 1,
    rarity: 'common',
    heirloomEligible: false,
    minDepth: 0,
    maxDepth: 20,
    actionCost: 100,
    equipment: null,
    combat: null,
    light: null,
    identification: { mode: 'known', poolId: null },
    effects: [
      {
        effectId: 'effect.spell.learn',
        parameters: { spellId: TOME_SPELL_ID },
        requiresLivingTarget: false,
      },
      {
        effectId: 'effect.item.consume',
        parameters: { quantity: 1 },
        requiresLivingTarget: false,
      },
    ],
  };
}

function tomeInstance(actorId: string, itemId = 'item.tome.1'): ItemInstance {
  return {
    itemId,
    contentId: TOME_CONTENT_ID,
    quantity: 1,
    condition: 100,
    enchantment: null,
    identified: true,
    charges: null,
    fuel: null,
    enabled: null,
    location: { type: 'backpack', actorId },
  };
}

function packWithTome(): CompiledContentPack {
  return { ...pack, entries: [...pack.entries, tomeDefinition()] };
}

/** The gameplay demo run with a tome added to the hero's backpack. `caster` controls whether the
 * hero is granted the Loomcaller classTags (matching class.loomcaller in content). */
function runWithTome(options: { caster: boolean; alreadyKnown?: boolean }): {
  run: ActiveRun;
  tomePack: CompiledContentPack;
} {
  const tomePack = packWithTome();
  const { run } = createGameplayDemoRun(pack);
  const hero = run.actors.find((actor) => actor.playerControlled)!;
  return {
    run: {
      ...run,
      items: [...run.items, tomeInstance(hero.actorId)],
      hero: {
        ...run.hero,
        classTags: options.caster ? ['loomcaller'] : [],
        knownSpellIds: options.alreadyKnown ? [TOME_SPELL_ID] : run.hero.knownSpellIds,
      },
    },
    tomePack,
  };
}

describe('tome learning', () => {
  it('appends the spellId once and consumes the tome for a caster', () => {
    const { run, tomePack } = runWithTome({ caster: true });
    const result = resolveCommand(
      run,
      {
        type: 'use-item',
        commandId: 'command.learn',
        expectedRevision: run.revision,
        itemId: 'item.tome.1',
        target: null,
      },
      { content: tomePack },
    );

    expect(result.result.status).toBe('applied');
    expect(result.state.hero.knownSpellIds).toContain(TOME_SPELL_ID);
    expect(result.state.hero.knownSpellIds).toHaveLength((run.hero.knownSpellIds ?? []).length + 1);
    expect(result.state.items.find((item) => item.itemId === 'item.tome.1')).toBeUndefined();
  });

  it('rejects a non-caster with learn.no-aptitude and does not consume the tome', () => {
    const { run, tomePack } = runWithTome({ caster: false });
    const result = resolveCommand(
      run,
      {
        type: 'use-item',
        commandId: 'command.learn-no-aptitude',
        expectedRevision: run.revision,
        itemId: 'item.tome.1',
        target: null,
      },
      { content: tomePack },
    );

    expect(result.result).toMatchObject({ status: 'invalid', reason: 'learn.no-aptitude' });
    expect(result.state.hero.knownSpellIds ?? []).not.toContain(TOME_SPELL_ID);
    expect(result.state.items.find((item) => item.itemId === 'item.tome.1')).toBeDefined();
    expect(result.state.revision).toBe(run.revision);
  });

  it('rejects a caster who already knows the spell with learn.already-known, tome preserved', () => {
    const { run, tomePack } = runWithTome({ caster: true, alreadyKnown: true });
    const result = resolveCommand(
      run,
      {
        type: 'use-item',
        commandId: 'command.learn-known',
        expectedRevision: run.revision,
        itemId: 'item.tome.1',
        target: null,
      },
      { content: tomePack },
    );

    expect(result.result).toMatchObject({ status: 'invalid', reason: 'learn.already-known' });
    expect(result.state.hero.knownSpellIds).toEqual([TOME_SPELL_ID]);
    expect(result.state.items.find((item) => item.itemId === 'item.tome.1')).toBeDefined();
    expect(result.state.revision).toBe(run.revision);
  });
});
