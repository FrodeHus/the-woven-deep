# Locks & Lockpicking (G7) Implementation Plan

> **For agentic workers:** execute task-by-task with Subagent-Driven Development. Each task ends with an independently testable deliverable and its own tests. Steps use `- [ ]`.

**Goal:** Vault-authored locked doors and locked chests, opened by a lockpick skill check (`d20 + disarm` vs per-instance difficulty); ordinary failure consumes a stackable lockpick, a natural-1 permanently jams a chest; optional keys open doors without a check. Build the missing production feature spawner this depends on.

**Architecture:** Content authors locked door/chest slots in vault legends (with `difficulty`, optional `keyContentId`, loot). A new production spawner converts those slots into `DungeonFeature` instances in `run.features`. A `pickLock` engine function mirrors `disarmTrap` on the `effects` RNG stream. A greenfield client `pick-lock` action drives it. Persistence via the drift-guarded `feature` save-schema union.

**Tech Stack:** TypeScript strict monorepo; content (YAML→Zod), engine (deterministic seeded RNG), web (React session layer). See `docs/design/locks-and-lockpicking.md` for the full design.

## Global Constraints

- **Determinism is sacred.** Lock check draws from `run.rng.effects` (like `disarmTrap`); loot from `run.rng.loot`; spawner placement from `run.rng.encounters` if it rolls. No new RNG stream, no `Math.random`/`Date.now`. Behaviour-changing demo-hash regen is allowed ONLY where locked demo content is intentionally added — regenerate the affected fixture and eyeball the diff; never regen to hide an unintended change.
- **No history/lineage comments.** Present-tense only.
- **Build gate (vitest does not typecheck):** content build → engine build → `tsc` web → `tsc` server → the four demo replays touched → vitest suites → `npm run lint` (0 errors) → `npm run format:check` → `npm run knip` → `npm run depcruise`. The whole gate is `npm run verify` + the demo replays.
- **Single-source closed vocabularies** (`as const` array → type + `z.enum`). **No `any`/lying casts.** **Discriminated unions + exhaustive switch.**
- **Fail loud.** Bad difficulty / unresolved key or loot id is a `ContentCompileError`. Engine invariants (already validated in `actions.ts`) `throw` in `features.ts`.
- **Vault-only, never on a required path.** Locked doors always have a guaranteed alternative; locked chests are optional.

---

### Task 1: Content model + schema for locks (content package)

**Files:** `packages/content/src/model/vault.ts`, `packages/content/src/model/item.ts` (if a category/tag is needed), `packages/content/src/compiler/schema/vault.ts`, `packages/content/src/compiler/validation/vault-tags.ts` (or the vault validation module), plus tests in `packages/content/test/`.

**Deliverable:** the vault authoring surface accepts locked-door and locked-chest slots with per-instance data, validated loud.

- Add placement kinds `'door'` and `'chest'` to `VAULT_PLACEMENT_KINDS` (single-sourced `as const`; the derived type + `z.enum` update together).
- Extend `VaultPlacementSlot` with optional lock fields: `difficulty?: number`, `keyContentId?: string | null` (door), and reuse the existing `lootTableId`/`contentId` for chest contents. Model them precisely with `exactOptionalPropertyTypes` in mind.
- Schema (`compiler/schema/vault.ts`): a `door` slot requires `difficulty` (integer, sane range e.g. 1–30) and may carry `keyContentId`; a `chest` slot requires `difficulty` and exactly one of `lootTableId`/`contentId`. Cross-reference validation: `keyContentId`/`lootTableId`/`contentId` must resolve against the pack (fail loud with a `ContentCompileError` naming the vault + slot).
- Tests: a vault legend with a valid locked door and locked chest compiles; missing/oob difficulty fails; unresolved key/loot id fails; a `door`/`chest` slot with the wrong loot combination fails.

**Interfaces produced:** the compiled `VaultPlacementSlot` now carries `kind: 'door'|'chest'`, `difficulty`, `keyContentId`, and loot fields — consumed by Task 3's spawner.

---

### Task 2: Feature model + save-schema (engine)

**Files:** `packages/engine/src/feature-model.ts`, `packages/engine/src/save-schema/item.ts` (the `feature` union + `_FeatureDrift` guard), `packages/engine/src/save-schema/run-record.ts` (structural cross-validation), tests in `packages/engine/test/`.

**Deliverable:** `ChestFeature` and the door `lock` payload exist in the type model AND the save schema, drift-guarded.

