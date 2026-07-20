import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  ascendToPreviousFloor,
  createNewRun,
  DEFAULT_GUEST_HERO,
  decodeActiveRun,
  descendToNextFloor,
  encodeActiveRun,
  enterStoredFloor,
  heroActor,
  resolveCommand,
  stableJson,
  validateActiveRun,
  depthFloorId,
  type ActiveRun,
  type FloorSnapshot,
  type GameCommand,
  type OpaqueId,
} from '../src/index.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

const SEED = [11, 22, 33, 44] as const;

function floorById(run: ActiveRun, floorId: OpaqueId): FloorSnapshot {
  const floor = run.floors.find((candidate) => candidate.floorId === floorId);
  if (floor === undefined) throw new Error(`test setup failure: floor ${floorId} missing from run`);
  return floor;
}

function teleportHeroTo(run: ActiveRun, position: Readonly<{ x: number; y: number }>): ActiveRun {
  const hero = heroActor(run);
  const teleported: ActiveRun = {
    ...run,
    actors: run.actors.map((actor) =>
      actor.actorId === hero.actorId ? { ...actor, x: position.x, y: position.y } : actor,
    ),
  };
  return validateActiveRun(teleported);
}

describe('depthFloorId', () => {
  it('formats floor IDs with 3-digit zero-padding for proper lexicographic sorting', () => {
    expect(depthFloorId(0)).toBe('floor.depth-000');
    expect(depthFloorId(1)).toBe('floor.depth-001');
    expect(depthFloorId(99)).toBe('floor.depth-099');
    expect(depthFloorId(100)).toBe('floor.depth-100');
    expect(depthFloorId(999)).toBe('floor.depth-999');
  });

  it('ensures correct string comparison ordering at deep depths', () => {
    expect(depthFloorId(0) < depthFloorId(1)).toBe(true);
    expect(depthFloorId(1) < depthFloorId(2)).toBe(true);
    expect(depthFloorId(99) < depthFloorId(100)).toBe(true);
    expect(depthFloorId(999) > depthFloorId(100)).toBe(true);
  });

  it('throws RangeError for depths below 0 and beyond 999', () => {
    expect(() => depthFloorId(-1)).toThrow(RangeError);
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
    expect(descended.state.floors[1]?.depth).toBe(1);
    expect(descended.state.activeFloorId).toBe(descended.state.floors[1]?.floorId);
    const hero = heroActor(descended.state);
    expect({ x: hero.x, y: hero.y }).toEqual(descended.state.floors[1]?.stairUp);
    // The town (depth 0) never counts toward floorsEntered/deepestDepth; this first descent is the
    // hero's first recorded floor entry.
    expect(descended.state.metrics.floorsEntered).toBe(1);
    expect(descended.state.metrics.deepestDepth).toBe(1);
  });

  it('is deterministic and byte-stable across a save/reload boundary', () => {
    const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const onStairs = teleportHeroTo(run, run.floors[0]!.stairDown!);
    const direct = descendToNextFloor(onStairs, { content: pack });
    const reloaded = descendToNextFloor(decodeActiveRun(encodeActiveRun(onStairs)), {
      content: pack,
    });
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
    const directionsFromOffset: ReadonlyArray<{
      direction:
        'north' | 'northeast' | 'east' | 'southeast' | 'south' | 'southwest' | 'west' | 'northwest';
      dx: number;
      dy: number;
    }> = [
      { direction: 'south', dx: 0, dy: -1 },
      { direction: 'north', dx: 0, dy: 1 },
      { direction: 'east', dx: -1, dy: 0 },
      { direction: 'west', dx: 1, dy: 0 },
      { direction: 'southeast', dx: -1, dy: -1 },
      { direction: 'northwest', dx: 1, dy: 1 },
      { direction: 'southwest', dx: 1, dy: -1 },
      { direction: 'northeast', dx: -1, dy: 1 },
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
      const command: GameCommand = {
        type: 'move',
        commandId: `command.walk-${direction}`,
        expectedRevision: staged.revision,
        direction,
      };
      const resolution = resolveCommand(staged, command, { content: pack });
      const hero = heroActor(resolution.state);
      if (
        resolution.result.status === 'applied' &&
        hero.x === stairDown.x &&
        hero.y === stairDown.y
      ) {
        walked = resolution.state;
        break;
      }
    }
    if (!walked)
      throw new Error(
        'test setup failure: could not walk the hero onto stair-down from an adjacent tile',
      );
    expect(walked.recentCommands.length).toBeGreaterThan(0);
    // Sanity: the walked state is itself a valid save on floor 1 before we ever descend.
    validateActiveRun(walked);

    const descended = descendToNextFloor(walked, { content: pack });
    expect(descended.state.recentCommands).toEqual([]);
    expect(heroActor(descended.state).floorId).toBe(descended.state.activeFloorId);
  });
});

