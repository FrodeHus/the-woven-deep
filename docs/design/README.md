# The Woven Deep — Design Docs

This is the curated, navigable design record for The Woven Deep. It is organized by
subsystem rather than by date or by spec/plan. Each doc preserves the substantive design
decisions and rationale from the original specs, with process scaffolding (task
checklists, execution notes, step-by-step commands) stripped out.

> The original process artifacts live on in `docs/superpowers/specs/` (design specs) and
> `docs/superpowers/plans/` (implementation plans), in chronological order, one pair per
> milestone. They are not deleted or superseded by this directory — they're the historical
> record of how each milestone was scoped and executed. This directory is the distilled,
> subsystem-oriented view for understanding *what the game is* today, without reading
> eighteen thousand lines of milestone history.

## Architecture overview

The Woven Deep is a TypeScript monorepo with four package/app boundaries:

- **`packages/engine`** — the deterministic game engine. Pure, immutable, browser-safe: no
  React, no Fastify, no SQLite, no Node-only APIs, no wall clock, no ambient randomness.
  Every consequential roll draws from a named seeded random stream stored in the run. The
  same engine runs client-side for guests and server-side for signed-in profiles.
- **`packages/content`** — the YAML content compiler. Reads `content/**/*.yaml`, validates
  it strictly (unknown-field rejection, cross-reference checks, semantic checks), compiles
  it to stable hashed JSON, and exposes browser-safe model types plus a Node-only
  compiler entry point.
- **`apps/server`** — the Fastify HTTP/WebSocket server. Owns content-pack storage,
  authentication, and (from milestone 6B on) authoritative run state. Never trusts
  client-submitted state, scores, or unlocks.
- **`apps/web`** — the React/Vite browser client. A framework-free session layer
  (`apps/web/src/session/`) owns orchestration and talks to the engine directly (guest
  mode) or over WebSocket (profile mode, from 6B); React (`apps/web/src/ui/`) owns
  screen composition and rendering only.

The engine is the single source of truth for rules; the content compiler is the single
source of truth for data; the session layer is the only thing that touches both from the
browser. See [`deterministic-engine.md`](deterministic-engine.md) for the reducer contract
that makes all of this replayable.

## Docs in this directory

| Doc | Status | What it covers |
|---|---|---|
| [`deterministic-engine.md`](deterministic-engine.md) | Shipped | The pure command/event reducer, seeded RNG streams, save encoding, versioning and migration discipline that everything else builds on. |
| [`content-pipeline.md`](content-pipeline.md) | Shipped | YAML content packs: directory layout, strict validation stages, compilation, hashing, content-hash binding to runs, the closed registries (behaviors, effects, targeting). |
| [`dungeon-generation-and-light.md`](dungeon-generation-and-light.md) | Shipped | Procedural floor generation, vaults, field of view, colored lighting and occlusion, remembered terrain, and the light-out survivability mechanic (with its feat knobs). |
| [`core-gameplay-survival.md`](core-gameplay-survival.md) | Shipped | Attributes, integer-energy scheduling, movement, combat, opportunity attacks, inventory/equipment, identification, hunger/fuel, doors/traps/secrets, rest. |
| [`populations-and-npcs.md`](populations-and-npcs.md) | Shipped | Monster population models (individual/group/swarm/boss), broad intent, the Deep's Champion and Echoes, travelling merchants, factions and reputation. |
| [`run-records.md`](run-records.md) | Shipped | Run metrics, conclusion, scoring, the Hall of Records, Heart lineage, heirloom selection, achievements, and the repository contract. |
| [`guest-client.md`](guest-client.md) | Shipped | The guest browser experience end to end: play core, character generation, town, the full overlay interface, and the polish/accessibility pass. |
| [`ui-redesign.md`](ui-redesign.md) | In progress | The shadcn/Base UI/Tailwind/cmdk chrome rebuild (sub-project 1, shipped) and the chargen console flow redesign (sub-project 2, next). |
| [`identity-and-persistence.md`](identity-and-persistence.md) | In progress | Server-authoritative profiles: magic-link auth, roaming settings (6A, shipped), and the still-to-come server-authoritative runs (6B) and verified Hall (6C). |
| [`future.md`](future.md) | — | Backlog: in-flight features, planned feats, and deferred polish items. |

## Reading order

For a first read, `deterministic-engine.md` and `content-pipeline.md` establish the
foundations everything else assumes. From there, the gameplay docs
(`dungeon-generation-and-light.md`, `core-gameplay-survival.md`,
`populations-and-npcs.md`, `run-records.md`) describe the engine's rules layer roughly in
build order. `guest-client.md`, `ui-redesign.md`, and `identity-and-persistence.md`
describe the browser client and server built on top of that engine.

## Where design decisions conflict

Several docs note points where a later spec explicitly supersedes an earlier one (for
example, the ending model in `run-records.md` supersedes the original artifact-escape
model from the master design). Where this consolidation found a conflict between two
specs, the later spec's decision governs, and the doc says so explicitly rather than
silently picking a side.
