# Town Slice (5C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Milestone 5C — the town as floor 0 and the run loop around it: start in town, buy and store, descend into larger (160×50) dungeon floors, return between excursions to sell and restock, with the two live rendering fixes.

**Architecture:** Content v7 adds permanent merchants, the strongbox service, restock milestones, encounter density, and the authored town layout. Save v8 adds house state, the `house` item location, nullable merchant departure, and the widened service command. The engine gains a dedicated town-floor generator, bidirectional traversal over stored snapshots, a frozen-worldTime town step with an explicit hero-always-ready contract, permanent-merchant lifecycle, milestone restocks, and house commands. The web client adds the Town panel, house screen, ascend key, and the visible-dim/zoom rendering fixes.

**Tech Stack:** TypeScript 5.8+, Node.js 22.12+, Zod 4, React 19, Vitest 3.2, Playwright, fast-check. No new dependencies.

## Global Constraints

- Follow `docs/superpowers/specs/2026-07-16-town-slice-design.md`; amend and reapprove before changing an approved rule.
- Content v6 → v7 and save v7 → v8, each with frozen legacy schema + exactly one ordered migration (v4→…→v8); migrated saves default `house: { capacity: <bundled base>, upgradesPurchased: 0 }`, `restockedMilestones: []`.
- Town is `floor.depth-000` (relax `depthFloorId` to 0–999); town floors are identified by `depth === 0`.
- Town rules: turn and revision advance, worldTime NEVER advances on the town floor; hunger/fuel/conditions/merchant clocks stand still; `attack`/`fire`/`cast`/`throw-item` rejected with reason `town.truce`, `rest` with `town.rest`; rejections consume no randomness. **Hero-always-ready contract**: after a town action resolves, the hero's energy is restored to its acting threshold so the frozen clock can never soft-lock scheduling; town merchants take no turns (no behavior scheduling on the town floor).
- Stored-floor re-entry never regenerates, rerolls, or resets anything; `recentCommands` clears on every floor transition; `floorsEntered` counts only FIRST entries of dungeon floors (never town, never re-entries); `deepestDepth` unaffected by depth 0.
- Permanent merchants: `permanent: true` in content forbids lifetime fields (required otherwise); `departureAt: null` in the save; departure lifecycle and the trade-session departure gate skip null.
- Restock: `restockMerchant` re-rolls stock from the loot table on the `merchant-stock` stream, preserving reputation/services/identity; fires when `metrics.deepestDepth` first crosses each `restockMilestones` entry (bundled `[5, 10, 15, 20]`), evaluated on descent, exactly once per milestone per run (`restockedMilestones` bookkeeping).
- House: capacity counts stacks (bundled base 6); `merchant-service.strongbox` (+4 bundled, `remainingUses: 1`, targetless) raises capacity; `house-deposit`/`house-withdraw` legal only on the town floor adjacent to the house door; reasons `house.full` / existing backpack reasons.
- Production dungeon floors are 160×50 with an area-aware encounter density (balance `encounterDensity.cellsPerEncounter`, bundled 2000 — one encounter per 80×25-equivalent area, four per 160×50 floor). Demo/test fixtures keep their own dimensions.
- Rendering: a visible cell must never render darker than a remembered one; the compact town gets a bounded playfield zoom via `--cell-w`/`--cell-h` scaling (probe re-measures automatically; camera math unchanged).
- Engine browser-safe/deterministic/clock-free; demo hashes only re-pinned with transcript-delta inspection (expected: the projection-depth addition and content-hash rooting — called out per task).
- RED/GREEN TDD strictly RED-first; focused conventional commits; review before the next task. Never use bare `git stash` for comparisons (shared stack) — use temp commits or detached worktrees.

## Key engine facts (verified at f043215 — implementers trust these)

