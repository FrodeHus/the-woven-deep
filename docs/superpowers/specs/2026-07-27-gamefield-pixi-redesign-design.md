# Gamefield Pixi Redesign — Design

**Date:** 2026-07-27
**Status:** Approved pending user review
**Source design:** claude.ai/design project "The Woven Deep" — `Woven Deep Pixi.dc.html` (isometric Pixi play view)

## Summary

Replace the in-run gamefield presentation in `apps/web` with the approved Pixi redesign: an
isometric PixiJS canvas renderer in place of the DOM ASCII grid, and the design's full-bleed HUD
chrome in place of the current Layout A (status bar, right rail, bottom strip). Only functionality
that exists in the engine/session layer today is ported; the demo's own game simulation
(real-time combat, dash, WFC map *generation*, chests, respawn, hunger ticking, lava/water) is
explicitly out of scope. The engine gains exactly one field: the hero's `currency` in the
gameplay projection.

## Decisions (user-confirmed)

1. **Scope:** full redesign — canvas renderer *and* HUD chrome.
2. **Art:** import the tileset atlas (`tiles-*.png` + `atlas.json`) from the design project; map
   engine tokens to atlas sprites.
3. **Right rail:** removed. HUD stays minimal like the design. Spells → spellbook overlay +
   targeting hotkeys; threats → hover popovers; town services → existing town/trade screens;
   conditions/hunger/light → Hero Record overlay.
4. **Action bar:** mapped to real functionality only. Belt slots show drinkable potions from the
   real pack and dispatch the existing `backpack` `use` intent (hotkey `1`); a cast button opens
   the existing spell-targeting flow (hidden for non-casters); no Strike button, no dash.
5. **Death:** "THE DEEP TAKES YOU" overlay on run conclusion, then the existing
   `ConclusionScreen`. No respawn. ConclusionScreen itself is not restyled in this effort.
6. **WFC tile texturing:** wave-function-collapse-style constraint selection is used for *tile
   skinning* (which atlas variant each cell gets), seeded per floor. WFC map generation from the
   demo is not ported (floor layout is engine data).

## Architecture

### New module: `apps/web/src/ui/playfield/`

A framework-free renderer core plus a thin React shell, following the same discipline as
`src/session/` (framework-free logic, React consumes it).

- **`IsoRenderer`** (plain TypeScript class, PixiJS v8 — new dependency in `apps/web` only):
  - Input: `SessionSnapshot` (pushed on change) + a resize observer + an rAF tick for ambient
    animation.
  - Output: cell-level callbacks — `onCellClick(cell)`, `onCellHover(cell | null)`,
    `onActorHover(actorId | null)` — consumed by the React shell and wired to the *existing*
    auto-travel, popover, and targeting logic.
  - Owns the Pixi scene graph and nothing else. No intent dispatching, no session access.
- **`PlayfieldCanvas`** (React component): mounts/destroys the renderer, feeds it snapshots,
  bridges callbacks to `useAutoTravel`, `ThreatPopover`/`AssetPopover`, and `useSpellTargeting`.
- Deleted after the swap: `GridRenderer.tsx`, `EffectsLayer.tsx`, `CellCursor.tsx`, the
  `.playfield-grid`/`.cell*` CSS. Reused as-is: `projection-view.ts` accessors, `effects-map.ts`
  event mapping (retargeted to renderer effects), `light-sources.ts`, KeyRouter, intents.

### Scene graph (back to front)

1. **Baked floor texture** — rendered once per floor to an offscreen canvas: floors, walls,
   doors, stairs, pillars from the atlas, painted back-to-front so wall blocks occlude correctly.
   Rebaked only on floor change (or door-state change if doors are baked).
2. **Ground items layer** — sprites per visible ground item (from `groundItemsOf`).
3. **Actors layer** — hero + visible actors, y-sorted, with per-actor tween state.
4. **Light layer** — darkness + additive light sprites (hero light from `equippedLightSource`,
   fixture lights with deterministic flicker) rendered to a texture and multiply-blended;
   FOV mask from cell `knowledge`.
