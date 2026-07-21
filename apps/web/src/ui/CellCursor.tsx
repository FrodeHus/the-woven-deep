import type { CSSProperties, JSX } from 'react';

export interface CellCursorProps {
  /** Screen-space column/row, camera-relative (world coordinate minus camera origin). */
  readonly col: number;
  readonly row: number;
  /** Whether a click on this cell would actually move/travel/attack/pick up there. Drives the
   * inviting accent highlight versus the dimmed, non-actionable cue. */
  readonly reachable: boolean;
  readonly cellPx: Readonly<{ width: number; height: number }>;
}

/**
 * The mouse movement affordance: a one-cell highlight under the pointer, telling the player the map
 * is mouse-navigable. It mirrors the mockup's hovered-cell outline (a subtle accent stroke) and
 * distinguishes a reachable target (accent, inviting a click) from a non-actionable cell (a dimmed,
 * dashed cue) using the reachability auto-travel already computes. Purely decorative and
 * pointer-events-free -- a sibling overlay of the grid, so `GridRenderer`'s per-cell rendering is
 * untouched -- positioned in pixels from the measured cell size, exactly like the hover popovers.
 */
export function CellCursor({ col, row, reachable, cellPx }: CellCursorProps): JSX.Element {
  const style: CSSProperties = {
    left: `${col * cellPx.width}px`,
    top: `${row * cellPx.height}px`,
    width: `${cellPx.width}px`,
    height: `${cellPx.height}px`,
  };
  return (
    <div
      aria-hidden="true"
      data-testid="cell-cursor"
      data-reachable={reachable}
      className={`cell-cursor ${reachable ? 'cell-cursor-reachable' : 'cell-cursor-blocked'}`}
      style={style}
    />
  );
}
