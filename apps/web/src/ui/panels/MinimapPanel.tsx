import type { CSSProperties, JSX } from 'react';
import type { ObservableCell } from '@woven-deep/engine';
import { heroOf } from '../../session/projection-view.js';
import { visibleForeground } from '../cell-color.js';
import type { PanelProps } from './types.js';

/** A single map-cell dot, `MINIMAP_CELL` square. Mirrors `MapJournalOverlay`'s `MapPane` cell
 * rules at a smaller, fixed size for the right-rail rail: `unknown` renders nothing, `remembered`
 * renders dim, `visible` renders lit (both colored from the cell's own `tint`, same as `MapPane`)
 * -- the same knowledge-driven read-only rendering, without any scrolling viewport (the whole
 * floor is laid out; the rail itself scrolls if it overflows). */
function MinimapCell({
  cell,
  isHero,
}: Readonly<{ cell: ObservableCell; isHero: boolean }>): JSX.Element {
  if (cell.knowledge === 'unknown') return <span className="block bg-transparent" />;
  if (isHero) return <span className="block bg-accent" />;

  const style: CSSProperties = {};
  if (cell.tint) {
    style.backgroundColor = visibleForeground(
      cell.tint,
      cell.knowledge === 'remembered' ? 0 : cell.intensity,
    );
  }

  return <span className="block bg-muted" style={style} />;
}

const MINIMAP_CELL = '3px';

/**
 * A compact, read-only remembered/visible map of the current floor for the play-screen right
 * rail -- `snapshot.projection.floor` laid out at a small fixed cell size, with the hero's own
 * position marked. Handles `projection.floor.town === true` the same as any other floor: `town` is
 * only ever read for other panels, never here.
 */
export function MinimapPanel({ snapshot }: PanelProps): JSX.Element {
  const floor = snapshot.projection.floor;
  const heroPosition = heroOf(snapshot.projection);

  return (
    <section
      aria-label="Map"
      data-testid="minimap"
      className="flex max-h-40 flex-col gap-1 overflow-auto rounded-md border border-line bg-surface p-2"
    >
      <div aria-hidden="true" className="text-[0.625rem] uppercase tracking-[0.16em] text-subtle">
        ·&nbsp;─ The Floor ─&nbsp;·
      </div>
      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${floor.width}, ${MINIMAP_CELL})`,
          gridAutoRows: MINIMAP_CELL,
        }}
      >
        {floor.cells.map((cell) => (
          <MinimapCell
            key={cell.index}
            cell={cell}
            isHero={cell.x === heroPosition.x && cell.y === heroPosition.y}
          />
        ))}
      </div>
    </section>
  );
}
