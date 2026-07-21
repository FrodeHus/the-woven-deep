import { useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import type { Point } from '@woven-deep/engine';
import type { GuestSession, SessionSnapshot } from '../../session/guest-session.js';
import type { PlayerIntent } from '../../session/intents.js';
import {
  advanceTravel,
  beginTravel,
  resolveClick,
  type ActiveTravel,
} from '../../session/travel.js';

function parseDataCell(value: string): Point | undefined {
  const [xText, yText] = value.split(',');
  const x = Number(xText);
  const y = Number(yText);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x, y };
}

export interface AutoTravelHandlers {
  readonly onClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
}

export interface UseAutoTravelParams {
  readonly session: GuestSession;
  readonly snapshot: SessionSnapshot;
  /** When a modal (overlay/house/trade/decision) owns input, map clicks are ignored -- the modal is
   * driving, exactly as the design's `canvasClick` bails while an overlay is open. */
  readonly disabled?: boolean;
}

/**
 * Click-to-travel for the Play view. A click on a floor cell resolves to a `TravelPlan`
 * (`session/travel.ts`) and the hook then walks it by dispatching ordinary one-step `move` intents
 * -- the very same `PlayerIntent`s the keyboard dispatcher sends -- pacing exactly one step per
 * authoritative projection so it can never desync from or outrun the engine. The walk is a pure
 * convenience: it is cancelled by any keypress or a new click, and it stops itself the moment the
 * projection shows the hero did not advance as expected, took damage, or a new hostile appeared
 * (see `advanceTravel`). Cells are matched by their `data-cell="x,y"` attribute, exactly like
 * `useCellHover`, so no separate pixel->cell camera math is needed.
 */
export function useAutoTravel({
  session,
  snapshot,
  disabled = false,
}: UseAutoTravelParams): AutoTravelHandlers {
  const { projection } = snapshot;
  const travelRef = useRef<ActiveTravel | null>(null);
  const dispatch = useCallback((intent: PlayerIntent) => session.dispatch(intent), [session]);

  // Any real keypress cancels an in-progress walk. The key still reaches `usePlayKeyDispatcher`'s
  // own listener and does its normal thing (e.g. a manual move) -- cancelling here only drops the
  // remaining auto-travel steps so the two input paths never fight over the hero.
  useEffect(() => {
    const cancel = (): void => {
      travelRef.current = null;
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, []);

  // Drive one step whenever a new authoritative projection arrives. `advanceTravel` first confirms
  // the previous step landed before dispatching the next, so this advances at most one move per
  // engine turn and stays strictly in lockstep with the projection.
  useEffect(() => {
    if (travelRef.current === null) return;
    travelRef.current = advanceTravel({ projection, travel: travelRef.current, dispatch });
  }, [projection, dispatch]);

  const onClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (disabled) {
      travelRef.current = null;
      return;
    }
    const cellElement = (event.target as HTMLElement).closest('[data-cell]');
    if (!cellElement) return;
    const cell = parseDataCell(cellElement.getAttribute('data-cell') ?? '');
    if (!cell) return;
    const plan = resolveClick(projection, cell);
    if (plan === null) {
      travelRef.current = null;
      return;
    }
    // Kick off the first step immediately against the current projection; every subsequent step is
    // driven by the effect above as each resulting projection publishes.
    travelRef.current = advanceTravel({
      projection,
      travel: beginTravel(projection, plan),
      dispatch,
    });
  };

  return { onClick };
}
