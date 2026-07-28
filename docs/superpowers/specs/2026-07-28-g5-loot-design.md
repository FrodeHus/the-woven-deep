# G5 Loot — Design

**Date:** 2026-07-28
**Status:** Approved pending user review
**Issue:** #110 (also retires the stream-coupling note from the #113 review and the density
observation from the #125 review)

## Summary

Make generated floors worth looting. Approach A: a dedicated `placeFloorLoot` generation pass
scatters a scarce, depth-banded set of items, chests, gold piles, and occasional locked doors
onto every dungeon floor, drawing from a new dedicated `loot-placement` RNG stream; the
encounter budget scales with floor area. Nearly all resolution machinery already exists (monster
drops, chest/lock mechanics, loot tables, pickup) — this design adds placement, content, and two
debt fixes (stream coupling, `minDepth` enforcement).

## Decisions (user-confirmed)

1. **Loot feel: scarce & meaningful** — 2–4 scattered finds per floor; each matters. No steady
   drip, no hoard economy.
2. **Gold drops** — small currency piles on floors, in chests, and via loot-table choices; the
   merchant economy is no longer sell-to-earn only.
3. **Chests uncommon, generic keys + picks** — 0–2 chests per floor (some floors none), roughly
   half locked; iron keys are rare finds that open any lock (consumed); lockpicks findable and
   purchasable. Locked doors occasionally guard side areas.
4. **Density scales with floor area** — encounter budget ≈ one group per ~800 open cells
   (tunable), replacing the fixed count that left 160×50 floors feeling empty.

## Content

- **Floor-scatter tables** (new, 3): `loot-table.floor-scatter-shallow` (promotes the orphaned
  `early-provisions` table: rations, potions, lamp oil, lockpicks, cloth wrap, minor scrolls,
  small gold), `-mid`, `-deep` (better consumables, scrolls/tomes, keys, larger gold, rare gear).
  Depth bands select the table; per-choice `minDepth` still applies within tables.
- **Chest-tier tables** (new, per depth band): richer than scatter — gear, tomes, keys, gold.
- **Keys and picks sourced:** `item.iron-key` becomes a rare choice in mid/deep scatter and
  chest tables; `item.lockpick` joins shallow scatter and the town provisioner's stock table.
- **Currency loot choices** *(amended 2026-07-28, planning)*: gold is modeled as an ordinary
  item `item.gold-coins` with a new item category `currency`; amounts use the existing
  per-choice `minimumQuantity`/`maximumQuantity` roll (integers, checked arithmetic), so the
  loot-choice schema is unchanged and gold pile ranges live in the loot tables, not balance.
  Content schema bump v7→v8 (new category value) with migration notes in
  `docs/server-admin/content-configuration.md`.
- **Balance knobs** (all in `content/balance/`, no engine constants): scatter count range
  (2–4), chest count range (0–2), locked-chest ratio (integer percent, ~50), chest lock
  difficulty by depth band (shared by locked doors), locked-door probability per eligible door
  tile (integer percent), minimum placement distances (from spawn, stairs, and each other),
  depth-band thresholds, encounter-density divisor (open cells per encounter group).

## Engine

### `placeFloorLoot` pass

Runs during floor generation after population placement, pure `(floor, run, content) →
{ floor', items, features, nextLootPlacementState }`:

1. **Item scatter:** roll count (2–4), pick walkable cells honoring constraints — ≥N tiles from
   spawn and stairs, not on `protectedRouteIndexes`, minimum spread between placements, never
   inside vault interiors unless the vault authors a slot. Each item rolls from the floor's
   depth-band scatter table via the existing `createFloorLootFromTable`.
2. **Chests:** roll count (0–2); place as `ChestFeature`s (existing model) with the same cell
   constraints plus wall-adjacency preference (chests read as placed, not dropped); locked at
   the balance ratio with difficulty from the depth band; loot pointer to the chest-tier table,
   materialized on open by the existing `materialiseChestLoot`.
3. **Locked doors** *(amended 2026-07-28, planning)*: for each existing `terrain.door` tile
   NOT on a protected route, roll the balance probability; on success create a locked
   `DoorFeature` (existing model — key auto-unlock and `d20 + disarm` picking already resolve
   it). Carving new locks into 1-wide open passages is deferred: a `DoorFeature`'s
   `coverTileId`/render contract expects a door tile. A locked door must never make the stairs
   or a required objective unreachable — the protected-route exclusion guarantees it
   structurally.
4. **Gold piles:** part of the scatter roll via `currency` choices; placed as ground items of a
   new `currency` item category carrying an integer amount.

### Currency pickup

Ground currency items are picked up via the existing `pickup` intent; resolution adds the amount
to `hero.currency` (checked integers), consumes no backpack slot, and emits a dedicated
`currency.collected` event (log: "You gather N gold.") instead of `item.picked-up`, so the
`itemsCollected` metric never counts coins. Run-record `currencyEarned` aggregates include it.

### RNG stream

New `loot-placement` stream: `RNG_STREAM_NAMES` + discriminator addition, `deriveRngStreams`
extension, save-schema bump v11→v12 with exactly one ordered migration (derives the stream for
existing saves; all other fields unchanged). `placeFloorLoot` draws exclusively from it.
`fillItemSlots` and `placeFragmentSpawn` migrate off the `encounters` stream onto it — encounter
placement changes can never again re-roll loot (the #113 cascade class is retired).

### Density

`chooseEncounter`'s budget derives from the floor's open-cell count divided by the balance
divisor (target ≈800 open cells per group ≙ ~15–25 monsters on a 160×50 floor), clamped to
sane bounds; small floors keep small populations. Deterministic from floor data.

### Bug fix: depth bands

Every `projectLootGraph` call site passes `depth` (monster drops, vault slots, chests, scatter).
Authored `minDepth`/`maxDepth` on loot choices is enforced everywhere; merchant stock behavior
is unchanged (it already passed depth).

## Client

- Ground currency renders with the existing `GOLD-COINS` atlas sprite (shipped, unreferenced
  until now); pickup produces the standard log line. Amount is not shown until picked up.
- Chest features render with the tile sheet's `waresCrate` sprite (currently a reserved contract
  key) instead of the `▣` glyph; the glyph remains the fallback. Dedicated chest art is a future
  generation task, not part of G5.
- Locked doors already render as the gate sprite; open/closed doors as door/arch. No FeatureView
  changes: lock state already surfaces, lock difficulty deliberately stays hidden.
- No HUD/overlay changes.

## Determinism & testing

- Pure unit tests: scatter constraint satisfaction and determinism per seed; chest count/locked
  ratio distributions over fixed seed sets; chokepoint-door legality (never on protected routes;
  stairs always reachable — assert with the existing route checker); `minDepth` enforcement (a
  depth-15 relic cannot roll at depth 1); currency arithmetic (checked, no floats); density
  scaling across floor sizes (small/large fixtures).
- Stream isolation regression test: replaying a placement-logic perturbation (the #113 scenario)
  leaves loot rolls byte-identical.
- Save migration test: v11 → v12 round-trip; replay equality after migration.
- Demo hashes: all population/gameplay-affected fixtures re-pin once, each delta inspected and
  explained per fixture in the commit body (placement now also seeds loot; intentional).
- End-feel probe (not committed): 5-seed sweep asserting 2–4 items, 0–2 chests, spread
  monsters per floor.

## Out of scope

Cursed items (#121), value-budgeted floor economics, chest sprite art generation, tunneling
treasure hooks (#114), legendary artifacts (#124), key-specific authored locks (engine supports
`keyContentId`; content stays generic-key for G5).
