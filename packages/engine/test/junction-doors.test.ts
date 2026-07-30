import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack, VaultContentEntry } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  analyzeConnectivity,
  balanceEntry,
  carveJunctionDoors,
  createClassicTheme,
  createDemoRun,
  generateFloor,
  junctionDoorCandidates,
  placeFloorLoot,
  stableJson,
  type DoorFeature,
  type GenerateFloorRequest,
  type RoomBounds,
  type TileId,
  type Uint32State,
  type VaultPlacement,
} from '../src/index.js';

const WIDTH = 21;
const HEIGHT = 11;
const SEED: Uint32State = [0x1357_9bdf, 0x2468_ace0, 0x0f0f_0f0f, 0xdead_beef];

const ROOM_A: RoomBounds = { roomId: 'room.0', left: 2, top: 2, right: 6, bottom: 5 };
const ROOM_B: RoomBounds = { roomId: 'room.1', left: 14, top: 2, right: 18, bottom: 5 };

function index(x: number, y: number): number {
  return y * WIDTH + x;
}

/**
 * Two rooms joined by a single one-wide corridor along `y = 3`. The corridor mouths at `x = 7` and
 * `x = 13` are the only junction cells; the corridor's interior cells touch no room.
 */
function twoRoomTiles(): TileId[] {
  const tiles = Array.from({ length: WIDTH * HEIGHT }, () => 0 as TileId);
  for (const room of [ROOM_A, ROOM_B])
    for (let y = room.top; y <= room.bottom; y += 1)
      for (let x = room.left; x <= room.right; x += 1) tiles[index(x, y)] = 1 as TileId;
  for (let x = 7; x <= 13; x += 1) tiles[index(x, 3)] = 1 as TileId;
  return tiles;
}

interface CarveOverrides {
  readonly tiles?: readonly TileId[];
  readonly stairUp?: Readonly<{ x: number; y: number }> | null;
  readonly stairDown?: Readonly<{ x: number; y: number }> | null;
  readonly vaults?: readonly VaultPlacement[];
  readonly doorTilePercent?: number;
  readonly state?: Uint32State;
}

function carveInput(overrides: CarveOverrides = {}) {
  return {
    width: WIDTH,
    height: HEIGHT,
    tiles: overrides.tiles ?? twoRoomTiles(),
    rooms: [ROOM_A, ROOM_B],
    stairUp: overrides.stairUp === undefined ? { x: 2, y: 2 } : overrides.stairUp,
    stairDown: overrides.stairDown === undefined ? { x: 18, y: 5 } : overrides.stairDown,
    vaults: overrides.vaults ?? [],
    doorTilePercent: overrides.doorTilePercent ?? 100,
    state: overrides.state ?? SEED,
  };
}

function vaultAt(x: number, y: number, width: number, height: number): VaultPlacement {
  return {
    placementId: 'vault-placement.0',
    vaultId: 'vault.test',
    x,
    y,
    width,
    height,
    rotation: 0,
    reflected: false,
    entrances: [{ x: 0, y: 1 }],
  };
}

describe('junction door detection', () => {
  it('detects both one-wide corridor mouths into a room', () => {
    expect(junctionDoorCandidates(carveInput())).toEqual([index(7, 3), index(13, 3)]);
  });

  it('rejects open room interior cells and corridor cells that touch no room', () => {
    const candidates = junctionDoorCandidates(carveInput());
    for (let x = 8; x <= 12; x += 1) expect(candidates).not.toContain(index(x, 3));
    for (let y = ROOM_A.top; y <= ROOM_A.bottom; y += 1)
      for (let x = ROOM_A.left; x <= ROOM_A.right; x += 1)
        expect(candidates).not.toContain(index(x, y));
  });

  it('excludes junctions on or beside a stair cell', () => {
    expect(junctionDoorCandidates(carveInput({ stairUp: { x: 6, y: 3 } }))).toEqual([index(13, 3)]);
    const onMouth = twoRoomTiles();
    onMouth[index(7, 3)] = 4 as TileId;
    expect(junctionDoorCandidates(carveInput({ tiles: onMouth, stairUp: { x: 7, y: 3 } }))).toEqual(
      [index(13, 3)],
    );
  });

  it('excludes junctions inside or beside a vault footprint', () => {
    expect(junctionDoorCandidates(carveInput({ vaults: [vaultAt(14, 2, 5, 4)] }))).toEqual([
      index(7, 3),
    ]);
    expect(junctionDoorCandidates(carveInput({ vaults: [vaultAt(13, 2, 5, 4)] }))).toEqual([
      index(7, 3),
    ]);
  });
});

