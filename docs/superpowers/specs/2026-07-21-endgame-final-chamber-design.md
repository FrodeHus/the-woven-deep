# Endgame: Final Chamber & Endings — Design

**Status:** approved (brainstorm, 2026-07-21).

The last true gameplay milestone. It makes the game *completable*: all four run
completion types become producible, and the descent gains its narrative payoff. The
run-records milestone already built the entire finalization pipeline, scoring, Hall sort
order, and the Heart lineage store; only `died` is producible today. This milestone wires
the remaining triggers into that pipeline — it does not rebuild it.

## Premise

The Woven Deep is anchored at its center by a living person — the Heart of the Deep — bound
in place. The Deep holds together only while someone is bound. A hero who reaches the bottom
finds the current Heart and faces a choice that ends their run one of four ways. The Heart is
a *person*, not an artifact: there is nothing to carry out, so a run concludes **at** the
Final Chamber, not on a climb back. (This formally retires the master design's escape/return
model and future.md's deferred "return-journey reinforcement checks and artifact hazards" as
superseded — see "Superseded" below.)

The cycle is endless succession: each hero who takes the Heart's place frees the previous
Heart and binds themselves, so the next hero meets *them*. The already-built lineage store
implements exactly this — `became-heart` writes a `HeartLineageRecord`, most-recent-wins.

## Scope

**In scope (this milestone, all guest-local, single-run):**

- The Final Chamber: a fixed authored floor generated at the deepest depth.
- The bound Heart presented from the lineage store's `currentHeart()`, with a first-time
  fallback.
- The three ending choices — `became-heart`, `refused`, `broke-cycle` — as an inline choice
  at the Chamber, each producing a `RunConclusion` and running the existing `finalizeRun`.
- The Ancient Tablet fragment items and their rare deep-floor spawn.
- Single-run assembly: holding the full fragment set unlocks `broke-cycle` at the Chamber.
- All ending dialogue and lore.
- Client: the Chamber choice overlay and fragment display.

**Deferred to the server-progression milestone (6C) — "Part B":**

- The account-level (profile) fragment store and its `house-deposit`→account promotion.
- Cross-generation granting of collected fragments into future heroes.
- Cross-run spawn-exclusion of already-collected fragments.
- The registration incentive (profiles accumulate fragments across generations; guests do
  not). Part B layers on top of this milestone without reworking it. One decision is left to
  6C: whether a completed account set makes `broke-cycle` permanently available or is
  consumed on use.

**Out of scope entirely:** any return-journey mechanic (moot), server-authoritative runs
(6B), and the verified Hall (6C).

## The four completion types

```ts
type CompletionType = 'died' | 'became-heart' | 'refused' | 'broke-cycle';
```

Hall tier order (already implemented): `broke-cycle` > `became-heart` > `refused` > `died`.

- **`died`** — already produced when hero health reaches zero; unchanged.
- **`became-heart`** — the hero takes the bound Heart's place. Writes a `HeartLineageRecord`
  (hero name, class tags, Hall record id, enrichment) via `recordHeart`, making this hero the
  `currentHeart()` a future run will meet. Second tier.
- **`refused`** — the hero turns away and ends the descent, leaving the Heart bound. Lowest
  of the three non-death endings.
- **`broke-cycle`** — offered only when the hero carries the full fragment set. The hero
  assembles the Ancient Tablet, frees the Heart, and ends the cycle. Top tier.

All three new types set `ActiveRun.conclusion` exactly as `died` does (completion type, depth,
turn, worldTime; `killerContentId` is null for these), after which the run is read-only and
`finalizeRun` proceeds unchanged.

## The Final Chamber

- **Trigger:** reaching the deepest depth (20, config-driven) generates the Final Chamber
  instead of a normal procedural floor. This follows the town-floor precedent
  (`generateTownFloor` consuming a `vault`-tagged authored layout via a dedicated assembly
  path), not random generation — the Chamber is fixed authored content: fully lit, a defined
  layout, the Heart at its center, and the hero's entry stair.
- **The bound Heart:** read from the lineage store's `currentHeart()` — the predecessor who
  chose `became-heart`, presented by name and class tags. **First-time / no-lineage
  fallback:** an authored nameless "ancestral Heart." Guest sessions carry the lineage within
  a session (a `became-heart` run sets the Heart the next run meets); with nothing stored, the
  fallback shows. The Chamber reads the store; it does not require the store to be non-empty.
- **The choice:** presented inline as an authored dialogue + decision overlay (existing
  dialog/focus conventions). Two options are always available (Become the Heart → `became-heart`;
  Turn away → `refused`); the third (Assemble the tablet & free the Heart → `broke-cycle`) is
  present only when the hero holds all fragments, and carries its own unlock lore.

## The Ancient Tablet fragments (Part A — single-run)

- **Items:** an authored set of **3 fragment items** (count config-driven), special and
  non-stackable, each a distinct id, plus the authored "assembled tablet" the `broke-cycle`
  choice conceptually produces (the choice consumes the fragments; the tablet need not be a
  carried item in Part A).
- **Spawn:** fragments are placed by a **rare seeded roll on deep floors** (depth ≥ 15,
  config-driven), drawn from a dedicated deterministic RNG stream so continuous and
  split-replay execution agree. Each fragment type is distinct. A fragment type the hero
  already holds this run is excluded from further spawns (**run-local no-duplicate**). A full
  set in a single run is intentionally rare — the earned feel of the top ending.
