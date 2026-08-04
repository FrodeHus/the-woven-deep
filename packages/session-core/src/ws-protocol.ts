import type {
  FinalChamberChoiceCommand,
  GameplayProjection,
  HeroChoices,
  Point,
  PublicDecision,
  PublicEvent,
  RunConclusionProjection,
  RunMode,
} from '@woven-deep/engine';
import type { PlayerIntent } from './intents.js';
import type { StopReason } from './travel.js';

/**
 * The `/ws/play` message envelope version. Sent in every `hello`, alongside the content hash and
 * engine/save versions, so the client can refuse to proceed the moment its build diverges from the
 * server's — never silently mismatched. Bump whenever a client/server-message shape changes in a
 * way older clients can't safely ignore.
 */
export const PROTOCOL_VERSION = 3;

/**
 * The run-authoritative snapshot the server produces after applying a command. Only redacted,
 * projection-derived data — never raw `ActiveRun` (which carries hidden state the client must not
 * see). The client assembles the full session snapshot from this (folding `lastEvents` into a log,
 * accumulating sightings, computing the final-chamber choice, adding client-only onboarding).
 */
export interface ServerRunSnapshot {
  readonly projection: GameplayProjection;
  readonly lastEvents: readonly PublicEvent[];
  readonly revision: number;
  readonly pendingDecision: PublicDecision | null;
  readonly conclusion: RunConclusionProjection | null;
  readonly houseOpen: boolean;
  readonly heroClassTags: readonly string[];
  /** Authoritative, perception-free: whether the Weakened Heart boss is present and alive on the
   * raw run state (`isHeartBossActive`). The client must use this rather than deriving boss
   * presence from the redacted, illumination-gated projection's visible actors -- under the
   * light-out mechanic (0 illumination on the hero's own tile) the boss can be alive but invisible,
   * and re-deriving from visible actors would wrongly re-offer the Final Chamber choice mid-fight. */
  readonly bossActive: boolean;
  /** The lowest command-sequence number the client may safely mint from: one past the highest
   * profile-minted `commandId` still held in the run's `recentCommands` window (0 when the window
   * holds none).
   *
   * Only the SERVER can state this. The reducer retains the last `RECENT_COMMAND_LIMIT` commands
   * and rejects a known `commandId` that arrives with a different payload as
   * `command_id_conflict`; a client that restarts its counter at 0 on every page load therefore
   * walks straight back into ids the run still remembers, and every command in the overlap is
   * refused until the counter climbs clear of the window. Deriving the floor client-side from
   * `revision` cannot be made exact -- the counter also advances on rejected/invalid commands,
   * which never advance `revision` -- so the authoritative window is read here instead. */
  readonly nextCommandSequence: number;
}

/** Client → server messages. Every mutating message carries the client-minted `commandId` and the
 * `expectedRevision` it observed the run at — the same idempotency/staleness contract the guest's
 * in-process command builder uses, just carried over the wire instead of a function call. */
