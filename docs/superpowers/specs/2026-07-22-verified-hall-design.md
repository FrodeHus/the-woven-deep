# Milestone 6C — Verified Hall & Metaprogression (design spec)

**Status:** design (brainstormed with the user 2026-07-22). Builds on 6B (server-authoritative
runs — the server holds the authoritative `ActiveRun` and runs the exact same `packages/engine`).

Makes progression **server-authoritative for signed-in profiles**: the server finalizes a
profile's concluded run into a persisted Hall of Records, evaluates class unlocks + achievements
+ lifetime stats server-side, and exposes profile data export + deletion. **Guests are
unchanged** (their Hall stays client/session-scoped; guest progress is never imported into a
profile). Runs on this branch off 6B (`feat/server-authoritative-runs`); rebases when #80 merges.

## Decisions (from the user)

- **Warden unlock:** any of the profile's Hall records has `deepestDepth >= 10` ("reach the
  tenth deep").
- **Archivist unlock:** the profile has defeated **3 fallen champions** (lifetime — `championKills
  >= 3`, or 3 distinct conquered-champion ids; pick the one the lifetime state already tracks).
- **Full scope:** server Hall + unlock evaluation (locked classes go LIVE in chargen) +
  achievements-for-profiles + lifetime stats + **JSON data export + profile deletion**. Plus the
  two 6B follow-ups.

## What already exists (6C is mostly wiring)

- `finalizeRun({ run, content, lifetime })` (`packages/engine/src/run-finalize.ts`) is a PURE,
  deterministic function → `{ run (finalized), record: HallRecord, deltas: LifetimeDeltas, events }`.
  `recordId = deriveHallRecordId(runSeed, contentHash)` (deterministic). It already: selects the
  heirloom (the one `run-records` RNG consumer), scores, and computes `achievementGrants` (2
  criteria today: `first-champion-defeat`, `first-echo-defeat`).
- `RunRecordRepository` interface (`packages/engine/src/run-record-repository.ts`):
  `standings`/`records`/`appendRecord`, `currentHeart`/`recordHeart`, `lifetime`/`applyDeltas`.
  The guest backs it with `sessionStorage` (`run-records-storage.ts`); 6C backs it with SQLite.
- `LifetimeState.totals` + `mergeMetrics` already aggregate lifetime metrics idempotently.
- The 6B `ServerPlaySession` holds the authoritative concluded run; `ProfileSession.finalize
  ConcludedRun` is a documented 6C stub.

**So 6C never re-invents scoring/finalize/achievements — it CALLS the existing pure engine
function on the server's authoritative run and persists the result.** No new client-trust
boundary (the run is already server-authoritative).

## Architecture

### 1. Server Hall repository + migration 4
- **Migration 4** (additive, `apps/server/src/database.ts`): STRICT tables scoped by profile —
  `hall_records(profile_id REFERENCES profiles(id), record_id, seq INTEGER, record_json TEXT,
  achieved_at TEXT, PRIMARY KEY(profile_id, record_id))` (append-only; duplicate record_id
  rejected, matching the interface); and per-profile Hall state: a `hall_state(profile_id PK
  REFERENCES profiles(id), lifetime_json TEXT, heart_json TEXT, unlocks_json TEXT,
  achievements_json TEXT, updated_at)` row (lifetime totals + current Heart lineage + evaluated
  unlocks + granted achievements). (Or fold unlocks/achievements into `profiles.progression_json`
  — decide in the plan; a dedicated `hall_state` keeps `progression_json` free and the queries
  clean.)
- **`ServerRunRecordRepository`** (`apps/server/src/db/`) implements the engine
  `RunRecordRepository` interface over these tables (prepared statements, mirroring the 6A/6B
  repos). `standings(limit)` sorts the profile's records by score; `records()` returns them;
  `appendRecord` inserts (reject duplicate id); `lifetime`/`applyDeltas` read/merge the
  `hall_state` lifetime (idempotent via the applied-recordId set the engine already tracks);
  `currentHeart`/`recordHeart` read/write the heart lineage.

### 2. Server finalize on conclusion
- In `ServerPlaySession` (`apps/server/src/play/play-session.ts`): when the run FIRST concludes
  (`run.conclusion !== null` becomes true), call `finalizeRun({ run, content: pack, lifetime:
  repo.lifetime() })`, then `repo.appendRecord(stored)` (wrap the `HallRecord` with a
  `HallRecordEnrichment` = `{ achievedAt: <server date>, portraitGlyph: <profile/hero glyph> }`
  — the one place non-determinism is allowed) and `repo.applyDeltas(deltas)`; then evaluate
  unlocks (below); then **clear/mark the `active_runs` row** (`repo.clear(profileId)` — the 6B
  follow-up) so a new run can start. The finalized `HallRecord`/score/heirloom/achievements flow
  back into the snapshot's `conclusion` (via `projectRunConclusion({ run, record, achievements })`
  with the REAL record now) so the client shows the true ending.
- Determinism: `finalizeRun` stays pure/deterministic (recordId from seed+contentHash); the
  cross-process parity harness + demo hashes MUST remain byte-identical (finalize is the same
  code the guest runs). Only the enrichment date/glyph is host-supplied.

