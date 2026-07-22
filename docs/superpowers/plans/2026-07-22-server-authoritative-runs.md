# Milestone 6B — Server-Authoritative Runs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Signed-in profiles play on the server (the same `packages/engine`, authoritative run state in SQLite, over WebSocket, request/response); guests are unchanged.

**Architecture:** Extract the run-orchestration into a shared framework-free `packages/session-core` used by both the client `GuestSession` and a new server play path; add a WebSocket play endpoint + `active_runs` table; add a client `ProfileSession` behind a `RunSession` interface; prove client/server engine agreement with a determinism harness. See `docs/superpowers/specs/2026-07-21-server-authoritative-runs-design.md`.

**Tech Stack:** TS strict; Fastify 5 + `@fastify/websocket`; better-sqlite3 (WAL, STRICT, migrations); React 19 client; Vitest.

## Global Constraints

- **Guest is unchanged and byte-identical.** The orchestration-core extraction (Phase 1) is BEHAVIOUR-PRESERVING: all existing `guest-session`/`command-builder` tests stay green, the guest `encodeActiveRun` save is byte-identical, and all 7 demos VERIFY OK **unchanged** (no content/engine-behaviour change anywhere in 6B).
- **Determinism:** demo hashes MUST NOT move (6B adds plumbing + a migration, no content, no engine behaviour). Any demo-hash movement is a red flag.
- **Both engines identical:** the server and client run the same `packages/engine` version; a version/content-hash mismatch over the wire is surfaced as an explicit error, never silent divergence.
- **Guest→profile run migration is a NON-GOAL** — profiles start fresh; never import a guest run.
- **Server never trusts the client** beyond authenticated intents; the server is authoritative over command-building + resolution + persistence.
- Additive migration only (migration 3). STRICT tables, WAL, prepared statements — mirror the 6A patterns. DRY/YAGNI/TDD.

## File Structure

- New `packages/session-core/` — `intents.ts` (moved), `command-builder.ts` (moved), `dispatch.ts` (extracted `dispatchIntent`), `snapshot.ts` (the projection→snapshot inputs), package.json/tsconfig/vitest.
- `apps/web/src/session/` — `guest-session.ts` (thin wrapper over the core), `run-session.ts` (the `RunSession` interface), `profile-session.ts` (WS client impl), `ws-client.ts`; `App.tsx` routing.
- `apps/server/src/` — `database.ts` (migration 3), `db/active-run-repository.ts`, `play/play-session.ts` (server run holder + save cadence), `play/connection-registry.ts` (newest-wins), `routes/ws-play.ts` (the `/ws/play` endpoint), `ws-protocol.ts` (shared message schema).
- Tests across all three + a cross-process determinism harness.

---

## Phase 1 — Shared orchestration core (behaviour-preserving)

### Task 1: Scaffold `packages/session-core`
**Files:** `packages/session-core/{package.json,tsconfig.json,vitest.config.ts,src/index.ts}`; root `package.json`/workspaces if needed; `tsconfig.base.json` refs.
- [ ] Create the workspace package `@woven-deep/session-core` depending on `@woven-deep/engine` + `@woven-deep/content` (framework-free — NO react/fastify/storage). Build via `tsc` like the other packages; wire into the root build/typecheck/test/knip/depcruise config exactly like `@woven-deep/engine`.
- [ ] A trivial exported symbol + a smoke test so the package builds + tests. `npm run build`/`typecheck`/`test` green for the new package; the whole-repo gate unaffected.
- [ ] Commit.

