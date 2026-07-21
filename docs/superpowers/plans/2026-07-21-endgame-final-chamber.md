# Endgame: Final Chamber & Endings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make all four run completion types producible: add the depth-20 Final Chamber, the three ending choices (Become the Heart → `became-heart`; Turn away → the Heart boss fight → win `refused` / lose forced `became-heart`; Assemble the tablet → `broke-cycle`), the Ancient Tablet fragment items + rare deep spawn, and the client — all guest-local/single-run.

**Architecture:** The run-records pipeline (`RunConclusion`, `finalizeRun`, `HeartLineageRecord`, scoring, Hall tier order) and all four `CompletionType`s already exist; only `died` is produced. This milestone wires triggers into that pipeline: an authored Final Chamber floor (mirroring `generateTownFloor`), a new `final-chamber-choice` command that sets the conclusion (mirroring `concludeRunOnHeroDeath` + `SearchCommand`), a weakened Heart boss (reusing the boss/combat framework) with a scoped hero-death override, and fragment items/spawn (reusing item content + depth-banded loot). The lineage store write and predecessor display are client-side (`guest-session.ts`); the engine stays repository-free.

**Tech Stack:** `packages/engine` (deterministic TS), `packages/content` (YAML→Zod), `apps/web` (React 19/Tailwind v4/Base UI). Design of record: `docs/superpowers/specs/2026-07-21-endgame-final-chamber-design.md`.

## Global Constraints

- **Determinism.** Instant conclusions (voluntary `became-heart`, `broke-cycle`) consume **no** randomness (mirror `died`). The Heart boss fight consumes combat RNG normally. Fragment spawn threads the **`run.rng.encounters`** stream (floor-gen-time placement stream — never `run.rng.loot`). No new RNG streams. No `Math.random`/`Date.now`.
- **Only Task 8 regenerates demo hashes**, and only for the content-hash-embed shift from adding the Chamber vault + fragments + boss + loot — a benign content-hash embed, not behavioural drift. Never regenerate to hide a behaviour change.
- **Save-schema drift guards must compile.** `_CommandDrift` (`save-schema/commands.ts:158`) binds the command schema to `GameCommand`; update both together. Any new run-state field updates its schema + guard.
- **Fail loud.** Bad content is a `ContentCompileError`. Already-validated engine invariants `throw`. The `broke-cycle` choice is rejected unless the hero holds the full fragment set; the choice is rejected off the Chamber floor and after conclusion (`run.concluded`).
- **No `any`/lying casts. No history/lineage comments (present-tense only). Single-source closed vocabularies (`as const` → type + `z.enum`). Reuse shared primitives.**
- **Build gate (vitest does NOT typecheck):** content build → engine build → `tsc` web → `tsc` server → suites → the six demos → `npm run lint`/`format:check`/`knip`/`depcruise`. The whole gate is `npm run verify` + the demo replays.
- **Ending/epilogue text is client copy** (extend `COMPLETION_HEADLINE` in `ConclusionScreen.tsx` and the choice-overlay strings). Do **not** introduce a new content kind — none exists for dialogue and it is out of scope.

---

### Task 1: `FINAL_CHAMBER_DEPTH` + Final Chamber floor generation

**Files:**
- Create: `packages/engine/src/final-chamber.ts` (the authored-floor assembler + the depth constant).
- Modify: `packages/engine/src/floor-transition.ts:139` (branch `descendToNextFloor` on the final depth).
- Create (content): `content/vaults/final-chamber.yaml` (a `vault` entry tagged `final-chamber`, a fixed lit layout with the hero entry stair and a central Heart marker tile/slot).
- Test: `packages/engine/test/final-chamber.test.ts`.

