# Dungeon Generation, Visibility, and Light Design

**Status:** Approved design, pending written-spec review

**Roadmap milestone:** 3 — dungeon generation, visibility, and light

**Parent design:** `docs/superpowers/specs/2026-07-13-woven-deep-design.md`

**Previous milestone:** `docs/superpowers/specs/2026-07-13-deterministic-engine-kernel-design.md`

## Goal

Build the first generated dungeon floor and the observable-map boundary used by both guest and server-controlled play. A fixed seed must produce the same connected classic dungeon, authored vault placement, visibility, colored illumination, remembered terrain, and DOM-ready projection in the browser and server.

The milestone ends with a terminal demonstration of an 80×25 generated floor under absolute darkness, very low ambient light, changing torch radii, overlapping colored lights, occlusion, sealed diagonal corners, and remembered terrain.

## Scope

This milestone includes:

- One polished classic room-and-corridor generation style.
- Configurable rectangular floor dimensions, demonstrated at 80×25.
- A theme-supplied playable-cell mask so later themes can use irregular boundaries inside the stored rectangle.
- Deterministic derived floor and retry seeds.
- Bounded generation attempts and a deterministic fallback.
- Strict YAML-authored vaults with transforms, entrances, terrain, fixtures, and typed future-content slots.
- Connectivity and required-feature reachability validation.
- Geometric field of view with sealed diagonal corners.
- Absolute darkness and configurable low colored ambient light.
- Multiple colored, occluded light sources with integer falloff and capped blending.
- Packed explored and remembered-terrain state.
- DOM-ready observable projections that exclude hidden state.
- Light-radius previews clipped to known terrain.
- Active-run save schema `v2` and ordered `v0 → v1 → v2` migration.
- A reproducible Node terminal demonstration and Docker build gate.

## Non-goals

Combat, creature behavior, doors that can be opened, inventory actions, fuel consumption, traps, secret discovery, population selection, item generation, NPC behavior, React rendering, browser storage, server patches, and WebSockets remain later milestones.

Vault monster, item, trap, NPC, fixture, and objective markers are preserved as typed placement slots. Except for environmental light fixtures, this milestone does not resolve those slots into simulated entities.

## Dependency decision

Use `rot-js` version `2.2.1`, pinned exactly. It is a browser-compatible TypeScript roguelike toolkit with no runtime dependencies and maintained map, field-of-view, lighting, and pathfinding modules. The implementation will use its dungeon and field-of-view primitives rather than duplicating those general algorithms.

Official references:

- `https://www.npmjs.com/package/rot-js`
- `https://ondras.github.io/rot.js/manual/`
- `https://ondras.github.io/rot.js/doc/`

The engine does not adopt ROT.js state or presentation as a public interface. Project-owned adapters translate ROT.js output into versioned engine models. The project keeps its own vault placement, retry rules, memory model, ambient-light behavior, colored blending, observable projection, validation, and save migration because those are game-specific contracts.

ROT.js lighting is not used. Its general lighting model does not directly express the milestone's saved ambient settings, fixed integer blending, radius previews, and hidden-state projection rules. All project lighting calculations use the same ROT.js-backed sight adapter for occlusion.

## Package boundaries

Production engine code remains browser-safe. It may import ROT.js and browser-safe content model types, but it must not import the content compiler, Node APIs, React, Fastify, SQLite, storage APIs, clocks, or ambient randomness.

The content package adds vault types and strict compilation. Its root export remains model-only and browser-safe. Node-only YAML parsing stays under `@woven-deep/content/compiler`.

The Node demonstration may read files, compile the content directory, hash output, and render terminal text. It consumes only public package exports.

## Deterministic ROT.js adapter

ROT.js owns a module-level random generator. Generation isolates it behind a synchronous adapter:

1. Capture the current ROT.js random state.
2. Set a nonzero unsigned 32-bit seed derived from the engine attempt seed.
3. Invoke the selected ROT.js operation synchronously.
4. Copy all output into engine-owned arrays and records.
5. Restore the captured ROT.js state in `finally`, including when generation throws.

No callback passed to ROT.js may be asynchronous. No engine state retains ROT.js objects. Tests prove state restoration after success and failure and prove that interleaved engine calls return the same results as isolated calls.

The exact ROT.js version and engine `generatorVersion` jointly define generated topology. Package upgrades require snapshot review and a new generator version. Visited floors remain complete saved snapshots and are never regenerated during load.

## Random streams and floor seeds

Floor allocation consumes only the named `generation` random stream. Four successive `nextUint32` steps produce a four-word floor seed; if all words are zero, the final word uses the existing nonzero fallback. The returned stream state replaces only `rng.generation`.

