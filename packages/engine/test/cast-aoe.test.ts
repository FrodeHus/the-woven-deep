import { beforeAll, describe, expect, it } from 'vitest';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { resolve } from 'node:path';
import type { CompiledContentPack, SpellContentEntry } from '@woven-deep/content';
import {
  createGameplayDemoRun,
  decodeActiveRun,
  encodeActiveRun,
  resolveCommand,
  type ActiveRun,
} from '../src/index.js';

let pack: CompiledContentPack;
let burstPack: CompiledContentPack;

const BURST_SPELL_ID = 'spell.test-burst';

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
  // Task 12 ships a real burst spell (spell.fireball); until then this synthetic entry exercises
  // the same AoE cast path (targetingId: target.burst + aoe) without depending on that content.
  // `burstPack` shares `pack`'s hash so ActiveRun.contentHash (bound to `pack`) still matches --
  // the reducer only compares the stored hash string, never recomputes it from `entries`.
  const burstSpell: SpellContentEntry = {
    id: BURST_SPELL_ID,
    kind: 'spell',
    name: 'Test burst',
    tags: [],
    targetingId: 'target.burst',
    range: 6,
    actionCost: 100,
    weaveCost: 3,
    aoe: { shape: 'burst', radius: 1 },
    effects: [
      {
        effectId: 'effect.damage',
        parameters: { damageType: 'fire', dice: { count: 1, sides: 6, bonus: 1 } },
        requiresLivingTarget: true,
      },
    ],
  };
  burstPack = { ...pack, entries: [...pack.entries, burstSpell] };
});

/** The gameplay demo run with the hero granted caster aptitude (matching class.loomcaller's
 * classTags), the cave rat placed at `aim`, and a second synthetic rat clustered next to it --
 * both inside a radius-1 burst centered on `aim`, which sits within the caster's already-lit,
 * visible melee-adjacent cell (mirroring weave.test.ts's `runWithAdjacentRat` setup). */
function runWithClusteredRats(): { run: ActiveRun; aim: { x: number; y: number } } {
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
      hero: { ...run.hero, classTags: ['loomcaller'] },
    },
    aim,
  };
}

/** The unmodified gameplay demo run (cave rat left at its default, untouched position, far from
 * the aim cell) with caster aptitude granted -- a legal AoE cast aimed at empty, walkable ground,
 * since nothing else stands in the radius-1 burst centered there. (Unlike `runWithClusteredRats`'s
 * `hero.x + 1` cell, which is a wall the rat is placed on for melee-adjacency only, `hero.x - 1`
 * here is genuinely walkable terrain so the round-tripped save stays valid.) */
function runWithEmptyAim(): { run: ActiveRun; aim: { x: number; y: number } } {
  const { run } = createGameplayDemoRun(pack);
  const hero = run.actors.find((actor) => actor.playerControlled)!;
  const aim = { x: hero.x - 1, y: hero.y };
  return {
    run: { ...run, hero: { ...run.hero, classTags: ['loomcaller'] } },
    aim,
  };
}

