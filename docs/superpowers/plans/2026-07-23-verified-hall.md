# Milestone 6C — Verified Hall & Metaprogression — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Server-authoritative progression for signed-in profiles — the server finalizes a profile's concluded run into a persisted Hall, evaluates class unlocks + achievements + lifetime stats, and exposes data export + deletion. Guests unchanged.

**Architecture:** Build on 6B (the server holds the authoritative run). Reuse the PURE `finalizeRun`/scoring/heirloom/achievement/lifetime engine logic — 6C calls it server-side + persists. Net-new: unlock evaluation. See `docs/superpowers/specs/2026-07-22-verified-hall-design.md`.

**Tech Stack:** Fastify 5 + `@fastify/websocket`; better-sqlite3 (WAL/STRICT/migrations); the shared `@woven-deep/session-core`; React client; Vitest.

## Global Constraints

- **Guests unchanged + byte-identical.** Guest Hall stays `sessionStorage`-scoped; no guest→profile promotion. All guest tests green.
- **Determinism:** `finalizeRun`/scoring/heirloom/achievements are UNCHANGED engine code → demo hashes byte-identical; the cross-process parity harness (`apps/server/test/play/determinism-parity.test.ts`) stays green; migration 4 is additive. Unlock evaluation is pure + server-side (no engine/content change).
- **Resolved architecture choices (do NOT re-litigate):** unlocks/lifetime/heart/achievements live in a dedicated `hall_state` table (NOT `profiles.progression_json`); unlock rules are HARDCODED by class id in one `evaluateUnlocks` helper (no class-schema `unlockRule` field → no content-hash bump); the wire-protocol types move into `@woven-deep/session-core` (both apps already depend on it).
- **Server never trusts the client:** finalize + unlock evaluation run on the server's authoritative run; the server re-validates the class on run start; export/deletion are auth + origin + CSRF gated.
- Additive migration only (migration 4, STRICT, cascade FKs). DRY/YAGNI/TDD.

## Phase A — Shared protocol package (6B follow-up)

### Task 1: Move wire-protocol types into `@woven-deep/session-core`
**Files:** create `packages/session-core/src/ws-protocol.ts` (the types); `apps/server/src/ws-protocol.ts` (import/re-export from session-core); `apps/server/src/play/play-session.ts` (`ServerRunSnapshot` from session-core); `apps/web/src/session/profile-session.ts` (import from session-core — DELETE the duplicated types). Tests: existing server + profile-session tests stay green.
- [ ] Move `ServerRunSnapshot`, `ClientMessage`, `ServerMessage`, `PROTOCOL_VERSION` (+ any envelope helpers/`parseClientMessage` that are pure) into `packages/session-core/src/ws-protocol.ts`; export from session-core's index. They reference `PlayerIntent` (session-core), `GameplayProjection`/`PublicDecision`/`RunConclusionProjection`/`PublicEvent` (engine — session-core depends on it) — all available.
- [ ] `apps/server` imports the types from `@woven-deep/session-core` (keep `apps/server/src/ws-protocol.ts` as a thin re-export if other server files import it by that path, OR repoint them). `ServerPlaySession`'s `ServerRunSnapshot` is the session-core one.
- [ ] `apps/web/src/session/profile-session.ts` imports the types from `@woven-deep/session-core` and DELETES its hand-duplicated `ServerRunSnapshot`/`ClientMessage`/`ServerMessage` declarations + the "keep in sync by hand" comment.
- [ ] Behaviour-preserving (type-only move). `npm run verify` green; the parity + ws-play + profile-session tests unchanged. If knip/depcruise flag the new exports, wire them.
- [ ] Commit.

## Phase B — Server Hall persistence

### Task 2: Migration 4 + `ServerRunRecordRepository`
**Files:** `apps/server/src/database.ts` (migration 4), `apps/server/src/db/hall-repository.ts`. Tests: `apps/server/test/database.test.ts` + `apps/server/test/db/hall-repository.test.ts`.
- [ ] Migration 4 (`id: 4, name: 'hall'`), STRICT, append-only + cascade:
  - `hall_records(profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, record_id TEXT NOT NULL, seq INTEGER NOT NULL, record_json TEXT NOT NULL, achieved_at TEXT NOT NULL, PRIMARY KEY(profile_id, record_id))`.
  - `hall_state(profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE, lifetime_json TEXT NOT NULL, heart_json TEXT, unlocks_json TEXT NOT NULL, achievements_json TEXT NOT NULL, updated_at TEXT NOT NULL)`.
  - `assertMigrationsWellFormed` stays happy (ids 1-4 contiguous). Forward-migrates a 6B db cleanly.
