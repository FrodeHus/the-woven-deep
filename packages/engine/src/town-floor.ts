import type { CompiledContentPack, VaultContentEntry } from '@woven-deep/content';
import { depthFloorId } from './floor-id.js';
import { createUnknownKnowledge } from './knowledge.js';
import type { AmbientLight, LightSource } from './light-model.js';
import {
  assertOpaqueId,
  type ActiveRun,
  type FloorPlacementSlot,
  type FloorSnapshot,
  type OpaqueId,
  type Point,
  type TileId,
  type Uint32State,
  type VaultPlacement,
} from './model.js';
import { TILE_DEFINITIONS } from './terrain.js';
import { type TransformedVaultSlot, vaultTransforms } from './vault-transform.js';

/** The town is the sole depth-0 floor; `depthFloorId(0)` formats it as `floor.depth-000`. */
export const TOWN_FLOOR_ID: OpaqueId = depthFloorId(0);

/**
 * True when the run's active floor is the depth-0 town: the sole floor where the town step
 * contract applies (frozen worldTime, hero-always-ready, truce on hostile actions/rest, no
 * idle-advance or merchant-lifecycle processing). Identified strictly by the active floor's
 * `depth` field -- never by comparing floor identifiers -- so it stays correct even if the town's
 * floorId ever changed shape.
 */
export function isTownFloorActive(run: Pick<ActiveRun, 'floors' | 'activeFloorId'>): boolean {
  const floor = run.floors.find((candidate) => candidate.floorId === run.activeFloorId);
  return floor !== undefined && floor.depth === 0;
}

const TOWN_VAULT_PLACEMENT_ID: OpaqueId = 'vault-placement.depth-000.0';

// The town is authored, not generated: it consumes no RNG stream and carries no meaningful seed.
// The save schema types a floor's `seed` as a bare four-word tuple (unlike run/rng-stream state,
// which is separately required non-zero via `isNonZeroState`), so an honest all-zero constant is
// schema-valid here and reads plainly as "not derived from randomness".
const TOWN_FLOOR_SEED: Uint32State = [0, 0, 0, 0];

const TOWN_AMBIENT: AmbientLight = { color: [24, 22, 30], strength: 9 };

export const TERRAIN_TILE_IDS = Object.fromEntries(
  TILE_DEFINITIONS.map((definition) => [definition.name, definition.id]),
) as Record<(typeof TILE_DEFINITIONS)[number]['name'], TileId>;

// The eight neighbors of the dungeon-entrance slot, in the fixed scan order used to break ties
// deterministically: lowest y first, then lowest x.
const NEIGHBOR_OFFSETS: readonly Point[] = [
  { x: -1, y: -1 },
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: -1, y: 1 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
];

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export interface TownFloorResult {
  readonly floor: FloorSnapshot;
  readonly entrancePlaza: Point;
  readonly houseDoor: Point;
  readonly merchantSlots: Readonly<
    Record<'provisioner' | 'arms' | 'curios' | 'spellvendor', Point>
  >;
}

function townVaultEntry(pack: CompiledContentPack): VaultContentEntry {
  const candidates = pack.entries.filter(
    (entry): entry is VaultContentEntry => entry.kind === 'vault' && entry.tags.includes('town'),
  );
  if (candidates.length !== 1) {
    throw new Error(
      `generateTownFloor requires exactly one vault tagged "town", found ${candidates.length}`,
    );
  }
  return candidates[0]!;
}

function slotPoint(slots: readonly TransformedVaultSlot[], slotId: string): Point {
  const found = slots.find((entry) => entry.slot.id === slotId);
  if (!found) throw new Error(`generateTownFloor requires slot "${slotId}" in the town vault`);
  return { x: found.x, y: found.y };
}

// The dungeon-entrance cell itself is stair-down terrain and cannot host the hero's spawn
// (standing there would immediately satisfy `descendToNextFloor`'s precondition), so the plaza is
// the nearest walkable floor tile next to it instead. Deterministic tie-break: lowest y, then
// lowest x, among its eight neighbors.
function entrancePlazaFrom(
  tiles: readonly TileId[],
  width: number,
  height: number,
  entrance: Point,
): Point {
  const candidates = NEIGHBOR_OFFSETS.map((offset) => ({
    x: entrance.x + offset.x,
    y: entrance.y + offset.y,
  }))
    .filter(
      (point) =>
        point.x >= 0 &&
        point.x < width &&
        point.y >= 0 &&
        point.y < height &&
        tiles[point.y * width + point.x] === TERRAIN_TILE_IDS.floor,
    )
    .sort((left, right) => left.y - right.y || left.x - right.x);
  const chosen = candidates[0];
  if (!chosen) {
    throw new Error(
      'generateTownFloor requires a walkable floor tile adjacent to the dungeon entrance',
    );
  }
  return chosen;
}

