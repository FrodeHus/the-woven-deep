# The Woven Deep Implementation Roadmap

**Source design:** `docs/superpowers/specs/2026-07-13-woven-deep-design.md`

## Why the work is split

The approved design contains several independently reviewable systems: deterministic simulation, YAML compilation, procedural generation, a guest client, an authoritative server, authentication, progression, and administration. Each milestone below ends with a runnable and testable deliverable. A detailed implementation plan is written immediately before executing its milestone, using the interfaces established by completed milestones.

## Milestone sequence

### 1. Foundation and YAML content platform

Create the TypeScript workspace, strict YAML content compiler, canonical content hashing, immutable SQLite content-pack storage, Fastify startup path, diagnostic React client, and production Docker image.

**Exit demonstration:** editing or adding a YAML monster, restarting the container, and observing a new validated content hash and entry in the browser without changing TypeScript.

**Detailed plan:** `docs/superpowers/plans/2026-07-13-foundation-content-platform.md`

### 2. Deterministic engine kernel and save format

Implement seeded random streams, immutable commands and domain events, entity identifiers, turn sequencing, content-pack binding, compact grid storage, complete active-run snapshots, migrations, recent-command deduplication, and deterministic replay tests.

**Exit demonstration:** a command-line hero walks a fixed test floor, saves, reloads, and produces byte-equivalent canonical state and event output.

### 3. Dungeon generation, visibility, and light

Implement rooms and corridors, connectivity validation, derived floor seeds, authored vault placement, knowledge bitsets, line of sight, occlusion, colored illumination, multiple light sources, remembered terrain, and DOM-ready observable projections.

**Exit demonstration:** seeded generated floors render in a terminal fixture with dynamic torch radius, occluded light, remembered cells, and reproducible snapshots.

### 4. Core gameplay, populations, and NPCs

Implement attributes, combat, equipment, inventory, identification, hunger, fuel, traps, doors, secrets, enemy intent, individual/group/swarm/boss populations, discovery protection, achievements, dungeon merchants, reputation, metrics, and scoring.

**Exit demonstration:** an automated simulation can fight a leader group, contain or flee a growing swarm, encounter a rare boss, trade with or attack a travelling merchant, and finalize a deterministic run record.

### 5. Guest game and complete player interface

Implement profile-free session state, character generation, Tactical Triptych play, Living Tapestry visuals, inventory, character sheet, map, journal, codex, Hall of Records, town, merchants, house storage, run conclusion, keyboard routing, settings, accessibility, and contextual onboarding.

**Exit demonstration:** a desktop browser can complete a representative five-floor guest campaign slice, lose session progress when the session closes, and operate every screen by keyboard.

### 6. Server-authoritative profiles

Implement Mailgun magic links, hashed tokens and sessions, CSRF and WebSocket connection tokens, one-email/one-profile persistence, compact sequenced command batches, observable state patches, prediction reconciliation, immediate consequential saves, periodic movement checkpoints, reconnection, profile deletion, and Docker-volume operations.

**Exit demonstration:** a signed-in hero resumes across browsers while attempts to submit fabricated state, scores, unlocks, stale commands, or hidden-map requests are rejected.

### 7. Town progression and full campaign content

Expand the vertical slice to 20 floors, five-floor depth bands, milestone encounters, the Heart of the Deep return journey, four classes, backgrounds, traits, three town merchants, unlock pools, class foreshadowing, boss rewards, profile achievements, and balance-complete YAML content.

**Exit demonstration:** a new persistent profile can create a hero, prepare in town, recover the Heart, escape or die, clear hero-scoped storage, and apply breadth-only unlocks.

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
