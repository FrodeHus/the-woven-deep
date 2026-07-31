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