Generation itself is a pure function of:

- floor seed
- floor identifier
- depth
- theme identifier and settings
- dimensions
- eligible compiled vault definitions
- generator version

Each attempt derives a separate four-word state from the floor seed and zero-based attempt number. Topology, vault eligibility, vault transforms, fixture placement, and stairs consume only that attempt-local state. Rejected attempts do not alter the run's random streams.

The default retry limit is eight. It is configurable from one through 32 for tests and future balance settings.

## Floor geometry

Generated floors use row-major numeric tile arrays. Existing identifiers retain their values:

| Tile ID | Name | Walkable now | Potentially traversable | Blocks sight/light | Presentation |
| ---: | --- | --- | --- | --- | --- |
| 0 | wall | no | no | yes | `#` |
| 1 | floor | yes | yes | no | `.` |
| 2 | closed door | no | yes | yes | `+` |
| 3 | pillar | no | no | yes | `O` |
| 4 | stair up | yes | yes | no | `<` |
| 5 | stair down | yes | yes | no | `>` |
| 6 | void | no | no | yes | space |

Closed doors are potentially traversable for generation reachability because Milestone 4 will add opening. The current movement reducer treats them as blocked. Generated main routes in this milestone do not require opening a door unless the demonstration explicitly marks the route as future-traversable.

Void cells support irregular playable boundaries. They remain inside the rectangular arrays but render blank and never accept vaults, stairs, fixtures, or placement slots.

Generation dimensions must be safe integers. The supported generation range is width 20–160 and height 12–100. Save validation continues to accept bounded legacy dimensions up to the existing 512-cell axis limit.

## Themes and playable masks

A `GenerationTheme` is a registered TypeScript behavior plus validated parameters. YAML selects stable theme identifiers and supplies data; it never supplies executable masking or generation algorithms.

The milestone ships one `classic` theme. Its default mask includes the rectangle inside the outer wall border. The generator interface accepts an immutable mask bitset so tests and future registered themes can create irregular boundaries without changing floor storage or topology APIs.

Before generation, a mask must:

- match the configured dimensions
- exclude the outer border
- contain enough cells for the required stairs and minimum room budget
- have one connected potentially playable component
- contain a valid deterministic fallback path

Invalid theme masks fail before any attempt is committed.

## Classic topology pipeline

For each attempt:

1. Create a solid wall/void grid from the theme mask.
2. Run the pinned ROT.js room-and-corridor generator inside eligible bounds.
3. Copy rooms, corridors, doors, and carved cells into engine-owned records.
4. Reject topology outside the mask, overlapping void, below the room budget, or containing invalid geometry.
5. Evaluate and place eligible vaults into compatible generated rooms.
6. Place upward and downward stairs in distinct rooms with a minimum route distance.
7. Validate every potentially traversable cell belongs to one connected component.
8. Validate both stairs, every vault entrance, and every required placement slot are reachable.
9. Emit the immutable complete floor snapshot and a generation report.

The generator never returns a partially initialized floor.

## Deterministic fallback

After all normal attempts fail, generation uses the same floor seed and theme mask to construct a deterministic fallback:

1. Select the mask's connected component.
2. Choose stable farthest endpoints using breadth-first traversal and row-major tie-breaking.
3. Carve a guaranteed route between them.
4. Add clipped rectangular rooms around both endpoints and the route midpoint when space permits.
5. Place upward and downward stairs at the endpoints.
6. Omit optional vaults rather than risk invalid placement.
7. Run the same final validation as a normal attempt.

Theme-mask validation guarantees the fallback can succeed. An internal invariant exception is raised if the validated mask cannot produce it; no partial floor is published.

## Vault content model

`ContentKind` adds `vault`. A compiled vault entry contains:

- stable identifier, display name, and tags
- inclusive minimum and maximum depth
- rarity and positive generation weight
- maximum placements per floor
- minimum surrounding-wall margin
- allowed rotations: 0°, 90°, 180°, and 270°
- whether horizontal reflection is allowed
- rectangular ASCII layout
- a strict one-code-point legend
- entrance count and required-slot metadata derived by compilation

Rows are compared by Unicode code-point count. Tabs, control characters, trailing-width ambiguity, missing legend symbols, unused legend symbols, and multi-code-point legend keys are rejected.

Every layout needs at least one entrance. Required slots must be reachable from an entrance through potentially traversable vault terrain under every allowed transform.

### Vault legend actions

A legend symbol declares exactly one terrain tile and may additionally declare one of:

