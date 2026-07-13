# Population Encounters Design

**Date:** 2026-07-14

**Status:** Approved design

**Roadmap milestone:** 4B1 — population generation and AI

**Parent milestone:** 4B — populations, NPCs, and run records

**Previous milestone:** `docs/superpowers/specs/2026-07-13-core-gameplay-survival-design.md`

## Goal

Turn the single-creature demonstration policy into deterministic, YAML-authored dungeon populations. A run can independently gate rare encounters, populate generated floors with individuals, coordinated groups, capped swarms, authored bosses, and one optional profile-local fallen champion. Visible enemies communicate readable broad intent without exposing hidden state. Save/reload and split replay remain byte-identical.

Milestone 4B is delivered as three independently reviewable slices:

1. **4B1 — population generation and AI:** this document.
2. **4B2 — dungeon NPCs:** travelling merchants, trading, reputation, self-preservation, departure, and stock loss.
3. **4B3 — run records:** metrics, achievements, scoring, rewards, discovery-protection persistence, and deterministic run finalization.

## Exit demonstration

A terminal scenario uses forced demonstration eligibility while production YAML retains its normal rarity. It:

- Generates a mixed leader group, shows communication limited by a relay-connected formation, and demonstrates a configured leader-death response.
- Shows broad visible intent while keeping hidden goals, paths, knowledge, and rolls out of the player projection.
- Lets a visible swarm source create members up to its caps, then demonstrates source destruction and either containment or retreat.
- Enters an optional boss encounter, crosses at least one irreversible phase threshold, leaves, returns to observe bounded recovery, and receives exactly one guaranteed unique reward on defeat.
- Injects a fallen-champion snapshot, displays the original hero name, permits bypassing the optional arena, and demonstrates the one-time recorded heirloom drop.
- Produces identical saves, events, and player projections with continuous execution and execution split by several save/reload boundaries.

## Scope

### Included

- A strict `encounter` YAML content kind separate from reusable monster definitions.
- Individual, group, swarm, boss, and fallen-champion population instances.
- Run-level appearance gates and pure discovery-protection input/output boundaries.
- Complete encounter population of generated floors with required-route protection.
- Saved actor perception, memory, goals, population membership, and broad intent.
- Deterministic A* path candidates through a project-owned ROT.js adapter.
- Bounded group awareness relay and shared last-known information.
- Group roles, formations, optional leaders, coordination bonuses, and six leader-death responses.
- Visible swarm sources, source-owned timers, placement constraints, caps, and shutdown responses.
- Boss uniqueness, authored phase transitions, bounded re-entry recovery, guaranteed unique rewards, and enhanced loot.
- A profile/session-local named Deep's Champion derived from the highest-scoring unconquered dead hero.
- Population events suitable for later metrics, achievements, and Hall finalization.
- Hidden-state-safe population and intent projection.
- Strict save, content, replay, browser-boundary, property, demonstration, and Docker verification.

### Deferred to 4B2

- Neutral dungeon NPC populations.
- Travelling merchants, services, stock, trading, and departure.
- Reputation, faction consequences, and NPC self-preservation.

### Deferred to 4B3

- The typed metric registry and lifetime aggregation.
- Achievement and unlock evaluation, including the first Deep's Champion defeat achievement.
- Score calculation and immutable Hall records.
- Choosing the fallen champion and heirloom during run finalization.
- Persistent/session storage for discovery-protection counters and conquered champion record IDs.
- Run conclusion for death, victory, and abandonment.

### Deferred beyond Milestone 4

- Browser screens and input routing.
- Server-authoritative profiles and network command batches.
- Full 20-floor content and final campaign balance.
- Town progression and persistent unlock presentation.

## Established contracts

The implementation preserves immutable reducer input, stable identifiers, named random streams, complete snapshots, content-hash binding, integer-energy world steps, recent-command deduplication, exact save encoding, deterministic floor generation, eight-direction corner rules, visibility and lighting, hostile-only reactions, and hidden-state-safe projection.

The project remains pre-release. 4B1 replaces active-run schema v3 with v4 and compiled content schema v2 with v3. Development fixtures are rewritten. Unsupported earlier versions are rejected clearly; no migration code is retained.

The engine remains browser-safe and imports no React, Fastify, SQLite, browser storage, clock, network, or Node-only APIs.

