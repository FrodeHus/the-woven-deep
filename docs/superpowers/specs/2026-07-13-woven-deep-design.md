# The Woven Deep — Game Design

Date: 2026-07-13
Status: Approved design, pending written-spec review
Working title: The Woven Deep

## Purpose

Build a deep, desktop-first web roguelike inspired by the original *Rogue*. The game preserves turn-based grid movement, procedural ASCII dungeons, resource pressure, unidentified items, permadeath, and the classic objective of recovering an artifact and escaping. It adds a walkable town, full character generation, dynamic light and line of sight, local player profiles, and persistent content unlocks.

The experience should support substantial repeat play without using permanent stat upgrades. Metaprogression expands future possibilities rather than making later heroes intrinsically stronger.

## Product boundaries

The initial product is a single-player browser game designed primarily for a desktop keyboard. It requires no server, login, online leaderboard, cloud save, or multiplayer. Player profiles, active runs, settings, unlocks, and records are stored in browser local storage and can be exported or imported as JSON.

Touch controls may support basic navigation later, but feature-complete mobile play is outside the initial scope.

## Technical approach

The application uses React and TypeScript, built with Vite. A framework-independent game engine owns all rules and state transitions. React owns screen composition, input routing, dialogs, animation, and presentation.

The engine accepts a validated command and returns a new immutable world state plus a list of domain events. Commands include movement, attacks, item actions, equipment changes, merchant transactions, storage transfers, resting, and stair traversal. Invalid commands do not advance time and produce an explanatory event.

The renderer uses DOM cells rather than canvas. Each visible map cell receives glyph, foreground color, background color, visibility state, and computed light intensity. CSS custom properties visualize brightness, tint, and restrained transitions while preserving selectable text and accessible markup.

Randomness is supplied by a seeded pseudo-random number generator owned by the engine. A run seed reproduces procedural layouts and random outcomes when paired with the same command sequence and game version.

## Player profiles and persistence

On first launch, the player creates a named local profile. When more than one profile exists, startup displays a profile selector. Each profile summary shows its name, unlock progress, Hall of Records totals, active-hero status, and last-played date.

Each profile owns:

- Unlocked classes, items, spells, traits, backgrounds, and lore.
- Item, spell, enemy, and location discoveries.
- Its Hall of Records.
- Profile-specific settings and key bindings.
- At most one active hero and run.

The application stores a versioned profile index and versioned per-profile documents under namespaced local-storage keys. The active run is saved after every resolved turn and after non-turn state changes such as settings updates. The save loader validates records, applies ordered migrations, and retains a last-known-good snapshot. Corrupt data is preserved for export and recovery rather than silently discarded.

Profiles can be created, selected, renamed, exported, imported, and deleted. Deletion requires confirmation that names the affected profile. Import never overwrites an existing profile silently; identifier collisions create a copied profile with a new identifier.

## Metaprogression

Persistent unlocks add breadth, not direct power. A profile may unlock:

- New playable classes.
- Items and spells that can appear in later generation pools.
- Backgrounds and traits for character generation.
- Codex lore and explicit hints for remaining unlocks.

Locked classes remain visible in character generation as silhouettes with names and unlock hints, but cannot be selected. The Wayfarer is initially available. Planned unlockable classes are the Lamplighter, Archivist, and Warden. Each class changes tactics and starting options without being a strict upgrade.

There are no profile-level attribute bonuses, starting-health upgrades, inherited equipment, currency, or house contents.

## Character generation

Every run begins with a new named hero. The creation flow includes:

1. Name and portrait glyph.
2. Attribute-generation method: random roll or point buy.
3. Attribute assignment and review.
4. Selection from unlocked classes.
5. Background and traits.
6. Starting-equipment choices permitted by the selected class and background.
7. Final summary and confirmation.

The five base attributes are Might, Agility, Vitality, Wits, and Resolve. Random generation rolls three six-sided dice for each attribute and permits one complete reroll. Point buy uses a fixed budget and escalating costs, with the same minimum and maximum values as rolled characters. The exact budget and cost table are balance data rather than hard-coded UI rules.

Class, background, traits, and equipment determine derived statistics. The confirmation screen shows all derived effects before the hero enters town.

## Run structure

