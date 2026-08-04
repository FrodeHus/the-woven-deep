# Loot Coverage and the Torch Curve — Design

**Source:** user request, 2026-08-04 ("update loot tables to include recently added items — also increase chance for finding torches strewn across the floor; more in the early levels and then more and more scarce deeper it goes"). **Date:** 2026-08-04. **Status:** approved, not yet implemented.

Two independent content changes that share a blast radius (both edit `content/loot-tables/`, both move `contentHash`), so they ship together rather than as two re-pin rounds.

## Goal

1. Close the loot-coverage gap: seven spell tomes exist in the content pack but cannot be obtained by any means.
2. Make floor torches noticeably more common in the shallow band, a rarity in mid, and absent in deep — so light supply shifts from scavenged torches to lantern logistics as the run deepens.

## Measurement

Every `item.*` id declared under `content/items/` was compared against every `item.*` referenced from `content/loot-tables/`, at `origin/main` (`0f9a30db`). Twenty-one ids are unreferenced. Fourteen are placed by a different system and are correctly absent from loot tables:

| Item group | Placement system |
| --- | --- |
| `bound-signet`, `marias-grace`, `thread-counts-needle`, `last-cartographers-compass`, `champion-fallback-relic` | artifact singleton circulation |
| `ashfather-cinder`, `heart-cinder`, `warden-ember`, `tide-crown`, `herald-sigil`, `echo-heartstone` | encounter reward tables (`content/encounters/`) |
| `tablet-fragment.a`, `.b`, `.c` | `packages/engine/src/final-chamber-fragments.ts` |

The remaining **seven are genuinely unobtainable** — no loot table, no vault, no encounter, no champion drop, no merchant:

| Tome | Rarity | Price | Item `minDepth` | Teaches |
| --- | --- | --- | --- | --- |
| `chain-spark-tome` | uncommon | 40 | 1 | `spell.chain-spark` |
| `weave-shield-tome` | uncommon | 35 | 1 | `spell.weave-shield` |
| `enervate-tome` | uncommon | 45 | 2 | `spell.enervate` |
| `arc-lance-tome` | rare | 55 | 3 | `spell.arc-lance` |
| `cinder-breath-tome` | rare | 55 | 3 | `spell.cinder-breath` |
| `fireball-tome` | rare | 60 | 3 | `spell.fireball` |
| `frost-nova-tome` | rare | 60 | 3 | `spell.frost-nova` |

Each carries `effect.spell.learn` and a price, so each was authored as reachable content. They have been dead since 2026-07-23. The four potions added by #225 are already fully placed across all six scatter and chest tables and need no work.

Torch supply, same revision. `item.pitch-torch` appears in exactly two tables:

| Table | Band | `pitch-torch` weight | Table total | Share |
| --- | --- | --- | --- | --- |
| `floor-scatter-shallow` | d1–6 | 3 | 33 | 9.1% |
| `chest-shallow` | d1–6 | 3 | 26 | 11.5% |
| `floor-scatter-mid` | d7–13 | — | 35 | 0% |
| `floor-scatter-deep` | d14–20 | — | 33 | 0% |

"Scarcer deeper" is therefore already true in the extreme — torches simply stop existing past depth 6. The real work is raising the shallow rate and deciding whether mid gets a trickle.

## The depth-filtering constraint

`resolveLootChoices` (`packages/engine/src/inventory.ts:109-110`) prunes on the **choice-level** `minDepth`/`maxDepth` only:

```ts
if (choice.minDepth !== undefined && depth < choice.minDepth) return false;
if (choice.maxDepth !== undefined && depth > choice.maxDepth) return false;
```

An item's own `minDepth`/`maxDepth` is **not** consulted for chest or scatter rolls. Only merchant stock honours it (`packages/engine/src/merchant-stock.ts:87`, `:231`). So a `minDepth: 3` tome placed in `chest-shallow` would drop at depth 1 with nothing to stop it.

This design avoids the trap by construction rather than by guard: every tome is placed only in bands whose lowest depth already clears the tome's own minimum. Because that safety is implicit, it is pinned by a test (see Testing) instead of left to inspection.

## Design — tome placement

Tomes are chest-or-vendor loot and never floor scatter. That rule is already established by the three placed tomes (`mend-tome` in `chest-mid`; `rime-ward-tome` and `static-field-tome` in `chest-deep`) and this design keeps it: a permanent spell-learn is a container reward, not something underfoot.