### Task 2: Move `intents` + `command-builder` into session-core
**Files:** move `apps/web/src/session/intents.ts` + `command-builder.ts` (and any pure helpers they need) into `packages/session-core/src/`; re-export from `apps/web/src/session/` for import-compat. Tests: move `apps/web/test/command-builder.test.ts` (or keep it importing the re-export).
- [ ] Move the intent types + `buildIntent` into session-core (they're pure: `PlayerIntent` + projection → `GameCommand`/transition descriptor). Keep the SAME public API. Re-export from the old `apps/web/src/session/intents.ts`/`command-builder.ts` paths so nothing else in apps/web changes its imports.
- [ ] Existing `command-builder.test.ts` stays green (against the re-export or moved to session-core). Guest suite green.
- [ ] Commit.

### Task 3: Extract `dispatchIntent` orchestration; make GuestSession a thin wrapper
**Files:** `packages/session-core/src/dispatch.ts` (+ `snapshot.ts`); `apps/web/src/session/guest-session.ts` (call the core). Tests: session-core `dispatch.test.ts`; existing `guest-session.test.ts` stays green.
- [ ] Extract the pure pipeline from `GuestSession.dispatch`/`applyNewState` into `dispatchIntent(runState, intent, { pack, commandId, expectedRevision }) → { runState, result, events }` in session-core: build the command/transition, run `resolveCommand` OR the session-level transition (`descendToNextFloor`/`ascendToPreviousFloor`/house/finalize — these live in engine, import them), return the new run + result + events. NO storage, NO React, NO clock/network — the CALLER persists + folds log + projects.
- [ ] Rewire `GuestSession` to call `dispatchIntent` and keep its existing responsibilities (commandId counter, sessionStorage persist, log fold, projection, notices) as the wrapper. BEHAVIOUR-PRESERVING.
- [ ] Unit-test `dispatchIntent` directly (ordinary command, each transition, finalize, idempotent replay via a resent commandId, stale-revision). Keep ALL `guest-session.test.ts` green; verify the guest save is byte-identical (a round-trip/encode test) and demos unchanged.
- [ ] Commit.

## Phase 2 — Server run persistence

### Task 4: Migration 3 — `active_runs` table + repository
**Files:** `apps/server/src/database.ts` (append migration 3), `apps/server/src/db/active-run-repository.ts`. Tests: `apps/server/test/database.test.ts` + `db/repositories.test.ts`.
- [ ] Migration 3 `active-runs`: STRICT `active_runs(profile_id TEXT PRIMARY KEY REFERENCES profiles(id), run_blob TEXT NOT NULL, revision INTEGER NOT NULL, content_hash TEXT NOT NULL, updated_at TEXT NOT NULL)`. Append-only; `assertMigrationsWellFormed` stays happy; run against a 6A DB is a clean forward migration.
- [ ] `active-run-repository.ts`: prepared-statement `get(profileId)`, `upsert({profileId, runBlob, revision, contentHash})`, `clear(profileId)` — mirror the existing repos.
- [ ] Tests: migration applies to a fresh + a 6A DB; repository upsert/get/clear round-trip; a run_blob (from `encodeActiveRun`) stores + reloads.
- [ ] Commit.

### Task 5: Server play-session (holder + save cadence)
**Files:** `apps/server/src/play/play-session.ts` — imports `@woven-deep/session-core` + `@woven-deep/engine` + the active-run repo + the content pack. Tests: `apps/server/test/play/play-session.test.ts`.
- [ ] `ServerPlaySession`: holds one authoritative `ActiveRun` in memory for a profile; `open(profileId)` rehydrates from the repo (`decodeActiveRun`) or `createNewRun` if none (send the pack/hero the same way the guest does); `applyIntent({commandId, expectedRevision, intent}) → { snapshot | rejected | decisionRequired }` via `dispatchIntent`; classifies the applied command as **consequential vs pure-movement** (predicate on the command type/events — movement-only ⇒ checkpoint) and persists via the repo: immediate on consequential, checkpoint every N moves + always on floor-change/disconnect/conclusion. Exposes the `SessionSnapshot`. NO socket here (pure, testable).
- [ ] Tests: open-new vs open-existing (rehydrate byte-identical); apply a command → authoritative snapshot + persisted; a movement command doesn't write every time but a consequential one does + a disconnect flush persists; idempotent resend returns the cached result; stale-revision rejected.
- [ ] Commit.

## Phase 3 — WebSocket transport

### Task 6: `@fastify/websocket` + the `/ws/play` endpoint
**Files:** `apps/server/package.json` (dep), `apps/server/src/ws-protocol.ts` (shared message schema + envelope version), `apps/server/src/routes/ws-play.ts`, `apps/server/src/app.ts` (register). Tests: `apps/server/test/routes/ws-play.test.ts`.
- [ ] Add `@fastify/websocket`. Define the versioned message envelope (`ws-protocol.ts`): client→server `command`/`answer-decision`/`final-chamber-choice`/…; server→client `state`/`rejected`/`decision-required`/`superseded`/`error`. Include a protocol/version + the server's `contentHash`/`gameVersion`/`saveSchemaVersion` in a `hello`/initial `state` so the client can guard.
- [ ] `GET /ws/play`: authenticate the WS upgrade with the 6A session cookie (reject unauthenticated); on connect open a `ServerPlaySession` for the profile, send the initial `state` (+ version/content info); route incoming messages to `applyIntent` and send the result. Handle malformed messages → `error`, don't crash the connection.
- [ ] Tests (using the ws test client against an injected app): authenticated connect → initial state; a `command` message → `state` back; unauthenticated upgrade rejected; a stale-revision command → `rejected`; malformed → `error`, connection survives.
- [ ] Commit.

### Task 7: Newest-wins eviction + reconnection + idempotent resend
**Files:** `apps/server/src/play/connection-registry.ts`, `routes/ws-play.ts` (use it). Tests: extend `ws-play.test.ts`.
- [ ] A per-profile connection registry: when a profile opens a new `/ws/play` connection while one is live, send the old connection `superseded` + close it, and hand the run to the new connection (rehydrate from the in-memory holder if present, else the repo). Ensure the run isn't double-held.
- [ ] Reconnection: a dropped-then-reopened connection rehydrates + resends the current `state`. An in-flight command resent after reconnect is idempotent (commandId dedup via the engine) → returns the cached result, no double-apply.
- [ ] Tests: second connection supersedes the first (first gets `superseded`, closes); reconnect after drop rehydrates the same run; a resent command doesn't double-apply.
- [ ] Commit.

## Phase 4 — Client profile session

### Task 8: `RunSession` interface; `GuestSession` implements it
**Files:** `apps/web/src/session/run-session.ts` (the interface), `guest-session.ts` (implements). Tests: a type/contract test.
- [ ] Define `interface RunSession` from `GuestSession`'s public surface the UI uses (`getSnapshot`, `subscribe`, `dispatch`, `answerDecision`, `chooseFinalChamber`, `setHouseOpen`, trade actions, etc. — enumerate from `App.tsx`/screens usage). `GuestSession implements RunSession` (no behaviour change).
- [ ] Confirm every call site in `App.tsx`/overlays/screens types against `RunSession` (or is satisfied by it). Existing tests green.
- [ ] Commit.

### Task 9: `ProfileSession` (WebSocket client)
**Files:** `apps/web/src/session/ws-client.ts` (thin reconnecting WS wrapper), `apps/web/src/session/profile-session.ts` (implements `RunSession` over the WS). Tests: `apps/web/test/profile-session.test.ts` (mock WS).
- [ ] `ProfileSession implements RunSession`: `dispatch(intent)` sends a `command` message (client-minted commandId + last-known revision) and, on the `state` reply, updates the snapshot + notifies subscribers; `rejected`/`decision-required`/`superseded`/`error` handled (superseded → read-only + a notice; version/content `error` → a reload-required state). `getSnapshot`/`subscribe` expose the last server `SessionSnapshot`. Reconnect via `ws-client.ts` (re-open + receive current state).
- [ ] Tests (mock WS transport): dispatch → sends the right message + applies the returned snapshot; a `rejected` surfaces like the guest log line; `superseded` flips to read-only; `decision-required` exposes `pendingDecision`; reconnect re-syncs.
- [ ] Commit.

### Task 10: `App.tsx` routing — guest vs profile
**Files:** `apps/web/src/App.tsx`, `apps/web/src/api.ts` (the ws URL). Tests: `apps/web/test/app-boot.test.tsx` (extend).
- [ ] Branch on `account.status`: `guest` → construct `GuestSession` (as today); `signed-in` → construct `ProfileSession` pointed at `/ws/play`. Everything downstream uses the `RunSession` interface unchanged. Handle the connection lifecycle (open on sign-in, superseded/error UI states, close on sign-out).
- [ ] Tests: a guest boot uses the local session (unchanged); a signed-in boot (mock account + mock WS) uses the profile session and renders play from server state; sign-out tears down the WS.
- [ ] Commit.

## Phase 5 — Determinism harness + gate

### Task 11: Cross-process determinism harness
**Files:** a test (engine or a new `packages/session-core/test/determinism-parity.test.ts` and/or `apps/server/test/`) that runs the SAME intent sequence through the client core path and the server play path and asserts byte-identical `encodeActiveRun` at each step.
- [ ] Drive a fixed intent sequence through (a) `dispatchIntent` (client core, in-memory) and (b) `ServerPlaySession.applyIntent` (server path, in-memory repo) from the same seed/hero/pack; assert `encodeActiveRun(run)` is identical after each step. This proves "the same engine both sides."
- [ ] Commit.

### Task 12: Whole-surface verification
- [ ] `npm run verify` exit 0 (typecheck, lint, format:check, depcruise, knip, all suites incl. the new package + server tests).
- [ ] All 7 demos VERIFY OK, hashes UNCHANGED (6B moved no content/engine behaviour). If any demo hash moved, STOP — the extraction wasn't behaviour-preserving.
- [ ] Format fixups; commit.

## Self-review

- Coverage: shared core (T1–T3), server persistence (T4–T5), WS transport (T6–T7), client profile session (T8–T10), determinism + gate (T11–T12) — matches the spec + the 3 user decisions (request/response, newest-wins, consequential+checkpoint saves).
- The riskiest task is T3 (extracting orchestration from proven client code) — it is explicitly behaviour-preserving and gated by the unchanged guest tests + byte-identical save + unchanged demos.
- Determinism: 6B moves no content/engine behaviour; demo hashes must stay identical (T3/T12 verify).
- Guest untouched; profile is the new path; migration additive.