Town is floor 0 and the starting location for every hero. The dungeon contains 20 increasingly dangerous procedural floors. A hero may return to town between dungeon excursions. The primary objective is to reach the final depth, claim the Heart of the Deep, then climb back through the existing dungeon and leave through the town entrance.

The return journey increases encounter pressure and introduces artifact-driven hazards, but does not regenerate explored floors. Traversal continues to consume food, light fuel, and turns. Previously defeated unique enemies remain dead. When a hero re-enters an eligible visited floor, a deterministic depth- and artifact-aware reinforcement check can add a small roaming group, so repeated town trips carry a cost without resetting progress.

Death is permanent. It destroys the current hero, carried inventory, equipment, currency, and every item stored in that hero's house. Escape with the Heart completes the run. Both death and victory finalize an immutable Hall of Records entry and then apply earned profile unlocks.

## Town

Town is a compact, walkable ASCII map rendered with the same game view as the dungeon. It contains the dungeon entrance, the hero's house, and three merchants:

- A provisioner for food, light sources, fuel, and basic utility goods.
- An arms dealer for weapons and armor.
- A curios dealer for magical goods, identification, and unusual services.

Merchants support inspection, comparison, buying, and selling. Their inventories refresh at defined depth milestones and after major dungeon events, not by repeatedly entering and leaving a shop. Town movement is turn-based but does not consume hunger or light fuel. Town service actions do not advance dungeon actors.

The hero's house stores a limited number of item stacks for the current hero. Capacity can grow during that run through in-game purchases or discoveries, but all capacity upgrades and contents disappear on death or victory. Storage is never shared between heroes.

## Dungeon systems

Core play includes:

- Eight-direction movement through keyboard arrows, numpad, or configurable vi keys.
- Wait, rest, melee, ranged attacks, spells, doors, traps, secret passages, and stairs.
- Hunger and light-fuel pressure.
- Weapons, armor, light sources, utility items, consumables, and limited backpack capacity.
- Unidentified potions, scrolls, and enchanted equipment whose properties are learned through use or identification.
- Procedural rooms and corridors grouped into themed depth bands.
- Handcrafted milestone floors and bosses embedded within procedural progression.
- Enemies with readable behavioral families: hunters, ambushers, guards, light-averse creatures, and roaming threats.

The dungeon generation pipeline places topology, validates connectivity, assigns a theme, places stairs and required objectives, populates encounters and items, then performs a final reachability check. A rejected floor is regenerated deterministically from a derived sub-seed.

## Visibility and lighting

Visibility and illumination are gameplay systems. After every action that can change position, geometry, or light, the engine recomputes field of view and light intensity.

Every cell is one of three knowledge states:

- **Visible:** currently inside line of sight and sufficiently illuminated; occupants and terrain are rendered at current intensity.
- **Remembered:** seen previously but not currently visible; only remembered terrain is shown, dimmed and desaturated.
- **Unknown:** never seen; no map information is rendered.

Walls, closed doors, pillars, and designated large creatures block sight and shape light. Equipped torches, lanterns, spells, creatures, and environmental fixtures can emit light with color, radius, and distance falloff. Multiple lights combine with a capped intensity. Inspecting or equipping a light source previews its effective radius without revealing unknown terrain.

Creatures outside current visibility are not rendered. Light-sensitive creatures can react to intensity and source proximity. Lighting changes use a 120-millisecond visual transition; reduced-motion mode applies the new state immediately.

## Interface and visual direction

The visual direction is **Living Tapestry**: an ASCII-first playfield framed with restrained ornamental Unicode, a deep blue-charcoal ground, mineral blues for structure, gold for the hero and important state, and muted red for immediate danger. Ambient movement and glow are concentrated around lighting rather than scattered across the interface.

The main desktop play layout is the **Tactical Triptych**:

- Left: hero summary, health and resources, equipped gear, and compact backpack contents.
- Center: the largest region, containing the town or dungeon grid.
- Right: nearby threats, ground items, omens, objective state, and depth context.
- Bottom: chronological event log and context-sensitive control hints.
- Top: location, hero identity, and turn count.

The layout scales down by collapsing side panels into keyboard-accessible drawers. The map always remains the primary region.

## Screens

The application contains these screens and overlays:

