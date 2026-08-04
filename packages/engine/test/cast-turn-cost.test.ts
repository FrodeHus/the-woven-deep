import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack, SpellContentEntry } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { createGameplayDemoRun, resolveCommand, type ActiveRun } from '../src/index.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

/** The gameplay demo run with caster aptitude and a single cave rat placed one cell east of the
 * hero. The demo seeds two cave rats: only the second is moved, since stacking both on one cell
 * makes the target ambiguous and silently invalidates every melee comparison. */
function runWithAdjacentRat(): { run: ActiveRun; target: { x: number; y: number } } {
  const { run } = createGameplayDemoRun(pack);
  const hero = run.actors.find((actor) => actor.playerControlled)!;
  const target = { x: hero.x + 1, y: hero.y };
  const rat = run.actors.filter((actor) => actor.contentId === 'monster.cave-rat')[1]!;
  return {
    run: {
      ...run,
      hero: { ...run.hero, classTags: ['loomcaller'] },
      // Deep health headroom keeps the rat alive across the whole sequence, so every command in
      // the comparison resolves against the same standing target.
      actors: run.actors.map((actor) =>
        actor.actorId === rat.actorId
          ? { ...actor, ...target, health: 500, maxHealth: 500, awareActorIds: [hero.actorId] }
          : actor,
      ),
    },
    target,
  };
}

function heroOf(run: ActiveRun) {
  return run.actors.find((actor) => actor.playerControlled)!;
}

describe('casting costs a turn', () => {
  it('charges the caster the full readiness threshold, exactly like a move', () => {
    const { run, target } = runWithAdjacentRat();
    const cast = resolveCommand(
      run,
      {
        type: 'cast',
        commandId: 'command.cast',
        expectedRevision: run.revision,
        spellId: 'spell.ember-bolt',
        target,
      },
      { content: pack },
    );
    const moved = resolveCommand(
      run,
      {
        type: 'move',
        commandId: 'command.move',
        expectedRevision: run.revision,
        direction: 'north',
      },
      { content: pack },
    );
    expect(cast.result.status).toBe('applied');
    expect(moved.result.status).toBe('applied');
    // Same turn, same world time, same post-step readiness: a cast buys no extra tempo over the
    // cheapest ordinary action.
    expect(cast.result).toMatchObject({ turn: moved.result.turn });
    expect(cast.state.worldTime).toBe(moved.state.worldTime);
    expect(heroOf(cast.state).energy).toBe(heroOf(moved.state).energy);
  });

  it('lets a hostile act once per cast, never letting a caster chain the whole weave pool', () => {
    const { run, target } = runWithAdjacentRat();
    const ratId = run.actors.find(
      (actor) => actor.x === target.x && actor.y === target.y && !actor.playerControlled,
    )!.actorId;
    let state = run;
    const energies: number[] = [];
    for (let index = 0; index < 4; index += 1) {
      const resolved = resolveCommand(
        state,
        {
          type: 'cast',
          commandId: `command.cast-${String(index)}`,
          expectedRevision: state.revision,
          spellId: 'spell.ember-bolt',
          target,
        },
        { content: pack },
      );
      expect(resolved.result.status).toBe('applied');
      state = resolved.state;
      energies.push(state.actors.find((actor) => actor.actorId === ratId)!.energy);
    }
    // The rat (speed 110 against the hero's 100) banks its leftover energy at a steady rate: it
    // took a turn of its own between every cast. A cast that skipped the world step would leave
    // this flat.
    expect(state.turn).toBe(4);
    expect(energies).toStrictEqual([10, 20, 30, 40]);
  });

  it('spends a full turn even for an AoE cast', () => {
    const { run, target } = runWithAdjacentRat();
    const resolved = resolveCommand(
      run,
      {
        type: 'cast',
        commandId: 'command.cast-fireball',
        expectedRevision: run.revision,
        spellId: 'spell.fireball',
        target,
      },
      { content: pack },
    );
    expect(resolved.result.status).toBe('applied');
    expect(resolved.state.turn).toBe(1);
    expect(resolved.state.worldTime).toBe(1);
  });
});

