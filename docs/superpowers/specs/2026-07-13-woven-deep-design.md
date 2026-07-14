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

The product has no online leaderboard, password authentication, or multiplayer. One verified email address maps to exactly one progression profile. Guest progress cannot be promoted or imported into a persistent profile. Optional balance telemetry is disabled until the player explicitly enables it and can be disabled at any time.

Touch controls may support basic navigation later, but feature-complete mobile play is outside the initial scope.

## Technical approach

The application uses React and TypeScript, built with Vite, with a Node.js and Fastify HTTP and WebSocket server in the same repository. A framework-independent game-engine package owns all rules and state transitions. React owns screen composition, input routing, dialogs, animation, and presentation.

### Dependency policy

Before implementing a general-purpose capability, check current open-source packages and frameworks for a well-supported, production-suitable option. Prefer an established dependency when it meets the game's browser, deterministic-replay, security, licensing, bundle-size, and maintenance requirements. Record why a local implementation is preferable when no candidate fits; small local algorithms are appropriate when they define the save/replay contract or when a dependency would add incompatible behavior or disproportionate weight.

Reassess package health at the time a feature is implemented rather than relying on this design's date. In particular, evaluate ROT.js before implementing field of view, lighting, pathfinding, and dungeon generation. Keep Zod for runtime boundary validation. The engine's compact random-state algorithm and strict stable-JSON encoder remain local because their exact state layout and rejection rules are part of the versioned replay and save formats.

The engine accepts a validated command and returns a new immutable world state plus a list of domain events. Commands include movement, attacks, item actions, equipment changes, merchant transactions, storage transfers, resting, and stair traversal. Invalid commands do not advance time and produce an explanatory event. Guest mode runs this package in the browser. Persistent-profile mode runs it only on the server; the browser sends sequenced commands over one authenticated WebSocket and receives observable-state patches plus events.

Every persistent-profile command is validated in order by the server, including movement. The WebSocket removes per-command HTTP setup cost, and the client can coalesce rapid directional inputs into a small ordered batch. Each command carries a unique identifier and expected server revision. The server stops a batch when a command is invalid or requires a new player decision, then returns the authoritative revision and results for every processed command.

The browser may predict animation for movement into a currently visible, known-empty, walkable cell, but prediction never changes trusted state. Server patches reconcile glyphs, cell visibility, actors, statistics, and log events. A mismatch replaces the predicted presentation with the authoritative result.

The renderer uses DOM cells rather than canvas. Each visible map cell receives glyph, foreground color, background color, visibility state, and computed light intensity. CSS custom properties visualize brightness, tint, and restrained transitions while preserving selectable text and accessible markup.

Randomness is supplied by a seeded pseudo-random number generator owned by the engine. A run seed reproduces procedural layouts and random outcomes when paired with the same command sequence, game version, and content hash. In persistent-profile mode, seeds, hidden map cells, unseen actors, future random state, scoring inputs, and unlock evaluation remain server-side.

## Player profiles and persistence

Startup offers three context-dependent actions: continue the signed-in profile, play as guest, or request a sign-in link for an email address. One email owns one progression profile, so there are no subordinate profiles beneath an account. Signing in with a different email changes the active profile.

Each persistent profile owns:

- Unlocked classes, items, spells, traits, backgrounds, and lore.
- Boss achievements and rare-population discovery-protection counters.
- Item, spell, enemy, and location discoveries.
- Its personal Hall of Records.
- Lifetime statistics aggregated from completed heroes.
- Profile-specific settings and key bindings.
- At most one active hero and run.

Guest mode applies the same progression rules and begins with the same locked content as a new persistent profile. Its profile-shaped state, active run, and unverified Hall entries live in `sessionStorage`. Closing the browser session removes them. Guest records never enter the server-backed Hall of Records, and guest state cannot be imported into a persistent profile.

Persistent profile state is stored in a SQLite database on the server. While connected, the authoritative active run remains in server memory and is checkpointed transactionally. The server saves immediately after consequential changes: combat or damage, health or status changes, pickups, equipment and consumable actions, traps and secrets, doors, stairs, trading, storage transfers, death, victory, and unlocks. Pure unobstructed movement is checkpointed after ten resolved turns or two seconds from the first unsaved movement, whichever occurs first. A clean WebSocket disconnect also forces a checkpoint.

