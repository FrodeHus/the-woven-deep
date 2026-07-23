import { beforeAll, describe, expect, it } from 'vitest';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { resolve } from 'node:path';
import type { CompiledContentPack } from '@woven-deep/content';
import {
  createGameplayDemoRun,
  resolveCommand,
  type ActiveRun,
  type ItemInstance,
} from '../src/index.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

function scrollInstance(actorId: string, itemId = 'item.ember-scroll.1'): ItemInstance {
  return {
    itemId,
    contentId: 'item.ember-scroll',
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

/** The gameplay demo hero with an ember scroll in the backpack and the cave rat relocated one
 * cell east, in range and lit, so the scroll's referenced spell has a valid living target. The
 * hero carries no classTags, so it is a non-caster -- proving scroll-read requires no aptitude. */
function runWithScroll(): { run: ActiveRun; target: { x: number; y: number } } {
  const { run } = createGameplayDemoRun(pack);
  const hero = run.actors.find((actor) => actor.playerControlled)!;
  const target = { x: hero.x + 1, y: hero.y };
  const actors = run.actors.map((actor) =>
    actor.contentId === 'monster.cave-rat' ? { ...actor, ...target } : actor,
  );
  return {
    run: {
      ...run,
      actors,
      items: [...run.items, scrollInstance(hero.actorId)],
      hero: { ...run.hero, classTags: [] },
    },
    target,
  };
}

describe('scroll read', () => {
  it('resolves the referenced spell once and consumes the scroll (no Weave, any class)', () => {
    const { run, target } = runWithScroll();
    const scroll = run.items.find((item) => item.itemId === 'item.ember-scroll.1')!;
    const hero = run.actors.find((actor) => actor.playerControlled)!;
    const rat = run.actors.find((actor) => actor.contentId === 'monster.cave-rat')!;

    const result = resolveCommand(
      run,
      {
        type: 'use-item',
        commandId: 'command.read',
        expectedRevision: run.revision,
        itemId: scroll.itemId,
        target,
      },
      { content: pack },
    );

    expect(result.result.status).toBe('applied');
    const heroAfter = result.state.actors.find((actor) => actor.playerControlled)!;
    expect(heroAfter.weave).toBe(hero.weave); // no Weave spent, even though the hero is a non-caster
    const ratAfter = result.state.actors.find((actor) => actor.actorId === rat.actorId)!;
    expect(ratAfter.health).toBeLessThan(rat.health); // ember bolt damage landed
    expect(result.state.items.find((item) => item.itemId === scroll.itemId)).toBeUndefined(); // scroll consumed
  });

  it('rejects an out-of-range read without mutating state or spending randomness', () => {
    const { run } = runWithScroll();
    const scroll = run.items.find((item) => item.itemId === 'item.ember-scroll.1')!;
    const hero = run.actors.find((actor) => actor.playerControlled)!;
    const farTarget = { x: hero.x + 20, y: hero.y + 20 };

    const result = resolveCommand(
      run,
      {
        type: 'use-item',
        commandId: 'command.read-far',
        expectedRevision: run.revision,
        itemId: scroll.itemId,
        target: farTarget,
      },
      { content: pack },
    );

    expect(result.result).toMatchObject({ status: 'invalid' });
    expect(result.state.revision).toBe(run.revision);
    expect(result.state.rng).toEqual(run.rng);
    expect(result.state.items.find((item) => item.itemId === scroll.itemId)).toBeDefined();
  });
});