## Dependency decision

Continue using the pinned ROT.js dependency. Its current browser-compatible path modules provide A* and Dijkstra implementations through caller-owned passability callbacks. 4B1 uses only A* behind a project-owned synchronous adapter. The adapter copies the resulting coordinates and never exposes a ROT.js object through engine types.

ROT.js does not own actor goals, occupancy, door policy, diagonal corner rules, tie-breaking, action costs, saved state, or random selection. Those remain project code because they are game rules and replay contracts.

Do not add an ECS, actor runtime, state-machine framework, or YAML behavior-tree interpreter. YAML selects one closed registered behavior family and supplies strictly validated parameters. A new fundamental behavior rule requires TypeScript, schema validation, tests, and server-admin documentation.

References:

- `https://ondras.github.io/rot.js/doc/`
- `https://ondras.github.io/rot.js/doc/modules/path_path.html`

## Content architecture

### Monster definitions

Monster entries continue to describe one creature:

- Base attributes and derived combat values.
- Health, speed, accuracy, defense, damage, armor, and resistances.
- Glyph, base color, tags, rarity, and depth range.
- Disposition, perception, registered behavior ID, and behavior parameters.

The existing monster `runAppearanceChance` field moves to encounter entries. Monster definitions are reusable components and no longer decide whether a whole population exists in a run.

### Encounter definitions

Every encounter uses the common fields:

```ts
interface EncounterContentEntry extends BaseContentEntry {
  readonly kind: 'encounter';
  readonly model: 'individual' | 'group' | 'swarm' | 'boss';
  readonly minDepth: number;
  readonly maxDepth: number;
  readonly environmentTags: readonly string[];
  readonly requiredVaultTags: readonly string[];
  readonly weight: number;
  readonly rarity: ItemRarity;
  readonly runAppearanceChance: number;
  readonly discoveryProtectionIncrement: number;
  readonly discoveryProtectionCap: number;
  readonly maximumInstancesPerRun: number;
  readonly placement: EncounterPlacementDefinition;
  readonly intentPresentation: EncounterIntentPresentation;
  readonly definition: IndividualEncounterDefinition
    | GroupEncounterDefinition
    | SwarmEncounterDefinition
    | BossEncounterDefinition;
}
```

`runAppearanceChance`, the protection increment, and the protection cap are finite probabilities from zero through one. The cap cannot be below the base chance. Foundational encounters explicitly use chance `1`. Boss examples default to base chance `0.08`, increment `0.03`, cap `0.35`, and one instance per run.

Placement declares minimum distance from stairs/objectives, maximum distance between initial members, allowed terrain tags, whether a vault slot is required, and whether failure to place is optional or rejects floor generation.

### Individual encounters

An individual encounter references one monster ID and an inclusive positive quantity range. Every spawned actor owns independent awareness, memory, goals, and behavior state. No group communication or coordination bonus exists unless an effect explicitly creates one.

### Group encounters

A group definition contains ordered role records. Each role references a monster, has an inclusive quantity range, stable role ID, formation position preference, and optional role-specific behavior parameters.

The group also declares:

- Formation: `cluster`, `line`, `screen`, `wedge`, or `surround`.
- Positive communication radius measured in Chebyshev cells.
- Leader chance and one leader role.
- Visible leader accent color and optional alternate glyph.
- Coordination modifiers active only while the leader lives.
- One leader-death response: `weaken`, `panic`, `disband`, `surrender`, `frenzy`, or `collapse`.
- Response-specific modifiers, duration, or behavior transition.

`collapse` requires `supernaturalBond: true`. By default, linked actors removed by collapse count as a broken group, do not count as individual kills, and produce no individual loot. YAML may explicitly enable individual rewards, but the compiler requires that choice to be visible in the encounter's server-admin description.

### Swarm encounters

A swarm references one visible source monster tagged `swarm-source` and one or more weighted spawned-creature roles. The source owns:

- A positive spawn interval in world-time units.
- Inclusive quantity per spawn.
- Placement radius and allowed terrain.
- Maximum living children from this source.
- Maximum living members for this encounter instance.
- Maximum swarm actors on the floor.
- One source-destruction response: `stop`, `flee`, `decay`, or `frenzy`.