All new entries use `weight: 1`, matching every tome already placed, and `minimumQuantity: 1, maximumQuantity: 1`.

### Chests — the found path

| Table | Band | Tomes added | Tome share after |
| --- | --- | --- | --- |
| `chest-shallow` | d1–6 | `chain-spark-tome`, `weave-shield-tome` | 0% → 7.1% |
| `chest-mid` | d7–13 | `enervate-tome`, `arc-lance-tome`, `cinder-breath-tome` | 4.5% → 16.0% |
| `chest-deep` | d14–20 | `fireball-tome`, `frost-nova-tome` | 8.0% → 14.8% |

Both shallow entries have item `minDepth: 1`, so no choice-level guard is required. The mid and deep bands begin at depth 7 and 14, clearing the `minDepth: 2` and `minDepth: 3` tomes with room to spare.

The four rare `minDepth: 3` tomes are split mid-heavy rather than deep-heavy on purpose. A permanent spell-learn taken at depth 7 pays out across the remaining thirteen floors; the same tome at depth 16 has four floors to earn itself back. Loading them into deep would also push the deep chest past a fifth tome, which is more spellbook than treasure.

### Spell vendor — the bought path

`loot-table.town-spellvendor-stock` offers 5 choices for 3 rolls, which is thin enough that its restock milestones barely change what is on the shelf. Two additions widen it and give late-run gold a destination:

| Choice | Weight | Band guard |
| --- | --- | --- |
| `chain-spark-tome` | 2 | base (no guard) |
| `fireball-tome` | 1 | `minDepth: 8` |

`fireball-tome` carries an explicit choice-level `minDepth: 8`, placing it a milestone above the existing `fireball-scroll` (`minDepth: 5`) and below `aegis-tome` (`minDepth: 10`). This is the one place a choice-level guard is load-bearing, because merchant depth is the run's deepest reached depth rather than a band floor.

Both tomes are consequently obtainable two ways, found or bought; the other five are found-only.

## Design — torch curve

Floor scatter only. `chest-shallow`'s torch entry (weight 3) is left alone: the request concerned torches strewn across the floor, and #196 tuned that chest entry deliberately as early-crunch relief.

| Table | Band | Weight | Share | Expected torches/floor |
| --- | --- | --- | --- | --- |
| `floor-scatter-shallow` | d1–6 | 3 → **7** | 9.1% → 18.9% | 0.27 → **0.57** |
| `floor-scatter-mid` | d7–13 | — → **2** | 0% → 5.4% | 0 → **0.16** |
| `floor-scatter-deep` | d14–20 | unchanged | 0% | 0 |

Expected-per-floor multiplies the share by the mean of `floorLoot.scatterCount` (`content/balance/core-gameplay.yaml`: minimum 2, maximum 4, mean 3). Shallow roughly doubles — a floor torch about every other floor becomes about one per floor. Mid yields roughly one torch across the whole seven-floor band: a welcome find, never a supply line. Deep stays torchless.

`maximumQuantity` stays at 1 in both entries because `item.pitch-torch` declares `stackLimit: 1`.

### Relationship to #196

PR #196 ("light pressure runs forwards") set the standing rule that deep fuel is a logistics question: `floor-scatter-deep` and `chest-deep` carry lamp oil for the brass lantern, never torches, and the Travelling Lampwright covers the full depth range as the dedicated supply. This design does not touch that rule. It steepens the ramp *into* it — the shallow band now hands out enough torches that the hero reaches the mid band with the habit of burning them, at which point the supply thins and the lantern becomes the answer. The curve the request asked for is the curve #196 already implied; it was simply a cliff at depth 6 rather than a slope.

## Non-goals

- **No balance-schema change.** `weight`, `minDepth`, `minimumQuantity` are existing loot-choice fields. Content stays at schema v14, no save-schema bump, no migration.
- **No new items, spells, or effects.** Every id placed here already exists.
- **No `floorLoot.scatterCount` change.** Pile count stays 2–4 at every depth; the depth curve is expressed purely through per-band weights. Raising the pile count would inflate every item in the table, not torches.
- **No general weight audit.** Anomalies elsewhere (for instance `sundering-scroll` and `tempering-steel-scroll` at weight 1 in deep scatter only) are out of scope and left as-is.
- **No change to `chest-shallow`'s torch entry.**