An actual server or container crash can lose only the bounded pure-movement window since the last checkpoint. Disconnecting the browser does not create a rollback opportunity because the still-running server detects closure and checkpoints the in-memory run. The save loader validates records, applies ordered schema migrations, and retains a last-known-good run snapshot. The server never accepts a complete run state, score, Hall entry, or unlock list from the browser.

A signed-in player can export a portable JSON copy of completed records, discoveries, and unlocks for personal backup. Exports exclude the active run's hidden state and all authentication material. Imports are not accepted because client-supplied progression cannot be trusted. Profile deletion requires authentication within the previous ten minutes and confirmation naming the email address; it removes identity, progression, active runs, sessions, and Hall records.

## Authentication, security, and deployment

Persistent profiles use email-only magic-link authentication delivered through Mailgun. The login response is identical whether or not an email already exists. Login requests are rate-limited by normalized email and source address.

Magic-link tokens contain at least 256 bits of cryptographically secure randomness, expire after 15 minutes, are single-use, and are stored only as SHA-256 hashes. Successful verification creates a random server session whose token is also stored only as a hash and delivered in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie. State-changing HTTP requests validate the request origin and an anti-CSRF token. WebSocket upgrades validate the origin, authenticated session, and a connection token before accepting commands. Sessions are revocable and expire after 30 days of inactivity.

Mailgun credentials, the public application URL, cookie settings, and deployment secrets are supplied as server environment variables and never enter the browser bundle. Unlocks use stable internal identifiers such as `class.lamplighter`; their integrity comes from server-side evaluation and authorization, not obscured or deployment-specific unlock hashes. Deployment secrets protect session and temporary-flow integrity rather than content identifiers.

The application is deployed as one conventional long-running Docker container. A mounted persistent volume stores a SQLite database configured in WAL mode. The container exposes a health endpoint and performs database migrations before accepting traffic. The operator backs up the database file through the mounted volume using a SQLite-safe backup procedure.

The core database has six responsibilities:

- `profiles`: normalized email, versioned progression JSON, settings, and timestamps.
- `active_runs`: authoritative run-state JSON and a last-known-good snapshot.
- `hall_records`: immutable completed-run summaries associated with one profile.
- `login_tokens`: hashed, single-use, expiring magic-link tokens.
- `sessions`: hashed, expiring, revocable authenticated sessions.
- `content_packs`: immutable compiled content indexed by content hash.

Balance telemetry adds a seventh table, `telemetry_runs`, containing privacy-reduced run summaries for players who opted in. Administrative access does not require a separate password system: administrators sign in through the same Mailgun magic-link flow, and the server grants read-only dashboard access only to normalized emails listed in the `ADMIN_EMAILS` deployment setting. Every admin request is authorized server-side.

## YAML content packs

Game content and balance data are defined in strict YAML files rather than hard-coded TypeScript objects. The repository organizes entries by type, including:

- `content/monsters/*.yaml`
- `content/encounters/*.yaml`
- `content/npcs/*.yaml`
- `content/achievements/*.yaml`
- `content/items/*.yaml`
- `content/spells/*.yaml`
- `content/classes/*.yaml`
- `content/backgrounds/*.yaml`
- `content/traits/*.yaml`
- `content/shops/*.yaml`
- `content/loot-tables/*.yaml`
- `content/vaults/*.yaml`
- `content/unlocks/*.yaml`
- `content/balance/*.yaml`

Each file can contain one or more entries with globally stable identifiers. Adding a file adds entries without TypeScript changes when those entries compose existing engine behaviors and effects. YAML controls glyphs, presentation, statistics, tags, rarity, run-appearance chance, depth eligibility, prices, resistances, ability parameters, loot references, synergy weights, unlock criteria, achievements, and other declarative values.

YAML never contains executable scripts, embedded expressions, custom tags, or new algorithms. AI models, targeting rules, procedural algorithms, and effect implementations remain registered and tested in TypeScript. YAML references them by stable identifiers such as `ai: light_hunter` or `effect: cone_fire` and supplies schema-validated parameters.

