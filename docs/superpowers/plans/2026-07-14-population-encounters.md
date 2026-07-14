# Population Encounters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Milestone 4B1 as deterministic YAML-authored individual, group, swarm, boss, and profile-local fallen-champion encounters with readable intent, strict hidden-state projection, exact save/replay, and complete operator documentation.

**Architecture:** Replace the pre-release content shape with schema v3 and active-run saves with schema v4. Keep encounter definitions separate from reusable monsters, decide rare eligibility once per run, populate floors atomically, and route actor turns through saved perception, memory, population state, and a project-owned ROT.js A* adapter. The host may provide discovery-protection and fallen-champion inputs, but the browser-safe engine remains pure and owns no profile storage.

**Tech Stack:** TypeScript 5.8+, Node.js 22.12+, Zod 4, YAML 2.8, ROT.js 2.2.1, Vitest 3.2, fast-check 4.8.0, SQLite/Fastify/React integration gates, Docker Compose.

## Global constraints

- Follow `docs/superpowers/specs/2026-07-14-population-encounters-design.md`; amend and reapprove the design before changing an approved rule.
- Keep the engine browser-safe. It must not import React, Fastify, SQLite, browser storage, Node-only APIs, wall clocks, ambient randomness, or profile repositories.
- Preserve `resolveCommand` as a pure immutable boundary. Every consequential roll uses a named saved random stream.
- Replace source and compiled content schema v2 with v3 and active-run schema v3 with v4. Rewrite fixtures directly; retain no migration code for these pre-release shapes.
- Keep monster definitions reusable. Only `encounter` entries own population composition, run appearance probability, discovery protection, and per-run instance limits.
- YAML selects closed registered mechanics and validated parameters. It contains no scripts, expressions, executable tags, or behavior trees.
- Use ROT.js A* only behind a project-owned synchronous adapter. Game-owned code controls passability, diagonal corner rules, occupancy, door policy, goal selection, stable tie-breaking, and action costs.
- Sort identifier sets and deterministic candidate lists using existing code-unit ordering. Never depend on object insertion order, locale sorting, filesystem enumeration, or unstable priority ties.
- Group and swarm state freezes while its floor is inactive. Boss recovery is a bounded re-entry calculation, not off-floor simulation.
- Opportunity attacks remain hostility- and awareness-gated. Neutral actors are unaffected until a relationship override makes them hostile.
- Broad intent is observable only for visible actors. Exact goals, paths, target cells, group knowledge, run gates, probabilities, spawn rolls, and reward rolls stay hidden.
- A Deep's Champion is optional for progression, appears at most once for the supplied unconquered rank-1 Hall record, and creates the recorded heirloom at most once. Ranks 2–10 are independently rare-gated weaker Echoes, capped at two per run, with no heirloom path.
- Every task follows RED/GREEN TDD, runs the focused suite and affected package gates, ends with a focused commit, and receives review before the next task.
- Do not use the disallowed technical term noted in project guidance; prefer stable, authoritative, primary, or content-hash wording.

## File and responsibility map

### Content platform

- `packages/content/src/model.ts`: schema-v3 monster, encounter, group, swarm, boss, champion-template, placement, phase, and intent presentation types.
- `packages/content/src/compiler/schema.ts`: strict YAML schemas and local structural refinements.
- `packages/content/src/compiler/registries.ts`: closed behavior, formation, intent, leader-response, swarm-response, and boss phase identifiers and parameter schemas.
- `packages/content/src/compiler/content-validation.ts`: references, cap relationships, phase ordering, vault tags, transferability, fallback, and foundational encounter coverage.
- `packages/content/src/content-schema.ts`: strict validation for stored/transferred compiled schema-v3 packs.
- `packages/content/src/compiler/compile-directory.ts`: stable ordering, generation report, and hash input.
- `content/encounters/*.yaml`: individual, group, swarm, and boss proof encounters with production rarity.
- `content/monsters/*.yaml`: reusable actors, including leader, swarm source, swarm child, and boss examples.
- `content/items/*.yaml` and `content/loot-tables/*.yaml`: boss unique reward, enhanced loot, and champion fallback relic.
- `content/champions/*.yaml`: the single fallen-champion normalization, quality-weighted heirloom selection, and fallback template.

### Engine state and generation