Children never own spawn timers. Spawning never overwrites an actor, stair, blocking feature, vault-reserved slot, or objective cell. If fewer valid cells exist than the rolled quantity, only the stable ordered subset of valid cells is filled.

Swarm and group simulation freezes while their floor is inactive. Re-entry does not calculate missed swarm growth. This intentionally supersedes the earlier broad design's off-floor swarm growth rule and makes retreat a valid containment strategy.

### Boss encounters

A boss encounter references one monster and requires `maximumInstancesPerRun: 1`. Several distinct boss encounter IDs may be eligible in one run.

Boss definitions declare:

- Ordered unique health thresholds descending from below 100 percent to above zero.
- For each threshold, an irreversible phase ID, registered behavior override, modifiers, and ordered supported effects.
- A non-negative recovery-per-world-time rate and a recovery cap expressed as a health percentage.
- One guaranteed unique item ID.
- One enhanced additional loot-table ID.
- Optional authored vault tags and arena placement rules.

Crossing a phase threshold occurs once and is saved. Leaving does not reverse a phase or restore arena mutations. On re-entry, a living boss receives one deterministic recovery calculation based on elapsed global world time, bounded by the recovery cap and current phase maximum. This is a transition calculation, not off-floor turn simulation.

## Active-run population state

### Run decisions

The hidden run state contains one sorted decision per encounter:

```ts
interface EncounterRunDecision {
  readonly encounterId: OpaqueId;
  readonly baseProbability: number;
  readonly protectionBonus: number;
  readonly effectiveProbability: number;
  readonly eligible: boolean;
  readonly reachedEligibleDepth: boolean;
  readonly encountered: boolean;
  readonly instancesCreated: number;
}
```

Run creation accepts prior discovery-protection bonuses as an external input. Encounter IDs are processed in code-unit order using a new `population-gates` random stream. Effective probability is `min(cap, base + bonus)`. The decision is saved and never rerolled.

Floor selection consumes only the existing `encounters` stream. Separating gate and placement streams prevents a changed placement attempt from altering future run-level eligibility decisions.

### Population instances

Every spawned population has a stable instance ID, encounter ID, model, floor ID, creation world time, living and former member IDs, and model-specific state.

Group state includes role membership, leader actor ID, whether its bonus is active, shared knowledge, and leader-response status. Swarm state includes source actor ID, next spawn time, spawned count, peak living size, and shutdown state. Boss state includes actor ID, current phase, crossed phase IDs, last floor-exit time, reward-created status, and recovery history.

Actors gain a population membership reference and saved AI state:

```ts
interface ActorBehaviorState {
  readonly intent: PopulationIntent;
  readonly goal: ActorGoal | null;
  readonly lastKnownTargets: readonly LastKnownTarget[];
  readonly investigation: InvestigationState | null;
}
```

The save stores goals and last-known information because they affect future actions. It never stores a computed path; the path is derived from current state when the actor becomes ready.

All identifiers and set-like arrays are strictly sorted in saved state. Cross-record validation requires every membership, leader, source, role, floor, and encounter reference to exist and agree in both directions.

## Generation flow

When creating a floor:

1. Filter successful run decisions by depth, environment, vault tags, and remaining run limit.
2. Reserve stairs, objectives, required routes, authored feature cells, and mandatory vault slots.
3. Select encounters through stable weighted choice using the `encounters` stream.
4. Materialize composition quantities and optional leader presence.
5. Enumerate valid placement candidates in row-major order.
6. Place the complete encounter atomically or skip/reject it according to placement policy.
7. Create population state and actors in stable role/member order.
8. Mark an encounter as encountered only when the hero legitimately observes a member or source, not merely when it is generated.

Population placement must preserve a walkable route between required stairs and objectives. Optional placement failure emits a deterministic internal diagnostic event. Required authored encounter failure rejects the generation attempt so the existing bounded retry and fallback rules can act.

The generator never consults player projection, profile storage, wall-clock time, or ambient randomness.

## Perception, memory, and communication

Every creature uses current field of view, illumination, perception, and observable sound events to update its own saved memory. Detection records target actor ID, observed cell, observation world time, and information source. It does not retain or infer the hero's future location.

Group communication is a bounded relay graph. An informed member can relay to members within the configured communication radius; those members can relay farther during the same propagation pass. Stable breadth-first traversal processes actor IDs in sorted order. Communication reaches a member only when a connected chain exists. Walls do not independently block abstract communication, but gaps larger than the radius do.

