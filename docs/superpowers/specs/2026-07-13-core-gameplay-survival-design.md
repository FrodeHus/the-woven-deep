# Core Gameplay and Survival Design

**Date:** 2026-07-13

**Status:** Approved design

**Roadmap milestone:** 4A — core gameplay and survival

**Parent milestone:** 4 — core gameplay, populations, and NPCs

**Previous milestone:** `docs/superpowers/specs/2026-07-13-dungeon-visibility-light-design.md`

## Goal

Turn the deterministic dungeon and perception engine into a small but complete tactical survival game loop. A hero can move in eight directions, fight, react, carry and equip items, identify unknown objects, manage hunger and light fuel, interact with doors, discover and disarm traps and secrets, rest safely, save, reload, and reproduce the same outcome byte for byte.

Milestone 4 remains one roadmap milestone but is delivered through two independently reviewable slices. This document defines 4A. A later 4B design adds full monster populations, dungeon NPCs, reputation, achievements, statistics, scoring, and run finalization on the stable actor, action, item, effect, and scheduling interfaces established here.

## Exit demonstration

A terminal scenario runs on a seeded generated floor and demonstrates:

- Equal-cost orthogonal and diagonal movement without squeezing through sealed corners.
- Melee, ranged, and targeted effect resolution.
- Symmetric hostile-only opportunity attacks and reaction recovery.
- Backpack stacking, equipment changes, hand conflicts, and carried light.
- Per-run unknown potion and scroll appearances.
- Hunger stages, fuel warnings, and interruptible rest.
- A mutable door, hidden trap, and secret passage.
- A small deterministic creature policy that approaches and attacks.
- Continuous execution and execution across several save/reload boundaries.

The continuous and split executions must produce identical stable state, domain-event, command-result, and player-projection hashes.

## Scope

### Included

- Versioned actor, item, feature, survival, scheduler, and identification state.
- A clean pre-release replacement of active-run schema v2 with schema v3.
- A clean pre-release replacement of compiled content schema v1 with schema v2.
- Five base attributes and pure derived-stat calculation.
- Integer-energy action scheduling and complete atomic world steps.
- Eight-direction movement and corner rules.
- Melee, ranged, and registered-effect actions.
- Dynamic hostile, neutral, and friendly relationships.
- Symmetric opportunity attacks.
- Health, damage types, armor, resistances, conditions, death, and recovery.
- Slot-based backpack inventory and typed item locations.
- Handed equipment, armor and accessory slots, stacking, splitting, pickup, and drop.
- Per-run potion and scroll appearance mapping and per-instance enchanted-item knowledge.
- Hunger, food, carried and placed light fuel, refueling, extinguishing, and relighting.
- Mutable doors, traps, secrets, discovery, disarming, searching, and rest.
- Expanded YAML schemas for monsters, items, spells, traps, loot tables, and balance data.
- A closed registry of schema-validated engine behaviors and effects.
- Hidden-state-safe player projections and typed decision requests.
- Example-based, schema-rejection, replay, browser-boundary, property-based, and CLI verification.

### Deferred to 4B

- Run-level population appearance decisions and discovery protection.
- Full perception, memory, intent, path selection, and reusable AI families.
- Individual, group, leader, swarm, and boss population state and behavior.
- Boss phases, recovery, unique rewards, and achievements.
- Travelling merchants, NPC self-preservation, trading, reputation, and stock loss.
- Complete encounter and item population of generated floors.
- Metrics, scoring, deterministic run records, and Hall finalization.

### Deferred beyond Milestone 4

- Character-generation UI and complete class/background/trait selection.
- Browser game screens, input bindings, and session storage.
- Server-authoritative WebSocket play, profile authentication, and persistence.
- The full 20-floor campaign, town economy, unlock pools, and final balance.

## Established contracts

This milestone preserves the existing rules for immutable reducer input, named random streams, stable JSON, complete floor snapshots, recent-command deduplication, content-hash binding, deterministic floor generation, knowledge packing, field of view, lighting, remembered terrain, and player projection.

The project is still pre-release and has no player saves or operator content packs requiring continuation. This milestone may therefore replace the current save and content shapes outright. It retains explicit version fields and rejects older versions clearly. Once schema v3 saves or schema v2 content are used outside development, incompatible changes require migrations. Player-facing state never contains hidden geometry, identities, actor state, feature state, random streams, or future decisions.

