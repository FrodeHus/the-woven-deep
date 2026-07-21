import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { resolve } from 'node:path';
import { createGameplayDemoRun, resolveCommand, type ActiveRun } from '../src/index.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

/** The gameplay demo hero with the cave rat relocated one cell east, in melee range and lit, so a
 * ranged spell has a valid living target. */
function runWithAdjacentRat(overrides: Partial<ActiveRun['actors'][number]> = {}): {
  run: ActiveRun;
  target: { x: number; y: number };
} {
  const { run } = createGameplayDemoRun(pack);
  const hero = run.actors.find((actor) => actor.playerControlled)!;
  const target = { x: hero.x + 1, y: hero.y };
  const actors = run.actors.map((actor) =>
    actor.contentId === 'monster.cave-rat'
      ? { ...actor, ...target }
      : actor.playerControlled
        ? { ...actor, ...overrides }
        : actor,
  );
  return { run: { ...run, actors }, target };
}

describe('the Weave magic resource', () => {
  it('consumes a spell weaveCost on a successful cast', () => {
    const { run, target } = runWithAdjacentRat();
    const hero = run.actors.find((actor) => actor.playerControlled)!;
    const result = resolveCommand(
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

    expect(result.result.status).toBe('applied');
    const heroAfter = result.state.actors.find((actor) => actor.playerControlled)!;
    // Ember bolt costs 3 Weave; the caster spends it and the target takes the fire damage.
    expect(heroAfter.weave).toBe(hero.weave - 3);
    const rat = result.state.actors.find((actor) => actor.contentId === 'monster.cave-rat')!;
    expect(rat.health).toBeLessThan(hero.maxHealth);
  });

  it('rejects a cast below the spell weaveCost without advancing the world or spending randomness', () => {
    const { run, target } = runWithAdjacentRat({ weave: 2 });
    const result = resolveCommand(
      run,
      {
        type: 'cast',
        commandId: 'command.cast-poor',
        expectedRevision: run.revision,
        spellId: 'spell.ember-bolt',
        target,
      },
      { content: pack },
    );

    expect(result.result).toMatchObject({ status: 'invalid', reason: 'cast.insufficient-weave' });
    expect(result.state.revision).toBe(run.revision);
    expect(result.state.turn).toBe(run.turn);
    expect(result.state.rng).toEqual(run.rng);
    const heroAfter = result.state.actors.find((actor) => actor.playerControlled)!;
    expect(heroAfter.weave).toBe(2);
    const rat = result.state.actors.find((actor) => actor.contentId === 'monster.cave-rat')!;
    expect(rat.health).toBeGreaterThan(0);
  });
});
