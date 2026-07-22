import type {
  FinalChamberChoiceCommand,
  HallRecordEnrichment,
  RunConclusionProjection,
  RunRecordRepository,
} from '@woven-deep/engine';
import type { PlayerIntent } from './intents.js';
import type { SessionSnapshot } from './guest-session.js';

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
}
