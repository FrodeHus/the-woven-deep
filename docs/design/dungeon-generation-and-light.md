# Dungeon Generation, Visibility, and Light

**Status:** Shipped (milestone 3); production floors later grew to 160×50 (milestone 5C)

**Package:** `packages/engine`, vault content in `content/vaults/`

Light is the game's defining tactical system, not just a visibility radius. This doc
covers how floors are procedurally generated, how sight and illumination are computed,
what the client is allowed to know, and the light-out survivability mechanic that keeps
running out of light from being a dead end.

## Dependency stance

The engine uses `rot-js` (pinned exactly, currently 2.2.1) for its dungeon generation and
field-of-view primitives rather than reimplementing general roguelike algorithms. It is
deliberately **not** used for lighting — ROT.js's general lighting model doesn't express
the game's saved ambient settings, fixed integer blending, radius previews, or hidden-
state projection rules, so all lighting math is project-owned, built on the same sight
adapter for occlusion. ROT.js's module-level random generator is isolated behind a
synchronous adapter that captures its state, seeds it deterministically per attempt, runs
one operation, copies output into engine-owned records, and restores the captured state
in `finally` — even on throw. No ROT.js object ever leaks into engine types; the exact
ROT.js version plus the engine's `generatorVersion` jointly define generated topology, so
a package upgrade requires a new generator version and snapshot review.

## Floor generation

Floor allocation consumes the `generation` random stream to derive a four-word floor
seed. Generation itself is a pure function of that seed, the floor ID, depth, theme, and
eligible vault definitions. For each attempt (bounded retries, default 8, configurable
1–32):

1. Carve rooms and corridors inside the theme's playable mask using the pinned ROT.js
   generator.
2. Place stairs in distinct rooms with a minimum route distance.
3. Evaluate and place eligible vaults into compatible rooms without overwriting or
   disconnecting the stair route.
4. Validate full connectivity (four-way, row-major breadth-first — diagonal contact alone
   never joins regions) and reachability of both stairs and every required vault slot.
5. Emit the immutable complete floor snapshot, or reject and retry.

If every attempt fails, a **deterministic fallback** guarantees a playable floor: find
the mask's farthest connected endpoints via breadth-first search with stable tie-
breaking, carve a guaranteed route between them, add small clipped rooms, place stairs at
the endpoints, and skip optional vaults entirely rather than risk invalid placement. The
theme mask is validated up front specifically so this fallback can never itself fail —
if it somehow can't, that's an internal invariant exception, not a silently broken floor.

Themes are a registered TypeScript behavior plus validated parameters; YAML selects a
stable theme ID and supplies data, never masking logic. The shipped `classic` theme uses
the full rectangle inside the outer wall border. A `GenerationTheme`'s playable mask is
an immutable bitset, so future irregular-boundary themes don't need new generation APIs.

## Vaults

A vault is an authored ASCII room template compiled from YAML: rectangular layout, a
strict one-code-point legend, allowed rotations (0/90/180/270°) and optional horizontal
reflection, depth/rarity/weight/placement-limit metadata, and legend symbols that can
additionally mark an entrance, an environmental light fixture, or a monster/item/trap/
NPC/fixture/objective placement **slot** (a stable ID + required/optional + tags — not an
instantiated entity; something else resolves slots into content later). Placement
candidate order is fully deterministic (vault ID, room ID, rotation, unreflected-before-
reflected, row-major position) so random selection only picks among eligible weighted
candidates — ties never depend on iteration order. A vault is only placed if it fits, its
non-void cells map inside the playable mask, entrances connect to walkable terrain, and
placing it can't block the main stair route.

The **town floor** (added milestone 5C) is itself a `vault` entry tagged `town`, consumed
by a dedicated `generateTownFloor` assembly path rather than vault-in-floor placement —
see `guest-client.md` for how the town loop uses it.

## Field of view

The sight subsystem takes only dimensions, tile-opacity data, an origin, and a radius.
ROT.js precise shadowcasting produces candidate visible cells; a project-owned filter
then removes any cell reached by a diagonal step between two orthogonal blocking cells
("sealed corner"), so a hero can't peek or receive light through a wall corner. One
orthogonal blocker alone does not seal a corner. Walls, pillars, closed doors, void, and
(later) designated large creatures block sight. FOV output is a packed bitset, derived
fresh each time and never serialized.

## Light model

