import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { isStairDown, isStairUp, type GameplayProjection } from '@woven-deep/engine';
import type { SessionSnapshot } from '../../session/guest-session.js';
import { actorsOf, groundItemsOf } from '../../session/projection-view.js';
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

export interface CellHoverHandlers {
  readonly onMouseOver: (event: ReactMouseEvent<HTMLDivElement>) => void;
  readonly onMouseLeave: () => void;
}

export interface UseCellHoverResult {
  readonly hover: CellHover;
  readonly handlers: CellHoverHandlers;
}

/**
 * Tracks which asset the pointer is over so `PlayScreen` can render a description popover for it: an
 * actor (`ThreatPopover`), or a floor item / notable tile (`AssetPopover`). Hover is cleared whenever
 * the session snapshot publishes (a resolved turn can move or remove the hovered asset) and on any
 * scroll (the popover is absolutely positioned against the pane, so scrolling would leave it
 * stranded). Cells are matched by their `data-cell="x,y"` attribute.
 */
export function useCellHover(snapshot: SessionSnapshot): UseCellHoverResult {
  const { projection } = snapshot;
  const [hover, setHover] = useState<CellHover>(null);

  useEffect(() => {
    setHover(null);
  }, [snapshot]);

  useEffect(() => {
    const dismiss = (): void => setHover(null);
    window.addEventListener('scroll', dismiss, true);
    return () => window.removeEventListener('scroll', dismiss, true);
  }, []);

  const onMouseOver = (event: ReactMouseEvent<HTMLDivElement>): void => {
    const cellElement = (event.target as HTMLElement).closest('[data-cell]');
    if (!cellElement) return;
    const cell = parseDataCell(cellElement.getAttribute('data-cell') ?? '');
    if (!cell) return;
    const actor = actorAtCell(projection, cell.x, cell.y);
    if (actor) {
      setHover({ kind: 'actor', actor });
      return;
    }
    const asset = assetAtCell(projection, cell.x, cell.y);
    setHover(asset ? { kind: 'asset', asset } : null);
  };

  const onMouseLeave = (): void => setHover(null);

  return { hover, handlers: { onMouseOver, onMouseLeave } };
}