5. **Presentation layer** — particles, floating damage/heal text, hit flashes, death bursts,
   driven from `snapshot.lastEvents` (same source `effects-map.ts` uses today). Screen-shake and
   red hurt-vignette on hero damage.

### Isometric projection

2:1 diamond projection of the engine's square grid (presentation-only; all game coordinates
remain grid cells). `worldToScreen`/`screenToWorld` live in a pure module with unit tests. The
camera eases toward the hero each frame; the deadzone behavior of `camera.ts` is replaced by the
easing follow (camera logic moves into the playfield module).

### WFC tile skinning

Engine `token`/`tileId` selects a sprite *family*; a constraint pass picks the *variant*:

- **Walls:** open-neighbor topology decides shape — directional rounded corners, endcaps, lone
  boulders, straight runs (the atlas encodes these variants).
- **Floors:** variants collapsed with adjacency weights so clean/dirty patches cluster
  coherently rather than speckling.
- **Seeding:** a pure hash of (`floorId`, x, y) drives every choice — the same floor always
  skins identically across renders, reloads, and save restores. No `Math.random` in skinning.

`Math.random` is permitted only in ephemeral presentation (particle velocities, mote drift),
which never feeds back into game state or persisted visuals.

### Fog of war

- `unknown` — nothing rendered.
- `remembered` — baked floor, dimmed and desaturated, no dynamic light, no actors/items.
- `visible` — full lighting from `intensity` plus light-source sprites.

### Movement animation

The engine is turn-based; the renderer tweens actor positions between cells over ~150–200 ms
when a new snapshot moves them, and chains tweens during auto-travel. Animation never blocks or
delays input; a new command mid-tween snaps the tween forward.

## HUD chrome (React + Tailwind, existing theme tokens extended to the design's values)

Full-bleed canvas; chrome floats over it:

- **Top gradient bar:** game title, location label (town name or `DEPTH N`), hero gold
  (`hero.currency`, new projection field), depth, turn count (small, muted). Condition badges
  from the current StatusBar are dropped from the bar; conditions live in Hero Record and as
  renderer auras.
- **Minimap (top-right):** same data as `MinimapPanel`, restyled as the design's compact canvas.
- **Message log (bottom-left):** last ~5 entries, tone-colored, floating over the canvas;
  `aria-live` preserved. Full history remains available via the Map & Journal overlay.
- **Action bar (bottom-center):** HP "LIFE-THREAD" dial and Weave dial (small canvas/SVG
  gauges) flanking:
  - **Belt:** up to 4 slots populated from drinkable potions in the real pack; clicking a slot
    dispatches the existing `backpack` `use` intent for that slot's potion, and `1` uses the
    first occupied slot. Empty slots render inert.
  - **Cast button:** visible only when the hero has castable spells; opens the existing
    spell-targeting flow (same as the spellbook path).
  - **Hint line:** the *real* keybinds (move, `i` pack, `c` hero, `g` pickup, `⌘K` palette, …)
    from the actual keymap, not the demo's.
- **Death overlay:** on run conclusion by death, a full-screen "THE DEEP TAKES YOU" overlay
  (red pulse, fade) over the canvas; Enter/click proceeds to the existing `ConclusionScreen`.
- **Removed:** StatusBar, right rail (`HeroPanel`, `SpellsPanel`, `MinimapPanel` in-rail,
  `ThreatPanel`, in-rail `TownPanel`), `HintStrip`. Town services must remain reachable through
  existing interactions (adjacent-merchant trade, dialogue, house); if planning finds any town
  affordance reachable *only* via the old `TownPanel`, it moves into an overlay rather than
  being dropped.
- **Accessibility:** the DOM grid's reader semantics are replaced by an off-screen live region
  describing hero surroundings/status changes, fed from the same snapshot;
  `HeroStatusAnnouncer` stays.

## Panels

- **Pack & Gear (`InventoryOverlay`)** and **Hero Record (`CharacterSheetOverlay`)**: restyled
  as the design's right slide-in panels; all current functionality preserved (equip/unequip/
  use/drop/toggle-light/refuel, filters, sort, keyboard nav, list-detail). The demo's invented
  placeholder fields are not reproduced (hardcoded "Condition: 100", unconditional "IDENTIFIED"
  badge); the game's real per-item condition and identification state remain displayed as before.