1. **Title and profile selection:** continue, choose, create, or manage a player profile.
2. **Character generation:** complete hero creation, including visible locked classes.
3. **Town and dungeon play:** the shared Tactical Triptych play surface.
4. **Inventory:** filter and sort items; inspect full properties and lore; compare equipment; equip, unequip, use, split stacks, assign quick slots, or drop. Browsing is free, while applicable dungeon actions consume a turn.
5. **Character sheet:** base and derived attributes, conditions, talents, resistances, hunger, light radius, and current-run statistics.
6. **Merchant:** buy, sell, compare, identify, and inspect stock.
7. **Hero's house:** transfer items between backpack and limited current-hero storage.
8. **Map and journal:** explored floor map, objective, clues, history, and known landmarks.
9. **Unlock codex:** discovered and locked classes, items, spells, enemies, and lore.
10. **Hall of Records:** filterable and sortable completed-run history with record details and seeds.
11. **Run conclusion:** death or victory, score breakdown, newly applied unlocks, notable events, and confirmation that the run was recorded automatically.
12. **Help and controls:** keyboard reference, glyph legend, and mechanics explanations.
13. **Settings and profile management:** display, motion, audio, bindings, export/import, rename, and deletion.

Inventory, character sheet, map, and journal open as full-screen overlays without destroying the underlying play state. Merchants and house storage are entered from their physical town locations. Input routing prevents movement commands while an overlay, form field, or dialog has focus.

## Hall of Records and scoring

Every dead or victorious hero produces an immutable local record containing:

- Hero name, class, background, and portrait glyph.
- Outcome and cause of death.
- Deepest floor reached.
- Artifact recovery and escape status.
- Final score and its itemized breakdown.
- Enemies defeated and discoveries made.
- Turns survived, completion date, game version, and run seed.

Records sort first by outcome tier—escaped with the Heart, recovered the Heart but died, then all other deaths—and then by score. Within the active player profile, filters cover outcome, class, and date. Character names may repeat because records use unique run identifiers.

Score rewards deepest floor, milestone bosses, enemy threat values, discoveries, artifact recovery, and successful escape. A bounded turn-efficiency bonus rewards decisive play without making careful play nonviable. The run-conclusion screen itemizes every score source; balance coefficients live in tested configuration data.

## Failure handling

Invalid game actions show a concrete event-log explanation and consume no turn. Unexpected engine errors pause input and retain the last-known-good state. Save failures explain whether storage is unavailable, full, corrupt, or from a newer incompatible version, and offer the safest available recovery or export action.

Procedural generation has bounded retries and a deterministic fallback floor template. A generation failure never produces an unreachable objective or a partially initialized run.

## Accessibility and controls

Keyboard play is complete. Every command can be rebound, and the default scheme supports arrow keys, numpad, and vi movement. Dialogs trap focus, Escape consistently closes non-destructive overlays, and visible focus styling is never removed.

Glyph meaning is not communicated by color alone. The game supports scalable interface and map text, high-contrast distinctions, reduced motion, and a persistent glyph legend. Log messages provide textual equivalents for important visual events such as a light extinguishing or a creature entering sight.

## Verification strategy

Automated verification includes:

- Unit tests for commands, combat, inventory, equipment, economy, scoring, unlocks, field of view, lighting, save validation, and migrations.
- Seeded property tests that require every generated floor, objective, and exit to remain reachable.
- Simulation tests covering thousands of automated turns to detect impossible states and balance outliers.
- React component tests for profiles, character generation, locked classes, inventory, merchants, house storage, codex, and records.
- Browser tests for profile creation and selection, hero creation with both attribute methods, save and resume, dungeon actions, death cleanup, victory, unlock application, and Hall of Records insertion.
- Accessibility checks for keyboard traversal, focus management, reduced motion, scaling, and non-color glyph distinctions.

## Initial delivery target

The first complete release implements the full 20-floor artifact-and-escape loop, the town and three merchants, the current-hero house, four classes with three unlock paths, profile-scoped metaprogression, dynamic lighting, all listed screens, deterministic saves, and the Hall of Records.

Content quantities—enemy count, item count, spell count, room templates, and balance coefficients—are configuration-driven and may be tuned during implementation without changing this design. The release is complete only when a hero can be created, prepare in town, descend, recover the Heart, return or die, create a correct record, clear run-scoped storage, and apply profile unlocks.
