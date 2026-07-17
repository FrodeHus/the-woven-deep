import type { CSSProperties, JSX } from 'react';
import type { GameplayProjection } from '@woven-deep/engine';
import type { CameraOrigin, CameraViewport } from './camera.js';
import { MATERIAL_BASE_RGB, visibleForeground, type MaterialBaseName } from './cell-color.js';

export interface GridRendererProps {
  readonly projection: GameplayProjection;
  readonly camera: CameraOrigin;
  readonly viewport: CameraViewport;
}

type CellCustomProperties = CSSProperties & { '--light'?: string; '--fg'?: string };

interface PositionedGlyph { readonly x: number; readonly y: number; readonly glyph?: string }

/** The class-name suffix `materialClass` can produce: one entry per terrain material, with the two
 * stair directions kept distinct (glyph `<` vs `>` already distinguishes them; splitting the class
 * too lets stylesheet authors give each its own accent later even though both read `--mat-stair`
 * today). */
export type MaterialSuffix = 'wall' | 'floor' | 'door' | 'pillar' | 'stair-up' | 'stair-down' | 'void';

/** Maps a cell's terrain `token` to its material suffix; stairs are handled separately below since
 * both directions share `terrain.stair` and are only told apart by `tileId` (4 = up, 5 = down). */
const TOKEN_MATERIAL: Readonly<Record<string, MaterialSuffix>> = {
  'terrain.wall': 'wall',
  'terrain.floor': 'floor',
  'terrain.door': 'door',
  'terrain.pillar': 'pillar',
  'terrain.void': 'void',
};

/** Which `MATERIAL_BASE_RGB` entry (`cell-color.ts`) backs a given material suffix: a pillar is
 * structural stone like a wall, and both stair directions share the same gold accent, so those
 * collapse onto `wall`/`stair` rather than needing dedicated base colors of their own. */
const MATERIAL_BASE_KEY: Readonly<Record<MaterialSuffix, MaterialBaseName>> = {
  wall: 'wall',
  floor: 'floor',
  door: 'door',
  pillar: 'wall',
  'stair-up': 'stair',
  'stair-down': 'stair',
  void: 'void',
};

interface MaterialCell { readonly token?: string; readonly tileId?: number }

/** Derives the `mat-*` CSS class for a cell from its terrain vocabulary (`cell.token`, stairs
 * further split by `cell.tileId`) -- `''` for a cell with no recognized terrain token (e.g. an
 * unknown cell, which carries neither). Applied on remembered AND visible cells, beside the
 * existing knowledge class (`cell-remembered`/`cell-visible`). */
export function materialClass(cell: MaterialCell): '' | `mat-${MaterialSuffix}` {
  if (cell.token === 'terrain.stair') return cell.tileId === 5 ? 'mat-stair-down' : 'mat-stair-up';
  const material = cell.token ? TOKEN_MATERIAL[cell.token] : undefined;
  return material ? `mat-${material}` : '';
}

/** The material's own base color (see `MATERIAL_BASE_RGB`), for feeding into `visibleForeground` as
 * the color a lit cell's tint blends from -- `undefined` for a cell with no material class, which
 * falls back to `visibleForeground`'s own default (`FLOOR_RGB`). */
function materialBase(material: '' | `mat-${MaterialSuffix}`): readonly [number, number, number] | undefined {
  if (!material) return undefined;
  const suffix = material.slice(4) as MaterialSuffix;
  return MATERIAL_BASE_RGB[MATERIAL_BASE_KEY[suffix]];
}

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
        const material = materialClass(cell);
        slots.push(
          <span
            key={slotIndex}
            data-cell={dataCell}
            className={['cell', 'cell-remembered', material].filter(Boolean).join(' ')}
          >
            {cell.glyph ?? ''}
          </span>,
        );
        continue;
      }

      const isHero = x === hero.x && y === hero.y;
      const actor = actorsByCell.get(dataCell);
      const item = itemsByCell.get(dataCell);
      const glyph = isHero ? '@' : (actor?.glyph ?? item?.glyph ?? cell.fixture?.glyph ?? cell.glyph ?? '');
      const material = materialClass(cell);
      const style: CellCustomProperties = { '--light': String(cell.intensity / 255) };
      if (cell.tint) style['--fg'] = visibleForeground(cell.tint, cell.intensity, materialBase(material));

      slots.push(
        <span
          key={slotIndex}
          data-cell={dataCell}
          className={['cell', 'cell-visible', material].filter(Boolean).join(' ')}
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
      style={{ gridTemplateColumns: `repeat(${viewport.width}, var(--cell-w))` }}
    >
      {slots}
    </div>
  );
}
