# Gamefield presentation

The gamefield is the isometric view of the current dungeon floor: the floor tiles, the hero and
other actors, ground items, carried and fixture light, targeting and transient effects, and the
hurt vignette. It is a **presentation-only** module — it draws what the engine projection already
says is true and never decides gameplay. All of it lives under `apps/web/src/ui/playfield/`, with
the surrounding HUD in `apps/web/src/ui/` and `apps/web/src/ui/panels/`.

The renderer is PixiJS (WebGL). jsdom has no WebGL, so tests mount a recording fake through the
`createRenderer` injection seam rather than the real renderer.

## Data flow: snapshot → scene state → renderer

Rendering is a one-way pipeline from the authoritative session snapshot to pixels:

1. **`SessionSnapshot`** — the guest session publishes a snapshot after every command. Its
   `projection` (a `GameplayProjection`) carries only hero-visible state: the observable floor
   cells (`glyph`/`token`/`knowledge`/`intensity`/`tint`), visible actors, ground items,
   conditions, and the conclusion. Hidden engine state never reaches here.

2. **Scene state** (`scene-state.ts`) — `nextSceneState(prev, snapshot, now)` diffs the new
   snapshot against the previously rendered scene and produces a `SceneState`: actor/hero sprites
   with position tweens, ground items, transient effects, the `hurtAt` timestamp, and the
   `concludedByDeath` flag. An actor present in both scenes at a new cell gets a `SpriteMotion`
   running from its currently-interpolated position to the new cell over `STEP_MS`; a brand-new
   actor, a null previous scene, or a floor change all appear in place. This is the only place that
   introduces animation timing; it reads the clock (`now`) but no gameplay state beyond the
   snapshot.

3. **Renderer** (`IsoRenderer.ts`) — `setSnapshot` folds each snapshot into the scene state and
   wires it into the Pixi scene graph: it re-bakes the floor when the discovered geometry changes,
   positions and eases sprites, rebuilds the light map, and animates effects and the camera. It
   emits pointer input back out through `onCellClick`/`onCellHover` callbacks. `PlayfieldCanvas.tsx`
   owns the create/init/destroy lifecycle (async `init`, non-idempotent `destroy`, StrictMode-safe)
   and pushes each new `snapshot` and `targeting` change.

## Layer stack

The Pixi stage composites these layers, back to front:

1. **World container** — the camera-transformed world: the baked floor sprite, then the features,
   items, and actors containers (actors are `sortableChildren` for depth ordering).
2. **Light map sprite** — a render texture composited with `multiply` blend, darkening cells by
   their distance from carried and fixture light (`light-layer.ts`).
3. **Overlay container** — targeting graphics and the effects container (normal and additive
   particle graphics), in screen space above the lit world.
4. **Vignette sprite** — a full-screen tint that pulses on `hero.damaged`, driven by `hurtAt`.

Isometric projection (`iso-math.ts`) maps a cell `(x, y)` to screen space; the same projection is
used with no camera term when baking a floor.

## WFC tile skinning

`tile-skinning.ts` turns engine terrain tokens into concrete atlas sprite variants
deterministically — a small wave-function-collapse-style pass, never `Math.random` and never a
clock, so the same `(cells, width, height, floorId)` always yields the same `TileSkin[]`. Byte-
identical replay is the point.

- `familyForToken` resolves each cell's base family from its closed terrain token set, failing loud
  on any unrecognized token rather than guessing `floor`.
- `cellSeed(floorId, x, y)` is an FNV-1a hash of the floor id xor-mixed with the coordinates, so a
  cell's chosen variant is stable across renders and two floors never collapse identically.
- Wall shape comes from open-neighbor topology (rounded corners, endcaps, weave and lone-wall
  variants); floor dirt clusters from already-resolved neighbors; single-sprite families (door,
  pillar, stairs) map straight through.

## Floor bake

`floor-bake.ts` pre-composites a floor into a single static canvas so the renderer uploads one
texture instead of drawing every tile each frame. `planFloorBake` is pure (no canvas, no I/O): it
skins the floor, plans every draw with its atlas rect and destination box, orders them back to
front, and returns the canvas size and origin offset. Walls are base-anchored and floors are
top-anchored, each overscanned slightly so adjacent diamonds tessellate with no seams. The canvas
size is rounded up to whole pixels so a fractional scale never clips the last row or column.
`bakeKey` folds the floor id with every known cell's `(index, token)` — but never the fog/knowledge
tier — so the bake changes only when discovered geometry changes, not every step. `bakeFloor`
replays the plan onto a canvas and fails loud if the 2d context is unavailable.

## HUD composition

The HUD is plain React (Tailwind), layered over the canvas by `PlayScreen.tsx`, never drawn into
Pixi:

- The canvas fills the layout (`absolute inset-0`).
- `ThreatPopover` / `AssetPopover` follow the hovered cell.
- `TopBar`, `HeroStatusAnnouncer`, `MinimapPanel`, and `LogPanel` are fixed HUD panels. `LogPanel`
  renders nothing when there are no log lines, so no empty box floats over the field.
- `TownPanel` shows only on town floors.
- `ActionBar` is the bottom command bar and begins targeting for casts.

The stylesheet `styles.css` keeps only the presentation CSS that outlives the canvas swap: the
`ScreenFade` cloak and the overlay entrance motions (`.wd-*`), each declared across all four motion
blocks (the reduced-motion media query, `.motion-reduced`, `.motion-full`), plus the named color
and material palettes, the high-contrast theme, colorblind log reinforcement, and shared chrome.
The material palette variables are the design source of truth mirrored in `cell-color.ts`
(`visibleForeground` / `MATERIAL_BASE_RGB`), which the map/journal grid and the
`styles-contract.test.ts` luminance-floor invariant still exercise.

## What is presentation-only

Nothing in this module is authoritative. It reads the projection and the clock and produces pixels;
it never mutates run state, never draws hidden fields, and never accepts a score or record. Input
leaves the canvas as a cell coordinate and a button, which the session turns into ordinary engine
commands (for example click-to-travel dispatches the same one-step `move` intents the keyboard
sends, paced one step per authoritative projection — see `useAutoTravel.ts`). The determinism
contract lives in the engine; the gamefield only visualizes its output.
