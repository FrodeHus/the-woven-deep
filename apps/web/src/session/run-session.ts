import type {
  FinalChamberChoiceCommand,
  HallRecordEnrichment,
  RunConclusionProjection,
  RunRecordRepository,
} from '@woven-deep/engine';
import type { TravelBatchRequest } from '@woven-deep/session-core';
import type { PlayerIntent } from './intents.js';
import type { SessionSnapshot } from './guest-session.js';
import type { TravelWalkEnd } from './profile-session.js';

/**
 * The public surface the UI (`App.tsx`, screens, overlays, `store.ts`) drives a run session
 * through, independent of how that session is backed. `GuestSession` is the local,
 * `localStorage`-persisted implementation; a future `ProfileSession` (server-authoritative, over
 * a WebSocket) plugs into this same seam. Every member here is copied verbatim from
 * `GuestSession`'s existing signatures — this interface is derived FROM `GuestSession`, not the
 * other way around, so it must never drift out of sync with it.
 */
export interface RunSession {
  getSnapshot(): SessionSnapshot;
  subscribe(listener: () => void): () => void;
  dispatch(intent: PlayerIntent): void;
  answerDecision(confirmed: boolean): void;
  chooseFinalChamber(choice: FinalChamberChoiceCommand['choice']): void;
  setHouseOpen(open: boolean): void;
  finalizeConcludedRun(
    repository: RunRecordRepository,
    enrichment: HallRecordEnrichment,
  ): RunConclusionProjection;
  /** Records a UI-only onboarding milestone that never goes through `dispatch` (e.g. opening the
   * character-sheet/inventory overlay) -- both `GuestSession` and `ProfileSession` implement this
   * identically (a purely client-side, device-local concern), and `usePlayKeyDispatcher` calls it
   * against whichever `RunSession` is live. */
  recordOnboardingIntent(intentType: string): void;
  /** Retires an onboarding hint for good -- the hint strip's dedicated dismiss key. */
  dismissOnboardingHint(hintId: string): void;
  /** Reveals lore for `contentId` (a dialogue topic's `reveal-lore` consequence) straight into the
   * codex sighting cache -- a narrative event, never derived from what the projection currently
   * shows, so it bypasses `dispatch`/`PlayerIntent` entirely (mirrors `recordOnboardingIntent`'s
   * posture: client-only state that never goes through the engine). Idempotent: revealing the same
   * `contentId` twice is a no-op the second time, with no duplicate log line. Both `GuestSession`
   * and `ProfileSession` implement this identically over their own held `Sightings`/log. */
  revealLore(contentId: string): void;
  /**
   * Rewinds a concluded Wanderer run to its floor-entry checkpoint and resumes play. Returns
   * `false` when there is no usable checkpoint (never written, dropped by quota, or corrupt) --
   * the caller then falls through to Accept-death. Never throws, never half-restores: the live run
   * is replaced only after the checkpoint has decoded successfully.
   */
  riseAgain(): boolean;
  /** Appends a client-only system line to the same message log the engine's events fold into --
   * how auto-explore reports why it stopped, or that there is nothing left to explore. Never a
   * dispatch: no turn passes, no randomness is consumed. */
  noteSystemLine(text: string): void;
  /**
   * Walks an auto-travel plan in BATCHES rather than one dispatched step per round trip.
   *
   * Optional on purpose: only a server-backed session has round trips worth batching away.
   * `GuestSession` runs the engine in-process, where a step costs nothing, so it omits this and
   * `useAutoTravel` keeps stepping it locally -- both paths run the identical planner and stop
   * rules from `@woven-deep/session-core`, so they agree step for step.
   */
  travelBatch?(
    request: TravelBatchRequest,
    options: Readonly<{ stepMs: number }>,
    onEnded: (end: TravelWalkEnd) => void,
  ): void;
  /** Stops requesting further travel batches. Steps already applied server-side still arrive. */
  cancelTravel?(): void;
}
