import type { CSSProperties, JSX } from 'react';

export interface ThreatPopoverActor {
  readonly name?: string;
  readonly glyph?: string;
  readonly disposition: string;
  readonly healthPresentation: { readonly band: string };
  readonly intentPresentation?: string;
}

export interface ThreatPopoverProps {
  readonly actor: ThreatPopoverActor;
  /** Screen-space column/row, camera-relative (world coordinate minus camera origin). */
  readonly col: number;
  readonly row: number;
  /** The map pane's size in cells, used to clamp the popover so it never renders off-pane. */
  readonly paneCols: number;
  readonly paneRows: number;
  /**
   * The measured cell size in pixels (see `PlayScreen`'s `cellProbeRef`), used to convert the
   * clamped col/row into an inline pixel position. `.threat-popover` is a sibling of `.playfield`
   * in the DOM (not a descendant), so it cannot inherit `--cell-w`/`--cell-h` custom properties
   * from the grid; positioning it in pixels here sidesteps that entirely.
   */
  readonly cellPx: Readonly<{ width: number; height: number }>;
}

/**
 * A mouse convenience only: the same fields (name, glyph, health band, intent, disposition) stay
 * keyboard-reachable via the `<details>` threat drawer that `PlayScreen` renders alongside this at
 * `compact`/`minimal` tiers. Non-focusable and dismissed by the caller on mouseleave, scroll, or a
 * new session snapshot (see `PlayScreen`), so it never gets stranded pointing at a stale cell.
 */
export function ThreatPopover({ actor, col, row, paneCols, paneRows, cellPx }: ThreatPopoverProps): JSX.Element {
  const clampedCol = Math.max(0, Math.min(col, Math.max(paneCols - 1, 0)));
  const clampedRow = Math.max(0, Math.min(row, Math.max(paneRows - 1, 0)));
  const style: CSSProperties = { left: `${clampedCol * cellPx.width}px`, top: `${clampedRow * cellPx.height}px` };

  return (
    <div role="tooltip" className="threat-popover" style={style}>
      <strong>{actor.name ?? 'Something'}</strong>
      {actor.glyph && <span aria-hidden="true">{actor.glyph}</span>}
      <div>{`Health: ${actor.healthPresentation.band}`}</div>
      {actor.intentPresentation && <div>{`Intent: ${actor.intentPresentation}`}</div>}
      <div>{`Disposition: ${actor.disposition}`}</div>
    </div>
  );
}
