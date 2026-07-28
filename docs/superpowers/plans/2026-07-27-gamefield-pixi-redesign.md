# Gamefield Pixi Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the in-run gamefield with an isometric PixiJS renderer and the approved full-bleed HUD chrome, per `docs/superpowers/specs/2026-07-27-gamefield-pixi-redesign-design.md`.

**Architecture:** A framework-free renderer core (`apps/web/src/ui/playfield/`) built from small pure modules (iso math, WFC tile skinning, scene diffing, floor baking) composed by an `IsoRenderer` class (PixiJS v8), mounted by a thin `PlayfieldCanvas` React component. The HUD becomes floating chrome over the canvas; panels are restyled; the engine gains exactly one projection field (`hero.currency`).

**Tech Stack:** TypeScript 5.8 strict + exactOptionalPropertyTypes, React 19, Vite 7, Tailwind v4, PixiJS v8 (new, `apps/web` only), Vitest 3.2 + Testing Library.

## Global Constraints

- CONTRIBUTING.md is binding: no `any`/lying casts; no history comments; fail loud; comments describe the present.
- The engine stays deterministic: no `Math.random` in anything that feeds game state or persisted/stable visuals. Renderer particles may use `Math.random`; tile skinning MUST be seeded (floorId + coordinates).
- Full gate before claiming done, in order: `npm run build --workspace @woven-deep/content` → `npm run build --workspace @woven-deep/engine` → `npx tsc -p apps/web/tsconfig.json --noEmit` → `npx tsc -p apps/server/tsconfig.json --noEmit` → `npm run verify`. `vitest` alone does not typecheck.
- GitNexus (project rule): run `impact({target, direction: "upstream"})` before modifying an existing exported symbol; run `detect_changes()` before each commit. If the index is stale, run `node .gitnexus/run.cjs analyze` once at task start.
- Conventional commits, lowercase, no scope. Branch: `feat/gamefield-pixi-redesign` (already created; spec committed).
- Existing behavioural test assertions must not change except where a task explicitly says the behavior moves (e.g. GridRenderer tests are deleted with GridRenderer).
- Test placement: `apps/web/test/*.test.ts(x)` for cross-component tests; co-located `*.test.ts(x)` acceptable for new focused modules (MinimapPanel.test.tsx precedent).
- Demo-hash rule: no `*-demo-hashes.json` hash may move except (possibly) from Task 1's projection change — if one moves, inspect the transcript delta, confirm it is exactly the added `currency` field, and re-pin in the same commit with the explanation in the commit message.

## Prerequisite (manual, user)

`tiles-dungeon-v5.png` exceeds the design-sync read cap and must be exported by the user from the Claude Design project ("The Woven Deep" → file `tiles-dungeon-v5.png`) into `apps/web/public/playfield/tiles-dungeon-v5.png`. Task 2 verifies its presence and PNG signature. All other data (atlas rects) is already captured in this repo by Task 2.

---

### Task 1: Expose hero currency in the gameplay projection

**Files:**
- Modify: `packages/engine/src/projection.ts` (function `projectHeroView`, return literal at ~:768-800)
- Modify: `packages/session-core/src/projection-view.ts` (`HeroView`, ~:82-101)
- Test: `packages/engine/test/projection.test.ts`, `packages/session-core/src/projection-view.test.ts` (or its existing shape-pin test), `apps/web/test/projection-view.test.ts`

**Interfaces:**
- Consumes: `state.hero.currency: number` (already read by `projectActiveTrade`, projection.ts:668).
- Produces: `GameplayProjection.hero.currency: number`; `HeroView.currency: number` — later tasks (TopBar, belt) read `heroOf(projection).currency`.

- [ ] **Step 1: Write the failing engine test** — in `packages/engine/test/projection.test.ts`, next to the existing hero-shape assertions (~:1031):

```ts
it('exposes the hero purse as currency', () => {
  const projection = projectGameplayState(run, { content });
  expect(projection.hero.currency).toBe(run.hero.currency);
});
```

Mirror the setup of the neighboring hero-shape test verbatim (same `run`/`content` fixture construction used at :1031-1060).

- [ ] **Step 2: Run it to verify it fails** — `npm run build --workspace @woven-deep/content && npm run build --workspace @woven-deep/engine && npm run test --workspace @woven-deep/engine -- --run test/projection.test.ts`. Expected: FAIL, `currency` is `undefined`.
- [ ] **Step 3: Implement** — in `projectHeroView`'s return literal add `currency: state.hero.currency,` alongside `name`/`sightRadius`. In `packages/session-core/src/projection-view.ts` add `readonly currency: number;` to `HeroView` after `maxWeave`.
- [ ] **Step 4: Update the shape pins** — session-core's `projection-view.test.ts` and `apps/web/test/projection-view.test.ts` pin `HeroView` against the projection; extend their fixture/assertions with `currency` (test-infrastructure change, allowed).
- [ ] **Step 5: Run the full test chain** — engine + session-core + web suites; then `npm run gameplay:demo` etc. If a pinned demo hash moves, apply the demo-hash rule from Global Constraints.
- [ ] **Step 6: Commit** — `git commit -m "feat: expose hero currency in gameplay projection"`

### Task 2: PixiJS dependency, atlas data module, and asset check

**Files:**
- Modify: `apps/web/package.json` (add `pixi.js` ^8)
- Create: `apps/web/src/ui/playfield/atlas.ts`
- Create: `apps/web/public/playfield/atlas-dungeon.json` (content below)
- Test: `apps/web/src/ui/playfield/atlas.test.ts`

**Interfaces:**
- Produces: `interface AtlasRect { x: number; y: number; w: number; h: number }`, `interface PlayfieldAtlas { imageUrl: string; blockDepthPx: number; floors: AtlasRect[]; dirty: AtlasRect[]; walls: AtlasRect[]; rounded: AtlasRect[]; weaveWalls: AtlasRect[]; stairs: AtlasRect; door: AtlasRect; gate: AtlasRect; torch: AtlasRect; torchWall: AtlasRect; pillar: AtlasRect; pillarBroken: AtlasRect }`, `function parseAtlas(json: unknown): PlayfieldAtlas` (throws on malformed input — fail loud), `const ATLAS_URL = '/playfield/atlas-dungeon.json'`.
- Game-asset policy (user directive): the atlas contains ONLY assets the game renders — no demo-only entries. Every key maps to a real engine visual: `floors`/`dirty` → `terrain.floor`, `walls`/`rounded`/`weaveWalls` → `terrain.wall`, `stairs` → `terrain.stair` (both tileId 4 stair-up and 5 stair-down until a dedicated stair-up sprite exists), `door` → `terrain.door`, `pillar`/`pillarBroken` → `terrain.pillar`, `gate` → locked features from `featuresOf(projection)`, `torch`/`torchWall` → `fixture.lamp` fixtures. Excluded as demo-only: water, lava, pits, arch, banner, lever, and all decor props (bones/skulls/brazier/crate/…).

