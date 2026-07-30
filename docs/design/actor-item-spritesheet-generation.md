# Actor & Item Spritesheet Generation Guide

Companion to `docs/design/tileset-generation.md` — the same import pipeline applies: generate on
solid magenta, key with `tools/key-tilesheet.py`, measure-slice with `tools/slice-tilesheet.py`
(the slicer tolerates hand-laid grids, so cell alignment is a nicety, not a contract). Two sheets:
**actors** (hero, town NPCs, monsters) and **items** (everything that can lie on a floor or sit in
the pack). Renderer wiring is tracked in issue #111; art can be generated ahead of it.

## Shared rules (both sheets)

```
Single 1024x1024 PNG (or larger square; the slicer measures), solid magenta background (#ff00ff)
everywhere art is absent — no gradient, no transparency, flat #ff00ff between and around every
sprite. Generators cannot emit alpha; transparency is produced afterwards by the keying tool.

- Roughly 8 columns x 8 rows of cells; ONE sprite per cell, a clear magenta gutter (≥6 px) between
  neighbors, nothing touching another sprite or the sheet edge. Sprites drawn too large get
  guillotined by slicing — the whole figure must sit inside its cell with margin.
- Isometric game-art consistency with the tile sheets: classic 2:1 isometric camera, single
  hard-ish key light from upper-left, CLEAN CEL-SHADED style — flat value steps, crisp edges, no
  outlines, no painterly rendering, silhouette readable as a black shape at 32 px.
- NO ground shadow, NO contact shading, NO ground plate under any figure: the renderer draws its
  own shadow ellipse beneath every actor and item. Alpha must end exactly at the figure's own
  silhouette.
- Figures STAND ON an invisible floor plane (feet/base at the sprite's bottom edge — the renderer
  base-anchors them to the cell's floor diamond). Never draw the floor itself.
- Palette: keep the tile sheets' discipline — cool desaturated base, limited colors, one dominant
  hue per figure (given per entry below), warm/violet accents only where the entry says so.
```

## Sheet 1 — Actors (`actors.png`)

```
Facing: three-quarter view toward the lower-left (the camera side), identical for every actor.
Standard figures fill ~60-70% of the cell height; entries marked LARGE may fill the whole cell
(bosses read bigger than the rabble). One static pose per actor: alert idle, weight forward,
readable at a glance. No animation frames.
```

Row order is the slicing contract — keep it exactly. Dominant hue per entry in parentheses.