## Dependency decisions

The engine remains browser-safe and does not import React, Fastify, SQLite, browser storage, or Node-only APIs.

The architecture remains a staged functional simulation over immutable plain data. A data-oriented ECS or actor runtime would introduce a second state representation while leaving deterministic scheduling, combat, schema validation, and event projection project-specific. Neither bitECS nor XState is added.

The project already uses ROT.js for owned adapters around dungeon generation and sight. ROT.js also offers action and speed schedulers, but its public interface does not define the serialized scheduler representation required by saved authoritative state. The milestone therefore implements a small pure integer-energy scheduler whose data is part of the versioned save contract. Later 4B pathfinding may reuse ROT.js behind an adapter that copies results into project-owned data.

Add `fast-check` as a development dependency for property-based invariant testing. It works with the existing Vitest runner and shrinks failures to reproducible cases. Example tests remain primary for exact rules and diagnostics; generated properties cover combinations that are impractical to enumerate.

Dice are structured integer data rather than parsed notation. A local deterministic die roller is deliberately small because it consumes the versioned combat random stream and affects replay. No dice parser is added.

## Architecture

`resolveCommand(state, command, { content })` remains the only public command-resolution entry point. The supplied compiled pack must match the run's saved content hash exactly; a mismatch is an internal invariant failure before command processing. Structural save decoding validates the self-contained schema-v3 document. A separate content-bound validator checks content references, stack limits, equipment compatibility, feature definitions, and balance references whenever a decoded run is attached to its compiled pack.

The reducer becomes a thin orchestrator over focused pure modules:

1. Apply recent-command deduplication and expected-revision checks.
2. Validate the command against authoritative state and compiled content.
3. Return a typed decision request if a required target, confirmation, slot, or item choice is missing.
4. Convert a complete command into a typed action and integer energy cost.
5. Resolve reactions triggered by the attempted action.
6. Apply registered effects and state mutations to new immutable values.
7. Charge action energy.
8. Select ready actors and advance elapsed dungeon time until the hero is selected for input again.
9. On every clock advance, update hunger, fuel, conditions, recovery, and mutable features before selecting an actor made ready by that advance.
10. Refresh light, sight, knowledge, and observable projections when their inputs changed.
11. Record the complete ordered domain-event sequence, its event-time redacted public sequence, and the processed command result.

Modules have narrow public inputs and outputs: actor lookup, scheduler, targeting, combat, effects, inventory, equipment, identification, survival, features, rest, projection, and schema validation. No module reads ambient time, ambient randomness, global mutable state, or I/O.

## Active-run schema v3

The active-run document becomes `schemaVersion: 3`. It retains useful run-envelope concepts and adds the following gameplay state.

### World clock and scheduler

- `worldTime`: non-negative safe integer dungeon-time units.
- Actor `energy`: bounded safe integer accumulator.
- Actor `speed`: positive configured integer.
- Actor `reactionReady`: boolean.
- Saved condition and feature timers use absolute `worldTime` deadlines. Resource reserves such as hunger and fuel remain bounded integer quantities rather than timers.

The command `turn` counter remains the count of applied player actions. `revision` remains the count of published authoritative changes. Neither substitutes for elapsed world time.

Each processed-command record stores both authoritative events and the public events projected at their original resolution points. A duplicate command ID returns those stored public events rather than projecting old authoritative events against newer knowledge.

### Actors

Each actor record contains:

- Stable actor ID and monster or hero content reference.
- Floor and integer coordinates.
- Player-controlled flag.
- Base Might, Agility, Vitality, Wits, and Resolve.
- Current and maximum hit points.
- Energy, speed, and reaction state.
- Disposition and saved relationship overrides.
- Awareness required for reactions.
- Inventory and equipment references where applicable.
- Active conditions and their deterministic timing state.
- Minimal registered behavior state for non-player actors.

The hero becomes an actor referenced by `hero.actorId`; hero name, identity, sight, and position remain available through the new hero and actor records. A floor contains actor IDs and positions without duplicating mutable actor statistics.

### Items and locations

Every physical item instance contains:

