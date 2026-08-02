import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack, ItemContentEntry } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createGameplayDemoRun,
  resolveCommand,
  spellPowerFor,
  type ActiveRun,
  type ActorState,
  type ItemInstance,
} from '../src/index.js';

let pack: CompiledContentPack;
/** `pack` plus a synthetic healing scroll. Same shape as `cast-aoe.test.ts`'s `burstPack`: the
 * entries change but `contentHash` does not, and the reducer only compares the stored hash string. */
let scrollPack: CompiledContentPack;

const MEND_SCROLL_ID = 'item.test-mend-scroll';

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
  const mendScroll: ItemContentEntry = {
    ...pack.entries.find(
      (entry): entry is ItemContentEntry =>
        entry.kind === 'item' && entry.id === 'item.ember-scroll',
    )!,
    id: MEND_SCROLL_ID,
    name: 'Scroll of mending',
    spellId: 'spell.mend',
  };
  scrollPack = { ...pack, entries: [...pack.entries, mendScroll] };
});

/** Sets the hero actor's wits, leaving every other attribute alone. `wits` feeds `maxWeave`,
 * `search`, `disarm` and `spellPower` only -- never melee accuracy, damage or defense -- so a
 * wits-only change cannot move a weapon swing. */
function withHeroWits(run: ActiveRun, wits: number): ActiveRun {
  return {
    ...run,
    actors: run.actors.map((actor) =>
      actor.playerControlled ? { ...actor, attributes: { ...actor.attributes, wits } } : actor,
    ),
  };
}

function heroOf(run: ActiveRun): ActorState {
  return run.actors.find((actor) => actor.playerControlled)!;
}

function ratOf(run: ActiveRun): ActorState {
  return run.actors.find((actor) => actor.contentId === 'monster.cave-rat')!;
}

/** The gameplay demo run with the cave rat moved one cell east of the hero (in range and lit) and
 * the hero given caster aptitude, mirroring `cast-aoe.test.ts`'s setup. */
function runWithAdjacentRat(wits: number): { run: ActiveRun; target: { x: number; y: number } } {
  const { run } = createGameplayDemoRun(pack);
  const hero = heroOf(run);
  const target = { x: hero.x + 1, y: hero.y };
  // The rat is given deep health headroom so no measured damage is clipped by `Math.max(0, ...)`
  // when the scaled hit would otherwise kill it -- the bonus must be visible in the delta.
  const actors = run.actors.map((actor) =>
    actor.contentId === 'monster.cave-rat'
      ? { ...actor, ...target, health: 200, maxHealth: 200 }
      : actor,
  );
  const placed: ActiveRun = {
    ...run,
    actors,
    hero: { ...run.hero, classTags: ['loomcaller'] },
  };
  return { run: withHeroWits(placed, wits), target };
}