- `packages/engine/src/population-model.ts`: run decisions, population instances, actor behavior state, intents, champion host input, and discovery updates.
- `packages/engine/src/model.ts`: schema-v4 run envelope, population events, and model re-exports.
- `packages/engine/src/actor-model.ts`: population membership, presentation overrides, and saved AI state.
- `packages/engine/src/save-schema.ts`: schema-v4 structural and cross-record validation.
- `packages/engine/src/content-bound-validation.ts`: run-to-content references and model-specific invariants.
- `packages/engine/src/random.ts` and `packages/engine/src/versions.ts`: independent `population-gates` stream and new schema versions.
- `packages/engine/src/population-gates.ts`: run eligibility and pure discovery-protection conclusion calculation.
- `packages/engine/src/population-placement.ts`: encounter selection, composition, atomic placement, route checks, and stable instance creation.
- `packages/engine/src/floor-integration.ts`: invokes population placement after terrain/vault reservation.

### Engine behavior

- `packages/engine/src/pathfinding.ts`: game-owned passability and deterministic next-step selection around ROT.js A*.
- `packages/engine/src/population-perception.ts`: direct observation, sound memory, last-known targets, and encounter discovery.
- `packages/engine/src/population-intent.ts`: broad intent derivation and change events.
- `packages/engine/src/group-behavior.ts`: relay graph, formations, roles, leader bonuses, and leader outcomes.
- `packages/engine/src/swarm-behavior.ts`: source timers, stable child placement, caps, and shutdown responses.
- `packages/engine/src/boss-behavior.ts`: phases, arena state, re-entry recovery, uniqueness, and reward creation.
- `packages/engine/src/champion.ts`: ranked host snapshot normalization, optional Champion/Echo placement, display identity, conquest, Echo gating, and heirloom creation.
- `packages/engine/src/behavior.ts`: registered individual decisions and delegation to model-specific behavior.
- `packages/engine/src/world-step.ts`: population observation and state transitions at deterministic action boundaries.

### Projection, verification, and operations

- `packages/engine/src/projection.ts`: visible actor, leader, source, phase, champion, and broad-intent projection.
- `packages/engine/src/event-projection.ts`: population event redaction based on legitimate observation.
- `packages/engine/test/population-*.test.ts`: focused examples and regression coverage.
- `packages/engine/test/population-properties.test.ts`: at least 500 seeded invariant sequences.
- `packages/engine/test/population-replay.test.ts`: continuous versus split-save byte identity.
- `scripts/population-demo.mjs`: deterministic terminal exit demonstration.
- `packages/engine/test/fixtures/population-demo-hashes.json`: checked expected save, event, and projection hashes.
- `docs/server-admin/content-configuration.md`: complete encounter and champion-template reference.
- `packages/content/test/admin-docs.test.ts`: automatic documentation coverage for every kind and closed identifier.
- `package.json` and `Dockerfile`: population demonstration and release gates.

---

### Task 1: Replace content schema v2 with encounter-aware schema v3

**Files:**
- Modify: `packages/content/src/model.ts`
- Modify: `packages/content/src/content-schema.ts`
- Modify: `packages/content/src/compiler/schema.ts`
- Modify: `packages/content/src/compiler/registries.ts`
- Modify: `packages/content/src/compiler/content-validation.ts`
- Modify: `packages/content/src/compiler/compile-directory.ts`
- Modify: `packages/content/test/model.test.ts`
- Modify: `packages/content/test/parse-file.test.ts`
- Modify: `packages/content/test/compile-directory.test.ts`
- Modify: `packages/content/test/default-content.test.ts`
- Modify: every existing `content/**/*.yaml`
- Create: `content/encounters/early-populations.yaml`
- Create: `content/champions/deeps-champion.yaml`
- Create: supporting monster, item, and loot-table YAML named by those definitions

**Interfaces:**
- Consumes: schema-v2 content compiler, stable hashing, existing monster behaviors/effects, vault tags, item transferability, and loot tables.
- Produces: schema-v3 `EncounterContentEntry`, `FallenChampionTemplateContentEntry`, strict discriminated encounter definitions, bundled-kind coverage, and reusable monsters without `runAppearanceChance`.

- [x] **Step 1: Write failing v3 public-model and parser tests**

Require `CONTENT_SCHEMA_VERSION === 3`, include `encounter` and `fallen-champion-template` in `ContentKind`, and reject source version 2 before exposing entries. Assert that monster entries no longer accept `runAppearanceChance` and encounter entries require it.

- [x] **Step 2: Write failing strict encounter-shape tests**