- Stable item ID and content ID.
- Positive integer quantity.
- Condition and enchantment state when supported.
- Identification state required by its category.
- Charges or fuel when supported.
- Exactly one typed location: actor backpack, actor equipment slot, floor cell, or consumed/removed only during an unpublished transition.

Published state never contains an item in more than one location, an unreferenced live item, a zero-sized stack, or an incompatible equipment assignment.

### Mutable floor features

Doors, traps, secrets, and placed light sources are saved as typed floor-feature records. Hidden features include authoritative cover presentation, discovery difficulty, trigger/disarm behavior, and per-hero discovery state. Player knowledge stores only what has legitimately been observed.

### Survival and identification

The hero stores hunger reserve and stage, backpack capacity, discovery progress, and current-run identification knowledge. The run stores deterministic appearance maps for compatible potion and scroll groups. Enchanted equipment knowledge remains per item instance.

## Pre-release schema replacement

Only active-run schema v3 is accepted after this milestone. Existing v0, v1, and v2 validators, migration code, and old-save fixtures are removed. Every engine and demonstration fixture is rewritten directly as valid v3 state. Decoding another version returns the existing typed `unsupported_version` failure without attempting conversion.

Only compiled content schema v2 is accepted by the runtime and compiler after this milestone. All bundled YAML moves to source schema v2 in the same implementation slice. Old development rows may remain inert in a local SQLite volume, but they are never selected for a new run or adapted into the new runtime shape. A clean development volume may be used when testing startup. Future incompatible changes begin migration support from active-run v3 and compiled-content v2.

## Attributes and derived statistics

The five base attributes are Might, Agility, Vitality, Wits, and Resolve. Balance YAML defines bounded formulas and coefficients for:

- Maximum health and recovery.
- Melee accuracy and damage.
- Ranged accuracy.
- Defense and reaction reach modifiers.
- Search and disarm capability.
- Condition resistance and concentration where applicable.

Derived values are calculated by pure functions from base attributes, equipped content, conditions, and relevant run effects. Saves retain inputs and current resources, not duplicated derived totals. The projection may include derived totals with an itemized explanation for later UI use.

Milestone 4A fixtures use documented fixed attributes. Character rolling, point buy, class, background, and trait construction arrive later without changing the actor format.

## Integer-energy scheduling

The normal readiness threshold and normal action cost are `100`. Exact speed and action-cost ranges are validated balance data.

At a player decision boundary, the hero is the selected ready actor. A valid hero action subtracts its full cost, even when a heavy action creates negative energy. Reactions resolve without consuming normal-action energy. The scheduler then:

1. Selects a ready actor by greater current energy, then player-controlled priority, then stable actor ID.
2. Stops and returns control when the selected actor is the living hero.
3. Otherwise resolves the selected non-player action and subtracts its full cost.
4. When no actor is ready, advances `worldTime` by the smallest positive integer step that makes at least one actor ready.
5. Adds `speed * elapsed` energy to living scheduled actors using checked integer arithmetic.
6. Applies every time-based survival, condition, recovery, fuel, and feature transition caused by that exact clock advance before selecting the next ready actor.

This selection rule lets equal-speed non-player actors act after the hero spends normal energy and returns the hero to input when all equal-speed actors next become ready together. A faster actor can act more than once before the hero when its accumulated energy permits it. Energy has validated bounds and cannot be banked by leaving a player prompt open. Dead, incapacitated, or off-floor actors are excluded according to registered scheduling rules.

Town time is outside 4A, but the interface distinguishes dungeon time so future town actions can remain turn-based without hunger, fuel, or dungeon-actor advancement.

## Commands, actions, and decisions

Commands remain immutable envelopes with command ID and expected revision. New variants cover:

- Eight-direction movement.
- Explicit melee and ranged attacks.
- Spell or item effects with typed targets.
- Pickup, drop, split, equip, unequip, use, throw, refuel, extinguish, and relight.
- Open and close door.
- Search, disarm, and rest.

A complete command resolves one atomic world step. Commands do not carry trusted derived values, random results, damage totals, hidden identifiers, or action costs.

When legal resolution requires a player choice omitted by the command, the engine returns `decision_required` with a typed public decision descriptor and no state, revision, time, random-stream, or command-ring change. Examples include choosing one of several ground stacks, selecting an equipment slot, confirming aggression against a neutral actor, or selecting a target. Public options are derived from the player's projection and contain no hidden state.

