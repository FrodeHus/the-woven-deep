import type { CompiledContentPack } from '@woven-deep/content';
import { balanceEntry } from './balance.js';
import { protectedRouteIndexes } from './connectivity.js';
import type { ChestFeature, DoorFeature, DungeonFeature } from './feature-model.js';
import { createFloorLootFromTable, projectLootGraph } from './inventory.js';
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

const REQUIRED_LOOT_TABLE_KINDS = ['floor-scatter', 'chest'] as const;
const DEPTH_BANDS: readonly DepthBand[] = ['shallow', 'mid', 'deep'];

/**
 * Preflights the six loot tables this module resolves by exact id --
 * `loot-table.floor-scatter-<band>` and `loot-table.chest-<band>`. The ids are constructed, not
 * authored, so a pack that removes or renames one would otherwise only fail on the first descent
 * into that band, mid-run. Each id must resolve to a `loot-table` entry whose graph projects
 * cleanly at a depth representative of its own band, and must keep at least one eligible choice
 * there (an all-pruned projection would roll against a zero weight total when the floor actually
 * rolls). Representative depths come from the authored `floorLoot.depthBands`, so retuning the
 * bands retunes the preflight with them.
 *
 * A pack-only invariant: nothing about a run can change it, so this runs once at run creation and
 * once per save load, never per command.
 */
export function validateRequiredFloorLootTables(content: CompiledContentPack): void {
  const bands = balanceEntry(content).floorLoot.depthBands;
  const representativeDepth: Readonly<Record<DepthBand, number>> = {
    shallow: 1,
    mid: bands.shallowMaxDepth + 1,
    deep: bands.midMaxDepth + 1,
  };
  for (const kind of REQUIRED_LOOT_TABLE_KINDS) {
    for (const band of DEPTH_BANDS) {
      const tableId = `loot-table.${kind}-${band}`;
      const label = `content preflight: engine-required floor loot table ${tableId}`;
      const entry = content.entries.find((candidate) => candidate.id === tableId);
      if (entry === undefined || entry.kind !== 'loot-table') {
        throw new Error(
          `${label} does not exist; floor generation resolves it by exact id on every ` +
            `${band}-band floor`,
        );
      }
      const depth = representativeDepth[band];
      const projected = projectLootGraph({
        content,
        rootTableId: tableId,
        depth,
        preflightLabel: label,
      });
      if (projected.get(tableId)!.choices.length === 0) {
        throw new Error(`${label} has no choice eligible at ${band}-band depth ${depth}`);
      }
    }
  }
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

/** Cells on this floor a feature already holds, so the door pass never doubles up on one. */
function featureIndexes(run: ActiveRun, floor: FloorSnapshot): ReadonlySet<number> {
  const indexes = new Set<number>();
  for (const feature of run.features) {
    if (feature.floorId !== floor.floorId) continue;
    const index = tileIndex(floor, feature.x, feature.y);
    if (index !== undefined) indexes.add(index);
  }
  return indexes;
}

/**
 * Cells a body stands on: the snapshot's own occupancy list plus the run's living actors on this
 * floor. `floor.entities` can lag the actors within a single `placeFloorPopulations` call
 * (encounters commit to `run.actors`, not to the snapshot), so both are collected -- otherwise a
 * chest or locked door can land under a monster spawned moments earlier in the same pass.
 */
function bodyIndexes(run: ActiveRun, floor: FloorSnapshot): ReadonlySet<number> {
  const bodies = new Set<number>();
  for (const entity of floor.entities) {
    const index = tileIndex(floor, entity.x, entity.y);
    if (index !== undefined) bodies.add(index);
  }
  for (const actor of run.actors) {
    if (actor.floorId !== floor.floorId || actor.health <= 0) continue;
    const index = tileIndex(floor, actor.x, actor.y);
    if (index !== undefined) bodies.add(index);
  }
  return bodies;
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

/**
 * The floor's open-cell placement envelope, in row-major order: walkable, off a protected stair
 * route, clear of committed features and of every body (snapshot entities and living actors
 * alike), outside every vault footprint, and at least the authored anchor distance from either
 * stair.
 *
 * Exported so a pass that needs a cell but draws no loot -- champion placement on a floor whose
 * vaults author no fallen-hero slot -- lands under exactly the constraints scatter piles and
 * chests obey, by sharing the function rather than restating the rules.
 */
export function openPlacementCells(input: Readonly<PlaceFloorLootInput>): readonly Point[] {
  const knobs = balanceEntry(input.content).floorLoot;
  const occupied = new Set<number>([
    ...featureIndexes(input.run, input.floor),
    ...bodyIndexes(input.run, input.floor),
  ]);
  return candidateCells(
    input,
    knobs.minimumAnchorDistance,
    protectedRouteIndexes(input.floor),
    occupied,
  );
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
 * Scatters ground loot and chests across a generated floor, and hangs a door feature on every one
 * of its door tiles.
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
  const featureCells = featureIndexes(run, floor);
  const bodies = bodyIndexes(run, floor);
  const occupied = new Set<number>([...featureCells, ...bodies]);

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

  // Every door tile needs a door feature. The tile alone is an unopenable wall: bump-to-open and
  // the explicit open-door command both work off a closed door *feature*, so a tile without one
  // can never be passed -- and on a protected route that is a soft-locked run. Two skips keep the
  // pass from doubling up: `featureCells` holds the features already committed to `run` (a vault's
  // authored door, or an earlier call on this same floor -- this is what makes repeated calls
  // idempotent), and `placedIndexes` holds the cells this very call just drew for scatter loot and
  // chests, which are not in `run` yet.
  let doors = 0;
  for (let index = 0; index < floor.tiles.length; index += 1) {
    if (floor.tiles[index] !== DOOR_TILE_ID) continue;
    if (featureCells.has(index) || placedIndexes.has(index)) continue;
    // Door terrain is not walkable, so nothing may be standing on it: generation places actors and
    // entities on walkable cells only. Pinned here because the pass would otherwise seal a body
    // behind a closed door feature and produce a run the save schema refuses.
    if (bodies.has(index)) {
      throw new Error(
        `internal invariant: door tile ${index % floor.width},${Math.floor(index / floor.width)} on floor ${floor.floorId} is occupied`,
      );
    }
    // Protected-route doors consume no roll and are never locked: keeping the stair route walkable
    // is the invariant, and a closed door already satisfies it.
    let locked = false;
    if (!protectedIndexes.has(index)) {
      const lockRoll = rollDie(cursor, PERCENT_SIDES);
      cursor = lockRoll.state;
      locked = lockRoll.value <= knobs.lockedDoorPercent;
    }
    const base = {
      featureId: `feature.floor-loot.${floor.floorId}.door-${ordinal(doors)}`,
      floorId: floor.floorId,
      x: index % floor.width,
      y: Math.floor(index / floor.width),
      contentId: null,
      coverTileId: floor.tiles[index]!,
      type: 'door',
    } as const;
    // A `closed` door carries no `lock` record at all -- the save schema enforces the lock is
    // present if and only if the door is `locked`.
    const door: DoorFeature = locked
      ? {
          ...base,
          state: 'locked',
          lock: { difficulty: knobs.chestLockDifficulty[band], keyContentId: null },
        }
      : { ...base, state: 'closed' };
    features.push(door);
    doors += 1;
  }

  return { items, features, state: cursor };
}
