import { Map as RotMap } from 'rot-js';
import type { CorridorRecord, GenerationRejectionCode, RoomBounds } from './generation-model.js';
import { maskHas } from './generation-mask.js';
import type { TileId, Uint32State } from './model.js';
import { foldSeed } from './random.js';
import { withRotSeed } from './rot-adapter.js';

export interface RotTopology {
  readonly tiles: readonly TileId[];
  readonly rooms: readonly RoomBounds[];
  readonly corridors: readonly CorridorRecord[];
}

export type RotTopologyResult =
  | { readonly ok: true; readonly topology: RotTopology }
  | { readonly ok: false; readonly code: GenerationRejectionCode };

interface RotCorridorShape {
  readonly _startX: number;
  readonly _startY: number;
  readonly _endX: number;
  readonly _endY: number;
}

function corridorShape(value: unknown, width: number, height: number): RotCorridorShape | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Partial<RotCorridorShape>;
  const coordinates = [candidate._startX, candidate._startY, candidate._endX, candidate._endY];
  if (!coordinates.every(Number.isSafeInteger)) return null;
  if (candidate._startX! < 0 || candidate._startX! >= width || candidate._endX! < 0 || candidate._endX! >= width
    || candidate._startY! < 0 || candidate._startY! >= height || candidate._endY! < 0 || candidate._endY! >= height) return null;
  return {
    _startX: candidate._startX!,
    _startY: candidate._startY!,
    _endX: candidate._endX!,
    _endY: candidate._endY!,
  };
}

export function createRotTopology(width: number, height: number, maskWords: readonly number[], state: Uint32State): RotTopologyResult {
  try {
    return withRotSeed(foldSeed(state), () => {
    const digger = new RotMap.Digger(width, height, {
      dugPercentage: 0.28,
      roomWidth: [4, 12],
      roomHeight: [3, 8],
      corridorLength: [2, 12],
      timeLimit: Number.MAX_SAFE_INTEGER,
    });
    const tiles = Array.from({ length: width * height }, (_, index) =>
      (maskHas(maskWords, width, index % width, Math.floor(index / width)) ? 0 : 6) as TileId,
    );
    let outsideMask = false;
    digger.create((x, y, value) => {
      const inside = maskHas(maskWords, width, x, y);
      if ((value === 0 || value === 2) && !inside) outsideMask = true;
      if (!inside) return;
      tiles[y * width + x] = value === 0 ? 1 : value === 2 ? 2 : 0;
    });
    if (outsideMask) return { ok: false, code: 'topology.outside-mask' };

    const roomShapes = digger.getRooms().map((room) => ({
      left: room.getLeft(), top: room.getTop(), right: room.getRight(), bottom: room.getBottom(),
    }));
    if (roomShapes.some((room) => Object.values(room).some((value) => !Number.isSafeInteger(value))
      || room.left < 0 || room.top < 0 || room.right >= width || room.bottom >= height
      || room.left > room.right || room.top > room.bottom)) {
      return { ok: false, code: 'topology.invalid-geometry' };
    }
    roomShapes.sort((left, right) => left.top - right.top || left.left - right.left || left.bottom - right.bottom || left.right - right.right);
    const rooms: RoomBounds[] = roomShapes.map((room, index) => ({ roomId: `room.${index}`, ...room }));

    /* rot-js 2.2.1 and generatorVersion 2 pin this narrow adapter boundary. */
    const corridorShapes = digger.getCorridors().map((corridor) => corridorShape(corridor, width, height));
    if (corridorShapes.some((corridor) => corridor === null)) return { ok: false, code: 'topology.invalid-geometry' };
    const copied = (corridorShapes as RotCorridorShape[]).map((corridor) => ({
      start: { x: corridor._startX, y: corridor._startY },
      end: { x: corridor._endX, y: corridor._endY },
    }));
    copied.sort((left, right) =>
      left.start.y - right.start.y || left.start.x - right.start.x || left.end.y - right.end.y || left.end.x - right.end.x,
    );
    const corridors: CorridorRecord[] = copied.map((corridor, index) => ({ corridorId: `corridor.${index}`, ...corridor }));
    if (!tiles.some((tile) => tile === 1 || tile === 2)) return { ok: false, code: 'topology.empty' };
      return { ok: true, topology: { tiles, rooms, corridors } };
    });
  } catch {
    return { ok: false, code: 'topology.invalid-geometry' };
  }
}