At startup, the server reads the complete directory specified by `CONTENT_DIR`, falling back to the content bundled in the image. It sorts paths deterministically, parses files with custom tags disabled and bounded aliases and file sizes, then performs four validation stages:

1. File and entry shape validation against versioned strict schemas, including rejection of unknown properties.
2. Global uniqueness and stable-identifier validation.
3. Cross-reference, dependency-cycle, range, weight, and parameter validation.
4. Semantic checks for required foundational content, compatible effect parameters, reachable unlock rules, and valid generation pools.

Any error prevents the server from accepting traffic and reports the filename, entry identifier, field path, and corrective message. Development tooling can run the same compiler independently for fast content-author feedback.

Successful validation compiles YAML to stable JSON and calculates a hash from the stable JSON representation, not raw YAML formatting. Startup inserts a previously unseen compiled pack into `content_packs` and marks it current. Every active run stores the exact content hash it uses. Existing runs continue with their original immutable pack after a restart, while new heroes use the current pack. Compiled packs are retained so Hall seeds remain replayable under their original content; they are small, immutable, and deduplicated by hash.

Persistent-profile simulation uses the authoritative server pack. Its browser receives only presentation data and the observable definitions required by the current state. Guest mode receives the complete compiled pack because its engine runs locally; guest content is inspectable and is not a security boundary. Both modes record the same content hash.

Mounted content is trusted operator input and is never uploaded or edited through the player or admin web interfaces. Applying balance changes consists of editing or adding YAML files and restarting the container. The read-only admin dashboard groups results by content hash and game version so incompatible balance sets are never combined silently.

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
- Handcrafted milestone encounters and optional bosses embedded within procedural progression.
- Enemies with readable behavioral families: hunters, ambushers, guards, light-averse creatures, and roaming threats.

The dungeon generation pipeline places topology, validates connectivity, assigns a theme, places stairs and required objectives, populates encounters and items, then performs a final reachability check. A rejected floor is regenerated deterministically from a derived sub-seed.

## Tactical identity: light and darkness

Light is the game's defining tactical system rather than only a visibility radius. Brightness lets the hero read terrain and threats but makes the hero easier to detect. Darkness conceals the hero and enables ambushes while reducing reliable information. Noise, line of sight, and illumination together drive creature awareness.

The player can equip, place, throw, refuel, extinguish, and relight supported light sources. Spells and environmental interactions can change light color, radius, duration, and behavior. Creature families react differently: some hunt light, some flee it, some become stronger in darkness, and some are revealed or transformed only under particular illumination. Item and class abilities can weaponize these relationships.

Visible hostile creatures expose a concise intent when their next behavior is sufficiently determined: attack, pursue, guard, flee, investigate, cast, or recover. Intent uses glyph treatment and text, never color alone. Uncertain or hidden behavior remains uncertain; intent communicates readable rules without exposing future random rolls.

## Builds, content, and procedural variety

Items, traits, classes, and spells prioritize new tactical verbs and synergies over flat numerical upgrades. Content definitions declare synergy tags such as light, darkness, fire, identification, hunger, movement, defense, and control. Generation budgets intentionally offer compatible pieces without guaranteeing a complete build.

Unlocking content does not append everything to one unbounded random pool. Each depth band and reward source uses rarity budgets, category minimums, and synergy weighting. Unlocks expand eligible options while preserving access to essential provisions, light, offense, and defense. Automated generation reports detect when a new unlock makes foundational item categories too rare.

Procedural floors embed authored room templates called vaults. Vaults include shrines, puzzles, environmental stories, unusual traders, monster lairs, light-based challenges, and explicit risk/reward rooms. The generator controls their depth eligibility, rarity, entrances, required surrounding space, and reward budget, then validates that they cannot block the main route.

## Monster populations and dungeon NPCs

Monster definitions describe statistics, abilities, perception, presentation, and reusable behavior identifiers. Encounter definitions compose monsters into one of four population models:

### Individual

An individual spawns independently and owns its perception, memory, goals, and behavior state. It does not receive group communication or coordination bonuses unless an effect explicitly grants them.

### Group

A group encounter creates members with one shared group identifier. Members communicate detected sounds and the hero's last-known position only within a configurable range. Shared information records where and when the hero was detected; it does not reveal the hero's current hidden position or future movement.