- `feature-model.ts`: add `LockData { readonly difficulty: number; readonly keyContentId: string | null }`; add `lock?: LockData` to `DoorFeature`; add `ChestFeature { readonly type: 'chest'; readonly state: 'locked'|'closed'|'looted'|'jammed'; readonly lock: LockData | null; readonly lootTableId: string | null; readonly lootContentId: string | null }` (+ the `FeatureBase` fields). Add `ChestFeature` to the `DungeonFeature` union. Update `featureBlocksMovement`/any exhaustive feature switch for the new variant (a locked/closed chest blocks movement onto its cell; decide and test).
- `save-schema/item.ts`: add the matching `z.strictObject` branch(es) to the `feature` discriminated union and the door `lock` optional; the `_FeatureDrift` `Expect<SchemaMatches<z.infer<typeof feature>, DungeonFeature>>` must compile.
- `run-record.ts`: cross-validate a chest's floor exists; a `looted`/`jammed` chest carries no live loot pointer that resolves to placed items; the door `lock` present iff `state==='locked'` (or documented invariant).
- Tests: round-trip encode/decode of a locked door (with lock), a locked/looted/jammed chest; a malformed feature (jammed chest still holding loot, or door locked with no lock) is rejected.

**Interfaces produced:** `LockData`, `ChestFeature`, extended `DoorFeature` — consumed by Tasks 3 and 4.

---

### Task 3: Production feature spawner (engine)

**Files:** `packages/engine/src/population-placement.ts` (extend the `fillItemSlots` sibling path), possibly `packages/engine/src/floor-integration.ts`, tests in `packages/engine/test/`.

**Deliverable:** authored vault door/chest slots become `DoorFeature`/`ChestFeature` instances in `run.features` during floor population; ordinary content is untouched (no hash change until Task 7 adds demo content).

- Add a `fillFeatureSlots` (or extend the slot loop) that reads `kind: 'door'|'chest'` vault slots via the same `originatingVaultSlot`/`transformVault` pattern `fillItemSlots` uses, and constructs the feature at the slot's world cell with the authored `difficulty`/`keyContentId`/loot, `state: 'locked'`, correct `coverTileId`/`floorId`. Append to `run.features`.
- Chests do NOT materialise their loot at spawn — loot is rolled only on successful open (Task 4). Store `lootTableId`/`lootContentId` on the feature.
- No RNG draw unless placement genuinely needs one; if it does, use `run.rng.encounters` (same as `fillItemSlots`) and thread state back. Prefer deterministic placement with no draw.
- Tests: a vault with a locked-door slot and a locked-chest slot yields the two features at the right cells with the authored data; a floor with no such slots yields `features` unchanged (empty); placement is deterministic across replays.

**Interfaces consumed:** Task 1's slots, Task 2's feature types.

---

### Task 4: `pickLock` engine function + events + action wiring

**Files:** `packages/engine/src/features.ts` (new `pickLock`), the event vocabulary module, `packages/engine/src/actions.ts` (validation + `PickLockAction`), `packages/engine/src/action-dispatch.ts` (dispatcher entry), `packages/engine/src/inventory.ts` (reuse `consumeItemQuantity` + loot helpers), tests in `packages/engine/test/`.

**Deliverable:** the lock check works end-to-end at the engine command layer.

- New `DomainEvent`s: `lock.picked`, `lock.pick-failed`, `door.unlocked`, `chest.jammed` (single-sourced vocabulary; exhaustive consumers updated). Reuse `item.consumed`, `loot.dropped`.
- `pickLock(input)` mirroring `disarmTrap` (`features.ts:349`): validate feature is `locked` and actor adjacent (throw on already-validated invariants). If the actor holds the door's `keyContentId` → unlock (`door.unlocked`), no roll, no pick consumed. Else `rolled = rollDie(run.rng.effects, 20)`, `total = rolled.value + deriveActorStats(actor).disarm`:
  - success (`total >= lock.difficulty`): door `locked→closed` (`lock.picked`); chest `locked→looted` + materialise loot at the chest cell via `createFloorLootFromTable`/`createFloorItem` on `run.rng.loot` (`lock.picked` + `loot.dropped`).
  - `rolled.value === 1`: chest `locked→jammed` (`chest.jammed`), loot discarded; door → treat as ordinary failure.
  - ordinary failure: `consumeItemQuantity` one lockpick (`item.consumed` + `lock.pick-failed`).
  Thread RNG via `withRngStream(run, 'effects', rolled.state)` (and the loot stream on success). Return `{ run, events }`.
- `actions.ts`: `PickLockAction`, a `resolveCommand` validation branch (mirror `disarm` at `actions.ts:710`) checking adjacency, `locked` state, and lockpick-or-key possession. `action-dispatch.ts`: dispatcher entry calling `pickLock`.
- Tests: chest success (loot appears), chest ordinary fail (pick −1, still locked), chest crit-fail (jammed, no loot, cannot reopen), door pick success (locked→closed), door unlock by key (no pick spent), door crit-fail (retryable), no-pick-and-no-key rejected at validation.