- entrance marker
- environmental light fixture
- monster placement slot
- item placement slot
- trap placement slot
- NPC placement slot
- fixture placement slot
- objective placement slot

A placement slot contains a stable slot identifier, required/optional status, and zero or more stable tags. It does not instantiate later gameplay content.

An environmental light fixture additionally declares a stable light identifier suffix, RGB color, radius, strength, and enabled default. Fixture cells must use potentially traversable terrain unless the definition explicitly uses a blocking fixture tile.

### Vault placement

Vaults are filtered by depth, tags, dimensions, and per-floor limits. Selection and transform ordering are deterministic. Candidate order is:

1. vault identifier by UTF-16 code-unit order
2. generated-room identifier
3. rotation in numeric order
4. unreflected before reflected
5. top-left placement in row-major order

Random selection chooses among eligible weighted vaults and compatible candidates, but stable ordering defines all tie behavior.

A vault is placed only when:

- its transformed bounds fit the candidate room and margin
- every non-void vault cell maps inside the playable mask
- entrances connect to generated walkable terrain
- it does not overwrite stairs or another vault
- required slots remain reachable
- replacing room terrain cannot block the main route

The floor stores vault identifier, transform, bounds, entrances, fixtures, and unresolved placement slots. Hidden slot information never enters observable projections.

## Connectivity validation

Connectivity uses deterministic row-major breadth-first traversal over potentially traversable tiles. Neighbor order is north, east, south, west. The milestone uses four-way connectivity even though later hero movement will support eight directions; diagonal contact alone never joins floor regions.

Validation requires:

- every potentially traversable tile belongs to the stair component
- upward and downward stairs are distinct and connected
- required vault entrances and slots are connected
- no stair or required slot occupies wall, pillar, or void
- the minimum configured route distance between stairs is satisfied

The generator report records counts and safe rejection codes, not entire failed floor documents.

## Field of view

The sight subsystem accepts only dimensions, tile-opacity data, an origin, and radius. ROT.js precise shadowcasting produces candidate cells. A project-owned sealed-corner filter then removes a target when a supercover step crosses diagonally between two orthogonal blocking cells.

Rules:

- The origin is always a sight candidate.
- Blocking cells themselves may be visible.
- Cells behind a blocker are not visible.
- Walls, pillars, closed doors, void, and future designated large creatures block sight.
- Sight uses circular distance bands and a saved hero sight radius.
- Results are symmetric for reversed endpoints on unchanged geometry.
- Two orthogonal blockers prevent diagonal corner peeking and light leakage.
- One orthogonal blocker does not seal the diagonal by itself.

FOV output is a packed bitset ordered by cell index. It is derived and not stored in saves.

## Light model

Floor ambient light contains:

- RGB color, each channel 0–255
- strength 0–255

Strength zero means absolute darkness outside light contributions. A nonzero value creates configurable very low ambient illumination. A cell inside hero line of sight is visible when at least one final RGB channel is nonzero.

A saved light source contains:

- stable light identifier
- location: fixed cell or attached actor identifier
- RGB color, each channel 0–255
- radius 1–32
- strength 1–255
- enabled state
- stable falloff identifier, initially only `linear`

The milestone supports fixed environmental fixtures and a hero-attached carried light. Later source types reuse the same record.

### Distance and falloff

For `dx` and `dy`, the distance band is:

```text
distance = ceil(sqrt(dx² + dy²))
```

Integer inputs and the small bounded radius make this stable across supported JavaScript runtimes. Cells with `distance > radius` receive no contribution.

For a source with `strength` and `radius`:

```text
sourceScalar = floor(strength × (radius + 1 - distance) / (radius + 1))
channelContribution = floor(sourceColorChannel × sourceScalar / 255)
```

Ambient channel contribution is:

```text
ambientChannel = floor(ambientColorChannel × ambientStrength / 255)
```

All source contributions and ambient are added per channel and capped at 255. Observable intensity is the maximum final RGB channel. Tests lock exact boundary values.

### Occlusion

Each enabled light computes visibility from its resolved position through the same FOV and sealed-corner rules as hero sight. A source contributes only to cells in its own visible bitset and radius.

An attached source whose actor cannot be resolved is an internal invariant failure. Fixed sources must occupy in-bounds, non-void cells. Hidden light sources may illuminate authoritative cells, but they are not themselves exposed unless hero visibility permits.

## Knowledge and remembered terrain

Each floor saves:

- `exploredWords`: one bit per cell packed into unsigned 32-bit words
- `rememberedTerrainWords`: eight four-bit terrain values per unsigned 32-bit word

The four-bit value `15` means unknown. Tile IDs 0–6 fit in the remaining values. Save validation requires exact word counts, zero padding outside the grid, and agreement between explored bits and non-unknown remembered values.

