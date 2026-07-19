# Findable Items (G5) — Design

**Status:** Design approved (brainstorm), pending spec review.
**Date:** 2026-07-19
**Milestone:** Gameplay features, sub-project A of two (G5 loot → G7 locks).

## Context

Playtest surfaced that floors feel barren: "almost no items to find." Loot infrastructure already
exists and is exercised by bosses and champion/echo populations, but ordinary monsters never drop
anything and authored vault item-slots are never filled. This sub-project makes items findable
through two independent, additive drops, both reusing the existing loot machinery. It changes no
UI: ground items already render and pickup already works.

G7 (locks, chests, lockpicking) is a separate later sub-project that builds on this one; locked
chests are only worth opening once loot exists. G7 is out of scope here.

## Scope

### In scope

1. **Monster on-death loot** — a monster may declare a loot table and a drop chance; on death it
   rolls and, on success, drops items on its tile.
2. **Vault item-slot filling** — authored vault slots of `kind: item` are filled with items during
   floor generation, from a loot table named by the slot.
3. **Content tuning** — give the early monsters modest loot tables so early floors have things to
   find (the direct fix for the sparse-items playtest note).

### Out of scope

- Locks, keys, chests, lockpicking (G7).
- Any change to the ground-item render path, pickup flow, or inventory UI — they already work.
- New loot-table mechanics beyond what the existing model supports (nested tables, depth bands,
  weights, quantity ranges all already exist).

### Explicitly unchanged

- The loot roll/expansion engine (`projectLootGraph`, `rollLootFromProjection`,
  `createFloorLootFromTable`, `createFloorItem`) — consumed as-is.
- The boss (`boss-behavior.ts`) and champion/echo (`champion.ts`) loot paths — this feature mirrors
  their pattern but does not modify them.
- Deterministic RNG streams — this feature threads existing streams, adds none.

## Decisions (from brainstorm)

| Decision | Choice |
|---|---|
| Sequencing | Two sub-projects; G5 (loot) first, then G7 (locks) |
| Monster drop model | Optional `lootTableId` + a per-monster `dropChance` (0–1) that gates whether the table rolls at all |
| Vault item-slot contents | The slot names a loot table (`lootTableId`); may instead name a single fixed item (`contentId`) |
| Chests / locks | Deferred to G7 |

## Architecture

The engine already has every primitive. This feature adds two small consumers plus the content
fields that feed them.

### (a) Monster on-death loot

**Content** — add two optional fields to `MonsterContentEntry` (`packages/content/src/model.ts`):

- `lootTableId: ContentId | null` — the table rolled on death (default `null` = never drops).
- `dropChance: number` — probability in `[0, 1]` that the table rolls at all (default `1`; only
  meaningful when `lootTableId` is set).

Mirror these in the Zod schema (`compiler/schema.ts`) and add cross-entry validation
(`compiler/content-validation.ts`): if `lootTableId` is set it must reference an existing
`loot-table` entry; `dropChance` must be within `[0, 1]`.

**Engine** — on a non-player actor's death, roll the drop. The death signal already exists: the
`targetDied` branch in `combat.ts` and the effect-kill branch in `effects.ts` emit `actor.died`.
Loot creation belongs at the same layer that owns the `rng.loot` stream and appends to run state,
exactly as the boss and champion paths do. The sequence:

1. Resolve the dead actor's `MonsterContentEntry`; if it has no `lootTableId`, do nothing.
2. Draw one roll from `run.rng.loot`; if it exceeds `dropChance`, do nothing (thread the advanced
   RNG state back regardless, so a "no drop" still advances deterministically).
3. Otherwise call `createFloorLootFromTable({ tableId, state: run.rng.loot, location: { type:'floor',
   floorId, x, y } })` at the death tile, append the produced `ItemInstance[]` to `run.items`, and
   thread the RNG state back.
4. Emit a `loot.dropped` event (actorId, contentId, tile, item count) for the message log.

