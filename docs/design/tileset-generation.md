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
