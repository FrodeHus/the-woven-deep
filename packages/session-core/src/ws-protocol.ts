import type {
  FinalChamberChoiceCommand,
  GameplayProjection,
  HeroChoices,
  PublicDecision,
  PublicEvent,
  RunConclusionProjection,
  RunMode,
} from '@woven-deep/engine';
import type { PlayerIntent } from './intents.js';

/**
 * The `/ws/play` message envelope version. Sent in every `hello`, alongside the content hash and
 * engine/save versions, so the client can refuse to proceed the moment its build diverges from the
 * server's — never silently mismatched. Bump whenever a client/server-message shape changes in a
 * way older clients can't safely ignore.
 */
export const PROTOCOL_VERSION = 2;

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
  | { readonly type: 'error'; readonly code: string; readonly message: string }
  | { readonly type: 'superseded' }
  | {
      /** Pushed (after `hello`) when the profile has no stored run: the client must route through
       * hero creation and answer with `start-run` — the server no longer invents a default hero. */
      readonly type: 'no-run';
    };
