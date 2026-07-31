import { useCallback, useEffect, useRef } from 'react';
import type { CompiledContentPack } from '@woven-deep/content';
import type { Point } from '@woven-deep/engine';
import { createAutoPickupPolicy } from '../../session/auto-pickup.js';
import { computeExplorePath } from '../../session/explore.js';
import type { SessionSnapshot } from '../../session/guest-session.js';
import type { PlayerIntent } from '../../session/intents.js';
import type { RunSession } from '../../session/run-session.js';
import { findDiscoveredStair, stairUnderHero, type StairDirection } from '../../session/stairs.js';
import {
  advanceTravel,
  beginTravel,
  classicStopPredicate,
  computeTravelPath,
  resolveClick,
  type ActiveTravel,
  type AdvanceOutcome,
  type StopReason,
  type TravelMode,
  type TravelPlan,
} from '../../session/travel.js';
import { STEP_MS } from '../playfield/scene-state.js';

/** Auto-explore's per-step pace: twice click-travel's, because an explore is a long walk the player
 * is watching rather than a short one they aimed. Interrupts still land on the next projection
 * regardless of pace. */
export const EXPLORE_STEP_MS = 90;

/** What each classic stop reason reads as in the message log. */
const STOP_MESSAGES: Readonly<Record<StopReason, string>> = {
  'hero-damaged': 'You stop — you are being hurt.',
  'hostile-appeared': 'You stop — something is moving nearby.',
  'item-spotted': 'You stop — there is something on the floor.',
  'stair-found': 'You stop — you have found a stair.',
  'feature-revealed': 'You stop — you spot something hidden.',
  hunger: 'You stop — your hunger is growing.',
  light: 'You stop — your light is failing.',
  sound: 'You stop — you hear something.',
  'action-invalid': 'You stop — the way is blocked.',
};

export interface AutoTravelHandlers {
  /** Starts a click-to-travel walk toward `cell`, driven by one-step-per-projection pacing. The
   * canvas playfield calls this directly with the cell resolved from a pointer event, since it has
   * no `data-cell` DOM to look up. */
  readonly travelTo: (cell: Point) => void;
  /** Starts auto-explore: walk toward the nearest unexplored ground, re-planned every step. */
  readonly startExplore: () => void;
  /** `>`/`<`: descend/ascend when already on the matching stair, otherwise walk to a discovered
   * one, otherwise say so. */
  readonly travelToStairs: (direction: StairDirection) => void;
}

export interface UseAutoTravelParams {
  readonly session: RunSession;
  readonly snapshot: SessionSnapshot;
  /** Resolves a ground item's content entry so an artifact is never auto-picked. */
  readonly pack: CompiledContentPack;
  readonly autoPickupConsumables: boolean;
  /** When a modal (overlay/house/trade/decision) owns input, map clicks are ignored -- the modal is
   * driving, exactly as the design's `canvasClick` bails while an overlay is open. */
  readonly disabled?: boolean;
}

/**
 * Every auto-walk the Play view drives: click-to-travel (`travelTo`), auto-explore (`startExplore`)
 * and walk-to-the-stairs (`travelToStairs`). Each turns a destination into a `TravelPlan`
 * (`session/travel.ts`) and walks it by dispatching ordinary one-step `move` (and `pickup`)
 * intents -- the very same `PlayerIntent`s the keyboard dispatcher sends -- pacing exactly one step
 * per authoritative projection so it can never desync from or outrun the engine. The walk is a pure
 * convenience: it is cancelled by any keypress or a new click, and it stops itself the moment the
 * projection shows the hero did not advance as expected, took damage, or a new hostile appeared
 * (see `advanceTravel`). Explore and stairs-travel additionally honor the classic stop set and
 * report why they stopped through `session.noteSystemLine`; click-travel stays silent, exactly as
 * it always has.
 *
 * Pacing: successive projections can publish far faster than the playfield's per-step tween
 * (`STEP_MS`, `ui/playfield/scene-state.ts`) resolves, because a dispatched move round-trips
 * through the engine and back to a new snapshot well inside one animation frame. Left unpaced,
 * each new step would retarget the sprite's in-flight tween before it finished, collapsing a
 * multi-tile walk into what reads as a teleport. So only the FIRST step of a walk (the one
 * `travelTo`/`startExplore`/`travelToStairs` fires synchronously, for zero added input latency)
 * dispatches immediately; every step after that waits behind a timer so it never fires sooner than
 * the mode's step interval after the previous dispatch, however fast the projections themselves
 * arrive. Manual keyboard movement does not go through this hook at all, so it is never paced.
 */
