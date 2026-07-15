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
}

/**
 * A mouse convenience only: the same fields (name, glyph, health band, intent, disposition) stay
 * keyboard-reachable via the `<details>` threat drawer that `PlayScreen` renders alongside this at
 * `compact`/`minimal` tiers. Non-focusable and dismissed by the caller on mouseleave, scroll, or a
 * new session snapshot (see `PlayScreen`), so it never gets stranded pointing at a stale cell.
 */
export function ThreatPopover({ actor, col, row, paneCols, paneRows }: ThreatPopoverProps): JSX.Element {
  const clampedCol = Math.max(0, Math.min(col, Math.max(paneCols - 1, 0)));
  const clampedRow = Math.max(0, Math.min(row, Math.max(paneRows - 1, 0)));
  const style: CSSProperties = { '--x': clampedCol, '--y': clampedRow } as CSSProperties;

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
