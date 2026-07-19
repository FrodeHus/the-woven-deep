import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { GameplayProjection } from '@woven-deep/engine';
import type { SessionSnapshot } from '../../session/guest-session.js';
import { actorsOf } from '../../session/projection-view.js';
import type { ThreatPopoverActor } from '../ThreatPopover.js';

interface PositionedActor extends ThreatPopoverActor { readonly x: number; readonly y: number }

function actorAtCell(projection: GameplayProjection, x: number, y: number): PositionedActor | undefined {
  return actorsOf(projection).find((actor) => actor.x === x && actor.y === y);
}

function parseDataCell(value: string): Readonly<{ x: number; y: number }> | undefined {
  const [xText, yText] = value.split(',');
  const x = Number(xText);
  const y = Number(yText);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x, y };
}

export type CellHover = Readonly<{ actor: PositionedActor }> | null;

export interface CellHoverHandlers {
  readonly onMouseOver: (event: ReactMouseEvent<HTMLDivElement>) => void;
  readonly onMouseLeave: () => void;
}

export interface UseCellHoverResult {
  readonly hover: CellHover;
  readonly handlers: CellHoverHandlers;
}

/**
 * Tracks which actor cell the pointer is over so `PlayScreen` can render the `ThreatPopover` for
 * it. Hover is cleared whenever the session snapshot publishes (a resolved turn can move or remove
 * the hovered actor) and on any scroll (the popover is absolutely positioned against the pane, so
 * scrolling would leave it stranded). Cells are matched by their `data-cell="x,y"` attribute.
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
    setHover(actor ? { actor } : null);
  };

  const onMouseLeave = (): void => setHover(null);

  return { hover, handlers: { onMouseOver, onMouseLeave } };
}
