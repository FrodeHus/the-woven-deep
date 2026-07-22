# Milestone 6B — Server-Authoritative Runs (design spec)

**Status:** design (brainstormed with the user 2026-07-21).

Moves gameplay for **signed-in profiles** off the browser and onto the server: the server runs
the exact same `packages/engine` that a guest's browser runs locally, owns the authoritative
run state, and persists it in SQLite. Guests are unchanged (still play locally). Builds on 6A
(identity, sessions, the SQLite/migration foundation). See `docs/design/identity-and-persistence.md`.

## Decisions (from the user)

- **Protocol: server-authoritative request/response over WebSocket.** The client sends each
  command; the server runs the authoritative engine, persists, and returns the new state; the
  client applies it. **No client-side prediction/rollback** (the game is turn-based — ~1 RTT
  per turn is fine). Compact state patches + prediction are explicit non-goals for 6B (possible
  later optimizations).
- **Concurrency: single session, newest wins.** One active run per profile. A new connection
  takes over the run; the previously-connected client is told "your run was opened elsewhere"
  and goes read-only/disconnected.
- **Save cadence: consequential-immediate + movement-checkpoint.** Persist the encoded run to
  SQLite immediately after a consequential command (combat, item, floor transition, trade,
  rest, conclusion, …); for pure movement, checkpoint every N moves (and always on
  disconnect/floor-change) to cut DB writes, accepting a tiny lost-movement window on a hard
  crash.

## Settled (from the design doc — not open)

- **Guest→profile run migration is a NON-GOAL.** A guest's in-progress run is never imported
  into a profile. A signed-in profile's server run starts fresh; there is no carry-over.
- Guest mode is entirely unchanged by 6B.

## Architecture

### 1. Extract a shared, framework-free run-orchestration core

Today `GuestSession` (`apps/web/src/session/guest-session.ts`) owns the dispatch pipeline:
`PlayerIntent` → `buildIntent` (command-builder) → either `resolveCommand` (engine) or a
session-level transition (`descendToNextFloor`/`ascendToPreviousFloor`/house/finalize) →
apply events + fold log → persist → project to `SessionSnapshot`. This orchestration must run
**both** client-side (guest) and server-side (profile).

Extract the pure orchestration into a framework-free module (e.g.
`packages/engine`-adjacent or a new `packages/session-core`, no React, no storage, no ws) with
a function like `dispatchIntent(runState, intent, { pack, commandSeq }) → { runState, result,
events, snapshotInputs }`. It must:
- Be deterministic and side-effect-free (no storage, no clock, no network) — storage/transport
  are the caller's responsibility.
- Cover ordinary commands (via `resolveCommand`, which already does idempotent replay +
  `stale_revision` rejection), the session-level transitions, and the finalize path.
- Produce the data needed to build a `SessionSnapshot` (projection + events) so both callers
  render identically.

`GuestSession` becomes a thin wrapper: core + `sessionStorage` + local command-seq counter.

### 2. `RunSession` interface — the guest/profile seam

Define `interface RunSession { getSnapshot(): SessionSnapshot; subscribe(fn): () => void;
dispatch(intent): void; answerDecision(...); chooseFinalChamber(...); /* the actions App +
screens call */ }`. `GuestSession` implements it (local core + sessionStorage). A new
`ProfileSession` (client) implements it over WebSocket: `dispatch(intent)` sends a message and
awaits the authoritative snapshot; `getSnapshot`/`subscribe` expose the last server state.
`App.tsx` branches on `account.status`: `guest` → `GuestSession`, `signed-in` → `ProfileSession`.
Everything downstream (screens, overlays) talks to the `RunSession` interface, unchanged.

### 3. Server WebSocket play endpoint

- Add `@fastify/websocket` (transport dependency). A single authenticated `GET /ws/play`
  endpoint (session-cookie authenticated at the WS upgrade, reusing the 6A session guard;
  reject unauthenticated upgrades).
- On connect: resolve the profile from the session; load its active run from the new active-run
  table (rehydrate via `decodeActiveRun`) or start a fresh run (`createNewRun`) if none;
  hold the authoritative `ActiveRun` in memory keyed by profileId. **Newest-wins:** if the
  profile already has a live connection, evict it (send it a `superseded` message, close it),
  then take over.
