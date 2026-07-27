import { useCallback, useEffect, useRef, useState } from 'react';
import { isStairDown, isStairUp, type GameplayProjection, type Point } from '@woven-deep/engine';
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
  return {
    title: item.name,
    detail,
    x,
    y,
    ...(item.glyph ? { glyph: item.glyph } : {}),
    ...(item.contentId ? { contentId: item.contentId } : {}),
  };
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

export type CellHover =
  | Readonly<{ kind: 'actor'; actor: PositionedActor }>
  | Readonly<{ kind: 'asset'; asset: HoverAsset }>
  | null;

export interface UseCellHoverResult {
  readonly hover: CellHover;
  /** Resolves the description popover for the cell the pointer is over -- an actor
   * (`ThreatPopover`), a floor item / notable tile (`AssetPopover`), or nothing. `null` clears it
   * (the pointer left the map). Only recomputes when the pointer crosses into a new cell. */
  readonly hoverAtCell: (cell: Point | null) => void;
}

/**
 * Tracks the map cell under the pointer to drive the description popover `PlayScreen` renders for
 * whatever it holds -- an actor (`ThreatPopover`) or a floor item / notable tile (`AssetPopover`).
 * The playfield canvas reports the hovered cell (resolved from the pointer's screen position); this
 * hook turns that into the popover's content. It clears whenever the session snapshot publishes (a
 * resolved turn can move or remove the hovered asset) and on any scroll (the popover is absolutely
 * positioned against the pane, so scrolling would strand it).
 */
export function useCellHover(snapshot: SessionSnapshot): UseCellHoverResult {
  const { projection } = snapshot;
  const [hover, setHover] = useState<CellHover>(null);
  const lastCellRef = useRef<string | null>(null);

  const clear = useCallback((): void => {
    setHover(null);
    lastCellRef.current = null;
  }, []);

  useEffect(() => {
    clear();
  }, [snapshot, clear]);

  useEffect(() => {
    window.addEventListener('scroll', clear, true);
    return () => window.removeEventListener('scroll', clear, true);
  }, [clear]);

  const hoverAtCell = useCallback(
    (cell: Point | null): void => {
      if (cell === null) {
        clear();
        return;
      }
      const key = `${cell.x},${cell.y}`;
      if (lastCellRef.current === key) return;
      lastCellRef.current = key;

      const actor = actorAtCell(projection, cell.x, cell.y);
      if (actor) {
        setHover({ kind: 'actor', actor });
        return;
      }
      const asset = assetAtCell(projection, cell.x, cell.y);
      setHover(asset ? { kind: 'asset', asset } : null);
    },
    [projection, clear],
  );

  return { hover, hoverAtCell };
}
