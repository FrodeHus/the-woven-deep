import type {
  GameplayProjection,
  PublicDecision,
  PublicEvent,
  RunConclusionProjection,
} from '@woven-deep/engine';
import type { Sightings } from './codex-storage.js';
import type { LogLine } from './event-log.js';
import type { OnboardingState } from './onboarding.js';
import type { StorageFailure } from './storage.js';

/**
 * Shared session-facing types split out of `guest-session.ts` so `onboarding.ts` and
 * `codex-derive.ts` can reference `SessionSnapshot` without importing `guest-session.ts` itself
 * (which imports both of them for real, runtime behavior) -- that back-edge is what used to make
 * the three-file group a runtime circular dependency. `guest-session.ts` re-exports everything
 * here so every other existing import site keeps working unchanged.
 */
export type SessionNotice =
  | { readonly kind: 'restored' }
  | { readonly kind: 'fresh' }
  | { readonly kind: 'save-discarded'; readonly reason: string }
  | { readonly kind: 'storage'; readonly failure: StorageFailure }
  /** A corrupted cross-reload blob (the sighting cache, the onboarding mastery ledger, or a Hall
   * of Records too malformed to seed a new run's standings) was
   * silently reset to its fresh/empty state -- per the plan's error-handling section, this must
   * still surface the standard dismissible notice rather than resetting invisibly. Dismissible
   * (not a `storage` failure -- the write itself succeeded; it's the previously-stored READ that
   * was unreadable), so it flows through the exact same `role="status"` session-banner every other
   * dismissible notice here uses. */
  | { readonly kind: 'data-reset'; readonly source: 'sightings' | 'onboarding' | 'hall' }
  /** `ProfileSession`-only (never produced by `GuestSession`): a NEWER connection for the same
   * profile has taken over the run (the server's `superseded` message, Task 7's newest-wins
   * eviction) -- this tab's session is now terminal/read-only. */
  | { readonly kind: 'superseded' }
  /** `ProfileSession`-only: the server rejected the connection/protocol outright -- a
   * content-hash or protocol-version mismatch between this build and the server's. Terminal;
   * the only recovery is a reload once the client has caught up with the server (or vice versa). */
  | { readonly kind: 'protocol-error'; readonly code: string; readonly message: string };

/**
 * The Final Chamber choice, pending whenever the hero stands on the Chamber floor (`FINAL_CHAMBER_DEPTH`)
 * with the bound Heart not yet fighting (`isHeartBossActive` false) and the run unconcluded --
 * mirrors `pendingDecision` below, but this one is never auto-answered: `FinalChamberChoice`
 * (the overlay) is the only thing that ever turns it into a `final-chamber-choice` command, via
 * `chooseFinalChamber`. `canBreakCycle` is `canAssembleTablet` -- the "Assemble the tablet"
 * option only ever appears when this is `true`.
 */
export interface PendingFinalChamberChoice {
  readonly canBreakCycle: boolean;
}

export interface SessionSnapshot {
  readonly projection: GameplayProjection;
  readonly log: readonly LogLine[];
  /** Public events from the most recent dispatch, for the effects layer. Cleared on next dispatch. */
  readonly lastEvents: readonly PublicEvent[];
  readonly pendingDecision: PublicDecision | null;
  readonly pendingFinalChamberChoice: PendingFinalChamberChoice | null;
  readonly notice: SessionNotice | null;
  readonly houseOpen: boolean;
  /** Cheap, pure projection of the run's ending once `run.conclusion !== null`: completion facts
   * and metrics are always safe to expose, but this is computed with `record: null` and
   * `achievements: []`, so `finalized` is always `false` here regardless of the engine's own
   * `conclusion.finalized` flag — the full score/heirloom/achievements only ever come from
   * `finalizeConcludedRun`. `null` while the run is still in progress. */
  readonly conclusion: RunConclusionProjection | null;
  /** The session's accumulated unlock-codex sighting cache (`codex.ts`'s `Sightings`) -- kept
   * in-memory here as the authoritative value (updated after every publish, per the design
   * amendment) and best-effort persisted alongside it; a persistence failure downgrades to
   * session-memory only (this field still reflects every sighting for the rest of THIS session)
   * plus the standard storage notice, exactly like a failed run-save write. */
  readonly sightings: Sightings;
  /** The active hero's own `classTags` -- read directly off the held `ActiveRun.hero` (`run.hero`),
   * NEVER through `projectGameplayState` (which does not carry this field, and is not touched here
   * -- see Task 8's one permitted engine change, the unrelated actor-contentId field). classTags
   * are not spoiler-sensitive: the identical field already appears, unredacted, on every
   * `StoredHallRecord`/Hall-of-Records row. Feeds the unlock codex's "active hero's class"
   * discovery source (`deriveCodexState`, `codex.ts`). */
  readonly heroClassTags: readonly string[];
  /** The guest's contextual-onboarding mastery ledger (`onboarding.ts`'s `OnboardingState`) --
   * device-persistent (`localStorage`, not `sessionStorage`), unlike every other field on this
   * snapshot. Kept in-memory here as the authoritative value; a persistence failure downgrades to
   * session-memory only, exactly like `sightings` above. */
  readonly onboarding: OnboardingState;
}
