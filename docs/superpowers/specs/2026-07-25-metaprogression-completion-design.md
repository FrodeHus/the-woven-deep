# Metaprogression completion — parameterized achievements + data-driven unlocks (Milestone 7C) — design spec

**Status:** design (brainstormed with the user 2026-07-25). Third and final sub-project of roadmap
**Milestone 7** "Town progression and full campaign content", after **7A** (deep dungeon 13–19, #88)
and **7B** (guaranteed milestone bosses, #89), both merged. Branch `feat/metaprogression-completion`
off `main` (ba3948d = Merge PR #89).

Completes milestone 7's metaprogression surface: a **parameterized achievement-criteria system** with a
real achievement roster, and **data-driven class-unlock conditions** that replace a hardcoded rule map
and fix the current hint↔rule drift. **In-world class foreshadowing is explicitly deferred to issue #79**
(the NPC dialogue system), where NPC-delivered hints are the natural vehicle; 7C leaves #79 the corrected
unlock conditions as its source of truth.

## What already exists (7C reuses / adjusts, does NOT rebuild)

- **Achievements are narrow and non-parameterized.** `AchievementContentEntry`
  (`packages/content/src/model/achievement.ts`) carries a fixed `criteriaId: AchievementCriteriaId`
  where `ACHIEVEMENT_CRITERIA_IDS = ['first-champion-defeat', 'first-echo-defeat']`. The schema
  (`compiler/schema/achievement.ts`) is a `z.strictObject` with `description` + that enum. Validation
  (`compiler/validation/achievement.ts`) enforces **at most one achievement per criterion id**
  (a strict 1:1 mapping). Content (`content/achievements/first-defeats.yaml`) has exactly 2 entries.
- **Achievement evaluation lives in the deterministic engine.** `run-finalize.ts` `finalizeRun`
  (documented "Pure and clock-free: identical inputs produce byte-identical outputs") computes
  `achievementGrants` from `run.fallenHeroDecisions` (champion/echo first-defeats), diffs against
  `lifetime.grantedAchievementIds`, and returns `AchievementGrant[]` + `AchievementGrantedEvent`s +
  `LifetimeDeltas`. `finalizeRun` reads `run.metrics` (a `RunMetrics` with `deepestDepth` etc.) and the
  run's conclusion/completion. The host (server `apps/server/src/play/play-session.ts`; guest
  `apps/web/src/session/run-records-storage.ts`) persists grants and delivers them to the client via the
  finalize payload + `/api/profile/export`. **This is exercised by `run-records-demo` and
  `endgame-demo`** (both hash `finalization`/`achievementGrants`).
- **`boss.defeated` events already identify the boss.** `BossDefeatedEvent` (`events-model.ts:444`)
  carries `encounterId` (e.g. `encounter.ashfather`); the metrics fold (`run-metrics.ts`, `case
  'boss.defeated'`) currently only increments a `bossKills` count. Each `encounter` resolves to a
  `definition.monsterId`.
- **Class unlocks are a hardcoded TS map.** `packages/session-core/src/unlocks.ts` `UNLOCK_RULES` maps
  `class.warden → any Hall record with deepestDepth >= 10` and `class.archivist →
  lifetime.conqueredChampionRecordIds.length >= 3`. `evaluateUnlocks({ records, lifetime, content })`
  filters to `playable: false` classes satisfying their predicate; it runs **server-side** in
  `play-session.ts` after finalization (not in the engine, not in any demo). `canStartClass` gates
  run-start on the persisted `unlockedClassIds`.
- **Class content declares only free-text hints.** `content/classes/locked-classes.yaml`:
  `class.archivist` and `class.warden` have `playable: false` and a free-text `unlockHint` that
  **`unlocks.ts` never reads**, and whose text **does not match the code rules**: the Archivist hint
  invents a nonexistent "read three lore fragments" mechanic (real rule: defeat 3 champions), and the
  Warden hint says "without a single death" (real rule: any run reaching depth 10). The 3 playable
  classes have `playable: true`, `unlockHint: null`.
- **Rich lifetime signals already tracked** (`run-metrics.ts` `RunMetrics`; `run-records-model.ts`
  `LifetimeState`, `HallRecord`): `bossKills`/`championKills`/`echoKills`, `deepestDepth`, per-record
  `completionType` (`'died' | 'became-heart' | 'refused' | 'broke-cycle'`),
  `conqueredChampionRecordIds`, `grantedAchievementIds`. No per-class breakdown and no aggregated
  ending counts — 7C's criteria use only already-tracked signals plus one new per-run boss set.
- **Content hash is pack-wide.** `compile-directory.ts` hashes all entries into one `hash` that every
  demo fixture pins, so any content edit (achievement, class field) shifts all 8 fixtures, exactly as
  in 7A/7B.

## Design

### Component 1 — Parameterized achievement criteria + roster

**Model / schema.** Replace the fixed `criteriaId: enum` on `AchievementContentEntry` with a structured
`criteria` discriminated union (`type` discriminant):

- `{ type: 'defeat-boss', monsterId }` — a `model: 'boss'` boss with that `monsterId` was defeated this
  run.
- `{ type: 'defeat-fallen-hero', role: 'champion' | 'echo' }` — a fallen-hero of that role was
  first-defeated this run (retains the existing 2 achievements via the current `fallenHeroDecisions`
  path — **no new tracking** for these).
- `{ type: 'reach-depth', depth }` — the run's `deepestDepth >= depth` (`depth` an integer 1–20).
- `{ type: 'complete-ending', ending }` — the run's `completionType === ending`, where `ending` is one
  of the non-`died` completion types (`broke-cycle` | `became-heart` | `refused`).

The Zod schema validates the union with `z.discriminatedUnion('type', …)`, each variant a
`z.strictObject`. **Validation change:** drop the 1:1 criterion-uniqueness rule; instead enforce unique
achievement ids (already global) and referential integrity: `defeat-boss.monsterId` resolves to a
`monster` entry that is a boss (tagged `boss`), `reach-depth.depth ∈ [1,20]`, `complete-ending.ending`
is a valid non-`died` completion type. Multiple achievements per criteria shape are now allowed.

**Engine evaluation (`run-finalize.ts`).** Rewrite `achievementGrants` to evaluate each
`AchievementContentEntry.criteria` against the run outcome, granting an achievement when its criterion
is satisfied AND its id is not in `lifetime.grantedAchievementIds` (grant-once semantics unchanged;
result still sorted by `achievementId` for determinism). Inputs read, all already available to
`finalizeRun`:
- `defeat-boss` → the run's **defeated-boss set** (new; see below).
- `defeat-fallen-hero` → the existing `isFirstDefeat(decision, role, lifetime)` over
  `run.fallenHeroDecisions`.
- `reach-depth` → `run.metrics.deepestDepth`.
- `complete-ending` → the run's completion type (from `run` conclusion, the same value `finalizeRun`
  writes as the record's `completionType`).

**The one new deterministic bit — per-run defeated-boss set.** Add a per-run field
`defeatedBossMonsterIds: readonly OpaqueId[]` (sorted, deduped) to the run state, mirroring how
`fallenHeroDecisions` is a per-run persisted list (NOT folded into `RunMetrics`, which stays pure
summable numbers). It is appended when a `boss.defeated` event is applied to run state, resolving the
event's `encounterId → definition.monsterId` via content. `finalizeRun` reads it for `defeat-boss`
criteria. This is a **save-model addition** (a new field in the run save-schema), additive and
determinism-guarded (save/load round-trip test; stable sort).

**Roster (10 achievements, `content/achievements/`).** Author, across the four criteria types:
- 3 milestone-boss defeats (`defeat-boss` → `monster.ashfather`, `monster.tide-sovereign`,
  `monster.heart-herald`).
- 3 endings (`complete-ending` → `broke-cycle`, `became-heart`, `refused`).
- 2 depth milestones (`reach-depth` → 15 and 20; depth-10 is intentionally omitted to avoid echoing the
  Warden unlock condition).
- 2 retained champion/echo, migrated to `defeat-fallen-hero { role }`
  (the existing `achievement.defeated-the-deeps-champion` / `achievement.silenced-an-echo`).

### Component 2 — Data-driven class-unlock conditions

**Schema.** Add a structured `unlock` field to class content — a discriminated union (`type`):
- `{ type: 'reach-depth', depth }` — satisfied when any Hall record has `deepestDepth >= depth`.
- `{ type: 'defeat-champions', count }` — satisfied when
  `lifetime.conqueredChampionRecordIds.length >= count`.

`playable: true` classes have `unlock: null` and `unlockHint: null`; `playable: false` classes MUST have
both a non-null `unlock` and a non-null `unlockHint`. A content-validation rule enforces this
biconditional (replacing the situation where `unlockHint` was unread free text). Both existing locked
classes are converted **behavior-preservingly**: `class.warden → { type: reach-depth, depth: 10 }`,
`class.archivist → { type: defeat-champions, count: 3 }` — identical unlock outcomes to today. The
`unlockHint` strings are corrected to match: Warden → "Descend to depth ten to unlock the Warden.";
Archivist → "Defeat three of the Deep's champions to unlock the Archivist." (dropping the nonexistent
lore-fragment mechanic).

**Evaluator (`packages/session-core/src/unlocks.ts`).** Replace the hardcoded `UNLOCK_RULES` map with a
generic evaluator that, for each `playable: false` class, reads its `unlock` condition and evaluates it
against `{ records, lifetime }`. `evaluateUnlocks`'s signature, its server call site
(`play-session.ts`), `canStartClass`, and the persisted `unlockedClassIds` are all unchanged — only the
source of truth moves from TS into content. `unlocks.test.ts` is rewritten to drive the data-driven
evaluator and assert both classes unlock under the identical conditions (Warden at a depth-10 record;
Archivist at 3 conquered champions), plus the "never return a playable/absent class" guarantees.

### Component 3 — Determinism, testing, scope

- **Determinism (hard invariant).** All achievement/finalize logic stays pure `Uint32State`-free
  deterministic engine code. Two engine-side sources of change:
  - **Content additions** (new achievements + the migrated 2; the class `unlock`/`unlockHint` edits)
    shift the pack content hash → all 8 demo fixtures regenerate; benign content-hash-embed movement
    where a demo's simulation is unaffected.
  - **Real simulation shift** on `run-records-demo` and `endgame-demo`: their runs now earn the new
    achievements (boss defeats, endings, depths), so their `achievementGrants`/records/events hashes
    move — **intended**. Each regen is diff-checked (intended grant shift vs benign hash-embed) and the
    cross-process **parity harness** (`apps/server determinism-parity`) must stay green.
  - The new `defeatedBossMonsterIds` save field is covered by a **save/load round-trip** test and its
    stable-sort determinism.
- **Server side (not demo-sensitive).** The `unlocks.ts` refactor changes no engine/demo output; it is
  guarded by the rewritten `unlocks.test.ts`. The class-content edits still shift the content hash
  (handled with the other content).
- **Testing.**
  - Content compiles under STRICT `z.strictObject`/`discriminatedUnion`: every achievement `criteria`
    and class `unlock` validates; all `monsterId`/`ending`/`depth` references resolve; the
    locked-class biconditional (`playable:false ⟺ unlock+hint present`) holds.
  - Engine: each criteria type grants its achievement when satisfied and not before; grant-once
    (re-finalizing a run that already granted yields no duplicate); `defeat-boss` reads the defeated
    set correctly (a run that defeated the Ashfather grants its achievement; one that didn't, doesn't);
    the `defeatedBossMonsterIds` accumulation (resolve `boss.defeated.encounterId → monsterId`, sorted)
    and its save round-trip.
  - Session-core: the data-driven `evaluateUnlocks` unlocks Warden/Archivist under the same conditions;
    respects `playable`/absent guards.
  - Determinism: all 8 demos regenerated + diff-checked (run-records/endgame = intended grant shift,
    others = hash-embed); parity green.
- **Out of scope.**
  - **In-world class foreshadowing → issue #79** (NPC dialogue). 7C's corrected `unlockHint` +
    structured `unlock` conditions are the source of truth #79 should foreshadow; leave a pointer in
    #79. No lore-item foreshadowing is authored in 7C.
  - No new playable/unlockable classes (data-drive + correct the existing 2 only).
  - No dialogue/journal system, no per-class lifetime stats, no new aggregated ending counters (criteria
    use already-tracked signals + the one boss-set addition).
  - No achievement UI redesign — achievements already flow to the client via the existing
    finalize/profile payloads; 7C adds data, not new client surfaces.

## Scope boundary

7C completes milestone 7's metaprogression: achievements become a parameterized, referentially-validated
system with a real ~10-entry roster spanning boss defeats, endings, depth milestones, and the retained
champion/echo; class unlocks become data-driven, self-consistent (hint matches rule), and extensible,
with behavior identical to today for the two locked classes. One small deterministic per-run addition
(the defeated-boss set) enables boss-specific achievements. Foreshadowing is handed to #79. No new
gameplay systems, no client-trust-boundary changes.
