import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createNewRun, DEFAULT_GUEST_HERO, decodeActiveRun, descendToNextFloor, encodeActiveRun,
  heroActor, validateActiveRun,
  type ActiveRun,
} from '../src/index.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

const SEED = [11, 22, 33, 44] as const;

function teleportHeroTo(run: ActiveRun, position: Readonly<{ x: number; y: number }>): ActiveRun {
  const hero = heroActor(run);
  const teleported: ActiveRun = {
    ...run,
    actors: run.actors.map((actor) => actor.actorId === hero.actorId ? { ...actor, x: position.x, y: position.y } : actor),
  };
  return validateActiveRun(teleported);
}

describe('descendToNextFloor', () => {
  it('generates and enters the next depth when the hero stands on stair-down', () => {
    const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const stairDown = run.floors[0]!.stairDown!;
    const onStairs = teleportHeroTo(run, stairDown);
    const descended = descendToNextFloor(onStairs, { content: pack });
    expect(descended.state.floors).toHaveLength(2);
    expect(descended.state.floors[1]?.depth).toBe(2);
    expect(descended.state.activeFloorId).toBe(descended.state.floors[1]?.floorId);
    const hero = heroActor(descended.state);
    expect({ x: hero.x, y: hero.y }).toEqual(descended.state.floors[1]?.stairUp);
    expect(descended.state.metrics.floorsEntered).toBe(2);
    expect(descended.state.metrics.deepestDepth).toBe(2);
  });

  it('is deterministic and byte-stable across a save/reload boundary', () => {
    const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const onStairs = teleportHeroTo(run, run.floors[0]!.stairDown!);
    const direct = descendToNextFloor(onStairs, { content: pack });
    const reloaded = descendToNextFloor(decodeActiveRun(encodeActiveRun(onStairs)), { content: pack });
    expect(encodeActiveRun(direct.state)).toBe(encodeActiveRun(reloaded.state));
  });

  it('throws when the hero is not on stair-down and when the run is concluded', () => {
    const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    expect(() => descendToNextFloor(run, { content: pack })).toThrow(/stair/i);

    const onStairs = teleportHeroTo(run, run.floors[0]!.stairDown!);
    const concluded: ActiveRun = {
      ...onStairs,
      conclusion: {
        completionType: 'died',
        cause: { killerContentId: null, depth: 1, turn: 1, worldTime: 1 },
        concludedAtRevision: 1,
        finalized: false,
      },
    };
    expect(() => descendToNextFloor(concluded, { content: pack })).toThrow();
  });
});
