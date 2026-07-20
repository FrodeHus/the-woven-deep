# Light-out Feats Implementation Plan

> **For agentic workers:** execute task-by-task with Subagent-Driven Development.

**Goal:** three chargen-selectable feats for the light-out mechanic — Born in the dark
(reveal radius 4), Living compass (remembered map visible while dark), Dungeon sense
(commits dark-discovered terrain to memory). Two are author-only; Dungeon sense needs one
new derived-stat knob + a small knowledge-commit-path change. Design:
`docs/design/light-out-feats.md`.

**Tech Stack:** content (`trait` kind, `DERIVED_STAT_NAMES`), engine (perception/knowledge
commit, `deriveRunActorStats`).

## Global Constraints
- **Determinism.** No RNG in any feat. Adding content moves the content-hash-embed demo
  fixtures (`gameplay`/`merchant`/`population`/`run-records` saveHash-class fields) — that is
  a pure content-hash embed, regenerated intentionally in the final step, NOT a behavioural
  change (no demo drives light-out). The Dungeon-sense commit affects saved `FloorKnowledge`
  only when the knob is active and the hero is dark (no demo hero has it → no behavioural
  hash move). Never regen to hide an unexplained change.
- Single-sourced closed vocabularies (`DERIVED_STAT_NAMES` is one `as const`). No `any`/lying
  casts. No history/lineage comments. Fail loud. Build gate = content build → engine build →
  web tsc → server tsc → suites → demos → lint/format/knip/depcruise (`npm run verify` + demos).

---

### Task 1: Author Born in the dark + Living compass traits (content-only)

**Files:** a new `content/traits/<name>.yaml` (or extend `content/traits/first-descent.yaml`
— follow whatever grouping the existing file implies; a separate `light-out.yaml` is cleaner
for a themed pair), tests under `packages/content/test/` if a new file/assertion is needed.

**Deliverable:** two selectable chargen traits that set the existing light-out knobs.

- `trait.born-in-the-dark` — `name` + setting-appropriate `description`, `tags: [chargen]`,
  `modifiers: { lightOutRevealRadius: 3 }` (1 base + 3 = 4). Mirror the exact YAML shape of
  the entries in `content/traits/first-descent.yaml`.
- `trait.living-compass` — `modifiers: { lightOutMemoryPersists: 1 }`, themed description
  (the remembered map stays with you in the dark).
- Update any content test that asserts a hard trait/entry count (e.g. `default-content.test.ts`)
  to the new total. Do NOT weaken behavioural assertions.
- Tests: the two traits compile; they enumerate as `kind: trait` with `chargen` tag (so the
  chargen UI picks them up). The content compile gate covers most; add an explicit assertion
  only if a new file needs pinning.

**Interfaces produced:** two `trait` content ids, selectable at chargen with no code changes.

---

### Task 2: Dungeon sense — new knob + commit-path wiring + trait + tests

**Files:** `packages/content/src/model/common.ts` (`DERIVED_STAT_NAMES`), `content/balance/core-gameplay.yaml`
+ `packages/engine/src/fixture.ts` (default formula), `packages/engine/src/perception.ts`
(`refreshKnowledge`), `packages/engine/src/run-perception.ts` (`heroFloorPerception`),
`packages/engine/src/world-step.ts` (`refreshHeroKnowledge`), a new `content/traits` entry,
tests under `packages/engine/test/`.

**Deliverable:** the light-out bubble is committed to `FloorKnowledge` when a hero with
`lightOutCommitsMemory > 0` is in the dark; default behaviour (knob 0) is byte-identical.

- **New derived stat** `lightOutCommitsMemory`: add to the `DERIVED_STAT_NAMES` `as const`
  (single-sourced — the type derives from it automatically). Add a `{ base: 0 }` default
  formula in BOTH `content/balance/core-gameplay.yaml` and `packages/engine/src/fixture.ts`
  (match how `lightOutRevealRadius`/`lightOutMemoryPersists` are declared there). Read as
  boolean via `> 0`, mirroring `lightOutMemoryPersists`.
- **Commit-path wiring:** thread a hero-derived signal into the knowledge-commit path. When
  the hero's own cell is dark (illumination ≤ 0 — reuse whatever "in dark" predicate the
  projection uses so the trigger matches the reveal) AND `lightOutCommitsMemory > 0`, add the
  hero's light-out bubble cells (Chebyshev radius = the hero's `lightOutRevealRadius`, terrain
  only, floor bounds respected) to the committed/`observed` set so `rememberTiles` writes them
  into `FloorKnowledge` — in ADDITION to the existing illumination-gated commit, never
  removing it. Derive the hero's stats via the `deriveRunActorStats` world-step already has
  access to (thread it into `refreshKnowledge`/`heroFloorPerception` as a new typed parameter;
  do not reach for globals). No RNG draw. Keep the change minimal and the default path
  (knob 0 / not dark) exactly as before.
- **Author `trait.dungeon-sense`** — `modifiers: { lightOutCommitsMemory: 1 }`, themed
  description (you map the dark by touch and never forget it). Update the trait-count test.
- Tests: (a) with the knob active, a hero stepped into darkness commits its radius-N bubble
  terrain to `FloorKnowledge`, and that terrain is present in the remembered map after light
  returns; (b) with the knob 0 (default), the same dark step commits nothing new (existing
  behaviour unchanged — pin it); (c) a save round-trip of a run with committed dark terrain
  decodes cleanly. Assert observable knowledge/projection state, not internals.

**Interfaces consumed:** none new beyond Task 1's pattern.

---

### Task 3: Regenerate content-hash-embed fixtures + whole-milestone verify + docs

**Deliverable:** all gates green; docs reflect the shipped feats.

- Regenerate ONLY the content-hash-embed demo fixtures whose saveHash-class fields moved from
  adding the three traits + the new derived stat (`gameplay`/`merchant`/`population`/`run-records`
  as applicable): run each `scripts/<name>-demo.mjs` without `--verify`, EYEBALL the candidate
  vs current fixture to confirm ONLY content-hash-derived fields changed (no behavioural
  drift), then copy over. If a demo you didn't expect to move has moved, STOP and investigate.
- `npm run verify` green; all six demos `--verify` green.
- Update `docs/design/future.md`: move the three light-out feats from "Planned feats" to
  shipped (leaving the design note pointer). Reconcile `docs/design/light-out-feats.md` with
  what shipped.

## Self-review
- Born in the dark / Living compass reference only pre-existing knobs (verified in recon).
- Dungeon sense is the only save/replay-affecting change and is gated on an off-by-default
  knob, so existing runs are byte-identical.
- Content-hash-embed regen is the only intentional hash movement.
