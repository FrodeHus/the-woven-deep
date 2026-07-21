import type { CSSProperties, JSX } from 'react';
import type { CompiledContentPack } from '@woven-deep/content';
import { itemById } from '../session/pack-queries.js';
import { itemKnownFacts } from '../session/item-facts.js';

/** A hovered non-actor asset: a floor item or a notable tile (stairs, a door). `title` names it and
 * `detail` describes what it is -- the honest best available, since the compiled content pack carries
 * no free-text flavour (see `useCellHover`). */
export interface HoverAsset {
  readonly title: string;
  readonly detail: string;
  readonly glyph?: string;
  /** World coordinates of the hovered cell -- `PlayScreen` converts these to camera-relative
   * col/row before passing them in, exactly as it does for `ThreatPopover`. */
  readonly x: number;
  readonly y: number;
  /** The ground item's content id, present only once it's identified/known -- the wire projection
   * omits it entirely for an unidentified item (see `useCellHover`'s `itemAssetAtCell`). Absent for
   * a tile asset (stairs, a door), which has no content-pack backing at all. Looked up against
   * `pack` to surface the item's authored `description` and known facts, mirroring `ThreatPopover`. */
  readonly contentId?: string;
}

export interface AssetPopoverProps {
  readonly asset: HoverAsset;
  /** Screen-space column/row, camera-relative (world coordinate minus camera origin). */
  readonly col: number;
  readonly row: number;
  readonly paneCols: number;
  readonly paneRows: number;
  readonly cellPx: Readonly<{ width: number; height: number }>;
  /** Looked up by `asset.contentId` to surface an identified ground item's authored `description`
   * and known facts -- the pack is the single source for that text, never threaded through the
   * engine projection. */
  readonly pack: CompiledContentPack;
}

/**
 * The item/tile counterpart to `ThreatPopover`: same non-focusable, pointer-events-free tooltip,
 * positioned in pixels from the measured cell size and clamped to the pane so it never renders off
 * the map. Shows the asset's name and a one-line descriptor, plus -- when `asset.contentId` resolves
 * in `pack` (an identified ground item) -- its authored description and known facts (Damage/Armor/
 * Light/Worth), the same ones the inventory `DetailPane` shows. An unidentified item or a tile (no
 * `contentId`) renders exactly as before: title + detail only. Dismissed by the caller on
 * mouseleave, scroll, or a new session snapshot (see `useCellHover`).
 */
export function AssetPopover({
  asset,
  col,
  row,
  paneCols,
  paneRows,
  cellPx,
  pack,
}: AssetPopoverProps): JSX.Element {
  const clampedCol = Math.max(0, Math.min(col, Math.max(paneCols - 1, 0)));
  const clampedRow = Math.max(0, Math.min(row, Math.max(paneRows - 1, 0)));
  const style: CSSProperties = {
    left: `${clampedCol * cellPx.width}px`,
    top: `${clampedRow * cellPx.height}px`,
  };
  const content = asset.contentId === undefined ? undefined : itemById(pack, asset.contentId);

  return (
    <div role="tooltip" className="threat-popover framed" style={style}>
      <strong>{asset.title}</strong>
      {asset.glyph && <span aria-hidden="true">{asset.glyph}</span>}
      <div>{asset.detail}</div>
      {content?.description && <p className="threat-popover-description">{content.description}</p>}
      {content != null && (
        <div className="flex flex-col gap-0.5 text-xs">
          {itemKnownFacts(content).map((fact) => (
            <div key={fact.label} className="flex items-baseline gap-1">
              <span className="text-muted">{fact.label}:</span>
              <span>{fact.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
