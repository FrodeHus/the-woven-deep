import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { isStairDown, isStairUp, type GameplayProjection } from '@woven-deep/engine';
import type { SessionSnapshot } from '../../session/guest-session.js';
import { actorsOf, groundItemsOf } from '../../session/projection-view.js';
import { resolveClick } from '../../session/travel.js';
import { humanize } from '../labels.js';
import type { ThreatPopoverActor } from '../ThreatPopover.js';
import type { HoverAsset } from '../AssetPopover.js';

interface PositionedActor extends ThreatPopoverActor {
  readonly x: number;
  readonly y: number;
}

function actorAtCell(
  projection: GameplayProjection,
  x: number,
  y: number,
): PositionedActor | undefined {
  return actorsOf(projection).find((actor) => actor.x === x && actor.y === y);
}

/** A hovered floor item, if any -- its display name plus category label (the compiled pack has no
 * free-text description, so the category is the honest descriptor; unidentified items read as
 * "Unidentified" since the projection already hides their true identity). */
function itemAssetAtCell(
  projection: GameplayProjection,
  x: number,
  y: number,
): HoverAsset | undefined {
  const item = groundItemsOf(projection).find(
    (candidate) => candidate.x === x && candidate.y === y,
  );
  if (!item) return undefined;
  const detail = item.identified ? humanize(item.category) : 'Unidentified';
  return { title: item.name, detail, x, y, ...(item.glyph ? { glyph: item.glyph } : {}) };
}

/** A hovered notable tile (stairs or a door), if the cell is one -- other terrain is not
 * remarkable enough to warrant a popover. */
function tileAssetAtCell(
  projection: GameplayProjection,
  x: number,
  y: number,
): HoverAsset | undefined {
  const { floor } = projection;
  if (x < 0 || y < 0 || x >= floor.width || y >= floor.height) return undefined;
  const cell = floor.cells[y * floor.width + x];
  if (!cell || cell.knowledge === 'unknown') return undefined;
  if (isStairDown(cell.tileId)) {
    return { title: 'Stairs down', detail: 'Descends deeper into the Deep.', x, y };
  }
  if (isStairUp(cell.tileId)) {
    return { title: 'Stairs up', detail: 'Climbs back toward Last Light.', x, y };
  }
  if (cell.token === 'terrain.door') {
    return { title: 'Door', detail: 'A doorway. Walk into it to open it.', x, y };
  }
  return undefined;
}

function assetAtCell(projection: GameplayProjection, x: number, y: number): HoverAsset | undefined {
  return itemAssetAtCell(projection, x, y) ?? tileAssetAtCell(projection, x, y);
}

function parseDataCell(value: string): Readonly<{ x: number; y: number }> | undefined {
  const [xText, yText] = value.split(',');
  const x = Number(xText);
  const y = Number(yText);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x, y };
}

export type CellHover =
  | Readonly<{ kind: 'actor'; actor: PositionedActor }>
  | Readonly<{ kind: 'asset'; asset: HoverAsset }>
  | null;

/** The movement-affordance cursor: the cell the pointer is over, and whether a click there would
 * actually do something (`reachable` -- a move/travel/attack/pickup, i.e. `resolveClick` returns a
 * plan). A non-reachable cell (wall, unknown, the hero's own empty cell, a non-hostile actor) is
 * still tracked so the cursor follows the pointer, but rendered as a non-inviting cue. */
export type CellCursor = Readonly<{ x: number; y: number; reachable: boolean }> | null;

export interface CellHoverHandlers {
  readonly onMouseOver: (event: ReactMouseEvent<HTMLDivElement>) => void;
  readonly onMouseLeave: () => void;
}

export interface UseCellHoverResult {
  readonly hover: CellHover;
  readonly cursor: CellCursor;
  readonly handlers: CellHoverHandlers;
}

/**
 * Tracks the cell under the pointer for two overlays `PlayScreen` renders: a description popover for
 * whatever asset it holds -- an actor (`ThreatPopover`) or a floor item / notable tile
 * (`AssetPopover`) -- and a movement-affordance `cursor` highlighting the cell and signalling
 * whether a click would move/travel there (reachability reused from auto-travel's `resolveClick`).
 * Both are cleared whenever the session snapshot publishes (a resolved turn can move or remove the
 * hovered asset, or change reachability) and on any scroll (the overlays are absolutely positioned
 * against the pane, so scrolling would strand them). Cells are matched by their `data-cell="x,y"`
 * attribute; reachability is only recomputed when the pointer crosses into a new cell.
 */
export function useCellHover(snapshot: SessionSnapshot): UseCellHoverResult {
  const { projection } = snapshot;
  const [hover, setHover] = useState<CellHover>(null);
  const [cursor, setCursor] = useState<CellCursor>(null);
  const lastCellRef = useRef<string | null>(null);

  const clear = useCallback((): void => {
    setHover(null);
    setCursor(null);
    lastCellRef.current = null;
  }, []);

  useEffect(() => {
    clear();
  }, [snapshot, clear]);

  useEffect(() => {
    window.addEventListener('scroll', clear, true);
    return () => window.removeEventListener('scroll', clear, true);
  }, [clear]);

  const onMouseOver = (event: ReactMouseEvent<HTMLDivElement>): void => {
    const cellElement = (event.target as HTMLElement).closest('[data-cell]');
    if (!cellElement) return;
    const cell = parseDataCell(cellElement.getAttribute('data-cell') ?? '');
    if (!cell) return;
    // `mouseover` only refires when the pointer crosses into a new element, but guard anyway so a
    // stray re-fire never recomputes `resolveClick` (which runs a pathfind) for the same cell.
    const key = `${cell.x},${cell.y}`;
    if (lastCellRef.current === key) return;
    lastCellRef.current = key;

    setCursor({ x: cell.x, y: cell.y, reachable: resolveClick(projection, cell) !== null });

    const actor = actorAtCell(projection, cell.x, cell.y);
    if (actor) {
      setHover({ kind: 'actor', actor });
      return;
    }
    const asset = assetAtCell(projection, cell.x, cell.y);
    setHover(asset ? { kind: 'asset', asset } : null);
  };

  return { hover, cursor, handlers: { onMouseOver, onMouseLeave: clear } };
}
