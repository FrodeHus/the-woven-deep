import type { CSSProperties, JSX } from 'react';
import type { GameplayProjection } from '@woven-deep/engine';
import { actorsOf, groundItemsOf, heroOf } from '../session/projection-view.js';
import type { CameraOrigin, CameraViewport } from './camera.js';
import { MATERIAL_BASE_RGB, visibleForeground, type MaterialBaseName } from './cell-color.js';

export interface GridRendererProps {
  readonly projection: GameplayProjection;
  readonly camera: CameraOrigin;
  readonly viewport: CameraViewport;
}

type CellCustomProperties = CSSProperties & {
  '--light'?: string; '--fg'?: string; '--flicker-delay'?: string; '--flicker-duration'?: string;
};

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

/** Deterministic string hash (32-bit FNV-1a) -- never `Math.random`. Fixture flicker jitter must
 * derive from the fixture's OWN `lightId` so the same fixture always jitters the same way across
 * renders/remounts (tested twice in grid-renderer.test.tsx); `Math.random` would reshuffle every
 * fixture's phase on every re-render, which reads as flicker resetting on the guest's own
 * scroll/turn rather than a calm, continuous per-fixture cadence. */
function hashLightId(lightId: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < lightId.length; index += 1) {
    hash ^= lightId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Per-fixture animation-delay/duration jitter (Task 7), derived purely from `cell.fixture.lightId`
 * so two different fixtures read as independent flames rather than one fixture-wide strobe, while
 * a given fixture keeps the exact same cadence forever. Ranges (delay 0-2s, duration 1.8-2.6s) are
 * arbitrary but small, chosen to keep every fixture inside the same ballpark as the shared
 * `fixture-flicker` keyframe (`styles.css`) while still desynchronizing visibly. */
export function fixtureFlickerStyle(lightId: string): Readonly<{ '--flicker-delay': string; '--flicker-duration': string }> {
  const hash = hashLightId(lightId);
  const delaySeconds = (hash % 2000) / 1000;
  const durationSeconds = 1.8 + ((hash >>> 8) % 800) / 1000;
  return { '--flicker-delay': `${delaySeconds}s`, '--flicker-duration': `${durationSeconds}s` };
}

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
  const hero = heroOf(projection);
  const actorsByCell = byCell(actorsOf(projection));
  const itemsByCell = byCell(groundItemsOf(projection));

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
      if (cell.fixture) Object.assign(style, fixtureFlickerStyle(cell.fixture.lightId));

      slots.push(
        <span
          key={slotIndex}
          data-cell={dataCell}
          className={['cell', 'cell-visible', material, cell.fixture ? 'fixture-flicker' : ''].filter(Boolean).join(' ')}
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
