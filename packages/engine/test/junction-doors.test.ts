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
  createGeneratedDemoRun,
  decodeActiveRun,
  encodeActiveRun,
  generateFloor,
  junctionDoorCandidates,
  placeFloorLoot,
  protectedRouteIndexes,
  resolveCommand,
  stableJson,
  tileDefinition,
  type ActiveRun,
  type Direction,
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

  it('excludes a mouth whose flanks are not wall tiles', () => {
    const pillarFlank = twoRoomTiles();
    pillarFlank[index(7, 2)] = 3 as TileId;
    expect(junctionDoorCandidates(carveInput({ tiles: pillarFlank }))).toEqual([index(13, 3)]);
    const voidFlank = twoRoomTiles();
    voidFlank[index(13, 4)] = 6 as TileId;
    expect(junctionDoorCandidates(carveInput({ tiles: voidFlank }))).toEqual([index(7, 3)]);
  });

  it('excludes a mouth that only guards a short dead-end stub', () => {
    // Room A gains a south mouth at (4,6) opening onto a three-cell stub that reaches no room.
    const stub = twoRoomTiles();
    for (let y = 6; y <= 9; y += 1) stub[index(4, y)] = 1 as TileId;
    expect(junctionDoorCandidates(carveInput({ tiles: stub }))).toEqual([
      index(7, 3),
      index(13, 3),
    ]);
  });

  it('keeps a mouth guarding a long corridor even when it reaches no room', () => {
    const longStub = twoRoomTiles();
    for (let y = 6; y <= 10; y += 1) longStub[index(4, y)] = 1 as TileId;
    for (let x = 5; x <= 12; x += 1) longStub[index(x, 10)] = 1 as TileId;
    expect(junctionDoorCandidates(carveInput({ tiles: longStub }))).toContain(index(4, 6));
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

  it('never places a door diagonally beside an existing door tile', () => {
    const tiles = twoRoomTiles();
    tiles[index(6, 2)] = 2 as TileId;
    const carved = carveJunctionDoors(carveInput({ tiles, doorTilePercent: 100 }));
    expect(carved.doorIndexes).toEqual([index(13, 3)]);
  });

  it('is a pure function of its input: repeated calls agree byte-for-byte', () => {
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

  it('is a pure function of the request: repeated generation agrees byte-for-byte', () => {
    const request = floorRequest(seeds[0]!, 2);
    expect(stableJson(generateFloor(request).floor)).toBe(stableJson(generateFloor(request).floor));
  });

  it('gives every generated door tile exactly one openable door feature', () => {
    const run = createDemoRun();
    let doorTiles = 0;
    for (const [offset, seed] of seeds.entries()) {
      const generated = generateFloor(floorRequest(seed, 1 + (offset % 3))).floor;
      const loot = placeFloorLoot({ run, floor: generated, content }, run.rng['loot-placement']);
      const doors = loot.features.filter(
        (feature): feature is DoorFeature => feature.type === 'door',
      );
      const protectedIndexes = protectedRouteIndexes(generated);
      for (let index = 0; index < generated.tiles.length; index += 1) {
        if (generated.tiles[index] !== 2) continue;
        doorTiles += 1;
        const x = index % generated.width;
        const y = Math.floor(index / generated.width);
        const at = doors.filter((door) => door.x === x && door.y === y);
        expect(at).toHaveLength(1);
        const door = at[0]!;
        expect(door.coverTileId).toBe(2);
        if (door.state === 'locked') {
          expect(protectedIndexes.has(index)).toBe(false);
          expect(door.lock).toBeDefined();
        } else {
          expect(door.state).toBe('closed');
          expect(door.lock).toBeUndefined();
        }
      }
      expect(doors).toHaveLength(generated.tiles.filter((tile) => tile === 2).length);
    }
    expect(doorTiles).toBeGreaterThan(0);
  });

  it('keeps generated door features identical for the same seed', () => {
    const run = createDemoRun();
    const generated = generateFloor(floorRequest(seeds[0]!, 2)).floor;
    const first = placeFloorLoot({ run, floor: generated, content }, run.rng['loot-placement']);
    const second = placeFloorLoot({ run, floor: generated, content }, run.rng['loot-placement']);
    expect(stableJson(first.features)).toBe(stableJson(second.features));
  });

  it('lets the hero bump every closed generated door open and still saves the run', () => {
    const { run } = createGeneratedDemoRun(content);
    const floor = run.floors.find((candidate) => candidate.floorId === run.activeFloorId)!;
    const doorTiles = floor.tiles.filter((tile) => tile === 2).length;
    expect(doorTiles).toBeGreaterThan(0);
    const protectedIndexes = protectedRouteIndexes(floor);
    const doors = run.features.filter(
      (feature): feature is DoorFeature =>
        feature.type === 'door' && feature.floorId === floor.floorId,
    );
    expect(doors).toHaveLength(doorTiles);

    const directions: readonly Readonly<{ dx: number; dy: number; direction: Direction }>[] = [
      { dx: 0, dy: -1, direction: 'south' },
      { dx: 0, dy: 1, direction: 'north' },
      { dx: -1, dy: 0, direction: 'east' },
      { dx: 1, dy: 0, direction: 'west' },
    ];
    let bumped = 0;
    for (const door of doors) {
      const index = door.y * floor.width + door.x;
      if (door.state === 'locked') {
        expect(protectedIndexes.has(index)).toBe(false);
        continue;
      }
      expect(door.state).toBe('closed');
      const approach = directions.find((step) => {
        const neighbor = { x: door.x + step.dx, y: door.y + step.dy };
        const neighborIndex = neighbor.y * floor.width + neighbor.x;
        return (
          neighbor.x >= 0 &&
          neighbor.y >= 0 &&
          neighbor.x < floor.width &&
          neighbor.y < floor.height &&
          tileDefinition(floor.tiles[neighborIndex]!).walkable &&
          !run.features.some(
            (feature) =>
              feature.floorId === floor.floorId &&
              feature.x === neighbor.x &&
              feature.y === neighbor.y,
          ) &&
          !run.actors.some(
            (actor) =>
              actor.health > 0 &&
              actor.floorId === floor.floorId &&
              !actor.playerControlled &&
              actor.x === neighbor.x &&
              actor.y === neighbor.y,
          )
        );
      });
      if (!approach) continue;
      const hero = run.actors.find((actor) => actor.playerControlled)!;
      const staged: ActiveRun = {
        ...run,
        actors: run.actors.map((actor) =>
          actor.actorId === hero.actorId
            ? { ...actor, x: door.x + approach.dx, y: door.y + approach.dy }
            : actor,
        ),
      };
      const result = resolveCommand(
        staged,
        {
          type: 'move',
          commandId: `command.bump-${door.featureId}`,
          expectedRevision: staged.revision,
          direction: approach.direction,
        },
        { content },
      );
      expect(result.result).toMatchObject({ status: 'applied' });
      expect(
        result.state.features.find((feature) => feature.featureId === door.featureId),
      ).toMatchObject({ state: 'open' });
      expect(() => decodeActiveRun(encodeActiveRun(result.state))).not.toThrow();
      bumped += 1;
    }
    expect(bumped).toBeGreaterThan(0);
  });
});
