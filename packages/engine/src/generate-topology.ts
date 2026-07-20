import { analyzeConnectivity } from './connectivity.js';
import { createFallbackTopology } from './fallback-floor.js';
import {
  GenerationError,
  type CorridorRecord,
  type GenerateTopologyRequest,
  type GenerationRejectionCode,
  type GenerationReport,
  type RoomBounds,
  type TopologyAttemptResult,
  type TopologyDraft,
} from './generation-model.js';
import { deriveAttemptSeed } from './generation-random.js';
import { maskHas, validateThemeMask } from './generation-mask.js';
import { assertOpaqueId, type TileId, type Uint32State } from './model.js';
import { isNonZeroState, nextUint32 } from './random.js';
import { createRotTopology } from './rot-topology.js';
import { tileDefinition } from './terrain.js';

const DEFAULT_ATTEMPT_LIMIT = 8;

interface StairPlacement {
  readonly stairUp: Readonly<{ x: number; y: number }>;
  readonly stairDown: Readonly<{ x: number; y: number }>;
  readonly stairDistance: number;
  readonly vaultState: Uint32State;
}

function invalidRequest(message: string): never {
  throw new GenerationError('generation.invalid-request', message);
}

export function validateTopologyRequest(request: GenerateTopologyRequest): number {
  if (typeof request !== 'object' || request === null)
    invalidRequest('generation request must be an object');
  try {
    assertOpaqueId(request.floorId, 'floorId');
  } catch {
    invalidRequest('floorId must be a nonempty opaque identifier');
  }
  if (
    !Number.isSafeInteger(request.width) ||
    request.width < 20 ||
    request.width > 160 ||
    !Number.isSafeInteger(request.height) ||
    request.height < 12 ||
    request.height > 100
  ) {
    invalidRequest('generation dimensions are outside the supported range');
  }
  if (!Number.isSafeInteger(request.depth) || request.depth < 0)
    invalidRequest('depth must be a nonnegative safe integer');
  if (
    !Array.isArray(request.floorSeed) ||
    request.floorSeed.length !== 4 ||
    request.floorSeed.some((word) => !Number.isInteger(word) || word < 0 || word > 0xffff_ffff) ||
    !isNonZeroState(request.floorSeed)
  )
    invalidRequest('floor seed must be a nonzero unsigned four-word state');
  const attemptLimit = request.attemptLimit ?? DEFAULT_ATTEMPT_LIMIT;
  if (!Number.isSafeInteger(attemptLimit) || attemptLimit < 1 || attemptLimit > 32)
    invalidRequest('attempt limit must be from 1 through 32');
  const { theme } = request;
  if (typeof theme !== 'object' || theme === null)
    throw new GenerationError('generation.invalid-theme', 'theme must be an object');
  try {
    assertOpaqueId(theme.themeId, 'themeId');
  } catch {
    throw new GenerationError(
      'generation.invalid-theme',
      'themeId must be a nonempty opaque identifier',
    );
  }
  if (
    !Number.isSafeInteger(theme.minimumRooms) ||
    theme.minimumRooms < 1 ||
    !Number.isSafeInteger(theme.minimumStairDistance) ||
    theme.minimumStairDistance < 1
  ) {
    throw new GenerationError(
      'generation.invalid-theme',
      'theme generation budgets must be positive safe integers',
    );
  }
  if (
    typeof theme.ambient !== 'object' ||
    theme.ambient === null ||
    !Array.isArray(theme.ambient.color)
  ) {
    throw new GenerationError('generation.invalid-theme', 'theme ambient light is invalid');
  }
  const { color, strength } = theme.ambient;
  if (
    color.length !== 3 ||
    color.some((value) => !Number.isInteger(value) || value < 0 || value > 255) ||
    !Number.isInteger(strength) ||
    strength < 0 ||
    strength > 255
  ) {
    throw new GenerationError('generation.invalid-theme', 'theme ambient light is invalid');
  }
  if (!Array.isArray(theme.maskWords))
    throw new GenerationError('generation.invalid-theme', 'theme mask must be a dense word array');
  if (request.topologyFactory !== undefined && typeof request.topologyFactory !== 'function')
    invalidRequest('topology factory must be a function');
  validateThemeMask(
    request.width,
    request.height,
    theme.maskWords,
    theme.minimumRooms,
    theme.minimumStairDistance,
  );
  return attemptLimit;
}