**Interfaces:**
- Produces: `export const FINAL_CHAMBER_DEPTH = 20;` and `export function generateFinalChamberFloor(pack: CompiledContentPack): FloorSnapshot` — a fixed floor at `depth: FINAL_CHAMBER_DEPTH`, deterministic, **no RNG consumed**. Mirror `generateTownFloor` (`town-floor.ts:128`): select the single `vault` entry tagged `'final-chamber'` (throw unless exactly one, like `townVaultEntry`), transform via `vaultTransforms(vault)[0]`, assemble the `FloorSnapshot` fully lit.
- Consumes: nothing from earlier tasks.

**Steps:**
- [ ] **Write failing test** — assert `generateFinalChamberFloor(pack).depth === FINAL_CHAMBER_DEPTH`, the floor is fully lit, contains the authored Heart marker cell, and is byte-identical across two calls (`stableJson` equality — determinism). Assert `descendToNextFloor` from depth 19 yields a floor whose depth is `FINAL_CHAMBER_DEPTH` and whose layout equals the chamber (not a procedural floor).
- [ ] **Run it — fails** (`cd packages/engine && npx vitest run test/final-chamber.test.ts`).
- [ ] **Author `content/vaults/final-chamber.yaml`** mirroring `content/vaults/town.yaml`'s legend/terrain format: a fixed lit room, an up-stair (hero entry), and a central marker (a `fixture`/decoration slot or a distinctly-tagged terrain the client renders as the bound Heart). Keep it small.
- [ ] **Implement `final-chamber.ts`** mirroring `town-floor.ts` (the `finalChamberVaultEntry(pack)` selector + assembler). Add `FINAL_CHAMBER_DEPTH`.
- [ ] **Branch `descendToNextFloor`** (`floor-transition.ts` around line 139): when `nextDepth === FINAL_CHAMBER_DEPTH` and the floor is not already stored, assign the chamber floor from `generateFinalChamberFloor(content)` instead of `generateFloor(...)`. Preserve stored-floor re-entry semantics (the chamber, once generated, persists in `run.floors` like any floor).
- [ ] **Run tests — pass.** Content build + engine build clean.
- [ ] **Commit** `feat: author the Final Chamber floor at depth 20 (endgame task 1)`.

---

### Task 2: Fragment items + `heroHoldsAllFragments` gate primitive

**Files:**
- Create (content): `content/items/tablet-fragment-*.yaml` — **3** fragment items (`item.tablet-fragment.a/b/c`), non-stackable, distinct ids, tagged `tablet-fragment`, `minDepth: 15`. Mirror an existing simple `content/items/*.yaml`.
- Create: `packages/engine/src/final-chamber-fragments.ts` — the fragment id set + the full-set predicate.
- Modify test: `packages/content/test/default-content.test.ts` (item count bump).
- Test: `packages/engine/test/final-chamber-fragments.test.ts`.