The shared record stores the newest legitimately detected position and time. Members receiving it may investigate that position. They do not track the hero through unseen movement. New direct observations replace older shared information; equal-time conflicts resolve by sorted observer actor ID.

Groups on inactive floors do not communicate or update memory.

## Path selection and formations

The project-owned path adapter accepts immutable width, height, topology mode, origin, destination, and a passability callback. It invokes ROT.js A*, copies coordinates into plain points, drops the origin, validates adjacency, and returns an immutable list.

Passability uses effective feature terrain, living actor occupancy, diagonal sealed-corner rules, and encounter-specific door capability. Actors cannot path through hidden secret passages they have not discovered. A computed path is a candidate, not authority: the normal movement validator rechecks the selected step when the action resolves.

Formation policy selects goals, not forced movement. Members prefer declared relative roles while maintaining legal cells and avoiding unnecessary blocking. If no safe improving move exists, the actor chooses `hold`. A pathfinding or formation failure never partially mutates state.

## Broad intent

Before a ready hostile actor acts, its policy deterministically selects and saves one broad intent:

- `approach`
- `attack`
- `hold`
- `regroup`
- `flee`
- `protect`
- `spawn`
- `phase-change`

Every currently visible hostile actor exposes its broad intent. Exact path, target scoring, hit rolls, damage rolls, future phase thresholds, and spawn rolls remain hidden. Intent projection includes a short stable presentation token and optional target category such as `hero`, `leader`, `source`, or `position`; it does not reveal a hidden target cell.

Intent is recalculated only at deterministic world-step boundaries. If state invalidates an intent before resolution, normal validation selects `hold` rather than executing stale authority.

## Leader outcomes

Leader death first resolves the leader's own death and loot. It then removes the coordination bonus and applies exactly one response in sorted member order:

- `weaken`: apply declared negative modifiers or a condition.
- `panic`: set a timed flee goal.
- `disband`: remove group membership; surviving members become individuals.
- `surrender`: change relationship/disposition and suppress hostile action unless attacked later.
- `frenzy`: apply declared offensive and defensive modifiers or conditions.
- `collapse`: destroy or disable linked members without individual kill credit or loot by default.

The transition is atomic and emits a leader-defeated event followed by member transitions and one group outcome event. A group is broken once, even if later members die individually.

## Swarm lifecycle

Only a living active source whose timer is due can choose `spawn`. One spawn action consumes its declared action cost, advances the timer by its interval, rolls quantity and composition, enumerates valid cells, and creates the stable subset allowed by every cap.

Reaching a cap is not an error. It emits at most one cap-state event per cap episode and advances the timer normally so a capped swarm cannot retry for free every scheduler pass.

Source destruction applies its response atomically. `stop` preserves existing members, `flee` gives members a retreat goal, `decay` applies a timed damaging condition, and `frenzy` applies the declared frenzy state. A source cannot spawn after its shutdown transition.

## Boss lifecycle and rewards

Damage resolution checks newly crossed boss thresholds after effective damage and before the next actor is scheduled. Multiple thresholds crossed by one hit resolve from highest to lowest in one atomic transition. Each phase transition is permanent and emits an observable event if the boss is visible or the effect is otherwise perceivable.

Boss defeat creates the guaranteed unique item exactly once, then resolves the enhanced loot table. Reward placement uses the boss cell or the stable nearest valid cells. Saved `rewardCreated` state prevents duplicate rewards through retries, duplicate commands, save/reload, or replay.

The engine emits boss encounter, phase, recovery, and defeat events. 4B3 consumes first defeat events for achievements and breadth-only unlock rules.

## The Deep's Champion

### Selection boundary

4B1 accepts an optional `FallenChampionSnapshot` from the run host. It never queries Hall storage itself.

4B3 later derives the snapshot from the current profile or guest session's highest-scoring dead-hero record when:

- The record has a death depth.
- The record is still the highest-scoring dead hero.
- That exact Hall record ID has not already been conquered.

If the conquered record remains the high-score holder, no lower record is promoted. There is no Deep's Champion until a new dead hero takes the high-score position.

The snapshot contains the Hall record ID, hero name, portrait glyph, class/build tags, attributes, equipped item content IDs, signature ability IDs, death depth, source content hash, and one recorded heirloom item snapshot.

