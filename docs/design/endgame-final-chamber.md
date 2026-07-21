# Endgame: Final Chamber & Endings

The descent's payoff and the game's completion layer. The run-records milestone built the
finalization pipeline, scoring, Hall sort order, and the Heart lineage store; only `died` was
producible. This milestone adds the Final Chamber and the choices that produce the other three
completion types, wiring triggers into that existing pipeline. Full design of record:
`docs/superpowers/specs/2026-07-21-endgame-final-chamber-design.md`.

## Premise

The Deep is anchored by a living person — the Heart of the Deep — bound at its center; it
holds together only while someone is bound. The Heart is a person, not an artifact, so a run
concludes **at** the Final Chamber (no climb back, no escape). The cycle is endless
succession: whoever takes the Heart's place frees the previous Heart and binds themselves, so
the next hero meets that predecessor. The lineage store already models this.

## The four endings

`died` (die anywhere) is unchanged. At the Final Chamber the hero makes one choice:

- **Become the Heart → `became-heart`** — take the bound Heart's place; writes a
  `HeartLineageRecord` so this hero becomes the Heart a future run meets. Instant. Second tier.
- **Turn away → the Heart boss fight.** Refusing enrages the weakened Heart, which breaks loose
  and attacks (a boss fight, existing combat framework, tuned challenging-but-not-too-hard).
  **Win → `refused`:** the heartless Deep crumbles, its prisoners are freed, and the hero
  escapes amid the destruction (narrative epilogue; concludes at the Chamber). **Lose → forced
  `became-heart`:** the Heart forcibly makes the hero the new Heart against their will —
  overriding the normal health-zero → `died` transition while the Heart boss is active, and
  writing the lineage record.
- **Assemble the tablet & free the Heart → `broke-cycle`** — offered only with the full
  fragment set; end the cycle peacefully. Instant. Top tier.

`became-heart` is thus reachable voluntarily (the choice) or involuntarily (losing the boss) —
mechanically identical, narrated differently. Instant conclusions consume no randomness; the
refused fight consumes combat randomness. Every ending then runs the existing `finalizeRun`.
Hall tier order is unchanged (`broke-cycle` > `became-heart` > `refused` > `died`); winning the
boss is additionally rewarded via boss-defeat score.

## The Final Chamber

Reaching the deepest depth (20, tunable) generates a fixed authored floor (the `generateTownFloor`
precedent — a `vault`-tagged layout, not procedural). The bound Heart is read from the lineage
store's `currentHeart()` — your `became-heart` predecessor, by name and class — with an authored
nameless "ancestral Heart" fallback when nothing is stored. The choice is an inline authored
dialogue/decision overlay; `broke-cycle` appears only when the full fragment set is carried.

## The Ancient Tablet fragments

Scoped here to **single-run** collection (Part A):

- **3 fragment items** (tunable count), special, non-stackable, distinct ids.
- Placed by a **rare seeded roll on deep floors** (depth ≥ 15, tunable) from a dedicated
  deterministic stream; each type distinct; a type already held this run won't respawn
  (run-local no-duplicate). A full set in one run is intentionally rare.
- Holding all fragments at the Chamber unlocks `broke-cycle`. No house/account store is involved
  in Part A.

**Deferred to server progression (6C) — "Part B":** an account-level (profile) fragment store,
promoted by depositing a fragment in the house, granting collected fragments into future heroes,
cross-run spawn-exclusion, and the registration incentive (guests accumulate nothing across
runs, so their only path is a single-run full set). Part B layers on without reworking Part A.
See [[locks-and-lockpicking]] and [[light-out-feats]] for the same content-hash-embed regen
discipline.

## Determinism & data

The choice command and Chamber generation add no new RNG streams; fragment spawn threads a
dedicated seeded stream. `completionType`, `RunConclusion`, and `HeartLineageRecord` already
exist in the save; new run state is limited to run-local fragment tracking (added only if not
derivable from inventory). Ships a content bump (Chamber layout, fragment items, dialogue) and
regenerates the content-hash-embed demo fixtures (benign — no behavioural drift).

## Supersedes

The master design's escape/return objective and outcome tiers, and future.md's deferred
return-journey reinforcement checks and artifact hazards — all moot under the Heart-as-person,
conclude-at-the-Chamber model.
