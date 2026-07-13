# The Woven Deep — Game Design

Date: 2026-07-13
Status: Approved design, pending revised written-spec review
Working title: The Woven Deep

## Purpose

Build a deep, desktop-first web roguelike inspired by the original *Rogue*. The game preserves turn-based grid movement, procedural ASCII dungeons, resource pressure, unidentified items, permadeath, and the classic objective of recovering an artifact and escaping. It adds a walkable town, full character generation, dynamic light and line of sight, accountless guest play, and server-backed persistent profiles.

The experience should support substantial repeat play without using permanent stat upgrades. Metaprogression expands future possibilities rather than making later heroes intrinsically stronger.

## Product boundaries

The initial product is a single-player web game designed primarily for a desktop keyboard. It supports two play modes:

- **Guest:** no account or network-backed persistence. The complete run loop and normal locked starting set are available, but the active hero, records, and unlocks last only for the browser session.
- **Persistent profile:** email-only magic-link authentication. Progress, the active run, unlocks, and records are stored authoritatively by the server.

The product has no online leaderboard, password authentication, or multiplayer. One verified email address maps to exactly one progression profile. Guest progress cannot be promoted or imported into a persistent profile.

Touch controls may support basic navigation later, but feature-complete mobile play is outside the initial scope.

## Technical approach

The application uses React and TypeScript, built with Vite, with a Node.js and Fastify HTTP server in the same repository. A framework-independent game-engine package owns all rules and state transitions. React owns screen composition, input routing, dialogs, animation, and presentation.

The engine accepts a validated command and returns a new immutable world state plus a list of domain events. Commands include movement, attacks, item actions, equipment changes, merchant transactions, storage transfers, resting, and stair traversal. Invalid commands do not advance time and produce an explanatory event. Guest mode runs this package in the browser. Persistent-profile mode runs it only on the server; the browser sends commands and receives an observable-state projection plus events.

The renderer uses DOM cells rather than canvas. Each visible map cell receives glyph, foreground color, background color, visibility state, and computed light intensity. CSS custom properties visualize brightness, tint, and restrained transitions while preserving selectable text and accessible markup.

Randomness is supplied by a seeded pseudo-random number generator owned by the engine. A run seed reproduces procedural layouts and random outcomes when paired with the same command sequence and game version. In persistent-profile mode, seeds, hidden map cells, unseen actors, future random state, scoring inputs, and unlock evaluation remain server-side.

## Player profiles and persistence

Startup offers three context-dependent actions: continue the signed-in profile, play as guest, or request a sign-in link for an email address. One email owns one progression profile, so there are no subordinate profiles beneath an account. Signing in with a different email changes the active profile.

Each persistent profile owns:

- Unlocked classes, items, spells, traits, backgrounds, and lore.
- Item, spell, enemy, and location discoveries.
- Its personal Hall of Records.
- Profile-specific settings and key bindings.
- At most one active hero and run.

Guest mode applies the same progression rules and begins with the same locked content as a new persistent profile. Its profile-shaped state, active run, and unverified Hall entries live in `sessionStorage`. Closing the browser session removes them. Guest records never enter the server-backed Hall of Records, and guest state cannot be imported into a persistent profile.

Persistent profile state is stored in a SQLite database on the server. The complete active run is saved transactionally after every resolved turn and after non-turn state changes. The save loader validates records, applies ordered schema migrations, and retains a last-known-good run snapshot. The server never accepts a complete run state, score, Hall entry, or unlock list from the browser.

A signed-in player can export a portable JSON copy of completed records, discoveries, and unlocks for personal backup. Exports exclude the active run's hidden state and all authentication material. Imports are not accepted because client-supplied progression cannot be trusted. Profile deletion requires authentication within the previous ten minutes and confirmation naming the email address; it removes identity, progression, active runs, sessions, and Hall records.

## Authentication, security, and deployment

