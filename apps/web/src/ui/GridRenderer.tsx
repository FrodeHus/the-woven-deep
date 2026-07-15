import type { CSSProperties, JSX } from 'react';
import type { GameplayProjection } from '@woven-deep/engine';
import type { CameraOrigin, CameraViewport } from './camera.js';

export interface GridRendererProps {
  readonly projection: GameplayProjection;
  readonly camera: CameraOrigin;
  readonly viewport: CameraViewport;
}

type CellCustomProperties = CSSProperties & { '--light'?: string; '--fg'?: string };

interface PositionedGlyph { readonly x: number; readonly y: number; readonly glyph?: string }

function byCell<T extends PositionedGlyph>(items: readonly T[]): ReadonlyMap<string, T> {
  const map = new Map<string, T>();
  for (const item of items) map.set(`${item.x},${item.y}`, item);
  return map;
}

/**
 * Gameplay truth only: this component renders exactly what `GameplayProjection` reports for the
 * cells inside the current camera window. Decorative animation lives entirely in `EffectsLayer`.
 */
export function GridRenderer({ projection, camera, viewport }: GridRendererProps): JSX.Element {
  const { floor } = projection;
  const hero = projection.hero as unknown as { x: number; y: number };
  const actorsByCell = byCell(projection.actors as unknown as readonly PositionedGlyph[]);
  const itemsByCell = byCell(projection.groundItems as unknown as readonly PositionedGlyph[]);

  const slots: JSX.Element[] = [];
  for (let row = 0; row < viewport.height; row += 1) {
    for (let col = 0; col < viewport.width; col += 1) {
      const x = camera.x + col;
      const y = camera.y + row;
      const slotIndex = row * viewport.width + col;
      const inFloor = x >= 0 && x < floor.width && y >= 0 && y < floor.height;
      const cell = inFloor ? floor.cells[y * floor.width + x] : undefined;

      if (!cell) {
        slots.push(<span key={slotIndex} className="cell cell-empty" />);
        continue;
      }

      const dataCell = `${x},${y}`;

      if (cell.knowledge === 'unknown') {
        slots.push(<span key={slotIndex} data-cell={dataCell} className="cell cell-unknown" />);
        continue;
      }

      if (cell.knowledge === 'remembered') {
        slots.push(
          <span key={slotIndex} data-cell={dataCell} className="cell cell-remembered">
            {cell.glyph ?? ''}
          </span>,
        );
        continue;
      }

      const isHero = x === hero.x && y === hero.y;
      const actor = actorsByCell.get(dataCell);
      const item = itemsByCell.get(dataCell);
      const glyph = isHero ? '@' : (actor?.glyph ?? item?.glyph ?? cell.fixture?.glyph ?? cell.glyph ?? '');
      const style: CellCustomProperties = { '--light': String(cell.intensity / 255) };
      if (cell.tint) style['--fg'] = `rgb(${cell.tint[0]}, ${cell.tint[1]}, ${cell.tint[2]})`;

      slots.push(
        <span
          key={slotIndex}
          data-cell={dataCell}
          className="cell cell-visible"
          style={style}
          {...(isHero ? { 'aria-label': `Hero at ${x}, ${y}` } : {})}
        >
          {glyph}
        </span>,
      );
    }
  }

  return (
    <div
      role="grid"
      aria-label="Dungeon floor"
      tabIndex={0}
      className="playfield-grid"
      style={{ gridTemplateColumns: `repeat(${viewport.width}, 1ch)` }}
    >
      {slots}
    </div>
  );
}
