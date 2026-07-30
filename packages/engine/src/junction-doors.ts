import type { RoomBounds } from './generation-model.js';
import type { TileId, Uint32State, VaultPlacement } from './model.js';
import { rollDie } from './random.js';
import { tileDefinition } from './terrain.js';

const FLOOR_TILE_ID: TileId = 1;
const DOOR_TILE_ID: TileId = 2;
const PERCENT_SIDES = 100;

export interface JunctionDoorGeometry {
  readonly width: number;
  readonly height: number;
  readonly tiles: readonly TileId[];
  readonly rooms: readonly RoomBounds[];
  readonly stairUp: Readonly<{ x: number; y: number }> | null;
  readonly stairDown: Readonly<{ x: number; y: number }> | null;
  readonly vaults: readonly VaultPlacement[];
}

export interface JunctionDoorInput extends JunctionDoorGeometry {
  readonly doorTilePercent: number;
  readonly state: Uint32State;
}

export interface JunctionDoorResult {
  readonly tiles: readonly TileId[];
  readonly doorIndexes: readonly number[];
  readonly state: Uint32State;
}

function assertGeometry(input: JunctionDoorGeometry): void {
  const { width, height, tiles } = input;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    tiles.length !== width * height
  ) {
    throw new RangeError('junction door dimensions and dense tile count must agree');
  }
}

/**
 * Marks every cell belonging to a room's interior rectangle. Rot-js reports room bounds as the
 * interior, so a corridor mouth -- the dug cell in the room's wall ring -- always falls outside
 * every rectangle while touching one.
 */
function roomMask(input: JunctionDoorGeometry): Uint8Array {
  const mask = new Uint8Array(input.width * input.height);
  for (const room of input.rooms) {
    const top = Math.max(0, room.top);
    const bottom = Math.min(input.height - 1, room.bottom);
    const left = Math.max(0, room.left);
    const right = Math.min(input.width - 1, room.right);
    for (let y = top; y <= bottom; y += 1)
      for (let x = left; x <= right; x += 1) mask[y * input.width + x] = 1;
  }
  return mask;
}

/**
 * Cells no generated door may occupy: the stairs and their eight-neighborhood (a door must never
 * seal or crowd a transition), plus every vault footprint cell and its orthogonal ring (vaults
 * author their own doors and entrances, and a door dropped on an entrance approach would fight
 * them).
 */
function excludedMask(input: JunctionDoorGeometry): Uint8Array {
  const { width, height } = input;
  const mask = new Uint8Array(width * height);
  const block = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    mask[y * width + x] = 1;
  };
  for (const stair of [input.stairUp, input.stairDown]) {
    if (stair === null) continue;
    for (let dy = -1; dy <= 1; dy += 1)
      for (let dx = -1; dx <= 1; dx += 1) block(stair.x + dx, stair.y + dy);
  }
  for (const vault of input.vaults)
    for (let y = vault.y; y < vault.y + vault.height; y += 1)
      for (let x = vault.x; x < vault.x + vault.width; x += 1) {
        block(x, y);
        block(x, y - 1);
        block(x + 1, y);
        block(x, y + 1);
        block(x - 1, y);
      }
  return mask;
}

function traversableAt(input: JunctionDoorGeometry, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= input.width || y >= input.height) return false;
  return tileDefinition(input.tiles[y * input.width + x]!).potentiallyTraversable;
}

/**
 * Junction cells of a final topology, in row-major order: plain floor cells outside every room
 * rectangle whose only two traversable orthogonal neighbors sit opposite each other (a one-wide
 * passage cell) with at least one of them inside a room. That is exactly the mouth where a corridor
 * meets a room -- the cell a hand-built dungeon would hang a door on.
 */
export function junctionDoorCandidates(input: JunctionDoorGeometry): readonly number[] {
  assertGeometry(input);
  const rooms = roomMask(input);
  const excluded = excludedMask(input);
  const candidates: number[] = [];
  for (let y = 0; y < input.height; y += 1)
    for (let x = 0; x < input.width; x += 1) {
      const index = y * input.width + x;
      if (input.tiles[index] !== FLOOR_TILE_ID) continue;
      if (rooms[index] === 1 || excluded[index] === 1) continue;
      const north = traversableAt(input, x, y - 1);
      const east = traversableAt(input, x + 1, y);
      const south = traversableAt(input, x, y + 1);
      const west = traversableAt(input, x - 1, y);
      const traversableCount = Number(north) + Number(east) + Number(south) + Number(west);
      if (traversableCount !== 2) continue;
      const vertical = north && south;
      const horizontal = east && west;
      if (!vertical && !horizontal) continue;
      const roomSide = vertical
        ? rooms[index - input.width] === 1 || rooms[index + input.width] === 1
        : rooms[index - 1] === 1 || rooms[index + 1] === 1;
      if (!roomSide) continue;
      candidates.push(index);
    }
  return candidates;
}

/**
 * Converts a percentage of a floor's corridor-to-room junctions into closed door tiles.
 *
 * Pure and deterministic: candidates are collected in row-major order and each one consumes exactly
 * one hundred-sided roll from the supplied state, so the floor seed alone fixes which junctions
 * become doors. Door tiles are `potentiallyTraversable`, so no conversion can disconnect the floor;
 * a junction orthogonally adjacent to a door tile (authored by a vault or converted earlier in this
 * same pass) is skipped without a roll so doors never come in slabs.
 */
export function carveJunctionDoors(input: JunctionDoorInput): JunctionDoorResult {
  const { doorTilePercent } = input;
  if (
    !Number.isSafeInteger(doorTilePercent) ||
    doorTilePercent < 0 ||
    doorTilePercent > PERCENT_SIDES
  ) {
    throw new RangeError('door tile percent must be an integer from 0 through 100');
  }
  const candidates = junctionDoorCandidates(input);
  if (candidates.length === 0) return { tiles: input.tiles, doorIndexes: [], state: input.state };
  const tiles = [...input.tiles];
  const doorIndexes: number[] = [];
  let cursor = input.state;
  for (const index of candidates) {
    const x = index % input.width;
    const y = Math.floor(index / input.width);
    const beside = [
      y > 0 ? tiles[index - input.width] : undefined,
      x + 1 < input.width ? tiles[index + 1] : undefined,
      y + 1 < input.height ? tiles[index + input.width] : undefined,
      x > 0 ? tiles[index - 1] : undefined,
    ];
    if (beside.some((tile) => tile === DOOR_TILE_ID)) continue;
    const roll = rollDie(cursor, PERCENT_SIDES);
    cursor = roll.state;
    if (roll.value > doorTilePercent) continue;
    tiles[index] = DOOR_TILE_ID;
    doorIndexes.push(index);
  }
  return { tiles, doorIndexes, state: cursor };
}
