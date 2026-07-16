# The Woven Deep Implementation Roadmap

**Source design:** `docs/superpowers/specs/2026-07-13-woven-deep-design.md`

## Why the work is split

The approved design contains several independently reviewable systems: deterministic simulation, YAML compilation, procedural generation, a guest client, an authoritative server, authentication, progression, and administration. Each milestone below ends with a runnable and testable deliverable. A detailed implementation plan is written immediately before executing its milestone, using the interfaces established by completed milestones.

## Milestone sequence

### 1. Foundation and YAML content platform

Create the TypeScript workspace, strict YAML content compiler, content hashing, immutable SQLite content-pack storage, Fastify startup path, diagnostic React client, and production Docker image.

**Exit demonstration:** editing or adding a YAML monster, restarting the container, and observing a new validated content hash and entry in the browser without changing TypeScript.

**Detailed plan:** `docs/superpowers/plans/2026-07-13-foundation-content-platform.md`

### 2. Deterministic engine kernel and save format

Implement seeded random streams, immutable commands and domain events, entity identifiers, turn sequencing, content-pack binding, compact grid storage, complete active-run snapshots, migrations, recent-command deduplication, and deterministic replay tests.

**Exit demonstration:** a command-line hero walks a fixed test floor, saves, reloads, and produces byte-equivalent serialized state and event output.

**Detailed plan:** `docs/superpowers/plans/2026-07-13-deterministic-engine-kernel.md`

### 3. Dungeon generation, visibility, and light

Implement rooms and corridors, connectivity validation, derived floor seeds, authored vault placement, knowledge bitsets, line of sight, occlusion, colored illumination, multiple light sources, remembered terrain, and DOM-ready observable projections.

**Exit demonstration:** seeded generated floors render in a terminal fixture with dynamic torch radius, occluded light, remembered cells, and reproducible snapshots.

**Detailed plan:** `docs/superpowers/plans/2026-07-13-dungeon-visibility-light.md`

### 4. Core gameplay, populations, and NPCs

Implement attributes, combat, equipment, inventory, identification, hunger, fuel, traps, doors, secrets, enemy intent, individual/group/swarm/boss populations, discovery protection, achievements, dungeon merchants, reputation, metrics, and scoring.

Deliver this milestone through two independently reviewable slices:

- **4A — core gameplay and survival:** actors, integer-energy scheduling, combat, reactions, inventory, equipment, identification, hunger, fuel, doors, traps, secrets, and rest.
- **4B — populations, NPCs, and run records:** individual/group/swarm/boss behavior, dungeon merchants, discovery protection, reputation, achievements, metrics, scoring, and deterministic run finalization.

**4A design:** `docs/superpowers/specs/2026-07-13-core-gameplay-survival-design.md`

**4A detailed plan:** `docs/superpowers/plans/2026-07-13-core-gameplay-survival.md`

**4B1 design:** `docs/superpowers/specs/2026-07-14-population-encounters-design.md`

**4B1 population encounters — complete:** `docs/superpowers/plans/2026-07-14-population-encounters.md`

**4B2 design:** `docs/superpowers/specs/2026-07-14-dungeon-npcs-design.md`

**4B2 dungeon NPCs (travelling merchants) — complete:** `docs/superpowers/plans/2026-07-14-dungeon-npcs.md`

**4B3 run records — complete:** `docs/superpowers/specs/2026-07-15-run-records-design.md`, `docs/superpowers/plans/2026-07-15-run-records.md`

**Exit demonstration:** an automated simulation can fight a leader group, contain or flee a growing swarm, encounter a rare boss, trade with or attack a travelling merchant, and finalize a deterministic run record.

### 5. Guest game and complete player interface

Implement profile-free session state, character generation, Tactical Triptych play, Living Tapestry visuals, inventory, character sheet, map, journal, codex, Hall of Records, town, merchants, house storage, run conclusion, keyboard routing, settings, accessibility, and contextual onboarding.

Deliver this milestone through four independently reviewable slices:

- **5A — guest play core:** engine run constructor, guest session layer, DOM-cell renderer with the glow treatment, Tactical Triptych layout, keyboard survival commands, event log, and session persistence. Exit demonstration: `npm run guest:e2e` green — a scripted guest kills a monster, picks up an item, eats, rests, and descends by keyboard alone, with reload-restore, keyboard reachability, and responsive-tier checks.
- **5B — character generation and run lifecycle:** engine character generation (attribute roll and point buy, classes, backgrounds, traits, starting equipment), title screen, the seven-step generation flow, run conclusion screen, and the guest Hall of Records backed by a session `RunRecordRepository`. Exit demonstration: a guest generates a custom hero, dies or descends to a conclusion, and sees the run recorded in the session Hall of Records.
- **5C — town slice:** engine town floor 0, the three town merchants, house storage, dungeon entrance, and their screens. Exit demonstration: a guest prepares in town — trades with all three merchants, stores items at home — and enters the dungeon.
- **5D — full interface:** inventory, character sheet, map, journal, and codex overlays, settings, help, keyboard rebinding, the accessibility pass, contextual onboarding, and the Living Tapestry art pass. Includes fixing the compact-tier threat drawer deliberately deferred in 5A (renders as an ~18px sliver, and the opened panel overflows the map). Exit demonstration: every screen and overlay operates by keyboard with the completed accessibility and art passes.

**5A design:** `docs/superpowers/specs/2026-07-15-guest-play-core-design.md`

**5A guest play core — this plan's scope, e2e gate green:** `docs/superpowers/plans/2026-07-15-guest-play-core.md`

**Exit demonstration:** a desktop browser can complete a representative five-floor guest campaign slice, lose session progress when the session closes, and operate every screen by keyboard.

### 6. Server-authoritative profiles

Implement Mailgun magic links, hashed tokens and sessions, CSRF and WebSocket connection tokens, one-email/one-profile persistence, compact sequenced command batches, observable state patches, prediction reconciliation, immediate consequential saves, periodic movement checkpoints, reconnection, profile deletion, and Docker-volume operations.

**Exit demonstration:** a signed-in hero resumes across browsers while attempts to submit fabricated state, scores, unlocks, stale commands, or hidden-map requests are rejected.

### 7. Town progression and full campaign content

Expand the vertical slice to 20 floors, five-floor depth bands, milestone encounters, the **Final Chamber and endings** milestone, four classes, backgrounds, traits, three town merchants, unlock pools, class foreshadowing, boss rewards, profile achievements, and balance-complete YAML content.

**Final Chamber and endings** (superseding endgame requirements, 2026-07-15): the Heart of the Deep is a living person, not an artifact — there is no artifact to recover or carry out. This milestone implements the Final Chamber encounter, the ending choices that produce the `became-heart`, `refused`, and `broke-cycle` completion types, ending dialogue, lore prerequisites gating the choices, and the Break-the-Cycle unlock content. It only wires ending triggers into the run-records finalization pipeline built in 4B3 (`finalizeRun`, the completion-type tiers, and the Heart lineage store); the data model for all four completion types already exists. This replaces the master design's "Heart of the Deep return journey" and its escaped-with-Heart / died-with-Heart outcome tiers everywhere.

**Exit demonstration:** a new persistent profile can create a hero, prepare in town, reach the Final Chamber, and finalize each ending choice into its completion-type tier (`became-heart`, `refused`, `broke-cycle`, or `died`), clear hero-scoped storage, and apply breadth-only unlocks.

### 8. Records, telemetry, and admin dashboard

Implement immutable Hall records, lifetime statistics, opt-in consent, privacy-reduced run summaries, trusted/unverified separation, retention and deletion, admin allow-list authorization, aggregate queries, sample warnings, filters, trend views, and CSV export.

**Exit demonstration:** opted-in trusted runs populate the read-only admin dashboard without exposing emails, hero names, raw commands, IP addresses, or run seeds; profile deletion removes linked telemetry.

### 9. Feel, balance, and release hardening

Add positional audio, restrained motion, causal death recaps, content-pool reports, automated run simulations, browser accessibility audits, backup and restore documentation, migration rehearsals, performance budgets, production health checks, and release smoke tests.

**Exit demonstration:** the production Docker image passes the complete verification matrix and a representative 90–150 minute run meets pacing, clarity, durability, and accessibility targets.

## Cross-milestone rules

- Every milestone uses test-driven tasks and finishes with a clean commit.
- Engine packages never import React, Fastify, SQLite, browser storage, or Node-only APIs.
- Content identifiers, command names, event names, save fields, and protocol fields remain stable after publication; changes use explicit migrations.
- Guest and authoritative modes execute the same engine and content definitions.
- Signed-in clients never receive hidden world state, future random state, unlock evaluation state, or complete authoritative saves.
- New content must pass strict YAML compilation, semantic validation, deterministic hashing, and generation-pool reports.
- Each milestone updates this roadmap when an established interface materially changes a subsequent milestone.