- `materializeMerchant` (`merchant-stock.ts:38-116`) takes `{ run, content, encounter, populationId, floorId, position }`, rolls lifetime at `:75-77`, sets `departureAt: worldTime + rolledLifetime` at `:110`.
- Trade session departure gate: `trade.ts:108-110`; service resolution `trade.ts:459-488` with `planService` `:292-321` (requires `targetItemId` today); commerce reputation bonus `:391-407`.
- `advanceMerchantLifecycle` (`merchant-lifecycle.ts:115-188`), called from `world-step.ts:817-820`, `floor-integration.ts:83-87`, `reducer.ts:98-102`; skips `departed|dead` at `:135` — the permanent skip belongs beside it.
- worldTime advances only in `resolveWorldStep`'s idle branch (`world-step.ts:743-768`: `advanceToNextReady` + `advanceSurvival(elapsed)`); turn increments in `reducer.ts:140`; only active-floor actors schedule (`world-step.ts:503,744`).
- `integrateGeneratedFloor`'s transition branch (`floor-integration.ts:63-78`) handles NEW floors only (strict-append guard `:73-76`); stored re-entry is a manual state build + `validateActiveRun` (schema checks hero walkability, `save-schema.ts:740-742`).
- `TradeServiceCommand.targetItemId` is required (`model.ts:132-137`); `MerchantServiceId` is a single-member literal union (content `model.ts:244`).
- `placePopulation` places at most ONE encounter per call; `generateFloor`/`integrateGeneratedFloor` take population optionally.
- Tiles: `4` stair-up, `5` stair-down, `2` closed door (features overlay it); `createClassicTheme` default `minimumRooms: 6`.
- `ObservableFloorProjection` has NO `depth` field; StatusBar shows `metrics.deepestDepth`.
- CSS: `.cell-visible { opacity: calc(0.35 + 0.65 * var(--light, 1)) }`, `.cell-remembered { color: #4b526b }` — the dark-circle inversion. Cell sizing flows from `--cell-w: 1ch; --cell-h: 1lh` through the probe into `viewportForPane`.
- A fully-explored 160×50 floor serializes to ≈ 30–34 KB of JSON; sessionStorage budget is comfortable.

## File and Responsibility Map

### Content (`packages/content`, v7)
- `src/model.ts`: v7; `MerchantEncounterDefinition.permanent` + optional lifetime fields; `MerchantServiceId` gains `'merchant-service.strongbox'`; balance gains `restockMilestones`, `house: { baseCapacity, strongboxIncrement }`, `encounterDensity: { cellsPerEncounter }`.
- `src/compiler/schema.ts` + `content-validation.ts`: permanent/lifetime cross-rules; strongbox offer shape; balance field bounds; town vault conventions (tag `town`, required slots: `dungeon-entrance`, `house-door`, `merchant-provisioner`, `merchant-arms`, `merchant-curios`).
- `content/vaults/town.yaml`, `content/npcs/town-*.yaml`, `content/npc-factions/town-*.yaml`, `content/encounters/town-merchants.yaml`, `content/loot-tables/town-*.yaml`, `content/balance/core-gameplay.yaml`; every YAML → v7; `docs/server-admin/content-configuration.md`.

### Engine (`packages/engine`, save v8)
- `src/model.ts`: `ActiveRun.house`/`restockedMilestones`; `ItemLocation` + `{ type: 'house' }`; `HouseDepositCommand`/`HouseWithdrawCommand`; `InvalidActionReason` + `'town.truce' | 'town.rest' | 'house.full'`; `TradeServiceCommand.targetItemId: OpaqueId | null`; `MerchantPopulation.departureAt: number | null`.
- `src/versions.ts` (v8), `src/save-schema.ts` (`legacyActiveRunV7Schema`, v8 strictness), `src/save-codec.ts` (`migrateV7ToV8`).
- `src/town-floor.ts` (new): `generateTownFloor(pack)` from the town vault; `TOWN_FLOOR_ID`.
- `src/floor-transition.ts`: `depthFloorId` 0–999; `enterStoredFloor`; `ascendToPreviousFloor`; descend stored branch; milestone restock firing on descent.
- `src/new-run.ts`: town start, lazy depth 1, 160×50 constants, raised `minimumRooms`.
- `src/population-placement.ts` (or a sibling): `placeFloorPopulations` density loop.
- `src/world-step.ts`: town step contract; `src/reducer.ts`: truce/rest rejections + house command block; `src/merchant-lifecycle.ts` + `src/merchant-stock.ts` + `src/trade.ts`: permanent + `restockMerchant` + targetless strongbox service; `src/house.ts` (new): deposit/withdraw resolution; `src/run-metrics.ts`: first-entry-only accounting; `src/projection.ts`: floor `depth` + town flag.

### Web (`apps/web`)
- `src/session/`: ascend intent + session branch; house intents.
- `src/ui/`: Town panel, house transfer screen, StatusBar town label, `<` keymap; `styles.css` + `PlayScreen.tsx`: visible-dim fix + town zoom.
- `e2e/town-loop.spec.ts`; existing specs re-based on the town start.

### Docs and gates
- Roadmap 5C entry; `docs/operations/run-records.md` untouched; walk re-derivations documented in spec headers.

---

### Task 1: Content v7 — permanent merchants, strongbox, milestones, density, town content