function roomCells(room: RoomBounds, width: number, tiles: readonly TileId[]): number[] {
  const cells: number[] = [];
  for (let y = room.top; y <= room.bottom; y += 1)
    for (let x = room.left; x <= room.right; x += 1) {
      const index = y * width + x;
      if (tileDefinition(tiles[index]!).potentiallyTraversable) cells.push(index);
    }
  return cells;
}

function placeStairs(
  width: number,
  height: number,
  tiles: readonly TileId[],
  rooms: readonly RoomBounds[],
  minimumDistance: number,
  attemptState: Uint32State,
): StairPlacement | null {
  if (rooms.length < 2) return null;
  const roomStep = nextUint32(attemptState);
  const upRoomIndex = roomStep.value % rooms.length;
  const upCells = roomCells(rooms[upRoomIndex]!, width, tiles);
  if (upCells.length === 0) return null;
  const cellStep = nextUint32(roomStep.state);
  const upIndex = upCells[cellStep.value % upCells.length]!;
  const up = { x: upIndex % width, y: Math.floor(upIndex / width) };
  let bestIndex = -1;
  let bestDistance = -1;
  for (let roomIndex = 0; roomIndex < rooms.length; roomIndex += 1) {
    if (roomIndex === upRoomIndex) continue;
    for (const candidate of roomCells(rooms[roomIndex]!, width, tiles)) {
      const target = { x: candidate % width, y: Math.floor(candidate / width) };
      const distance = analyzeConnectivity({ width, height, tiles, start: up, target }).distance;
      if (
        distance !== null &&
        (distance > bestDistance || (distance === bestDistance && candidate < bestIndex))
      ) {
        bestIndex = candidate;
        bestDistance = distance;
      }
    }
  }
  if (bestIndex === -1 || bestDistance < minimumDistance) return null;
  return {
    stairUp: up,
    stairDown: { x: bestIndex % width, y: Math.floor(bestIndex / width) },
    stairDistance: bestDistance,
    vaultState: cellStep.state,
  };
}