After an action that changes position, sight radius, geometry, ambient light, or a source:

1. Resolve attached light positions.
2. Compute authoritative full-floor illumination.
3. Compute hero field of view.
4. Mark cells visible only when they are in hero FOV and have nonzero final illumination.
5. Set explored bits and replace remembered terrain for visible cells.
6. Preserve remembered terrain for cells no longer visible.

Derived current visibility and illumination are not serialized. Remembered projection uses saved remembered terrain, never current hidden terrain. Remembered cells show no occupants, fixtures, slots, or changed terrain that the hero has not seen.

## Observable projection

The projection boundary returns immutable row-major cells. Every cell contains:

- `x`, `y`, and cell index
- knowledge state: `unknown`, `remembered`, or `visible`
- presentation glyph and semantic foreground/background tokens when known
- intensity 0–255
- RGB light tint when visible
- optional clipped light-preview state
- visible fixture presentation when applicable

Unknown cells contain no terrain, fixture, slot, or lighting details. Remembered cells contain only the remembered terrain presentation, fixed dim intensity, and desaturated semantic tokens. Visible cells contain current terrain and currently visible fixtures.

The engine returns semantic presentation tokens rather than CSS or React objects. The later DOM renderer maps them to CSS custom properties and applies the approved 120-millisecond transition or immediate reduced-motion behavior.

## Light-radius preview

A preview describes a prospective light at the hero position with color, radius, strength, and falloff. It uses normal occlusion and distance rules but does not modify authoritative illumination or knowledge.

Preview cells are emitted only where the cell is currently visible or explored. Unknown cells are omitted even when geometrically inside the radius. The projection exposes preview intensity separately so the renderer can show an outline or tint without presenting unseen terrain.

## Reducer integration

Active-run state moves to save schema `v2`. The hero gains a saved sight radius. Every floor gains theme, ambient, knowledge, lights, stairs, vault placements, and unresolved placement slots.

The reducer continues to resolve movement and waiting. Applied movement resolves hero-attached lights at the new hero position and refreshes active-floor knowledge. The saved source remains attached by actor identifier rather than duplicating coordinates. Waiting does not recompute unchanged geometry, but returns state with the same saved knowledge. Invalid actions and protocol rejections do not change knowledge.

Movement uses each tile's current walkability. Closed doors, pillars, walls, and void block movement. Stairs are walkable but do not change floors until stair commands arrive later.

Generation integration is separate from the command reducer:

```ts
interface FloorSeedAllocation {
  readonly floorSeed: Uint32State;
  readonly nextGenerationState: Uint32State;
}

allocateFloorSeed(generationState: Uint32State): FloorSeedAllocation

generateFloor(request: GenerateFloorRequest): GeneratedFloor

addGeneratedFloor(
  run: ActiveRun,
  generated: GeneratedFloor,
  allocation: FloorSeedAllocation,
): ActiveRun
```

`GenerateFloorRequest` includes the allocated floor seed. `addGeneratedFloor` rejects duplicate or out-of-order floor identifiers, requires the generated floor seed to equal `allocation.floorSeed`, verifies that the next stream state is nonzero, updates only `rng.generation`, adds the complete floor snapshot, and refreshes perception when the new floor is active. Passing the allocation as one value keeps seed consumption and insertion paired so a seed cannot be silently reused.

## Generation report

`GeneratedFloor` includes an immutable report for diagnostics and tests:

- generator version
- selected attempt or fallback
- room and corridor counts
- selected vault identifiers and transforms
- stair positions and route distance
- potentially traversable cell count
- connectivity status
- safe rejection-code counts from earlier attempts

The report is not part of the active-run save and is not sent in observable projections.

## Save schema v2

Schema `v2` retains all prior strictness and adds validation for:

- expanded tile IDs and tile-specific position rules
- generator versions 1 and 2
- theme and ambient settings
- exact packed-bitset lengths and padding
- remembered-terrain consistency
- hero sight radius
- unique, ordered light identifiers and valid source locations
- unique vault placements, bounds, transforms, entrances, fixtures, and slot identifiers
- distinct in-bounds stair positions matching stair tiles
- floor identifiers in strict stable order
- current recent-command histories and hero position under expanded movement blocking

Derived FOV, illumination, projections, and generation reports are rejected as unknown save fields.

## Migration

Migration remains ordered and explicit:

```text
v0 → v1 → v2
```

The existing checked-in `v0` and exact `v1` fixtures remain unchanged as evidence of the first migration. A new exact `v2` fixture proves the second migration.