- All other overlays/screens (Spellbook, Map & Journal, Codex, Settings, Help, Dialogue, Trade,
  House, Command Palette) keep working unchanged; retheming them is out of scope.

## Engine change (the only one)

Add the hero's purse to the gameplay projection's hero section (e.g. `hero.currency: number`),
mirroring `state.hero.currency`. Player-known information; no hidden-field leak
(RNG streams, decisions, standings internals all remain unprojected). Includes projection tests.
No save-schema change. If a hash-pinned demo transcript includes gameplay projections and its
hash moves, the delta is inspected and re-pinned as an intentional, explained change.

## Assets

- Copy the curated final tileset sheet(s) and `atlas.json` from the design project into
  `apps/web` (public or bundled assets). Only sheets the token mapping uses are imported —
  start with the latest dungeon sheet (the engine has no biomes); superseded `tiles-*-v*.png`
  versions stay out of the repo.
- The committed atlas contains ONLY assets the game renders (user directive): floors, dirty
  floors, walls, rounded walls, weave-conduit walls (cosmetic), stairs (one sprite serving both
  stair-up and stair-down until dedicated art exists), door (`terrain.door`), gate (locked
  features), pillar/broken pillar, torch/wall torch (`fixture.lamp`). Excluded as demo-only:
  water/lava frames, pits, arch, banner, lever, and all decor props.
- A curated tileset-generation guide ships in `docs/design/tileset-generation.md` (user
  directive): the design project's generation prompt reworked to the game's real asset
  vocabulary — demo-only rows removed, missing assets added, notably a town set (cobbles, town
  walls, house door, dungeon-entrance surround, lamp posts, and one stall per merchant type —
  the town vault's placement slots are real projection data) plus stair-up art.

## Explicitly out of scope (demo-only, not ported)

Real-time movement/combat loop, A*/BFS click-pathing inside the renderer (auto-travel already
exists in the session layer), dash + ghosts, Strike button, free-aim Ember Bolt as a distinct
system, WFC/classic map *generation*, biome selection, water/lava cells and scorch damage,
chests, doors/gates as demo features (engine door tokens render; demo feature placement does
not), decorative prop placement, food ticking/starvation sim, fuel sim, respawn, item defs
embedded in the UI, demo dev props (`generator`, `art`, `bloom`, `fxIntensity`, `zoom` as
design-time knobs — a zoom setting may be exposed later via Settings, not in this effort).

## Testing

- **Pure unit tests (Vitest, no WebGL):** iso `worldToScreen`/`screenToWorld` round-trips; WFC
  variant selection (stability for fixed seed, topology→wall-shape cases, cluster weighting);
  token→sprite-family mapping (exhaustive over the token union); tween scheduler decisions;
  fog classification.
- **React tests (Testing Library + user-event):** belt click/`1` dispatches the `use` intent for
  a drinkable potion; cast button visibility gating and targeting entry; death overlay renders
  on concluded-by-death snapshot and advances to conclusion; top bar shows gold/location/depth;
  log renders latest entries.
- **Engine tests:** projection exposes `hero.currency`; hidden fields still absent.
- **Existing tests:** overlay/behavioral assertions unchanged (restyle is behavior-preserving);
  full gate per CONTRIBUTING (content build → engine build → web tsc → server tsc, `npm run
  verify`, demo-hash replays).
- **Renderer smoke:** `IsoRenderer` instantiation guarded in tests via Pixi's canvas fallback or
  constructor-level dependency injection; no headless-WebGL requirement in CI.

## Process

- Feature branch `feat/gamefield-pixi-redesign`; PR(s) into `main`.
- Implementation plan will sequence renderer-first (canvas inside existing layout), HUD-second
  (chrome swap), panels-third (restyle), so the branch is playtestable throughout.
- Golden Rule 7: a `docs/design/` gamefield-presentation doc is added/updated in the feature PR;
  this spec records the approved intent.