Group YAML defines composition, roles, formation preferences, communication radius, and a chance to include a leader. A leader has a distinct glyph treatment as well as an accent color. While the leader lives, members can receive configured coordination bonuses. Leader death invokes one declared response: weaken, panic, disband, surrender, frenzy, or collapse. `collapse` is permitted only for explicitly telegraphed supernatural bonds and destroys or disables the linked members immediately.

Members removed by a leader-collapse response count as a group broken rather than individual kills and grant no individual kill rewards unless that encounter explicitly overrides the default. This prevents leader targeting from multiplying loot or experience accidentally.

### Swarm

A swarm encounter contains a visible source such as a nest, queen, portal, or corpse mass. The source—not each spawned creature—owns the spawn timer. YAML defines the creature mix, interval, placement rules, source and local caps, floor-wide population cap, and source-destruction response.

While the hero is away, groups and swarms remain frozen in their complete floor snapshot. Re-entering never applies missed swarm growth. Destroying the visible source stops spawning or applies its configured shutdown transition. This makes fleeing a dangerous floor a valid containment choice.

### Boss

A boss is a unique individual population. Several distinct bosses can occur in one run, but each boss identifier has `maxInstancesPerRun: 1`. A boss has one guaranteed unique reward, an enhanced additional loot table, authored phases, and a first-defeat profile achievement. Achievements may unlock classes, items, spells, traits, or lore but never direct permanent statistics. Guest achievements and their unlocks last only for the browser session.

A boss left alive recovers health from elapsed dungeon turns up to its configured recovery cap. Completed phase transitions, destroyed encounter features, and other permanent arena mutations remain in the floor snapshot. This prevents unlimited retreat-and-heal attrition without fully resetting the encounter.

The current profile or guest session's highest-scoring unconquered dead hero becomes an optional named boss at the depth where that hero died. The encounter preserves the hero name and recognizable build traits while a YAML template normalizes combat power. It never blocks progression. The original death record stores one deterministically selected, quality-weighted transferable item that the hero had equipped at death as an heirloom; if none is eligible, it records the configured fallback relic. Defeating the champion grants that heirloom and permanently removes that Hall record's champion encounter; if the conquered record remains the high-score holder, no lower record is promoted. Dead heroes ranked 2 through 10 may independently appear as weaker optional `Echo of <Hero Name>` bosses, capped at two per run. Echoes are not guaranteed, cannot repeat within a run, may return in later runs, grant a lesser first-defeat achievement, and use enhanced ordinary loot rather than the recorded heirloom.

### Run-level appearance

Every population has a `runAppearanceChance` evaluated once from a dedicated deterministic random stream when a run begins. A failed roll excludes that population for the entire run. A successful roll only makes it eligible for its declared depth bands, environments, vaults, encounter weights, and instance limits. This gate is separate from per-floor encounter selection, so repeated floor rolls do not make rare content inevitable.

Foundational populations use a chance of `1.0`. Boss schemas default to a low `0.08` chance and one instance. All values remain YAML-configurable.

Rare populations can declare `discoveryProtectionIncrement` and `discoveryProtectionCap`. When a hero reaches the start of an eligible depth band and completes the run without encountering that population, the profile's next-run chance increases by the configured increment up to the cap. Encountering the population resets its bonus, whether or not it is defeated. Defaults for bosses are an increment of `0.03` and a cap of `0.35`. Guest mode keeps these counters only for the current browser session; persistent-profile counters are server-authoritative.

The run stores every appearance decision and effective probability in hidden authoritative state. The admin dashboard can aggregate effective appearance, encounter, defeat, and avoidance rates without exposing an active run's population rolls to the player.

### Dungeon NPCs

Neutral NPCs are YAML-authored random encounters. They use the same run-level appearance gate, eligibility rules, and instance limits as monster populations, with discovery protection disabled unless explicitly configured. Initial types include travelling merchants, with the model open to later healers, explorers, prisoners, and lore encounters using registered behaviors. A travelling merchant carries limited depth-appropriate food, healing, light supplies, identification services, and curios at less favorable prices than town. It does not replace planned town preparation.

