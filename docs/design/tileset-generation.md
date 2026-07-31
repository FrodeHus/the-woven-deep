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

MOOD — DARK GOTHIC DUNGEON, oppressive and old. Think a cursed undercroft nobody has cleaned in
three hundred years, lit by a single guttering torch you are carrying. Not a snowfield, not a
museum, not a clean fantasy keep. The sheet should feel like something is already down here with
you.

VALUE RANGE — THIS IS THE MOST IMPORTANT RULE ON THE SHEET. The whole tileset lives in the bottom
half of the value scale:
- The LIGHTEST tone anywhere on a floor tile is a MID-GREY (roughly #6b6a68 / 42% luminance). No
  white. No off-white. No pale grey. If a floor reads as "light stone", it is wrong — darken it.
- Typical worked stone sits in charcoal (#33322f–#4a4844). Side faces drop to deep shadow
  (#24262a–#1c1d20). Recesses, joints, and stairwell mouths go near-black (#0e0f12), never pure
  black.
- Only two things may exceed mid-grey: an actual flame/ember source, and the violet Weave glow.
  Everything else stays under it.

MATERIALS:
  DUNGEON rows — cold charcoal granite and soot-darkened limestone, blocks worked long ago and
    left to rot: black mortar joints, hairline cracks, damp seepage streaks running down from
    joints, dark olive-black moss creeping out of the shadowed edges, rust bleeding from old iron
    fittings, sparse dried-blood umber staining (#4a1f1c) — used SPARINGLY, a stain or two per
    sheet, never gore.
  TOWN rows — soot-grey cobbles worn slick, weathered near-black timber over damp stone footings,
    tarnished dull brass, oiled dark wood. The town is a huddle against the dark, not a bright
    market — same value range as the dungeon, just slightly warmer in hue.

Both materials keep the same discipline: near-monochrome dark stone carrying the whole sheet, with
colour arriving only as (a) WARM FIRELIGHT — amber/ember orange (#c8712f, #e08b3a) implied as
though a torch were just off-frame, catching only the upper-left edges and top faces, and (b) the
ARCANE ACCENT — luminous violet Weave-glow (#7c4fd0 core, #a06cff hot centre) on conduit threads
and stair wells. Warm light and violet glow are the ONLY saturated colours; everything they do not
touch falls away into charcoal and black.

DECAY: every surface is old. Cracked masonry, chipped corners, blocks slumped out of true, grime
gathered in every joint, moss and mineral crust where water has run. Age reads through SHAPE and
VALUE (broken edges, dark recesses), not through noise spatter.

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
- Lighting: single hard-ish WARM key light from upper-left — implied torchlight, amber, weak.
  Identical across all tiles. It grazes; it does not flood. The unlit faces fall to near-black
  rather than to a lighter fill. NO cast shadows on the ground outside the block.
- ABSOLUTELY NO ground plate, contact shadow, soft halo, or vignette under any tile: the magenta
  ends EXACTLY at the block's own silhouette (this silhouette becomes the alpha edge after keying).
- QC: imagine each tile composited on pure magenta — nothing may darken the magenta except the
  block itself.

STYLE — CLEAN CEL-SHADED GAME ART IN A DARK REGISTER, not painterly illustration:
- FLAT VALUE STEPS, not gradients. Top face lightest (still only mid-grey), the two side faces two
  distinct darker values, the lower side face near-black. Three nameable values per block. No
  airbrush, no glossy specular.
- CHUNKY MASONRY: roughly 3x3 large stones per wall face (dungeon), or timber framing over stone
  footing (town); black mortar/joint lines either way — joints read as dark gaps, not light lines.
  Never gravel noise.
- LOW TEXTURE NOISE: detail from shape and value; deliberate cracks, chipped corners, seepage
  streaks. No grime spatter, no random speckling.
- LIMITED DARK PALETTE (~8-10 colours across the whole sheet): charcoal, deep shadow, near-black,
  a dark olive, a rust umber, plus amber firelight and violet Weave. Warm light and violet glow
  against near-black stone is the ENTIRE colour story, in both materials.
- CRISP EDGES, no outlines; silhouette-first — every object readable as a black shape at 32 px.
  Because the art itself is dark, silhouette separation comes from the warm rim on the lit edges,
  so keep that upper-left edge light crisp and unbroken on every block.
- No text, no watermark, no border. Apply the row's material consistently across its own row.
- AVOID: anything pale, frosty, icy, snowy, chalky, whitewashed, or bleached; bright even
  daylight; clean new-built stone; muddy photoreal realism; gradient-heavy painterly rendering;
  flourish detail that vanishes at game scale.

PASTE-READY MOOD LINE (append to any per-row prompt): "dark gothic dungeon tileset, charcoal and
near-black worked stone, deep shadow recesses, damp grime and moss in the joints, rust and old
stains, lightest tone no brighter than mid-grey, single weak warm torchlight from upper-left,
luminous violet arcane glow as the only other colour, clean cel-shaded flat value steps, grim and
oppressive, no white, no pale stone, no daylight."

ROW LAYOUT (row 0 = top; fill every cell):
- Row 0: 8 clean DUNGEON floor slabs — charcoal granite, black joints, dark olive moss creeping
  from the edges, subtle variation only. Lightest tone mid-grey at most. Must tile seamlessly.
- Row 1: 8 DIRTY dungeon floor variants — mud-tracked, grime-blackened, soot-scorched, damp
  seepage sheen, moss-choked, dust drifts, straw-flecked, rubble-flecked. Darker than row 0, and
  at most ONE of the eight carries a faint old dried-blood stain (#4a1f1c), never more.
- Row 2: 8 dungeon WALL cubes — full-height sharp-edged charcoal blocks, soot-darkened, warm rim
  light along the upper-left edges only: cols 0-3 plain, cols 4-5 weathered/cracked with rust
  bleed from old iron pins, cols 6-7 with luminous violet Weave-conduit threads glowing across the
  faces (the threads are the brightest thing on the sheet; the stone around them stays near-black).
- Row 3: 8 ROUNDED dungeon wall pieces, same height, eroded silhouettes, cols 0-7: outer-corner
  boulders rounded toward NE, SE, SW, NW, then 2 end-cap stubs, then 2 lone rock masses.
- Row 4: dungeon STAIRS & PASSAGES: col 0 stairs-down, col 1 stairs-up (both per the STAIR
  SILHOUETTE rules below), col 2 closed wooden door — SOUTH-FACING wall plane (see the DOOR FORM
  rules below), col 3 iron-barred gate, locked passage — SOUTH-FACING plane, col 4 stone pillar,
  col 5 broken pillar stump, col 6 wall-mounted lamp (lit), col 7 free-standing lamp post (lit).
- Row 5: TOWN terrain: cols 0-1 cobbled plaza floors (soot-grey cobbles, worn slick, black grout).
  READ THIS TWICE — the cobble floors are FLAT FLOOR TILES exactly like row 0: the cobbled surface
  fills the whole diamond corner to corner at floor height, with NO timber trim, NO beam, NO kerb,
  NO fence, NO edging of any kind along any edge of the diamond, and no side faces rising above the
  floor plane. A cobble tile with a wooden border reads in-game as a raised planter box, and a
  plaza tiled with them turns into a woven lattice of beams. Only the stone texture may vary
  between the two variants. Then: cols 2-3 town building walls (weathered near-black timber over
  damp stone footing — these are the WALL cubes, the only place timber framing belongs), col 4
  house door (heavier, dwelling-grade, distinct from the dungeon door — SOUTH-FACING plane), col 5
  dungeon-entrance stair surround (worked stone arch around a descending well), col 6 lamp post
  (unlit, tarnished brass fittings), col 7 hanging shop sign on bracket, weathered and unpainted.
- Row 6: TOWN market stalls & dressing: col 0 provisioner stall (sacks, bread, produce), col 1
  arms stall (racked blades, shield), col 2 curios stall (odd trinkets, bottles, threads), col 3
  spell-vendor stall (scrolls, candles, violet glow), col 4 empty stall counter with awning, col 5
  stacked wares crate — this doubles as the CLOSED chest (see CHEST STATES below), col 6 notice
  board, col 7 town well. Stall canvas is dark and travel-stained; the only brightness is
  candlelight and the spell-vendor's violet.
- Row 7: EAST-FACING passage forms and CHEST STATES: col 0 closed wooden door, EAST-FACING plane;
  col 1 iron-barred gate, EAST-FACING plane; col 2 open archway, SOUTH-FACING plane; col 3 open
  archway, EAST-FACING plane; col 4 chest OPEN/looted; col 5 chest JAMMED; col 6 chest LOCKED; col
  7 house door, EAST-FACING plane.

DOOR FORM — the doors, gates and arches must be drawn as PROPER 45° ISOMETRIC SOLIDS sitting in
the wall plane, matching the row-2 wall cubes' perspective exactly: a visible top edge (the door
frame's upper surface receding at the same 2:1 slope as a wall cube's top face) plus ONE receding
side face. They are NOT flat camera-facing elevations. A flat elevation cannot be mirrored to serve
the other passage axis, which is why each passage feature is authored twice:
- SOUTH-FACING (`...SouthFace`): the frame lies in the wall plane that recedes down-and-right —
  the same plane as a wall cube's lower-right side face. The door leaf faces down-left toward the
  camera-left.
- EAST-FACING (`...EastFace`): the frame lies in the wall plane that recedes down-and-left — the
  same plane as a wall cube's lower-left side face. The door leaf faces down-right.
The two are NOT mirror images of one another in lighting: both keep the single upper-left key
light, so the south face catches more of it and the east face sits deeper in shadow. Same leaf
design, same hardware, same wear on both; only the plane and the lighting differ.

STAIR SILHOUETTE — stairs must read at a glance from across a dark room:
- Stairs-down: steps cut INTO the floor plane, a well, never a raised platform. The mouth of the
  well is the DARKEST shape on the sheet — near-black (#0e0f12) swallowing the lower treads, so
  the stairwell reads as a hole even at 32 px. Each visible tread carries a crisp WARM edge
  highlight (#a8703a) along its leading lip: a ladder of bright lines descending into black. The
  surrounding stone is stepped one hue WARMER than the adjacent floor (a dull ember-brown cast),
  so a down-stair is distinguishable from floor by hue alone. Paint the stone unlit — the violet
  glow is animated separately.
- Stairs-up: steps rising against a wall block, silhouette climbing out of the tile. Deep shadow
  under each tread's overhang, crisp COOL edge highlight (#8fa8c9) on each tread lip, and the
  surrounding stone stepped one hue COOLER than the adjacent floor (a pale blue cast, still
  well under mid-grey). Warm = down, cool = up; this hue step matches the in-world glow markers.
- Neither stair may rely on the glow layer to be legible: with all lighting off, the tread ladder
  and the black mouth alone must identify the tile.

CHEST STATES — four variants of the same banded wooden chest, identical size, wood grain, and
band metal across all four so they read as one object in different conditions. Dark oiled wood,
black-iron banding, rust bloom at the rivets:
- CLOSED — the row-6 `waresCrate` stands in for this today: lid down, intact, faint warm rim light
  along the lid's upper edge.
- OPEN/LOOTED — lid swung back and open, interior EMPTY and near-black inside; the empty cavity is
  the readable cue. No treasure, no glint inside.
- JAMMED — lid down but splintered: cracked lid boards, a pried-up corner, one band bent outward,
  splinters catching the key light.
- LOCKED — lid down, extra iron banding across the lid, and a heavy padlock hanging at the front
  face, large enough to read at 32 px. The padlock is the whole silhouette cue.

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
| `doorSouthFace`, `doorEastFace` | per-axis closed door art (row 7 cols 0 / row 4 col 2) — the authoring contract for the NEXT sheet generation | reserved |
| `gateSouthFace`, `gateEastFace` | per-axis locked-gate art | reserved |
| `archOpenSouthFace`, `archOpenEastFace` | per-axis open archway art | reserved |
| `houseDoorSouthFace`, `houseDoorEastFace` | per-axis town house-door art | reserved |
| `chestOpen`, `chestJammed`, `chestLocked` | chest state variants; the closed state is served by `waresCrate` until a dedicated `chestClosed` ships | reserved |
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

### Passage-axis door art

The shipped `door`/`gate`/`houseDoor` art is a flat camera-facing elevation. A renderer
investigation confirmed it cannot be mirrored to serve the other passage axis: mirroring a
camera-facing elevation produces the same camera-facing elevation, so a door in an east-west wall
and a door in a north-south wall render identically and neither sits in its wall plane. The fix is
authoring, not code — the DOOR FORM rules above require two sprites per passage feature, each a
true 45° isometric solid in its own wall plane.

Until a regenerated sheet ships those cells, the renderer keeps drawing the single existing
`door`/`gate`/`houseDoor` sprite for both axes. The `...SouthFace`/`...EastFace` keys above are the
contract the next generation targets; wiring the renderer to pick per axis is a follow-up that
lands with the art, and the single-facing keys stay valid as the fallback.

The `reserved` tier is not an exception to "no dead data" — it is the tier that keeps the rule
coherent. Those keys are deliberately held for dressing the town vault's row layout already
describes, and the schema validates them so wiring one up later is a renderer change, not an
atlas-format change. A key earns `reserved` status by having a concrete planned consumer in this
doc; a key with no engine counterpart and no such rationale is dead data and gets rejected in
review.