Cover all four models, unknown fields, probability bounds, positive quantities, placement distance/cell rules, group role uniqueness, formation identifiers, leader constraints, `collapse` plus `supernaturalBond`, swarm source tags and cap ordering, descending unique boss thresholds, one unique item reward, one enhanced loot table, and `maximumInstancesPerRun: 1` for bosses.

Run: `npm test --workspace @woven-deep/content -- --run test/model.test.ts test/parse-file.test.ts test/compile-directory.test.ts`

Expected: FAIL because schema v3 and encounter kinds do not exist.

- [x] **Step 3: Add closed schema-v3 types and registries**

Add common encounter fields and discriminated definitions from the design. Use closed string unions for formation, intent presentation, leader outcome, swarm shutdown, behavior overrides, and boss phase effects. Define exactly one champion template with depth-scaled caps, normalized ability/equipment choices, fallback monster presentation, fallback item reference, positive per-rarity heirloom weights, a non-negative quality-rank bonus, a low Echo probability, a positive per-run Echo cap, stricter Echo power percentages, and an enhanced ordinary Echo loot table. Items expose explicit heirloom eligibility so mechanics never infer transferability from descriptive tags.

- [x] **Step 4: Add semantic cross-file validation**

Resolve monster, item, loot-table, vault-tag, behavior, effect, ability, and champion fallback references. Validate all min/max/cap relationships, stable role/phase IDs, leader role membership, source monster tags, unique rewards, item transferability, positive nondecreasing rarity weights, and required descriptions for supernatural collapse rewards.

- [x] **Step 5: Rewrite bundled YAML and add proof content**

Change every file envelope to schema v3, remove monster-owned appearance chance, and add low-volume production examples for each encounter model. Keep the boss base chance at `0.08`, discovery increment at `0.03`, cap at `0.35`, and maximum one instance per run. Add a safe champion fallback relic and enhanced boss loot table.

- [x] **Step 6: Verify stable compilation and commit**

Run: `npm test --workspace @woven-deep/content && npm run typecheck --workspace @woven-deep/content && npm run build --workspace @woven-deep/content && npm run content:validate`

Expected: all content tests pass, two compiles produce identical hashes, and the bundled pack reports every new kind.

Commit: `feat: add encounter content schema`

---

### Task 2: Replace active-run schema v3 with population state v4

**Files:**
- Create: `packages/engine/src/population-model.ts`
- Modify: `packages/engine/src/model.ts`
- Modify: `packages/engine/src/actor-model.ts`
- Modify: `packages/engine/src/save-schema.ts`
- Modify: `packages/engine/src/save-codec.ts`
- Modify: `packages/engine/src/content-bound-validation.ts`
- Modify: `packages/engine/src/versions.ts`
- Modify: `packages/engine/src/random.ts`
- Modify: `packages/engine/src/fixture.ts`
- Modify: `packages/engine/src/generated-fixture.ts`
- Modify: `packages/engine/src/gameplay-fixture.ts`
- Modify: `packages/engine/src/index.ts`
- Modify: `packages/engine/test/model.test.ts`
- Modify: `packages/engine/test/save-codec.test.ts`
- Modify: `packages/engine/test/random.test.ts`
- Modify: `packages/engine/test/arbitraries.ts`

**Interfaces:**
- Consumes: schema-v3 run, actors, floors, random stream derivation, content-bound validation, and direct fixture constructors.
- Produces: schema-v4 run with `encounterDecisions`, `populations`, champion state, actor behavior state, population membership, and an independently derived `population-gates` stream.

- [x] **Step 1: Write failing schema-v4 state tests**

Require sorted run decisions and population instances; group, swarm, boss, and champion discriminants; bidirectional actor membership; saved intent/goals/memory; reached/encountered flags; crossed phase ordering; one-time reward flags; and champion Hall record identity.

- [x] **Step 2: Write failing version and stream-isolation tests**

Assert schema versions 0–3 and 5 fail as unsupported, v4 round-trips byte-identically, all RNG states are present, and adding draws to `encounters` does not change `population-gates` results.

Run: `npm test --workspace @woven-deep/engine -- --run test/model.test.ts test/save-codec.test.ts test/random.test.ts`

Expected: FAIL because schema v4 and the new stream do not exist.

- [x] **Step 3: Add immutable population contracts**

Define `EncounterRunDecision`, model-specific `PopulationInstance`, `PopulationIntent`, `ActorGoal`, `LastKnownTarget`, `InvestigationState`, ranked `FallenHeroStandingSnapshot`, `RecordedHeirloomSnapshot`, saved Echo decisions, and the pure host input shape. Store IDs and set-like arrays in code-unit order.

