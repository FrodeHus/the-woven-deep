import type { CompiledContentPack } from '@woven-deep/content';
import { balanceEntry } from './balance.js';
import { protectedRouteIndexes } from './connectivity.js';
import type { ChestFeature, DoorFeature, DungeonFeature } from './feature-model.js';
import { createFloorLootFromTable } from './inventory.js';
import type { ItemInstance } from './item-model.js';
import {
  tileIndex,
  type ActiveRun,
  type FloorSnapshot,
  type Point,
  type Uint32State,
} from './model.js';
import { rollDie, type RandomStep } from './random.js';
import { tileDefinition } from './terrain.js';

const DOOR_TILE_ID = 2;
const PERCENT_SIDES = 100;
const ORDINAL_DIGITS = 6;

/**
 * Zero-padded feature and scatter-pile ordinal: ids within one floor's batch must sort in the order
 * they were placed, and an unpadded `10` sorts before `2`.
 */
function ordinal(value: number): string {
  return String(value).padStart(ORDINAL_DIGITS, '0');
}

export type DepthBand = 'shallow' | 'mid' | 'deep';

export interface FloorLootResult {
  readonly items: readonly ItemInstance[];
  readonly features: readonly DungeonFeature[];
  readonly state: Uint32State;
}

export interface PlaceFloorLootInput {
  readonly run: ActiveRun;
  readonly floor: FloorSnapshot;
  readonly content: CompiledContentPack;
}

export function depthBandFor(
  depth: number,
  bands: Readonly<{ shallowMaxDepth: number; midMaxDepth: number }>,
): DepthBand {
  if (depth <= bands.shallowMaxDepth) return 'shallow';
  if (depth <= bands.midMaxDepth) return 'mid';
  return 'deep';
}

function chebyshev(left: Point, right: Point): number {
  return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));
}

/**
 * Uniform integer in `[minimum, maximum]` composed from `rollDie` so the draw stays integral and
 * consumes exactly one die roll (zero rolls for a degenerate range).
 */
function rollRange(state: Uint32State, minimum: number, maximum: number): RandomStep {
  if (maximum <= minimum) return { value: minimum, state };
  const roll = rollDie(state, maximum - minimum + 1);
  return { value: minimum + roll.value - 1, state: roll.state };
}

function insideVault(floor: FloorSnapshot, cell: Point): boolean {
  return floor.vaults.some(
    (vault) =>
      cell.x >= vault.x &&
      cell.x < vault.x + vault.width &&
      cell.y >= vault.y &&
      cell.y < vault.y + vault.height,
  );
}

function occupiedIndexes(run: ActiveRun, floor: FloorSnapshot): ReadonlySet<number> {
  const occupied = new Set<number>();
  for (const entity of floor.entities) {
    const index = tileIndex(floor, entity.x, entity.y);
    if (index !== undefined) occupied.add(index);
  }
  for (const feature of run.features) {
    if (feature.floorId !== floor.floorId) continue;
    const index = tileIndex(floor, feature.x, feature.y);
    if (index !== undefined) occupied.add(index);
  }
  // `floor.entities` is the snapshot's own occupancy list and can lag the run's actors within a
  // single `placeFloorPopulations` call (encounters commit to `run.actors`, not to the snapshot),
  // so living actors on this floor are excluded here too -- otherwise a chest or locked door can
  // land under a monster spawned moments earlier in the same pass.
  for (const actor of run.actors) {
    if (actor.floorId !== floor.floorId || actor.health <= 0) continue;
    const index = tileIndex(floor, actor.x, actor.y);
    if (index !== undefined) occupied.add(index);
  }
  return occupied;
}

/**
 * Walkable cells eligible for scatter piles and chests, in row-major order so the candidate list
 * -- and therefore every draw made from it -- is a pure function of the floor.
 */
function candidateCells(
  input: PlaceFloorLootInput,
  minimumAnchorDistance: number,
  protectedIndexes: ReadonlySet<number>,
  occupied: ReadonlySet<number>,
): readonly Point[] {
  const { floor } = input;
  const anchors = [floor.stairUp, floor.stairDown].filter(
    (anchor): anchor is Point => anchor !== null,
  );
  const cells: Point[] = [];
  for (let y = 0; y < floor.height; y += 1) {
    for (let x = 0; x < floor.width; x += 1) {
      const index = y * floor.width + x;
      const cell = { x, y };
      if (
        !tileDefinition(floor.tiles[index]!).walkable ||
        protectedIndexes.has(index) ||
        occupied.has(index) ||
        insideVault(floor, cell) ||
        anchors.some((anchor) => chebyshev(cell, anchor) < minimumAnchorDistance)
      )
        continue;
      cells.push(cell);
    }
  }
  return cells;
}

function wallAdjacent(floor: FloorSnapshot, cell: Point): boolean {
  const neighbors: readonly Point[] = [
    { x: cell.x, y: cell.y - 1 },
    { x: cell.x + 1, y: cell.y },
    { x: cell.x, y: cell.y + 1 },
    { x: cell.x - 1, y: cell.y },
  ];
  return neighbors.some((neighbor) => {
    const index = tileIndex(floor, neighbor.x, neighbor.y);
    return index === undefined || !tileDefinition(floor.tiles[index]!).walkable;
  });
}