describe('AoE cast', () => {
  it('applies, emits spell.cast, and round-trips a zero-target burst aimed at empty ground', () => {
    const { run, aim } = runWithEmptyAim();
    const hero = run.actors.find((actor) => actor.playerControlled)!;

    const result = resolveCommand(
      run,
      {
        type: 'cast',
        commandId: 'command.cast-burst-empty',
        expectedRevision: run.revision,
        spellId: BURST_SPELL_ID,
        target: aim,
      },
      { content: burstPack },
    );

    expect(result.result.status).toBe('applied');
    const heroAfter = result.state.actors.find((actor) => actor.playerControlled)!;
    // Weave is spent even though the burst hit nothing -- this is the latent save-corruption gap:
    // the cast applies with no attack.hit/actor.damaged/actor.healed/condition.applied/hero.recalled
    // event, so the applied-command matcher needs `spell.cast` to find anything at all.
    expect(heroAfter.weave).toBe(hero.weave - 3);
    const commandEvents = result.state.recentCommands.at(-1)?.events ?? [];
    expect(commandEvents).toContainEqual(
      expect.objectContaining({
        type: 'spell.cast',
        actorId: hero.actorId,
        spellId: BURST_SPELL_ID,
      }),
    );

    expect(result.state.recentCommands).toHaveLength(1);
    expect(() => decodeActiveRun(encodeActiveRun(result.state))).not.toThrow();
    const roundTripped = decodeActiveRun(encodeActiveRun(result.state));
    expect(roundTripped.recentCommands).toHaveLength(1);
  });

  it('applies, emits spell.cast, and round-trips a real single-target cast (spell.ember-bolt)', () => {
    const { run } = createGameplayDemoRun(pack);
    const hero = run.actors.find((actor) => actor.playerControlled)!;
    // `hero.x - 1` (unlike `hero.x + 1`, a wall) is genuinely walkable terrain, so the target rat
    // placed there keeps the round-tripped save valid.
    const target = { x: hero.x - 1, y: hero.y };
    const actors = run.actors.map((actor) =>
      actor.contentId === 'monster.cave-rat' ? { ...actor, ...target } : actor,
    );
    const casterRun: ActiveRun = {
      ...run,
      actors,
      hero: { ...run.hero, classTags: ['loomcaller'] },
    };

    const result = resolveCommand(
      casterRun,
      {
        type: 'cast',
        commandId: 'command.cast-single-target',
        expectedRevision: casterRun.revision,
        spellId: 'spell.ember-bolt',
        target,
      },
      { content: pack },
    );

    expect(result.result.status).toBe('applied');
    const commandEvents = result.state.recentCommands.at(-1)?.events ?? [];
    expect(commandEvents).toContainEqual(
      expect.objectContaining({
        type: 'spell.cast',
        actorId: hero.actorId,
        spellId: 'spell.ember-bolt',
      }),
    );

    expect(result.state.recentCommands).toHaveLength(1);
    expect(() => decodeActiveRun(encodeActiveRun(result.state))).not.toThrow();
    const roundTripped = decodeActiveRun(encodeActiveRun(result.state));
    expect(roundTripped.recentCommands).toHaveLength(1);
  });

  it('burst hits every actor in radius and excludes the caster, deterministically', () => {
    const { run, aim } = runWithClusteredRats();
    const hero = run.actors.find((actor) => actor.playerControlled)!;
    const rat = run.actors.find((actor) => actor.contentId === 'monster.cave-rat')!;
    const extraRat = run.actors.find((actor) => actor.actorId === 'rat.extra')!;

    const result = resolveCommand(
      run,
      {
        type: 'cast',
        commandId: 'command.cast-burst',
        expectedRevision: run.revision,
        spellId: BURST_SPELL_ID,
        target: aim,
      },
      { content: burstPack },
    );

    expect(result.result.status).toBe('applied');
    const heroAfter = result.state.actors.find((actor) => actor.playerControlled)!;
    // Weave is still spent even though the caster takes no effect damage.
    expect(heroAfter.weave).toBe(hero.weave - 3);
    expect(heroAfter.health).toBe(hero.health);
    const ratAfter = result.state.actors.find((actor) => actor.actorId === rat.actorId)!;
    const extraRatAfter = result.state.actors.find((actor) => actor.actorId === 'rat.extra')!;
    expect(ratAfter.health).toBeLessThan(rat.health);
    expect(extraRatAfter.health).toBeLessThan(extraRat.health);

    // Re-resolving from the same starting state is bit-identical (stable actorId sweep order).
    const replay = resolveCommand(
      run,
      {
        type: 'cast',
        commandId: 'command.cast-burst',
        expectedRevision: run.revision,
        spellId: BURST_SPELL_ID,
        target: aim,
      },
      { content: burstPack },
    );
    expect(replay.state).toEqual(result.state);
  });

  it('rejects a cast below the spell weaveCost without mutating state or RNG', () => {
    const { run, aim } = runWithClusteredRats();
    const poor = {
      ...run,
      actors: run.actors.map((a) => (a.playerControlled ? { ...a, weave: 1 } : a)),
    };
    const result = resolveCommand(
      poor,
      {
        type: 'cast',
        commandId: 'command.cast-burst-poor',
        expectedRevision: poor.revision,
        spellId: BURST_SPELL_ID,
        target: aim,
      },
      { content: burstPack },
    );
    expect(result.result).toMatchObject({ status: 'invalid', reason: 'cast.insufficient-weave' });
    expect(result.state.rng).toEqual(poor.rng);
    expect(result.state.actors).toEqual(poor.actors);
  });

  it('rejects a cast from a hero with no caster aptitude without mutating state or RNG', () => {
    const { run, aim } = runWithClusteredRats();
    const nonCaster = { ...run, hero: { ...run.hero, classTags: [] } };
    const result = resolveCommand(
      nonCaster,
      {
        type: 'cast',
        commandId: 'command.cast-burst-no-aptitude',
        expectedRevision: nonCaster.revision,
        spellId: BURST_SPELL_ID,
        target: aim,
      },
      { content: burstPack },
    );
    expect(result.result).toMatchObject({ status: 'invalid', reason: 'cast.no-aptitude' });
    expect(result.state.rng).toEqual(nonCaster.rng);
    expect(result.state.actors).toEqual(nonCaster.actors);
  });
});