A floor has ambient light (RGB + strength; strength 0 is absolute darkness). A light
source (fixed to a cell, or attached to an actor — e.g. the hero's carried torch) has RGB
color, radius (1–32), strength (1–255), a falloff identifier (currently only `linear`),
and enabled state. For integer distance band `ceil(sqrt(dx²+dy²))`:

```
sourceScalar = floor(strength × (radius + 1 − distance) / (radius + 1))
channelContribution = floor(sourceColorChannel × sourceScalar / 255)
```

All source and ambient channel contributions add per channel, capped at 255. A cell is
visible when it's inside hero FOV *and* has at least one nonzero final RGB channel — pure
darkness outside a light's radius genuinely hides the cell, not just dims it. Each light
computes its own visibility/occlusion through the same FOV and sealed-corner rules from
its own position, so a light behind a wall doesn't leak through it.

## Knowledge and remembered terrain

Each floor saves two packed bitsets: `exploredWords` (one bit/cell) and
`rememberedTerrainWords` (four bits/cell, packed eight per word; value `15` = unknown).
After any action that can change position, geometry, or light: recompute illumination,
recompute hero FOV, mark cells visible only where both apply and illumination is
nonzero, set explored bits and overwrite remembered terrain for now-visible cells, and
*preserve* remembered terrain for cells no longer visible. Every cell projected to the
client is one of three knowledge states — **visible** (current terrain, actors, full
presentation), **remembered** (only previously-seen terrain, dimmed/desaturated, no
current occupants or ground items), or **unknown** (nothing) — and the projection excludes
all hidden actors, undiscovered features, and future state regardless of state.

## Light-out survivability

If the hero's own cell has zero aggregate illumination, the floor would otherwise render
completely blank and unplayable. Instead, the projection draws an emergency reveal:

- A Chebyshev (king-move) bubble around the hero, default radius **1** (own cell + eight
  neighbors), renders **terrain only**.
- Everywhere else renders as `unknown`; the remembered map is hidden while dark (by
  default — see feat knobs below).
- The hero glyph always renders.
- Monsters, ground items, and features remain live in authoritative state and still
  trigger on contact (combat, pickup, doors), but are **not rendered**, even inside the
  bubble.
- Normal FOV/illumination resume the instant light returns.

The bubble is presentation-only: it runs neither the visible-cell commit nor any
explored-bit update. This is deliberate, not an oversight, and it encodes a specific
survival-tension rule: terrain **seen under light** before the darkness stays remembered
once light returns (the memory is only *hidden* while dark, never erased), but terrain
only **bumped into blind** is never committed and is forgotten once light returns.
Groping a wall in the dark does not map the dungeon — only carried light surveys and
records it. This stops a player from deliberately snuffing their torch to explore "for
free," and it's the mechanic the three planned darkvision-family feats (see
`future.md`) are built to modify.

### Parameterization

Two derived stats drive the mechanic, read from the hero's aggregated stats
(`deriveActorStats`) so any class/feat/item modifier can change them. Both are excluded
from player-facing derived-stat display (`playerVisibleDerivedStats()`) since they're
tuning knobs, not something a player inspects directly:

- `lightOutRevealRadius` (default 1) — the bubble's Chebyshev radius.
- `lightOutMemoryPersists` (default 0) — when set, the remembered map stays visible while
  dark instead of hiding (still doesn't commit new dark-fumbled terrain).

A third knob (commit-while-dark) is needed for the planned **Dungeon sense** feat and
doesn't exist yet — see `future.md`.

## Observable projection and save schema

The projection returns immutable row-major cells (position, knowledge state, glyph,
semantic foreground/background tokens, intensity, RGB tint, optional clipped light-
preview state) — semantic tokens, not CSS or React objects; the renderer owns that
mapping. A light-radius preview (for inspecting/equipping a light source before
committing) uses the same occlusion math but never touches authoritative illumination or
knowledge, and only emits preview cells for currently visible or explored cells — nothing
geometrically-in-range-but-never-seen leaks through a preview.

Active-run save schema reached v2 in this milestone (theme, ambient, knowledge bitsets,
lights, stairs, vault placements, unresolved slots all became part of the versioned save;
see `deterministic-engine.md` for the schema-evolution discipline this and later
milestones follow). Generation reports (attempt counts, rejection codes, room/corridor
counts) are diagnostic-only and never enter saves or projections.
