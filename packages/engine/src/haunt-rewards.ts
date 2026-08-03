import type { CompiledContentPack, ItemContentEntry } from '@woven-deep/content';
import { createRecordedHeirloom } from './inventory.js';
import type { ItemInstance } from './item-model.js';
import type { OpaqueId } from './model.js';
import type { RecordedHeirloomSnapshot } from './population-model.js';
import { stableJson } from './stable-json.js';

/**
 * What a haunt leaves behind. A fallen hero's ghost guarded everything it wore, so defeating one
 * hands back the whole recorded kit rather than the single distinguished heirloom -- this module is
 * the shared materialization both the champion (whole set) and the echo (one drawn piece, Task 6)
 * drop through, so the two can never disagree about ids, ordering, or degradation.
 */

export interface MaterializedPiece {
  readonly item: ItemInstance;
  readonly fallback: boolean;
  readonly displayName: string;
  readonly glyph: string;
  readonly color: string;
}

/** How many digits a piece's index is padded to. Four covers the schema's twelve-piece ceiling many
 * times over, and the fixed width is what makes the ids sort in snapshot order. */
const INDEX_DIGITS = 4;

export interface HauntDropSet {
  readonly snapshots: readonly RecordedHeirloomSnapshot[];
  /** Where the distinguished recorded heirloom sits in `snapshots` -- what
   * `champion.heirloom-created` still names. */
  readonly heirloomIndex: number;
}

/**
 * The snapshots a defeated haunt actually gives back: its recorded death inventory, plus the
 * distinguished heirloom appended when that heirloom is not already among them.
 *
 * The appended case is not hypothetical. `finalizeRun` captures the death inventory from the
 * EQUIPPED slots only, while the heirloom is selected from everything the hero held -- an artifact
 * carried in the backpack at death is therefore a recorded heirloom that no equipped snapshot
 * covers. Dropping the inventory alone would strand it: `finalizeRun` has already marked the
 * artifact `lost` against that record, and the haunt's drop is the only way it returns to
 * circulation. Appending keeps the pre-haunt guarantee (the heirloom always comes back) intact and
 * leaves every inventory piece at its original index.
 */
export function hauntDropSnapshots(
  standing: Readonly<{
    deathInventory: readonly RecordedHeirloomSnapshot[];
    heirloom: RecordedHeirloomSnapshot;
  }>,
): HauntDropSet {
  const { deathInventory, heirloom } = standing;
  // A real recorded item is identified by the instance it was taken from. A heirloom with no
  // `sourceItemId` is the template's synthesized fallback relic, which no instance backs, so
  // identity falls back to the snapshot's own contents.
  const index = deathInventory.findIndex((piece) =>
    heirloom.sourceItemId === null
      ? stableJson(piece) === stableJson(heirloom)
      : piece.sourceItemId === heirloom.sourceItemId,
  );
  return index >= 0
    ? { snapshots: deathInventory, heirloomIndex: index }
    : { snapshots: [...deathInventory, heirloom], heirloomIndex: deathInventory.length };
}

/**
 * The artifact content ids `items` already holds an instance of.
 *
 * Two Hall records can each list the same artifact in their death inventories -- it circulated
 * through both heroes before it was lost -- and both can be standings in one run. Handing back both
 * would mint a second copy of a singleton and break artifact circulation's central pillar. A haunt
 * whose artifact is already in the run held only a memory of it, so its piece degrades to the
 * template's fallback relic: a piece still comes back, it just is not the relic itself.
 */
export function circulatingArtifactContentIds(
  content: CompiledContentPack,
  items: readonly ItemInstance[],
): ReadonlySet<OpaqueId> {
  const artifacts = new Set(
    content.entries
      .filter((entry): entry is ItemContentEntry => entry.kind === 'item' && entry.artifact != null)
      .map((entry) => entry.id),
  );
  const circulating = new Set<OpaqueId>();
  for (const item of items) {
    if (artifacts.has(item.contentId)) circulating.add(item.contentId);
  }
  return circulating;
}

/** The item id prefix every piece a haunt population drops shares. Both validation tiers re-derive
 * it, so the drop and the checks that police it can never disagree about the scheme. */
export function hauntDropItemIdPrefix(populationId: OpaqueId): string {
  return `item.haunt.${populationId}`;
}

/** The item id of the piece at `index` of a haunt's death inventory. The single source of truth for
 * the scheme: the stepper mints these, and both validation tiers re-derive them to check the set. */
export function hauntPieceItemId(itemIdPrefix: string, index: number): OpaqueId {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new Error(`haunt piece index ${index} is not a safe non-negative integer`);
  }
  return `${itemIdPrefix}.${String(index).padStart(INDEX_DIGITS, '0')}`;
}

/**
 * Materializes a set of recorded instance snapshots onto one cell, one `createRecordedHeirloom`
 * call per snapshot, in the snapshots' own order. Item ids are `${itemIdPrefix}.${index}` zero-
 * padded to four digits, so the whole set is deterministic and collision-checkable. Per-item
 * fallback degradation is unchanged: a piece the current pack no longer defines becomes the
 * template's fallback relic, and the rest of the set is unaffected -- and a degraded piece keeps
 * its own index, so the ids never renumber around it. Consumes NO randomness.
 */
export function materializeDeathInventory(
  input: Readonly<{
    content: CompiledContentPack;
    snapshots: readonly RecordedHeirloomSnapshot[];
    equippedItemContentIds: readonly OpaqueId[];
    fallbackItemId: OpaqueId;
    /** Every item already in the run, so an artifact that is still in circulation is not minted a
     * second time. Required rather than optional: a caller that forgot it would silently duplicate
     * a singleton. Validation passes the same list minus the pieces it is re-deriving. */
    existingItems: readonly ItemInstance[];
    itemIdPrefix: string;
    floorId: OpaqueId;
    x: number;
    y: number;
  }>,
): readonly MaterializedPiece[] {
  // The unavailable set accumulates as the set materializes: a piece that mints an artifact makes
  // that artifact unavailable to every LATER piece of the same drop, so a drop whose snapshots name
  // the same singleton twice (composable from two sources) can never mint it twice in one call.
  const unavailableContentIds = new Set(
    circulatingArtifactContentIds(input.content, input.existingItems),
  );
  return input.snapshots.map((snapshot, index) => {
    const piece = createRecordedHeirloom({
      content: input.content,
      snapshot,
      equippedItemContentIds: input.equippedItemContentIds,
      fallbackItemId: input.fallbackItemId,
      unavailableContentIds,
      itemId: hauntPieceItemId(input.itemIdPrefix, index),
      floorId: input.floorId,
      x: input.x,
      y: input.y,
    });
    if (!piece.fallback && isArtifactContentId(input.content, piece.item.contentId)) {
      unavailableContentIds.add(piece.item.contentId);
    }
    return piece;
  });
}

/** Whether `contentId` names an artifact item in `content`. */
function isArtifactContentId(content: CompiledContentPack, contentId: OpaqueId): boolean {
  return content.entries.some(
    (entry) => entry.kind === 'item' && entry.id === contentId && entry.artifact != null,
  );
}