Determinism rule: the drop-chance draw and the table roll both consume and re-persist
`run.rng.loot`; a monster with a table always advances the loot stream by the chance draw even when
it drops nothing, so replays stay byte-identical.

### (b) Vault item-slot filling

**Content** — extend `VaultPlacementSlot` (`packages/content/src/model.ts`) with, for `kind: item`
slots, an optional `lootTableId: ContentId | null` and an optional `contentId: ContentId | null`
(exactly one may be set; `lootTableId` rolls a table, `contentId` places one fixed item). Mirror in
the slot schema (`compiler/schema.ts:401`) and validate references + the exactly-one rule in
vault validation (`compiler/vault-validation.ts`).

**Engine** — vault `item` slots are already transformed onto floors as
`FloorPlacementSlot { kind: 'item', x, y, tags, ... }` (`vault-transform.ts` → `generate-floor.ts`)
but no code consumes them. Add an item-slot consumer beside the monster/objective consumers in
`population-placement.ts`: for each `slot.kind === 'item'`, resolve the originating vault slot's
`lootTableId`/`contentId`, create the item(s) at the slot's `x, y` via `createFloorLootFromTable`
(table) or `createFloorItem` (fixed), and add them to `createdItems` (already merged into
`run.items` downstream). These fills happen at floor-generation time and thread the floor-generation
RNG stream the sibling consumers use — not `run.rng.loot`, which is reserved for runtime combat
drops — so generation stays a pure function of the floor seed.

### Content tuning

Author small `loot-table` entries appropriate to the early roster and wire them to the existing
early monsters (cave-rat, training-beetle, and the early-population set) with modest `dropChance`
values, so an early floor yields a few items without burying the player. Fill the existing
lampwright-cache vault item slot via its `lootTableId`. Values are tuning, chosen in the plan.

## Data flow

```
Monster death:  combat/effects → actor.died → resolve monster.lootTableId
                  → roll dropChance on rng.loot → [pass] createFloorLootFromTable(rng.loot)
                  → append to run.items → loot.dropped event
Vault item slot: floor generation → FloorPlacementSlot(kind:item)
                  → item-slot consumer → createFloorLootFromTable / createFloorItem (gen RNG)
                  → createdItems → run.items
```

Both endpoints produce ordinary floor `ItemInstance`s; the existing render and pickup paths take it
from there.

## Error handling

- Unknown `lootTableId`/`contentId` on a monster or vault slot is a **compile-time** content
  validation error (fail loudly at pack build, consistent with existing loot validation).
- `dropChance` outside `[0, 1]` is a compile-time validation error.
- A vault `item` slot with neither `lootTableId` nor `contentId`, or with both, is a compile-time
  validation error.
- At runtime, a monster with no `lootTableId` simply never rolls; there is no silent fallback item.

## Testing strategy

Both drops must be pinned as **observable behavior** so later refactors can't regress them.

- **Content** (`packages/content/test`): a monster with `lootTableId` + `dropChance` parses,
  validates, and compiles; a vault `item` slot with `lootTableId` (and the `contentId` variant)
  compiles; unknown table reference, out-of-range `dropChance`, and the neither/both slot cases are
  each rejected with a clear error.
- **Engine — monster loot** (`packages/engine/test`): `dropChance: 0` drops nothing but still
  advances `rng.loot`; `dropChance: 1` drops the table's result at the death tile, appended to
  `run.items` with a `{type:'floor'}` location; the same seed replays byte-identically across a
  save boundary (extend the existing replay/hash coverage); a `loot.dropped` event is emitted.
- **Engine — vault slots** (`packages/engine/test`): a generated floor whose vault has an `item`
  slot places the slot's item(s) at the slot coordinates; generation is a pure function of the floor
  seed (identical seed → identical placement).
- **No web tests** — no client surface changes. A quick manual playtest confirms drops appear and
  are pickup-able.

## Execution

Subagent-driven: fresh implementer per task, per-task review (spec + quality), whole-branch review,
PR. Isolated worktree/branch (`feat/findable-items-g5`).