Persistent profiles use email-only magic-link authentication delivered through Mailgun. The login response is identical whether or not an email already exists. Login requests are rate-limited by normalized email and source address.

Magic-link tokens contain at least 256 bits of cryptographically secure randomness, expire after 15 minutes, are single-use, and are stored only as SHA-256 hashes. Successful verification creates a random server session whose token is also stored only as a hash and delivered in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie. State-changing requests validate the request origin and an anti-CSRF token. Sessions are revocable and expire after 30 days of inactivity.

Mailgun credentials, the public application URL, cookie settings, and deployment secrets are supplied as server environment variables and never enter the browser bundle. Unlocks use stable internal identifiers such as `class.lamplighter`; their integrity comes from server-side evaluation and authorization, not obscured or deployment-specific unlock hashes. Deployment secrets protect session and temporary-flow integrity rather than content identifiers.

The application is deployed as one conventional long-running Docker container. A mounted persistent volume stores a SQLite database configured in WAL mode. The container exposes a health endpoint and performs database migrations before accepting traffic. The operator backs up the database file through the mounted volume using a SQLite-safe backup procedure.

The minimal database has five responsibilities:

- `profiles`: normalized email, versioned progression JSON, settings, and timestamps.
- `active_runs`: authoritative run-state JSON and a last-known-good snapshot.
- `hall_records`: immutable completed-run summaries associated with one profile.
- `login_tokens`: hashed, single-use, expiring magic-link tokens.
- `sessions`: hashed, expiring, revocable authenticated sessions.

## Metaprogression

Persistent-profile and session-only guest unlocks add breadth, not direct power. A run can unlock:

- New playable classes.
- Items and spells that can appear in later generation pools.
- Backgrounds and traits for character generation.
- Codex lore and explicit hints for remaining unlocks.

Locked classes remain visible in character generation as silhouettes with names and unlock hints, but cannot be selected. The Wayfarer is initially available. Planned unlockable classes are the Lamplighter, Archivist, and Warden. Each class changes tactics and starting options without being a strict upgrade.

There are no profile-level attribute bonuses, starting-health upgrades, inherited equipment, currency, or house contents. The server alone evaluates and commits persistent-profile unlocks. Guest mode evaluates the identical rules locally but discards the result with its browser session.

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

## Generated-floor storage

A floor seed and generator version reproduce the floor's initial topology and population, but loading a saved run does not regenerate visited floors. Every generated floor is stored as a complete authoritative snapshot inside the active-run document. This avoids delta replay and preserves all mutations exactly across application updates.

Each floor snapshot contains:

- Floor seed, generator version, dimensions, depth, and theme identifier.
- Compact tile and terrain-state arrays using numeric identifiers.
- Explored and remembered-cell bitsets.
- Doors, traps, secrets, fixtures, stairs, and other mutable features.
- Current creatures, inventories, positions, conditions, and behavior state.
- Ground items, reinforcements, artifact-return hazards, and floor-local counters.

The current hero, town, global run counters, random-generator states, and all generated floor snapshots form one versioned active-run document. SQLite stores the current document and one previous last-known-good document. The server replaces the current document in the same transaction that commits each accepted command. Guest mode uses the identical serialized format in `sessionStorage`.

Seeds remain part of saves and Hall records for reproducibility, debugging, and replay under the recorded game version. They are not a substitute for mutable floor state. Compact arrays and bitsets control size; the design favors simple complete snapshots over a smaller but more fragile seed-and-delta format.

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

