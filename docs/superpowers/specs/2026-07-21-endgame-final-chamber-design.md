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

- **`died`** — already produced when hero health reaches zero (during ordinary play or the
  Heart boss fight below has its own override); unchanged for ordinary deaths.
- **`became-heart`** — the hero takes the bound Heart's place. Writes a `HeartLineageRecord`
  (hero name, class tags, Hall record id, enrichment) via `recordHeart`, making this hero the
  `currentHeart()` a future run will meet. Second tier. **Reachable two ways, mechanically
  identical, narrated differently:** *voluntarily* (choosing "Become the Heart"), or
  *involuntarily* (losing the Heart boss fight — see the refused branch).
- **`refused`** — the hero turns away, which **angers the weakened Heart into breaking loose
  and attacking** (a boss fight, below). Winning that fight *is* the `refused` conclusion: the
  heartless Deep crumbles, its prisoners are released, and the hero escapes amid the
  destruction (a narrative epilogue). Lowest of the three non-death endings by Hall tier,
  though winning the boss earns boss-defeat score.
- **`broke-cycle`** — offered only when the hero carries the full fragment set. The hero
  assembles the Ancient Tablet, frees the Heart, and ends the cycle. Top tier. Instant (no
  fight).

The instant conclusions (voluntary `became-heart`, `broke-cycle`) set `ActiveRun.conclusion`
exactly as `died` does (completion type, depth, turn, worldTime; `killerContentId` null) and
consume no randomness. The `refused` branch resolves through combat (below) before setting its
conclusion. In all cases the run is then read-only and `finalizeRun` proceeds unchanged.

## The refused branch: the Heart boss fight

Choosing "Turn away" does not end the run immediately. The weakened Heart, enraged at not
being freed, breaks loose and attacks — a boss fight using the existing combat/boss framework.
The Heart is an authored boss entry, tuned **challenging but not too hard** (the fiction is
that it is weakened; difficulty is config-driven), thematically the lineage predecessor turned
hostile (flavored with their name where available). Two resolutions:

- **Hero wins (Heart defeated)** → `refused`. The Deep, now without a Heart, begins to
  crumble; every prisoner it held is released into the world; the hero escapes with them and
  witnesses the destruction. Delivered as an authored **narrative epilogue** (conclusion-screen
  / dialogue text) — the run concludes at the Chamber, no playable escape. Boss-defeat scoring
  credits the kill.
- **Hero loses (would reach zero health during this fight)** → `became-heart` (**forced**).
  The Heart forcibly replaces itself with the hero, imprisoning them as the new Heart against
  their will. This **overrides the normal health-zero → `died` transition**: while the Heart
  boss is the active threat, a would-be-fatal blow to the hero resolves as forced
  `became-heart` (writing the `HeartLineageRecord`), not `died`. Narrated as involuntary.

The override is scoped strictly to the Heart boss fight (a Chamber/boss-state flag); ordinary
deaths anywhere else remain `died`. The boss fight consumes combat randomness normally; the
outcome that sets the conclusion consumes none beyond the fight itself.

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
  dialog/focus conventions). Two options are always available — **Become the Heart** (instant
  `became-heart`) and **Turn away** (starts the Heart boss fight, above) — plus a third,
  **Assemble the tablet & free the Heart** (instant `broke-cycle`), present only when the hero
  holds all fragments and carrying its own unlock lore.

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
  carrying the chosen ending. Rejected off the Chamber floor and after conclusion
  (`run.concluded`).
  - *Voluntary `became-heart`* and *`broke-cycle`* set `conclusion.completionType` immediately
    (records depth/turn/worldTime like `died`; `killerContentId` null), write the
    `HeartLineageRecord` on `became-heart`, and consume no randomness. `broke-cycle` is rejected
    unless the hero holds the full fragment set (fail-loud invariant).
  - *Turn away* does not conclude the run; it activates the Heart boss (converts the bound-Heart
    entity into a hostile boss actor). Combat then proceeds through the existing systems. The
    **conclusion is set on fight resolution:** boss defeated → `refused`; hero would-die while
    the Heart boss is active → forced `became-heart` (writes the lineage record). The
    death-transition override is gated on the Heart-boss-active flag and scoped to the Chamber.
- **Engine — the Heart boss:** an authored boss reusing the existing boss/combat framework;
  no bespoke combat engine. Its only special behavior is the defeat-override above.
- **Engine — Chamber generation:** deterministic authored assembly at the deepest depth; no
  new RNG draw for layout. Fragment spawn threads the dedicated seeded stream; the Chamber and
  fragments introduce **no new RNG streams**.
- **Save schema:** `completionType` already holds all four types; `RunConclusion` and
  `HeartLineageRecord` already exist; the conclusion is already in the save. New run state is
  limited to what the run-local no-duplicate rule needs (the set of fragment types already
  spawned/held this run) — added only if it cannot be derived from inventory; a save bump only
  if a field is added. A content bump ships the Chamber layout, fragment items, and dialogue.
- **Content:** the Chamber layout (`vault`-tagged, deepest-depth placement); the **Heart boss
  entry** (weakened, tuned; flavored with the predecessor's name where available); the 3
  fragment items; all ending dialogue and lore (Chamber narration, the three choice texts, the
  `broke-cycle` unlock lore, the **refused-win crumbling-Deep escape epilogue**, the
  **forced-`became-heart` involuntary narration**, the fallback ancestral Heart, and the
  lineage-Heart presentation).
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
  a populated vs empty lineage store (fallback). Voluntary `became-heart` and `broke-cycle`
  produce the correct completion type, set conclusion fields, and (for `became-heart`) write
  the `HeartLineageRecord`; `finalizeRun` then runs and scores. `broke-cycle` rejected without
  the full set, accepted with it. The choice rejected off-Chamber and after conclusion.
  **Refused boss fight:** choosing Turn away activates the Heart boss; defeating it produces
  `refused`; the hero being reduced to zero health during the fight produces forced
  `became-heart` (with the lineage write), *not* `died`; an ordinary death elsewhere still
  produces `died` (override correctly scoped). Fragment spawn determinism and run-local
  no-duplicate. Save round-trip of a concluded run for each of the four types.
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
2. Engine: the choice command — instant conclusions for voluntary `became-heart` and
   `broke-cycle` (with the `HeartLineageRecord` write), plus off-Chamber/after-conclusion
   rejection and the fragment-set gate on `broke-cycle`.
3. Engine + content: the refused branch — the Heart boss (authored, weakened, reusing the
   boss/combat framework), its activation on Turn away, and the resolution wiring (defeat →
   `refused`; hero-would-die → forced `became-heart` via the scoped death-transition override).
4. Engine + content: fragment items, rare deep-floor seeded spawn, run-local no-duplicate, and
   the full-set assemble gate feeding the `broke-cycle` option.
5. Content: the Chamber layout and all ending/lore/epilogue dialogue (choice texts, refused-win
   escape epilogue, forced-became-heart narration, fallback Heart, lineage presentation).
6. Client: the Chamber choice overlay and fragment display; the boss fight uses the existing
   combat UI; the conclusion screen receives the new types and epilogue text.
7. Demo + intentional content-hash-embed regen + whole-milestone verify.