**Interfaces:**
- Produces:
  - `export const TABLET_FRAGMENT_TAG = 'tablet-fragment';`
  - `export function tabletFragmentIds(content: CompiledContentPack): readonly string[]` — every item id carrying `TABLET_FRAGMENT_TAG` (single-sourced from content via the existing `itemTags` lookup used by G7's lockpick check — do NOT hardcode the ids in engine).
  - `export function heroHoldsAllFragments(run: ActiveRun, content: CompiledContentPack): boolean` — true iff, for **every** id in `tabletFragmentIds(content)`, some `run.items` entry has `location.type === 'backpack' && location.actorId === run.hero.actorId && contentId === id` (mirror the backpack filter at `inventory.ts:562`).
- Consumes: nothing.

**Steps:**
- [ ] **Write failing test** — a hand-built run holding all 3 fragment items in the hero backpack → `heroHoldsAllFragments` true; missing one → false; holding them on the floor (not backpack) → false; `tabletFragmentIds` returns exactly the 3 authored ids.
- [ ] **Run it — fails.**
- [ ] **Author the 3 fragment items** (tagged `tablet-fragment`, `minDepth: 15`, non-stackable). Bump the content item-count test.
- [ ] **Implement `final-chamber-fragments.ts`** using `itemTags(content, contentId)` (the same tag lookup G7 used at `features.ts:494`).
- [ ] **Run tests — pass.**
- [ ] **Commit** `feat: add Ancient Tablet fragment items and the full-set gate (endgame task 2)`.

---

### Task 3: The `final-chamber-choice` command → instant conclusions + lineage write

**Files:**
- Modify: `packages/engine/src/commands-model.ts` (new command in the `GameCommand` union; new `InvalidActionReason`s), `packages/engine/src/actions.ts` (`resolveCommand` branch + `FinalChamberChoiceAction`), `packages/engine/src/action-dispatch.ts` (`ACTION_DISPATCH` resolver), `packages/engine/src/save-schema/commands.ts` (schema + `_CommandDrift`), `packages/engine/src/run-conclusion.ts` (a new conclusion setter for choices), `packages/engine/src/reducer.ts` (gate the command to the Chamber floor, like the town-truce guard at `reducer.ts:142-153`).
- Modify (client): `apps/web/src/session/guest-session.ts:544` (`finalizeConcludedRun` → call `repository.recordHeart(...)` on `became-heart`).
- Test: `packages/engine/test/final-chamber-choice.test.ts`, and a client test in `apps/web/test/` for the lineage write.

**Interfaces:**
- Consumes: `FINAL_CHAMBER_DEPTH` (Task 1), `heroHoldsAllFragments` (Task 2).
- Produces: the command shape (below) and `concludeRunOnChoice(...)` used by later tasks.

**Command shape** (mirror `SearchCommand` at `commands-model.ts:88`, add a discriminant payload):
```ts
export interface FinalChamberChoiceCommand extends CommandEnvelope {
  readonly type: 'final-chamber-choice';
  readonly choice: 'become-heart' | 'turn-away' | 'break-cycle';
}
```
Add to the `GameCommand` union and the `command` z.discriminatedUnion in `save-schema/commands.ts` (keep `_CommandDrift` compiling). New `InvalidActionReason`s: `'final-chamber.unavailable'` (not on the Chamber floor / no Heart present) and `'final-chamber.fragments-required'` (`break-cycle` without the full set).

**Conclusion setter** (add to `run-conclusion.ts`, mirroring `concludeRunOnHeroDeath` at line 36):
```ts
export function concludeRunOnChoice(input: Readonly<{
  state: ActiveRun; completionType: CompletionType; turn: number; eventId: OpaqueId;
}>): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }>
```
Sets `conclusion` with `killerContentId: null`, `depth` from the active floor, `turn`, `worldTime`, `concludedAtRevision`, `finalized: false`; appends a `RunConcludedEvent`. Consumes no randomness.

**Steps:**
- [ ] **Write failing tests** — (a) `become-heart` on the Chamber floor → conclusion `completionType: 'became-heart'`, run read-only afterward; (b) `break-cycle` with all fragments → `'broke-cycle'`; (c) `break-cycle` WITHOUT the full set → rejected `'final-chamber.fragments-required'`, conclusion still null; (d) any choice off the Chamber floor → rejected `'final-chamber.unavailable'`; (e) any choice after conclusion → rejected `'run.concluded'`; (f) the choice consumes no RNG (rng bytes unchanged). Leave `turn-away` to Task 4 (assert it does NOT yet conclude — it will activate the boss).
- [ ] **Run — fails.**
- [ ] **Implement** the command across the five engine files (mirror `search`), `concludeRunOnChoice`, and the Chamber-floor gate in `reducer.ts`. `become-heart`/`break-cycle` call `concludeRunOnChoice`; `break-cycle` first checks `heroHoldsAllFragments`. `turn-away` is a no-op placeholder that Task 4 fills (return a benign invalid or a marker the boss task replaces — document present-tense).
- [ ] **Client lineage write:** in `finalizeConcludedRun` (`guest-session.ts:544`), after `appendRecord`, when `conclusion.completionType === 'became-heart'` call `repository.recordHeart({ heroName: finalized.record.heroName, classTags: finalized.record.classTags, hallRecordId: finalized.record.recordId, enrichment })`. Add a client test asserting a `became-heart` finalize sets `repository.currentHeart()`.
- [ ] **Run tests — pass.** All four tsc clean (drift guard compiles).
- [ ] **Commit** `feat: final-chamber-choice command with became-heart/broke-cycle conclusions (endgame task 3)`.

---

### Task 4: The refused branch — the Heart boss, activation, resolution, defeat-override

**Files:**
- Create (content): `content/encounters/heart-boss.yaml` — a `model: boss` encounter (weakened stats, tuned; mirror the boss in `content/encounters/early-populations.yaml:89`) plus its monster entry.
- Modify: `packages/engine/src/actions.ts`/`action-dispatch.ts` (the `turn-away` choice activates the boss), a new `packages/engine/src/final-chamber-boss.ts` (activation: build the boss `PopulationInstance` + actor and merge into `run.actors`/`run.populations`, mirroring `population-placement.ts:896-908,1022`; set a `heartBossActive` marker), `packages/engine/src/run-conclusion.ts` (the death-override), and the run/save-schema for the `heartBossActive` flag if not derivable.
- Test: `packages/engine/test/final-chamber-boss.test.ts`.

**Interfaces:**
- Consumes: the `turn-away` choice (Task 3), `concludeRunOnChoice` (Task 3).
- Produces: `heartBossActive` predicate (derive from "a live actor from the heart-boss encounter exists in `run.actors`" if possible, to avoid new save state; otherwise a run flag with schema + guard).

**Resolution wiring:**
- **Turn away** → activate the Heart boss (hostile actor injected at/near the Heart's cell); combat proceeds through existing systems (`advanceBosses`, `combat.ts`). Does NOT conclude yet.
- **Boss defeated** → set `refused`. Hook where the boss death is finalized: when the heart-boss actor dies (`boss.defeated` for this encounter), call `concludeRunOnChoice({ completionType: 'refused', ... })`. (Do this in the world-step boss-resolution path or a dedicated check keyed off the heart-boss encounter id.)
- **Hero would die while `heartBossActive`** → override: in `concludeRunOnHeroDeath` (`run-conclusion.ts:62`), if `heartBossActive`, set `completionType: 'became-heart'` (forced) instead of `'died'` (still `killerContentId: null`); this writes the lineage on finalize like any `became-heart`. Ordinary deaths elsewhere stay `died` (the override is strictly gated on the flag).

**Steps:**
- [ ] **Write failing tests** — (a) `turn-away` on the Chamber floor injects a hostile heart-boss actor and does NOT conclude; (b) defeating that boss → conclusion `'refused'`; (c) the hero reaching zero health while the heart boss is active → conclusion `'became-heart'` (not `'died'`); (d) the hero dying on an ordinary floor (no heart boss) still → `'died'` (override correctly scoped); (e) save round-trip of a run mid-heart-fight and post-`refused`.
- [ ] **Run — fails.**
- [ ] **Author the Heart boss** content (weakened, tuned; flavor name generic — the client supplies the predecessor's name). Bump content counts as needed.
- [ ] **Implement** `final-chamber-boss.ts` (activation), the `turn-away` wiring, the boss-defeat→`refused` hook, and the death-override in `concludeRunOnHeroDeath`. Prefer deriving `heartBossActive` from the presence of a live heart-boss actor (no new save field); add a run flag + schema/guard only if derivation is not clean.
- [ ] **Run tests — pass.** All tsc clean.
- [ ] **Commit** `feat: refused Heart boss fight with win→refused / lose→forced-became-heart (endgame task 4)`.

---

### Task 5: Fragment spawn — rare, deep, run-local no-duplicate

**Files:**
- Create/modify (content): a depth-banded loot-table entry (`content/loot-tables/*.yaml`) with a low-weight choice resolving each fragment, `minDepth: 15` (mirror the depth-banded loot pattern; `LootTableContentEntry` supports `minDepth`/`maxDepth`), referenced by a rare vault item-slot on deep floors OR a small placement hook in `packages/engine/src/population-placement.ts` near `fillItemSlots` (line 501).
- Modify: `packages/engine/src/population-placement.ts` (run-local exclusion: do not place a fragment type the hero already holds this run — reuse `heroHoldsAllFragments`'s per-id check).
- Test: `packages/engine/test/final-chamber-fragments.test.ts` (extend) or a placement test.

**Interfaces:**
- Consumes: `tabletFragmentIds` (Task 2), the `run.rng.encounters` placement stream.
- Produces: nothing new.

**Steps:**
- [ ] **Write failing test** — on a deep floor (depth ≥ 15) with a fixed seed, the fragment placement is deterministic; a fragment type already in the hero's backpack is NOT placed again (run-local no-duplicate); shallow floors (depth < 15) never place fragments.
- [ ] **Run — fails.**
- [ ] **Implement** the depth-banded, low-probability seeded placement (threading `run.rng.encounters`, never `run.rng.loot`) with the run-local exclusion. Prefer the loot-table/vault-slot route (least engine change); add the exclusion in the placement path.
- [ ] **Run tests — pass.** Determinism verified (no existing demo drives depth ≥ 15 with fragments, so no behavioural hash move — confirm via `git status` on fixtures).
- [ ] **Commit** `feat: rare deep-floor fragment spawn with run-local no-duplicate (endgame task 5)`.

---

### Task 6: Client — the Final Chamber choice overlay + fragment display

**Files:**
- Create: `apps/web/src/ui/overlays/FinalChamberChoice.tsx` — the choice overlay (mirror `DecisionPrompt.tsx` + `pendingDecision`/`answerDecision` at `guest-session.ts:343`, or `OptionRow`/`FacetedOptionList` for the 2–3 options). Presents Become the Heart / Turn away / (Assemble the tablet, gated), dispatching the `final-chamber-choice` command with the chosen option; shows the predecessor Heart's name/class from `repository.currentHeart()` (fallback: an authored nameless ancestral Heart).
- Modify: `apps/web/src/session/guest-session.ts` (surface a `pendingFinalChamberChoice` projection when the hero is on the Chamber floor with the Heart present, and whether the hero holds the full fragment set), `apps/web/src/session/projection-view.ts` (the full-set flag + predecessor identity, at the single reviewed cast boundary), inventory/codex display for fragment items (they render as ordinary items — confirm they show).
- Test: `apps/web/test/final-chamber-choice.test.tsx` (RTL).

**Interfaces:**
- Consumes: the `final-chamber-choice` command shape (Task 3), `heroHoldsAllFragments` projected as a flag, `currentHeart()`.
- Produces: nothing downstream.

**Steps:**
- [ ] **Write failing RTL tests** — the overlay appears on the Chamber floor; shows two options without fragments and three with the full set; each option dispatches the right `final-chamber-choice` command; the predecessor's name shows when the lineage store has one, the fallback when empty; Turn away triggers the boss (asserted via dispatched command, not a conclusion).
- [ ] **Run — fails** (`cd apps/web && npx vitest run test/final-chamber-choice.test.tsx`).
- [ ] **Implement** the projection additions (Chamber-choice pending state + full-set flag + predecessor identity) and the overlay (reusing existing dialog/focus/option primitives; no new key machine; theme tokens, not hardcoded hex).
- [ ] **Run tests — pass.** Web tsc clean.
- [ ] **Commit** `feat: Final Chamber choice overlay and fragment display (endgame task 6)`.

---

### Task 7: Ending & epilogue copy (conclusion screen)

**Files:**
- Modify: `apps/web/src/ui/screens/ConclusionScreen.tsx` (`COMPLETION_HEADLINE` at lines 28–33 already keys all four types — add the endgame copy: `became-heart` voluntary vs. the forced narration is distinguishable via a flag on the projection if desired, else one headline; `refused` = the crumbling-Deep escape epilogue; `broke-cycle` = the cycle-ended lore). Any Chamber narration strings and the `broke-cycle` unlock lore live here / in the overlay copy.
- Test: `apps/web/test/` conclusion-screen test asserting each new completion type renders its headline/epilogue.

**Interfaces:**
- Consumes: the completion types produced by Tasks 3–4.

**Steps:**
- [ ] **Write failing test** — the conclusion screen renders a distinct headline + epilogue for `became-heart`, `refused` (escape/destruction epilogue), and `broke-cycle`.
- [ ] **Run — fails.**
- [ ] **Implement** the copy (present-tense, setting-appropriate; reuse the existing structural rendering — only strings/branches, no new layout). If the forced-`became-heart` narration must differ from the voluntary one, project a small `heartAcquisition: 'chosen' | 'forced'` flag from the conclusion cause context; otherwise a single `became-heart` headline is acceptable.
- [ ] **Run tests — pass.**
- [ ] **Commit** `feat: endgame ending and epilogue copy on the conclusion screen (endgame task 7)`.

---

### Task 8: Endgame demo + intentional hash regen + whole-milestone verify

**Files:**
- Create: `scripts/endgame-demo.mjs` + `packages/engine/test/fixtures/endgame-demo-hashes.json` (mirror `scripts/gameplay-demo.mjs` / `run-records-demo.mjs`): a scripted run reaching the Chamber and exercising each choice — including an all-fragments `broke-cycle` seed and a `refused` boss win — with hash coverage.
- Modify: `package.json` (`endgame:demo` script + fold into `verify` demo list and CI), the affected `*-demo-hashes.json` fixtures (content-hash-embed regen).

**Steps:**
- [ ] **Author `endgame-demo.mjs`** driving `resolveCommand` through a full endgame (reach Chamber → became-heart in one seed; → refused boss win in another; → broke-cycle with fragments in another), asserting the visible outcomes and hashing state/records/events/projection.
- [ ] **Regenerate the affected fixtures INTENTIONALLY:** run each `scripts/<name>-demo.mjs` without `--verify`, EYEBALL the candidate vs. fixture to confirm the move is only the content-hash embed (new Chamber/fragments/boss/loot content) + the new endgame demo's own hashes — no unexplained behavioural drift — then copy over. If a demo you didn't expect to move has moved, STOP and investigate.
- [ ] **Wire `endgame:demo`** into `package.json`, the `verify` chain's demo replays, and `.github/workflows/ci.yml`.
- [ ] **Run the full gate:** `npm run verify` green (typecheck, lint 0 errors, format, depcruise, knip, suites) + all demos (`gameplay`/`dungeon`/`merchant`/`population`/`run-records`/`engine`/`endgame`) VERIFY OK.
- [ ] **Update docs:** confirm `docs/design/endgame-final-chamber.md` matches what shipped; `future.md` already retired the return-journey line.
- [ ] **Commit** `feat: endgame demo, hash regen, and whole-milestone verify (endgame task 8)`.

---

## Self-review (author)

- **Spec coverage:** Chamber floor (T1), the three choices + conclusions + lineage write (T3), the refused boss + defeat-override (T4), fragments + spawn + gate (T2/T5), all ending/epilogue text (T7), client overlay (T6), demo + regen (T8). The account-level fragment store is explicitly out of scope (6C) — no task, correct.
- **Determinism:** only T8 regenerates hashes; instant conclusions and spawn placement are RNG-disciplined (no `loot` stream misuse; no new streams); the boss fight uses existing combat RNG.
- **Type consistency:** the command is `FinalChamberChoiceCommand`/`type: 'final-chamber-choice'` with `choice: 'become-heart' | 'turn-away' | 'break-cycle'` throughout; `concludeRunOnChoice` and `heroHoldsAllFragments`/`tabletFragmentIds` names are stable across tasks; `FINAL_CHAMBER_DEPTH = 20` single-sourced in `final-chamber.ts`.
- **No new content kind** (dialogue stays client copy). No engine repository dependency (lineage write/display are client-side). Fragment ids are single-sourced from content via the `tablet-fragment` tag, not hardcoded in engine.