/** The wax-crawler cluster the gameplay demo seeds around (9..10, 5..6): speed 65 against the
 * hero's 100, which is the case worth pinning -- a monster slow enough that its retaliation could
 * plausibly be skipped. The hero is walked to the cluster rather than the cluster teleported to the
 * hero: relocating a grouped monster strands its group and parks it in `hold`/`regroup`, where it
 * never swings at all, which would make this test pass for entirely the wrong reason. */
function runBesideSlowMonsters(): ActiveRun {
  const { run } = createGameplayDemoRun(pack);
  return {
    ...run,
    hero: { ...run.hero, classTags: ['loomcaller'] },
    actors: run.actors.map((actor) =>
      actor.playerControlled
        ? { ...actor, x: 11, y: 5, attributes: { ...actor.attributes, vitality: 30 }, health: 40 }
        : // Health headroom only -- position and behaviour state untouched -- so the caster's own
          // damage cannot shrink the sample by killing the monsters whose turns are being counted.
          actor.contentId === 'monster.wax-crawler'
          ? { ...actor, health: 900, maxHealth: 900 }
          : actor,
    ),
  };
}

describe('a slow adjacent monster answers a cast', () => {
  it('lands the same bump-attacks whether the hero casts or stands still', () => {
    const start = runBesideSlowMonsters();
    const crawlerIds = new Set(
      start.actors
        .filter((actor) => actor.contentId === 'monster.wax-crawler')
        .map((actor) => actor.actorId),
    );
    const adjacentCrawlers = start.actors.filter(
      (actor) =>
        crawlerIds.has(actor.actorId) &&
        Math.max(Math.abs(actor.x - 11), Math.abs(actor.y - 5)) === 1,
    );
    expect(adjacentCrawlers.length).toBeGreaterThan(0);
    expect(adjacentCrawlers.every((actor) => actor.speed < heroOf(start).speed)).toBe(true);

    // Weave and health are restored before each command so neither branch stalls on an empty pool
    // or a dead hero. Position, energy, RNG and every other actor are left alone.
    const restore = (state: ActiveRun): ActiveRun => ({
      ...state,
      actors: state.actors.map((actor) =>
        actor.playerControlled ? { ...actor, weave: 99, health: actor.maxHealth } : actor,
      ),
    });
    const target = { x: adjacentCrawlers[0]!.x, y: adjacentCrawlers[0]!.y };

    function bumpAttacksOver(
      makeCommand: (index: number, state: ActiveRun) => Parameters<typeof resolveCommand>[1],
    ): number {
      let state = start;
      let attacks = 0;
      for (let index = 0; index < 12; index += 1) {
        const resolved = resolveCommand(restore(state), makeCommand(index, state), {
          content: pack,
        });
        expect(resolved.result.status).toBe('applied');
        state = resolved.state;
        attacks += resolved.events.filter(
          (event) =>
            event.type === 'actor.turn.completed' &&
            event.actionType === 'bump-attack' &&
            crawlerIds.has(event.actorId),
        ).length;
      }
      return attacks;
    }

    const whileWaiting = bumpAttacksOver((index, state) => ({
      type: 'wait',
      commandId: `command.wait-${String(index)}`,
      expectedRevision: state.revision,
    }));
    const whileCasting = bumpAttacksOver((index, state) => ({
      type: 'cast',
      commandId: `command.cast-${String(index)}`,
      expectedRevision: state.revision,
      spellId: 'spell.ember-bolt',
      target,
    }));

    expect(whileWaiting).toBeGreaterThan(0);
    expect(whileCasting).toBe(whileWaiting);
  });
});

describe('spell action costs', () => {
  it('gives every spell in the pack a cost the scheduler can charge', () => {
    const spells = pack.entries.filter(
      (entry): entry is SpellContentEntry => entry.kind === 'spell',
    );
    expect(spells.length).toBeGreaterThan(0);
    for (const spell of spells) {
      expect(spell.actionCost).toBeGreaterThan(0);
    }
  });
});
