import { beforeAll, describe, expect, it } from 'vitest';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { resolve } from 'node:path';
import type { CompiledContentPack } from '@woven-deep/content';
import {
  createGameplayDemoRun,
  generateTownFloor,
  validateActiveRun,
  type ActiveRun,
  type ItemInstance,
} from '@woven-deep/engine';
import { dispatchCommand, dispatchIntent } from '../src/dispatch.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

/** Round-trips `run` through a save encode/decode-shaped validation exactly the way the guarded
 * `encodeActiveRun`/`decodeActiveRun` pair does (see engine save-codec.ts, which itself calls
 * `validateActiveRun`), proving the T6/T9/T12a save-schema additions the retained magic commands
 * and events rely on stay sound after each session-path mutation. */
function assertSaveRoundTrips(run: ActiveRun): void {
  const encoded = JSON.parse(JSON.stringify(run));
  expect(() => validateActiveRun(encoded)).not.toThrow();
}

/** The gameplay demo run with the hero granted caster (Loomcaller) aptitude and the cave rat
 * relocated one cell west of the hero -- genuinely walkable terrain (unlike `hero.x + 1`, a wall
 * reserved for melee-adjacency fixtures elsewhere), so a single-target cast at that cell keeps the
 * round-tripped save valid. */
function casterRunWithAdjacentRat(): { run: ActiveRun; target: { x: number; y: number } } {
  const { run } = createGameplayDemoRun(pack);
  const hero = run.actors.find((actor) => actor.playerControlled)!;
  // The demo fixture ships two `monster.cave-rat` actors -- relocate only one of them (by
  // actorId, not by matching contentId) so the other one's untouched position never collides
  // with the moved rat's new cell.
  const rat = run.actors.find((actor) => actor.contentId === 'monster.cave-rat')!;
  const target = { x: hero.x - 1, y: hero.y };
  const actors = run.actors.map((actor) =>
    actor.actorId === rat.actorId ? { ...actor, ...target } : actor,
  );
  return {
    run: { ...run, actors, hero: { ...run.hero, classTags: ['loomcaller'] } },
    target,
  };
}

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

