import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createNewRun, DEFAULT_GUEST_HERO, decodeActiveRun, descendToNextFloor, encodeActiveRun,
  heroActor, resolveCommand, validateActiveRun, depthFloorId,
  type ActiveRun,
  type GameCommand,
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

describe('depthFloorId', () => {
  it('formats floor IDs with 3-digit zero-padding for proper lexicographic sorting', () => {
    expect(depthFloorId(1)).toBe('floor.depth-001');
    expect(depthFloorId(99)).toBe('floor.depth-099');
    expect(depthFloorId(100)).toBe('floor.depth-100');
    expect(depthFloorId(999)).toBe('floor.depth-999');
  });

  it('ensures correct string comparison ordering at deep depths', () => {
    expect(depthFloorId(1) < depthFloorId(2)).toBe(true);
    expect(depthFloorId(99) < depthFloorId(100)).toBe(true);
    expect(depthFloorId(999) > depthFloorId(100)).toBe(true);
  });

  it('throws RangeError for depths beyond 999', () => {
    expect(() => depthFloorId(1000)).toThrow(RangeError);
  });
});

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
    expect(() => descendToNextFloor(concluded, { content: pack })).toThrow(/conclud/i);
  });

  it('descends cleanly after a walk-then-descend sequence, clearing stale command history', () => {
    const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const stairDown = run.floors[0]!.stairDown!;

    // Directions paired with the offset that lands on stairDown from an adjacent tile.
    const directionsFromOffset: ReadonlyArray<{ direction: 'north' | 'northeast' | 'east' | 'southeast' | 'south' | 'southwest' | 'west' | 'northwest'; dx: number; dy: number }> = [
      { direction: 'south', dx: 0, dy: -1 }, { direction: 'north', dx: 0, dy: 1 },
      { direction: 'east', dx: -1, dy: 0 }, { direction: 'west', dx: 1, dy: 0 },
      { direction: 'southeast', dx: -1, dy: -1 }, { direction: 'northwest', dx: 1, dy: 1 },
      { direction: 'southwest', dx: 1, dy: -1 }, { direction: 'northeast', dx: -1, dy: 1 },
    ];

    let walked: ActiveRun | undefined;
    for (const { direction, dx, dy } of directionsFromOffset) {
      const adjacent = { x: stairDown.x + dx, y: stairDown.y + dy };
      let staged: ActiveRun;
      try {
        staged = teleportHeroTo(run, adjacent);
      } catch {
        continue;
      }
      const command: GameCommand = { type: 'move', commandId: `command.walk-${direction}`, expectedRevision: staged.revision, direction };
      const resolution = resolveCommand(staged, command, { content: pack });
      const hero = heroActor(resolution.state);
      if (resolution.result.status === 'applied' && hero.x === stairDown.x && hero.y === stairDown.y) {
        walked = resolution.state;
        break;
      }
    }
    if (!walked) throw new Error('test setup failure: could not walk the hero onto stair-down from an adjacent tile');
    expect(walked.recentCommands.length).toBeGreaterThan(0);
    // Sanity: the walked state is itself a valid save on floor 1 before we ever descend.
    validateActiveRun(walked);

    const descended = descendToNextFloor(walked, { content: pack });
    expect(descended.state.recentCommands).toEqual([]);
    expect(heroActor(descended.state).floorId).toBe(descended.state.activeFloorId);
  });
});