describe('ascendToPreviousFloor / stored-floor descent round-trip', () => {
  it('re-enters a stored floor byte-identically, without regenerating or rerolling anything', () => {
    const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const onTownStairs = teleportHeroTo(run, run.floors[0]!.stairDown!);
    const toD1 = descendToNextFloor(onTownStairs, { content: pack });
    const d1FloorId = toD1.state.activeFloorId;
    const d1Snapshot = stableJson(floorById(toD1.state, d1FloorId));

    const onD1StairUp = teleportHeroTo(
      toD1.state,
      toD1.state.floors.find((floor) => floor.floorId === d1FloorId)!.stairUp!,
    );
    const ascended = ascendToPreviousFloor(onD1StairUp, { content: pack });
    expect(ascended.events).toEqual([]);
    expect(ascended.state.activeFloorId).toBe(depthFloorId(0));
    const heroInTown = heroActor(ascended.state);
    expect({ x: heroInTown.x, y: heroInTown.y }).toEqual(ascended.state.floors[0]!.stairDown);

    const onTownStairsAgain = teleportHeroTo(ascended.state, ascended.state.floors[0]!.stairDown!);
    const backToD1 = descendToNextFloor(onTownStairsAgain, { content: pack });
    expect(backToD1.events).toEqual([]);
    expect(backToD1.state.activeFloorId).toBe(d1FloorId);
    const hero = heroActor(backToD1.state);
    expect({ x: hero.x, y: hero.y }).toEqual(floorById(backToD1.state, d1FloorId).stairUp);
    expect(stableJson(floorById(backToD1.state, d1FloorId))).toBe(d1Snapshot);
  });

  it('throws when the hero is not on stair-up, when ascending from town, and when the run is concluded', () => {
    const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const onTownStairs = teleportHeroTo(run, run.floors[0]!.stairDown!);
    const toD1 = descendToNextFloor(onTownStairs, { content: pack });

    // Not standing on stair-up: descending lands the hero ON stair-up, so move off it first.
    const d1 = toD1.state.floors.find((floor) => floor.floorId === toD1.state.activeFloorId)!;
    const offStairs = teleportHeroTo(toD1.state, d1.stairDown!);
    expect(() => ascendToPreviousFloor(offStairs, { content: pack })).toThrow(/stair/i);

    // Town has no stair-up at all: ascending from town must be guarded off.
    const backInTown = ascendToPreviousFloor(
      teleportHeroTo(
        toD1.state,
        toD1.state.floors.find((floor) => floor.floorId === toD1.state.activeFloorId)!.stairUp!,
      ),
      { content: pack },
    );
    expect(() => ascendToPreviousFloor(backInTown.state, { content: pack })).toThrow(/stair/i);

    const onD1StairUp = teleportHeroTo(
      toD1.state,
      toD1.state.floors.find((floor) => floor.floorId === toD1.state.activeFloorId)!.stairUp!,
    );
    const concluded: ActiveRun = {
      ...onD1StairUp,
      conclusion: {
        completionType: 'died',
        cause: { killerContentId: null, depth: 1, turn: 1, worldTime: 1 },
        concludedAtRevision: 1,
        finalized: false,
      },
    };
    expect(() => ascendToPreviousFloor(concluded, { content: pack })).toThrow(/conclud/i);
  });
});