function itemInstance(actorId: string, contentId: string, itemId: string): ItemInstance {
  return {
    itemId,
    contentId,
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

/** Health lost by the cave rat across a resolved command. */
function damageToRat(before: ActiveRun, after: ActiveRun): number {
  return (
    ratOf(before).health - after.actors.find((a) => a.actorId === ratOf(before).actorId)!.health
  );
}

/** Health gained by the hero across a resolved command. */
function healToHero(before: ActiveRun, after: ActiveRun): number {
  return after.actors.find((a) => a.playerControlled)!.health - heroOf(before).health;
}

/** Wounds the hero deeply enough that no heal under test is clamped by missing health. */
function woundHero(run: ActiveRun): ActiveRun {
  return {
    ...run,
    actors: run.actors.map((actor) => (actor.playerControlled ? { ...actor, health: 1 } : actor)),
  };
}

function castEmberBoltWith(wits: number): { before: ActiveRun; after: ActiveRun } {
  const { run, target } = runWithAdjacentRat(wits);
  const result = resolveCommand(
    run,
    {
      type: 'cast',
      commandId: 'command.cast-ember',
      expectedRevision: run.revision,
      spellId: 'spell.ember-bolt',
      target,
    },
    { content: pack },
  );
  expect(result.result.status).toBe('applied');
  return { before: run, after: result.state };
}

function readMendScrollWith(wits: number): { before: ActiveRun; after: ActiveRun } {
  const { run } = runWithAdjacentRat(wits);
  const hero = heroOf(run);
  const withScroll = woundHero({
    ...run,
    items: [...run.items, itemInstance(hero.actorId, MEND_SCROLL_ID, 'item.test-mend-scroll.1')],
  });
  const result = resolveCommand(
    withScroll,
    {
      type: 'use-item',
      commandId: 'command.read-mend',
      expectedRevision: withScroll.revision,
      itemId: 'item.test-mend-scroll.1',
      target: { x: heroOf(withScroll).x, y: heroOf(withScroll).y },
    },
    { content: scrollPack },
  );
  expect(result.result.status).toBe('applied');
  return { before: withScroll, after: result.state };
}

function drinkPotionWith(wits: number): { before: ActiveRun; after: ActiveRun } {
  const { run } = runWithAdjacentRat(wits);
  const hero = heroOf(run);
  const withPotion = woundHero({
    ...run,
    items: [...run.items, itemInstance(hero.actorId, 'item.crimson-potion', 'item.potion.1')],
  });
  const result = resolveCommand(
    withPotion,
    {
      type: 'use-item',
      commandId: 'command.drink',
      expectedRevision: withPotion.revision,
      itemId: 'item.potion.1',
      target: { x: heroOf(withPotion).x, y: heroOf(withPotion).y },
    },
    { content: pack },
  );
  expect(result.result.status).toBe('applied');
  return { before: withPotion, after: result.state };
}

function attackWith(wits: number): { before: ActiveRun; after: ActiveRun } {
  const { run } = runWithAdjacentRat(wits);
  const result = resolveCommand(
    run,
    {
      type: 'attack',
      commandId: 'command.swing',
      expectedRevision: run.revision,
      targetActorId: ratOf(run).actorId,
    },
    { content: pack },
  );
  expect(result.result.status).toBe('applied');
  return { before: run, after: result.state };
}

describe('spellPowerFor', () => {
  it('is zero at or below the baseline wits', () => {
    const { run } = runWithAdjacentRat(10);
    expect(spellPowerFor({ state: run, content: pack, actor: heroOf(run) })).toBe(0);
    const low = withHeroWits(run, 4);
    expect(spellPowerFor({ state: low, content: pack, actor: heroOf(low) })).toBe(0);
  });

  it('adds one per divisor step above the baseline', () => {
    const at = (wits: number): number => {
      const { run } = runWithAdjacentRat(wits);
      return spellPowerFor({ state: run, content: pack, actor: heroOf(run) });
    };
    expect(at(14)).toBe(1);
    expect(at(17)).toBe(1);
    expect(at(18)).toBe(2);
  });

  it('derives a monster caster from its own stats, with no hero special-casing', () => {
    const { run } = runWithAdjacentRat(10);
    const rat = ratOf(run);
    const clever: ActorState = { ...rat, attributes: { ...rat.attributes, wits: 18 } };
    const dull: ActorState = { ...rat, attributes: { ...rat.attributes, wits: 10 } };
    const state: ActiveRun = {
      ...run,
      actors: run.actors.map((actor) => (actor.actorId === rat.actorId ? clever : actor)),
    };
    expect(spellPowerFor({ state, content: pack, actor: clever })).toBe(2);
    expect(spellPowerFor({ state, content: pack, actor: dull })).toBe(0);
  });
});

describe('spell power in resolution', () => {
  it('raises a cast spell damage roll by the caster bonus', () => {
    const low = castEmberBoltWith(10);
    const high = castEmberBoltWith(18);
    expect(damageToRat(high.before, high.after)).toBe(damageToRat(low.before, low.after) + 2);
  });

  it('raises a scroll-cast heal by the caster bonus', () => {
    const low = readMendScrollWith(10);
    const high = readMendScrollWith(18);
    expect(healToHero(high.before, high.after)).toBe(healToHero(low.before, low.after) + 2);
  });

  it('consumes no additional randomness', () => {
    const low = castEmberBoltWith(10);
    const high = castEmberBoltWith(18);
    expect(high.after.rng.effects).toEqual(low.after.rng.effects);
  });

  it('leaves a non-spell item effect unscaled', () => {
    const low = drinkPotionWith(10);
    const high = drinkPotionWith(18);
    expect(healToHero(high.before, high.after)).toBe(healToHero(low.before, low.after));
  });

  it('leaves a plain weapon attack unscaled', () => {
    const low = attackWith(10);
    const high = attackWith(18);
    expect(damageToRat(high.before, high.after)).toBe(damageToRat(low.before, low.after));
  });
});