Invalid actions also preserve time and authoritative gameplay state. A valid action interrupted by a consequential reaction is applied because events occurred, even if its intended movement or effect is cancelled.

## Movement

Movement supports north, northeast, east, southeast, south, southwest, west, and northwest. Orthogonal and diagonal steps have the same normal cost.

A diagonal step is illegal when both orthogonally adjacent side cells block movement. This prevents squeezing through a sealed corner while permitting movement past one blocked side. Actor occupancy, feature state, and terrain all participate in authoritative movement validation.

Moving into a hostile actor becomes a melee attack instead of movement. Friendly and neutral actors block ordinary movement. Moving into a neutral actor never attacks implicitly.

## Relationships, hostility, and awareness

Disposition is saved state, not inferred only from content kind. Actors can be friendly, neutral, or hostile, with relationship overrides recording aggression or registered effects.

Only currently hostile and aware actors participate in opportunity attacks. Neutral NPCs neither make nor provoke them. Explicitly attacking a neutral target requires confirmation and establishes hostility before attack resolution. That hostility survives save/load and later supports 4B reputation and faction behavior.

Awareness in 4A is the minimum saved information required for combat and reactions. The demonstration policy can perceive a visible or adjacent hero. Full sight, sound memory, investigation, communication, and uncertain intent belong to 4B.

## Combat

### Attack resolution

Attack resolution uses the combat random stream only:

1. Roll an integer d20.
2. Natural 1 always misses.
3. Natural 20 always hits and critically strikes unless a declared immunity applies.
4. Otherwise, `roll + accuracy` must meet or exceed target defense.
5. On hit, roll structured damage dice and add applicable attribute and item modifiers.
6. On a critical hit, roll the damage dice twice and apply flat modifiers once.
7. Apply armor, typed resistance, vulnerability, and immunity using checked integer arithmetic.
8. Apply the effective damage to health and emit explanatory events.

Typed damage channels initially include physical, fire, cold, poison, and arcane. A successful damaging hit normally deals at least one effective point unless immunity explicitly reduces it to zero. Damage, healing, and loss events report effective values after mitigation and health caps.

### Ranged attacks and targeted effects

Ranged attacks require a legal target, configured range, and unobstructed trajectory. Targeting uses an owned line adapter and never exposes cells or actors absent from the player projection. Firing adjacent to an aware hostile can apply a balance-configured accuracy penalty but does not itself trigger an opportunity attack.

Spells, scrolls, potions, thrown items, traps, and weapon abilities share the registered targeting and effect pipeline. Previews may show known range, trajectory, cost, modifiers, and possible effect range but never consume randomness or show the future result.

### Conditions and death

Conditions are stable typed records referencing registered behavior with validated parameters, source, stacking rule, and duration. The initial registry supports enough mechanics to prove damage-over-time, accuracy or defense modification, stun, root, and a beneficial modifier.

Health reaching zero marks an actor dead immediately, removes it from scheduling and occupancy, disables its unused reaction, and emits ordered death events. Hero death ends further input in 4A. Deterministic score, metrics, unlock, and Hall-record finalization are added in 4B.

## Opportunity attacks

When an actor attempts to move from a hostile actor's reach to a cell outside that reach, every currently eligible hostile reaction is captured before movement. Eligible attackers resolve by stable actor ID.

Each eligible attacker:

- Must be alive, hostile, aware, able to attack, and have `reactionReady`.
- Consumes its reaction before rolling.
- Uses the normal attack and effect pipeline with an opportunity context.
- Regains the reaction only after completing its next normal scheduled turn.

The rule is symmetric for heroes and non-player actors. If the mover dies, remaining reactions stop. If a reaction roots, stuns, or otherwise blocks movement, movement is cancelled; other already-triggered eligible reactions may still resolve while the mover lives. Registered skills, spells, conditions, and movement effects can suppress reactions or change reach without special-case command logic.

## Items and inventory

### Backpack capacity and stacks

The backpack capacity is a count of occupied stack slots. It does not use weight.

