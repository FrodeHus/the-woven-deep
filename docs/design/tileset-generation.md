# Tileset Generation Guide

Prompt + atlas contract for generating an isometric tileset that drops into the Woven Deep
playfield renderer (`apps/web/src/ui/playfield/`). Every row maps to something the game actually
renders: terrain tokens (`terrain.wall/floor/door/pillar/stair/void` — `packages/engine/src/terrain.ts`),
the `fixture.lamp` light fixture, locked features, and the town vault's placement slots
(merchant stalls, house door, dungeon entrance). There are no decorative-prop rows: the game has
no such objects, and a sprite without a game entity behind it never renders.

## Image-generation prompt

```
Isometric dungeon-and-town tileset sprite sheet, single 1024x1024 PNG, fully transparent
background. ONE SHEET, mixing materials by row group — dungeon rows and town rows share the same
grid and discipline but carry different masonry.

MATERIALS:
  DUNGEON rows — pale blue-grey worked/cut limestone blocks, moss-green floor slab accents, navy
    shadow, warm amber lamplight.
  TOWN rows — warm grey cobbles, timber-and-plaster over stone footings, oiled wood, brass lamp
    fittings.

Both materials keep the same discipline across the whole sheet: cool desaturated stone, one warm
accent, flat value steps.

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
- CHUNKY MASONRY: roughly 3x3 large stones per wall face (dungeon), or timber framing over stone
  footing (town); clean mortar/joint lines either way. Never gravel noise.
- LOW TEXTURE NOISE: detail from shape and value; a few deliberate cracks, no grime spatter.
- LIMITED COOL PALETTE (~8-10 colours across the whole sheet); warm light against cool stone is
  the entire colour story, in both materials.
- CRISP EDGES, no outlines; silhouette-first — every object readable as a black shape at 32 px.
- No text, no watermark, no border. Apply the row's material consistently across its own row.
- AVOID: painterly dark-fantasy rendering, muddy realism, photoreal textures, gradient-heavy
  shading, flourish detail that vanishes at game scale.

ROW LAYOUT (row 0 = top; fill every cell):
- Row 0: 8 clean DUNGEON floor slabs — pale blue-grey limestone, moss-green accents, subtle
  variation only. Must tile seamlessly.
- Row 1: 8 DIRTY dungeon floor variants — mud-tracked, stained, soot-scorched, damp sheen, moss
  patches, dust drifts, straw-flecked, rubble-flecked.
- Row 2: 8 dungeon WALL cubes — full-height sharp-edged limestone blocks: cols 0-3 plain, cols
  4-5 weathered/cracked, cols 6-7 with luminous violet Weave-conduit threads across the faces.
- Row 3: 8 ROUNDED dungeon wall pieces, same height, eroded silhouettes, cols 0-7: outer-corner
  boulders rounded toward NE, SE, SW, NW, then 2 end-cap stubs, then 2 lone rock masses.
- Row 4: dungeon STAIRS & PASSAGES: col 0 stairs-down (steps cut INTO the floor plane, a well,
  never a raised platform; stone painted unlit — the violet glow is animated separately), col 1
  stairs-up (steps rising against a wall block), col 2 closed wooden door in stone frame, col 3
  iron-barred gate (locked passage), col 4 stone pillar, col 5 broken pillar stump, col 6
  wall-mounted lamp (lit), col 7 free-standing lamp post (lit).
- Row 5: TOWN terrain: cols 0-1 cobbled plaza floors (warm grey cobbles), cols 2-3 town building
  walls (timber-and-plaster over stone footing), col 4 house door (heavier, dwelling-grade,
  distinct from the dungeon door), col 5 dungeon-entrance stair surround (worked stone arch
  around a descending well), col 6 lamp post (unlit, brass fittings), col 7 hanging shop sign on
  bracket.
- Row 6: TOWN market stalls & dressing: col 0 provisioner stall (sacks, bread, produce), col 1
  arms stall (racked blades, shield), col 2 curios stall (odd trinkets, bottles, threads), col 3
  spell-vendor stall (scrolls, candles, faint violet glow), col 4 empty stall counter with
  awning, col 5 stacked wares crate, col 6 notice board, col 7 town well.
- Row 7: reserved — extra floor/wall variants in either material, for future variety.

COMPANION ANIMATION SHEET — tiles-anim.png (single separate 1024x1024 PNG, same 8x8 grid, same
palette, same footprint and apex anchor — not per-biome).

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

The renderer slices by explicit rects in `apps/web/public/playfield/atlas-unified.json`
(`parseAtlas` in `apps/web/src/ui/playfield/atlas.ts` is the schema authority). For a sheet
generated on the strict grid above, a cell at column `c`, row `r` slices as
`[c*128, r*128, 128, 128]`.

`atlas-unified.json` is the live atlas: the game loads it (`ATLAS_URL`) and renders from
`tiles.png` on this 8×8 grid, with `blockDepthPx: 48` (this grid's block depth). The stair
direction picks the rect at bake time — `stairsUp` for tileId 4, `stairs` (the down-well) for
tileId 5. The companion `tiles-anim.png` animation sheet is optional; the renderer falls back to
procedural shimmer when it is absent.

Keys and what consumes them:

| Key | Game visual |
|---|---|
| `floors[]`, `dirty[]` | `terrain.floor` cells (seeded WFC variant selection) |
| `walls[]`, `rounded[]`, `weaveWalls[]` | `terrain.wall` cells (topology decides shape) |
| `stairs` | `terrain.stair` (tileId 4 up / 5 down) |
| `door` | `terrain.door` |
| `gate` | locked features (`featuresOf` projection entries) |
| `pillar`, `pillarBroken` | `terrain.pillar` |
| `torch`, `torchWall` | `fixture.lamp` light fixtures |
| `townFloors[]`, `townWalls[]` | town vault terrain (plaza floor / building wall placement slots) |
| `houseDoor` | town vault house-door placement slot |
| `entranceSurround` | town vault dungeon-entrance placement slot |
| `lampPostUnlit`, `shopSign` | town vault dressing placement slots |
| `stalls.provisioner`, `stalls.arms`, `stalls.curios`, `stalls.spellvendor` | town vault merchant-stall placement slots |
| `stallCounter`, `waresCrate`, `noticeBoard`, `townWell` | town vault dressing placement slots |

Do not add atlas keys for assets the game cannot render — a key with no engine counterpart is
dead data and gets rejected in review.