function finalRejection(
  request: GenerateTopologyRequest,
  tiles: readonly TileId[],
  rooms: readonly RoomBounds[],
  corridors: readonly CorridorRecord[],
  stairUp: Readonly<{ x: number; y: number }>,
  stairDown: Readonly<{ x: number; y: number }>,
  expectedDistance: number,
): GenerationRejectionCode | null {
  if (tiles.length !== request.width * request.height) return 'topology.outside-mask';
  for (let index = 0; index < tiles.length; index += 1) {
    if (
      !(index in tiles) ||
      !Number.isInteger(tiles[index]) ||
      tiles[index]! < 0 ||
      tiles[index]! > 6 ||
      (tileDefinition(tiles[index]!).potentiallyTraversable &&
        !maskHas(
          request.theme.maskWords,
          request.width,
          index % request.width,
          Math.floor(index / request.width),
        ))
    ) {
      return 'topology.outside-mask';
    }
  }
  if (rooms.length === 0 || corridors.length === 0) return 'topology.invalid-geometry';
  const roomIds = new Set<string>();
  const fallbackRoomIds = rooms[0]?.roomId === 'room.fallback.0';
  let previousRoom: RoomBounds | undefined;
  for (let index = 0; index < rooms.length; index += 1) {
    if (!(index in rooms)) return 'topology.invalid-geometry';
    const room = rooms[index]!;
    const expectedRoomId = fallbackRoomIds ? `room.fallback.${index}` : `room.${index}`;
    if (
      room.roomId !== expectedRoomId ||
      roomIds.has(room.roomId) ||
      ![room.left, room.top, room.right, room.bottom].every(Number.isSafeInteger) ||
      room.left < 0 ||
      room.top < 0 ||
      room.right >= request.width ||
      room.bottom >= request.height ||
      room.left > room.right ||
      room.top > room.bottom
    )
      return 'topology.invalid-geometry';
    roomIds.add(room.roomId);
    if (
      previousRoom &&
      (previousRoom.top > room.top ||
        (previousRoom.top === room.top && previousRoom.left > room.left) ||
        (previousRoom.top === room.top &&
          previousRoom.left === room.left &&
          previousRoom.bottom > room.bottom) ||
        (previousRoom.top === room.top &&
          previousRoom.left === room.left &&
          previousRoom.bottom === room.bottom &&
          previousRoom.right > room.right))
    )
      return 'topology.invalid-geometry';
    let potentialCells = 0;
    for (let y = room.top; y <= room.bottom; y += 1)
      for (let x = room.left; x <= room.right; x += 1) {
        if (!maskHas(request.theme.maskWords, request.width, x, y))
          return 'topology.invalid-geometry';
        if (tileDefinition(tiles[y * request.width + x]!).potentiallyTraversable)
          potentialCells += 1;
      }
    if (potentialCells === 0) return 'topology.invalid-geometry';
    previousRoom = room;
  }
  const corridorIds = new Set<string>();
  const fallbackCorridorIds = corridors[0]?.corridorId === 'corridor.fallback.0';
  let previousCorridor: CorridorRecord | undefined;
  for (let index = 0; index < corridors.length; index += 1) {
    if (!(index in corridors)) return 'topology.invalid-geometry';
    const corridor = corridors[index]!;
    const expectedCorridorId = fallbackCorridorIds
      ? `corridor.fallback.${index}`
      : `corridor.${index}`;
    if (corridor.corridorId !== expectedCorridorId || corridorIds.has(corridor.corridorId))
      return 'topology.invalid-geometry';
    corridorIds.add(corridor.corridorId);
    for (const endpoint of [corridor.start, corridor.end]) {
      if (
        !Number.isSafeInteger(endpoint.x) ||
        !Number.isSafeInteger(endpoint.y) ||
        endpoint.x < 0 ||
        endpoint.y < 0 ||
        endpoint.x >= request.width ||
        endpoint.y >= request.height ||
        !maskHas(request.theme.maskWords, request.width, endpoint.x, endpoint.y)
      )
        return 'topology.invalid-geometry';
    }
    if (
      previousCorridor &&
      (previousCorridor.start.y > corridor.start.y ||
        (previousCorridor.start.y === corridor.start.y &&
          previousCorridor.start.x > corridor.start.x) ||
        (previousCorridor.start.y === corridor.start.y &&
          previousCorridor.start.x === corridor.start.x &&
          previousCorridor.end.y > corridor.end.y) ||
        (previousCorridor.start.y === corridor.start.y &&
          previousCorridor.start.x === corridor.start.x &&
          previousCorridor.end.y === corridor.end.y &&
          previousCorridor.end.x > corridor.end.x))
    ) {
      return 'topology.invalid-geometry';
    }
    previousCorridor = corridor;
  }
  let upCount = 0;
  let downCount = 0;
  for (const tile of tiles) {
    if (tile === 4) upCount += 1;
    if (tile === 5) downCount += 1;
  }
  if (
    upCount !== 1 ||
    downCount !== 1 ||
    tiles[stairUp.y * request.width + stairUp.x] !== 4 ||
    tiles[stairDown.y * request.width + stairDown.x] !== 5
  )
    return 'topology.invalid-geometry';
  const connectivity = analyzeConnectivity({
    width: request.width,
    height: request.height,
    tiles,
    start: stairUp,
    target: stairDown,
  });
  if (!connectivity.connected) return 'connectivity.disconnected';
  if (
    connectivity.distance === null ||
    connectivity.distance !== expectedDistance ||
    connectivity.distance < request.theme.minimumStairDistance
  )
    return 'stairs.no-valid-pair';
  return null;
}

function report(
  attempt: number | null,
  fallback: boolean,
  rooms: readonly RoomBounds[],
  corridorCount: number,
  stairs: Pick<StairPlacement, 'stairUp' | 'stairDown' | 'stairDistance'>,
  traversableCellCount: number,
  rejectionCounts: Readonly<Partial<Record<GenerationRejectionCode, number>>>,
): GenerationReport {
  return {
    generatorVersion: 2,
    attempt,
    fallback,
    roomCount: rooms.length,
    corridorCount,
    vaults: [],
    stairUp: stairs.stairUp,
    stairDown: stairs.stairDown,
    stairDistance: stairs.stairDistance,
    traversableCellCount,
    connected: true,
    rejectionCounts,
  };
}

