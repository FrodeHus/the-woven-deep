import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  computeIllumination,
  createNewRun,
  DEFAULT_GUEST_HERO,
  depthFloorId,
  descendToNextFloor,
  FINAL_CHAMBER_DEPTH,
  generateFinalChamberFloor,
  heroActor,
  stableJson,
  validateActiveRun,
  type ActiveRun,
} from '../src/index.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

const SEED = [7, 14, 21, 28] as const;

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

/** Descends the given run all the way from its current floor to depth 19, teleporting the hero
 * onto each new floor's stair-down so it never needs to actually walk there. */
function descendToDepth19(run: ActiveRun): ActiveRun {
  let state = run;
  while (true) {
    const activeFloor = state.floors.find((floor) => floor.floorId === state.activeFloorId);
    if (activeFloor === undefined) throw new Error('test setup failure: active floor missing');
    if (activeFloor.depth >= 19) return state;
    const stairDown = activeFloor.stairDown;
    if (stairDown === null) throw new Error('test setup failure: floor has no stair-down');
    const onStairs = teleportHeroTo(state, stairDown);
    state = descendToNextFloor(onStairs, { content: pack }).state;
  }
}

function heartMarkerPoint(
  floor: ReturnType<typeof generateFinalChamberFloor>,
): Readonly<{ x: number; y: number }> {
  const slot = floor.placementSlots.find((candidate) => candidate.tags.includes('heart'));
  if (!slot) throw new Error('test setup failure: final chamber floor has no heart marker slot');
  return { x: slot.x, y: slot.y };
}

describe('FINAL_CHAMBER_DEPTH', () => {
  it('is depth 20', () => {
    expect(FINAL_CHAMBER_DEPTH).toBe(20);
  });
});

describe('generateFinalChamberFloor', () => {
  it('produces a fixed floor at FINAL_CHAMBER_DEPTH with a stair-up and no stair-down', () => {
    const floor = generateFinalChamberFloor(pack);
    expect(floor.depth).toBe(FINAL_CHAMBER_DEPTH);
    expect(floor.floorId).toBe(depthFloorId(FINAL_CHAMBER_DEPTH));
    expect(floor.stairUp).not.toBeNull();
    expect(floor.stairDown).toBeNull();
  });

  it('is deterministic: identical byte-stable output across repeated calls', () => {
    const first = generateFinalChamberFloor(pack);
    const second = generateFinalChamberFloor(pack);
    expect(stableJson(first)).toBe(stableJson(second));
  });

  it('is fully lit: every walkable cell has nonzero illumination', () => {
    const floor = generateFinalChamberFloor(pack);
    const illumination = computeIllumination({
      width: floor.width,
      height: floor.height,
      tiles: floor.tiles,
      ambient: floor.ambient,
      lights: floor.lights,
      actors: new Map(),
    });
    for (let index = 0; index < floor.tiles.length; index += 1) {
      expect(illumination.intensity[index]).toBeGreaterThan(0);
    }
  });

  it('contains the authored Heart marker cell', () => {
    const floor = generateFinalChamberFloor(pack);
    const heart = heartMarkerPoint(floor);
    expect(heart.x).toBeGreaterThanOrEqual(0);
    expect(heart.y).toBeGreaterThanOrEqual(0);
    const heartSlot = floor.placementSlots.find((candidate) => candidate.tags.includes('heart'));
    expect(heartSlot).toBeDefined();
    expect(heartSlot!.required).toBe(true);
  });
});

describe('descendToNextFloor into the Final Chamber', () => {
  it('yields the authored chamber floor (not a procedural floor) when descending from depth 19', () => {
    const fresh = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const atDepth19 = descendToDepth19(fresh);
    const activeFloor = atDepth19.floors.find(
      (floor) => floor.floorId === atDepth19.activeFloorId,
    )!;
    expect(activeFloor.depth).toBe(19);
    const stairDown = activeFloor.stairDown!;
    const onStairs = teleportHeroTo(atDepth19, stairDown);

    const descended = descendToNextFloor(onStairs, { content: pack });

    const chamberFloorId = depthFloorId(FINAL_CHAMBER_DEPTH);
    expect(descended.state.activeFloorId).toBe(chamberFloorId);
    const chamberFloor = descended.state.floors.find((floor) => floor.floorId === chamberFloorId)!;
    expect(chamberFloor.depth).toBe(FINAL_CHAMBER_DEPTH);

    const expected = generateFinalChamberFloor(pack);
    expect(chamberFloor.tiles).toEqual(expected.tiles);
    expect(chamberFloor.width).toBe(expected.width);
    expect(chamberFloor.height).toBe(expected.height);
    expect(chamberFloor.stairUp).toEqual(expected.stairUp);
    expect(chamberFloor.stairDown).toBeNull();

    const hero = heroActor(descended.state);
    expect(hero.floorId).toBe(chamberFloorId);
    expect({ x: hero.x, y: hero.y }).toEqual(expected.stairUp);
  });
});