1. **Title and identity:** continue the signed-in profile, play as guest, request a Mailgun-delivered sign-in link, sign out, or delete the profile.
2. **Character generation:** complete hero creation, including visible locked classes.
3. **Town and dungeon play:** the shared Tactical Triptych play surface.
4. **Inventory:** filter and sort items; inspect full properties and lore; compare equipment; equip, unequip, use, split stacks, assign quick slots, or drop. Browsing is free, while applicable dungeon actions consume a turn.
5. **Character sheet:** base and derived attributes, conditions, talents, resistances, hunger, light radius, and current-run statistics.
6. **Merchant:** buy, sell, compare, identify, and inspect stock.
7. **Hero's house:** transfer items between backpack and limited current-hero storage.
8. **Map and journal:** explored floor map, objective, clues, history, and known landmarks.
9. **Unlock codex:** discovered and locked classes, items, spells, enemies, and lore.
10. **Hall of Records:** filterable and sortable completed-run history with record details and seeds; guest records are marked unverified and session-only.
11. **Run conclusion:** death or victory, score breakdown, newly applied unlocks, notable events, and confirmation that the run was recorded automatically.
12. **Help and controls:** keyboard reference, glyph legend, and mechanics explanations.
13. **Settings and account:** display, motion, audio, bindings, progress export, sign-out, profile deletion, and guest-session clearing.

Inventory, character sheet, map, and journal open as full-screen overlays without destroying the underlying play state. Merchants and house storage are entered from their physical town locations. Input routing prevents movement commands while an overlay, form field, or dialog has focus.

## Hall of Records and scoring

Every dead or victorious hero produces an immutable record containing:

- Hero name, class, background, and portrait glyph.
- Outcome and cause of death.
- Deepest floor reached.
- Artifact recovery and escape status.
- Final score and its itemized breakdown.
- Enemies defeated and discoveries made.
- Turns survived, completion date, game version, and run seed.

Records sort first by outcome tier—escaped with the Heart, recovered the Heart but died, then all other deaths—and then by score. Within the active persistent profile or guest session, filters cover outcome, class, and date. Character names may repeat because records use unique run identifiers. Server-backed records are authoritative; guest records are visibly unverified and disappear with the session.

Score rewards deepest floor, milestone bosses, enemy threat values, discoveries, artifact recovery, and successful escape. A bounded turn-efficiency bonus rewards decisive play without making careful play nonviable. The run-conclusion screen itemizes every score source; balance coefficients live in tested configuration data.

## Failure handling

Invalid game actions show a concrete event-log explanation and consume no turn. Unexpected engine errors pause input and retain the last-known-good state. Guest save failures explain whether session storage is unavailable or full. Server failures distinguish unauthenticated, forbidden, conflicting, unavailable, and incompatible-version states without leaking hidden game data.

If the server is unavailable, a player can start a separate guest run. A persistent run never falls back to editable browser state, and a guest run never merges into a persistent run. Retrying a persistent command is idempotent: every command carries a monotonically increasing expected-turn value and a unique command identifier, allowing the server to reject stale commands and return the already-committed result for duplicates.

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
- API tests for magic-link issuance and consumption, session revocation, authorization, command idempotency, hidden-state projection, transactional saves, profile deletion, and rate limiting.
- Browser tests for guest play, session-only cleanup, email sign-in, signed-in save and resume, hero creation with both attribute methods, dungeon actions, death cleanup, victory, unlock application, and Hall of Records insertion.
- Equivalence tests that run the same seed and command sequence through browser guest mode and server profile mode and require identical engine results.
- Accessibility checks for keyboard traversal, focus management, reduced motion, scaling, and non-color glyph distinctions.

## Initial delivery target

The first complete release implements the full 20-floor artifact-and-escape loop, the town and three merchants, the current-hero house, four classes with three unlock paths, guest and persistent-profile progression, Mailgun magic-link authentication, server-authoritative profile runs, dynamic lighting, all listed screens, deterministic saves, and the Hall of Records. It ships as one Docker image and stores SQLite on a mounted volume.

Content quantities—enemy count, item count, spell count, room templates, and balance coefficients—are configuration-driven and may be tuned during implementation without changing this design. The release is complete only when a hero can be created, prepare in town, descend, recover the Heart, return or die, create a correct record, clear run-scoped storage, and apply profile unlocks.