export function useAutoTravel({
  session,
  snapshot,
  pack,
  autoPickupConsumables,
  disabled = false,
}: UseAutoTravelParams): AutoTravelHandlers {
  const { projection, lastEvents } = snapshot;
  const travelRef = useRef<ActiveTravel | null>(null);
  const lastDispatchAtRef = useRef(0);
  const pendingStepRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disabledRef = useRef(disabled);
  const dispatch = useCallback((intent: PlayerIntent) => session.dispatch(intent), [session]);

  // Items the player has already been stopped for and walked away from. `classicStopPredicate`'s
  // own "new item" baseline is the projection a single leg began from, which is FOV-scoped: an item
  // that has since left the hero's sight is absent from the next leg's baseline, so re-entering its
  // room would offer it all over again. This set outlives the individual legs and is scoped to the
  // floor (a new floor is a new set of decisions, and item ids are not stable across them).
  const offeredItemsRef = useRef<{ floorId: string; ids: Set<string> } | null>(null);
  const offeredItemIds = useCallback((floorId: string): Set<string> => {
    if (offeredItemsRef.current?.floorId !== floorId) {
      offeredItemsRef.current = { floorId, ids: new Set() };
    }
    return offeredItemsRef.current.ids;
  }, []);

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
  // own listener and does its normal thing (e.g. a manual move, or starting a fresh explore) --
  // cancelling here only drops the remaining steps so the two input paths never fight over the
  // hero. This listener is registered before the key dispatcher's own (this hook is called first in
  // `PlayScreen`), so a key that starts a NEW walk is not cancelled by its own keydown.
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

  /** Applies one stepper outcome: keep walking, or end the walk with the mode's own reporting.
   * Click-travel stays silent (its stop set is the two base rules and always was); explore and
   * stairs-travel say why they stopped. `'blocked'` is the "the projection did not confirm the
   * step" case, which the engine has already explained in the log. */
  const applyOutcome = useCallback(
    (outcome: AdvanceOutcome, mode: TravelMode): void => {
      if (outcome.status === 'stepping') {
        travelRef.current = outcome.travel;
        lastDispatchAtRef.current = Date.now();
        return;
      }
      travelRef.current = null;
      if (mode === 'travel') return;
      if (outcome.status === 'arrived') {
        if (mode === 'explore') session.noteSystemLine('You have explored this floor.');
        return;
      }
      if (outcome.reason === 'blocked') return;
      session.noteSystemLine(STOP_MESSAGES[outcome.reason]);
    },
    [session],
  );

  // Drive one step whenever a new authoritative projection arrives, but never sooner than the
  // mode's step interval after the previous dispatch. `advanceTravel` first confirms the previous
  // step landed before dispatching the next, so this advances at most one move per engine turn --
  // paced to at most one move per tween -- and stays strictly in lockstep with the projection. The
  // events that projection arrived with are threaded through too: they are half of the classic stop
  // set (a revealed feature, hunger, a failing light, a sound, a refused action).
  useEffect(() => {
    const travel = travelRef.current;
    if (travel === null) return;
    clearPendingStep();
    const stepMs = travel.mode === 'explore' ? EXPLORE_STEP_MS : STEP_MS;
    const delay = Math.max(0, stepMs - (Date.now() - lastDispatchAtRef.current));
    pendingStepRef.current = setTimeout(() => {
      pendingStepRef.current = null;
      const current = travelRef.current;
      if (current === null || disabledRef.current) return;
      applyOutcome(
        advanceTravel({ projection, travel: current, dispatch, lastEvents }),
        current.mode,
      );
    }, delay);
  }, [projection, lastEvents, dispatch, clearPendingStep, applyOutcome]);

  /** Begins a classic-stop-set walk (explore or stairs) and fires its first step synchronously. */
  const startClassicWalk = (plan: TravelPlan, mode: TravelMode): void => {
    const autoPickup = createAutoPickupPolicy({ pack, allowConsumables: autoPickupConsumables });
    const travel = beginTravel(projection, plan, {
      mode,
      autoPickup,
      stopWhen: classicStopPredicate({
        start: projection,
        autoPickup,
        offered: offeredItemIds(projection.floor.floorId),
      }),
      ...(mode === 'explore' ? { replan: computeExplorePath } : {}),
    });
    applyOutcome(advanceTravel({ projection, travel, dispatch, lastEvents: [] }), mode);
  };

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
    applyOutcome(
      advanceTravel({ projection, travel: beginTravel(projection, plan), dispatch }),
      'travel',
    );
  };

  const startExplore = (): void => {
    clearPendingStep();
    travelRef.current = null;
    if (disabled) return;
    const path = computeExplorePath(projection);
    if (path === null || path.length === 0) {
      session.noteSystemLine('You have explored this floor.');
      return;
    }
    startClassicWalk({ steps: path, onArrive: null }, 'explore');
  };

  const travelToStairs = (direction: StairDirection): void => {
    clearPendingStep();
    travelRef.current = null;
    if (disabled) return;
    if (stairUnderHero(projection, direction)) {
      dispatch(direction === 'down' ? { type: 'descend' } : { type: 'ascend' });
      return;
    }
    const target = findDiscoveredStair(projection, direction);
    if (target === null) {
      session.noteSystemLine("You haven't found those stairs yet.");
      return;
    }
    const path = computeTravelPath({ projection, destination: target });
    if (path === null || path.length === 0) {
      session.noteSystemLine('You cannot reach those stairs from here.');
      return;
    }
    startClassicWalk({ steps: path, onArrive: null }, 'stairs');
  };

  return { travelTo, startExplore, travelToStairs };
}