describe('junction door carving', () => {
  it('converts every eligible junction at one hundred percent', () => {
    const carved = carveJunctionDoors(carveInput({ doorTilePercent: 100 }));
    expect(carved.doorIndexes).toEqual([index(7, 3), index(13, 3)]);
    expect(carved.tiles[index(7, 3)]).toBe(2);
    expect(carved.tiles[index(13, 3)]).toBe(2);
    expect(
      analyzeConnectivity({
        width: WIDTH,
        height: HEIGHT,
        tiles: carved.tiles,
        start: { x: 2, y: 2 },
        target: { x: 18, y: 5 },
      }).connected,
    ).toBe(true);
  });

  it('converts nothing at zero percent and leaves the tiles untouched', () => {
    const tiles = twoRoomTiles();
    const carved = carveJunctionDoors(carveInput({ tiles, doorTilePercent: 0 }));
    expect(carved.doorIndexes).toEqual([]);
    expect(carved.tiles.some((tile) => tile === 2)).toBe(false);
    expect(stableJson([...carved.tiles])).toBe(stableJson([...tiles]));
  });

  it('never places a door beside an existing door tile', () => {
    const tiles = twoRoomTiles();
    tiles[index(6, 3)] = 2 as TileId;
    const carved = carveJunctionDoors(carveInput({ tiles, doorTilePercent: 100 }));
    expect(carved.doorIndexes).toEqual([index(13, 3)]);
  });

  it('is a pure deterministic function of its input', () => {
    const first = carveJunctionDoors(carveInput({ doorTilePercent: 50 }));
    const second = carveJunctionDoors(carveInput({ doorTilePercent: 50 }));
    expect(stableJson(first)).toBe(stableJson(second));
  });

  it('rejects a percent outside zero through one hundred', () => {
    expect(() => carveJunctionDoors(carveInput({ doorTilePercent: 101 }))).toThrow(RangeError);
    expect(() => carveJunctionDoors(carveInput({ doorTilePercent: -1 }))).toThrow(RangeError);
    expect(() => carveJunctionDoors(carveInput({ doorTilePercent: 1.5 }))).toThrow(RangeError);
  });
});

describe('generated door substrate', () => {
  let content: CompiledContentPack;
  let vaults: VaultContentEntry[];

  beforeAll(async () => {
    content = await compileContentDirectory({
      rootDir: resolve(import.meta.dirname, '../../../content'),
    });
    vaults = content.entries.filter((entry): entry is VaultContentEntry => entry.kind === 'vault');
  });

  const width = 80;
  const height = 25;
  const ambient = { color: [19, 23, 31] as const, strength: 7 };

  function floorRequest(seed: Uint32State, depth: number): GenerateFloorRequest {
    return {
      floorId: 'floor.generated-01',
      floorSeed: seed,
      depth,
      width,
      height,
      theme: createClassicTheme(width, height, { ambient }),
      vaults,
      doorTilePercent: balanceEntry(content).generation.doorTilePercent,
    };
  }

  const seeds: readonly Uint32State[] = Array.from(
    { length: 12 },
    (_, offset) =>
      [
        (0x1234_0001 + offset * 0x0011_2233) >>> 0,
        (0x5678_0002 + offset * 0x0044_5566) >>> 0,
        (0x9abc_0003 + offset * 0x0077_8899) >>> 0,
        (0xdef0_0004 + offset * 0x00aa_bbcc) >>> 0,
      ] as Uint32State,
  );

  it('emits door tiles on shallow generated floors and keeps the stairs reachable', () => {
    let floorsWithDoors = 0;
    for (const [offset, seed] of seeds.entries()) {
      const generated = generateFloor(floorRequest(seed, 1 + (offset % 3)));
      const doorTiles = generated.floor.tiles.filter((tile) => tile === 2).length;
      if (doorTiles > 0) floorsWithDoors += 1;
      expect(
        analyzeConnectivity({
          width: generated.floor.width,
          height: generated.floor.height,
          tiles: generated.floor.tiles,
          start: generated.floor.stairUp!,
          target: generated.floor.stairDown!,
        }).connected,
      ).toBe(true);
    }
    expect(floorsWithDoors).toBeGreaterThan(seeds.length / 2);
  });

  it('gives the locked-door pass substrate at shallow depth', () => {
    const run = createDemoRun();
    let lockedDoors = 0;
    for (const [offset, seed] of seeds.entries()) {
      const generated = generateFloor(floorRequest(seed, 1 + (offset % 3)));
      const loot = placeFloorLoot(
        { run, floor: generated.floor, content },
        run.rng['loot-placement'],
      );
      lockedDoors += loot.features.filter(
        (feature): feature is DoorFeature => feature.type === 'door' && feature.state === 'locked',
      ).length;
    }
    expect(lockedDoors).toBeGreaterThan(0);
  });

  it('generates byte-identical floors for the same seed', () => {
    const request = floorRequest(seeds[0]!, 2);
    expect(stableJson(generateFloor(request).floor)).toBe(stableJson(generateFloor(request).floor));
  });
});
