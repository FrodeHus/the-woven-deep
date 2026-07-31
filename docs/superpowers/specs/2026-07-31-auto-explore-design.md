# Auto-Explore + Smarter Travel — Design

**Issue:** #161. **Date:** 2026-07-31. **Status:** approved.

## Goal

Remove the walking tax on 160×50 floors: an auto-explore key that walks the hero to unexplored ground until something interesting happens, travel-to-stairs keys, minimap click-to-travel, and auto-pickup for gold and (optionally) consumables. All of it is client-side convenience — the session layer replays existing intents (`move`, `pickup`) one per projection, so determinism, replay, and the engine are untouched.

## Non-goals

- No engine changes of any kind. No new commands, no engine-side explore.
- No pathing through unknown cells, locked doors, or perceived actors (travel rules are reused verbatim).
- No auto-descend, no multi-floor travel, no auto-fight.
- No partial-stack pickup.

## Architecture

Everything lives in `apps/web`. The existing three-layer split is kept and generalized:

1. **Pure planners** (`session/travel.ts`, new `session/explore.ts`) — compute a path from a projection; no dispatching.
2. **Pure stepper** (`session/travel.ts` `advanceTravel`) — emits at most one intent per fresh projection, or stops.
3. **Pacing hook** (`ui/hooks/useAutoTravel.ts`) — one step per authoritative projection, `setTimeout`-paced, first step synchronous, cancelled by keydown/modal/unmount.

## Components

### 1. Frontier planner — `session/explore.ts` (new)

`computeExplorePath(projection): readonly Point[] | null`

- BFS from the hero over cells passing the same navigability rules as travel (`cellNavigability`: known, passable token, no locked feature, no perceived actor).
- Target: the **nearest frontier cell** — a navigable cell with at least one 8-neighbour whose `knowledge === 'unknown'`.
- Returns the path (origin excluded, same shape as `computeTravelPath`) or `null` when no frontier is reachable (floor fully explored → the caller logs "You have explored this floor.").
- Re-planned **every step** by the stepper (8 000-cell BFS is negligible; knowledge expands as the hero walks, so a stale path is wrong more often than it is right).

### 2. Generalized stepper — `session/travel.ts`

`ActiveTravel` grows:

- `mode: 'travel' | 'explore' | 'stairs'` — `explore` re-plans via `computeExplorePath` each step; the other modes keep their fixed plan.
- `stopWhen(projection, lastEvents): StopReason | null` — a pure predicate evaluated before each step. The existing hard-coded checks (health below baseline, new hostile) become the base predicate every mode uses.
- A `pendingPickup` cursor state: when the stepper dispatches `pickup` instead of `move`, the next projection is not expected to move the hero — the cursor holds. This closes the known desync gap at the `awaiting` check.

**Stop conditions (classic set).** Explore and stairs-travel stop, with a log-visible reason, on any of:

| Signal | Source |
| --- | --- |
| hostile appears / hero damaged | projection diff (existing baseline logic) |
| new ground item perceived | `groundItemsOf` diff vs. start set (excluding items auto-picked this run of explore) |
| stair discovered | first cell with `token === 'terrain.stair'` leaving `unknown` |
| door/chest/feature revealed | `feature.revealed` event |
| hunger stage worsens | `hunger.stage-changed` event |
| fuel warning / light out | `fuel.warning`, `item.light-extinguished` events |
| sound heard | `sound.heard` event |
| invalid action | `action.invalid` event |
| modal/decision/trade/conclusion | `pendingDecision`, `pendingFinalChamberChoice`, `conclusion`, `trade`, `houseOpen` (the existing `isModalActive` composition) |

Click-travel keeps today's minimal stop set (health drop, new hostile) — unchanged behavior.

### 3. Auto-pickup

After each explore/travel step, inspect the ground item under the hero:

- `category === 'currency'` → always dispatch `pickup` (engine credits `hero.currency`, emits `currency.collected`).
- Consumable categories — exactly `food`, `potion`, `scroll`, `ammunition`, `fuel` from `ITEM_CATEGORIES` — → dispatch `pickup` iff the `autoPickupConsumables` setting is ON **and** the backpack has room. An item whose content definition carries an `artifact` block is never auto-picked regardless of category.
- Anything else (`weapon`, `armor`, `shield`, `light`, `ring`, `misc`, artifacts, unknowns) is never auto-picked — the new-item stop rule halts explore so the player decides.

Each auto-pickup consumes a turn and uses the `pendingPickup` cursor state. Items auto-picked mid-explore do not re-trigger the new-item stop.

### 4. Keybindings

- New `ActionId` `autoExplore`, default `o`. Registered in `ACTION_IDS`, `ACTION_LABELS`, `DEFAULT_BINDINGS`; Help overlay and rebinding UI pick it up automatically; `CommandPalette` gets an "Explore" entry.
- New `ActionId`s `travelDownStairs` / `travelUpStairs`, defaults `>` / `<`. **Overload rule:** when the hero stands on the matching stair, the key resolves to today's `descend`/`ascend` intent (unchanged); otherwise it starts stairs-travel to the discovered matching stair cell (`token === 'terrain.stair'`, glyph `>` or `<`), or logs "You haven't found those stairs yet." if none is discovered.
- Router: new `RouterOutcome` variants `start-explore` and `travel-to-stairs { direction }`, handled in `KeyDispatchHandlers` the same way `use-belt-slot` is (they are session-level actions, not raw intents).