- [x] **Step 4: Implement strict schema and content-bound invariants**

Validate safe integers, probabilities, floor ownership, member liveness/history, role membership, leader/source/boss identity, actor-to-population agreement, phase IDs, reward identity, champion record uniqueness, and every content reference. Reject computed paths in input by strict object parsing.

- [x] **Step 5: Replace fixtures without migration code**

Set `SAVE_SCHEMA_VERSION = 4`, add `population-gates` to stream derivation with a fixed discriminator, rewrite every fixture/arbitrary to direct v4 state, and preserve the existing unsupported-version error boundary.

- [x] **Step 6: Run package gate and commit**

Run: `npm test --workspace @woven-deep/engine && npm run typecheck --workspace @woven-deep/engine && npm run build --workspace @woven-deep/engine`

Expected: all existing engine behavior remains green on v4 fixtures.

Commit: `feat: add active population state`

---

### Task 3: Decide run eligibility and discovery protection once

**Files:**
- Create: `packages/engine/src/population-gates.ts`
- Create: `packages/engine/test/population-gates.test.ts`
- Modify: `packages/engine/src/gameplay-fixture.ts`
- Modify: `packages/engine/src/index.ts`
- Modify: `packages/engine/test/arbitraries.ts`

**Interfaces:**
- Consumes: compiled encounters, run seed streams, prior sorted discovery bonuses, floor depths reached, and observation state.
- Produces: saved `EncounterRunDecision[]`, encounter-observation transitions, and pure sorted `DiscoveryProtectionUpdate[]` for later 4B3 finalization.

- [x] **Step 1: Write exact failing gate tests**

Use fixed stream states to assert sorted encounter processing, `min(cap, base + bonus)`, probability 0/1 boundaries, one roll per encounter, no reroll after reload, and no coupling to the `encounters` stream.

- [x] **Step 2: Write failing discovery-outcome tests**

Assert encountered resets to zero; eligible depth reached but unseen increments to the allowed maximum; unreached depth preserves the prior bonus; merely generating an unseen population does not mark it encountered.

- [x] **Step 3: Implement pure gate creation and conclusion evaluation**

Return new immutable state and the advanced `population-gates` stream. Validate host inputs against current encounter IDs, treating omitted bonuses as zero and rejecting duplicates, unknown IDs, or out-of-range values.

- [x] **Step 4: Add properties and commit**

Use fast-check to prove output ordering, bounds, idempotent conclusion calculation, and stream isolation over at least 500 cases.

Run: `npm test --workspace @woven-deep/engine -- --run test/population-gates.test.ts && npm run typecheck --workspace @woven-deep/engine`

Commit: `feat: decide encounter eligibility per run`

---

### Task 4: Add deterministic A* plus saved perception, memory, and intent

**Files:**
- Create: `packages/engine/src/pathfinding.ts`
- Create: `packages/engine/src/population-perception.ts`
- Create: `packages/engine/src/population-intent.ts`
- Create: `packages/engine/test/pathfinding.test.ts`
- Create: `packages/engine/test/population-perception.test.ts`
- Create: `packages/engine/test/population-intent.test.ts`
- Modify: `packages/engine/src/rot-adapter.ts`
- Modify: `packages/engine/src/perception.ts`
- Modify: `packages/engine/src/model.ts`

**Interfaces:**
- Consumes: ROT.js A*, current floor geometry/features/occupancy, existing FOV and lighting, observable sound events, actor perception, and hostile relationships.
- Produces: copied candidate coordinates, deterministic next steps, saved legitimate last-known targets, investigation state, and visible broad intent change events.

- [ ] **Step 1: Write failing A* contract tests**

Cover caller-owned passability, blocked doors, occupied destinations, eight-direction corner blocking, unreachable goals, stable equal-cost tie resolution, no mutation, and no ROT.js type escaping the adapter.

- [ ] **Step 2: Write failing memory tests**

Assert direct visible detection, perceivable sound memory, newest-observation replacement, stable equal-time observer tie-breaking, investigation of the last known cell, and no tracking through later unseen movement.

- [ ] **Step 3: Write failing broad-intent tests**

Cover `approach`, `attack`, `hold`, `regroup`, `flee`, `protect`, `spawn`, and `phase-change`; emit changes only when the saved intent changes; never include the exact goal or path in the public shape.

- [ ] **Step 4: Implement the adapter and pure state updates**

Copy ROT.js output immediately, rank legal first steps with explicit code-owned ordering, and fall back to `hold` plus a deterministic internal diagnostic when selection cannot produce a valid action.