- [ ] `ServerRunRecordRepository` (`apps/server/src/db/hall-repository.ts`) implementing the engine `RunRecordRepository` interface (`packages/engine/src/run-record-repository.ts`) for a GIVEN profileId (constructed with `{ database, profileId }`): `standings(limit)` (records sorted by score desc), `records()`, `appendRecord(stored)` (insert; reject duplicate record_id per the interface), `currentHeart()`/`recordHeart()` (hall_state.heart_json), `lifetime()`/`applyDeltas(deltas)` (hall_state.lifetime_json, merged via the engine's `mergeMetrics`/applied-recordId idempotency — reuse the engine merge logic; do NOT re-implement). Seed an empty `hall_state` row lazily on first write. Mirror the 6A/6B prepared-statement repo shape.
- [ ] Tests: migration 4 applies (fresh + 6B db); append/records/standings round-trip; duplicate record_id rejected; lifetime applyDeltas is idempotent (same recordId twice → applied once); heart read/write; a stored `HallRecord` JSON round-trips.
- [ ] Commit.

## Phase C — Server finalize + unlock evaluation

### Task 3: `evaluateUnlocks` (pure, shared)
**Files:** `packages/session-core/src/unlocks.ts` (or engine — put it where it can read `HallRecord[]` + `LifetimeState` + content class ids; session-core is fine). Tests: `packages/session-core/test/unlocks.test.ts`.
- [ ] `evaluateUnlocks({ records, lifetime, content }): ReadonlySet<string>` (or `readonly string[]`) — returns unlocked class ids. Rules (hardcoded by class id, one place):
  - `class.warden` if any `records[i].deepestDepth >= 10`.
  - `class.archivist` if the profile's lifetime champion defeats `>= 3` (use whichever the `LifetimeState` tracks — `totals.championKills >= 3`, or `conqueredChampionRecordIds.size >= 3`; pick the persistent one).
  - Only include a class id if it EXISTS in content + is currently `playable: false` (an unlock only matters for a locked class). A class already `playable: true` is never in the unlock set.
- [ ] Tests: no records/empty lifetime → empty; a record with deepestDepth 10 → {warden}; deepestDepth 9 → not; championKills 3 → {archivist}; 2 → not; both conditions → both; a playable class is never returned.
- [ ] Commit.

### Task 4: Server finalize-on-conclusion
**Files:** `apps/server/src/play/play-session.ts` (finalize hook), wire a `ServerRunRecordRepository` + a clock/enrichment source into `ServerPlaySession`. Tests: `apps/server/test/play/play-session.test.ts`.
- [ ] When the run FIRST transitions to concluded (`this.run.conclusion !== null` and not already finalized): call `finalizeRun({ run: this.run, content: this.pack, lifetime: hallRepo.lifetime() })` (import from engine); set `this.run` to the finalized run; wrap the `HallRecord` with a `HallRecordEnrichment` `{ achievedAt: this.clock(), portraitGlyph: <the run's hero glyph or a default> }` → `StoredHallRecord`; `hallRepo.appendRecord(stored)`; `hallRepo.applyDeltas(finalized.deltas)`; evaluate unlocks (`evaluateUnlocks({ records: hallRepo.records(), lifetime: hallRepo.lifetime(), content: pack })`) + persist them (hall_state.unlocks_json) + persist achievements; then `activeRunRepo.clear(profileId)` (the 6B follow-up — the run is over, remove the active_runs row). The snapshot's `conclusion` now projects the REAL record (`projectRunConclusion({ run, record: stored, achievements })`), so the client shows the true score/heirloom.
- [ ] Guard against double-finalize (a re-sent command or reconnect must not append twice — the run is `finalized: true` after the first; check that, or rely on `appendRecord`'s duplicate-recordId rejection + not re-running deltas). Determinism: `finalizeRun` is pure; only the enrichment is host-supplied.
- [ ] Tests: a run driven to conclusion writes exactly one Hall record + applies lifetime deltas + evaluates unlocks + clears the active_runs row; the conclusion snapshot carries the real (non-null) score/heirloom/achievements; a reconnect/re-send after conclusion does NOT double-append; determinism parity harness stays green (finalize is the same engine code).
- [ ] Commit (regenerate NO demo fixtures — engine/content unchanged; confirm demos byte-identical).

## Phase D — Unlocks to the client + go-live

### Task 5: Deliver unlocks to the client + run-start re-validation
**Files:** `apps/server/src/routes/auth.ts` (or a new `GET /api/profile/progression`) to include the profile's unlocked class ids in the signed-in payload; `apps/server/src/db/hall-repository.ts` (a `unlocks()` read); `apps/web/src/session/account.ts` (`AccountState` carries `unlockedClassIds`); `apps/server/src/play/play-session.ts` or the ws-play open path (re-validate the class on run start). Tests: server + client.
- [ ] Add the profile's unlocked class-id set to the signed-in session/account payload (extend `GET /api/auth/session`'s response or add `GET /api/profile/progression` — pick the cleaner; the client already fetches the session on boot). `AccountState` (`account.ts`) gains `readonly unlockedClassIds: readonly string[]` (empty for guests).
- [ ] Server run-start re-validation: when a profile starts a NEW run with a chosen class (once hero-selection exists it's client-supplied; for 6B/6C the run defaults to the guest hero, so this is a forward-guard — implement the CHECK: the server rejects starting a run with a `playable:false` class the profile hasn't unlocked). Document that until profile hero-customization lands, the default hero is a playable class so this is a guard for the future path.
- [ ] Tests: a signed-in session response includes the profile's unlocks; a guest has none; the server rejects an unearned locked-class run start (unit-test the validation predicate).
- [ ] Commit.

### Task 6: Chargen go-live + ProfileSession real finalize
**Files:** `apps/web/src/ui/screens/chargen/steps/CallingStep.tsx` (unlocked→playable), the chargen data path (thread `unlockedClassIds` from the account to chargen); `apps/web/src/session/profile-session.ts` (`finalizeConcludedRun` real, non-stub — the conclusion already carries the real record from the server). Tests: chargen + profile-session.
- [ ] Chargen: a class that is content-`playable:false` BUT in the profile's `unlockedClassIds` renders as SELECTABLE (drop the `locked`/`⊘` + unlock hint, allow selection). Thread `unlockedClassIds` from `AccountState` into the chargen screen. Guests: empty set → every locked class stays locked (unchanged).
- [ ] `ProfileSession.finalizeConcludedRun`: the server already finalized + the snapshot's `conclusion` carries the real score/heirloom/achievements — make this return that real projection (remove the TODO stub); it does NOT write any client repo (the server owns the Hall). The client conclusion screen shows the real ending.
- [ ] Tests: a signed-in chargen with `warden` unlocked shows Warden selectable; guest chargen unchanged (Warden locked); the profile conclusion surfaces the real (non-null) score/heirloom.
- [ ] Commit.

## Phase E — Lifetime stats + achievements surfacing

### Task 7: Lifetime stats + achievements to the client
**Files:** a server read (fold lifetime + achievements into the progression payload from Task 5, or a `GET /api/profile/lifetime`); a client surface (a lifetime-stats view — reuse the Hall/records UI or a simple panel; achievements list). Tests: server + client.
- [ ] Expose the profile's lifetime totals + granted achievements to the client (extend the progression payload). Add a modest client surface (a lifetime-stats + achievements view — reuse existing records/codex UI patterns; keep it simple). Guests: their existing client-side lifetime/records UI is unchanged.
- [ ] Tests: the progression payload includes lifetime totals + achievements; the client renders them for a signed-in profile.
- [ ] Commit.

## Phase F — Data export + profile deletion

### Task 8: `GET /api/profile/export`
**Files:** `apps/server/src/routes/profile.ts` (the export route), `apps/server/src/db/hall-repository.ts` (reads). Tests: `apps/server/test/routes/profile.test.ts`.
- [ ] `GET /api/profile/export` (auth + origin gated, like the other profile routes) → a JSON document of the profile's OWN data: Hall records, lifetime totals, unlocks, achievements, settings (NO secrets — no tokens/session ids). Content-Disposition for a download is optional.
- [ ] Tests: an authenticated export returns the profile's records/lifetime/unlocks/achievements/settings; unauthenticated/cross-origin rejected; no session/token data leaks.
- [ ] Commit.

### Task 9: `DELETE /api/profile` + client delete-account flow
**Files:** `apps/server/src/routes/profile.ts` (the delete route), `apps/server/src/db/profile-repository.ts` (a `delete(profileId)` that relies on the FK cascades + revokes sessions); client `SettingsOverlay`/title Settings (a "Delete account" action). Tests: server + client.
- [ ] `DELETE /api/profile` (auth + origin + CSRF gated; require an explicit confirmation — a body flag or a typed confirmation) → delete the profile row; the FK `ON DELETE CASCADE` removes `active_runs`, `hall_records`, `hall_state`, and (confirm/add cascade) `sessions`/`login_tokens`; revoke the current session. Do it in a transaction. Return 204.
- [ ] Client: a "Delete account" action (Settings) that confirms (a typed confirmation dialog), calls the endpoint, clears the local account/session, and returns to the guest/title flow.
- [ ] Tests: authenticated delete removes ALL the profile's rows (records/state/active_runs/sessions) + the profile; a subsequent session request is unauthenticated; unauthenticated/cross-origin/unconfirmed delete rejected; the client flow tears down to guest.
- [ ] Commit.

## Phase G — Gate

### Task 10: Whole-surface verification
- [ ] `npm run verify` exit 0 (typecheck, lint, format:check, depcruise, knip, all suites incl. session-core + server + web).
- [ ] All 7 demos VERIFY OK, hashes UNCHANGED (6C changed no engine/content behaviour). The cross-process determinism parity harness stays green.
- [ ] Format fixups; commit.

## Self-review

- Coverage: shared protocol (T1), server Hall persistence (T2), unlock eval + server finalize (T3–T4), client go-live + real finalize (T5–T6), lifetime/achievements surfacing (T7), export + deletion (T8–T9), gate (T10) — matches the spec + the 3 user decisions (Warden depth-10, Archivist 3 champions, full scope incl. export/deletion) + both 6B follow-ups (T1 protocol, T4 clear active_runs).
- Determinism: no engine/content change → demos byte-identical; finalize is the same pure engine code; parity harness stays green. Migration 4 additive.
- Server-authoritative throughout; guest unchanged; the run-start unlock re-validation is the anti-cheat guard.
