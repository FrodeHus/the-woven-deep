import { beforeAll, describe, expect, it } from 'vitest';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { resolve } from 'node:path';
import type {
  CompiledContentPack,
  SpellContentEntry,
  ConditionContentEntry,
} from '@woven-deep/content';
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

describe('spellbook mechanic coverage', () => {
  it('ships at least one spell exercising every mechanic', () => {
    const spells = pack.entries.filter((e): e is SpellContentEntry => e.kind === 'spell');
    const conditions = pack.entries.filter(
      (e): e is ConditionContentEntry => e.kind === 'condition',
    );
    const has = (pred: (s: SpellContentEntry) => boolean) => spells.some(pred);

    expect(has((s) => s.aoe === undefined && s.targetingId === 'target.actor')).toBe(true); // single
    expect(has((s) => s.aoe?.shape === 'burst')).toBe(true); // burst
    expect(has((s) => s.aoe?.shape === 'line')).toBe(true); // line
    expect(has((s) => s.aoe?.shape === 'cone')).toBe(true); // cone
    expect(has((s) => s.effects.some((e) => e.effectId === 'effect.damage'))).toBe(true); // instant damage
    expect(has((s) => s.effects.some((e) => e.effectId === 'effect.heal'))).toBe(true); // heal
    expect(has((s) => s.effects.some((e) => e.effectId === 'effect.recall'))).toBe(true); // recall
    expect(has((s) => s.effects.some((e) => e.effectId === 'effect.condition.apply'))).toBe(true); // buff/debuff

    expect(conditions.some((c) => c.tickEffects.length > 0)).toBe(true); // burn DoT
    expect(conditions.some((c) => (c.mitigation?.armorPerStack ?? 0) > 0)).toBe(true); // shield
    expect(
      conditions.some((c) =>
        Object.values(c.mitigation?.resistancePerStack ?? {}).some((value) => (value ?? 0) > 0),
      ),
    ).toBe(true); // ward / elemental resistance
    expect(
      conditions.some((c) => Object.values(c.modifiersPerStack ?? {}).some((value) => value < 0)),
    ).toBe(true); // slow / weaken
  });

  it('ships the specific spellbook ids the plan calls out with sane values', () => {
    const byId = new Map(pack.entries.map((entry) => [entry.id, entry]));
    const fireball = byId.get('spell.fireball') as SpellContentEntry;
    expect(fireball.aoe).toEqual({ shape: 'burst', radius: 2 });
    expect(fireball.effects.some((e) => e.effectId === 'effect.condition.apply')).toBe(true);

    const burning = byId.get('condition.burning') as ConditionContentEntry;
    expect(burning.tickEffects.length).toBeGreaterThan(0);

    const weaveShield = byId.get('condition.weave-shield') as ConditionContentEntry;
    expect(weaveShield.mitigation?.armorPerStack).toBeGreaterThan(0);

    const rimeWard = byId.get('condition.rime-ward') as ConditionContentEntry;
    expect(rimeWard.mitigation?.resistancePerStack?.cold).toBeGreaterThan(0);

    const aegis = byId.get('condition.aegis') as ConditionContentEntry;
    expect(Object.keys(aegis.mitigation?.resistancePerStack ?? {})).toHaveLength(6);

    const chilled = byId.get('condition.chilled') as ConditionContentEntry;
    expect(chilled.modifiersPerStack.meleeAccuracy).toBeLessThan(0);

    for (const spell of [
      'spell.ember-bolt',
      'spell.fireball',
      'spell.cinder-breath',
      'spell.frost-shard',
      'spell.frost-nova',
      'spell.rime-ward',
      'spell.arc-lance',
      'spell.chain-spark',
      'spell.static-field',
      'spell.weave-shield',
      'spell.aegis',
      'spell.enervate',
      'spell.mend',
      'spell.recall',
    ]) {
      const entry = byId.get(spell) as SpellContentEntry | undefined;
      expect(entry, `${spell} should be shipped`).toBeDefined();
      expect(entry!.weaveCost).toBeGreaterThanOrEqual(0);
      expect(entry!.range).toBeGreaterThanOrEqual(0);
      expect(entry!.actionCost).toBeGreaterThan(0);
    }
  });
});

function scrollInstance(actorId: string): ItemInstance {
  return {
    itemId: 'item.fireball-scroll.1',
    contentId: 'item.fireball-scroll',
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

/** The gameplay demo run with a fireball scroll in the hero's backpack, the cave rat relocated
 * to `aim` (one cell east of the hero) and a second, extra rat clustered next to it -- both
 * inside the radius-2 burst spell.fireball's scroll references. Mirrors cast-aoe.test.ts's
 * clustered-rat setup but drives the read (use-item) path instead of a direct `cast`. */
function runWithClusteredRatsAndScroll(): { run: ActiveRun; aim: { x: number; y: number } } {
  const { run } = createGameplayDemoRun(pack);
  const hero = run.actors.find((actor) => actor.playerControlled)!;
  const aim = { x: hero.x + 1, y: hero.y };
  const rat = run.actors.find((actor) => actor.contentId === 'monster.cave-rat')!;
  const actors = run.actors.map((actor) =>
    actor.actorId === rat.actorId ? { ...actor, ...aim } : actor,
  );
  const extraRat = {
    ...rat,
    actorId: 'rat.extra',
    x: aim.x + 1,
    y: aim.y,
    health: 20,
    maxHealth: 20,
  };
  return {
    run: {
      ...run,
      actors: [...actors, extraRat],
      items: [...run.items, scrollInstance(hero.actorId)],
      hero: { ...run.hero, classTags: [] },
    },
    aim,
  };
}

describe('AoE scroll read (item.fireball-scroll)', () => {
  it('sweeps the burst over every clustered actor and consumes the scroll (no Weave, any class)', () => {
    const { run, aim } = runWithClusteredRatsAndScroll();
    const hero = run.actors.find((actor) => actor.playerControlled)!;
    const rat = run.actors.find((actor) => actor.contentId === 'monster.cave-rat')!;
    const extraRat = run.actors.find((actor) => actor.actorId === 'rat.extra')!;

    const result = resolveCommand(
      run,
      {
        type: 'use-item',
        commandId: 'command.read-fireball-scroll',
        expectedRevision: run.revision,
        itemId: 'item.fireball-scroll.1',
        target: aim,
      },
      { content: pack },
    );

    expect(result.result.status).toBe('applied');
    const heroAfter = result.state.actors.find((actor) => actor.playerControlled)!;
    expect(heroAfter.weave).toBe(hero.weave); // no Weave spent -- the scroll casts, not the hero

    const ratAfter = result.state.actors.find((actor) => actor.actorId === rat.actorId)!;
    const extraRatAfter = result.state.actors.find((actor) => actor.actorId === 'rat.extra')!;
    expect(ratAfter.health).toBeLessThan(rat.health);
    expect(extraRatAfter.health).toBeLessThan(extraRat.health);

    expect(
      result.state.items.find((item) => item.itemId === 'item.fireball-scroll.1'),
    ).toBeUndefined(); // scroll consumed
  });
});
