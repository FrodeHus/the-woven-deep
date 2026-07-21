import type { CompiledContentPack, VaultContentEntry } from '@woven-deep/content';
import { depthFloorId } from './floor-id.js';
import { createUnknownKnowledge } from './knowledge.js';
import type { AmbientLight } from './light-model.js';
import {
  assertOpaqueId,
  type FloorPlacementSlot,
  type FloorSnapshot,
  type OpaqueId,
  type Point,
  type TileId,
  type Uint32State,
  type VaultPlacement,
} from './model.js';
import { TERRAIN_TILE_IDS } from './town-floor.js';
import { type TransformedVaultSlot, vaultTransforms } from './vault-transform.js';

/** The Final Chamber is the deepest authored floor; the run concludes there. */
export const FINAL_CHAMBER_DEPTH = 20;

const FINAL_CHAMBER_VAULT_PLACEMENT_ID: OpaqueId = `vault-placement.depth-020.0`;

// The Chamber is authored, not generated: it consumes no RNG stream and carries no meaningful
// seed. Mirrors the town floor's all-zero seed constant (town-floor.ts) for the same reason: the
// save schema types a floor's `seed` as a bare four-word tuple, so an honest all-zero constant is
// schema-valid here and reads plainly as "not derived from randomness".
const FINAL_CHAMBER_FLOOR_SEED: Uint32State = [0, 0, 0, 0];

const FINAL_CHAMBER_AMBIENT: AmbientLight = { color: [200, 60, 90], strength: 220 };

function finalChamberVaultEntry(pack: CompiledContentPack): VaultContentEntry {
  const candidates = pack.entries.filter(
    (entry): entry is VaultContentEntry =>
      entry.kind === 'vault' && entry.tags.includes('final-chamber'),
  );
  if (candidates.length !== 1) {
    throw new Error(
      `generateFinalChamberFloor requires exactly one vault tagged "final-chamber", found ${candidates.length}`,
    );
  }
  return candidates[0]!;
}

function slotPoint(slots: readonly TransformedVaultSlot[], slotId: string): Point {
  const found = slots.find((entry) => entry.slot.id === slotId);
  if (!found)
    throw new Error(
      `generateFinalChamberFloor requires slot "${slotId}" in the final chamber vault`,
    );
  return { x: found.x, y: found.y };
}

/**
 * Assembles the authored Final Chamber floor from the content pack's `final-chamber`-tagged
 * vault: a fixed layout at `FINAL_CHAMBER_DEPTH` with no procedural generation and no randomness.
 * Mirrors `generateTownFloor` (town-floor.ts): select the sole tagged vault, transform it via its
 * single fixed transform, and assemble a fully lit `FloorSnapshot`. The Heart marker is placed by
 * the vault's `heart`-tagged fixture slot; this task authors the floor only -- the boss and choice
 * overlay arrive later.
 */
export function generateFinalChamberFloor(pack: CompiledContentPack): FloorSnapshot {
  const vault = finalChamberVaultEntry(pack);
  const transformed = vaultTransforms(vault)[0];
  if (!transformed) throw new Error(`final chamber vault ${vault.id} produced no transform`);
  const { width, height } = transformed;

  const tiles: TileId[] = new Array<TileId>(width * height).fill(TERRAIN_TILE_IDS.wall);
  for (const cell of transformed.cells) {
    tiles[cell.y * width + cell.x] = TERRAIN_TILE_IDS[cell.terrain];
  }

  const placementSlots: FloorPlacementSlot[] = transformed.slots
    .map(({ x, y, slot }): FloorPlacementSlot => {
      const slotId = `slot.depth-020.0.${slot.id}`;
      assertOpaqueId(slotId, 'final chamber slot id');
      return {
        slotId,
        vaultPlacementId: FINAL_CHAMBER_VAULT_PLACEMENT_ID,
        kind: slot.kind,
        required: slot.required,
        tags: [...slot.tags],
        x,
        y,
      };
    })
    .sort((left, right) => (left.slotId < right.slotId ? -1 : left.slotId > right.slotId ? 1 : 0));

  const vaultPlacement: VaultPlacement = {
    placementId: FINAL_CHAMBER_VAULT_PLACEMENT_ID,
    vaultId: vault.id,
    x: 0,
    y: 0,
    width,
    height,
    rotation: 0,
    reflected: false,
    entrances: transformed.entrances.map(({ x, y }) => ({ x, y })),
  };

  const chamberEntrance = slotPoint(transformed.slots, 'chamber-entrance');

  return {
    floorId: depthFloorId(FINAL_CHAMBER_DEPTH),
    seed: FINAL_CHAMBER_FLOOR_SEED,
    generatorVersion: 2,
    width,
    height,
    depth: FINAL_CHAMBER_DEPTH,
    tiles,
    entities: [],
    themeId: 'theme.final-chamber',
    ambient: FINAL_CHAMBER_AMBIENT,
    knowledge: createUnknownKnowledge(width * height),
    lights: [],
    stairUp: chamberEntrance,
    stairDown: null,
    vaults: [vaultPlacement],
    placementSlots,
  };
}