- [ ] **Step 1:** `npm install --workspace @woven-deep/web pixi.js@^8` (root, so the workspace lockfile updates).
- [ ] **Step 2:** Create `apps/web/public/playfield/atlas-dungeon.json` with exactly this content (rect values verified against the design project's `atlas.json`, dungeon sheet; tuples are `[x, y, w, h]`):

```json
{
  "image": "tiles-dungeon-v5.png",
  "blockDepthPx": 34,
  "floors": [[29,36,162,117],[203,37,157,115],[371,37,156,115],[539,37,161,115],[711,37,157,115],[885,37,160,115],[1059,37,159,115]],
  "dirty": [[29,180,159,119],[201,181,159,119],[370,180,158,119],[538,181,162,119],[711,180,158,119],[884,181,160,118],[1058,181,160,118]],
  "walls": [[37,316,142,168],[209,316,140,167],[379,317,141,167],[548,316,144,169],[720,317,140,167],[895,317,141,167]],
  "weaveWalls": [[1067,315,142,170]],
  "rounded": [[37,500,129,142],[208,503,123,136],[377,501,130,141],[731,500,114,140],[543,500,150,148],[731,500,114,140],[882,500,147,147],[1064,501,145,146]],
  "stairs": [1059,661,160,133],
  "torchWall": [61,942,47,168],
  "torch": [217,941,53,161],
  "door": [499,940,112,165],
  "gate": [649,944,122,163],
  "pillar": [690,801,68,121],
  "pillarBroken": [822,815,84,106]
}
```

- [ ] **Step 3: Write the failing test** — `atlas.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseAtlas } from './atlas.js';
import raw from '../../../public/playfield/atlas-dungeon.json';

describe('parseAtlas', () => {
  it('parses the committed atlas into typed rects', () => {
    const atlas = parseAtlas(raw);
    expect(atlas.floors).toHaveLength(7);
    expect(atlas.walls).toHaveLength(6);
    expect(atlas.rounded).toHaveLength(8);
    expect(atlas.stairs).toEqual({ x: 1059, y: 661, w: 160, h: 133 });
    expect(atlas.blockDepthPx).toBe(34);
  });
  it('throws on malformed input', () => {
    expect(() => parseAtlas({ image: 'x.png' })).toThrow();
  });
});
```

- [ ] **Step 4: Run to verify it fails**, then implement `atlas.ts`: a `toRect([x,y,w,h])` helper plus `parseAtlas` that validates every field exists, tuple lengths are 4, and numbers are finite — throw `new Error('playfield atlas malformed: <field>')` otherwise. No Zod needed (module-local, one reviewed parse), but keep it total: every field checked.
- [ ] **Step 5: Asset presence check** — verify the user-provided PNG exists and starts with the PNG signature: `head -c 8 apps/web/public/playfield/tiles-dungeon-v5.png | xxd`. Expected: `8950 4e47 0d0a 1a0a`. If missing/wrong, STOP and report — do not source the image from anywhere else.
- [ ] **Step 6: Run tests, typecheck web, commit** — `git add -A && git commit -m "feat: add pixi dependency and playfield tile atlas"`

### Task 2b: Curated tileset-generation helper doc

**Files:**
- Create: `docs/design/tileset-generation.md`

**Interfaces:** none (documentation deliverable). Source material: the design project's "Tileset Prompt" screen, curated per user directive — demo-only assets removed, game-only assets kept, missing town assets added.

- [ ] **Step 1: Create `docs/design/tileset-generation.md`** with this content (verbatim; it is the curated version of the design project's prompt — grid/style/animation rules preserved, rows recut to the game's real vocabulary):

````markdown
# Tileset Generation Guide

Prompt + atlas contract for generating an isometric tileset that drops into the Woven Deep
playfield renderer (`apps/web/src/ui/playfield/`). Every row maps to something the game actually
renders: terrain tokens (`terrain.wall/floor/door/pillar/stair/void` — `packages/engine/src/terrain.ts`),
the `fixture.lamp` light fixture, locked features, and the town vault's placement slots
(merchant stalls, house door, dungeon entrance). There are no decorative-prop rows: the game has
no such objects, and a sprite without a game entity behind it never renders.

## Image-generation prompt

```
Isometric dungeon tileset sprite sheet, single 1024x1024 PNG, fully transparent background.

BIOME: pick ONE per sheet — generate one sheet per biome, identical layout:
  A. WORKED DUNGEON — pale blue-grey cut limestone blocks, moss-green floor slabs, navy shadow,
     warm amber lamplight
  B. TOWN — warm grey cobbles, timber-and-plaster walls, oiled wood, brass lamp fittings

Every biome keeps the same discipline: cool desaturated stone, one warm accent, flat value steps.

STRICT GRID — this is machine-sliced, precision matters more than beauty:
- Exactly 8 columns x 8 rows of 128x128-pixel cells. One tile per cell, nothing crossing cell
  borders, no overlap, no drop shadows or glows outside the block silhouette.
- Every tile is built on the SAME isometric footprint: a 2:1 diamond top exactly 128 px wide and
  64 px tall, apex at y=16 in-cell, left/right corners at y=48, bottom corner at y=80. Blocks
  extend straight down 48 px below the diamond (base at y=128). Flat items sit ON this diamond.
- Camera: classic 2:1 isometric, no perspective, no rotation variance between tiles.
- ONE FLOOR PLANE: every walkable top face occupies that exact diamond. Flat tiles must show NO
  side wall or kerb rising above it. Only wall cubes, rounded rocks, and standing objects may
  extend upward.
- Lighting: single hard-ish key light from upper-left, identical across all tiles. NO cast
  shadows on the ground outside the block.
- ABSOLUTELY NO ground plate, contact shadow, soft halo, or vignette under any tile: alpha ends
  EXACTLY at the block's own silhouette.
- QC: imagine each tile composited on pure magenta — nothing may darken the magenta except the
  block itself.

STYLE — CLEAN CEL-SHADED GAME ART, not painterly illustration:
- FLAT VALUE STEPS, not gradients. Top face lightest, the two side faces two distinct darker
  values. Three nameable values per block. No airbrush, no glossy specular.
- CHUNKY MASONRY: roughly 3x3 large stones per wall face, clean mortar lines. Never gravel noise.
- LOW TEXTURE NOISE: detail from shape and value; a few deliberate cracks, no grime spatter.
- LIMITED COOL PALETTE (~8-10 colours per sheet); warm light against cool stone is the entire
  colour story.
- CRISP EDGES, no outlines; silhouette-first — every object readable as a black shape at 32 px.
- No text, no watermark, no border. Apply the biome's material to EVERY row.
- AVOID: painterly dark-fantasy rendering, muddy realism, photoreal textures, gradient-heavy
  shading, flourish detail that vanishes at game scale.

ROW LAYOUT (row 0 = top; fill every cell):
- Row 0: 8 clean FLOOR slabs — same material, subtle variation only. Must tile seamlessly.
- Row 1: 8 DIRTY floor variants — mud-tracked, stained, soot-scorched, damp sheen, moss patches,
  dust drifts, straw-flecked, rubble-flecked.
- Row 2: 8 WALL cubes — full-height sharp-edged blocks: 4 plain, 2 weathered/cracked,
  2 with luminous violet Weave-conduit threads across the faces.
- Row 3: 8 ROUNDED wall pieces, same height, eroded silhouettes: 4 outer-corner boulders rounded
  toward NE / SE / SW / NW, 2 end-cap stubs, 2 lone rock masses.
- Row 4: STAIRS & PASSAGES: stairs-down (steps cut INTO the floor plane, a well, never a raised
  platform; stone painted unlit — the violet glow is animated separately), stairs-up (steps
  rising against a wall block), closed wooden door in stone frame, iron-barred gate (locked
  passage), stone pillar, broken pillar stump, wall-mounted lamp (lit), free-standing lamp post
  (lit).
- Row 5: TOWN terrain: 2 cobbled plaza floors, 2 town building walls (timber-and-plaster over
  stone footing), house door (heavier, dwelling-grade, distinct from the dungeon door),
  dungeon-entrance stair surround (worked stone arch around a descending well), lamp post
  (unlit), hanging shop sign on bracket.
- Row 6: TOWN market stalls, one per merchant: provisioner (sacks, bread, produce), arms dealer
  (racked blades, shield), curios dealer (odd trinkets, bottles, threads), spell vendor (scrolls,
  candles, faint violet glow). Then: empty stall counter with awning, stacked wares crate,
  notice board, town well.
- Row 7: reserved — extra floor and wall variants in the biome's material, for future variety.

COMPANION ANIMATION SHEET — tiles-{biome}-anim.png (separate 1024x1024 PNG, same 8x8 grid, same
palette, same footprint and apex anchor).

ANIMATION RULES:
- MOVING PART ONLY: a frame contains ONLY the thing that moves, on transparency — flame, glow,
  threads. Never redraw surrounding stone; redrawn stone never matches itself between frames.
- Each ROW is one 8-frame loop, frames left to right, col 0 = frame 0; frame 7 leads back into
  frame 0 with no jump. Constant phase step (1/8 cycle) per frame.
- SILHOUETTE LOCK: pixel-identical outer silhouette and alpha edge across a row; only interior
  light and colour change.
- Same alpha discipline as the static sheet. Emissive tiles get bloom from the engine's light
  layer — paint the SOURCE bright, not an aura.

ROW LAYOUT — ANIMATION SHEET:
- Row 0: LAMP FLAME only — flame and immediate light, no post or bracket, positioned where it
  sits above the row-4 lamps.
- Row 1: WEAVE THREADS only — the luminous violet threads as they sit on the row-2 accent wall
  cube, stone transparent; glow pulses and travels along the threads, brightest at frame 3-4.
- Row 2: STAIRS-DOWN WEAVE GLOW — violet light only (#a06cff), no steps or stone; a soft pool
  rising out of the stair well, breathing dim-to-bright over 8 frames, never bright enough to
  read as fire.
- Rows 3-7: reserved — leave fully transparent (the renderer falls back to procedural shimmer,
  so partial sheets are safe to ship).
```

## Atlas contract

The renderer slices by explicit rects in `apps/web/public/playfield/atlas-dungeon.json`
(`parseAtlas` in `apps/web/src/ui/playfield/atlas.ts` is the schema authority). For a sheet
generated on the strict grid above, a cell at column `c`, row `r` slices as
`[c*128, r*128, 128, 128]`. Keys and what consumes them:

| Key | Game visual |
|---|---|
| `floors[]`, `dirty[]` | `terrain.floor` cells (seeded WFC variant selection) |
| `walls[]`, `rounded[]`, `weaveWalls[]` | `terrain.wall` cells (topology decides shape) |
| `stairs` | `terrain.stair` (tileId 4 up / 5 down) |
| `door` | `terrain.door` |
| `gate` | locked features (`featuresOf` projection entries) |
| `pillar`, `pillarBroken` | `terrain.pillar` |
| `torch`, `torchWall` | `fixture.lamp` light fixtures |
| town row keys (future) | town vault placement slots (merchant stalls, house door, entrance) |

Do not add atlas keys for assets the game cannot render — a key with no engine counterpart is
dead data and gets rejected in review.
````

- [ ] **Step 2: Commit** — `git add docs/design/tileset-generation.md && git commit -m "docs: add curated tileset generation guide"`

### Task 3: Isometric math module

**Files:**
- Create: `apps/web/src/ui/playfield/iso-math.ts`
- Test: `apps/web/src/ui/playfield/iso-math.test.ts`

**Interfaces:**
- Produces:

```ts
export interface IsoView { camX: number; camY: number; zoom: number; viewW: number; viewH: number }
export const TILE_HALF_W = 32; export const TILE_HALF_H = 16;
export function worldToScreen(view: IsoView, tx: number, ty: number, z?: number): readonly [number, number];
export function screenToWorld(view: IsoView, sx: number, sy: number): readonly [number, number];
export function cellAtScreen(view: IsoView, sx: number, sy: number, width: number, height: number): { x: number; y: number } | null;
```

`worldToScreen` maps grid coords (cell centers at `x + 0.5`) to pixels: `sx = (tx - camX - (ty - camY)) * TILE_HALF_W * zoom + viewW / 2`, `sy = (tx - camX + (ty - camY)) * TILE_HALF_H * zoom + viewH / 2 - (z ?? 0) * zoom`. `screenToWorld` is its exact inverse (solve the 2×2 system). `cellAtScreen` floors the world coords and returns `null` outside `[0,width) × [0,height)`.

- [ ] **Step 1: Write failing tests** — round-trip property (for a grid of sample points, `screenToWorld(worldToScreen(p)) ≈ p` within 1e-9), origin centering (`worldToScreen(view, camX, camY)` = viewport center), `cellAtScreen` in-bounds and out-of-bounds cases.
- [ ] **Step 2: Run to verify fail → implement → run to verify pass.** Test run: `npm run test --workspace @woven-deep/web -- --run src/ui/playfield/iso-math.test.ts`
- [ ] **Step 3: Commit** — `git commit -m "feat: add isometric projection math for playfield"`

### Task 4: Seeded WFC tile skinning

**Files:**
- Create: `apps/web/src/ui/playfield/tile-skinning.ts`
- Test: `apps/web/src/ui/playfield/tile-skinning.test.ts`

**Interfaces:**
- Consumes: `ObservableCell` (`@woven-deep/engine`): `token?: string`, `knowledge`, `x`, `y`; floor `width/height/floorId`.
- Produces:

```ts
export type TileFamily = 'floor' | 'floor-dirty' | 'wall' | 'wall-rounded' | 'wall-weave' | 'door' | 'pillar' | 'pillar-broken' | 'stairs' | 'void';
export interface TileSkin { family: TileFamily; variant: number }   // variant indexes the atlas family array
export function familyForToken(token: string | undefined): TileFamily;
export function skinFloor(cells: readonly ObservableCell[], width: number, height: number, floorId: string): readonly TileSkin[];
export function cellSeed(floorId: string, x: number, y: number): number;  // deterministic 32-bit hash
```

Rules inside `skinFloor` (this is the WFC pass, spec §WFC tile skinning):
- `familyForToken` maps the engine's terrain token strings, which are the closed set from `TILE_DEFINITIONS` in `packages/engine/src/terrain.ts`: `terrain.wall`→`wall`, `terrain.floor`→`floor`, `terrain.door`→`door`, `terrain.pillar`→`pillar`, `terrain.stair`→`stairs` (tileId 4 = stair-up, 5 = stair-down share the token and, for now, the sprite), `terrain.void`/`undefined`→`void`. Unknown non-empty tokens → `floor` is NOT acceptable — throw (`fail loud`) so a new engine token surfaces immediately.
- Wall shape from open-neighbor topology (orthogonal neighbors with non-wall, non-void family): ≥2 open orthogonal sides → `wall-rounded` with directional variant (NE=0, SE=1, SW=2, NW=3, endcap=4/5, lone=6/7 — same encoding as the atlas `rounded` order); else `wall`, variant = `cellSeed % walls.length`; `cellSeed(floorId,x,y) % 9 === 0` → `wall-weave` (cosmetic conduit).
- Floor variants collapse with adjacency weighting: a cell becomes `floor-dirty` iff `cellSeed % 4 === 0` **or** at least two already-collapsed orthogonal neighbors (scan order: y-major) are dirty and `(cellSeed >>> 8) % 2 === 0` — this clusters dirt coherently without unseeded randomness. (The propagation coin deliberately reads a high bit, decoupled from the `% 4` rule-1 parity: on the low bits, `cellSeed % 2` is provably always odd whenever a cell's north and west neighbors are both rule-1 dirty, given this module's FNV-1a + 73856093/19349663 mix, which would make propagation permanently unreachable.)
- `cellSeed` = the same integer mix the demo used, extended with the floorId: FNV-1a over the floorId string, then `(h ^ (x * 73856093) ^ (y * 19349663)) >>> 0`.

- [ ] **Step 1: Write failing tests:** determinism (same inputs twice → deeply equal output; different floorId → different variant somewhere), topology cases (a lone wall cell surrounded by floor → `wall-rounded` variant 6 or 7; a wall in a straight run with one open side → `wall`), unknown token throws, dirty clustering (construct a floor where the seeded dirty cells exist; assert at least one neighbor-propagated dirty cell and that no dirty cell is isolated from both rules).
- [ ] **Step 2: Run → fail → implement → pass.**
- [ ] **Step 3: Commit** — `git commit -m "feat: add seeded wfc tile skinning for playfield"`

### Task 5: Scene state — snapshot diffing and tween scheduling

**Files:**
- Create: `apps/web/src/ui/playfield/scene-state.ts`
- Test: `apps/web/src/ui/playfield/scene-state.test.ts`

**Interfaces:**
- Consumes: `SessionSnapshot` (`apps/web/src/session/guest-session.js`), `heroOf`/`actorsOf`/`groundItemsOf` (`apps/web/src/session/projection-view.js`), `effectsForEvents` + `TransientEffect` (`apps/web/src/ui/effects-map.js`).
- Produces:

```ts
export interface SpriteMotion { fromX: number; fromY: number; toX: number; toY: number; startedAt: number; durationMs: number }
export interface ActorSprite { id: string; glyph: string; color: string | undefined; isHero: boolean; motion: SpriteMotion | null; x: number; y: number; health: number; maxHealth: number }
export interface SceneState {
  floorId: string;
  actors: readonly ActorSprite[];
  groundItems: readonly { id: string; glyph: string; color: string | undefined; x: number; y: number }[];
  effects: readonly TransientEffect[];
  hurtAt: number | null;             // timestamp of last hero-damage event, drives vignette/shake
  concludedByDeath: boolean;
}
export function nextSceneState(prev: SceneState | null, snapshot: SessionSnapshot, now: number): SceneState;
export function motionPosition(sprite: ActorSprite, now: number): readonly [number, number];  // smoothstep interpolation, clamped
export const STEP_MS = 180;
```

`nextSceneState` rules: same actor id at a new cell → `motion` from previous rendered position (use `motionPosition(prevSprite, now)` as `from`, so a command mid-tween snaps forward smoothly, spec §Movement animation); new actor id or `prev === null` or `floorId` changed → no motion (appear in place). `hurtAt = now` when `snapshot.lastEvents` contains a `hero.damaged`-mapped effect (reuse `effectsForEvents` with the hero id and actor positions built from `actorsOf` + `heroOf`). `concludedByDeath` = `snapshot.projection.conclusion !== null && snapshot.projection.conclusion.completionType === 'death'` — FIRST verify the death variant's literal with `rg "CompletionType" packages/engine/src` and use the actual value; if there is no death variant, derive from `conclusion.cause` and record the chosen predicate in a code comment describing the rule.

- [ ] **Step 1: Write failing tests:** move produces motion with correct from/to; mid-tween re-move starts from interpolated position; floor change drops motion; `motionPosition` clamps at t≥1; hero-damage event sets `hurtAt`; death conclusion sets `concludedByDeath`. Build snapshots with a minimal hand-rolled `SessionSnapshot` fixture (copy the fixture approach from `apps/web/test/effects-layer.test.tsx`).
- [ ] **Step 2: Run → fail → implement → pass.**
- [ ] **Step 3: Commit** — `git commit -m "feat: add playfield scene state diffing and tweening"`

### Task 6: Floor baking (draw-call planning, canvas-free)

**Files:**
- Create: `apps/web/src/ui/playfield/floor-bake.ts`
- Test: `apps/web/src/ui/playfield/floor-bake.test.ts`

**Interfaces:**
- Consumes: `PlayfieldAtlas`/`AtlasRect` (Task 2), `TileSkin`/`skinFloor` (Task 4), `ObservableCell`.
- Produces:

```ts
export interface BakeDraw { rect: AtlasRect; dx: number; dy: number; dw: number; dh: number }
export function planFloorBake(cells: readonly ObservableCell[], width: number, height: number, floorId: string, atlas: PlayfieldAtlas, scale: number): { draws: readonly BakeDraw[]; pxWidth: number; pxHeight: number; originX: number; originY: number };
export function bakeKey(cells: readonly ObservableCell[], floorId: string): string;  // changes iff discovered geometry changes
export function bakeFloor(canvas: HTMLCanvasElement, image: CanvasImageSource, plan: ReturnType<typeof planFloorBake>): void;
```

`planFloorBake` is pure and carries all logic: skip `knowledge === 'unknown'` cells entirely (their terrain data may be absent); bake `remembered` and `visible` cells identically — fog shading is NOT baked, it lives in the per-frame light layer (Task 7), because `knowledge` changes every step and the bake must not; back-to-front ordering (`(x + y)` ascending, then `x`); wall sprites base-anchored (bottom of sprite at the cell's bottom corner, demo convention with `blockDepthPx`); buried walls (no non-wall neighbor in the 8-neighborhood) skipped; floor diamond destination `dw = 64 * scale`, `dh = dw * rect.h / rect.w`. `bakeKey` = floorId + a fold over each known cell's `(index, token)` — the renderer rebakes when it changes (floor change, newly discovered cells, a door opening and flipping its cell's token). `bakeFloor` just replays draws through `ctx.drawImage`.

- [ ] **Step 1: Write failing tests against `planFloorBake`/`bakeKey` only** (no canvas): unknown cells produce no draws; remembered and visible cells bake identically; ordering is back-to-front; a buried wall produces no draw; stairs cell uses `atlas.stairs`; door token uses `atlas.door`; `bakeKey` stable across knowledge-only changes (visible↔remembered) and changed by discovery or a token flip.
- [ ] **Step 2: Run → fail → implement → pass.**
- [ ] **Step 3: Commit** — `git commit -m "feat: add floor bake planning for playfield renderer"`

### Task 7: IsoRenderer (Pixi composition)

**Files:**
- Create: `apps/web/src/ui/playfield/IsoRenderer.ts`
- Create: `apps/web/src/ui/playfield/light-layer.ts`
- Test: `apps/web/src/ui/playfield/light-layer.test.ts` (pure parts only)

**Interfaces:**
- Consumes: everything from Tasks 2-6; `equippedLightSource` (`apps/web/src/ui/light-sources.js`); `visibleForeground` (`apps/web/src/ui/cell-color.js`).
- Produces:

```ts
export interface RendererCallbacks {
  onCellClick(cell: { x: number; y: number }, button: 'primary' | 'secondary'): void;
  onCellHover(hover: { cell: { x: number; y: number }; clientX: number; clientY: number } | null): void;
}
export interface TargetingVisual { validCells: ReadonlySet<string>; affectedCells: ReadonlySet<string>; reticle: { x: number; y: number } | null }
export class IsoRenderer {
  constructor(host: HTMLElement, atlas: PlayfieldAtlas, callbacks: RendererCallbacks);
  init(): Promise<void>;                        // pixi v8 async Application.init + Assets.load
  setSnapshot(snapshot: SessionSnapshot): void; // runs nextSceneState + rebake on floor change
  setTargeting(visual: TargetingVisual | null): void;
  destroy(): void;
}
// light-layer.ts (pure):
export interface LightSpec { x: number; y: number; radius: number; intensity: number; flickerSeed: number }
export function lightsForFloor(cells: readonly ObservableCell[], hero: { x: number; y: number; lightRadius: number }): readonly LightSpec[];
export function cellDarkness(intensity: number): number;   // 0..1 multiply-layer alpha from ObservableCell.intensity (0-255)
```

Implementation notes (keep the class thin — every decision it makes should already live in a tested pure module):
- Layers bottom-up: floor sprite (baked canvas → `Texture.from`), ground items (`Container` of `Text`-glyph sprites colored via item `color`), actors (`Container`, y-sorted each frame via `motionPosition`), light layer (a `Graphics` darkness quad + additive radial-gradient light sprites, rendered to a `RenderTexture`, multiply-blended — port of the demo's structure at design file lines 631-651), targeting marker `Graphics`, transient-effects `Container`, all inside one stage translated by the camera.
- Actors render as glyph text sprites in this task (atlas has no monster art; spec keeps actor visuals minimal): drop shadow ellipse + colored glyph + the mini HP bar when `health < maxHealth` (three `Graphics` calls, port of `pHpBar`).
- Locked features from `featuresOf(projection)` render as the atlas `gate` sprite at their cell (sprite layer, not the bake — lock state changes without a floor change). Check `FeatureView`'s lock-state field name in `packages/session-core/src/projection-view.ts` (~:103-113) and render the gate only while locked; an unlocked feature renders nothing.
- Camera eases toward the hero: `cam += (heroPos - cam) * min(1, dt * 6)` in the ticker.
- FOV lives entirely in the light layer (the bake is fog-agnostic, Task 6): after the darkness quad and additive light sprites, a per-cell pass paints `unknown` cells to full black, `remembered` cells down to a fixed dark level (alpha 0.75, cool tint — the demo's `fovG` pattern), and leaves `visible` cells at `cellDarkness(intensity)`.
- Fixture lights: one `LightSpec` per cell with a `fixture`, flicker by `sin(t * a + flickerSeed)` with `flickerSeed = cellSeed(floorId, x, y)` — deterministic per fixture.
- Hero light: radius from `equippedLightSource(hero.equipment)` fraction (same source EffectsLayer uses today, `fuelFraction`).
- Input: pointerdown/pointermove/pointerleave on the canvas → `cellAtScreen` → callbacks. Secondary button = `'secondary'` (targeting cancel path). `contextmenu` is prevented.
- Death/hurt presentation: `hurtAt` within 400ms → red vignette overlay alpha ramp + camera shake offset (decaying, `Math.random` allowed); `concludedByDeath` is NOT handled here (React overlay, Task 12).
- Resize via `ResizeObserver` on the host (the test setup already stubs it).

- [ ] **Step 1: Write failing tests for the pure parts** (`light-layer.test.ts`): `cellDarkness(255) === 0`, `cellDarkness(0) === 1`, monotonic; `lightsForFloor` emits a fixture light per fixture cell and one hero light with the given radius; flicker seeds are deterministic.
- [ ] **Step 2: Run → fail → implement `light-layer.ts` → pass.**
- [ ] **Step 3: Implement `IsoRenderer.ts`.** No unit test for the Pixi class itself (WebGL is unavailable in jsdom; the canvas 2D context is stubbed). Compile gate: `npx tsc -p apps/web/tsconfig.json --noEmit` must pass. Manual smoke happens in Task 8 Step 6.
- [ ] **Step 4: Commit** — `git commit -m "feat: add isometric pixi renderer for playfield"`

### Task 8: Mount the canvas — replace GridRenderer/EffectsLayer in PlayScreen

**Files:**
- Create: `apps/web/src/ui/playfield/PlayfieldCanvas.tsx`
- Modify: `apps/web/src/ui/PlayScreen.tsx` (map pane, ~:261-333)
- Modify: `apps/web/src/ui/hooks/useAutoTravel.ts` (expose `travelTo`)
- Delete: `apps/web/src/ui/GridRenderer.tsx`, `apps/web/src/ui/EffectsLayer.tsx`, `apps/web/src/ui/CellCursor.tsx`, `apps/web/src/ui/TargetingOverlay.tsx`, their tests (`apps/web/test/grid-renderer.test.tsx`, `apps/web/test/effects-layer.test.tsx`, any CellCursor/TargetingOverlay tests), the `.playfield-grid`/`.cell*`/targeting CSS blocks in `apps/web/src/styles.css`
- Test: `apps/web/test/playfield-canvas.test.tsx`; update `apps/web/test/play-screen-integration.test.tsx`

**Interfaces:**
- Consumes: `IsoRenderer` + `RendererCallbacks` + `TargetingVisual` (Task 7), `useSpellTargeting` result (`confirmAt`, `cancel`, `validCells`, `affectedCells`, `reticle`, `activeSpellId`), `useAutoTravel`.
- Produces:

```tsx
export interface PlayfieldCanvasProps {
  snapshot: SessionSnapshot;
  targeting: TargetingVisual | null;
  onCellClick: (cell: { x: number; y: number }, button: 'primary' | 'secondary') => void;
  onCellHover: (hover: { cell: { x: number; y: number }; clientX: number; clientY: number } | null) => void;
}
export function PlayfieldCanvas(props: PlayfieldCanvasProps): JSX.Element;
// useAutoTravel additionally returns:
//   travelTo(cell: { x: number; y: number }): void
```

- [ ] **Step 1: GitNexus impact** — `impact` on `GridRenderer`, `EffectsLayer`, `useAutoTravel`, `PlayScreen` (upstream). Report blast radius before editing; warn on HIGH/CRITICAL.
- [ ] **Step 2: Refactor `useAutoTravel`** — extract the body of `onClick` after its `data-cell` DOM lookup into `travelTo(cell)`; keep `onClick` delegating to it (behavior-preserving; existing tests must stay green unchanged).
- [ ] **Step 3: Write failing test** `playfield-canvas.test.tsx`: renders a host div; asserts the renderer is initialized lazily and `onCellClick` fires with the cell computed from a synthetic pointer event. Inject the renderer: give `PlayfieldCanvas` an optional `createRenderer?: (host, atlas, cb) => Pick<IsoRenderer, 'init' | 'setSnapshot' | 'setTargeting' | 'destroy'>` prop defaulting to the real class, and pass a recording fake in the test (jsdom has no WebGL — the fake is the seam, and the prop is typed, not a cast).
- [ ] **Step 4: Implement `PlayfieldCanvas`** — `useEffect` mount/destroy, `useEffect` per `snapshot` → `setSnapshot`, per `targeting` → `setTargeting`. Fetch atlas JSON once via module-level promise (`fetch(ATLAS_URL)` + `parseAtlas`); render nothing until loaded (`null`), fail loud on parse error.
- [ ] **Step 5: Rewire `PlayScreen`** map pane: replace `GridRenderer`/`EffectsLayer`/`CellCursor`/`TargetingOverlay` with `<PlayfieldCanvas>`; `onCellClick` = targeting active ? (`primary` → `targeting.confirmAt(cell)`, `secondary` → `targeting.cancel()`) : (`primary` → `autoTravel.travelTo(cell)`); `onCellHover` drives the existing `ThreatPopover`/`AssetPopover` (position them from `clientX/clientY` instead of the DOM cell rect — adjust their anchor props accordingly); keep `usePaneMeasurement` only if the probes are still referenced, otherwise remove the probe spans and the hook usage from PlayScreen (check `impact` first). Targeting visuals pass through as `{ validCells, affectedCells, reticle }` when `targeting.activeSpellId !== null`, else `null`.
- [ ] **Step 6: Update `play-screen-integration.test.tsx`** — swap grid-DOM assertions for the injected-fake-renderer seam (the test provides `createRenderer` via a new optional `PlayScreen` prop threaded to `PlayfieldCanvas`); intent-dispatch assertions (move on click, targeting confirm) stay semantically identical. Delete the dead component files + CSS blocks. Run web suite + web tsc.
- [ ] **Step 7: Manual smoke** — `npm run dev --workspace @woven-deep/web` (server running separately): floor renders isometrically, click-to-travel works, hover popovers appear, spells target correctly, stairs/door sprites show, fog states correct.
- [ ] **Step 8: detect_changes + commit** — `git commit -m "feat: replace ascii grid with isometric pixi playfield"`

### Task 9: Transient combat effects on the canvas

**Files:**
- Modify: `apps/web/src/ui/playfield/IsoRenderer.ts` (effects container)
- Create: `apps/web/src/ui/playfield/particles.ts`
- Test: `apps/web/src/ui/playfield/particles.test.ts`

**Interfaces:**
- Consumes: `SceneState.effects` (`TransientEffect[]`, kinds `hit-flash | attack-streak | death-burst`), `SceneState.hurtAt`.
- Produces: `export function spawnForEffect(effect: TransientEffect, now: number): readonly Particle[]` with `interface Particle { x: number; y: number; z: number; vx: number; vy: number; vz: number; bornAt: number; ttlMs: number; color: number; size: number; additive: boolean }`, and `export function stepParticles(particles: readonly Particle[], now: number): readonly Particle[]` (integration + gravity + expiry — pure, `Math.random` only inside `spawnForEffect` velocities).

- [ ] **Step 1: Write failing tests:** `spawnForEffect` returns >0 particles per kind with sane ttl; `stepParticles` removes expired particles and advances positions; death-burst spawns more particles than hit-flash.
- [ ] **Step 2: Run → fail → implement → pass.**
- [ ] **Step 3: Wire into `IsoRenderer`** ticker: new effects from `setSnapshot` spawn once (key by `TransientEffect.key`, cap `MAX_TRANSIENT_EFFECTS`), particles render as additive/normal circles in the effects container; floating damage text for hit-flash/death (small `Text` rising, ported from the demo's `float`). Hurt vignette + shake from `hurtAt` if not already done in Task 7.
- [ ] **Step 4: Manual smoke (dev server), typecheck, commit** — `git commit -m "feat: render combat effects on the pixi playfield"`

### Task 10: Full-bleed layout + top bar + floating log/minimap

**Files:**
- Create: `apps/web/src/ui/panels/TopBar.tsx`
- Modify: `apps/web/src/ui/PlayScreen.tsx` (layout), `apps/web/src/ui/panels/LogPanel.tsx` (float variant), `apps/web/src/ui/panels/MinimapPanel.tsx` (float restyle), `apps/web/src/ui/panels.tsx` (barrel)
- Delete: `apps/web/src/ui/panels/StatusBar.tsx`, `apps/web/src/ui/HintStrip.tsx`, `apps/web/src/ui/panels/ThreatPanel.tsx`, `apps/web/src/ui/panels/SpellsPanel.tsx`, `apps/web/src/ui/panels/HeroPanel.tsx` + their tests
- Test: `apps/web/test/top-bar.test.tsx`; update `apps/web/test/play-screen-integration.test.tsx`

**Interfaces:**
- Consumes: `heroOf(projection).currency` (Task 1), `projection.floor.town`/`depth`, turn count from the same source `StatusBar.tsx` reads today (copy its exact expression before deleting), `snapshot.log`.
- Produces: `TopBar({ snapshot }: { snapshot: SessionSnapshot })` — title, location label (town name or `DEPTH N`, reuse StatusBar's location logic), `⛁ <currency> gold`, turn count (muted).

- [ ] **Step 1: GitNexus impact** on `StatusBar`, `HeroPanel`, `SpellsPanel`, `ThreatPanel`, `HintStrip`, `LogPanel`, `MinimapPanel`; check `TownPanel` reachability: enumerate every affordance TownPanel renders and verify each has another path (trade via adjacency + `t`/palette, dialogue via adjacency, house via `h`, stairs via keys). If any affordance is TownPanel-only, keep TownPanel mounted as a floating town-mode panel instead of deleting it — record which way it went in the commit message. TownPanel itself is NOT in the delete list until this check passes.
- [ ] **Step 2: Write failing `top-bar.test.tsx`:** renders location for town and `DEPTH 3` for depth-3 floors; shows `32 gold` from `hero.currency`; shows turn count.
- [ ] **Step 3: Implement TopBar** (styling: absolute top, `bg-gradient-to-b from-black/85 to-transparent`, serif title with letter-spacing per design, mono body — tokens from `tokens.css`).
- [ ] **Step 4: Restyle LogPanel and MinimapPanel** as floating chrome (log: absolute bottom-left, last 5 lines, keep `aria-live` and tone classes; minimap: absolute top-right, bordered, translucent `bg-deep/70`). Keep their component names and test-visible semantics; their existing tests keep passing (assert on roles/text, not position).
- [ ] **Step 5: Rewire PlayScreen layout:** root becomes a full-viewport relative container; `PlayfieldCanvas` absolute inset-0; `TopBar`, minimap, log, popovers, overlays float above. Remove StatusBar/right-rail/bottom-strip regions and deleted components. Add the accessibility live region: keep `HeroStatusAnnouncer` mounted, and add an off-screen `<div role="status" class="sr-only">` describing hero cell surroundings on change (reuse the announcement text source `hero-announce.ts` if it already covers this — check with `impact` before adding a second announcer; do not duplicate an existing one).
- [ ] **Step 6: Update integration test, delete dead files, run web suite + tsc, knip (deleted files must not leave dead exports), detect_changes, commit** — `git commit -m "feat: full-bleed hud with top bar and floating log and minimap"`

### Task 11: Action bar — gauges, belt, cast, hints

**Files:**
- Create: `apps/web/src/ui/panels/ActionBar.tsx`, `apps/web/src/ui/panels/Gauge.tsx`
- Modify: `apps/web/src/ui/PlayScreen.tsx` (mount), `apps/web/src/ui/KeyRouter.ts` + `apps/web/src/session/settings.ts` (add `use-belt-1` action bound to `1` — follow the existing `ActionId`/`DEFAULT_BINDINGS` pattern)
- Test: `apps/web/test/action-bar.test.tsx`, extend `apps/web/src/ui/KeyRouter.test.tsx` if present (else `apps/web/test/` equivalent)

**Interfaces:**
- Consumes: `heroOf(projection)` (`health/maxHealth/weave/maxWeave/backpack/castableSpells`), `session.dispatch`, `targeting.begin(spellId)`, potion predicate from `apps/web/src/ui/overlays/inventory-model.ts` (reuse its consumable/potion filter — do NOT hand-roll a category check; if no reusable predicate exists there, extract the one InventoryOverlay's filter uses into `inventory-model.ts` and use it in both places).
- Produces: `ActionBar({ snapshot, session, onBeginCast }: { snapshot: SessionSnapshot; session: RunSession; onBeginCast: (spellId: string) => void })`. `Gauge({ label, value, max, tone }: { label: string; value: number; max: number; tone: 'hp' | 'weave' })` — SVG arc dial (radius 44, stroke 8, sweep 270°, `value/max` fraction, danger color pulse below 25% for hp), value text underneath (`{value} / {max}`), top microlabel `LIFE-THREAD` / `WEAVE`.

- [ ] **Step 1: Write failing tests:** belt shows up to 4 potion slots from the hero backpack; clicking slot N dispatches `{ type: 'backpack', action: 'use', itemId: <that potion's id> }`; empty slots render inert (no dispatch); cast button hidden when `castableSpells` is empty/absent and calls `onBeginCast(firstSpell.spellId)` when present; keybind `1` routes to using the first belt potion (KeyRouter test: `routeKey` with the new action returns a new `RouterOutcome` variant `{ type: 'use-belt-slot'; slot: 0 }` — KeyRouter has no snapshot access, so `usePlayKeyDispatcher` gains a handler that resolves the slot to the potion's `itemId` from the current snapshot and dispatches the backpack-use intent; extend `KeyDispatchHandlers` accordingly).
- [ ] **Step 2: Run → fail → implement.** Gauge is presentational (snapshot-testable via role/text; arc math trivial). Hint line: static list derived from the *resolved keymap* labels (`keymap` already flows into PlayScreen) — move · `i` pack · `c` hero · `g` pickup · `1` drink · `⌘K` commands.
- [ ] **Step 3: Run suite, tsc, detect_changes, commit** — `git commit -m "feat: add action bar with vitals gauges and potion belt"`

### Task 12: Death overlay

**Files:**
- Create: `apps/web/src/ui/overlays/DeathOverlay.tsx`
- Modify: `apps/web/src/App.tsx` (GameRoot conclusion effect, ~:185-209), `apps/web/src/ui/PlayScreen.tsx`
- Test: `apps/web/test/death-overlay.test.tsx`

**Interfaces:**
- Consumes: `SceneState.concludedByDeath` predicate from Task 5 (reuse the same exported predicate — extract `export function concludedByDeath(snapshot: SessionSnapshot): boolean` into `scene-state.ts` if Task 5 left it inline); GameRoot's `onConcluded` flow.
- Produces: `DeathOverlay({ onAcknowledge }: { onAcknowledge: () => void })` — fixed inset-0 z-50, `bg-black/70`, serif `THE DEEP TAKES YOU` in danger color with letter-spacing, subline `the Weave remembers · press enter or click to continue`; Enter keydown and click both call `onAcknowledge`.

- [ ] **Step 1: GitNexus impact** on the GameRoot conclusion effect/`onConcluded` chain.
- [ ] **Step 2: Write failing tests:** death-concluded snapshot renders the overlay; Enter and click call `onAcknowledge` once; non-death conclusion (e.g. victory) renders no overlay and routes immediately (assert via a spy on the routing callback in a GameRoot-level test or the existing integration test).
- [ ] **Step 3: Implement:** GameRoot keeps finalizing the run in its effect exactly as today (repository write timing unchanged — determinism/records unaffected), but when the conclusion is a death it defers the `onConcluded(...)` navigation call behind the overlay's `onAcknowledge`; non-death conclusions navigate immediately as today.
- [ ] **Step 4: Run suite, tsc, detect_changes, commit** — `git commit -m "feat: add death overlay before conclusion screen"`

### Task 13: Restyle Pack & Gear as the design's slide-in panel

**Files:**
- Modify: `apps/web/src/ui/overlays/InventoryOverlay.tsx`, `apps/web/src/ui/overlays/EquipmentSlots.tsx`, `apps/web/src/ui/overlays/DetailPane.tsx` (styling + layout only), possibly `apps/web/src/ui/overlays/OverlayHost.tsx` (side-sheet variant)
- Test: existing inventory overlay tests must pass **unchanged**

**Interfaces:**
- Consumes: everything the overlay already consumes. No new intents, no removed actions.
- Produces: same component API; visual change only — fixed right panel (width 430px, `bg-surface border-l border-line`, slide-in animation), header `PACK & GEAR` + `✕ esc`, equipped 3×3 grid on top, filter chips, item rows (`glyph · name · EQ badge · ×qty`, accent left-edge on selection), detail section at bottom (serif name, category tag chip, description, dotted-leader stat rows, action buttons). No "Condition"/"IDENTIFIED" fields (spec §Panels).

- [ ] **Step 1:** If `OverlayHost`'s Sheet cannot render a right-anchored panel, add a `side: 'right'` option to the registry entry type (typed, minimal). `impact` on `OverlayHost` first.
- [ ] **Step 2: Restyle.** Keyboard nav, filters, and every action stay wired to the same handlers. Run the existing inventory tests — they must pass with zero assertion edits (behavioural rule; class-name/test-infrastructure edits in test *setup* are not expected either since tests query by role/text).
- [ ] **Step 3: Manual smoke (dev server), tsc, detect_changes, commit** — `git commit -m "feat: restyle inventory as slide-in pack and gear panel"`

### Task 14: Restyle Hero Record as the design's slide-in panel

**Files:**
- Modify: `apps/web/src/ui/overlays/CharacterSheetOverlay.tsx` (styling/layout only)
- Test: existing character-sheet tests pass unchanged

**Interfaces:** same as Task 13 pattern. Sections in design order with dotted-leader rows: identity header (`@` glyph box, serif name, class, location), `· ─ ATTRIBUTES ─ ·`, `DERIVED STATS` (labels via the existing `ui/derived-stats-display` — do not re-declare label maps), `VITALS` (health/weave/hunger/sight radius), `EQUIPMENT`, `RUN STATISTICS` (existing `projection.metrics` fields only — nothing invented).

- [ ] **Step 1: Restyle; run existing tests unchanged; manual smoke.**
- [ ] **Step 2: tsc, detect_changes, commit** — `git commit -m "feat: restyle character sheet as hero record panel"`

### Task 15: Cleanup, docs, full gate, PR

**Files:**
- Modify: `apps/web/src/styles.css` (purge dead gameplay CSS), `docs/design/` (add/update the gamefield-presentation doc — Golden Rule 7)
- Delete: any file knip flags from this branch's work

**Steps:**

- [ ] **Step 1: Write the `docs/design/` doc** — `docs/design/gamefield-presentation.md` (or update the existing UI doc if one covers the gamefield — check `ls docs/design/`): current-state description of the playfield module (layer stack, data flow snapshot→scene-state→renderer, WFC skinning rule, HUD composition, what is presentation-only). Present tense, no lineage narration.
- [ ] **Step 2: Full gate**, in order: content build → engine build → web tsc → server tsc → `npm run verify` → demo replays (`npm run gameplay:demo` etc.). Zero lint errors, zero knip findings, zero new depcruise cycles, pristine test output.
- [ ] **Step 3: Playtest pass** (dev server): new run → walk, fight, pick up, drink from belt, cast, descend, town visit (trade/dialogue/house reachable), open every overlay, die on purpose → death overlay → conclusion.
- [ ] **Step 4: `detect_changes({scope: "compare", base_ref: "main"})`** — confirm the affected-symbol set matches this plan (playfield module, PlayScreen composition, deleted panels, projection currency, KeyRouter belt action; nothing else).
- [ ] **Step 5: Push and open the PR** — title `feat: gamefield pixi redesign`; body lists the spec link, what changed, verification (full gate + playtest), the demo-hash note from Task 1 if a hash was re-pinned, and `Closes` any related issue. Request review per repo convention.