// Sorts after every other item in the demo run's items array (itemId must be unique and strictly
// increasing across the run -- mirrors the engine's own `recall.test.ts` `tomeInstanceFor`
// convention).
function tomeInstance(actorId: string, itemId = 'item.zzz-frost-shard-tome.1'): ItemInstance {
  return {
    itemId,
    contentId: 'item.frost-shard-tome',
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

/** The gameplay demo run granted caster aptitude, given a town floor alongside its dungeon floor
 * (`createGameplayDemoRun` alone never generates one, but recall's town-move needs one present in
 * `run.floors`) -- mirrors the engine's own `recall.test.ts` fixture. */
function casterRunWithTown(): { run: ActiveRun } {
  const { run } = createGameplayDemoRun(pack);
  const town = generateTownFloor(pack).floor;
  return {
    run: {
      ...run,
      hero: { ...run.hero, classTags: ['loomcaller'] },
      // The save schema requires floors sorted by strictly increasing floorId.
      floors: [...run.floors, town].sort((left, right) =>
        left.floorId < right.floorId ? -1 : left.floorId > right.floorId ? 1 : 0,
      ),
    },
  };
}

describe('magic through the session-authoritative dispatch path', () => {
  it('applies a single-target cast (spell.ember-bolt): damages the target, spends Weave, emits spell.cast, and round-trips', () => {
    const { run, target } = casterRunWithAdjacentRat();
    const hero = run.actors.find((actor) => actor.playerControlled)!;
    const rat = run.actors.find((actor) => actor.contentId === 'monster.cave-rat')!;

    const resolution = dispatchCommand(
      run,
      {
        type: 'cast',
        commandId: 'command.cast-ember-bolt',
        expectedRevision: run.revision,
        spellId: 'spell.ember-bolt',
        target,
      },
      { pack },
    );

    expect(resolution.result.status).toBe('applied');
    const heroAfter = resolution.state.actors.find((actor) => actor.playerControlled)!;
    expect(heroAfter.weave).toBe(hero.weave - 3);
    const ratAfter = resolution.state.actors.find((actor) => actor.actorId === rat.actorId)!;
    expect(ratAfter.health).toBeLessThan(rat.health);
    const commandEvents = resolution.state.recentCommands.at(-1)?.events ?? [];
    expect(commandEvents).toContainEqual(
      expect.objectContaining({
        type: 'spell.cast',
        actorId: hero.actorId,
        spellId: 'spell.ember-bolt',
      }),
    );

    assertSaveRoundTrips(resolution.state);
  });

  it('applies an AoE burst cast (spell.fireball): damages actors in the burst, spends Weave, emits spell.cast, and round-trips', () => {
    const { run } = createGameplayDemoRun(pack);
    const hero = run.actors.find((actor) => actor.playerControlled)!;
    const aim = { x: hero.x - 1, y: hero.y };
    // The demo fixture ships two `monster.cave-rat` actors -- relocate only one of them so the
    // other's untouched position never collides with the moved rat's new cell.
    const rat = run.actors.find((actor) => actor.contentId === 'monster.cave-rat')!;
    const casterRun: ActiveRun = {
      ...run,
      actors: run.actors.map((actor) =>
        actor.actorId === rat.actorId ? { ...actor, ...aim } : actor,
      ),
      hero: { ...run.hero, classTags: ['loomcaller'] },
    };

    const resolution = dispatchCommand(
      casterRun,
      {
        type: 'cast',
        commandId: 'command.cast-fireball',
        expectedRevision: casterRun.revision,
        spellId: 'spell.fireball',
        target: aim,
      },
      { pack },
    );

    expect(resolution.result.status).toBe('applied');
    const heroAfter = resolution.state.actors.find((actor) => actor.playerControlled)!;
    expect(heroAfter.weave).toBe(hero.weave - 6);
    const ratAfter = resolution.state.actors.find((actor) => actor.actorId === rat.actorId)!;
    expect(ratAfter.health).toBeLessThan(rat.health);
    const commandEvents = resolution.state.recentCommands.at(-1)?.events ?? [];
    expect(commandEvents).toContainEqual(
      expect.objectContaining({
        type: 'spell.cast',
        actorId: hero.actorId,
        spellId: 'spell.fireball',
      }),
    );

    assertSaveRoundTrips(resolution.state);
  });

  it('rejects a cast below the spell weaveCost, server-side, without mutating state', () => {
    const { run, target } = casterRunWithAdjacentRat();
    const poor: ActiveRun = {
      ...run,
      actors: run.actors.map((actor) => (actor.playerControlled ? { ...actor, weave: 1 } : actor)),
    };

    const resolution = dispatchCommand(
      poor,
      {
        type: 'cast',
        commandId: 'command.cast-poor',
        expectedRevision: poor.revision,
        spellId: 'spell.ember-bolt',
        target,
      },
      { pack },
    );

    expect(resolution.result).toMatchObject({
      status: 'invalid',
      reason: 'cast.insufficient-weave',
    });
    expect(resolution.state.actors).toEqual(poor.actors);
    assertSaveRoundTrips(resolution.state);
  });

  it('rejects a cast from a hero with no caster aptitude, server-side, without mutating state', () => {
    const { run, target } = casterRunWithAdjacentRat();
    const nonCaster: ActiveRun = { ...run, hero: { ...run.hero, classTags: [] } };

    const resolution = dispatchCommand(
      nonCaster,
      {
        type: 'cast',
        commandId: 'command.cast-no-aptitude',
        expectedRevision: nonCaster.revision,
        spellId: 'spell.ember-bolt',
        target,
      },
      { pack },
    );

    expect(resolution.result).toMatchObject({ status: 'invalid', reason: 'cast.no-aptitude' });
    expect(resolution.state.actors).toEqual(nonCaster.actors);
    assertSaveRoundTrips(resolution.state);
  });

  it('reads a scroll (item.ember-scroll) once through use-item: casts spell.ember-bolt, consumes the scroll, spends no Weave, and round-trips', () => {
    const { run } = createGameplayDemoRun(pack);
    const hero = run.actors.find((actor) => actor.playerControlled)!;
    // `hero.x - 1` (unlike `hero.x + 1`, a wall reserved for melee-adjacency fixtures elsewhere)
    // is genuinely walkable terrain, so the round-tripped save stays valid.
    const target = { x: hero.x - 1, y: hero.y };
    // The demo fixture ships two `monster.cave-rat` actors -- relocate only one of them so the
    // other's untouched position never collides with the moved rat's new cell.
    const rat = run.actors.find((actor) => actor.contentId === 'monster.cave-rat')!;
    const actors = run.actors.map((actor) =>
      actor.actorId === rat.actorId ? { ...actor, ...target } : actor,
    );
    // No classTags: proves reading a scroll requires no caster aptitude, unlike a real cast.
    const runWithScroll: ActiveRun = {
      ...run,
      actors,
      items: [...run.items, scrollInstance(hero.actorId)],
      hero: { ...run.hero, classTags: [] },
    };

    const resolution = dispatchCommand(
      runWithScroll,
      {
        type: 'use-item',
        commandId: 'command.read-scroll',
        expectedRevision: runWithScroll.revision,
        itemId: 'item.ember-scroll.1',
        target,
      },
      { pack },
    );

    expect(resolution.result.status).toBe('applied');
    const heroAfter = resolution.state.actors.find((actor) => actor.playerControlled)!;
    expect(heroAfter.weave).toBe(hero.weave);
    const ratAfter = resolution.state.actors.find((actor) => actor.actorId === rat.actorId)!;
    expect(ratAfter.health).toBeLessThan(rat.health);
    expect(
      resolution.state.items.find((item) => item.itemId === 'item.ember-scroll.1'),
    ).toBeUndefined();

    assertSaveRoundTrips(resolution.state);
  });

  it('reads a tome (item.frost-shard-tome) through use-item: appends knownSpellIds for a caster, and round-trips', () => {
    const { run } = createGameplayDemoRun(pack);
    const hero = run.actors.find((actor) => actor.playerControlled)!;
    const runWithTome: ActiveRun = {
      ...run,
      items: [...run.items, tomeInstance(hero.actorId)],
      hero: { ...run.hero, classTags: ['loomcaller'] },
    };
    const knownBefore = runWithTome.hero.knownSpellIds ?? [];

    const resolution = dispatchCommand(
      runWithTome,
      {
        type: 'use-item',
        commandId: 'command.learn-tome',
        expectedRevision: runWithTome.revision,
        itemId: 'item.zzz-frost-shard-tome.1',
        target: null,
      },
      { pack },
    );

    expect(resolution.result.status).toBe('applied');
    expect(resolution.state.hero.knownSpellIds).toContain('spell.frost-shard');
    expect(resolution.state.hero.knownSpellIds).toHaveLength(knownBefore.length + 1);
    expect(
      resolution.state.items.find((item) => item.itemId === 'item.zzz-frost-shard-tome.1'),
    ).toBeUndefined();

    assertSaveRoundTrips(resolution.state);
  });

  it('rejects a tome read from a non-caster, server-side, tome preserved', () => {
    const { run } = createGameplayDemoRun(pack);
    const hero = run.actors.find((actor) => actor.playerControlled)!;
    const runWithTome: ActiveRun = {
      ...run,
      items: [...run.items, tomeInstance(hero.actorId)],
      hero: { ...run.hero, classTags: [] },
    };

    const resolution = dispatchCommand(
      runWithTome,
      {
        type: 'use-item',
        commandId: 'command.learn-tome-no-aptitude',
        expectedRevision: runWithTome.revision,
        itemId: 'item.zzz-frost-shard-tome.1',
        target: null,
      },
      { pack },
    );

    expect(resolution.result).toMatchObject({ status: 'invalid', reason: 'learn.no-aptitude' });
    expect(resolution.state.hero.knownSpellIds ?? []).not.toContain('spell.frost-shard');
    expect(
      resolution.state.items.find((item) => item.itemId === 'item.zzz-frost-shard-tome.1'),
    ).toBeDefined();

    assertSaveRoundTrips(resolution.state);
  });

  it('casts spell.recall through dispatchIntent: anchors the floor, emits hero.recalled, and the session layer auto-moves to town', () => {
    const { run } = casterRunWithTown();
    const dungeonFloorId = run.activeFloorId;

    // Mirrors dispatch.test.ts's recall fixture: the PlayerIntent 'cast' type declares `target` as
    // a non-null Point, but a self-cast spell (spell.recall's targetingId is target.self) is
    // dispatched with `target: null` at runtime -- test files are excluded from this package's
    // tsc build (see tsconfig.json's `include`), so this isn't type-checked, only exercised.
    const outcome = dispatchIntent(
      run,
      {
        type: 'cast',
        spellId: 'spell.recall',
        target: null as unknown as { x: number; y: number },
      },
      { pack, commandId: 'command.recall', expectedRevision: run.revision },
    );

    expect(outcome.kind).toBe('transition');
    if (outcome.kind !== 'transition') throw new Error('expected transition outcome');
    expect(outcome.run.activeFloorId).toBe('floor.depth-000');
    expect(outcome.run.returnAnchorFloorId).toBe(dungeonFloorId);
    expect(outcome.onboardingIntentType).toBe('recall');
    expect(outcome.events.some((event) => event.type === 'hero.recalled')).toBe(true);

    assertSaveRoundTrips(outcome.run);

    // The town's own descend intent now routes to the anchored dungeon floor instead of
    // generating a fresh one -- Task 9's session wiring in dispatch.ts.
    const town = outcome.run.floors.find((floor) => floor.floorId === outcome.run.activeFloorId)!;
    const heroInTown = outcome.run.actors.find((actor) => actor.playerControlled)!;
    const atStairDown: ActiveRun = {
      ...outcome.run,
      actors: outcome.run.actors.map((actor) =>
        actor.actorId === heroInTown.actorId
          ? { ...actor, x: town.stairDown!.x, y: town.stairDown!.y }
          : actor,
      ),
    };

    const returned = dispatchIntent(
      atStairDown,
      { type: 'descend' },
      { pack, commandId: 'command.return', expectedRevision: atStairDown.revision },
    );

    expect(returned.kind).toBe('transition');
    if (returned.kind !== 'transition') throw new Error('expected transition outcome');
    expect(returned.run.activeFloorId).toBe(dungeonFloorId);
    expect(returned.run.returnAnchorFloorId).toBeUndefined();

    assertSaveRoundTrips(returned.run);
  });
});