- [ ] **Step 5: Run focused and browser-boundary gates, then commit**

Run: `npm test --workspace @woven-deep/engine -- --run test/pathfinding.test.ts test/population-perception.test.ts test/population-intent.test.ts test/browser-boundary.test.ts`

Commit: `feat: add population perception and pathfinding`

---

### Task 5: Populate generated floors atomically

**Files:**
- Create: `packages/engine/src/population-placement.ts`
- Create: `packages/engine/test/population-placement.test.ts`
- Modify: `packages/engine/src/floor-integration.ts`
- Modify: `packages/engine/src/generate-floor.ts`
- Modify: `packages/engine/src/connectivity.ts`
- Modify: `packages/engine/src/gameplay-fixture.ts`
- Modify: `packages/engine/test/floor-integration.test.ts`
- Modify: `packages/engine/test/generate-floor.test.ts`

**Interfaces:**
- Consumes: successful run decisions, depth/theme/vault tags, placement slots, reserved cells, route checks, reusable monster definitions, and the `encounters` stream.
- Produces: complete population instances and actors, or a deterministic optional skip / required generation rejection with no partial state.

- [ ] **Step 1: Write failing selection and composition tests**

Assert depth/environment/vault filtering, weighted stable selection, per-run instance limits, inclusive quantity rolls, optional leader roll, row-major candidates, and fixed actor/instance ID allocation.

- [ ] **Step 2: Write failing atomic-placement tests**

Reject actor/feature/stair/objective/vault-slot overlap, excessive member separation, invalid terrain, and placements that sever required routes. Prove optional failures create no actors and required failures reject the bounded generation attempt.

- [ ] **Step 3: Implement stable materialization**

Reserve mandatory cells first, plan the entire composition without mutating the run, validate the route after the planned occupancy, then publish actors and population state in stable role/member order through one immutable commit.

- [ ] **Step 4: Integrate with floor generation and commit**

Ensure generation retries and fallback floors preserve their current bounded behavior. Use forced eligibility only in test/demo inputs; production YAML keeps authored rarity.

Run: `npm test --workspace @woven-deep/engine -- --run test/population-placement.test.ts test/floor-integration.test.ts test/generate-floor.test.ts`

Commit: `feat: populate floors with encounters`

---

### Task 6: Replace the demonstration AI with individual population behavior

**Files:**
- Modify: `packages/engine/src/behavior.ts`
- Modify: `packages/engine/src/world-step.ts`
- Modify: `packages/engine/src/scheduler.ts`
- Modify: `packages/engine/src/reactions.ts`
- Create: `packages/engine/test/population-individual.test.ts`
- Modify: `packages/engine/test/behavior.test.ts`
- Modify: `packages/engine/test/world-step.test.ts`

**Interfaces:**
- Consumes: ready actor, saved perception/memory/goal, registered behavior parameters, A* next step, combat/reaction rules, and inactive-floor state.
- Produces: one deterministic individual action, updated AI state and intent, and existing combat/movement events.

- [ ] **Step 1: Write failing action-policy examples**

Cover unaware hold/patrol, visible hostile approach, adjacent attack, investigation of last-known position, abandoned search, unreachable-goal hold, hostility changes, and opportunity attacks when leaving hostile melee range.

- [ ] **Step 2: Write failing world-step ordering tests**

Fix the order as direct observation, memory update, intent derivation, action selection, reactions, action application, encounter observation, and public event projection. Verify one actor's failure cannot partially mutate the world.

- [ ] **Step 3: Implement registered individual behavior**

Replace greedy direction scanning with the owned path adapter. Keep all action costs and attack rules in existing modules and preserve neutral/non-hostile reaction behavior.

- [ ] **Step 4: Run replay regressions and commit**

Run: `npm test --workspace @woven-deep/engine -- --run test/population-individual.test.ts test/behavior.test.ts test/world-step.test.ts test/reactions.test.ts test/gameplay-replay.test.ts`

Commit: `feat: run individual encounter behavior`

---

### Task 7: Coordinate groups, leaders, and formations

**Files:**
- Create: `packages/engine/src/group-behavior.ts`
- Create: `packages/engine/test/group-behavior.test.ts`
- Modify: `packages/engine/src/attributes.ts`
- Modify: `packages/engine/src/combat.ts`
- Modify: `packages/engine/src/behavior.ts`
- Modify: `packages/engine/src/world-step.ts`

