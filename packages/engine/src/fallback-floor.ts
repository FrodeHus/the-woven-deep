import type { CorridorRecord, RoomBounds } from './generation-model.js';
import { maskHas } from './generation-mask.js';
import type { TileId } from './model.js';

export interface FallbackTopology {
  readonly tiles: readonly TileId[];
  readonly rooms: readonly RoomBounds[];
  readonly corridors: readonly CorridorRecord[];
  readonly stairUp: Readonly<{ x: number; y: number }>;
  readonly stairDown: Readonly<{ x: number; y: number }>;
  readonly stairDistance: number;
}

function neighbors(index: number, width: number, height: number): readonly number[] {
  const x = index % width;
  const y = Math.floor(index / width);
  const result: number[] = [];
  if (y > 0) result.push(index - width);
  if (x + 1 < width) result.push(index + 1);
  if (y + 1 < height) result.push(index + width);
  if (x > 0) result.push(index - 1);
  return result;
}

function search(maskWords: readonly number[], width: number, height: number, start: number): {
  readonly farthest: number;
  readonly distance: Int32Array;
  readonly previous: Int32Array;
} {
  const distance = new Int32Array(width * height); distance.fill(-1);
  const previous = new Int32Array(width * height); previous.fill(-1);
  const queue = [start]; distance[start] = 0;
  let farthest = start;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]!;
    if (distance[current]! > distance[farthest]! || (distance[current] === distance[farthest] && current < farthest)) farthest = current;
    for (const next of neighbors(current, width, height)) {
      if (distance[next] !== -1 || !maskHas(maskWords, width, next % width, Math.floor(next / width))) continue;
      distance[next] = distance[current]! + 1;
      previous[next] = current;
      queue.push(next);
    }
  }
  return { farthest, distance, previous };
}

function tileRouteDistance(tiles: readonly TileId[], width: number, height: number, start: number, target: number): number {
  const distance = new Int32Array(tiles.length); distance.fill(-1);
  const queue = [start]; distance[start] = 0;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]!;
    if (current === target) return distance[current]!;
    for (const next of neighbors(current, width, height)) {
      if (distance[next] === -1 && tiles[next] === 1) {
        distance[next] = distance[current]! + 1;
        queue.push(next);
      }
    }
  }
  return -1;
}

export function createFallbackTopology(
  width: number,
  height: number,
  maskWords: readonly number[],
  minimumStairDistance: number,
): FallbackTopology {
  let stableStart = -1;
  for (let index = 0; index < width * height; index += 1) if (maskHas(maskWords, width, index % width, Math.floor(index / width))) {
    stableStart = index; break;
  }
  const first = search(maskWords, width, height, stableStart).farthest;
  const secondSearch = search(maskWords, width, height, first);
  const second = secondSearch.farthest;
  const path: number[] = [];
  for (let cursor = second; cursor !== -1; cursor = secondSearch.previous[cursor]!) path.push(cursor);
  path.reverse();
  const tiles = Array.from({ length: width * height }, (_, index) =>
    (maskHas(maskWords, width, index % width, Math.floor(index / width)) ? 0 : 6) as TileId,
  );
  for (const index of path) tiles[index] = 1;

  const roomCenters = [first, path[Math.floor(path.length / 2)]!, second];
  const roomShapes: Omit<RoomBounds, 'roomId'>[] = [];
  for (const center of roomCenters) {
    const cx = center % width;
    const cy = Math.floor(center / width);
    const left = Math.max(1, cx - 1); const right = Math.min(width - 2, cx + 1);
    const top = Math.max(1, cy - 1); const bottom = Math.min(height - 2, cy + 1);
    let complete = true;
    for (let y = top; y <= bottom; y += 1) for (let x = left; x <= right; x += 1) complete &&= maskHas(maskWords, width, x, y);
    if (complete) {
      const carved: number[] = [];
      for (let y = top; y <= bottom; y += 1) for (let x = left; x <= right; x += 1) {
        const index = y * width + x;
        if (tiles[index] === 0) { tiles[index] = 1; carved.push(index); }
      }
      const distance = tileRouteDistance(tiles, width, height, first, second);
      if (distance < minimumStairDistance) {
        for (const index of carved) tiles[index] = 0;
      } else if (!roomShapes.some((room) => room.left === left && room.top === top && room.right === right && room.bottom === bottom)) {
        roomShapes.push({ left, top, right, bottom });
      }
    }
  }
  roomShapes.sort((left, right) => left.top - right.top || left.left - right.left || left.bottom - right.bottom || left.right - right.right);
  const rooms = roomShapes.map((room, index) => ({ roomId: `room.fallback.${index}`, ...room }));
  const stairUp = { x: first % width, y: Math.floor(first / width) };
  const stairDown = { x: second % width, y: Math.floor(second / width) };
  const stairDistance = tileRouteDistance(tiles, width, height, first, second);
  tiles[first] = 4; tiles[second] = 5;
  return {
    tiles,
    rooms,
    corridors: [{ corridorId: 'corridor.fallback.0', start: stairUp, end: stairDown }],
    stairUp,
    stairDown,
    stairDistance,
  };
}