Items merge only when content ID and every stack-relevant state agree, including identity knowledge, charges, fuel, enchantment, and condition. Stack limits are positive YAML integers. Non-stackable gear uses one slot per instance. Equipped items do not consume backpack slots.

Pickup, drop, split, and merge preserve exact quantity and location invariants. An action that would exceed capacity returns invalid without consuming time. Ground placement uses deterministic cell and item ordering.

### Equipment

Initial equipment locations are:

- Main hand.
- Off hand.
- Body.
- Head.
- Hands.
- Feet.
- Neck.
- Left ring.
- Right ring.

One-handed weapons, shields, and carried lights compete for hands. Two-handed equipment reserves both hands. A normal carried light therefore creates the approved offense, defense, and visibility trade-off. Later rare gear, spells, or class features may provide alternative light attachment through declared effects.

Equipping and unequipping are atomic. Displaced items return to the backpack. If every displaced item cannot fit, the command is invalid and consumes no time. The engine never silently drops displaced equipment.

### Effect use

Using, throwing, reading, drinking, refueling, extinguishing, and relighting are typed actions. Browsing and inspecting are projection operations and cost no time. Applying an item in the dungeon consumes the declared action cost only after all required choices validate.

## Identification

At run creation, the `effects` random stream deterministically assigns each unidentified item definition a unique verb–noun name and a visual from its referenced YAML identification pool. Item definitions contain only their real identified names. The complete mapping is saved in hidden run state and never regenerated.

Unknown consumables expose only their appearance, category, quantity, and other legitimately observable facts. Using an unknown potion or scroll applies its effect and then identifies the appearance for the current hero. Identifying one appearance reveals all current and future matching instances in that run.

Enchanted equipment stores hidden per-instance properties. It becomes known through a registered examination, use, spell, service, or other identification effect. Equipment knowledge does not automatically identify other instances.

Mechanical identification knowledge ends with the hero. Later profile or guest-session codex discovery may remember that content exists but never reveals a future run's shuffled mapping.

## Hunger, fuel, and recovery

Hunger and fuel advance from elapsed dungeon time, not command count.

Hunger is a bounded integer reserve with balance-defined `sated`, `hungry`, `weak`, and `starving` thresholds. Stage transitions emit warnings once. Hunger first limits natural recovery, then applies modest declared penalties, and starvation applies recurring damage. No threshold transition causes instant death. Food restores a bounded effective amount and can invoke additional registered effects.

Fuel belongs to the light item instance. Enabled equipped or placed lights consume exact integer fuel units as time advances. Configured thresholds emit meaningful warnings before fuel reaches zero. At zero, the source becomes disabled and perception is refreshed. Refueling transfers exact units between compatible items without duplication or loss. Town time later consumes neither hunger nor light fuel.

Recovery is a registered time-based rule affected by hunger, conditions, danger, and content. Healing records the effective amount after the maximum-health cap.

## Doors

Doors are mutable features with stable IDs and states such as closed, open, locked, or registered special state. A closed door blocks movement, sight, and light. An open door permits them. Opening and closing normally cost one action.

Closing fails without consuming time when the doorway is occupied or another invariant prevents the transition. Geometry-changing transitions immediately refresh sight, lighting, knowledge, and remembered presentation. Special locks or mechanisms reference registered behaviors with strict parameters.

## Traps, secrets, and searching

Hidden traps and secrets store a deterministic hidden discovery difficulty. They do not appear in player projections until discovered or triggered.

Entering or newly illuminating a feature's search area grants one passive discovery contribution based on Wits, illumination, and declared modifiers. The saved feature state records that the context has been evaluated, so save/load, repeated projection, or repeated light refresh cannot create new passive attempts.

Search is an explicit time-consuming action. It adds discovery progress to nearby eligible features. Repeating Search without changing position, illumination band, tools, or relevant conditions has reduced effectiveness but always contributes at least one point. Eventual discovery is therefore guaranteed at a resource and danger cost rather than through reloadable repeated rolls.

Discovery reveals the feature and updates knowledge. A secret passage projects as its declared cover terrain until discovery. Revealing geometry immediately refreshes perception.

Disarm uses the effects random stream and a registered skill check. Outcomes may include success, safe failure, tool damage, or triggering according to the trap definition. Dangerous outcomes require authored warning and presentation fields. Triggering a hidden trap reveals it before or as its observable effects resolve.