**Interfaces:**
- Consumes: group roles, communication radius, direct member observations, formation definition, leader state, and configured leader outcome.
- Produces: bounded shared knowledge, formation goals, active coordination modifiers, leader events, and one deterministic outcome transition.

- [ ] **Step 1: Write failing relay and formation tests**

Prove sorted breadth-first relay across connected chains, no sharing across a gap larger than range, latest legitimate observation wins, inactive floors do not relay, and each formation yields stable legal role goals.

- [ ] **Step 2: Write failing leader tests**

Cover leader accent/glyph state, coordination modifiers only while alive, and exact transitions for `weaken`, `panic`, `disband`, `surrender`, `frenzy`, and supernatural `collapse`. Ensure collapse reward/kill accounting follows compiled policy.

- [ ] **Step 3: Implement group behavior and modifiers**

Keep shared knowledge on the population instance, individual received memory on actors, and derived bonuses in pure attribute/combat calculation. Formation goals may change; paths remain derived and unsaved.

- [ ] **Step 4: Verify deterministic leader death and commit**

Run: `npm test --workspace @woven-deep/engine -- --run test/group-behavior.test.ts test/attributes.test.ts test/combat.test.ts test/world-step.test.ts`

Commit: `feat: coordinate encounter groups`

---

### Task 8: Grow and contain capped swarms

**Files:**
- Create: `packages/engine/src/swarm-behavior.ts`
- Create: `packages/engine/test/swarm-behavior.test.ts`
- Modify: `packages/engine/src/world-step.ts`
- Modify: `packages/engine/src/behavior.ts`
- Modify: `packages/engine/src/model.ts`

**Interfaces:**
- Consumes: visible source, source-owned next spawn time, weighted child roles, allowed terrain, stable candidate cells, three cap levels, current world time, and source-destruction response.
- Produces: saved children and timers, cap/source events, and deterministic `stop`, `flee`, `decay`, or `frenzy` transitions.

- [ ] **Step 1: Write failing timer and placement tests**

Assert only sources own timers, intervals use world time, due spawns process once, quantities use stable weighted choice, row-major legal cells fill only available capacity, and blocked cells are never overwritten.

- [ ] **Step 2: Write failing cap and inactive-floor tests**

Cover source child cap, encounter living cap, floor swarm cap, qualitative cap event de-duplication, no growth while inactive, and no catch-up growth on re-entry.

- [ ] **Step 3: Write failing shutdown-response tests**

Exercise `stop`, path-based `flee`, deterministic timed `decay`, and bounded `frenzy`. Children cannot inherit spawning ability.

- [ ] **Step 4: Implement lifecycle and commit**

Apply each due transition atomically, allocate stable IDs, update member history, and use the existing `encounters` stream only for authored composition randomness.

Run: `npm test --workspace @woven-deep/engine -- --run test/swarm-behavior.test.ts test/world-step.test.ts test/save-codec.test.ts`

Commit: `feat: add capped swarm lifecycles`

---

### Task 9: Run distinct bosses through irreversible phases and rewards

**Files:**
- Create: `packages/engine/src/boss-behavior.ts`
- Create: `packages/engine/test/boss-behavior.test.ts`
- Modify: `packages/engine/src/world-step.ts`
- Modify: `packages/engine/src/effects.ts`
- Modify: `packages/engine/src/inventory.ts`
- Modify: `packages/engine/src/floor-integration.ts`

**Interfaces:**
- Consumes: boss population, ordered thresholds, phase behavior/effects, floor exit/re-entry times, recovery rate/cap, unique item, enhanced loot table, and run instance limit.
- Produces: phase/recovery/defeat events, irreversible saved phase state, one guaranteed unique item, and enhanced rolled loot.

- [ ] **Step 1: Write failing phase and uniqueness tests**

Assert thresholds cross once in descending order, a large hit may cross multiple phases in authored order, behavior/effects update atomically, phases never reverse, and each boss encounter ID creates at most one instance per run.

- [ ] **Step 2: Write failing re-entry recovery tests**

Use global elapsed world time, the current phase maximum, and authored percentage cap. Assert no active off-floor turns, no resurrection, no repeated recovery for the same interval, and no arena mutation reversal.

- [ ] **Step 3: Write failing reward-idempotency tests**

Defeat produces exactly one unique item and one enhanced loot resolution even across duplicate commands and split save/reload. Missing runtime references remain invariant errors without partial item creation.

- [ ] **Step 4: Implement boss lifecycle and commit**