- **Row 0 — hero & townsfolk:** hero adventurer (warm tan cloak, hood down, short blade + small
  weave-thread glow at one hand — must read instantly as "the player"); Town Provisioner (apron,
  bread basket, warm browns); Town Armorer (leather smith's apron, hammer, slate grey); Town
  Curios Dealer (layered shawls hung with trinkets, muted violet); Town Spellvendor (robe with
  faint violet weave-thread trim); Travelling Lampwright (coat hung with small lanterns, brass
  glints); 2 cells reserved (magenta).
- **Row 1 — vermin & beasts:** Cave rat (#9e927c, rangy bold rat); Rat brood (#776957, writhing
  knot of several rats); Silt nibbler (#8a7b5c, skittish half-buried burrower); Bile tick
  (#7fa05a, small fat clinging tick); Gorge swarm (#6f6151, heaving mass of tiny bodies); Mire
  lurker (#5c6b57, low mud-caked ambusher); Drowned boar (#7a5a48, waterlogged furious boar);
  Training beetle (#6f8f5b, slow round shelled crawler).
- **Row 2 — thread-kin & spiders:** Thread skitter (#7c8a5b, small wiry figure wrapped in
  scavenged thread); Spindle cutter (#9aa36a, fast low cutter with blade-limbs); Barb slinger
  (#6f7d4e, hurls barbed shards, keeps distance); Snarl warden (#5f6b45, knotted-cord armor,
  bulky); Loom hexer (#8a6fa0, muttering cord-weaver, faint hex glow); Web stalker (#6a5f7a,
  motionless ambush spider); Gossamer darter (#8a7fa0, thin-legged fast spider); Venom spinner
  (#5f7d4e, venom-thread spitter).
- **Row 3 — spiders (large) & oozes:** Carapace broodmother (#4a4358, LARGE swollen matriarch,
  egg sacs); Shroud widow (#3f3a4d, LARGE black widow, near-invisible dark); Tallow slither
  (#c9b45f, slick candle-fat ooze); Wax crawler (#d8cf8a, pale thin wall-crawler); Rendering glut
  (#b39a4a, LARGE ooze with hardened leathery rind); Cinder ooze (#d07a3a, ember-soaked ooze
  glowing dull orange from within); Caustic pool (#7fae55, low acid puddle that spits); 1 cell
  reserved.
- **Row 4 — ember & ash:** Cinder thug (#c06a3e, charred hulk); Slag skirmisher (#d0824a, quick
  brittle-skinned darter); Emberclad reaver (#a8552e, slag-armor plated); Cinder hurler
  (#d89a3a, throws cupped embers); Ashen juggernaut (#8f3f22, LARGE remade ash colossus); Ashen
  Warden (#d06a42, LARGE pacing guardian); The Ashfather (#ff6a2a, LARGE boss — the first fire,
  ember-cracked and ancient); 1 cell reserved.
- **Row 5 — drowned:** Drowned shambler (#6a8a8f, bloated brine zombie); Brine skeleton
  (#b8c0b0, salt-white bones); Sodden lurcher (#4f6b6a, barnacle-crusted husk); Wailing echo
  (#7fa0b8, translucent looping drowning-cry wraith — the ONE ghostly/translucent-looking actor,
  suggest transparency with pale value steps, not real alpha); Tide revenant (#3f5f66, drowned
  commander); The Tide-Sovereign (#3a8fb0, LARGE boss — crowned drowned king, water answering
  it); 2 cells reserved.
- **Row 6 — the Bound:** Bound wretch (#7a5fa0, husk dragging bindings); Shackled remnant
  (#6a4f92, bindings fused into flesh, swings trailing chains); Bound warden (#5a3f82, LARGE
  binding-iron plated); Hexbound (#8a5fc0, cold quiet bindings, air bending around it); 4 cells
  reserved.
- **Row 7 — echo-wrought & the Heart:** Echo-wrought breaker (#9a4f6f, hammered-back-together
  brute); Echo-wrought harrower (#a44f7f, lean quick reworked limbs); Echo-wrought colossus
  (#8a3f5f, LARGE layered slab giant); The Echo Sovereign (#c9425f, LARGE crowned masterwork of
  reclaimed dead); The Heart-Herald (#c9425f, LARGE robed shape the Heart wears to speak,
  corruption held like a lantern); The Weakened Heart (#c9425f, LARGE — a vast failing
  heart-of-threads, violet-red, the final encounter); 2 cells reserved.

## Sheet 2 — Items (`items.png`)

```
Items are DISPLAY OBJECTS, not figures: drawn as if lying on or propped against the invisible
floor plane, slight 3/4 top-down tilt so the shape reads, filling ~50-60% of the cell. Same
no-shadow rule. One sprite per entry; shared-base entries (scrolls, tomes) are single sprites
reused by the renderer for the whole category with per-spell tinting — do NOT draw one per spell.
```

- **Row 0 — weapons & ammo:** Iron sword (#c2c6c8, plain town-forged blade); Hunting bow
  (#a67b4f, simple recurve + quiver hint); Wooden arrows (#b99a70, small arrow bundle); 5
  reserved (future weapon families).
- **Row 1 — armor & shields:** Leather armor (#9f7655, waxed hide cuirass); Cloth wrap
  (#c9c3b0, folded layered weave-cloth); Wooden shield (#ad8455, banded oak round shield); 5
  reserved.
- **Row 2 — lights & tools:** Pitch torch (#e49a4a, rag-and-pitch stave, unlit); Brass lantern
  (#e8c879, hooded brass lantern); Lamp oil (#d2b45f, stoppered oil flask); Tarnished iron key
  (#8c7853); Bent lockpick (#9a9a8c); 3 reserved.
- **Row 3 — consumables:** Mending draught (#c3484f, crimson potion vial); Ashen tonic
  (#a7a29b, grey-white potion vial, clearly different silhouette from the draught); Travel
  ration (#c7a66a, bread + cheese + dried plums in a cloth); GENERIC unidentified potion (murky
  glass vial — used for unidentified appearances); 4 reserved.
- **Row 4 — scrolls & tomes (shared bases):** GENERIC scroll (rolled vellum, wax seal, faint
  sigil — the renderer tints per spell); GENERIC tome closed (clasped leather book with sigil
  boss — tinted per spell); GENERIC tome ornate (heavier variant for rare tomes); 5 reserved.
- **Row 5 — rings & trinkets:** Etched ring (#b8c6cc, fine silver-etched band); Bound signet
  (#6a4f92, heavy violet-dark signet); Weave focus (#8a6fd1, knotted thread skein with violet
  glow); Faded echo remnant (#8f8aa8, a pale thread wisp, barely-there); Weathered Champion's
  Token (#9b9488, worn coin-like token); 3 reserved.
- **Row 6 — relics & quest:** Warden's Ember (#ff8c42, caged ember, warm glow); The Ashfather's
  Cinder (#ff6a2a, fiercer caged cinder); Cinder of the Freed Heart (#c9425f, violet-red
  cinder); The Drowned Crown (#3a8fb0, coral-crusted crown); The Herald's Sigil (#c9425f,
  angular heart-red sigil plate); Echo heartstone (#c9425f, faceted heart-red stone); 2
  reserved.
- **Row 7 — currency & misc:** Gold coins (small loose pile — ground-loot rendering for
  currency); Gold pouch (tied pouch — larger amounts); 6 reserved.

## Start from the template

Hand-laid grids drift more than tile sheets do, since these sheets are only "roughly" 8x8. A
structural template still helps steer generation before the measured slicer has to clean up after
it. Generate one per sheet and feed it back in image-edit (img2img) mode:

```bash
python3 tools/make-template.py --sheet actors
python3 tools/make-template.py --sheet items
```

Attach the matching `template-actors.png` / `template-items.png` as the edit-mode source image
with an instruction such as "paint one sprite per cell, keep every sprite inside its cell's inner
guide box, do not paint over or remove the magenta guide lines, leave unused cells untouched." The
guide lines are near-magenta and get stripped by `key-tilesheet.py` along with the background, so
none of it survives into the keyed sheet. This raises the hit rate but does not replace
verification: the measured slicer (`slice-tilesheet.py`) is grid-tolerant by design and remains the
safety net regardless of how closely the generator followed the template.

## Import & mapping

1. `python3 tools/key-tilesheet.py actors-raw.png apps/web/public/playfield/actors.png` (same for
   `items.png`).
2. `python3 tools/slice-tilesheet.py` prints the measured row/col → rect table; rows/cols map to
   the rosters above in the exact order listed. The atlas gains `actors` and `items` key families
   keyed by contentId (renderer work in #111; until it lands, the sheets are inert assets).
3. Glyph text sprites remain the fallback for any id without a sprite, so partial sheets are safe
   to ship.
