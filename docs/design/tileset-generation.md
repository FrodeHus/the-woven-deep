# Tileset Generation Guide

Prompt + atlas contract for generating an isometric tileset that drops into the Woven Deep
playfield renderer (`apps/web/src/ui/playfield/`). Every row maps to something the game actually
renders: terrain tokens (`terrain.wall/floor/door/pillar/stair/void` — `packages/engine/src/terrain.ts`),
the `fixture.lamp` light fixture, locked features, and the town vault's placement slots
(merchant stalls, house door, dungeon entrance). There are no decorative-prop rows: the game has
no such objects, and a sprite without a game entity behind it never renders.

## Image-generation prompt

```
Isometric dungeon-and-town tileset sprite sheet, single 1024x1024 PNG, solid magenta background
(#ff00ff) everywhere art is absent — fill every gap and cell margin with flat #ff00ff, no
gradient, no transparency. ONE SHEET, mixing materials by row group — dungeon rows and town rows
share the same grid and discipline but carry different masonry.

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
- THE WHOLE BLOCK FITS INSIDE ITS CELL, with a margin of at least 2 px of background on all four
  sides. Nothing may touch a cell border: not the diamond apex, not the left/right corners, not a
  wall cube's top face. A block drawn larger than its cell gets guillotined by the machine slicer
  — a wall cube with its apex or side corners cut off renders in-game as a sawtooth zigzag along
  every wall run. If a cube looks too big to fit with the margin, draw it smaller; the renderer
  scales tiles up, never the other way.
- Every tile is built on the SAME isometric footprint: a 2:1 diamond top exactly 128 px wide and
  64 px tall, apex at y=16 in-cell, left/right corners at y=48, bottom corner at y=80. Blocks
  extend straight down 48 px below the diamond (base at y=128). Flat items sit ON this diamond.
- The 2:1 band footprint remains the canonical form; the renderer additionally tolerates full-cell 1:1 floor diamonds by squashing flat-floor families onto the 2:1 footprint at bake time, but wall and object tiles must follow the band form.
- Camera: classic 2:1 isometric, no perspective, no rotation variance between tiles.
- ONE FLOOR PLANE: every walkable top face occupies that exact diamond. Flat tiles must show NO
  side wall or kerb rising above it. Only wall cubes, rounded rocks, and standing objects may
  extend upward.
- Lighting: single hard-ish key light from upper-left, identical across all tiles. NO cast
  shadows on the ground outside the block.
- ABSOLUTELY NO ground plate, contact shadow, soft halo, or vignette under any tile: the magenta
  ends EXACTLY at the block's own silhouette (this silhouette becomes the alpha edge after keying).
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
- Row 5: TOWN terrain: cols 0-1 cobbled plaza floors (warm grey cobbles). READ THIS TWICE — the
  cobble floors are FLAT FLOOR TILES exactly like row 0: the cobbled surface fills the whole
  diamond corner to corner at floor height, with NO timber trim, NO beam, NO kerb, NO fence, NO
  edging of any kind along any edge of the diamond, and no side faces rising above the floor
  plane. A cobble tile with a wooden border reads in-game as a raised planter box, and a plaza
  tiled with them turns into a woven lattice of beams. Only the stone texture may vary between
  the two variants. Then: cols 2-3 town building walls (timber-and-plaster over stone footing —
  these are the WALL cubes, the only place timber framing belongs), col 4 house door (heavier,
  dwelling-grade, distinct from the dungeon door), col 5 dungeon-entrance stair surround (worked
  stone arch around a descending well), col 6 lamp post (unlit, brass fittings), col 7 hanging
  shop sign on bracket.
- Row 6: TOWN market stalls & dressing: col 0 provisioner stall (sacks, bread, produce), col 1
  arms stall (racked blades, shield), col 2 curios stall (odd trinkets, bottles, threads), col 3
  spell-vendor stall (scrolls, candles, faint violet glow), col 4 empty stall counter with
  awning, col 5 stacked wares crate, col 6 notice board, col 7 town well.
- Row 7: reserved — extra floor/wall variants in either material, for future variety.

COMPANION ANIMATION SHEET — tiles-anim.png (OPTIONAL; nothing in the renderer consumes it yet, and
the light layer already drives procedural shimmer, so the game ships fine without it). Single
separate 1024x1024 PNG, same 8x8 grid, same palette, same footprint and apex anchor — not
per-biome. RECOMMENDED ALTERNATIVE — instead of an 8-frame loop per row (which is hard to keep
frame-consistent), author a single-frame EMISSIVE OVERLAY row: one static bright frame each of the
lamp flame, the Weave threads, and the stairs-down glow, on the same solid-magenta background. The
engine animates these procedurally (alpha/scale breathing on the light layer), which sidesteps the
frame-matching problem entirely.

ANIMATION RULES (only if authoring the full multi-frame sheet rather than the recommended overlay):
- MOVING PART ONLY: a frame contains ONLY the thing that moves, on solid magenta — flame, glow,
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
  cube, stone replaced by magenta; glow pulses and travels along the threads, brightest at frame 3-4.
- Row 2: STAIRS-DOWN WEAVE GLOW — violet light only (#a06cff), no steps or stone; a soft pool
  rising out of the stair well, breathing dim-to-bright over 8 frames, never bright enough to
  read as fire.
- Rows 3-7: reserved — leave as solid magenta (the renderer falls back to procedural shimmer,
  so partial sheets are safe to ship).
```

## Start from the template