export type ClientMessage =
  | {
      readonly type: 'command';
      readonly commandId: string;
      readonly expectedRevision: number;
      readonly intent: PlayerIntent;
    }
  | {
      readonly type: 'answer-decision';
      readonly commandId: string;
      readonly expectedRevision: number;
      readonly confirmed: boolean;
    }
  | {
      readonly type: 'final-chamber-choice';
      readonly commandId: string;
      readonly expectedRevision: number;
      readonly choice: FinalChamberChoiceCommand['choice'];
    }
  | {
      /** Wanderer only: rewind the concluded run to its stored floor-entry checkpoint. The reply
       * is the ordinary `state` push (the reconnect-push shape), which re-syncs the client's
       * cached `revision` after the rewind lowers it. */
      readonly type: 'rise-again';
      readonly commandId: string;
      readonly expectedRevision: number;
    }
  | {
      /** Wanderer only: end the run without a Hall write. Replies with the concluded `state`. */
      readonly type: 'accept-death';
      readonly commandId: string;
      readonly expectedRevision: number;
    }
  | {
      /**
       * Walks an auto-travel plan server-side for up to `TRAVEL_BATCH_CAP` steps, instead of the
       * client dispatching one `move` per round trip.
       *
       * An auto-explore leg was measured at up to 3,100 steps, and click-travel across a floor is
       * easily 100 -- each a round trip today. The server applies them with the SAME stop rules and
       * frontier planner the client uses (they live in `travel.ts`/`explore.ts` here in
       * session-core precisely so both sides run one copy), then replies with one ordinary `state`
       * per applied step followed by a single `travel-ended`.
       *
       * Nothing about authority changes: every step is the same per-command path a single
       * dispatched intent takes.
       */
      readonly type: 'travel';
      readonly commandId: string;
      readonly expectedRevision: number;
      /** Stairs-travel is deliberately absent -- its path is short and already known. */
      readonly mode: 'travel' | 'explore';
      /** The planned path for `travel`; ignored for `explore`, which re-plans every step. */
      readonly steps: readonly Point[];
      readonly onArrive: 'pickup' | null;
      /** The whole of `AutoPickupPolicy`'s client state; the server rebuilds the same policy. */
      readonly autoPickup: Readonly<{ allowConsumables: boolean }> | null;
      /** Items the player already declined, so the walk does not re-halt on each of them. */
      readonly offeredItemIds: readonly string[];
    }
  | {
      /**
       * Asks the server to re-send the whole floor rather than a patch against a cell array the
       * client does not have. Sent when a `patch` cannot be applied -- no cached floor, a different
       * floor, or a `baseRevision` the client does not hold. Carries no `commandId`/
       * `expectedRevision`: it mutates nothing, so the idempotency envelope every other message
       * needs would be meaningless here.
       */
      readonly type: 'resync';
    }
  | {
      /**
       * Starts the profile's run from the chargen wizard's choices, answering the server's
       * `no-run` push. The server rebuilds and validates the hero from the CHOICES
       * (`heroFromChoices`) rather than trusting a client-built hero, rolls the seed itself
       * (anti-cheat: a client seed is never trusted), and enforces the profile's earned class
       * unlocks. `expectedRevision` is 0 by convention — there is no run to be stale against.
       */
      readonly type: 'start-run';
      readonly commandId: string;
      readonly expectedRevision: number;
      readonly choices: HeroChoices;
      readonly mode: RunMode;
    };

export interface HelloMessage {
  readonly type: 'hello';
  readonly protocolVersion: number;
  readonly contentHash: string;
  readonly gameVersion: string;
  readonly saveSchemaVersion: number;
}

/** Server → client messages. `superseded` is Task 7's newest-wins eviction notice: sent to a
 * connection's socket when a NEWER connection for the same profile has taken over the run — the
 * server closes this socket immediately afterward, so the client should treat it as terminal (no
 * reconnect-and-resume on this same tab; the other connection is now authoritative). */
export type ServerMessage =
  | HelloMessage
  | { readonly type: 'state'; readonly snapshot: ServerRunSnapshot }
  | { readonly type: 'rejected'; readonly reason: string; readonly snapshot: ServerRunSnapshot }
  | {
      readonly type: 'decision-required';
      readonly decision: ServerRunSnapshot['pendingDecision'];
      readonly snapshot: ServerRunSnapshot;
    }
  | {
      /**
       * Closes a batched `travel`: the applied steps have already been sent as ordinary `state`
       * messages (so the client renders and animates them exactly as it would single steps), and
       * this says how the walk ended.
       *
       * `reason` is `null` when only the batch cap was reached, which means the walk is still
       * viable and the client should ask for the next batch. A `StopReason` or `'arrived'` ends it
       * and is reported to the player; `'blocked'` ends it silently, as it does today.
       */
      readonly type: 'travel-ended';
      readonly reason: StopReason | 'arrived' | 'blocked' | null;
      readonly stepsTaken: number;
      /** `offeredItemIds` grown by this batch, for the client's per-floor record. */
      readonly offeredItemIds: readonly string[];
    }
  | { readonly type: 'error'; readonly code: string; readonly message: string }
  | { readonly type: 'superseded' }
  | {
      /** Pushed (after `hello`) when the profile has no stored run: the client must route through
       * hero creation and answer with `start-run` — the server no longer invents a default hero. */
      readonly type: 'no-run';
    };