- **Message protocol (versioned envelope):**
  - client→server: `{ type: 'command', commandId, expectedRevision, intent }` (send the INTENT;
    the server runs the shared orchestration core with its authoritative projection so
    command-building is authoritative too), plus `{ type: 'answer-decision' | 'final-chamber-choice' | ... }`
    for the non-plain-command actions the session exposes.
  - server→client: `{ type: 'state', snapshot }` (the full `SessionSnapshot` after applying —
    full snapshot, not a patch, per the protocol decision), `{ type: 'rejected', reason }`
    (stale-revision/invalid surfaced like the guest log line), `{ type: 'decision-required', decision }`,
    `{ type: 'superseded' }`, `{ type: 'error', code }` (version/content mismatch, see below).
  - Idempotent replay: the engine's `recentCommands`/`commandId` dedup already returns the
    cached result for a resent command — so a command re-sent after a reconnect gap (within
    `RECENT_COMMAND_LIMIT`) is safe; the server may keep a small per-run commandId ledger if a
    reconnection gap could exceed 128.
- **Version/content guard over the wire:** on connect, the server sends its
  `contentHash`/`gameVersion`/`SAVE_SCHEMA_VERSION`; the client verifies its own build matches
  (both engines MUST be identical for determinism). Mismatch → a clear error state (reload
  needed), never silent divergence.

### 4. Persistence — the active-run table (migration 3)

- Migration 3 (append-only, `apps/server/src/database.ts` MIGRATIONS): a STRICT
  `active_runs(profile_id pk references profiles(id), run_blob TEXT, revision INTEGER,
  content_hash TEXT, updated_at)` — one active run per profile, storing `encodeActiveRun(run)`.
  A prepared-statement repository (`apps/server/src/db/active-run-repository.ts`) mirroring the
  existing repos.
- **Save cadence:** the server classifies each applied command as consequential vs pure-movement
  (a predicate on the command type / the emitted events — movement-only ⇒ checkpoint). Write
  the run blob immediately on consequential; for movement, write every N moves and always on
  floor-change/disconnect/conclusion. The versioned-write pattern from `/api/profile/settings`
  (`settings_version` optimistic check) is the precedent for guarding the run write against a
  superseded connection.
- Conclusion/finalize: a concluded run's Hall record is 6C's server concern; for 6B the run
  reaching conclusion is persisted (and the active-run row cleared/marked concluded) — the
  Hall stays the guest-scoped path for now (6C makes it server-authoritative).

### 5. Reconnection

On reconnect the client re-opens the WS; the server rehydrates from the in-memory holder (if
the connection was merely dropped) or from the active-run table (if evicted/restarted) and
sends the current `state` snapshot. Any command the client had in-flight is safely idempotent
(commandId dedup). No special resync protocol beyond "reconnect → receive current snapshot."

### 6. Determinism harness (the missing safety net)

Add a cross-process determinism test: run the SAME command/intent sequence through (a) the
client-side orchestration core and (b) the server play path, and assert `encodeActiveRun`
output is byte-identical at each step. This is the proof that "the server runs the exact same
engine" actually holds. Belongs in the engine/server test suites (no live socket needed — test
the orchestration core + the server session handler directly).

## Determinism & existing gates

The engine/content are unchanged, so demo hashes are UNCHANGED (6B adds server + client-session
plumbing + a migration, no content, no engine-behaviour change). The determinism gate (demos)
must stay byte-identical. The orchestration-core extraction must be behaviour-preserving for the
guest (its tests stay green + the guest save byte-identical). Migration 3 is additive.

## Testing

- Server: migration 3 + active-run repository; the WS play handler (authenticated upgrade,
  rehydrate/new run, apply command → authoritative snapshot, save cadence, newest-wins
  eviction, version/content guard); reconnection rehydrate; idempotent resend.
- Client: the `RunSession` interface; `GuestSession` still passes all existing tests
  (behaviour-preserving extraction); `ProfileSession` (mock WS) sends intents + applies
  snapshots + exposes the same `SessionSnapshot`; `App.tsx` routes guest vs signed-in correctly.
- Determinism: the cross-process harness (client core vs server path agree byte-for-byte);
  all 7 demos VERIFY OK unchanged.
- Orchestration core: unit tests for the extracted `dispatchIntent` (commands, transitions,
  finalize, idempotent replay, stale-revision), reused by both guest + server.

## Scope boundaries (6B, not 6C)

- 6B: server owns and persists the RUN for signed-in profiles over WS; guest unchanged.
- NOT 6B (→ 6C): server-authoritative Hall of Records, server unlock evaluation, lifetime
  stats, telemetry. The Hall stays guest/session-scoped in 6B.
- NOT 6B: state patches, client prediction/reconciliation, multi-connection sync (non-goals).

## Open implementation details (resolved in the plan)

- Exact WS envelope versioning + message schema.
- The consequential-vs-movement predicate (which command types / event kinds count).
- The movement checkpoint interval N and disconnect-flush.
- Whether the orchestration core lives in a new `packages/session-core` or beside the engine.
- Server run lifecycle: in-memory holder eviction, idle timeout, process-restart rehydrate.