Free-form generation drifts off the 128px pitch often enough that a supplied structural template
raises the hit rate. Generate one and feed it back to the generator in image-edit (img2img) mode
instead of starting from a blank prompt:

```bash
python3 tools/make-template.py --sheet tiles
```

Attach `template-tiles.png` as the edit-mode source image alongside the prompt above, with an
instruction such as "paint one sprite per cell, keep every sprite inside its cell's inner guide
box, do not paint over or remove the magenta guide lines, leave unused cells untouched." The guide
lines are drawn in a near-magenta that `key-tilesheet.py` strips along with the background, so they
never survive into the keyed sheet — they only exist to anchor the model's grid. This raises the
hit rate but does not replace verification: the measured slicer (`slice-tilesheet.py`) remains the
safety net for whatever the generator actually produces.

## Import pipeline

Generators cannot emit alpha, so the sheet arrives with a solid magenta background. Transparency is
produced by the keying tool, not the generator:

1. **Generate** the 1024×1024 PNG from the prompt above (solid #ff00ff wherever art is absent).
2. **Key** it into place:

   ```bash
   python3 tools/key-tilesheet.py in.png apps/web/public/playfield/tiles.png
   ```

   The tool samples the corner background colour, keys within `--tolerance` (default 60) under a
   `g < r && g < b` magenta guard so warm stone and violet Weave art survive, and de-fringes the
   edges. It prints a warning if the corners are not fully transparent (raise `--tolerance`).
3. **Verify in-game**: rebuild the web app, restart the server, and load the town — cobbles and
   dungeon floors should tessellate seamlessly with no magenta halo around any tile.

## Atlas contract

The renderer slices by explicit rects in `apps/web/public/playfield/atlas-unified.json`
(`parseAtlas` in `apps/web/src/ui/playfield/atlas.ts` is the schema authority). For a sheet
generated on the strict grid above, a cell at column `c`, row `r` slices as
`[c*128, r*128, 128, 128]`. A sheet that misses the strict grid — hand-laid on an uneven pitch, or
with per-row counts that vary — can still be imported via `tools/slice-tilesheet.py`, which measures
each tile's tight rect from the alpha-keyed art automatically instead of assuming the grid.

`atlas-unified.json` is the live atlas: the game loads it (`ATLAS_URL`) and renders from
`tiles.png` on this 8×8 grid, with `blockDepthPx: 48` (this grid's block depth). The stair
direction picks the rect at bake time — `stairsUp` for tileId 4, `stairs` (the down-well) for
tileId 5. The companion `tiles-anim.png` animation sheet is optional; the renderer falls back to
procedural shimmer when it is absent.

Keys and what consumes them, by status:

- **rendered** — blitted to the canvas today from live engine state.
- **parsed, not drawn** — `parseAtlas` validates and exposes the rect, but no draw call reads it
  yet; the feature it belongs to renders through a different path in the meantime.
- **reserved** — validated by the schema but nothing in the engine or renderer can trigger it;
  the slot exists for art that hasn't been wired up yet.

| Key | Game visual | Status |
|---|---|---|
| `floors[]`, `dirty[]` | `terrain.floor` cells (seeded WFC variant selection) | rendered |
| `walls[]`, `rounded[]`, `weaveWalls[]` | `terrain.wall` cells (topology decides shape) | rendered |
| `stairs` | `terrain.stair` down-well (tileId 5) | rendered |
| `stairsUp` | `terrain.stair` up (tileId 4) | rendered |
| `door` | `terrain.door` terrain cell + a closed door FEATURE (`IsoRenderer.featureSprite`) | rendered |
| `gate` | **locked DOOR features only** (`featuresOf` projection entries) — restricted to `type: 'door'`; locked chests fall back to a glyph | rendered |
| `pillar` | `terrain.pillar` | rendered |
| `townFloors[]`, `townWalls[]` | town vault terrain (plaza floor / building wall placement slots) | rendered |
| `houseDoor` | town vault house-door placement slot | rendered |
| `torch`, `torchWall` | `fixture.lamp` light fixtures — baked as a standing sprite in ADDITION to the light pool; `torchWall` mounts against an orthogonally adjacent wall, `torch` stands free (`floor-bake.ts`) | rendered |
| `archOpen` (OPTIONAL) | open-door feature archway — absent in the current sheet, so `parseAtlas` leaves it `undefined` and an open door falls back to a glyph until the art ships | reserved |
| `entranceSurround` | town vault dungeon-entrance — DEMOTED (user decision): the town entrance now renders the `stairs` down-well like dungeon floors, so nothing draws this | reserved |
| `pillarBroken` | no engine token maps to it — `tile-skinning.ts`'s `familyForToken` never produces `pillar-broken` from any terrain kind, so the branch in `floor-bake.ts` that reads it is unreachable | reserved |
| `lampPostUnlit`, `shopSign` | town dressing — not yet placed by the town vault | reserved |
| `stalls.provisioner`, `stalls.arms`, `stalls.curios`, `stalls.spellvendor` | town merchant-stall dressing — not yet placed by the town vault | reserved |
| `stallCounter`, `waresCrate`, `noticeBoard`, `townWell` | town dressing — not yet placed by the town vault | reserved |

The `reserved` tier is not an exception to "no dead data" — it is the tier that keeps the rule
coherent. Those keys are deliberately held for dressing the town vault's row layout already
describes, and the schema validates them so wiring one up later is a renderer change, not an
atlas-format change. A key earns `reserved` status by having a concrete planned consumer in this
doc; a key with no engine counterpart and no such rationale is dead data and gets rejected in
review.