## Rest

Rest is a bounded repeated-wait action implemented through the same scheduler and world-time systems as ordinary play. It is never a direct health assignment or actor skip.

Rest stops when any of these occurs:

- Full permitted recovery.
- Configured maximum duration.
- A visible danger or aware hostile.
- Damage or forced movement.
- A meaningful sound event.
- A hunger or fuel threshold.
- A condition change.
- A decision request or other input requirement.
- Hero death.

The result reports why rest stopped and all internal ordered events. Hunger, fuel, creatures, traps, conditions, and recovery continue normally during every internal step.

## Content schema v2

New YAML compilation emits compiled content schema v2. Existing source directories remain supported, and the compiler adds strict definitions for spells, traps, loot tables, and balance data.

### Monster definitions

Monster content declares base attributes, health, speed, accuracy, defense, perception, structured damage, armor, resistances, disposition, glyph presentation, tags, behavior ID, and validated behavior parameters. The 4A bundled monster uses the minimal approach-and-attack policy. Rich population composition and AI state arrive in 4B.

### Item definitions

Item content declares category, stack limit, compatible equipment locations, handedness, structured combat modifiers, armor, fuel capacity, identification group, appearance pool reference, registered effects, price, rarity, depth eligibility, tags, and presentation.

### Spell definitions

Spell content declares targeting rule, range, action cost, resource cost, ordered effect sequence, tags, and presentation. 4A needs one representative targeted spell or scroll, not a complete spell system or class spell list.

### Trap definitions

Trap content declares discovery and disarm difficulty, search area, trigger rule, reset behavior, ordered effect sequence, warnings, tags, and known and hidden presentation.

### Loot tables

Loot tables contain weighted entry references, integer quantity ranges, depth eligibility, and category constraints. Nested tables are allowed only when the reference graph is acyclic. Stable ordering precedes weighted selection.

### Balance definitions

Balance data declares action costs, readiness threshold, speed bounds, attribute coefficients, backpack capacity, hunger stages, recovery rules, identification pools, discovery coefficients, resistance bounds, and other named numeric rules. Fields have explicit safe integer ranges and semantic relationships.

### Registered behaviors and effects

YAML never contains scripts, expressions, or custom executable tags. It references a closed TypeScript registry by stable ID. Each entry has:

- A strict parameter schema.
- A browser-safe pure resolver.
- Declared targeting and visibility rules where applicable.
- Tests for success, invalid inputs, deterministic random consumption, and projection safety.

Initial effect primitives include damage, healing, condition application and removal, forced movement, reveal, fuel transfer, light-state change, item consumption, and feature mutation. Ordered effect sequences stop or continue according to an explicit registered rule; they do not infer transactional behavior from exceptions.

The compiler rejects unknown IDs, invalid parameters, missing references, impossible equipment definitions, malformed dice, empty or incompatible identification pools, loot cycles, unreachable foundational generation categories, invalid depth ranges, unsafe integers, and duplicate stable IDs. Diagnostics remain deterministic and identify file, entry, field path, and correction.

## Bundled proof content

The repository includes only enough content to exercise every 4A interface:

- The existing cave rat expanded to the v2 monster schema.
- One armored training beetle with a deterministic behavior that exercises ranged positioning and a condition interaction.
- One melee weapon, one ranged weapon and ammunition rule, armor, shield, torch, lantern, fuel, food, healing potion, harmful potion, scroll, and enchanted gear item.
- One targeted ember scroll effect.
- One trap, one secret-passage definition, and mutable ordinary door behavior.
- One small loot table and one balance entry.

Full depth-band content and balance remain in Milestone 7.

## Observable projection

The player projection contains only currently legitimate knowledge:

- The hero's own attributes, effective derived values, health, hunger, conditions, equipment, inventory, fuel, identification knowledge, and available public actions.
- Visible and sufficiently illuminated actors with public presentation, observable conditions, disposition, and readable intent only when already determined.
- Remembered terrain without current actors or ground items.
- Visible ground items using known identity or shuffled unknown appearance.
- Discovered features and legitimately observed feature state.
- Known action costs, target legality, range, trajectory, modifiers, and possible effect ranges.