Run: `npm test --workspace @woven-deep/engine -- --run test/boss-behavior.test.ts test/effects.test.ts test/inventory.test.ts test/gameplay-replay.test.ts`

Commit: `feat: add phased boss encounters`

---

### Task 10: Materialize the Deep's Champion and rare Echoes

**Files:**
- Create: `packages/engine/src/champion.ts`
- Create: `packages/engine/test/champion.test.ts`
- Modify: `packages/engine/src/floor-integration.ts`
- Modify: `packages/engine/src/world-step.ts`
- Modify: `packages/engine/src/inventory.ts`
- Modify: `packages/engine/src/content-bound-validation.ts`
- Modify: `packages/engine/src/projection.ts`

**Interfaces:**
- Consumes: up to ten ranked `FallenHeroStandingSnapshot` records, conquered Champion record IDs, the YAML champion template, current content pack, recorded death depths, optional side-arena slots, and recorded heirloom snapshots.
- Produces: at most one normalized named Champion, up to the configured number of weaker rare Echoes, optional bypassable placements, conquest/defeat events, exact one-time Champion heirloom or fallback relic, and enhanced ordinary Echo loot.

- [ ] **Step 1: Write failing selection-boundary tests**

Assert no standings means no Champion or Echo; conquered rank-1 suppression; unrelated lower records are never promoted to Champion; death depths are honored; and the Champion bypasses normal run gates/discovery protection. Give ranks 2–10 independent hidden rolls, retain passing candidates with the lowest rolls up to the configured cap, resolve ties by rank/record ID, and never reroll after save/reload.

- [ ] **Step 2: Write failing normalization and optional-placement tests**

Clamp historical attributes/equipment/abilities through current template limits, fall back cleanly for missing content, show `<Hero Name>, the Deep's Champion`, and require a side arena/branch that cannot block stairs, objectives, or required routes. Apply stricter Echo percentages, show `Echo of <Hero Name>`, and prove no Echo combat cap can equal or exceed its Champion counterpart.

- [ ] **Step 3: Write failing heirloom tests**

On first defeat, materialize one unit preserving content ID, enchantment, condition, charges, fuel, safe display metadata, and Hall provenance. The recorded candidate must have been a unique eligible equipped item instance at the original death; backpack items are invalid. If no equipment was eligible or the recorded definition is absent, use the YAML fallback relic while retaining provenance. Duplicate defeat paths and reload cannot create a second reward.

For each Echo, create enhanced ordinary loot from `echoLootTableId`, never the recorded heirloom or a guaranteed unique item. The same record cannot create or respawn another Echo in that run after encounter or defeat, but a new run may independently gate it again.

- [ ] **Step 4: Implement champion lifecycle and commit**

Keep 4B1 host-only: do not choose Hall standings or original heirlooms here and do not persist profile/session conquest or achievements. Emit exact record IDs and ranks for 4B3 to consume later. Champion conquest is permanent; Echo suppression lasts only for the active run, while first lifetime defeat achievement state belongs to 4B3.

The later 4B3 finalizer performs one deterministic weighted choice over unique eligible equipped item instances using rarity weight plus supported positive quality-rank bonuses. Backpack items never enter the pool, a multi-slot item remains one candidate, every candidate has non-zero probability, and the recorded choice is never rerolled. With no eligible equipment it records the fallback relic.

Run: `npm test --workspace @woven-deep/engine -- --run test/champion.test.ts test/floor-integration.test.ts test/content-bound-validation.test.ts test/save-codec.test.ts`

Commit: `feat: add champion and echo encounters`

---

### Task 11: Publish readable population events without hidden state

**Files:**
- Modify: `packages/engine/src/model.ts`
- Modify: `packages/engine/src/projection.ts`
- Modify: `packages/engine/src/event-projection.ts`
- Create: `packages/engine/test/population-projection.test.ts`
- Modify: `packages/engine/test/projection.test.ts`
- Modify: `packages/engine/test/event-projection.test.ts`

**Interfaces:**
- Consumes: authoritative population events, current/previous legitimate visibility, actor presentation, leader/source/boss/champion state, and broad intent.
- Produces: observable actors and redacted public events suitable for later desktop UI, metrics, achievements, and replay.

- [ ] **Step 1: Write failing complete-event-union tests**

Add every event listed in the design with stable authoritative IDs and fields. Assert exhaustive switches compile and recorded command deduplication returns the original public events.

- [ ] **Step 2: Write failing observable-projection tests**