interface CellDraw {
  readonly cell: Point;
  readonly remaining: readonly Point[];
  readonly state: Uint32State;
}

/**
 * Draws one cell from `pool` and culls every remaining candidate inside `spread` (Chebyshev) of the
 * winner -- the drawn cell included -- so later placements never crowd an earlier one.
 */
function drawCell(
  pool: readonly Point[],
  remaining: readonly Point[],
  spread: number,
  state: Uint32State,
): CellDraw | null {
  if (pool.length === 0) return null;
  const roll = rollDie(state, pool.length);
  const cell = pool[roll.value - 1]!;
  return {
    cell,
    remaining: remaining.filter((candidate) => chebyshev(candidate, cell) >= spread),
    state: roll.state,
  };
}

/**
 * Scatters ground loot, chests, and locked doors across a generated floor.
 *
 * The pass is a pure function of `(run, floor, content, state)`: candidate cells are collected in
 * row-major order, every roll threads the supplied `loot-placement` state, and depth-0 floors (the
 * town) return empty with the stream untouched.
 */
export function placeFloorLoot(
  input: Readonly<PlaceFloorLootInput>,
  state: Uint32State,
): FloorLootResult {
  const { run, floor, content } = input;
  if (floor.depth < 1) return { items: [], features: [], state };
  const knobs = balanceEntry(content).floorLoot;
  const band = depthBandFor(floor.depth, knobs.depthBands);
  const protectedIndexes = protectedRouteIndexes(floor);
  const occupied = occupiedIndexes(run, floor);

  let cursor = state;
  let remaining = candidateCells(input, knobs.minimumAnchorDistance, protectedIndexes, occupied);
  const items: ItemInstance[] = [];
  const features: DungeonFeature[] = [];
  const placedIndexes = new Set<number>();

  const scatterCount = rollRange(cursor, knobs.scatterCount.minimum, knobs.scatterCount.maximum);
  cursor = scatterCount.state;
  for (let pile = 0; pile < scatterCount.value; pile += 1) {
    const draw = drawCell(remaining, remaining, knobs.minimumSpreadDistance, cursor);
    if (draw === null) break;
    remaining = draw.remaining;
    cursor = draw.state;
    placedIndexes.add(draw.cell.y * floor.width + draw.cell.x);
    const loot = createFloorLootFromTable({
      content,
      tableId: `loot-table.floor-scatter-${band}`,
      state: cursor,
      itemIdPrefix: `item.floor-loot.${floor.floorId}.${ordinal(pile)}`,
      floorId: floor.floorId,
      x: draw.cell.x,
      y: draw.cell.y,
      depth: floor.depth,
    });
    cursor = loot.state;
    items.push(...loot.items);
  }

  const chestCount = rollRange(cursor, knobs.chestCount.minimum, knobs.chestCount.maximum);
  cursor = chestCount.state;
  for (let chest = 0; chest < chestCount.value; chest += 1) {
    const preferred = remaining.filter((cell) => wallAdjacent(floor, cell));
    const draw = drawCell(
      preferred.length > 0 ? preferred : remaining,
      remaining,
      knobs.minimumSpreadDistance,
      cursor,
    );
    if (draw === null) break;
    remaining = draw.remaining;
    cursor = draw.state;
    const index = draw.cell.y * floor.width + draw.cell.x;
    placedIndexes.add(index);
    const lockRoll = rollDie(cursor, PERCENT_SIDES);
    cursor = lockRoll.state;
    const locked = lockRoll.value <= knobs.lockedChestPercent;
    const feature: ChestFeature = {
      featureId: `feature.floor-loot.${floor.floorId}.chest-${ordinal(chest)}`,
      floorId: floor.floorId,
      x: draw.cell.x,
      y: draw.cell.y,
      contentId: null,
      coverTileId: floor.tiles[index]!,
      type: 'chest',
      lootTableId: `loot-table.chest-${band}`,
      lootContentId: null,
      state: locked ? 'locked' : 'closed',
      lock: locked ? { difficulty: knobs.chestLockDifficulty[band], keyContentId: null } : null,
    };
    features.push(feature);
  }

  let lockedDoors = 0;
  for (let index = 0; index < floor.tiles.length; index += 1) {
    if (floor.tiles[index] !== DOOR_TILE_ID) continue;
    if (protectedIndexes.has(index) || occupied.has(index) || placedIndexes.has(index)) continue;
    const lockRoll = rollDie(cursor, PERCENT_SIDES);
    cursor = lockRoll.state;
    if (lockRoll.value > knobs.lockedDoorPercent) continue;
    const door: DoorFeature = {
      featureId: `feature.floor-loot.${floor.floorId}.door-${ordinal(lockedDoors)}`,
      floorId: floor.floorId,
      x: index % floor.width,
      y: Math.floor(index / floor.width),
      contentId: null,
      coverTileId: floor.tiles[index]!,
      type: 'door',
      state: 'locked',
      lock: { difficulty: knobs.chestLockDifficulty[band], keyContentId: null },
    };
    features.push(door);
    lockedDoors += 1;
  }

  return { items, features, state: cursor };
}
