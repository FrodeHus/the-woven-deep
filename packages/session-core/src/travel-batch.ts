import type { CompiledContentPack } from '@woven-deep/content';
import {
  projectGameplayState,
  type ActiveRun,
  type GameplayProjection,
  type Point,
  type PublicEvent,
} from '@woven-deep/engine';
import { createAutoPickupPolicy } from './auto-pickup.js';
import { computeExplorePath } from './explore.js';
import type { PlayerIntent } from './intents.js';
import {
  advanceTravel,
  baseStopPredicate,
  beginTravel,
  classicStopPredicate,
  type StopReason,
  type TravelMode,
} from './travel.js';

/**
 * How many steps one batched travel intent may apply before it must return for another round trip.
 *
 * The cap is the whole trade this mechanism makes. Batching removes the client's chance to abort
 * between steps, so a batch that ran a full auto-explore leg (measured at up to 3,100 steps) would
 * be an uninterruptible cutscene. 16 turns a leg of ~300 steps into ~19 round trips instead of 300,
 * while bounding a mistaken abort to 16 steps of walking.
 *
 * That bound is only tolerable because every DANGEROUS interruption -- damage, a newly-appeared
 * hostile, a failing light, a sound -- already ends the batch on its own, so overshoot can only
 * happen in conditions the stop rules consider safe.
 */
export const TRAVEL_BATCH_CAP = 16;

/** Modes that batch. Stairs-travel deliberately does not: its path is short and already known, so
 * the round trips saved do not pay for the extra surface. */
export type BatchedTravelMode = Extract<TravelMode, 'travel' | 'explore'>;

export interface TravelBatchRequest {
  readonly mode: BatchedTravelMode;
  /** The planned path for `travel`. Ignored for `explore`, which re-plans every step from the
   * frontier and therefore cannot be handed a fixed path. */
  readonly steps: readonly Point[];
  readonly onArrive: 'pickup' | null;
  /** The entirety of `AutoPickupPolicy`'s client state -- the server rebuilds the identical policy
   * with `createAutoPickupPolicy`. Null when the walk sweeps nothing up (click-travel). */
  readonly autoPickup: Readonly<{ allowConsumables: boolean }> | null;
  /** Items the player has already been stopped for and walked away from. Client-owned and scoped to
   * the floor; sent because only the client knows it, and returned grown so the client can keep it.
   * Without it, re-entering a room would halt the walk on the same declined item every time. */
  readonly offeredItemIds: readonly string[];
}

/** One applied step: the run after it, and the events it produced. The caller projects each of
 * these in turn -- that is what lets the client animate a batch faithfully instead of watching
 * every other actor jump forward N turns at once. */
export interface TravelBatchStep {
  readonly run: ActiveRun;
  readonly events: readonly PublicEvent[];
}

export interface TravelBatchResult {
  readonly steps: readonly TravelBatchStep[];
  /**
   * Why the walk ended. A `StopReason` or `'arrived'` means it is finished and the client should
   * report it; `'blocked'` likewise ends it but stays silent (the engine has already explained
   * itself in the log, exactly as `useAutoTravel` treats it); `null` means only the cap was reached
   * and the client should ask for the next batch.
   */
  readonly reason: StopReason | 'arrived' | 'blocked' | null;
  /** `offeredItemIds` grown by whatever this batch newly offered. */
  readonly offeredItemIds: readonly string[];
}

/**
 * Walks a travel intent server-side, applying up to `cap` steps and stopping exactly where the
 * client's own one-step-at-a-time loop would have.
 *
 * It reuses `advanceTravel` verbatim rather than reimplementing the walk: the stepper, the stop
 * predicates and the frontier planner are the same code the guest runs in-process, so a batched
 * walk and a stepped one cannot diverge. The only thing this adds is the loop that the client would
 * otherwise drive a round trip at a time.
 *
 * Application is the caller's `apply`, which on the server is the same per-command path a single
 * dispatched intent takes -- so batching changes when the client is asked, never who decides.
 */
export function runTravelBatch(
  input: Readonly<{
    run: ActiveRun;
    pack: CompiledContentPack;
    request: TravelBatchRequest;
    /**
     * Applies one step's intent and returns the run it produced, or null if it was refused (which
     * ends the batch).
     *
     * Injected rather than resolved here so the SERVER can route each step through
     * `ServerPlaySession.applyIntent` -- the path that also handles floor transitions, Wanderer
     * checkpoints, the persistence cadence and finalize-on-conclusion. A batch that called the
     * engine directly would silently bypass all of that.
     */
    apply: (intent: PlayerIntent, index: number) => TravelBatchStep | null;
    cap?: number;
  }>,
): TravelBatchResult {
  const { run, pack, request, apply } = input;
  const cap = input.cap ?? TRAVEL_BATCH_CAP;

  const project = (state: ActiveRun): GameplayProjection =>
    projectGameplayState({ state, content: pack });

  let current = run;
  let projection = project(current);
  const offered = new Set(request.offeredItemIds);
  const steps: TravelBatchStep[] = [];

  const autoPickup =
    request.autoPickup === null
      ? null
      : createAutoPickupPolicy({ pack, allowConsumables: request.autoPickup.allowConsumables });

  // Click-travel's stop set is the two base rules and always has been; explore adds the classic
  // set. Mirrors `useAutoTravel`'s own split exactly.
  const stopWhen =
    request.mode === 'explore'
      ? classicStopPredicate({
          start: projection,
          autoPickup: autoPickup ?? (() => false),
          offered,
        })
      : baseStopPredicate(projection);

  const planned =
    request.mode === 'explore' ? (computeExplorePath(projection) ?? []) : request.steps;
  if (request.mode === 'explore' && planned.length === 0) {
    return { steps: [], reason: 'arrived', offeredItemIds: [...offered] };
  }

  let travel = beginTravel(
    projection,
    { steps: planned, onArrive: request.onArrive },
    {
      mode: request.mode,
      stopWhen,
      ...(autoPickup ? { autoPickup } : {}),
      ...(request.mode === 'explore' ? { replan: computeExplorePath } : {}),
    },
  );

  let lastEvents: readonly PublicEvent[] = [];

  while (steps.length < cap) {
    let dispatched: PlayerIntent | null = null;
    const outcome = advanceTravel({
      projection,
      travel,
      lastEvents,
      dispatch: (intent) => {
        dispatched = intent;
      },
    });

    // `arrived` can still carry a dispatched intent: the terminal `pickup` of an `onArrive` plan is
    // sent in the same call that reports arrival, so it must be applied before the walk ends.
    if (outcome.status !== 'stepping' && dispatched === null) {
      return {
        steps,
        reason: outcome.status === 'arrived' ? 'arrived' : outcome.reason,
        offeredItemIds: [...offered],
      };
    }
    if (dispatched === null) return { steps, reason: null, offeredItemIds: [...offered] };

    // A refused step (a client-only intent, a rejection, a finalized run) ends the batch; the
    // client re-drives from the snapshot it gets back rather than guessing.
    const applied = apply(dispatched, steps.length);
    if (applied === null) {
      return { steps, reason: 'action-invalid', offeredItemIds: [...offered] };
    }

    current = applied.run;
    lastEvents = applied.events;
    projection = project(current);
    steps.push(applied);

    if (outcome.status !== 'stepping') {
      return {
        steps,
        reason: outcome.status === 'arrived' ? 'arrived' : outcome.reason,
        offeredItemIds: [...offered],
      };
    }
    travel = outcome.travel;
  }

  // Cap reached with the walk still viable: `null` tells the client to ask for the next batch.
  return { steps, reason: null, offeredItemIds: [...offered] };
}