Dungeon NPCs are mortal and use self-preservation behavior. Hostile creatures normally ignore them unless provoked, affected by faction rules, or drawn into danger. An NPC threatened by monsters or collateral effects attempts to flee. The player may deliberately attack a neutral NPC; doing so ends trade, causes flight or self-defense, drops only a configured fraction of stock, and reduces the current hero's reputation with related merchants. Reputation and its consequences end with the hero.

Travelling NPCs have a configured departure turn. Their interface and event log communicate the remaining time at meaningful thresholds, and departure never occurs while a transaction dialog is open. Their state, inventory, disposition, and departure time are stored in the floor snapshot.

## Pacing and onboarding

A successful standard run targets 90 to 150 minutes, with each floor forming a natural stopping point. Meaningful tactical choices or rewards should occur several times per floor. The five-floor depth bands establish distinct visual, enemy, item, and environmental identities. Milestone floors at depths 5, 10, 15, and 20 create authored difficulty and narrative beats.

Town returns are useful but not mandatory after every floor. Shop refresh milestones, traversal costs, reinforcement checks, and limited storage prevent repetitive town shuttling from becoming the dominant strategy. Balance tests track run duration, town-return frequency, and time between meaningful upgrades.

The first town visit teaches movement, inspection, inventory, light, commerce, and dungeon entry through optional contextual interactions. Hints appear only when their action is relevant, dismiss permanently after demonstrated mastery, and remain available in Help and the journal. Experienced players can disable all onboarding prompts before creating a hero.

## Feedback, sound, and fair failure

ASCII remains the primary visual language, supported by restrained positional audio, distinct monster and environmental cues, impact timing, and focused light transitions. Sounds outside sight communicate direction and character without revealing an exact hidden cell. Important audio information also appears in the event log. Volume controls separately cover master, ambience, effects, and interface sound.

Dangerous mechanics provide readable warning states before they can cause extreme or instant consequences. The game avoids untelegraphed instant-kill effects. The run-conclusion screen reconstructs the final causal sequence from recent domain events, identifies visible warnings and effects, and links newly learned creatures or items to their codex entries. It explains what happened without claiming that only one response was correct.

## Generated-floor storage

A floor seed and generator version reproduce the floor's initial topology and population, but loading a saved run does not regenerate visited floors. Every generated floor is stored as a complete authoritative snapshot inside the active-run document. This avoids delta replay and preserves all mutations exactly across application updates.

Each floor snapshot contains:

- Floor seed, generator version, dimensions, depth, and theme identifier.
- Compact tile and terrain-state arrays using numeric identifiers.
- Explored and remembered-cell bitsets.
- Doors, traps, secrets, fixtures, stairs, and other mutable features.
- Current creatures, inventories, positions, conditions, and behavior state.
- Ground items, reinforcements, artifact-return hazards, and floor-local counters.

The current hero, town, global run counters, random-generator states, content hash, a bounded ring of recently processed command identifiers and results, and all generated floor snapshots form one versioned active-run document. SQLite stores the current document and one previous last-known-good document. The server replaces the current document at the immediate and periodic checkpoint boundaries defined above. Guest mode uses the identical serialized format in `sessionStorage`.

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
9. **Unlock codex:** discovered and locked classes, items, spells, enemies, boss achievements, and lore.
10. **Hall of Records:** filterable and sortable completed-run history with record details, seeds, run statistics, and lifetime profile totals; guest records are marked unverified and session-only.
11. **Run conclusion:** death or victory, causal final-turn recap, score breakdown, newly applied unlocks, notable statistics, codex links, and confirmation that the run was recorded automatically.
12. **Help and controls:** keyboard reference, glyph legend, and mechanics explanations.
13. **Settings and account:** display, motion, audio, bindings, progress export, sign-out, profile deletion, and guest-session clearing.
14. **Admin balance dashboard:** a separately authorized, read-only route for aggregated opt-in telemetry and CSV export.

Inventory, character sheet, map, and journal open as full-screen overlays without destroying the underlying play state. Merchants and house storage are entered from their physical town locations. Input routing prevents movement commands while an overlay, form field, or dialog has focus.

## Hall of Records and scoring

Every dead or victorious hero produces an immutable record containing:

- Hero name, class, background, and portrait glyph.
- Outcome and cause of death.
- Deepest floor reached.
- Artifact recovery and escape status.
- Final score and its itemized breakdown.
- Enemies defeated and discoveries made.
- Turns survived, completion date, game version, content hash, and run seed.

Records sort first by outcome tier—escaped with the Heart, recovered the Heart but died, then all other deaths—and then by score. Within the active persistent profile or guest session, filters cover outcome, class, and date. Character names may repeat because records use unique run identifiers. Server-backed records are authoritative; guest records are visibly unverified and disappear with the session.

Score rewards deepest floor, milestone bosses, enemy threat values, discoveries, artifact recovery, and successful escape. A bounded turn-efficiency bonus rewards decisive play without making careful play nonviable. The run-conclusion screen itemizes every score source; balance coefficients live in validated YAML configuration.

## Statistics and memorable metrics

Engine domain events update a typed statistic registry. Metrics are counters and extrema, not a retained raw event history, so they add little save or database size. The active-run snapshot stores current-hero metrics. Finalizing a run copies those metrics into the immutable Hall record and merges them into lifetime profile totals. Guest mode performs the same aggregation within its browser session.

The initial registry includes:

- Total kills and kills grouped by monster type.
- Population appearances, leaders defeated, groups broken, swarm sources destroyed, swarm peak size, bosses encountered and defeated, and neutral NPC outcomes.
- Attacks, hits, misses, critical hits, damage dealt, hit points lost, and hit points healed.
- Potions drunk grouped by potion type, scrolls read, spells cast, food eaten, and items identified.
- Items collected, dropped, bought, sold, equipped, and stored; currency earned and spent.
- Grid cells moved, displayed as meters traveled using one traversed cell as one meter.
- Turns survived, turns spent in darkness, light sources exhausted, rests taken, and trips back to town.
- Doors opened, traps triggered and disarmed, secrets discovered, floors visited, deepest floor, and milestone events completed.
- Highest single hit, lowest surviving hit-point total, longest darkness streak, and largest carried fortune.

Metric identifiers and display metadata live in a configuration registry so new counters can be added without changing save structure. Monster- and item-grouped metrics use stable content identifiers internally and human-readable labels for display. Damage, loss, and healing counters record effective values after mitigation and health caps rather than attempted values. Metrics never affect combat or unlock eligibility unless an unlock rule explicitly references one. Persistent-profile clients receive only statistics earned through server-validated events.

Current-run highlights appear on the character sheet. The run-conclusion screen selects several notable metrics in addition to showing the complete categorized list. Hall record details preserve every metric for that hero, while the Hall overview can switch between individual records and lifetime profile totals.

## Opt-in balance telemetry and administration

Balance telemetry is opt-in for both guest and persistent-profile play. The consent screen names the collected categories and states that telemetry is used to balance the game. The choice is stored with a persistent profile or, for a guest, only for the current session. Settings show the current choice and allow future collection to be disabled immediately. Gameplay and progression are identical when telemetry is disabled.

The server stores one privacy-reduced telemetry summary per opted-in run that ends in death, victory, or explicit abandonment. It includes game and content versions, trusted-profile or unverified-guest classification, class and build tags, outcome, depth, duration, turn count, cause of death, town-return cadence, unlock timing, and the statistic registry described above. It excludes email addresses, hero names, authentication data, IP addresses, free-form text, complete command histories, and run seeds. Persistent-profile rows retain an internal owner key solely so profile deletion can remove them; that key and the random telemetry identifier are never exposed by the dashboard.

Persistent-profile telemetry is derived from authoritative server events and marked trusted. Guest telemetry is client-supplied, marked unverified, and excluded from trusted balance aggregates by default. Rate limits and schema validation apply to guest submissions.

The read-only admin dashboard provides:

- Completion and abandonment rates by version, class, depth band, and time range.
- Common causes of death and the turns immediately associated with them as categorized data, not raw command logs.
- Monster kill and player-death rates by monster type.
- Item pickup, use, equip, sell, drop, and win-correlation rates.
- Potion, spell, light, economy, healing, damage, movement, and town-return distributions.
- Run-duration, floor-duration, unlock timing, and progression funnels.
- Trusted-only default views, an explicit guest-data filter, warnings for samples below 20 runs, and CSV export of the currently aggregated view.