**Files:**
- Modify: `packages/content/src/model.ts`, `src/compiler/schema.ts`, `src/compiler/content-validation.ts`
- Modify: content test suites (`model.test.ts`, `parse-file.test.ts`, `compile-directory.test.ts`, `default-content.test.ts`, `admin-docs.test.ts`)
- Create: `content/vaults/town.yaml`, `content/npcs/town-merchants.yaml`, `content/npc-factions/town-merchants.yaml`, `content/encounters/town-merchants.yaml`, `content/loot-tables/town-provisioner.yaml`, `town-arms.yaml`, `town-curios.yaml`
- Modify: `content/balance/core-gameplay.yaml`, every `content/**/*.yaml` → `schemaVersion: 7`, `docs/server-admin/content-configuration.md`

**Interfaces — Produces (exact shapes later tasks rely on):**

```ts
export type MerchantServiceId = 'merchant-service.identify' | 'merchant-service.strongbox';
// MerchantEncounterDefinition gains:
//   readonly permanent: boolean;
//   lifetime fields (minimumLifetime, maximumLifetime, departureWarningThresholds) become OPTIONAL in the
//   source schema; cross-validation: permanent === true FORBIDS all three; permanent === false REQUIRES all three.
// BalanceContentEntry gains:
//   readonly restockMilestones: readonly number[];             // strictly increasing positive ints; bundled [5, 10, 15, 20]
//   readonly house: { readonly baseCapacity: number; readonly strongboxIncrement: number };  // bundled { 6, 4 }
//   readonly encounterDensity: { readonly cellsPerEncounter: number };                        // positive; bundled 2000
export const CONTENT_SCHEMA_VERSION = 7 as const;
```

Town vault (`content/vaults/town.yaml`): kind `vault`, tags `[town]`, `minDepth: 0, maxDepth: 0`, a compact authored layout (~40×18) whose legend places: walls/floor, tile-5 stair-down at the `dungeon-entrance` slot, a `house-door` slot on a door tile beside an enclosed house room, three merchant slots (`merchant-provisioner`, `merchant-arms`, `merchant-curios`) on floor tiles inside stalls, and enough `light` legend fixtures that every merchant slot and walkway is lit. `requiredSlotIds` lists all five slots. Content validation additions: a vault tagged `town` must carry exactly those five required slots and at least one light fixture; strongbox service offers must have `minimumUses === maximumUses === 1`; `restockMilestones` strictly increasing; density/house fields positive safe ints.

Merchant encounters: three `encounter` entries, model `merchant`, `permanent: true`, no lifetime fields, distinct factions and loot tables; provisioner services `[{ serviceId: 'merchant-service.strongbox', basePrice: 120, minimumUses: 1, maximumUses: 1, tierIds: [...all tiers...] }]`; curios services keep identify. Loot tables: provisioner (rations, torches, lamp oil, lantern), arms (sword, shield, bow, arrows, armor), curios (potions, ring, scroll) with `minDepth`/`maxDepth` bands that widen at 5/10/15/20 so restocks surface new goods.

Steps follow the established v5/v6 precedent exactly (failing model/parse tests incl. permanent/lifetime cross-rules and town-vault slot validation → RED → implement → bundled YAML + full version bump → docs + admin-docs tokens (`permanent`, `restockMilestones`, `strongbox`, `encounterDensity`, `town`) → content gates green → commit).

- [ ] Steps 1–6 per the precedent above; expected RED on version/kind assertions first.
- [ ] **Final step: Commit**

```bash
git add packages/content content docs/server-admin
git commit -m "feat: add town content and permanent merchants"
```

NOTE: the root build will break at engine fixtures missing the new balance fields (the established handoff); report it, do not patch other workspaces.

---

### Task 2: Save schema v8 — house, locations, nullable departure, widened service command

**Files:**
- Modify: `packages/engine/src/model.ts`, `src/item-model.ts` (ItemLocation), `src/versions.ts`, `src/save-schema.ts`, `src/save-codec.ts`, `src/fixture.ts`, `src/new-run.ts` (field defaults), engine fixture files with balance literals (add the three new balance fields — repairs the Task 1 handoff, separate first commit `fix: add town balance fields to fixtures`, also covering `apps/web/test/content-pack-fixture.ts`)
- Modify: `packages/engine/test/model.test.ts`, `test/save-codec.test.ts`

**Interfaces — Produces:**

```ts
// ActiveRun gains:
//   readonly house: { readonly capacity: number; readonly upgradesPurchased: number };
//   readonly restockedMilestones: readonly number[];
// ItemLocation gains: | { readonly type: 'house' }
// MerchantPopulation.departureAt: number | null          (null = permanent)
// TradeServiceCommand.targetItemId: OpaqueId | null
// InvalidActionReason gains: 'town.truce' | 'town.rest' | 'house.full'
// HouseDepositCommand { type: 'house-deposit'; itemId; quantity; commandId; expectedRevision }
// HouseWithdrawCommand { type: 'house-withdraw'; itemId; quantity; commandId; expectedRevision }  (both join GameCommand)
export const SAVE_SCHEMA_VERSION = 8 as const;
```

