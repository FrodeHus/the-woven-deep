import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { computeIllumination, generateTownFloor, stableJson, TOWN_FLOOR_ID } from '../src/index.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

function tileAt(
  floor: ReturnType<typeof generateTownFloor>['floor'],
  point: { x: number; y: number },
): number {
  return floor.tiles[point.y * floor.width + point.x]!;
}

describe('TOWN_FLOOR_ID', () => {
  it('formats depth 0 as floor.depth-000', () => {
    expect(TOWN_FLOOR_ID).toBe('floor.depth-000');
  });
});

describe('generateTownFloor', () => {
  it('is deterministic: identical byte-stable output across repeated calls', () => {
    const first = generateTownFloor(pack);
    const second = generateTownFloor(pack);
    expect(stableJson(first.floor)).toBe(stableJson(second.floor));
    expect(stableJson(first)).toBe(stableJson(second));
  });

  it('produces a depth-0 floor with no stair-up and a stair-down at the dungeon entrance', () => {
    const { floor } = generateTownFloor(pack);
    expect(floor.floorId).toBe(TOWN_FLOOR_ID);
    expect(floor.depth).toBe(0);
    expect(floor.stairUp).toBeNull();
    expect(floor.stairDown).not.toBeNull();
    expect(floor.tiles).toHaveLength(floor.width * floor.height);
    expect(tileAt(floor, floor.stairDown!)).toBe(5); // stair-down tile id
  });

  it('resolves the house door and every merchant slot to a placement slot on the floor', () => {
    const { floor, houseDoor, merchantSlots } = generateTownFloor(pack);
    expect(tileAt(floor, houseDoor)).toBe(2); // closed-door tile id

    for (const point of [merchantSlots.provisioner, merchantSlots.arms, merchantSlots.curios]) {
      expect(tileAt(floor, point)).toBe(1); // floor tile id
    }

    const slotIds = floor.placementSlots.map((slot) => slot.slotId);
    expect(slotIds).toEqual([...slotIds].sort());
    expect(floor.placementSlots).toHaveLength(5);
    expect(floor.placementSlots.every((slot) => slot.required)).toBe(true);
  });

  it('places the hero at a walkable floor tile adjacent to (not on) the dungeon entrance', () => {
    const { floor, entrancePlaza } = generateTownFloor(pack);
    const stairDown = floor.stairDown!;
    expect(tileAt(floor, entrancePlaza)).toBe(1); // floor tile id
    expect(entrancePlaza).not.toEqual(stairDown);
    expect(
      Math.max(Math.abs(entrancePlaza.x - stairDown.x), Math.abs(entrancePlaza.y - stairDown.y)),
    ).toBe(1);
  });

  it('fully lights every merchant slot cell', () => {
    const { floor, merchantSlots } = generateTownFloor(pack);
    const illumination = computeIllumination({
      width: floor.width,
      height: floor.height,
      tiles: floor.tiles,
      ambient: floor.ambient,
      lights: floor.lights,
      actors: new Map(),
    });
    for (const point of [merchantSlots.provisioner, merchantSlots.arms, merchantSlots.curios]) {
      const index = point.y * floor.width + point.x;
      expect(illumination.intensity[index]).toBeGreaterThan(0);
    }
  });
});