It excludes hidden actors, undiscovered features, exact hidden difficulties, unknown content IDs and properties, random streams, future rolls, future AI decisions, unseen item instances, full authoritative saves, and private scheduler state.

Authoritative events pass through a visibility-aware event projector. Observable combat events explain rolls and effective outcomes. Sounds outside sight may expose a description and approximate direction but not an exact hidden cell or actor identity unless another rule reveals it.

## Errors and publication

Failure classes remain explicit:

- Protocol rejection: stale revision or conflicting command ID; no publication or ring insertion.
- Decision required: incomplete but potentially legal player action; typed public choices and no state change.
- Invalid action: complete action that is illegal in current authoritative state; concrete public reason and no time or random consumption.
- Applied action: at least one consequential transition occurred; full world step is published even if the intended movement or effect was interrupted.
- Internal invariant failure: throw before publication; caller retains the previous state.

All arithmetic uses checked safe integers. Published state passes runtime schema validation in development, tests, save encoding, and external boundaries. Engine exceptions never include hidden state in public responses.

## Testing strategy

Every implementation task follows RED/GREEN test-driven development.

### Focused example tests

- Scheduler ordering, speed differences, heavy and quick action costs, and overflow rejection.
- Orthogonal, diagonal, corner, occupancy, bump-attack, and reaction movement.
- Attack rolls, natural results, critical damage, armor, resistance, immunity, healing, and death.
- Hostility transitions and neutral confirmation.
- Reaction eligibility, ordering, recovery, suppression, death, and movement cancellation.
- Item location, capacity, stacking, splitting, displacement, hand conflicts, and atomic failure.
- Identification shuffles, use-then-reveal, per-instance enchantments, and projection redaction.
- Hunger stages, starvation cadence, fuel warnings, refueling conservation, and light refresh.
- Door geometry, passive discovery, Search progress, disarm outcomes, secret cover, and reload safety.
- Rest interruption for every declared condition.
- Effect registry parameter validation and deterministic stream isolation.
- Content parsing, semantic validation, hashing, and diagnostics.
- Clear rejection of unsupported save and content schema versions.
- Player projection and event non-disclosure.

### Property-based invariants

Use seeded `fast-check` properties with failure seed and shrink path printed by Vitest. Properties cover:

- Valid action sequences always preserve schema validity.
- Energy, world time, health, hunger, fuel, quantities, and capacities remain safe integers within bounds.
- Every live item has exactly one compatible location.
- Equipment assignments are non-overlapping and handedness-valid.
- Quantity and fuel transfers conserve totals except for declared consumption.
- Reactions occur only between aware hostiles and at most once before recovery.
- Invalid, rejected, and decision-required results preserve state and random streams.
- Save/load continuation equals uninterrupted execution, including stored public events.
- Hidden identities, features, actors, and geometry never enter projections.

Property generators create only schema-valid starting snapshots unless the property tests validation itself. Randomness used by the test generator is separate from engine random streams.

### Replay and boundary tests

- Unsupported v0, v1, and v2 save fixtures fail with the typed version error and no partial state.
- Schema-v1 source and compiled content fail with deterministic version diagnostics.
- Continuous and split combat scenarios produce identical state, results, events, and projections.
- Separate Node processes produce the same demonstration hashes.
- Browser-boundary tests reject Node-only imports and ambient nondeterminism.
- The server, web client, content compiler, engine, and Docker image continue to test, type-check, and build.

## Stable interfaces after 4A

After publication, these become stable, versioned interfaces:

- Actor, item, item-location, equipment, condition, feature, relationship, hunger, identification, and scheduler save fields.
- World-time and integer-energy semantics.
- Eight-direction movement and sealed-corner rules.
- Command, result, decision, action, reaction, combat, inventory, survival, feature, and event discriminators.
- Attack, critical, damage, mitigation, reaction, and death ordering.
- Registered targeting, behavior, and effect identifiers shipped by the milestone.
- Compiled content schema v2 fields and rejection of unsupported versions.
- Player projection fields and hidden-state exclusions.

Milestone 4B may add actor behaviors, population state, NPC inventories, achievements, metrics, scores, rewards, and run records. It must preserve deterministic world steps, immutable publication, complete snapshots, schema-v3 save and schema-v2 content continuation, stream isolation, and hidden-state-safe projection.