- **Assemble gate:** at the Chamber, when the hero holds all fragment types, the `broke-cycle`
  option appears; choosing it assembles the tablet and produces the `broke-cycle` conclusion.
  No house or account store participates in Part A — the gate is purely "does the hero hold
  the full set right now."

## Architecture, determinism, and data

- **Engine — the choice command:** a new command valid *only* on the Final Chamber floor,
  carrying the chosen ending. It sets `conclusion.completionType` (records depth/turn/worldTime
  like `died`; `killerContentId` null), writes the `HeartLineageRecord` on `became-heart`, and
  leaves the run read-only for `finalizeRun`. It **consumes no randomness** (mirrors the death
  transition). Rejected off the Chamber floor and after conclusion (`run.concluded`). The
  `broke-cycle` variant is rejected unless the hero holds the full fragment set (fail-loud
  invariant, mirroring how other commands validate before dispatch).
- **Engine — Chamber generation:** deterministic authored assembly at the deepest depth; no
  new RNG draw for layout. Fragment spawn threads the dedicated seeded stream; the Chamber and
  fragments introduce **no new RNG streams**.
- **Save schema:** `completionType` already holds all four types; `RunConclusion` and
  `HeartLineageRecord` already exist; the conclusion is already in the save. New run state is
  limited to what the run-local no-duplicate rule needs (the set of fragment types already
  spawned/held this run) — added only if it cannot be derived from inventory; a save bump only
  if a field is added. A content bump ships the Chamber layout, fragment items, and dialogue.
- **Content:** the Chamber layout (`vault`-tagged, deepest-depth placement); the 3 fragment
  items; all ending dialogue and lore (Chamber narration, the three choice texts, the
  `broke-cycle` unlock lore, the fallback ancestral Heart, and the lineage-Heart
  presentation).
- **Client:** the Chamber choice overlay (dialog/focus conventions; `broke-cycle` gated on the
  full set); fragment display in inventory and codex. The conclusion screen already handles all
  four completion types structurally, so it simply begins receiving the new ones.
- **Determinism / demos:** a demo exercising a full endgame run (reach the Chamber and take
  each choice, including an all-fragments `broke-cycle` seed) with hash coverage;
  content-hash-embed regeneration of existing demo fixtures (standard, benign — the content
  pack gains the Chamber, fragments, and dialogue).

## Component boundaries

- **Chamber generation** (engine): given depth and the lineage store, produce the fixed floor
  and the Heart identity. Depends on the authored layout content and `currentHeart()`.
- **Ending resolution** (engine): given a choice and a run positioned in the Chamber, produce
  the conclusion (+ lineage write). Depends on the existing conclusion/`finalizeRun` pipeline.
- **Fragment lifecycle** (engine + content): spawn (seeded, deep, run-local-unique) and the
  full-set predicate. Depends on the fragment content and the item/inventory model.
- **Chamber presentation** (client): render the Chamber, the Heart, and the choice overlay;
  dispatch the choice command; gate `broke-cycle` on the projected full-set flag.

Each unit is independently testable: Chamber generation from a stub lineage store; ending
resolution from a hand-built in-Chamber run; fragment spawn/exclusion from seeded floors; the
overlay from a projected choice state.

## Testing

- **Engine:** Chamber generated at the deepest depth (and only there); the Heart identity from
  a populated vs empty lineage store (fallback). Each choice command produces the correct
  completion type, sets conclusion fields, and (for `became-heart`) writes the
  `HeartLineageRecord`; `finalizeRun` then runs and scores. `broke-cycle` rejected without the
  full set, accepted with it. The choice rejected off-Chamber and after conclusion. Fragment
  spawn determinism and run-local no-duplicate. Save round-trip of a concluded run for each
  new type.
- **Content:** the Chamber vault, fragment items, and dialogue compile; deepest-depth
  placement validates.
- **Web:** the Chamber overlay shows two choices by default and three with the full set;
  each dispatches the right command; the conclusion screen renders each new completion type.
- **Determinism:** the endgame demo verifies; existing demo fixtures regenerate to the new
  content-hash-embed values with no behavioural drift.

## Superseded

- The master design's objective ("reach the final depth, claim the Heart of the Deep, then
  climb back … and leave through the town entrance") and its escape/return outcome tiers are
  superseded by the four completion types and the conclude-at-the-Chamber model. This was
  already begun by the run-records redesign; this milestone completes it in gameplay.
- future.md's deferred "return-journey reinforcement checks and artifact hazards" are retired
  as moot — there is no return journey and nothing to carry.

## Decomposition (implementation phases)

1. Engine: Final Chamber floor generation at the deepest depth, including the lineage-Heart
   read and fallback.
2. Engine: the choice command → conclusion wiring for `became-heart` / `refused` /
   `broke-cycle`, including the `HeartLineageRecord` write and off-Chamber/after-conclusion
   rejection.
3. Engine + content: fragment items, rare deep-floor seeded spawn, run-local no-duplicate, and
   the full-set assemble gate feeding the `broke-cycle` option.
4. Content: the Chamber layout and all ending/lore dialogue (including the fallback Heart and
   lineage presentation).
5. Client: the Chamber choice overlay and fragment display; conclusion screen receives the new
   types.
6. Demo + intentional content-hash-embed regen + whole-milestone verify.
