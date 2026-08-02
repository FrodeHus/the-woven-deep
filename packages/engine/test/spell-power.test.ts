import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack, CurseContentEntry, ItemContentEntry } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  applyCurseTriggers,
  createGameplayDemoRun,
  resolveCommand,
  spellPowerFor,
  type ActiveRun,
  type ActorState,
  type DomainEvent,
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

/** Wounds the hero deeply enough that no heal under test is clamped by missing health. The
 * headroom matters as much as the wound: with a stock maxHealth the +2 would survive only because
 * the deterministic roll happens to land low -- exactly the way the rat's death once hid the damage
 * bonus. 199 missing health means the bonus is always visible in the delta. */
function woundHero(run: ActiveRun): ActiveRun {
  return {
    ...run,
    actors: run.actors.map((actor) =>
      actor.playerControlled ? { ...actor, health: 1, maxHealth: 200 } : actor,
    ),
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

/** The shipping Woven Thought enchantment: `{ maxWeave: 2, spellPower: 1 }` on a ring. Equipped
 * straight into the slot, bypassing the equip command. */
function wearWovenThoughtRing(run: ActiveRun): ActiveRun {
  const hero = heroOf(run);
  const ring: ItemInstance = {
    itemId: 'item.woven-ring.1',
    contentId: 'item.etched-ring',
    quantity: 1,
    condition: 100,
    enchantment: {
      enchantmentId: 'enchantment.woven-thought',
      modifiers: { maxWeave: 2, spellPower: 1 },
    },
    identified: true,
    charges: null,
    fuel: null,
    enabled: null,
    location: { type: 'equipped', actorId: hero.actorId, slot: 'left-ring' },
  };
  return {
    ...run,
    items: [...run.items, ring],
    actors: run.actors.map((actor) =>
      actor.playerControlled
        ? { ...actor, equipment: { ...actor.equipment, 'left-ring': ring.itemId } }
        : actor,
    ),
  };
}

/** `pack` plus an always-firing on-hurt curse that deals flat arcane damage, and a cursed copy of
 * the hero's equipped main-hand item to carry it. */
function cursedRun(wits: number): { run: ActiveRun; content: CompiledContentPack } {
  const { run } = runWithAdjacentRat(wits);
  const hero = heroOf(run);
  const mainHandId = hero.equipment['main-hand'];
  if (mainHandId === undefined) throw new Error('test setup failure: hero has no main-hand item');
  const curse: CurseContentEntry = {
    kind: 'curse',
    id: 'curse.test-bite',
    name: 'Test bite',
    tags: ['curse'],
    revealText: 'The test curse bites.',
    drawbackModifiers: {},
    trigger: {
      on: 'on-hurt-below-half',
      chanceBps: 10000,
      effect: {
        effectId: 'effect.damage',
        requiresLivingTarget: true,
        parameters: { damageType: 'arcane', dice: { count: 1, sides: 3, bonus: 4 } },
      },
    },
  };
  return {
    run: {
      ...run,
      items: run.items.map((item) =>
        item.itemId === mainHandId
          ? { ...item, curse: { curseId: curse.id, revealed: true } }
          : item,
      ),
      actors: run.actors.map((actor) =>
        actor.playerControlled ? { ...actor, health: 100, maxHealth: 200 } : actor,
      ),
    },
    content: { ...pack, entries: [...pack.entries, curse] },
  };
}

/** Health lost by the hero across a curse-trigger resolution. */
function fireHurtCurse(wits: number): number {
  const { run, content } = cursedRun(wits);
  const hero = heroOf(run);
  const crossing: DomainEvent = {
    type: 'actor.damaged',
    eventId: 'event.hurt',
    actorId: hero.actorId,
    sourceActorId: ratOf(run).actorId,
    amount: 60,
    health: 40,
  };
  const fired = applyCurseTriggers({ state: run, content, events: [crossing], eventId: 'c1' });
  expect(fired.events.length).toBeGreaterThan(0);
  return hero.health - fired.state.actors.find((a) => a.playerControlled)!.health;
}

describe('spell power through the AoE sweep', () => {
  it('scales every target of a burst cast, not just a single-target resolve', () => {
    // The sweep reaches `resolveEffectSequence` by spreading `...input`, so nothing but a test
    // stops a refactor to an explicit field list from dropping `spellPower` and silently
    // un-scaling every shipping AoE spell. Two targets, so per-target scaling is visible.
    const castFireballWith = (wits: number): readonly number[] => {
      const { run, target } = runWithAdjacentRat(wits);
      const rat = ratOf(run);
      const second: ActorState = {
        ...rat,
        actorId: 'rat.second',
        x: target.x,
        y: target.y + 1,
      };
      const staged: ActiveRun = { ...run, actors: [...run.actors, second] };
      const result = resolveCommand(
        staged,
        {
          type: 'cast',
          commandId: 'command.cast-fireball',
          expectedRevision: staged.revision,
          spellId: 'spell.fireball',
          target,
        },
        { content: pack },
      );
      expect(result.result.status).toBe('applied');
      return [rat.actorId, second.actorId].map((actorId) => {
        const before = staged.actors.find((a) => a.actorId === actorId)!;
        const after = result.state.actors.find((a) => a.actorId === actorId)!;
        return before.health - after.health;
      });
    };
    const low = castFireballWith(10);
    const high = castFireballWith(18);
    expect(high).toEqual(low.map((damage) => damage + 2));
    expect(low.every((damage) => damage > 0)).toBe(true);
  });
});

describe('spell power sources and exclusions', () => {
  it('counts a +spellPower equipment modifier', () => {
    // The enchantment's +1 lands on the RAW derived stat, upstream of the divisor -- so it buys a
    // whole bonus step only where it crosses a divisor boundary. wits 13 is raw 3 (bonus 0); the
    // ring makes it raw 4 (bonus 1).
    const { run } = runWithAdjacentRat(13);
    const worn = wearWovenThoughtRing(run);
    expect(spellPowerFor({ state: run, content: pack, actor: heroOf(run) })).toBe(0);
    expect(spellPowerFor({ state: worn, content: pack, actor: heroOf(worn) })).toBe(1);
  });

  it('applies the equipment modifier to the raw stat, not to the finished bonus', () => {
    // The same ring on a wits-10 hero buys nothing: raw 0 -> raw 1, and 1/4 truncates to 0. Pinned
    // because "+1 spellPower" reads like "+1 damage" and is not.
    const { run } = runWithAdjacentRat(10);
    const worn = wearWovenThoughtRing(run);
    expect(spellPowerFor({ state: worn, content: pack, actor: heroOf(worn) })).toBe(0);
  });

  it('carries the equipment modifier all the way into cast damage', () => {
    // End-to-end, not just the derivation: equipment -> deriveRunActorStats -> divisor -> seam.
    const damageWith = (worn: boolean): number => {
      const { run, target } = runWithAdjacentRat(13);
      const staged = worn ? wearWovenThoughtRing(run) : run;
      const result = resolveCommand(
        staged,
        {
          type: 'cast',
          commandId: 'command.cast-ring',
          expectedRevision: staged.revision,
          spellId: 'spell.ember-bolt',
          target,
        },
        { content: pack },
      );
      expect(result.result.status).toBe('applied');
      const rat = ratOf(staged);
      return rat.health - result.state.actors.find((a) => a.actorId === rat.actorId)!.health;
    };
    expect(damageWith(true)).toBe(damageWith(false) + 1);
  });

  it('leaves a curse trigger unscaled', () => {
    expect(fireHurtCurse(18)).toBe(fireHurtCurse(10));
    expect(fireHurtCurse(10)).toBeGreaterThan(0);
  });

  it('derives the same bonus before and after the Weave deduction', () => {
    // Validation derives from the pre-deduction state and the commit path now derives from the
    // same one (hoisted to a single call). This pins the property that made them agree in the
    // first place, so a future formula that DID read Weave would fail here rather than silently
    // desync the dry run from the commit.
    const { run } = runWithAdjacentRat(18);
    const hero = heroOf(run);
    const spent: ActiveRun = {
      ...run,
      actors: run.actors.map((actor) =>
        actor.playerControlled ? { ...actor, weave: actor.weave - 6 } : actor,
      ),
    };
    expect(spellPowerFor({ state: spent, content: pack, actor: heroOf(spent) })).toBe(
      spellPowerFor({ state: run, content: pack, actor: hero }),
    );
  });
});