## Testing

RED-first, in this order. All three are pure invariants of the compiled pack — they need no engine state, no run, and no RNG — so all three live in `packages/content/test/`, following the `potion-risk.test.ts` idiom of compiling `content/` and asserting over `pack.entries`. Keeping them out of `packages/engine` also keeps them off the dist-rebuild treadmill described in CLAUDE.md.

1. **Coverage tripwire** — `packages/content/test/loot-coverage.test.ts`. Assert every `item.*` id in the compiled pack is either referenced by some loot table with `weight > 0` or present in an explicit allowlist of items placed by another system (the fourteen tabulated above, named individually with the system that places each). Fails today on the seven tomes. This is the regression guard: the next item added without a home fails the build rather than sitting dead for a fortnight.
2. **Depth-safety pin** — same file. For each of the six band tables (`loot-table.floor-scatter-<band>`, `loot-table.chest-<band>`), compute the lowest depth that band can roll at (`shallow` → 1, `mid` → `shallowMaxDepth + 1`, `deep` → `midMaxDepth + 1`, mirroring `validateRequiredFloorLootTables`' own `representativeDepth`) and assert no choice offers an item whose `minDepth` exceeds the lowest depth that choice is reachable at, accounting for any choice-level `minDepth`. This converts the implicit safety argument above into an enforced one, and would catch a future tome dropped into the wrong band even though `inventory.ts` will not. Town tables are deliberately out of scope: merchant stock enforces item-level bounds itself.
3. **Torch curve pin** — `packages/content/test/torch-curve.test.ts`. Assert the `pitch-torch` weight share across the three scatter tables is strictly decreasing shallow → mid → deep, and that deep is exactly zero. Pins the shape of the curve rather than the literal numbers, so retuning weights stays cheap while reversing the curve does not.

`packages/content/test/default-content.test.ts` pins per-kind entry counts (`item: 58`, `loot-table: 28`). This change adds no items and no tables, so those counts must remain untouched — if either moves, something unintended was added.

### Expected fixture fallout

Both changes edit compiled content, so `contentHash` moves and the demo hash fixtures move with it. Seven fixtures exist (`dungeon`, `endgame`, `gameplay`, `magic`, `merchant`, `population`, `run-records`); #196 moved six of them and documented the resulting pattern: hashes that embed the save (which encodes `contentHash`) and hashes that embed the `deriveHallRecordId(seed, contentHash)` Hall record ID shift, while event, projection, records, and standings hashes stay byte-identical.

Per CLAUDE.md, a drifted hash is never re-pinned over an unexplained change. The procedure is: rebuild both dists (`content` then `engine` — workspace-scoped vitest does not rebuild them, and a stale dist produces green misattributions, as #196's own transcript records), then diff full demo transcripts rather than `--verify` hash-only output, and confirm every moved component traces to `contentHash` propagation. Any component that moves for another reason is a STOP — the tables edited here *are* read by table-draw fixtures, unlike #196's, so a genuine draw shift is plausible and must be explained rather than absorbed.

Re-pinning has no `--update` flag. `--verify` is the demo scripts' only argument; running a script without it writes a candidate hashes file and prints `candidate hashes written <path>`, which is then copied over the reviewed fixture.

## Files touched

- `content/loot-tables/floor-scatter-shallow.yaml` — torch weight 3 → 7
- `content/loot-tables/floor-scatter-mid.yaml` — add `pitch-torch` w2
- `content/loot-tables/chest-shallow.yaml` — add `chain-spark-tome`, `weave-shield-tome`
- `content/loot-tables/chest-mid.yaml` — add `enervate-tome`, `arc-lance-tome`, `cinder-breath-tome`
- `content/loot-tables/chest-deep.yaml` — add `fireball-tome`, `frost-nova-tome`
- `content/loot-tables/town-spellvendor.yaml` — add `chain-spark-tome` w2, `fireball-tome` w1 `minDepth: 8`
- `packages/content/test/loot-coverage.test.ts` (new) — coverage tripwire and depth-safety pin
- `packages/content/test/torch-curve.test.ts` (new) — torch curve shape pin
- `packages/engine/test/fixtures/*-demo-hashes.json` — re-pin after transcript verification
