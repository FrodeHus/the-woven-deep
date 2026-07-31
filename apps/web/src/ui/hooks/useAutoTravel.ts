import { useCallback, useEffect, useRef } from 'react';
import type { Point } from '@woven-deep/engine';
import type { SessionSnapshot } from '../../session/guest-session.js';
import type { PlayerIntent } from '../../session/intents.js';
import type { RunSession } from '../../session/run-session.js';
import {
  advanceTravel,
  beginTravel,
  resolveClick,
  type ActiveTravel,
} from '../../session/travel.js';
import { STEP_MS } from '../playfield/scene-state.js';

export interface AutoTravelHandlers {
  /** Starts a click-to-travel walk toward `cell`, driven by one-step-per-projection pacing. The
   * canvas playfield calls this directly with the cell resolved from a pointer event, since it has
   * no `data-cell` DOM to look up. */
  readonly travelTo: (cell: Point) => void;
}

export interface UseAutoTravelParams {
  readonly session: RunSession;
  readonly snapshot: SessionSnapshot;
  /** When a modal (overlay/house/trade/decision) owns input, map clicks are ignored -- the modal is
   * driving, exactly as the design's `canvasClick` bails while an overlay is open. */
  readonly disabled?: boolean;
}

/**
 * Click-to-travel for the Play view. `travelTo` receives a floor cell (resolved from a pointer event
 * by the canvas playfield), turns it into a `TravelPlan` (`session/travel.ts`), and walks it by
 * dispatching ordinary one-step `move` intents -- the very same `PlayerIntent`s the keyboard
 * dispatcher sends -- pacing exactly one step per authoritative projection so it can never desync
 * from or outrun the engine. The walk is a pure convenience: it is cancelled by any keypress or a
 * new click, and it stops itself the moment the projection shows the hero did not advance as
 * expected, took damage, or a new hostile appeared (see `advanceTravel`).
 *
 * Pacing: successive projections can publish far faster than the playfield's per-step tween
 * (`STEP_MS`, `ui/playfield/scene-state.ts`) resolves, because a dispatched move round-trips
 * through the engine and back to a new snapshot well inside one animation frame. Left unpaced,
 * each new step would retarget the sprite's in-flight tween before it finished, collapsing a
 * multi-tile walk into what reads as a teleport. So only the FIRST step of a walk (the one
 * `travelTo` fires synchronously off the click, for zero added click latency) dispatches
 * immediately; every step after that waits behind a timer so it never fires sooner than
 * `STEP_MS` after the previous dispatch, however fast the projections themselves arrive. Manual
 * keyboard movement does not go through this hook at all, so it is never paced.
 */
export function useAutoTravel({
  session,
  snapshot,
  disabled = false,
}: UseAutoTravelParams): AutoTravelHandlers {
  const { projection } = snapshot;
  const travelRef = useRef<ActiveTravel | null>(null);
  const lastDispatchAtRef = useRef(0);
  const pendingStepRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disabledRef = useRef(disabled);
  const dispatch = useCallback((intent: PlayerIntent) => session.dispatch(intent), [session]);

  const clearPendingStep = useCallback(() => {
    if (pendingStepRef.current !== null) {
      clearTimeout(pendingStepRef.current);
      pendingStepRef.current = null;
    }
  }, []);

  // A modal can grab input via a mouse-only path (e.g. clicking a `CommandPalette` item) with no
  // intervening keydown, so `disabled` going true has to cancel the pending step timer and clear
  // the travel plan itself -- matching the pre-pacing semantics where a synchronous dispatch never
  // had a window for a modal to open mid-step. `disabledRef` also lets the timeout callback below
  // re-check the latest value even though its own effect closed over an earlier one.
  useEffect(() => {
    disabledRef.current = disabled;
    if (disabled) {
      travelRef.current = null;
      clearPendingStep();
    }
  }, [disabled, clearPendingStep]);

  // Any real keypress cancels an in-progress walk. The key still reaches `usePlayKeyDispatcher`'s
  // own listener and does its normal thing (e.g. a manual move) -- cancelling here only drops the
  // remaining auto-travel steps so the two input paths never fight over the hero.
  useEffect(() => {
    const cancel = (): void => {
      travelRef.current = null;
      clearPendingStep();
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, [clearPendingStep]);

  // Drop any pending step timer when the component unmounts.
  useEffect(() => clearPendingStep, [clearPendingStep]);

  // Drive one step whenever a new authoritative projection arrives, but never sooner than
  // `STEP_MS` after the previous dispatch. `advanceTravel` first confirms the previous step
  // landed before dispatching the next, so this advances at most one move per engine turn -- paced
  // to at most one move per tween -- and stays strictly in lockstep with the projection.
  useEffect(() => {
    if (travelRef.current === null) return;
    clearPendingStep();
    const delay = Math.max(0, STEP_MS - (Date.now() - lastDispatchAtRef.current));
    pendingStepRef.current = setTimeout(() => {
      pendingStepRef.current = null;
      if (travelRef.current === null || disabledRef.current) return;
      const outcome = advanceTravel({ projection, travel: travelRef.current, dispatch });
      travelRef.current = outcome.status === 'stepping' ? outcome.travel : null;
      lastDispatchAtRef.current = Date.now();
    }, delay);
  }, [projection, dispatch, clearPendingStep]);

  const travelTo = (cell: Point): void => {
    clearPendingStep();
    if (disabled) {
      travelRef.current = null;
      return;
    }
    const plan = resolveClick(projection, cell);
    if (plan === null) {
      travelRef.current = null;
      return;
    }
    // Kick off the first step immediately against the current projection -- no added click
    // latency; every subsequent step is driven by the effect above, paced to `STEP_MS`, as each
    // resulting projection publishes.
    const outcome = advanceTravel({
      projection,
      travel: beginTravel(projection, plan),
      dispatch,
    });
    travelRef.current = outcome.status === 'stepping' ? outcome.travel : null;
    lastDispatchAtRef.current = Date.now();
  };

  return { travelTo };
}
