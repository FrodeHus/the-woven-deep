import type { CSSProperties, JSX } from 'react';
import type { ObservableFloorProjection, Point } from '@woven-deep/engine';
import type { CameraOrigin, CameraViewport } from './camera.js';

export interface TargetingOverlayProps {
  readonly floor: ObservableFloorProjection;
  readonly camera: CameraOrigin;
  readonly viewport: CameraViewport;
  readonly cellPx: Readonly<{ width: number; height: number }>;
  /** Cells a cast could actually land on right now (`useSpellTargeting`'s `validCells`), as
   * `"x,y"` keys. */
  readonly validCells: ReadonlySet<string>;
  /** The currently hovered/reticled cell (mouse cursor when it sits over a valid target, else the
   * keyboard reticle) -- highlighted distinctly from the rest of the valid set. `null` when nothing
   * is currently targeted. */
  readonly highlighted: Point | null;
  /** `"x,y"` keys of cells where an affected actor stands -- highlighted distinctly so the player
   * sees who gets hit by the current footprint. */
  readonly affectedActorCells: ReadonlySet<string>;
}

/**
 * The targeting-mode map overlay (Task 10): while a spell is being targeted, every valid target
 * cell in view is highlighted (▓, `.targeting-cell-valid`), every OTHER known (visible/remembered)
 * in-view cell is dimmed (░, `.targeting-cell-dim`) so the valid set reads clearly against the rest
 * of the room, and the hovered/reticled cell gets its own distinct treatment
 * (`.targeting-cell-reticle`). A sibling of `CellCursor` -- same absolute-position-from-measured-
 * cell-size approach, purely decorative and pointer-events-free -- rendered instead of it while
 * targeting is active (`PlayScreen` swaps the two rather than layering both).
 */
export function TargetingOverlay({
  floor,
  camera,
  viewport,
  cellPx,
  validCells,
  highlighted,
  affectedActorCells,
}: TargetingOverlayProps): JSX.Element {
  const cells: JSX.Element[] = [];

  for (let row = 0; row < viewport.height; row += 1) {
    for (let col = 0; col < viewport.width; col += 1) {
      const x = camera.x + col;
      const y = camera.y + row;
      if (x < 0 || y < 0 || x >= floor.width || y >= floor.height) continue;
      const cell = floor.cells[y * floor.width + x];
      if (!cell || cell.knowledge === 'unknown') continue;

      const key = `${x},${y}`;
      const valid = validCells.has(key);
      const isHighlighted = highlighted !== null && highlighted.x === x && highlighted.y === y;
      if (!valid && !isHighlighted) {
        const style: CSSProperties = {
          left: `${col * cellPx.width}px`,
          top: `${row * cellPx.height}px`,
          width: `${cellPx.width}px`,
          height: `${cellPx.height}px`,
        };
        cells.push(
          <span
            key={key}
            aria-hidden="true"
            data-testid="targeting-dim"
            className="targeting-cell targeting-cell-dim"
            style={style}
          />,
        );
        continue;
      }

      const style: CSSProperties = {
        left: `${col * cellPx.width}px`,
        top: `${row * cellPx.height}px`,
        width: `${cellPx.width}px`,
        height: `${cellPx.height}px`,
      };
      cells.push(
        <span
          key={key}
          aria-hidden="true"
          data-testid={isHighlighted ? 'targeting-reticle' : 'targeting-valid'}
          data-cell={key}
          className={[
            'targeting-cell',
            valid ? 'targeting-cell-valid' : '',
            isHighlighted ? 'targeting-cell-reticle' : '',
            affectedActorCells.has(key) ? 'targeting-cell-affected-actor' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={style}
        />,
      );
    }
  }

  return <>{cells}</>;
}