Visible actors expose name, glyph, color, health presentation, disposition, broad intent, leader distinction, source warning, boss phase, and champion identity. Remembered/unseen cells expose none of the living actor state.

- [ ] **Step 3: Write adversarial hidden-state tests**

Recursively scan JSON projections and public events for run decisions, probabilities, protection bonuses, unseen IDs/cells, exact goals, paths, target cells, shared information source, future spawn composition, thresholds, recovery arithmetic, rolls, and unopened reward data.

- [ ] **Step 4: Implement visibility-aware redaction and commit**

Use prior and next observation for moving/dying event visibility, qualitative public messages for unseen causes when sound permits, and prominent champion naming only after legitimate observation.

Run: `npm test --workspace @woven-deep/engine -- --run test/population-projection.test.ts test/projection.test.ts test/event-projection.test.ts test/reducer.test.ts`

Commit: `feat: project observable population intent`

---

### Task 12: Prove replay, simulation, documentation, and production gates

**Files:**
- Create: `packages/engine/test/population-properties.test.ts`
- Create: `packages/engine/test/population-replay.test.ts`
- Create: `packages/engine/src/population-fixture.ts`
- Create: `scripts/population-demo.mjs`
- Create: `packages/engine/test/population-cli.test.ts`
- Create: `packages/engine/test/fixtures/population-demo-hashes.json`
- Modify: `packages/engine/src/index.ts`
- Modify: `packages/content/test/admin-docs.test.ts`
- Modify: `docs/server-admin/README.md`
- Modify: `docs/server-admin/content-configuration.md`
- Modify: `docs/operations/content-and-storage.md`
- Modify: `package.json`
- Modify: `Dockerfile`
- Modify: `docs/superpowers/plans/2026-07-13-implementation-roadmap.md`

**Interfaces:**
- Consumes: all 4B1 systems, deterministic command/replay helpers, bundled production content, server content bootstrap, and Docker release stages.
- Produces: 500+ seeded invariant simulations, exact split replay, forced terminal demonstration, complete operator reference, and repeatable production verification.

- [ ] **Step 1: Write the 500-seed property harness before relaxing any implementation**

After every applied step validate schema and content binding, occupancy/routes, population membership, role/leader/source identity, caps, nondecreasing world time, inactive-floor freeze, bounded group communication, irreversible boss phases, unique rewards, Champion singleton/heirloom singleton, per-record Echo singleton, Echo run cap, no Echo heirlooms, and hidden-state-safe projection. Convert every discovered shrink to a named regression test.

- [ ] **Step 2: Add continuous-versus-split replay tests**

Split the same scenario at several boundaries, including before group relay, source spawn, leader death, boss threshold, boss re-entry, champion encounter, and reward creation. Compare byte-identical final saves, command results, authoritative events, public events, and projections.

- [ ] **Step 3: Build the forced exit demonstration**

Use explicit test input to force eligibility while leaving production YAML unchanged. Demonstrate a relay-limited leader group, leader outcome, capped visible swarm source, optional phased boss and unique reward, named bypassable Champion, exact heirloom, one weaker `Echo of <Hero Name>` with ordinary loot, and equivalent split execution. Check stable hashes into `population-demo-hashes.json`.

- [ ] **Step 4: Document every YAML field and rejection mode**

Expand server-admin documentation with common encounter fields, probabilities, discovery protection, placement, each model, roles/formations, every leader and swarm response, boss phases/recovery/rewards, champion normalization/fallback, quality-weighted heirloom selection, off-floor freeze, full valid YAML, adding files, validation commands, and common errors. Extend the docs test so every new content kind and closed identifier must appear.

- [ ] **Step 5: Add root and Docker gates**

Add `population:demo` to root scripts and invoke it in the production Docker build alongside engine, dungeon, and gameplay demonstrations. Confirm mounted schema-v3 content is validated atomically at startup.

- [ ] **Step 6: Run final verification from a clean dependency state**

Run:

```bash
npm ci
npm run content:validate
npm test
npm run typecheck
npm run build
npm run engine:demo
npm run dungeon:demo
npm run gameplay:demo
npm run population:demo
docker compose build
git diff --check
git status --short
```

Expected: every command exits 0; deterministic hashes match; Docker repeats all demonstrations; only intended source, content, fixture, plan, and documentation changes remain.

- [ ] **Step 7: Request final code review, fix findings, and commit**

Commit: `test: verify population encounter milestone`

Update the roadmap with the completed 4B1 detailed-plan link and leave 4B2 NPCs plus 4B3 records explicitly pending.