**Interfaces consumed:** Tasks 2, 3. **Produced:** the `pick-lock` `GameCommand`/action shape for Task 6.

---

### Task 5: Lockpick + key items and sourcing (content)

**Files:** `content/items/lockpick.yaml` (+ a key item if the demo door uses one), `content/loot-tables/*.yaml`, `content/encounters/town-merchants.yaml` + a merchant `content/loot-tables/town-*.yaml`, tests/admin-doc updates as needed.

**Deliverable:** lockpicks exist as a stackable consumable and are obtainable from loot AND a merchant.

- `content/items/lockpick.yaml`: mirror `lamp-oil.yaml` — `category: misc`, sensible `stackLimit` (e.g. 5), `price`, `tags: [tool, lockpick]`.
- Add `contentId: item.lockpick` `choices` to at least one general loot table (e.g. `early-provisions.yaml`/`echo-spoils.yaml`) with a modest weight.
- Add `item.lockpick` to a town merchant's `stockLootTableId` table so it's purchasable; if the merchant should also buy them back, add `misc` to its `acceptedCategories`.
- Tests: the item compiles; the loot table and merchant stock reference resolve (the content compile gate covers most of this — add an explicit assertion if a table is newly created).

---

### Task 6: Client pick-lock action (web)

**Files:** `apps/web/src/session/intents.ts`, `apps/web/src/session/command-builder.ts`, `apps/web/src/session/projection-view.ts`, `apps/web/src/ui/KeyRouter.ts` + `apps/web/src/ui/hooks/usePlayKeyDispatcher.ts`, a UI affordance component, tests in `apps/web/test/`.

**Deliverable:** the player can attempt a pick from the client when adjacent to a locked door/chest; a bump into a locked door does NOT spend a pick.

- `intents.ts`: `{ type: 'pick-lock', featureId }` `PlayerIntent`. `command-builder.ts`: map it to the Task-4 `GameCommand` (following `open-door`/`refuel`); crucially, `buildMoveIntent` must NOT auto-convert a move-into-locked-door into a pick (only closed doors auto-open; a locked door move is blocked and surfaces the affordance instead).
- `projection-view.ts`: a helper exposing an adjacent locked door/chest (mirror `closedDoorAt`/the merchant helpers) so the UI knows when to offer the action, plus whether the hero holds a key/lockpicks.
- Key binding + affordance: a context-sensitive action (key + on-screen hint) when adjacent to a locked feature. Reuse existing action-affordance primitives; do not hand-roll a new key machine.
- Tests (RTL, behaviour): the pick-lock affordance appears only when adjacent to a locked feature; pressing it dispatches the `pick-lock` intent/command; moving into a locked door does not dispatch a pick-lock and does not consume a pick.

**Interfaces consumed:** Task 4's command shape.

---

### Task 7: Demo content + intentional demo-hash regen

**Files:** a demo vault under `content/vaults/` and/or `packages/engine/src/gameplay-fixture.ts`, the affected `packages/engine/test/fixtures/*-demo-hashes.json`.

**Deliverable:** a demo exercises a locked chest and a locked door; the affected demo hashes are regenerated as an intentional content change.

- Author a locked chest (with a loot table) and a locked door (with a key placed elsewhere) into a demo-reachable vault or the gameplay fixture, so `gameplay:demo` (and `dungeon`/`population` if it flows through generation) exercises spawn + a scripted pick.
- Regenerate ONLY the affected fixtures: run each `scripts/<name>-demo.mjs` without `--verify`, copy the `candidate hashes written <path>` file over the fixture, and eyeball the diff to confirm the change is exactly the added locked-feature content (no unrelated drift).
- Verify `npm run <name>:demo` (with `--verify`) is green afterwards for every affected demo, and that the CI determinism step passes.

---

### Task 8: Whole-milestone verification + docs

**Deliverable:** the full gate is green and the design doc matches what shipped.

- Run `npm run verify` + all six demo replays; fix any lint/format/knip/depcruise finding introduced.
- Reconcile `docs/design/locks-and-lockpicking.md` with the final implementation (update any decision that changed during the build; no lineage narration).
- Confirm the milestone summary lands where the feature backlog expects (`docs/design/future.md` moves G7 out of "active development").

## Self-review (author)
- Every referenced type/function/id is defined in an earlier task or exists today (verified against the recon map).
- Determinism: only Task 7 regenerates hashes, and only for intentionally-added content.
- Vault-only, never-required-path holds: doors always have a key alternative; chests are optional.
