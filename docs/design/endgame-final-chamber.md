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

The tablet is assembled **across runs**:

- **3 fragment items** (tunable count), special, non-stackable, distinct ids.
- Placed by a **rare seeded roll on deep floors** (depth ≥ 15, tunable) from a dedicated
  deterministic stream; each type distinct; a type already held this run won't respawn
  (run-local no-duplicate), and neither will one already banked by an earlier run.
- Every fragment the hero holds when a run concludes — including on death — is banked in
  `LifetimeState.collectedFragmentIds` by `finalizeRun`'s lifetime deltas. A fragment sold,
  dropped, or never picked up banks nothing.
- At the Chamber, `canAssembleTablet` unlocks `broke-cycle` when each fragment is either carried
  now or already banked. Three runs that each turn up one fragment are enough; a full set in a
  single dive stays vanishingly rare and is no longer the only path.
- Both hosts persist this the same way: the guest client's session-storage Hall merges the delta
  itself, and the server replays its stored delta history (`hall_state.lifetime_json`) through the
  engine repository, so neither needs bespoke merge math. Guests bank fragments too — their Hall
  simply lives in `sessionStorage` and does not roam.

There is no house deposit ritual: a fragment found on the run where the hero dies at depth 18 is
exactly the run this progression is meant to reward.

See [[locks-and-lockpicking]] and [[light-out-feats]] for the same content-hash-embed regen
discipline.

## Determinism & data

The choice command and Chamber generation add no new RNG streams; fragment spawn threads a
dedicated seeded stream. `completionType`, `RunConclusion`, and `HeartLineageRecord` already
exist in the save. `ActiveRun.collectedFragmentIds` — the run's snapshot of the banked set, fixed
at creation and never mutated mid-run — is a save-schema bump (v18) with an ordered migration
defaulting it empty; every existing save, Hall blob, and pinned demo replay is therefore
byte-identical across the change. Excluding a banked fragment from the spawn pool consumes no
randomness of its own.

## Supersedes

The master design's escape/return objective and outcome tiers, and future.md's deferred
return-journey reinforcement checks and artifact hazards — all moot under the Heart-as-person,
conclude-at-the-Chamber model.