### Heirloom selection

At the original hero's death, 4B3 will select the heirloom once using deterministic run randomness from ordinary backpack and equipped item instances. Selection is weighted toward higher-quality items, but every eligible instance retains a positive weight so mundane, depleted, or damaged possessions remain possible. Objective artifacts, quest tokens, currency, and explicitly non-transferable items are excluded.

The single `fallen-champion-template` entry owns the selection weights. It declares a positive weight for each item rarity, a non-negative bonus per supported positive enchantment or quality rank, and a non-negative bonus for equipped items. Bundled defaults increase substantially from common through legendary while leaving the common weight above zero. The compiler rejects zero/negative rarity weights and decreasing rarity weights. Selection uses one weighted roll over eligible item instances; it never guarantees a minimum rarity, rerolls an undesirable result, or weights a stack by its quantity.

One unit is recorded from a stack. The snapshot preserves content ID, enchantment, condition, charges, fuel, identification-safe display metadata, and the originating Hall record ID. The selection is stored in the Hall record and never rerolled when a later run starts or reaches the champion.

If a later content pack no longer contains the item definition, the run substitutes a documented YAML fallback relic while preserving provenance text. Missing class, equipment, or ability references similarly fall back to the champion template defaults.

### Encounter rules

The champion appears exactly once when a later hero first generates or enters the recorded death depth. It is outside normal random boss gates and discovery protection. Placement uses an optional side arena or branch and may never block stairs, required routes, or objectives. Defeating it is never necessary to progress.

Its visible name is `<Hero Name>, the Deep's Champion`. The name appears in actor projection, intent display, combat events, inspection, and the boss introduction. Recorded build data determines flavor and available normalized choices; a strict YAML `fallen-champion` template controls actual health, damage, defenses, phase rules, and ability limits for the current depth. Historical state can never bypass current caps or create an unbeatable boss.

On its first defeat:

1. Emit `champion.defeated` with the Hall record ID.
2. Materialize the recorded heirloom exactly once.
3. Mark the run-local champion defeated to prevent duplicate creation.
4. Let 4B3 mark that Hall record permanently conquered and grant the first-defeat achievement, named initially `Defeated the Deep's Champion`.

Once conquered in profile/session state, that champion never appears again. It has no repeat encounter or repeat loot path.

## Discovery protection

Discovery protection is a pure engine boundary in 4B1. Run creation consumes prior bonus values. A conclusion evaluator later consumes final run state and returns sorted updates:

- Encountered: reset bonus to zero.
- Eligible depth reached but never encountered: add the declared increment, capped by the declared cap minus base chance.
- Eligible depth never reached: leave the bonus unchanged.

Generating an unseen population does not count as encountering it. Legitimate observation of any member, leader, source, or boss does. The hidden run decision stores effective probability for later trusted telemetry but player projection excludes all decisions and bonuses.

4B3 calls this evaluator during deterministic finalization. Guest mode later stores updates in browser session state; persistent mode stores them server-side.

## Population events

4B1 publishes stable typed events for later metrics and records:

- `population.created`
- `population.encountered`
- `population.placement-skipped`
- `actor.intent-changed`
- `group.awareness-shared`
- `group.leader-created`
- `group.leader-defeated`
- `group.outcome-applied`
- `swarm.members-created`
- `swarm.cap-reached`
- `swarm.source-destroyed`
- `boss.encountered`
- `boss.phase-changed`
- `boss.recovered`
- `boss.defeated`
- `boss.reward-created`
- `champion.encountered`
- `champion.defeated`
- `champion.heirloom-created`

Authoritative events may contain stable content and population IDs required for metrics. Public event projection removes hidden IDs, cells, probabilities, rolls, and information sources unless currently observable.

## Player projection

The player can receive:

- Visible creature name, glyph, color, health presentation, disposition, and broad intent.
- A visible leader's accent/glyph distinction and leadership role.
- Observable coordination modifiers after inspection or demonstration.
- A visible swarm source, its readable source state, and qualitative growth warning.
- Perceivable boss phase transitions and current visible phase presentation.
- The Deep's Champion's original hero name, glyph, normalized build presentation, and heirloom provenance after it drops.

The player never receives:

- Failed or successful unseen run-gate decisions.
- Discovery-protection counters or effective probabilities.
- Unseen encounter IDs, actors, roles, sources, or rewards.
- Exact AI goals, path candidates, hidden target cells, or shared knowledge.
- Future spawn composition, phase thresholds, recovery calculation, hit rolls, or loot rolls.
- The complete fallen-champion snapshot before legitimately observing the champion or reward.

## Failure handling

- Invalid content rejects the entire pack at startup with file, entry ID, field path, and concrete reason.
- Optional encounter placement failure skips the complete encounter without consuming partial instance state.
- Required placement failure rejects that bounded generation attempt.
- Behavior selection failure produces `hold` and a deterministic internal diagnostic rather than partial mutation.
- A missing required runtime content reference is an internal invariant error and preserves the last-known-good state.
- Cap exhaustion is a normal state, not an exception.
- Duplicate commands return their saved result and cannot duplicate members, phase effects, or rewards.
- Fallen-champion content drift uses explicit template fallbacks and never prevents starting a run.

## Server-admin documentation

`docs/server-admin/content-configuration.md` gains a complete encounter section covering:

- Common encounter fields, defaults, probabilities, placement, and eligibility.
- Every individual, group, swarm, boss, and champion-template field.
- Registered behavior and intent IDs.
- Formation and leader-response semantics.
- Cap relationships and off-floor freeze rules.
- Boss phase, recovery, unique reward, and loot behavior.
- Discovery-protection calculation.
- Full valid YAML examples and common rejection messages.
- Guidance for adding new encounter files without changing code.

The automated server-admin documentation test includes all new content kinds and closed identifiers.

## Verification strategy

### Content tests

- Strict encounter shapes and unknown-field rejection.
- Monster, item, loot-table, behavior, effect, and vault-tag references.
- Probability, depth, quantity, cap, placement, formation, and phase ordering.
- Required supernatural declaration for collapse.
- Boss uniqueness and reward requirements.
- Champion-template fallback, transferability, and positive quality-weight rules.
- Deterministic ordering, hashing, mounted content, and documentation coverage.

### Engine examples

- Exact run-gate rolls, stream isolation, and discovery-protection outcomes.
- Atomic encounter placement and route preservation.
- Actor observation and last-known memory without hidden tracking.
- Relay-connected and disconnected group awareness.
- Formation goals and deterministic A* adapter output.
- Leader bonuses and every death response.
- Swarm timing, cell ordering, all caps, and every shutdown response.
- Boss threshold ordering, irreversible phases, bounded recovery, uniqueness, and reward idempotency.
- Champion naming, optional placement, normalization, one-time defeat, heirloom materialization, and conquered suppression.
- Public projection and event redaction.

### Properties and replay

At least 500 seeded population sequences assert after every applied step:

- Strict save validation and content-bound validation.
- No occupancy, route, quantity, cap, membership, role, leader, source, or reward invariant violation.
- World time never decreases.
- Inactive-floor groups and swarms never change.
- Group communication never crosses a disconnected range gap.
- Swarm size never exceeds any declared cap.
- Boss phases never reverse and unique rewards never duplicate.
- A champion record produces at most one active instance and one heirloom.
- Player projection contains no hidden population decisions, knowledge, goals, paths, or future rolls.

Every shrunk counterexample becomes a fixed regression before implementation changes.

Continuous and split execution compare byte-identical final saves, command results, authoritative events, public events, and player projections.

### Milestone gates

Run a clean dependency install, content validation, all workspace tests, all typechecks, all builds, engine/dungeon/gameplay/population demonstrations, Docker build, whitespace validation, and clean-status inspection. The Docker build stage repeats every deterministic demonstration.

## Downstream contracts

4B2 may add neutral/NPC encounter variants and reputation state. It must reuse run gates, population placement, saved intent, pathfinding, and observable projection without weakening hostile-only opportunity rules.

4B3 consumes population events and pure discovery-protection outcomes. It provides fallen-champion and heirloom snapshots at run creation and permanently stores conquered champion record IDs at finalization.

Milestone 5 projects the same observable population state in the desktop interface. Milestone 6 supplies trusted profile inputs and runs the same engine server-side. Milestone 8 aggregates privacy-reduced population outcomes without receiving raw commands, hidden population rolls, run seeds, emails, or hero names.