/**
 * Assembles the authored town floor from the content pack's `town`-tagged vault: a fixed layout at
 * depth 0 with no procedural generation and no randomness. Merchants are not materialized here
 * (that arrives with permanent-merchant semantics later) -- this produces the empty town, with its
 * merchant/house-door slots recorded as placement metadata for later use.
 */
export function generateTownFloor(pack: CompiledContentPack): TownFloorResult {
  const vault = townVaultEntry(pack);
  const transformed = vaultTransforms(vault)[0];
  if (!transformed) throw new Error(`town vault ${vault.id} produced no transform`);
  const { width, height } = transformed;

  const tiles: TileId[] = new Array<TileId>(width * height).fill(TERRAIN_TILE_IDS.wall);
  for (const cell of transformed.cells) {
    tiles[cell.y * width + cell.x] = TERRAIN_TILE_IDS[cell.terrain];
  }

  // The save schema requires both `lights` and `placementSlots` to be strictly increasing by id;
  // the vault's row-major cell order does not match alphabetical id order, so both are re-sorted
  // by id here (mirroring `placeVaults`'s own final sort in vault-placement.ts).
  const lights: LightSource[] = transformed.fixtures
    .map(({ x, y, fixture }): LightSource => {
      const lightId = `light.depth-000.0.${fixture.idSuffix}`;
      assertOpaqueId(lightId, 'town light id');
      return {
        lightId,
        location: { type: 'fixed', x, y },
        color: [...fixture.color] as [number, number, number],
        radius: fixture.radius,
        strength: fixture.strength,
        enabled: fixture.enabled,
        falloff: 'linear',
        vaultPlacementId: TOWN_VAULT_PLACEMENT_ID,
        presentation: { glyph: fixture.glyph, token: fixture.presentationToken },
      };
    })
    .sort((left, right) => compareText(left.lightId, right.lightId));

  const placementSlots: FloorPlacementSlot[] = transformed.slots
    .map(({ x, y, slot }): FloorPlacementSlot => {
      const slotId = `slot.depth-000.0.${slot.id}`;
      assertOpaqueId(slotId, 'town slot id');
      return {
        slotId,
        vaultPlacementId: TOWN_VAULT_PLACEMENT_ID,
        kind: slot.kind,
        required: slot.required,
        tags: [...slot.tags],
        x,
        y,
      };
    })
    .sort((left, right) => compareText(left.slotId, right.slotId));

  const vaultPlacement: VaultPlacement = {
    placementId: TOWN_VAULT_PLACEMENT_ID,
    vaultId: vault.id,
    x: 0,
    y: 0,
    width,
    height,
    rotation: 0,
    reflected: false,
    entrances: transformed.entrances.map(({ x, y }) => ({ x, y })),
  };

  const dungeonEntrance = slotPoint(transformed.slots, 'dungeon-entrance');
  const houseDoor = slotPoint(transformed.slots, 'house-door');
  const merchantSlots = {
    provisioner: slotPoint(transformed.slots, 'merchant-provisioner'),
    arms: slotPoint(transformed.slots, 'merchant-arms'),
    curios: slotPoint(transformed.slots, 'merchant-curios'),
    spellvendor: slotPoint(transformed.slots, 'merchant-spellvendor'),
  };

  const floor: FloorSnapshot = {
    floorId: TOWN_FLOOR_ID,
    seed: TOWN_FLOOR_SEED,
    generatorVersion: 2,
    width,
    height,
    depth: 0,
    tiles,
    entities: [],
    themeId: 'theme.town',
    ambient: TOWN_AMBIENT,
    knowledge: createUnknownKnowledge(width * height),
    lights,
    stairUp: null,
    stairDown: dungeonEntrance,
    vaults: [vaultPlacement],
    placementSlots,
  };

  return {
    floor,
    entrancePlaza: entrancePlazaFrom(tiles, width, height, dungeonEntrance),
    houseDoor,
    merchantSlots,
  };
}