export function generateTopologyAttempt(
  request: GenerateTopologyRequest,
  attempt: number,
): TopologyAttemptResult {
  validateTopologyRequest(request);
  if (!Number.isSafeInteger(attempt) || attempt < 0 || attempt >= 32)
    invalidRequest('attempt must be from 0 through 31');
  const attemptState = deriveAttemptSeed(request.floorSeed, attempt);
  const generated = createRotTopology(
    request.width,
    request.height,
    request.theme.maskWords,
    attemptState,
  );
  if (!generated.ok) return generated;
  const { tiles: sourceTiles, rooms, corridors } = generated.topology;
  if (rooms.length < request.theme.minimumRooms) return { ok: false, code: 'topology.room-budget' };
  if (corridors.length === 0) return { ok: false, code: 'topology.invalid-geometry' };
  const stairs = placeStairs(
    request.width,
    request.height,
    sourceTiles,
    rooms,
    request.theme.minimumStairDistance,
    attemptState,
  );
  if (!stairs) return { ok: false, code: 'stairs.no-valid-pair' };
  const tiles = [...sourceTiles];
  tiles[stairs.stairUp.y * request.width + stairs.stairUp.x] = 4;
  tiles[stairs.stairDown.y * request.width + stairs.stairDown.x] = 5;
  const rejection = finalRejection(
    request,
    tiles,
    rooms,
    corridors,
    stairs.stairUp,
    stairs.stairDown,
    stairs.stairDistance,
  );
  if (rejection) return { ok: false, code: rejection };
  const traversable = analyzeConnectivity({
    width: request.width,
    height: request.height,
    tiles,
  }).traversableCellCount;
  const draft: TopologyDraft = {
    floorId: request.floorId,
    floorSeed: [...request.floorSeed] as unknown as Uint32State,
    depth: request.depth,
    themeId: request.theme.themeId,
    width: request.width,
    height: request.height,
    tiles,
    rooms,
    corridors,
    stairUp: stairs.stairUp,
    stairDown: stairs.stairDown,
    vaultState: stairs.vaultState,
    report: report(attempt, false, rooms, corridors.length, stairs, traversable, {}),
  };
  return { ok: true, draft };
}

export function generateTopology(request: GenerateTopologyRequest): TopologyDraft {
  const attemptLimit = validateTopologyRequest(request);
  const rejectionCounts: Partial<Record<GenerationRejectionCode, number>> = {};
  const factory = request.topologyFactory ?? generateTopologyAttempt;
  for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
    const result = factory(request, attempt);
    if (result.ok) return { ...result.draft, report: { ...result.draft.report, rejectionCounts } };
    rejectionCounts[result.code] = (rejectionCounts[result.code] ?? 0) + 1;
  }
  const fallback = createFallbackTopology(
    request.width,
    request.height,
    request.theme.maskWords,
    request.theme.minimumStairDistance,
  );
  const fallbackSeed = deriveAttemptSeed(request.floorSeed, attemptLimit);
  const vaultState = nextUint32(nextUint32(fallbackSeed).state).state;
  const rejection = finalRejection(
    request,
    fallback.tiles,
    fallback.rooms,
    fallback.corridors,
    fallback.stairUp,
    fallback.stairDown,
    fallback.stairDistance,
  );
  if (rejection)
    throw new GenerationError(
      'generation.fallback-invariant',
      `deterministic fallback failed: ${rejection}`,
    );
  const traversable = analyzeConnectivity({
    width: request.width,
    height: request.height,
    tiles: fallback.tiles,
  }).traversableCellCount;
  return {
    floorId: request.floorId,
    floorSeed: [...request.floorSeed] as unknown as Uint32State,
    depth: request.depth,
    themeId: request.theme.themeId,
    width: request.width,
    height: request.height,
    tiles: fallback.tiles,
    rooms: fallback.rooms,
    corridors: fallback.corridors,
    stairUp: fallback.stairUp,
    stairDown: fallback.stairDown,
    vaultState,
    report: report(
      null,
      true,
      fallback.rooms,
      fallback.corridors.length,
      fallback,
      traversable,
      rejectionCounts,
    ),
  };
}