### 3. Unlock evaluation (net-new)
- A pure `evaluateUnlocks({ records, lifetime, content })` helper (engine or session-core so it's
  shared + testable): returns the set of unlocked class ids from the profile's Hall + lifetime.
  Rules (authored, tied to content — a small unlock-rule table or hardcoded per class id):
  - `class.warden` ← any record `deepestDepth >= 10`.
  - `class.archivist` ← lifetime champion defeats >= 3.
  (Keep the rule definitions in ONE place; if content-authored, add an optional `unlockRule` to
  the class schema — decide in the plan; hardcoded-by-id is acceptable for two classes but a
  small authored rule is cleaner and future-proof.)
- The server evaluates on each finalize (and on demand), stores the unlocked set in `hall_state`
  (or `progression_json`), and includes it in the account/session payload sent to the client.

### 4. Unlocks go live in chargen (client)
- The client receives the profile's unlocked class-id set (via the auth/session or a profile
  endpoint — extend `GET /api/auth/session`'s payload, or a `GET /api/profile/progression`).
  `AccountState` (`apps/web/src/session/account.ts`) carries it for signed-in profiles (empty for
  guests). Chargen's `CallingStep` treats a class as playable when `entry.playable || unlocked
  .has(entry.id)` — so a locked-by-content class the profile has unlocked becomes selectable, with
  the unlock hint replaced by an "unlocked" affordance. Guests: `unlocked` is empty → unchanged.
- The server ALWAYS re-validates on run start (a client can't claim an unlocked class it hasn't
  earned — the server checks the profile's unlocks when creating the run; anti-cheat).

### 5. Achievements + lifetime stats for profiles
- Achievements: `finalizeRun`'s `achievementGrants` already runs on the server finalize (§2);
  persist granted ids in `hall_state`. Surface them to the client (the Codex/records UI — reuse
  the existing achievement display path if any, else a simple list). Optionally add unlock-tied
  achievement criteria — but keep the two existing criteria; new criteria are optional polish.
- Lifetime stats: the server maintains `LifetimeState` via `applyDeltas`; expose via a profile
  endpoint (`GET /api/profile/lifetime` or fold into the progression payload) for a lifetime-stats
  view + the export.

### 6. Data export + profile deletion (the "full" scope)
- **Export:** `GET /api/profile/export` (authenticated + origin-checked) → a JSON document with
  the profile's Hall records + lifetime + unlocks + achievements (+ settings) — the user's own
  data, self-service. No secrets (no session tokens).
- **Deletion:** `DELETE /api/profile` (authenticated + origin-checked + likely a confirmation
  token) → deletes the profile and ALL its data. Rely on SQLite FK `ON DELETE CASCADE` where the
  child tables reference `profiles(id)` (active_runs, hall_records, hall_state, sessions) — add
  the cascade in migration 4 for the new tables + confirm the existing ones cascade or delete
  them explicitly in a transaction. Revoke sessions. Client: a "Delete account" action (Settings)
  that confirms, calls the endpoint, and returns to guest.

### 7. 6B follow-ups folded in
- **Clear concluded `active_runs`** — done as part of §2 (finalize clears the row).
- **Shared protocol package** — extract the `ws-protocol` message types (`ClientMessage`/
  `ServerMessage`/`ServerRunSnapshot`) into a shared home (`@woven-deep/session-core` or a new
  `@woven-deep/protocol`) that BOTH `apps/server` and `apps/web` import, removing the hand-synced
  duplication in `profile-session.ts`. (Small, high-value: kills the drift risk.)

## Determinism & gates

`finalizeRun`/scoring/heirloom/achievements are unchanged engine code → demo hashes stay
byte-identical; the cross-process parity harness stays green; migration 4 is additive. The unlock
evaluation is new but pure + server-side (no engine/content behaviour change, no demo impact
unless it becomes content-authored — if a class `unlockRule` field is added, that's a content-
hash-embed bump for the two locked classes, benign). Guest path unchanged.

## Testing
- Engine/shared: `evaluateUnlocks` (Warden at depth-10 record, Archivist at 3 champions, neither
  otherwise); reuse the existing finalize/score/achievement tests.
- Server: `ServerRunRecordRepository` (append/standings/lifetime/heart round-trips, duplicate-id
  reject, idempotent applyDeltas); `ServerPlaySession` finalize-on-conclusion (writes a Hall
  record, applies deltas, evaluates unlocks, clears the active_runs row); the run-start unlock
  re-validation (a profile can't start a class it hasn't unlocked); export + deletion endpoints
  (auth + origin gated; deletion cascades all profile data + revokes sessions); migration 4.
- Client: `AccountState` carries unlocks; chargen shows an unlocked locked-class as playable;
  guest unchanged (empty unlocks); the Settings delete-account flow; the profile session's real
  (non-stub) finalize surfaces the true conclusion.
- Determinism: demos byte-identical; parity harness green.

## Scope boundary
6C completes the server-authoritative progression. NOT in 6C: state patches/prediction (6B
non-goals, still out), server-side hero customization for profiles (still a non-goal — profiles
use the guest chargen shell), new gameplay content. Guest Hall stays client-only forever (no
guest→profile promotion).

## Open (resolve in the plan)
- `hall_state` table vs `profiles.progression_json` for lifetime/unlocks/achievements.
- Class `unlockRule` content field vs hardcoded-by-id unlock rules (two classes).
- The protocol package name/home (`session-core` vs new `@woven-deep/protocol`).
- The exact account/session payload shape for delivering unlocks to the client.
- Deletion confirmation flow (a typed confirmation vs a re-auth).