### 5. Minimap click-travel

`MinimapPanel` cells already carry their `ObservableCell`; add an `onClick` per cell that calls the existing `autoTravel.travelTo(cell)` (same entry the iso canvas click uses). Unknown cells render nothing and get no handler. Lights-out needs no special case — the minimap is already blank outside town. `MapJournalOverlay` stays read-only.

### 6. Pacing

`EXPLORE_STEP_MS = 90` (2× travel's `STEP_MS = 180`, which click/stairs travel keep). Interrupts land on the next projection regardless of pace.

### 7. Settings

`autoPickupConsumables: boolean`, default `true`, added to `Settings` with an explicit validated branch in `parseSettingsJson`, a `DEFAULT_SETTINGS` entry, and a switch row in `SettingsOverlay`. Server roaming is automatic via the existing settings PUT.

## Error handling

- Explore with no reachable frontier: system log line, no dispatch, no state change.
- Stairs-travel with undiscovered stairs: system log line, no dispatch.
- `action.invalid` mid-explore (blocked door, etc.): stop with the engine's reason in the log.
- Any dispatch rejection surfaces exactly as today (system log line); the stepper stops rather than retries.

## Testing

Vitest, following `apps/web/test/travel.test.ts` and `auto-travel.test.tsx` patterns:

- Frontier planner: nearest-frontier selection, unreachable-frontier `null`, fully-explored `null`, locked doors excluded.
- Stepper: each stop condition fires and reports its reason; `pendingPickup` holds the cursor across a pickup turn; explore re-plans after knowledge growth.
- Auto-pickup: currency always; consumable gated on setting + backpack room; equipment never; auto-picked items don't self-interrupt.
- Router: `o` starts explore; `>` on stairs descends, `>` elsewhere starts stairs-travel; rebinding works.
- Minimap: click on a known cell starts travel; unknown cells inert.
- Settings: parse round-trip with and without the new field.

## Amendments (2026-07-31, during implementation)

1. **`ActionId` naming and the `o` collision.** The spec asks for an `autoExplore` action defaulting to `o`, but `o` is already `settings`' default chord and every other multi-word `ActionId` in `settings.ts` is kebab-case. Resolution: the new id is `'auto-explore'` bound to `o`, and `settings` moves to `Shift+O`.
2. **No new stairs `ActionId`s.** The spec asks for `travelDownStairs`/`travelUpStairs` defaulting to `>`/`<`, but `descend`/`ascend` already own those chords and `resolveKeymap`'s `byChord` map admits exactly one action per chord. Resolution: the existing `descend`/`ascend` actions are overloaded — `routeKey` returns `{ type: 'travel-to-stairs', direction }` for them and the handler picks descend-vs-travel from the live projection. One binding, one row in Help/Settings, the spec's overload rule preserved exactly.
3. **Frontier excludes the hero's own cell.** A zero-length path cannot be walked and would spin the pacing loop, so `computeExplorePath` never targets the origin.
4. **The new-item stop excludes auto-pickable items.** The spec says "excluding items auto-picked this run of explore"; implemented as "the item-spotted stop fires only for items the auto-pickup policy declines", which is the same rule stated causally instead of historically.
5. **Auto-pickup runs in `explore` and `stairs` modes only.** Click-travel keeps today's behavior verbatim (minimal stop set, explicit on-arrival pickup) per the locked decision.
6. **The modal stop condition needs no predicate.** `PlayScreen` already composes `isModalActive` and passes it as `useAutoTravel`'s `disabled`, which clears the walk — the spec's modal row is satisfied by existing code.

Additional review-driven behavior changes, folded in during Task 9:

7. **Desync stop reporting.** `advanceTravel` evaluates `stopWhen` on the desync path too, and prefers a real reason over `'blocked'` — `'blocked'` is only the fallback for a desync no rule can explain. This honors the spec's `action.invalid` row instead of masking a reportable stop behind the generic desync branch.
8. **Offered-item set.** A per-floor set of already-reported item ids (`offeredItemIds` in `useAutoTravel`, threaded through `advanceTravel` as `offered`) prevents the item-spotted stop from re-firing when a later explore leg re-enters a room containing an item already reported this floor visit. Auto-picked items never enter the set, since they were never offered as a stop.
9. **Non-clearing system note.** The guest and profile sessions gained `noteSystemLine`, which appends a client-only log line without touching `lastEvents`, so stop-reason lines from explore/stairs-travel do not blank the pending damage/status effects already shown in the log. `GuestSession.noteSystemLine` routes through the new, non-clearing `appendSystemNote`; `ProfileSession.noteSystemLine` routes through its own `appendSystemLine`, which was already non-clearing, so no second append method was needed there.