describe('enterStoredFloor', () => {
  it('rejects an arrival tile that is not walkable on the target snapshot', () => {
    const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const townFloor = run.floors[0]!;
    // The dungeon-entrance tile itself is stair-down terrain (walkable); pick a coordinate that is
    // guaranteed to be a wall by construction: outside the vault's own footprint is out of bounds,
    // so instead scan for the first non-walkable tile inside the floor.
    const tiles = townFloor.tiles;
    let blockedIndex = -1;
    for (let index = 0; index < tiles.length; index += 1) {
      if (tiles[index] === 0) {
        blockedIndex = index;
        break;
      }
    }
    if (blockedIndex === -1)
      throw new Error('test setup failure: town floor has no wall tile to test against');
    const blocked = {
      x: blockedIndex % townFloor.width,
      y: Math.floor(blockedIndex / townFloor.width),
    };
    expect(() => enterStoredFloor(run, { floorId: townFloor.floorId, arrival: blocked })).toThrow(
      /walkable/i,
    );
  });

  it('rejects a floorId that does not exist in run.floors', () => {
    const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    expect(() =>
      enterStoredFloor(run, { floorId: depthFloorId(7), arrival: { x: 0, y: 0 } }),
    ).toThrow(/exist/i);
  });
});

describe('floorsEntered accounting across stored traversal', () => {
  it('only records first-ever entries: town -> d1 -> d2 -> ascend d1 -> ascend town -> descend d1 -> descend d2', () => {
    const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    expect(run.metrics.floorsEntered).toBe(0);

    const toD1 = descendToNextFloor(teleportHeroTo(run, run.floors[0]!.stairDown!), {
      content: pack,
    });
    expect(toD1.state.metrics.floorsEntered).toBe(1);

    const d1 = toD1.state.floors.find((floor) => floor.floorId === toD1.state.activeFloorId)!;
    const toD2 = descendToNextFloor(teleportHeroTo(toD1.state, d1.stairDown!), { content: pack });
    expect(toD2.state.metrics.floorsEntered).toBe(2);

    const d2 = toD2.state.floors.find((floor) => floor.floorId === toD2.state.activeFloorId)!;
    const ascendToD1 = ascendToPreviousFloor(teleportHeroTo(toD2.state, d2.stairUp!), {
      content: pack,
    });
    expect(ascendToD1.state.metrics.floorsEntered).toBe(2);
    expect(ascendToD1.state.activeFloorId).toBe(d1.floorId);

    const ascendToTown = ascendToPreviousFloor(teleportHeroTo(ascendToD1.state, d1.stairUp!), {
      content: pack,
    });
    expect(ascendToTown.state.metrics.floorsEntered).toBe(2);
    expect(ascendToTown.state.activeFloorId).toBe(depthFloorId(0));

    const descendToD1Again = descendToNextFloor(
      teleportHeroTo(ascendToTown.state, ascendToTown.state.floors[0]!.stairDown!),
      { content: pack },
    );
    expect(descendToD1Again.state.metrics.floorsEntered).toBe(2);
    expect(descendToD1Again.state.activeFloorId).toBe(d1.floorId);

    const descendToD2Again = descendToNextFloor(
      teleportHeroTo(descendToD1Again.state, d1.stairDown!),
      { content: pack },
    );
    expect(descendToD2Again.state.metrics.floorsEntered).toBe(2);
    expect(descendToD2Again.state.activeFloorId).toBe(d2.floorId);
  });
});
