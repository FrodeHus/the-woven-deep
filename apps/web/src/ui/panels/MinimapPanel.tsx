import type { CSSProperties, JSX } from 'react';
import type { ObservableCell } from '@woven-deep/engine';
import { heroOf } from '../../session/projection-view.js';
import { visibleForeground } from '../cell-color.js';
import { heroLightIsOut, type PanelProps } from './types.js';

/** The minimap's own warm/cool stair pixels, matching the playfield's stair glow so a marker on the
 * map and the ember in the world read as the same thing. */
const STAIR_DOWN_MARKER = '#ffb265';
const STAIR_UP_MARKER = '#7fb6ff';

/** Which way a discovered stair leads, or `undefined` for any cell that is not a discovered stair.
 * Both stair tiles share the `terrain.stair` token, so the glyph (`>` down, `<` up) is what
 * separates them. */
function stairMarkerColor(cell: ObservableCell): string | undefined {
  if (cell.knowledge === 'unknown' || cell.token !== 'terrain.stair') return undefined;
  if (cell.glyph === '>') return STAIR_DOWN_MARKER;
  if (cell.glyph === '<') return STAIR_UP_MARKER;
  return undefined;
}

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

  const stair = stairMarkerColor(cell);
  if (stair !== undefined) {
    return (
      <span
        data-testid={`minimap-stair-${cell.glyph === '>' ? 'down' : 'up'}`}
        className="block"
        style={{ backgroundColor: stair }}
      />
    );
  }

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
 * position marked, plus a warm pixel on every discovered way down and a cool one on every way up.
 * Handles `projection.floor.town === true` the same as any other floor: `town` is only ever read
 * for other panels, never here.
 *
 * With no burning light (`heroLightIsOut`), the map goes dark instead: reading a floor plan by
 * touch is not a thing a hero in the dark gets to do, so the panel keeps its frame and label and
 * renders a single "no light" line in place of the grid. The town is exempt: the playfield renders
 * town fully lit from per-cell intensity regardless of a carried light, so dousing a torch there
 * must not blank the minimap out from under it.
 */
export function MinimapPanel({ snapshot }: PanelProps): JSX.Element {
  const floor = snapshot.projection.floor;
  const hero = heroOf(snapshot.projection);
  const lightOut = !floor.town && heroLightIsOut(hero.equipment);

  if (lightOut) {
    return (
      <section
        aria-label="Map"
        data-testid="minimap"
        data-light-out="true"
        className="pointer-events-auto absolute right-3 top-16 z-10 flex max-h-40 max-w-[45vw] flex-col gap-1 rounded-md border border-line bg-deep/70 p-2 opacity-60 backdrop-blur-sm"
      >
        <div aria-hidden="true" className="text-[0.625rem] uppercase tracking-[0.16em] text-subtle">
          ·&nbsp;─ The Floor ─&nbsp;·
        </div>
        <p className="font-mono text-[0.625rem] text-subtle" data-testid="minimap-no-light">
          no light, no map
        </p>
      </section>
    );
  }

  return (
    <section
      aria-label="Map"
      data-testid="minimap"
      className="pointer-events-auto absolute right-3 top-16 z-10 flex max-h-40 max-w-[45vw] flex-col gap-1 overflow-auto rounded-md border border-line bg-deep/70 p-2 backdrop-blur-sm"
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
            isHero={cell.x === hero.x && cell.y === hero.y}
          />
        ))}
      </div>
    </section>
  );
}