Migration `migrateV7ToV8`: spread + `house: { capacity: <balance base — NO: migrations are content-free; use the literal 6 with a comment tying it to the bundled base>, upgradesPurchased: 0 }`, `restockedMilestones: []`. (Migrations never read content; the literal matches the bundled base and a v7 save can't have bought upgrades.) Strict v8: house capacity ≥ count of house-located stacks (cross-record check); `departureAt` nullable only on merchant populations; house commands and the new reasons join the recorded-command schemas; versions 3 and 9 rejected; `legacyActiveRunV7Schema` frozen BEFORE extension; byte-preservation strip test per the v6/v7 precedent.

- [ ] Steps: fixture-repair commit first; then RED migration/rejection tests → implement → full engine suite + typecheck + zero demo drift (no behavior change) → commit `feat: add town save state and migration`.

---

### Task 3: Town floor generation and the town run start

**Files:**
- Create: `packages/engine/src/town-floor.ts`, `packages/engine/test/town-floor.test.ts`
- Modify: `packages/engine/src/floor-transition.ts` (depthFloorId 0–999), `src/new-run.ts`, `src/index.ts`
- Modify: `packages/engine/test/new-run.test.ts`, `test/floor-transition.test.ts` (depth-0 formatter cases)

**Interfaces:**
- Consumes: the town `vault` entry (Task 1), `depthFloorId`, `materializeMerchant` (permanent semantics arrive in Task 6 — here merchants are NOT yet materialized; Task 3 produces the empty town), `LightSource`, tile ids, `emptyRunMetrics`.
- Produces:

```ts
// town-floor.ts
export const TOWN_FLOOR_ID: OpaqueId;   // depthFloorId(0) === 'floor.depth-000'
export interface TownFloorResult {
  readonly floor: FloorSnapshot;                       // depth 0, tiles/lights from the town vault, stairDown = dungeon entrance
  readonly entrancePlaza: Point;                       // hero spawn (a floor tile adjacent to the dungeon entrance)
  readonly houseDoor: Point;                           // the house-door slot position
  readonly merchantSlots: Readonly<Record<'provisioner' | 'arms' | 'curios', Point>>;
}
export function generateTownFloor(pack: CompiledContentPack): TownFloorResult;  // deterministic, no RNG (authored layout)
```

`generateTownFloor` finds the vault tagged `town`, expands layout+legend into a `FloorSnapshot` (depth 0, `generatorVersion` matching current, `seed` fixed `[0,0,0,1]`-style constant with a comment — authored floors have no meaningful seed but the field is required non-zero if schema demands; check the schema and use the honest minimal value), converts legend light fixtures to fixed `LightSource`s, sets `stairDown` from the `dungeon-entrance` slot tile (tile 5), `stairUp: null`, records the three merchant slots + house door + plaza from `requiredSlotIds` positions. Fully lit assertion in tests: every merchant slot's cell illuminated.

`new-run.ts`: `NEW_RUN_FLOOR_WIDTH/HEIGHT` stay for dungeon generation (Task 5 changes their values); `createNewRun` now: builds the town via `generateTownFloor`, places the hero at `entrancePlaza`, `floors: [townFloor]`, `activeFloorId: TOWN_FLOOR_ID`, does NOT generate depth 1, does NOT call `recordFloorEntered` (town never counts). The bootstrap no longer flows through `addGeneratedFloor` (there is no generated allocation for an authored floor) — assemble and `validateActiveRun` directly, keeping the rng streams untouched at their derived values.

- [ ] RED: `depthFloorId(0) === 'floor.depth-000'` (and 1000 still throws); town-floor tests (slots resolved, stairs, lighting, determinism `stableJson` equality across calls); new-run tests updated (hero in town at plaza, `floors[0].depth === 0`, `metrics.floorsEntered === 0`, no depth-1 floor yet, codec round-trip). Then implement → engine suite + typecheck (several existing new-run/floor-transition tests re-anchor from "hero starts on depth-1 stairUp" to the town start — update them as part of this task; the 5B chargen/e2e-facing kit-coverage test's "first command applies" must still pass with the town start).
- [ ] Commit: `feat: start runs in the authored town`

NOTE: the guest-session/web tests that assume a depth-1 start will redden at ROOT level — expected handoff to Task 8 (web); report, don't patch web here. Demo fixtures build runs via their own fixtures (not `createNewRun`) and must not drift.

---

### Task 4: Bidirectional traversal over stored floors

**Files:**
- Modify: `packages/engine/src/floor-transition.ts`, `src/run-metrics.ts` (first-entry accounting), `src/index.ts`
- Modify: `packages/engine/test/floor-transition.test.ts`

**Interfaces:**
- Consumes: Task 3's town start; `integrateGeneratedFloor` (new floors only); `validateActiveRun`.
- Produces:

```ts
export function enterStoredFloor(run: ActiveRun, input: Readonly<{
  floorId: OpaqueId;
  arrival: Point;                       // must be walkable on the target snapshot
}>): ActiveRun;                          // sets activeFloorId, hero floorId/x/y, activeFloorEnteredAt = worldTime,
                                         // clears recentCommands, validates; NEVER touches the snapshot itself
export function ascendToPreviousFloor(run: ActiveRun, context: Readonly<{ content: CompiledContentPack }>):
  Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }>;
// guards: unconcluded; hero on active floor's stairUp tile (depth 1's stairUp is the passage to town —
// Task 5 ensures dungeon floors get a stairUp leading up; town has none so ascend from town is guarded off);
// target floor = the stored floor at depth-1 (town for depth 1); arrival = target's stairDown position.
// descendToNextFloor gains the stored branch: if depthFloorId(depth+1) already exists in run.floors,
// enterStoredFloor to its stairUp instead of generating.
```

Wait — depth 1's floor today has a `stairUp` used as the SPAWN marker; from Task 3 the spawn moved to town, so depth 1's stairUp becomes the genuine passage up. No generation change needed; the classic theme always emits both stairs.

`recordFloorEntered` accounting: `descendToNextFloor`'s GENERATE branch keeps recording (first entry); the stored branch and `ascendToPreviousFloor` never record. Town is never recorded (Task 3). Add a focused metric test: town → d1 (floorsEntered 1) → d2 (2) → ascend d1 (2) → ascend town (2) → descend d1 (2) → descend d2 (2).

- [ ] RED: round-trip suite — descend to d1, kill nothing yet (no populations needed; use a bare run), note `encodeActiveRun` of d1's snapshot region, ascend to town, descend again, assert the d1 `FloorSnapshot` is byte-identical (`stableJson(floorById(run, id))` equality) and hero arrives on d1's stairUp; ascend guards (not on stairs, from town, concluded run — message-matched); metrics test above; events: transitions emit their integration/no events consistently (stored entries emit none — assert empty, document why: nothing happened to the world). Then implement → engine suite + typecheck → commit `feat: add stored floor traversal`.

---

### Task 5: Larger dungeons, encounter density, and the town step contract

**Files:**
- Modify: `packages/engine/src/new-run.ts` (constants 160×50, `minimumRooms: 14`), `src/population-placement.ts` (or create `src/floor-populations.ts`), `src/generate-floor.ts` (density wiring), `src/world-step.ts`, `src/reducer.ts`
- Modify: `packages/engine/test/` — new `town-rules.test.ts`, density tests beside the placement suite, world-step/reducer suites

**Interfaces:**
- Consumes: balance `encounterDensity.cellsPerEncounter` (Task 1); Task 3's town floor (`depth === 0` identification).
- Produces:

```ts
export function placeFloorPopulations(input: /* same shape as placePopulation's input */):
  Readonly<{ state: ActiveRun; placements: readonly PopulationPlacementResult[]; events: readonly DomainEvent[] }>;
// attempts = clamp(floor((width * height) / cellsPerEncounter), 1, 8); loops placePopulation with distinct
// populationIds and threaded RNG; each iteration honors the existing eligibility/spacing; a 'rejected' result
// stops the loop (floor full). Wired wherever placePopulation is invoked for floor integration today.
```

Town step contract (the researched seams): in `resolveWorldStep`, when the ACTIVE floor's depth is 0 — (a) after the hero's action resolves, restore the hero's energy to the acting threshold (the hero-always-ready contract; comment WHY: worldTime is frozen so time-based energy recovery can never run); (b) skip the idle-advance block (`advanceToNextReady`/`advanceSurvival` — worldTime must not move); (c) skip `advanceMerchantLifecycle` (nothing time-based happens; it would no-op anyway with equal times — skip it for clarity); (d) no non-hero actor is scheduled (town merchants' actors must not take turns — give town merchant actors `behaviorId: null` at materialization in Task 6; here, assert the scheduler never selects a non-hero actor on depth 0). In `resolveCommand`: reject `attack`/`fire`/`cast`/`throw-item` with `town.truce` and `rest` with `town.rest` when the active floor's depth is 0 — placed with the other pre-validation guards (after the conclusion check, before stream touches), mirroring the `run.concluded` rejection shape.

- [ ] RED: town-rules property test (on the town floor, for every accepted command: `worldTime` unchanged, hunger reserve/fuel byte-identical, hero can act repeatedly without stalls — 50 consecutive waits all `applied`; each truce/rest rejection leaves every RNG stream byte-identical and records `action.invalid` with the exact reason); density tests (cellsPerEncounter 2000 on an 80×25 → 1 attempt, 160×50 → 4 attempts, clamp at 8, rejected stops loop); 160×50 generation smoke (floor generates with ≥14 rooms, stairs present, generation time sane). Then implement → engine suite + typecheck → demo verification (fixtures own their dims — zero drift expected; investigate any) → commit `feat: enlarge dungeons and freeze town time`.

NOTE: this changes `createNewRun`-based tests' floor layouts (160×50) — the 5B kit-coverage walk and any seeded-position engine tests re-anchor here, in this task.

---

### Task 6: Permanent merchants, restock, strongbox, and house commands

**Files:**
- Modify: `packages/engine/src/merchant-stock.ts`, `src/merchant-lifecycle.ts`, `src/trade.ts`, `src/floor-transition.ts` (milestone firing), `src/new-run.ts` (town merchant materialization), `src/reducer.ts` (house block), `src/index.ts`
- Create: `packages/engine/src/house.ts`, `packages/engine/test/house.test.ts`, `test/town-merchants.test.ts`
- Modify: trade/merchant test suites

**Interfaces:**
- Consumes: Tasks 1–5 (permanent flag, nullable departureAt, house state, town slots, town step).
- Produces:

```ts
// merchant-stock.ts: materializeMerchant sets departureAt: null and rolls NO lifetime when
//   encounter.definition.permanent (skip the lifetime preflight/roll; town merchant actors get behaviorId: null).
// merchant-lifecycle.ts: advanceMerchantLifecycle skips populations with departureAt === null (beside the departed|dead skip).
// trade.ts: merchantSession's departure gate applies only when departureAt !== null; planService branches by serviceId —
//   'merchant-service.identify' keeps the target requirements; 'merchant-service.strongbox' requires targetItemId === null,
//   rejects when house.upgradesPurchased >= 1 with 'trade.service-unavailable' (reuse the closest existing trade reason —
//   check the TradeInvalidReason union and pick/extend honestly), and on resolution raises house.capacity by the balance
//   strongboxIncrement and increments upgradesPurchased.
export function restockMerchant(run: ActiveRun, input: Readonly<{ content: CompiledContentPack; populationId: OpaqueId }>):
  Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }>;
// re-rolls stockItemIds from the encounter's loot table on rng['merchant-stock'], removing old merchant-stock items and
// adding the new ones; preserves reputation/services/lifecycle/identity; PROJECTS the loot graph at
// max(1, metrics.deepestDepth) — NOT the merchant's floor depth (town is 0) — and projectLootGraph additionally
// honors the new per-choice minDepth/maxDepth bands from Task 1's fix round, so milestone restocks surface the
// widened bands; emits a 'merchant.restocked' domain event
// (new event type + save-schema entry + hero-visible only if the hero is in town — follow projectDomainEvents conventions).
// floor-transition.ts descend path: after a successful descend, for each balance restockMilestone m not in
// run.restockedMilestones with metrics.deepestDepth >= m: restock all permanent merchants, append m.
// house.ts: resolveHouseCommand(state, command, context) — deposit moves a stack (or quantity split) from
// backpack to location {type:'house'} when hero is on the town floor AND Chebyshev-adjacent to the house door slot
// (thread the houseDoor position: store it on the town FloorSnapshot's placementSlots — resolve via the slot, not a constant)
// and house stacks < capacity (else 'house.full'); withdraw mirrors with backpack capacity checks. Both are
// revision-only (no turn advance) like trade commands; wire a house block in resolveCommand beside the trade block.
// new-run.ts: after the town floor assembles, materialize the three merchants at their slots (permanent), then validate.
```

- [ ] RED, table-driven: permanent materialization (no departureAt, no lifetime roll — and CRITICALLY: rng consumption difference is fine for permanent vs travelling, but assert town materialization is deterministic per seed); lifecycle skip (a permanent merchant survives 10_000 worldTime of dungeon play); session gate (trade works regardless of worldTime); strongbox purchase (capacity 6→10, second purchase rejected, currency charged, service uses exhausted); identify unchanged; restock (stock ids change deterministically, reputation/services preserved, exactly-once per milestone across descend spam, `restockedMilestones` bookkeeping, event emitted); house deposit/withdraw legality matrix (wrong floor, not adjacent, full house, full backpack, quantity splits, round-trip preserves item identity incl. enchantments); reducer wiring (house commands revision-only, recorded, replay-idempotent). Then implement → engine suite + typecheck → demo verification (travelling merchants must be byte-identical — their path sets permanent false; zero drift required) → commit `feat: add town merchants and house storage`.

---

### Task 7: Projection depth and the web town experience

**Files:**
- Modify: `packages/engine/src/projection.ts` (floor `depth` + `town` flag on `ObservableFloorProjection`)
- Modify: `apps/web/src/session/intents.ts`, `command-builder.ts`, `guest-session.ts` (ascend intent/branch; house intents)
- Create: `apps/web/src/ui/TownPanel.tsx`, `src/ui/screens/HouseScreen.tsx`, tests for both
- Modify: `apps/web/src/ui/panels.tsx` (StatusBar), `KeyRouter.ts` (`<`, house key `h` when adjacent), `PlayScreen.tsx`
- Possibly re-pin: demo projection hashes (the `depth`/`town` projection addition — inspect: delta must be exactly the two added fields)

**Interfaces:**
- Consumes: engine `ascendToPreviousFloor`, house commands, `TownFloorResult` slot conventions (house door as a placement slot on the snapshot).
- Produces:

```ts
// projection.ts: ObservableFloorProjection gains { readonly depth: number; readonly town: boolean }
// intents.ts: | { type: 'ascend' } | { type: 'house' }        // 'house' opens the transfer screen when adjacent
// guest-session.ts: ascend branch mirrors descend (session-level, projectDomainEvents on returned events);
//   house transfer screen dispatches house-deposit/house-withdraw intents through the normal command path.
// StatusBar: shows "Town" when projection.floor.town, else `Depth ${projection.floor.depth}` (ACTIVE floor,
//   not the deepest-depth metric — keep `data-testid="turn-count"` untouched; e2e depth assertions re-anchor).
// PlayScreen: when projection.floor.town, the ThreatPanel slot renders <TownPanel> (merchants + house with
//   proximity hints from projection.actors positions and the house-door slot) instead.
```

- [ ] RED: projection tests (depth/town fields, hidden-state greps still clean); command-builder table (ascend only on stair-up tile 4, house intent only when adjacent to the house door — thread the door position through the projection's features/slots honestly: check what the projection exposes for placement slots and extend minimally if nothing does, disclosing it); session ascend branch (mirrors descend semantics incl. persistence); TownPanel/HouseScreen component tests (transfer both ways, capacity readouts, full-house handling, keyboard-only); StatusBar town label. Then implement → web + engine suites, typecheck → demo projection re-pins with inspected deltas → commit `feat: bring the town into the client`.

NOTE: the 5B e2e specs assume a depth-1 boot — Task 9 re-bases them; keep unit/component suites green here, e2e is allowed red between Tasks 7–9 ONLY if the failures are exclusively the town-start re-basing (verify and state so in the report).

---

### Task 7b: The trade screen (amendment, 2026-07-17)

**Why amended:** Task 9 blocked on a false spec assumption. The design says "Trade in town reuses the existing trade screen," but no trade UI was ever built — 5A deferred it, and no later task delivered it. The engine side is complete (commands `trade-open { merchantActorId }`, `trade-buy`/`trade-sell { merchantPopulationId, ... }`, `trade-service`, `trade-close`; `GameplayProjection.trade` carries the active session). This task is web wiring only; any engine change is BLOCKED-report territory.

**Files:**
- Modify: `apps/web/src/session/intents.ts`, `command-builder.ts` (trade intents legal only when adjacent to a merchant actor / a trade session is open — mirror the house-intent gating), `KeyRouter.ts` (Shift+T to open trade when adjacent, following the Shift+H precedent; check for collisions and disclose the final binding)
- Create: `apps/web/src/ui/screens/TradeScreen.tsx`, `apps/web/test/trade-screen.test.tsx`
- Modify: `apps/web/src/ui/PlayScreen.tsx` (render TradeScreen when `projection.trade` is non-null), `TownPanel.tsx` (merchant proximity hint gains the open-trade key)

**Interfaces:**
- Consumes: engine trade commands and `projection.trade` exactly as projected — the projection is the source of truth for stock, prices, services, and currency; no client-side price math.
- Produces: a keyboard-first dialog following the HouseScreen/BackpackMenu conventions (`useDialogFocusTrap`, `role="dialog"`, ArrowUp/ArrowDown roving selection, Tab to switch buy/sell/service lists, Enter to execute, Esc closes via `trade-close`). Currency readout visible at all times; invalid results surface as the standard log lines. Hover/mouse selection remains first-class per the established panel conventions.

- [ ] RED-first: command-builder table tests (trade-open only when adjacent to a merchant; buy/sell/service/close only while `projection.trade` matches the merchant; all through the normal command path with `expectedRevision`); TradeScreen component tests (buy updates currency + backpack, sell mirrors, service purchase, keyboard-only full pass, closed-session unmount). Then implement → web suite + typecheck green (engine untouched) → commit `feat: surface trade in the client`.

**Files:**
- Modify: `apps/web/src/styles.css`, `src/ui/PlayScreen.tsx` (zoom application), `src/ui/layout.ts` (if the zoom factor lives there as a pure helper: `zoomForFloor(panePx, cellPx, floor) → 1 | 1.25 | 1.5 | 1.75 | 2`)
- Modify: `apps/web/test/styles-contract.test.ts`, `test/layout.test.ts`, `test/play-screen-tier.test.tsx`

**Interfaces:**
- Consumes: the probe/measurement pipeline (`--cell-w`/`--cell-h` → probe → `viewportForPane`).
- Produces: a visible cell never darker than a remembered one; small floors fill the pane at a clamped zoom.

- [ ] RED where pure (zoom factor table: floor fits at 1× → 1; town-sized floor in a big pane → highest step that still fits; never exceeds 2; never below 1); styles-contract assertions for the new brightness model. Implementation: (a) brightness — rework `.cell-visible` so its darkest state exceeds `.cell-remembered`'s perceived brightness (e.g. floor the light term: `opacity: calc(0.62 + 0.38 * var(--light, 1))` and dim remembered slightly; final values tuned BY EYE in a real browser against the dark-circle screenshot scenario — a torch-lit corridor with remembered cells beyond); (b) zoom — apply `--cell-w: calc(1ch * var(--zoom)); --cell-h: calc(1lh * var(--zoom))` on `.playfield` with `--zoom` set from the pure helper each measure pass (probe re-measures automatically; assert `viewportForPane` receives the zoomed size via the existing plumbing tests).
- [ ] REAL-BROWSER VERIFICATION (required): build + serve, Playwright MCP screenshots at 1440×900 — (i) the dungeon torch scene: no dark ring, smooth falloff, remembered dimmer than any visible; (ii) the town: map fills the pane at the clamped zoom, popover/probe math still lands on cells. Iterate by eye; record observations + final values in the report. Kill any servers started.
- [ ] Web suite + typecheck → commit `fix: correct light falloff and fill small floors`

---

### Task 9: The full-loop e2e, spec re-basing, docs, and roadmap

**Files:**
- Create: `apps/web/e2e/town-loop.spec.ts`
- Modify: `apps/web/e2e/guest-play.spec.ts`, `e2e/run-lifecycle.spec.ts` (town-start re-basing: quickstart now boots to town; the pinned dungeon walk gains a descend prefix or re-derives against 160×50 — re-derive with the documented harness approach; death-loop re-derives similarly)
- Modify: `docs/superpowers/plans/2026-07-13-implementation-roadmap.md`, `docs/server-admin/content-configuration.md` (any gaps), `docs/operations/run-records.md` (only if the town affects record semantics — it shouldn't; verify)

**The loop spec** (seeded, keyboard-only): boot to town (assert "Town" label, merchants visible on the map) → walk to the provisioner, open trade, buy rations (assert currency drop + backpack) → walk to the house, `h`, deposit an item (assert house count) → walk to the dungeon entrance, `>` (assert Depth 1) → fight/loot per a derived short script (160×50 floor — derive with the harness; document in the header) → return to the stair-up, `<` (assert Town), walk back down `>` and assert the SAME floor: the killed monster's absence — e.g. the threat panel/log shows no re-spawn at the recorded position — then `<` again) → sell loot to the arms dealer (assert currency rise) → withdraw the stored item (assert backpack) → strongbox purchase (assert capacity readout 6→10) → descend once more. Assertions favor log/status text; positions only where derived.

- [ ] Steps: re-derive/re-base the three existing spec families first (keep them green), then the loop spec RED-first against intent (write assertions, derive the walk, iterate to green twice consecutively). Full verification block: root `npm test`, typecheck, build, content gates (`content:validate`, `content:startup-gate`), `guest:e2e` (all specs), all five demos, smoke. Roadmap: 5C recorded gate-green with links. Commit `feat: prove the town loop end to end`, then the final whole-branch review per `superpowers:requesting-code-review`.
