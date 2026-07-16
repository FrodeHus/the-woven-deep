# Town Slice (Milestone 5C) Design

Approved design for the third sub-milestone of milestone 5 (decomposition in `docs/superpowers/specs/2026-07-15-guest-play-core-design.md`). It delivers the town as floor 0 and the loop the master design builds runs around: start in town, buy and store, descend, return between excursions, sell and restock. Also folds in two rendering fixes reported from live play.

## Decisions

- **Bidirectional traversal without return-journey pressure.** Ascending re-enters the same stored floor snapshot — no regeneration, defeated enemies stay dead, per the master design — all the way to town and back down. The reinforcement checks and artifact-driven hazards the master design attaches to the Heart return journey stay in milestone 7 where it defines them.
- **Town is safe ground.** Attack, fire, cast, and throw commands are rejected on the town floor with the closed reason `town.truce`; no hostiles exist there and no death in town is possible, so the death-depth ≥ 1 invariants in standings and champion placement stand untouched. Dungeon travelling merchants keep full 4B2 provoke semantics. Attackable town NPCs (with reputation fallout and town-death records) are deliberately deferred.
- **Extend the merchant machinery, don't fork it.** Town merchants are real `MerchantPopulation`s created by the existing `materializeMerchant` at fixed authored positions, with a new content-level `permanent` flag that skips the departure lifecycle entirely, plus a new `restockMerchant` engine operation. The whole `trade.ts` command set, pricing, reputation, and trade screen work unchanged.
- **House: fixed capacity plus one upgrade.** The house holds a content-defined number of item stacks (bundled: 6). One capacity upgrade (+4 stacks, bundled) is purchasable as a provisioner merchant service, exercising the design's "capacity can grow through purchases" rule once. All contents and upgrades die with the hero, per the master design.
- **Exit gate is the full loop e2e**: town → buy → store → descend → kill/loot → ascend (same floor state, dead stays dead) → sell → retrieve → descend.
- Schema bumps: content v6 → v7 (permanent merchants, the strongbox service, restock milestones, the town layout entry); save v7 → v8 (house state, the `house` item location), each with the established frozen-legacy-schema + ordered-migration discipline.

## Town floor