The dashboard never displays player emails or hero names. Admin authorization is checked on every dashboard API route. `TELEMETRY_RETENTION_DAYS` controls retention and defaults to 365 days. A daily cleanup removes expired rows. Deleting a persistent profile also deletes its linked telemetry rows. Dashboard aggregates are recalculated from retained rows so deletion is reflected.

## Failure handling

Invalid game actions show a concrete event-log explanation and consume no turn. Unexpected engine errors pause input and retain the last-known-good state. Guest save failures explain whether session storage is unavailable or full. Server failures distinguish unauthenticated, forbidden, conflicting, unavailable, and incompatible-version states without leaking hidden game data.

If the server is unavailable, a player can start a separate guest run. A persistent run never falls back to editable browser state, and a guest run never merges into a persistent run. Reconnecting reloads the last durable checkpoint, establishes a new WebSocket, and returns its authoritative revision. Persistent commands are idempotent: the server rejects stale revisions and returns the recorded result for a duplicate command identifier that remains in its bounded deduplication window.

Procedural generation has bounded retries and a deterministic fallback floor template. A generation failure never produces an unreachable objective or a partially initialized run.

## Accessibility and controls

Keyboard play is complete. Every command can be rebound, and the default scheme supports arrow keys, numpad, and vi movement. Dialogs trap focus, Escape consistently closes non-destructive overlays, and visible focus styling is never removed.

Glyph meaning is not communicated by color alone. The game supports scalable interface and map text, high-contrast distinctions, reduced motion, and a persistent glyph legend. Log messages provide textual equivalents for important visual events such as a light extinguishing or a creature entering sight.

## Verification strategy

Automated verification includes:

- Unit tests for commands, combat, inventory, equipment, economy, scoring, statistics, unlocks, field of view, lighting, save validation, and migrations.
- Content tests for synergy weighting, essential-category availability, vault placement, run-appearance gating, discovery protection, group communication, leader outcomes, capped swarm growth, boss uniqueness and recovery, NPC departure and reputation, encounter intent, and light-reactive creature rules.
- Content-compiler tests for deterministic ordering and hashing, strict schemas, duplicate identifiers, invalid references, dependency cycles, unsafe YAML features, semantic validation, mounted content, and old-pack run resumption.
- Seeded property tests that require every generated floor, objective, and exit to remain reachable.
- Simulation tests covering thousands of automated turns to detect impossible states and balance outliers.
- React component tests for profiles, character generation, locked classes, inventory, merchants, house storage, codex, records, and statistics views.
- API and WebSocket protocol tests for magic-link issuance and consumption, session revocation, authorization, ordered command batches, idempotency, reconnection, prediction correction, hidden-state projection, immediate consequential saves, bounded movement checkpoints, profile deletion, and rate limiting.
- Telemetry tests for consent defaults, trusted and guest separation, field minimization, deletion, aggregation thresholds, CSV authorization, and admin-route access control.
- Browser tests for guest play, session-only cleanup, email sign-in, signed-in save and resume, hero creation with both attribute methods, dungeon actions, death cleanup, victory, unlock application, and Hall of Records insertion.
- Equivalence tests that run the same seed and command sequence through browser guest mode and server profile mode and require identical engine results.
- Accessibility checks for keyboard traversal, focus management, reduced motion, scaling, and non-color glyph distinctions.

## Initial delivery target

The first complete release implements the full 20-floor artifact-and-escape loop, the town and three merchants, the current-hero house, four classes with three unlock paths, strict YAML-authored content packs, light-centered tactics, readable enemy intent, synergy-aware content pools, authored vaults, contextual onboarding, fair-death recaps, restrained positional audio, guest and persistent-profile progression, Mailgun magic-link authentication, server-authoritative profile runs, dynamic lighting, all listed screens, deterministic saves, the Hall of Records, opt-in telemetry, and the read-only admin balance dashboard. It ships as one Docker image and stores SQLite on a mounted volume.

Content quantities—enemy count, item count, spell count, room templates, and balance coefficients—are configuration-driven and may be tuned during implementation without changing this design. The release is complete only when a hero can be created, prepare in town, descend, recover the Heart, return or die, create a correct record, clear run-scoped storage, and apply profile unlocks.
