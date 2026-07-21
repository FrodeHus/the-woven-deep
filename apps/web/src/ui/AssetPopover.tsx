import type { CSSProperties, JSX } from 'react';

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
}

export interface AssetPopoverProps {
  readonly asset: HoverAsset;
  /** Screen-space column/row, camera-relative (world coordinate minus camera origin). */
  readonly col: number;
  readonly row: number;
  readonly paneCols: number;
  readonly paneRows: number;
  readonly cellPx: Readonly<{ width: number; height: number }>;
}

/**
 * The item/tile counterpart to `ThreatPopover`: same non-focusable, pointer-events-free tooltip,
 * positioned in pixels from the measured cell size and clamped to the pane so it never renders off
 * the map. Shows the asset's name and a one-line descriptor. Dismissed by the caller on mouseleave,
 * scroll, or a new session snapshot (see `useCellHover`).
 */
export function AssetPopover({
  asset,
  col,
  row,
  paneCols,
  paneRows,
  cellPx,
}: AssetPopoverProps): JSX.Element {
  const clampedCol = Math.max(0, Math.min(col, Math.max(paneCols - 1, 0)));
  const clampedRow = Math.max(0, Math.min(row, Math.max(paneRows - 1, 0)));
  const style: CSSProperties = {
    left: `${clampedCol * cellPx.width}px`,
    top: `${clampedRow * cellPx.height}px`,
  };

  return (
    <div role="tooltip" className="threat-popover framed" style={style}>
      <strong>{asset.title}</strong>
      {asset.glyph && <span aria-hidden="true">{asset.glyph}</span>}
      <div>{asset.detail}</div>
    </div>
  );
}