- Depth 0 becomes legal in `depthFloorId`: the town is `floor.depth-000`, which lexically sorts before `floor.depth-001`, preserving the strict-append floor-id invariant unchanged. `FloorSnapshot.depth` already allows 0.
- The layout is authored content: a `vault` entry tagged `town` (the existing layout/legend format, which already expresses terrain, light fixtures, and placement slots) consumed by a new `generateTownFloor` — a dedicated assembly path, not vault-in-floor placement. It places the dungeon entrance (the town's stair-down), the house door, and three merchant placement slots, and is fully lit so merchants are always perceivable (trade sessions and reputation initialization both require perception).
- `createNewRun` starts the hero in town at the entrance plaza. Depth 1 is not generated until the first descent — `descendToNextFloor` already owns lazy next-floor generation.
- Town metrics: entering town is not a "floor entered" for metric purposes; `floorsEntered` counts first entries of dungeon floors only, and `deepestDepth` ignores depth 0 by construction (it takes maxima).

## Traversal

- `descendToNextFloor` keeps its generate-on-first-visit behavior and gains a stored-floor branch: descending where the floor below already exists re-enters that snapshot (arriving at its stair-up) instead of regenerating.
- New `ascendToPreviousFloor(run, { content })`: requires the hero on the active floor's stair-up (depth 1's stair-up is the passage back to town), re-enters the stored floor above, arriving at its stair-down (the town's dungeon entrance for depth 1 → 0). Throws on concluded runs and when not on stairs, mirroring descent.
- Both transitions clear `recentCommands` (the 5B rule: retained command events reference the previous floor's coordinates) and re-validate through the established integration path. Re-entry never regenerates, rerolls, or resets anything on the floor; the snapshot is the truth.
- The web client maps `<` to ascend, mirroring `>`; both remain session-level branches (not reducer commands), consistent with how descent shipped in 5B.

## Town rules

- The town floor is identified by `depth === 0` — no new snapshot field.
- On the town floor, the world step advances `turn` and `revision` but **not** `worldTime`. Everything time-driven — hunger, light fuel, condition expiry, dungeon merchant departure clocks — therefore stands still, which implements both master-design rules at once: town consumes no hunger or light, and town actions do not advance dungeon actors (dungeon floors are inactive while town is active; their populations already freeze off-floor).
- Rejected on the town floor with closed reasons: `attack`, `fire`, `cast`, `throw-item` (reason `town.truce`); `rest` (reason `town.rest` — with frozen time there is nothing to recover and no duration semantics). Rejections consume no randomness, matching the `run.concluded` pattern.
- Everything else works in town: movement, pickup/drop, inventory actions, trade, and the house commands.

## Town merchants

- Three merchants: **provisioner** (food, light sources, fuel, utility — and the strongbox service), **arms dealer** (weapons, armor), **curios dealer** (magical goods, the identification service). Each is an `npc` content entry plus a merchant `encounter` entry with `permanent: true` and its own faction and loot table; stock rolls from the `merchant-stock` stream at run creation via `materializeMerchant` with fixed positions from the town layout's placement slots.
- `permanent: true` merchants have no `departureAt`, never advance departure lifecycle states, and are exempt from the lifetime fields (content validation requires lifetime fields on non-permanent merchant encounters and forbids them on permanent ones).
- **Restock**: a new `restockMerchant` engine operation re-rolls a merchant's stock from its loot table (consuming the `merchant-stock` stream), preserving reputation, services, and identity. It fires when `metrics.deepestDepth` first crosses each content-defined milestone (`restockMilestones` on the balance entry; bundled: 5, 10, 15, 20, matching the master design's milestone floors). Crossing is evaluated on descent transitions; each milestone restocks each town merchant exactly once per run. Stock item depth-bands widen with the milestones so deeper progress surfaces better goods.
- Town prices are the reference tier (travelling merchants already price less favorably, per 4B2's content).

## The hero's house

- New run state (save v8): `house: { capacity: number; upgradesPurchased: number }` and a sibling `restockedMilestones: readonly number[]` (town restock bookkeeping); stored items use a new `ItemLocation` variant `{ type: 'house' }`. Migration defaults: bundled base capacity, zero upgrades, no items (v7 saves have none).
- New commands, legal only on the town floor with the hero adjacent to the house door (a legend-marked feature of the town layout): `house-deposit { itemId, quantity }` and `house-withdraw { itemId, quantity }`. Capacity counts stacks, mirroring backpack semantics; deposits beyond capacity are invalid (`house.full`); withdrawing beyond backpack capacity is invalid with the existing backpack reason.
- The capacity upgrade is the merchant service `merchant-service.strongbox` sold by the provisioner: purchasing it raises `house.capacity` by the content-defined increment (+4 bundled) and increments `upgradesPurchased`; content bounds it to one purchase in 5C (service `remainingUses: 1`).
- Death or victory wipes everything automatically — house state and house-located items are run state, and runs end whole. No extra machinery.

## Web

- Town renders through the same play surface. StatusBar sources the ACTIVE floor's depth (new projection field if absent) and shows "Town" on depth 0 instead of a depth label; the deepest-depth metric stays available to the conclusion/Hall screens.
- On the town floor the ThreatPanel yields to a Town panel listing the three merchants and the house with proximity hints (same snapshot-pure panel conventions).
- Trade in town reuses the existing trade screen; the house gets a transfer screen (two keyboard lists, backpack ↔ house, capacity readouts) following the established dialog/focus conventions.
- The wizard/title/conclusion flow is untouched except that new runs begin in town.

## Rendering fixes (from live play, part of 5C)

1. **Visible-dim inversion ("dark circle")**: visible cells at low light intensity render darker than remembered cells, producing a dark ring around the carried light. Fix the brightness model so a visible cell is never darker than a remembered one (raise the visible floor above the remembered gray, or apply falloff in color-space rather than opacity), verified against real-browser screenshots.
2. **Map not filling the pane**: when the floor is smaller than the pane's cell capacity, apply a bounded playfield zoom (font-size scaling, clamped to a sane maximum) so the map fills the available space instead of floating in dead margins. The camera math is unchanged — the cell size input to `viewportForPane` reflects the zoomed size. Reduced-motion and measurement (probe, popover pixel math) must stay consistent with the zoomed cell size.

## Error handling

- Transition guards throw on invariant violations (not on stairs, concluded run) and surface as log lines through the session's existing rejection path.
- `restockMerchant` is deterministic and pure; a milestone crossing that would double-fire is prevented by tracking fired milestones in run state (part of the v8 house/town state block: `restockedMilestones: readonly number[]`).
- House commands are ordinary reducer commands with closed invalid reasons; the save schema enforces house capacity ≥ stored stacks and the location variant's exclusivity.

## Testing and exit demonstration

- Engine: transition suite (descend-new, descend-stored, ascend, byte-stability of a stored floor across leave/re-enter via codec equality, dead-monster persistence); town-rule properties (per accepted command on depth 0: worldTime unchanged, no hunger/fuel drift, rejected commands leave RNG byte-identical); restock determinism and exactly-once-per-milestone; house command legality/capacity/upgrade rules; migration v7 → v8.
- Content: v7 suites per the established precedent (permanent-flag validation, strongbox service, restock milestones, town vault entry).
- Web: Town panel, house screen, StatusBar town label, `<` routing; the two rendering fixes with contract tests where CSS is assertable and browser screenshots where it isn't.
- E2e: the full loop (buy → store → descend → kill/loot → ascend with state persistence asserted → sell → retrieve → descend); existing specs updated for the town start (quickstart boots to town now — the pinned walk gains a descend prefix or re-derives).
- Exit demonstration: `npm run guest:e2e` green including the loop spec, all existing gates green.

## Out of scope for 5C

Return-journey reinforcement checks and artifact hazards (milestone 7), attackable town NPCs and town-death records, discovery-based house upgrades, more than one strongbox tier, milestone-crossing restocks beyond depth thresholds ("major dungeon events" wait for the events that would trigger them), the codex/journal/settings overlays (5D), and any server-side town state (milestone 6).