`v1 → v2`:

- preserves all identifiers, seeds, counters, terrain, entities, commands, and events
- assigns theme `legacy.fixed`
- assigns neutral full ambient light so the earlier fixed-floor behavior remains observable
- sets hero sight radius to 12
- adds no vaults, placement slots, or environmental lights
- identifies no stairs unless matching stair tiles already exist
- computes initial explored and remembered terrain from the hero position using the new visibility rules
- keeps generator version 1

Current `v2` documents are idempotent. Unsupported versions and invalid intermediate data fail with typed safe load errors. The migration never regenerates a legacy floor from its seed.

## Content compiler changes

The strict compiler adds vault schemas and validations without weakening monster or item validation. Vault files live under `content/vaults/*.yaml`, and one demonstration vault ships with the milestone.

Compilation errors include filename, vault identifier, field path, and a corrective message for:

- malformed or nonrectangular layouts
- invalid Unicode/control characters
- missing, multi-code-point, or unused legend entries
- missing entrances
- unreachable required slots
- invalid transform declarations
- invalid depth, rarity, weight, margin, or placement limits
- invalid fixture light values
- duplicate slot or fixture suffix identifiers
- layouts too large for declared constraints

Compiled content remains sorted and hashed through the existing stable JSON pipeline. Adding or editing a vault changes the content hash without TypeScript changes.

## Error model

Generation failures use typed codes suitable for diagnostics:

- invalid request or theme mask
- topology rejected
- vault placement rejected
- stair placement rejected
- connectivity rejected
- fallback invariant failure

Normal rejected attempts are recorded only in the generation report and do not escape as exceptions. Invalid requests, invalid compiled content reaching the engine, and impossible fallback states are internal errors.

Visibility and lighting functions reject out-of-bounds origins, invalid dimensions, malformed masks, invalid colors, unsafe values, unresolved attached sources, and unsupported falloff identifiers. They never silently clamp malformed authoritative state.

The terminal CLI prints safe summaries and exits nonzero for invalid content, generation invariants, projection divergence, or malformed arguments.

## Terminal demonstration

Add `npm run dungeon:demo`. It builds content and engine packages, compiles the bundled vaults, generates the same 80×25 classic floor twice, and verifies exact stable floor bytes.

The output includes:

- floor identifier, seed, attempt/fallback state, room/corridor counts, vaults, and stair distance
- a complete terrain view for generation diagnostics
- an absolute-darkness hero projection
- the same geometry under very low ambient light
- a small and large hero torch preview
- overlapping differently colored fixed and carried lights
- sight and light occlusion around walls, pillars, and a sealed diagonal corner fixture
- remembered terrain after the hero moves away
- SHA-256 hashes for the floor snapshot and each observable projection
- `deterministic dungeon, visibility, and light verified`

The Docker build runs this demonstration after existing tests, type checks, builds, and the engine replay demonstration.

## Verification strategy

Test-driven implementation covers:

- exact ROT.js version and browser-safe imports
- adapter random-state restoration after success and failure
- floor-seed allocation and stream isolation
- repeated-seed byte equality
- hundreds of generated seeds across supported representative sizes
- mask bounds, irregular mask compliance, retry accounting, and fallback
- room/corridor presence, stair distance, full connectivity, and required reachability
- every vault rotation/reflection, entrance reconnection, margin, slot preservation, and main-route safety
- strict vault YAML and stable content hashing
- FOV radius, symmetry, blockers, visible blocker cells, and sealed diagonal corners
- absolute darkness, low ambient light, exact falloff boundaries, source attachment, occlusion, and capped RGB blending
- preview clipping to known cells
- packed knowledge word sizing, padding, memory updates, and unseen terrain-change protection
- observable projection hidden-state exclusion
- movement integration and unchanged invalid/rejected semantics
- exact `v1 → v2` migration bytes, current idempotence, and corrupt-field paths
- continuous versus save/reload equality with generated-floor state
- CLI success, stable hashes, failure summaries, and Docker integration

Property tests use deterministic loops rather than ambient random test data. Snapshot expectations are checked in and are never regenerated by the tests that assert them.

## Compatibility commitments

After this milestone, tile IDs, vault compiled fields, theme identifiers, generator versions, light falloff identifiers, knowledge packing, save schema `v2`, and observable projection fields are stable interfaces. Incompatible changes require an explicit generator-version, content-schema, save migration, or protocol decision.

Later milestones may add tiles, source types, mutable fixtures, resolved placements, creature sight blockers, perception thresholds, and new registered generation themes. They must preserve complete saved floor snapshots, hidden-state projection, deterministic output, and existing migrated runs.
