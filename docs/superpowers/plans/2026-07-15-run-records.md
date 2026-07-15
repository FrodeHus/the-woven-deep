# Run Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Milestone 4B3 as deterministic run metrics, explicit run conclusion with post-conclusion command rejection, itemized integer scoring, immutable Hall records, Heart lineage, heirloom selection, achievement grants, lifetime deltas, and a host-side repository boundary — proven with byte-stable finalization across split replay.

**Architecture:** Fold a closed statistic registry from domain events inside the existing reducer/world-step transition so the schema-v6 active run always carries current metrics. Conclude the run in the same transition that kills the hero, reject every later command with one closed reason, and finalize exactly once through a pure `finalizeRun` that consumes only the new `run-records` stream to select the heirloom, score the run, assemble a deterministic Hall record, evaluate achievements, and emit lifetime deltas. The engine never imports the repository; an in-memory `RunRecordRepository` implementation applies deltas, ranks standings with a shared comparator, and stores host enrichment outside the engine.

**Tech Stack:** TypeScript 5.8+, Node.js 22.12+, Zod 4, YAML 2.8, ROT.js 2.2.1 through the existing adapter, Vitest 3.2, fast-check 4.8.0, Docker Compose.

## Global Constraints

- Follow `docs/superpowers/specs/2026-07-15-run-records-design.md`; amend and reapprove the design before changing an approved rule.
- Keep the engine browser-safe. It must not import React, Fastify, SQLite, browser storage, Node-only APIs, wall clocks, ambient randomness, or profile repositories. The engine is deterministic and clock-free.
- Preserve `resolveCommand` as a pure immutable boundary. Every consequential roll uses a named saved random stream.
- Advance source and compiled content schema v4 to v5 and active-run save schema v5 to v6.
- Provide exactly one ordered v5-to-v6 save migration: preserve every v5 field byte-for-byte, add zeroed metrics, `conclusion: null`, and the derived `run-records` stream. Preserve the current strict v5 run schema as `legacyActiveRunV5Schema`; v4 saves route v4→v5→v6 in order; all other versions stay rejected. New runs start with zeroed metrics.
- `run-records` joins `RNG_STREAM_NAMES`, derived from the run seed like every other stream. Heirloom selection is its only 4B3 consumer. Materialized once; never rerolled.
- All arithmetic in metrics and scoring is checked integer arithmetic in the commerce style: explicit safe-product checks, quotient/remainder division, no floating point anywhere.
- `finalizeRun` is pure and callable exactly once (`finalized` guard; a second call is an invariant error).
- Host-enriched display fields — achieved-at date and portrait/appearance — are not engine fields, and enrichment is closed to exactly that vocabulary. The repository layer attaches enrichment at persistence time (`StoredHallRecord = HallRecord + enrichment`); lineage display uses the engine-validated hero name and class tags plus that closed enrichment.
- The metrics registry is a closed strict record, never an open map and never raw event history; adding a metric later is a schema bump. All values are non-negative safe integers.
- Completion types are exactly `died | became-heart | refused | broke-cycle`; 4B3 implements the complete data model for all four, but only `died` is producible. Hall sorting tiers order `broke-cycle > became-heart > refused > died`, then score descending, then record ID.
- Post-conclusion command rejection uses the closed reason `run.concluded` and consumes no randomness.
- Save invariants: dead hero ⟺ non-null conclusion; `finalized` may be true only with non-null conclusion; strict schema mirrors every field.
- The server never accepts records or scores from the browser (master design rule stands). Milestones 5–6 replace the in-memory repository behind the same interface without touching engine types.
- Every task follows RED/GREEN TDD, runs its focused tests, ends with a focused commit, and receives review before the next task.

## File and Responsibility Map

### Content platform

- `packages/content/src/model.ts`: schema-v5 `CompletionType`, `AchievementContentEntry`, achievement criteria registry types, balance `score` coefficients, and monster `threat`.
- `packages/content/src/compiler/schema.ts`: strict achievement source schema, score-coefficient bounds, and monster threat validation.
- `packages/content/src/compiler/registries.ts`: closed `ACHIEVEMENT_CRITERIA_IDS` registry.
- `packages/content/src/compiler/content-validation.ts`: at most one achievement per criterion; unknown criteria rejection.
- `packages/content/src/content-schema.ts`: strict compiled-pack schema-v5 validation.
- `packages/content/src/compiler/compile-directory.ts`: schema-v5 output and stable hash input.
- `content/achievements/first-defeats.yaml`: the two bundled 4B3 achievements.
- `content/balance/core-gameplay.yaml`: integer score coefficients.
- `content/monsters/*.yaml`: authored `threat` values.
- every existing `content/**/*.yaml`: `schemaVersion: 5`.

### Engine state, persistence, and metrics

- `packages/engine/src/run-metrics.ts`: `RunMetrics` closed registry, `emptyRunMetrics`, event folding, and floor-entry recording.
- `packages/engine/src/run-conclusion.ts`: `RunConclusion`, hero-death conclusion in the killing transition, and the `run.concluded` event.
- `packages/engine/src/model.ts`: schema-v6 `ActiveRun`, `run.concluded`/`run.finalized`/`achievement.granted` events, and the `run.concluded` invalid reason.
- `packages/engine/src/versions.ts`: save v6 and the `run-records` stream.
- `packages/engine/src/random.ts`: `run-records` stream discriminator.
- `packages/engine/src/save-schema.ts`: strict schema-v6 metrics/conclusion/event validation, cross-record conclusion invariants, and `legacyActiveRunV5Schema`.
- `packages/engine/src/save-codec.ts`: ordered v4→v5→v6 migration chain.
- `packages/engine/src/reducer.ts`: post-conclusion rejection, metric folding, and conclusion on hero death.
- `packages/engine/src/floor-integration.ts`: floor-entry metric recording on hero transitions.

### Scoring, records, and finalization

- `packages/engine/src/score-run.ts`: `scoreRun`, `ScoreBreakdown`, and the shared Hall comparator.
- `packages/engine/src/run-records-model.ts`: `HallRecord`, `FallenHeroBuildSnapshot`, `HallRecordEnrichment`, `StoredHallRecord`, `HeartLineageRecord`, `LifetimeState`, `LifetimeDeltas`, `AchievementGrant`, and the deterministic record ID.
- `packages/engine/src/heirloom-selection.ts`: one weighted `run-records` roll over equipped instances with the recorded fallback relic.
- `packages/engine/src/run-finalize.ts`: `finalizeRun` — heirloom, score, record assembly, achievement evaluation, lifetime deltas, and events, exactly once.
- `packages/engine/src/run-record-repository.ts`: `RunRecordRepository` interface, in-memory implementation, and the standings feed.

### Projection, verification, and operations

- `packages/engine/src/projection.ts`: read-only metrics projection and the run-conclusion projection.
- `packages/engine/src/event-projection.ts`: hero-visible `run.concluded`/`run.finalized`/`achievement.granted` passthrough.
- `packages/engine/src/run-records-fixture.ts`: deterministic 4B exit-demonstration fixture with replay boundaries.
- `packages/engine/test/run-*.test.ts`, `packages/engine/test/heirloom-selection.test.ts`: focused examples per module.
- `packages/engine/test/run-records-properties.test.ts`: 512-seed invariant suite.
- `scripts/run-records-demo.mjs` and `packages/engine/test/fixtures/run-records-demo-hashes.json`: deterministic terminal demonstration with reviewed hashes.
- `packages/engine/test/run-records-cli.test.ts`: hash pinning and transcript assertions.
- `docs/server-admin/content-configuration.md` and `docs/operations/run-records.md`: authoring and client contracts.
- `docs/superpowers/plans/2026-07-13-implementation-roadmap.md`: 4B3 completion and the amended endgame milestone.
- `package.json`, `scripts/smoke-runner.mjs`, and `Dockerfile`: run-records demo release gates.

---

### Task 1: Add schema-v5 achievement, score-coefficient, and threat content

**Files:**
- Modify: `packages/content/src/model.ts`
- Modify: `packages/content/src/compiler/schema.ts`
- Modify: `packages/content/src/compiler/registries.ts`
- Modify: `packages/content/src/compiler/content-validation.ts`
- Modify: `packages/content/src/content-schema.ts`
- Modify: `packages/content/test/model.test.ts`
- Modify: `packages/content/test/parse-file.test.ts`
- Modify: `packages/content/test/compile-directory.test.ts`
- Modify: `packages/content/test/default-content.test.ts`
- Modify: `packages/content/test/admin-docs.test.ts`
- Modify: `docs/server-admin/content-configuration.md`
- Modify: `content/balance/core-gameplay.yaml`
- Modify: `content/monsters/cave-rat.yaml`
- Modify: `content/monsters/population-examples.yaml`
- Modify: every existing `content/**/*.yaml` schema version
- Create: `content/achievements/first-defeats.yaml`

**Interfaces:**
- Consumes: schema-v4 `BaseContentEntry`, `BalanceContentEntry`, `MonsterContentEntry`, strict source parsing, cross-file validation, and stable compiler hashing.
- Produces: `CONTENT_SCHEMA_VERSION === 5`, `CompletionType`, `AchievementContentEntry`, `AchievementCriteriaId`, `ACHIEVEMENT_CRITERIA_IDS`, `ScoreCoefficientsDefinition` on `BalanceContentEntry.score`, and `MonsterContentEntry.threat`.

- [ ] **Step 1: Write failing public-model and parser tests**

Add exact expectations for the new kind, criteria registry, score block, and threat:

```ts
expect(CONTENT_SCHEMA_VERSION).toBe(5);
expect(CONTENT_KIND_IDS).toContain('achievement');
expect(ACHIEVEMENT_CRITERIA_IDS).toEqual(['first-champion-defeat', 'first-echo-defeat']);
expect(parseContentFile(validAchievementYaml).entries[0]).toMatchObject({
  kind: 'achievement', criteriaId: 'first-champion-defeat',
  name: "Defeated the Deep's Champion",
});
expect(parseContentFile(validBalanceYaml).entries[0]).toMatchObject({
  score: {
    depthCoefficient: 100, bossDefeatCoefficient: 250, threatCoefficient: 5,
    discoveryCoefficient: 25,
    completionBonus: { died: 0, refused: 400, 'became-heart': 800, 'broke-cycle': 1500 },
    turnEfficiencyBudget: 500, turnEfficiencyDecayInterval: 200,
  },
});
expect(parseContentFile(validMonsterYaml).entries[0]).toMatchObject({ threat: 1 });
```

Cover strict unknown-field rejection on the achievement entry, unknown criteria rejection, empty description rejection, negative or unsafe score coefficients, missing `completionBonus` keys, a zero `turnEfficiencyDecayInterval`, negative or missing monster `threat`, and schema-v4 rejection.

- [ ] **Step 2: Run focused parser tests and verify RED**

Run: `npm test --workspace @woven-deep/content -- --run test/model.test.ts test/parse-file.test.ts`

Expected: FAIL because schema version 5, the achievement kind, `score`, and `threat` do not exist.

- [ ] **Step 3: Add exact public content types and the closed criteria registry**

Implement these shapes in `model.ts` (bump `CONTENT_SCHEMA_VERSION` to `5 as const`, add `'achievement'` to `CONTENT_KIND_IDS`, and add `AchievementContentEntry` to the `ContentEntry` union) with matching strict Zod schemas in `compiler/schema.ts` and `ACHIEVEMENT_CRITERIA_IDS` in `compiler/registries.ts`:

```ts
export type CompletionType = 'died' | 'became-heart' | 'refused' | 'broke-cycle';

export type AchievementCriteriaId = 'first-champion-defeat' | 'first-echo-defeat';

export interface AchievementContentEntry extends BaseContentEntry {
  readonly kind: 'achievement';
  readonly description: string;
  readonly criteriaId: AchievementCriteriaId;
}

export interface ScoreCoefficientsDefinition {
  readonly depthCoefficient: number;
  readonly bossDefeatCoefficient: number;
  readonly threatCoefficient: number;
  readonly discoveryCoefficient: number;
  readonly completionBonus: Readonly<Record<CompletionType, number>>;
  readonly turnEfficiencyBudget: number;
  readonly turnEfficiencyDecayInterval: number;
}
```

Add `readonly score: ScoreCoefficientsDefinition` to `BalanceContentEntry` and `readonly threat: number` to `MonsterContentEntry`. Validate every coefficient, bonus, and budget as a non-negative safe integer; `turnEfficiencyDecayInterval` is a positive safe integer; `threat` is a non-negative safe integer; `description` is a non-empty string of at most 200 characters.

```ts
export const ACHIEVEMENT_CRITERIA_IDS = ['first-champion-defeat', 'first-echo-defeat'] as const;
```

- [ ] **Step 4: Write failing semantic compiler tests**

Add table-driven cases for duplicate criteria across achievements and for compiled-pack validation:

```ts
expect(() => compileFixture({ achievements: [
  achievement('achievement.a', 'first-champion-defeat'),
  achievement('achievement.b', 'first-champion-defeat'),
] })).toThrow(/at most one achievement per criterion/);
expect(() => validateCompiledContentPack({ ...pack, schemaVersion: 4 }))
  .toThrow(/Unsupported content schema version 4; expected 5/);
```

- [ ] **Step 5: Implement cross-file validation and schema-v5 pack output**

In `content-validation.ts`, group achievement entries by `criteriaId` and reject any criterion claimed twice. `content-schema.ts` and `compile-directory.ts` already read `CONTENT_SCHEMA_VERSION`; confirm both emit and require version 5 and that the hash input includes the new fields through the existing normalized-entry path.

- [ ] **Step 6: Add bundled content and update all source versions**

Create `content/achievements/first-defeats.yaml`:

```yaml
schemaVersion: 5
entries:
  - kind: achievement
    id: achievement.defeated-the-deeps-champion
    name: Defeated the Deep's Champion
    tags: [fallen-hero, prestige]
    description: Defeat the Deep's Champion for the first time.
    criteriaId: first-champion-defeat
  - kind: achievement
    id: achievement.silenced-an-echo
    name: Silenced an Echo
    tags: [fallen-hero]
    description: Defeat an Echo of a fallen hero for the first time.
    criteriaId: first-echo-defeat
```

Add to `content/balance/core-gameplay.yaml`:

```yaml
    score:
      depthCoefficient: 100
      bossDefeatCoefficient: 250
      threatCoefficient: 5
      discoveryCoefficient: 25
      completionBonus: { died: 0, refused: 400, became-heart: 800, broke-cycle: 1500 }
      turnEfficiencyBudget: 500
      turnEfficiencyDecayInterval: 200
```

Author `threat` on every bundled monster: `cave-rat.yaml` gets `threat: 1`; each entry in `population-examples.yaml` gets a threat proportional to its role (ordinary members `2`, leaders `5`, swarm sources `4`, the boss `12`, the champion fallback `10`). Change every YAML file (including `content/npcs`, `content/npc-factions`, `content/champions`, `content/vaults`, `content/items`, and all others) to `schemaVersion: 5`. Document the achievement kind, the closed criteria registry, every score coefficient with its bounds, the completion-bonus keys, the turn-efficiency parameters, and the monster `threat` field in `docs/server-admin/content-configuration.md`; extend `admin-docs.test.ts` so `achievement`, both criteria IDs, `score`, and `threat` must appear in the docs. Update `default-content.test.ts` and `packages/engine/src/fixture.ts` consumers only if they assert schema version 4 directly (engine fixtures follow in Task 2).

- [ ] **Step 7: Run content gates and verify GREEN**

Run: `npm test --workspace @woven-deep/content && npm run content:validate`

Expected: all content tests pass and validation reports a schema-v5 pack containing two achievements, score coefficients, and threat-bearing monsters.

- [ ] **Step 8: Commit content contracts**

```bash
git add packages/content content docs/server-admin
git commit -m "feat: define achievement and score content"
```

---

### Task 2: Introduce schema-v6 metrics, conclusion, run-records stream, and v5 migration

**Files:**
- Create: `packages/engine/src/run-metrics.ts`
- Create: `packages/engine/src/run-conclusion.ts`
- Modify: `packages/engine/src/model.ts`
- Modify: `packages/engine/src/versions.ts`
- Modify: `packages/engine/src/random.ts`
- Modify: `packages/engine/src/save-schema.ts`
- Modify: `packages/engine/src/save-codec.ts`
- Modify: `packages/engine/src/index.ts`
- Modify: `packages/engine/src/fixture.ts`
- Modify: `packages/engine/src/gameplay-fixture.ts`
- Modify: `packages/engine/src/generated-fixture.ts`
- Modify: `packages/engine/src/population-fixture.ts`
- Modify: `packages/engine/src/merchant-fixture.ts`
- Modify: `packages/engine/test/model.test.ts`
- Modify: `packages/engine/test/save-codec.test.ts`
- Modify: `packages/engine/test/arbitraries.ts`

**Interfaces:**
- Consumes: schema-v5 `ActiveRun`, the canonical save codec, `deriveRngStreams`, strict cross-record validation, `legacyActiveRunV4Schema`, and compiled schema-v5 content from Task 1.
- Produces: schema-v6 `ActiveRun` with `metrics: RunMetrics` and `conclusion: RunConclusion | null`, `SAVE_SCHEMA_VERSION === 6`, the `run-records` RNG stream, `emptyRunMetrics()`, `legacyActiveRunV5Schema`, the ordered v5→v6 migration, and the three new event types with strict schemas.

- [ ] **Step 1: Write failing model and migration tests**

Assert exact defaults, preservation, and chained migration:

```ts
const decoded = decodeActiveRun(JSON.stringify(v5Fixture));
expect(decoded.schemaVersion).toBe(6);
expect(decoded.metrics).toEqual(emptyRunMetrics());
expect(decoded.conclusion).toBeNull();
expect(decoded.rng['run-records']).toEqual(deriveRngStreams(v5Fixture.runSeed)['run-records']);
expect(stripV6Fields(decoded)).toEqual(v5Fixture);

const fromV4 = decodeActiveRun(JSON.stringify(v4Fixture));
expect(fromV4.schemaVersion).toBe(6);
expect(fromV4.hero.currency).toBe(0);
expect(fromV4.metrics).toEqual(emptyRunMetrics());
```

Add strict v6 rejection for: negative or unsafe metric values, extra metric keys, missing metric keys, `kills` below the `killsByModel` sum, a non-null conclusion with a living hero, a dead hero with a null conclusion, `finalized: true` shapes without a conclusion (structural), `concludedAtRevision` above `revision`, `cause.turn` above `turn`, `cause.worldTime` above `worldTime`, a non-null `killerContentId` on a non-`died` completion, more than one `run.concluded` across `recentCommands`, any `run.finalized` or `achievement.granted` inside `recentCommands`, and unsupported schema versions 3 and 7.

- [ ] **Step 2: Run save tests and verify RED**

Run: `npm test --workspace @woven-deep/engine -- --run test/model.test.ts test/save-codec.test.ts`

Expected: FAIL because version 6, the metrics registry, and the migration do not exist.

- [ ] **Step 3: Add canonical state types**

Define and export these exact contracts in `run-metrics.ts` and `run-conclusion.ts`:

```ts
export interface RunKillsByModel {
  readonly individual: number;
  readonly group: number;
  readonly swarm: number;
  readonly boss: number;
}

export interface RunMetrics {
  readonly kills: number;
  readonly killsByModel: RunKillsByModel;
  readonly bossKills: number;
  readonly championKills: number;
  readonly echoKills: number;
  readonly threatDefeated: number;
  readonly damageDealt: number;
  readonly damageTaken: number;
  readonly itemsCollected: number;
  readonly itemsIdentified: number;
  readonly currencyEarned: number;
  readonly currencySpent: number;
  readonly tradesCompleted: number;
  readonly floorsEntered: number;
  readonly deepestDepth: number;
  readonly discoveriesRevealed: number;
  readonly turnsElapsed: number;
  readonly restsCompleted: number;
}

export function emptyRunMetrics(): RunMetrics {
  return {
    kills: 0, killsByModel: { individual: 0, group: 0, swarm: 0, boss: 0 },
    bossKills: 0, championKills: 0, echoKills: 0, threatDefeated: 0,
    damageDealt: 0, damageTaken: 0, itemsCollected: 0, itemsIdentified: 0,
    currencyEarned: 0, currencySpent: 0, tradesCompleted: 0,
    floorsEntered: 0, deepestDepth: 0, discoveriesRevealed: 0,
    turnsElapsed: 0, restsCompleted: 0,
  };
}
```

```ts
import type { CompletionType } from '@woven-deep/content';

export interface RunConclusionCause {
  readonly killerContentId: OpaqueId | null;   // null for non-death completions
  readonly depth: number;
  readonly turn: number;
  readonly worldTime: number;
}

export interface RunConclusion {
  readonly completionType: CompletionType;
  readonly cause: Readonly<RunConclusionCause>;
  readonly concludedAtRevision: number;
  readonly finalized: boolean;
}
```

Add to `ActiveRun` in `model.ts` (schemaVersion becomes `6`): `readonly metrics: RunMetrics;` and `readonly conclusion: RunConclusion | null;`. Add the events and the closed invalid reason:

```ts
export interface RunConcludedEvent {
  readonly type: 'run.concluded'; readonly eventId: OpaqueId;
  readonly completionType: CompletionType; readonly cause: RunConclusionCause;
}
export interface RunFinalizedEvent {
  readonly type: 'run.finalized'; readonly eventId: OpaqueId;
  readonly recordId: OpaqueId; readonly completionType: CompletionType;
  readonly scoreTotal: number;
}
export interface AchievementGrantedEvent {
  readonly type: 'achievement.granted'; readonly eventId: OpaqueId;
  readonly achievementId: OpaqueId; readonly criteriaId: AchievementCriteriaId;
  readonly name: string;
}
export type RunRecordDomainEvent = RunConcludedEvent | RunFinalizedEvent | AchievementGrantedEvent;
```

Add `RunRecordDomainEvent` to `DomainEvent`, keep the three types in `PublicEvent` (they pass through to the controlling hero), and extend `InvalidActionReason` with `| 'run.concluded'`. In `versions.ts` set `SAVE_SCHEMA_VERSION = 6 as const` and append `'run-records'` to `RNG_STREAM_NAMES`; in `random.ts` add `'run-records': 10` to `STREAM_DISCRIMINATORS`.

- [ ] **Step 4: Implement strict v6 schema and cross-record checks**

Mirror `RunMetrics` and `RunConclusion` with strict Zod objects (every metric `safeNonNegative`; `killsByModel` a strict four-key object; `completionType` the four-value enum; `killerContentId` a nullable identifier). Add `run.concluded`, `run.finalized`, and `achievement.granted` strict event schemas to the save event union and add `'run.concluded'` to `blockReason`. Cross-record checks in `validateSemantics`:

- hero actor `health === 0` ⟺ `conclusion !== null`;
- `conclusion.concludedAtRevision <= revision`, `cause.turn <= turn`, `cause.worldTime <= worldTime`, and a floor with `depth === cause.depth` exists;
- `completionType !== 'died'` requires `killerContentId === null`;
- `metrics.kills >= killsByModel.individual + killsByModel.group + killsByModel.swarm + killsByModel.boss` (checked sum);
- at most one `run.concluded` across all `recentCommands[].events`, only inside a save whose `conclusion` is non-null;
- `run.finalized` and `achievement.granted` never appear inside `recentCommands` (they are produced only by `finalizeRun` outside command resolution);
- any command may fail with reason `run.concluded` (extend the invalid-reason consistency branch exactly as `trade.active` is allowed).

- [ ] **Step 5: Implement the ordered migration chain**

Preserve the current exact strict v6-precursor schema as `legacyActiveRunV5Schema` (schemaVersion literal 5, the nine v5 stream names, no `metrics`, no `conclusion`) before extending the live schema. Route versions in order in `save-codec.ts`:

```ts
function migrateV5ToV6(input: unknown): unknown {
  const v5 = legacyActiveRunV5Schema.parse(input);
  const derived = deriveRngStreams(v5.runSeed);
  return {
    ...v5,
    schemaVersion: 6,
    rng: { ...v5.rng, 'run-records': derived['run-records'] },
    metrics: emptyRunMetrics(),
    conclusion: null,
  };
}

export function decodeActiveRun(json: string): ActiveRun {
  // ... existing JSON parsing and version detection ...
  if (schemaVersion === 4) return validateActiveRun(migrateV5ToV6(migrateV4ToV5(input)));
  if (schemaVersion === 5) return validateActiveRun(migrateV5ToV6(input));
  if (schemaVersion !== SAVE_SCHEMA_VERSION) { /* existing unsupported_version error */ }
  return validateActiveRun(input);
}
```

Keep `migrateV4ToV5` and `legacyActiveRunV4Schema` byte-for-byte unchanged; wrap both migration branches in the existing `SaveLoadError` translation. Validate the migrated result through the same v6 decoder.

- [ ] **Step 6: Update fixtures and property arbitraries**

Every fixture builder (`fixture.ts`, `gameplay-fixture.ts`, `generated-fixture.ts`, `population-fixture.ts`, `merchant-fixture.ts`) emits `schemaVersion: 6`, the `run-records` stream from `deriveRngStreams`, `metrics: emptyRunMetrics()`, and `conclusion: null`. Preserve dedicated v4 and v5 fixture builders only inside migration tests. Extend `test/arbitraries.ts` so generated runs include valid metrics and a null conclusion.

- [ ] **Step 7: Run save and engine type gates**

Run: `npm test --workspace @woven-deep/engine -- --run test/model.test.ts test/save-codec.test.ts && npm run typecheck --workspace @woven-deep/engine`

Expected: focused tests pass; canonical v6 round-trips, v5 migrates byte-stably after first v6 encoding, and v4 chains through both migrations.

- [ ] **Step 8: Commit persistence contracts**

```bash
git add packages/engine
git commit -m "feat: add run metrics save state and migration"
```

---

### Task 3: Fold run metrics from domain events in the reducer and floor boundary

**Files:**
- Modify: `packages/engine/src/run-metrics.ts`
- Modify: `packages/engine/src/reducer.ts`
- Modify: `packages/engine/src/floor-integration.ts`
- Modify: `packages/engine/src/gameplay-fixture.ts`
- Modify: `packages/engine/src/merchant-fixture.ts`
- Modify: `packages/engine/src/population-fixture.ts`
- Create: `packages/engine/test/run-metrics.test.ts`
- Modify: `packages/engine/test/reducer.test.ts`
- Modify: `packages/engine/test/floor-integration.test.ts`

**Interfaces:**
- Consumes: `RunMetrics`/`emptyRunMetrics` from Task 2, the `DomainEvent` union, population model lookup, `MonsterContentEntry.threat` from Task 1, and the reducer `record()` boundary.
- Produces: `foldRunMetrics(input): RunMetrics`, `recordFloorEntered(run, depth): ActiveRun`, reducer folding on every processed command, and floor-entry recording on hero transitions.

- [ ] **Step 1: Write failing folding tests**

Cover each rule with exact table-driven events over a fixture that includes populations of every model:

```ts
const folded = foldRunMetrics({
  metrics: emptyRunMetrics(), state: fixtureState, content,
  events: [diedEvent({ actorId: 'actor.group-member', killerActorId: hero })],
  turnAdvanced: true,
});
expect(folded.kills).toBe(1);
expect(folded.killsByModel.group).toBe(1);
expect(folded.threatDefeated).toBe(2);
expect(folded.turnsElapsed).toBe(1);
```

Assert: hero-credited `actor.died` increments `kills`, the dying actor's population model bucket (`individual`/`group`/`swarm`/`boss` only), and `threatDefeated` by the dying actor's authored monster `threat` (NPCs and actors without a monster definition contribute zero); non-hero kills change nothing; `boss.defeated` → `bossKills`; `champion.defeated` → `championKills`; `echo.defeated` → `echoKills`; `actor.damaged` with hero source → `damageDealt`, hero target → `damageTaken`, hero self-damage excluded from `damageDealt`; hero `item.picked-up` and `trade.bought` quantities → `itemsCollected`; `item.identified` → `itemsIdentified`; `trade.sold` totals → `currencyEarned`; `trade.bought` totals and `trade.service-purchased` prices → `currencySpent`; `trade.closed` with `completedCommerce` → `tradesCompleted`; hero `feature.revealed` → `discoveriesRevealed`; `rest.completed` → `restsCompleted`; `turnAdvanced` → `turnsElapsed`; overflow near `Number.MAX_SAFE_INTEGER` throws; monotonicity (no rule ever decreases a counter). Cover `recordFloorEntered`: `floorsEntered` increments, `deepestDepth` takes the maximum, and negative or unsafe depths throw.

- [ ] **Step 2: Write failing integration tests**

In `reducer.test.ts`, resolve a hero attack that kills an adjacent monster and assert `state.metrics.kills === 1` and `state.metrics.turnsElapsed` advanced; resolve a `trade-buy` and assert `currencySpent` grew while `turnsElapsed` did not. In `floor-integration.test.ts`, integrate a floor the hero is transitioning onto and assert `floorsEntered` and `deepestDepth` advanced exactly once.

- [ ] **Step 3: Run metric tests and verify RED**

Run: `npm test --workspace @woven-deep/engine -- --run test/run-metrics.test.ts test/reducer.test.ts test/floor-integration.test.ts`

Expected: FAIL because `foldRunMetrics` and `recordFloorEntered` do not exist.

- [ ] **Step 4: Implement checked folding**

```ts
export function foldRunMetrics(input: Readonly<{
  metrics: RunMetrics;
  state: ActiveRun;               // post-transition state used for population/content lookup
  content: CompiledContentPack;
  events: readonly DomainEvent[];
  turnAdvanced: boolean;
}>): RunMetrics;

export function recordFloorEntered(run: ActiveRun, depth: number): ActiveRun;
```

Use a `checkedAdd(left, right, label)` helper mirroring the commerce `checkedProduct` style (safe-integer assertion before returning). Resolve the dying actor's population through `actor.populationId` against `state.populations`; only the four listed models feed `killsByModel`. Resolve `threat` through the dying actor's `contentId` monster entry; missing monster definitions contribute zero. `recordFloorEntered` returns `{ ...run, metrics: { ...run.metrics, floorsEntered: checkedAdd(...), deepestDepth: Math.max(run.metrics.deepestDepth, depth) } }`.

- [ ] **Step 5: Integrate the reducer and floor boundary**

In `reducer.ts` `record()`, fold before storing: `state = { ...state, metrics: foldRunMetrics({ metrics: state.metrics, state, content, events, turnAdvanced: result.status === 'applied' && result.turn > state.turn }) }` — thread `content` into `record()` from `resolveCommand`. Both the trade branch and the world branch route through `record()`, so metrics fold at the moment events are produced and split replay preserves them. In `floor-integration.ts`, when `transitioningToInsertedFloor` is true, apply `recordFloorEntered(run, generated.floor.depth)` before `validateActiveRun`. Every fixture that assembles its initial run or moves the hero to a different `activeFloorId` (`gameplay-fixture.ts`, `merchant-fixture.ts`, `population-fixture.ts`) calls `recordFloorEntered` for the entered floor, including the initial floor at run creation, so `floorsEntered >= 1` in every produced run.

- [ ] **Step 6: Run metric suites and verify GREEN**

Run: `npm test --workspace @woven-deep/engine -- --run test/run-metrics.test.ts test/reducer.test.ts test/floor-integration.test.ts test/save-codec.test.ts`

Expected: all pass; continuous and reloaded runs carry identical metrics.

- [ ] **Step 7: Commit metric folding**

```bash
git add packages/engine/src packages/engine/test
git commit -m "feat: fold run metrics from domain events"
```

---

### Task 4: Conclude the run on hero death and reject post-conclusion commands

**Files:**
- Modify: `packages/engine/src/run-conclusion.ts`
- Modify: `packages/engine/src/reducer.ts`
- Modify: `packages/engine/src/event-projection.ts`
- Modify: `packages/engine/src/index.ts`
- Create: `packages/engine/test/run-conclusion.test.ts`
- Modify: `packages/engine/test/reducer.test.ts`

**Interfaces:**
- Consumes: `RunConclusion`/`RunConcludedEvent` from Task 2, `resolveWorldStep`/`resolveRest` results, `actor.died` killer credit, and the reducer dispatch order.
- Produces: `concludeRunOnHeroDeath(input)`, the `run.concluded` event inside the killing transition, and closed-reason `run.concluded` rejection of every later player command without randomness.

- [ ] **Step 1: Write failing conclusion tests**

```ts
const concluded = concludeRunOnHeroDeath({
  state: deadHeroState, content, events: killingEvents,
  revision: 7, turn: 12, eventId: 'command.fatal',
});
expect(concluded.state.conclusion).toEqual({
  completionType: 'died',
  cause: { killerContentId: 'monster.cave-rat', depth: 3, turn: 12, worldTime: deadHeroState.worldTime },
  concludedAtRevision: 7,
  finalized: false,
});
expect(concluded.events.at(-1)).toMatchObject({ type: 'run.concluded', completionType: 'died' });
```

Cover: living hero → unchanged with no event; killer credited from the last `actor.died` event whose `actorId` is the hero, resolving `killerActorId` to that actor's `contentId`; `killerContentId: null` when no hero `actor.died` event exists in the transition (environmental death) or the killer is the hero itself; depth taken from the active floor; exactly one `run.concluded`; idempotence when the conclusion is already set.

- [ ] **Step 2: Write failing reducer rejection tests**

Drive a fixture run to hero death through `resolveCommand`, then assert every later command — `move`, `wait`, `trade-open`, `rest` — returns `{ status: 'invalid', reason: 'run.concluded' }`, records an `action.invalid` event, advances neither turn nor world time beyond the invalid bookkeeping, and leaves every RNG stream byte-identical. Assert the killing command's recorded events contain `run.concluded` and that the resulting save round-trips through `encodeActiveRun`/`decodeActiveRun` (dead hero ⟺ non-null conclusion).

- [ ] **Step 3: Run conclusion tests and verify RED**

Run: `npm test --workspace @woven-deep/engine -- --run test/run-conclusion.test.ts test/reducer.test.ts`

Expected: FAIL because `concludeRunOnHeroDeath` and the rejection branch do not exist.

- [ ] **Step 4: Implement the conclusion boundary**

```ts
export function concludeRunOnHeroDeath(input: Readonly<{
  state: ActiveRun;
  content: CompiledContentPack;
  events: readonly DomainEvent[];
  revision: number;
  turn: number;
  eventId: OpaqueId;
}>): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }>;
```

Return the input unchanged when the hero actor's health is above zero or `conclusion` is already non-null. Otherwise build the `died` conclusion: find the last `actor.died` event with `actorId === state.hero.actorId`; the killer is `killerActorId` when it is not the hero, resolved to that actor's `contentId` (former members remain in `state.actors`), else `null`. `depth` is the active floor's depth, `turn` and `revision` come from the inputs, `worldTime` from the state, `finalized: false`. Append one `run.concluded` event carrying `completionType` and the exact cause.

- [ ] **Step 5: Integrate the reducer in dispatch order**

In `resolveCommand`, immediately after the dedup and stale-revision checks and the content-hash guard — before `closeTradeIfInvalid`, before validation, and before any stream is touched — reject when concluded:

```ts
if (state.conclusion !== null) return recordInvalid(state, command, 'run.concluded', [], []);
```

After the world branch resolves (`resolveRest` or `resolveWorldStep`), conclude in the same transition:

```ts
const concluded = concludeRunOnHeroDeath({ state: world.state, content: context.content,
  events: world.events, revision: result.revision, turn: result.turn, eventId: command.commandId });
```

Merge `concluded.events` after `world.events`, project them for the hero (extend `projectDomainEvents` with a `case 'run.concluded': output.push(event); break;`), and record against `concluded.state`. Trade commands never conclude (revision-only transitions cannot kill the hero).

- [ ] **Step 6: Run conclusion suites and verify GREEN**

Run: `npm test --workspace @woven-deep/engine -- --run test/run-conclusion.test.ts test/reducer.test.ts test/world-step.test.ts test/rest.test.ts test/save-codec.test.ts`

Expected: all pass; a rest interrupted by `hero-death` and a reaction kill both conclude in their own transition.

- [ ] **Step 7: Commit run conclusion**

```bash
git add packages/engine/src packages/engine/test
git commit -m "feat: conclude runs on hero death"
```

---

### Task 5: Implement itemized integer scoring and the Hall comparator

**Files:**
- Create: `packages/engine/src/score-run.ts`
- Create: `packages/engine/test/score-run.test.ts`
- Modify: `packages/engine/src/index.ts`

**Interfaces:**
- Consumes: `RunMetrics`, `RunConclusion`, `BalanceContentEntry.score` from Task 1, and the commerce checked-arithmetic style.
- Produces: `ScoreLine`, `ScoreBreakdown`, `scoreRun(input): ScoreBreakdown`, and `compareHallRecords(left, right): number` (used by Tasks 6–8; it accepts the `HallRecordOrdering` subset so it needs no forward type).

- [ ] **Step 1: Write failing exact scoring tests**

```ts
const breakdown = scoreRun({ run: concludedRun, content });
expect(breakdown.lines).toEqual([
  { lineId: 'depth', quantity: 4, coefficient: 100, amount: 400 },
  { lineId: 'boss-defeats', quantity: 1, coefficient: 250, amount: 250 },
  { lineId: 'threat', quantity: 17, coefficient: 5, amount: 85 },
  { lineId: 'discoveries', quantity: 2, coefficient: 25, amount: 50 },
  { lineId: 'completion-bonus', quantity: 1, coefficient: 0, amount: 0 },
  { lineId: 'turn-efficiency', quantity: 43, coefficient: 1, amount: 457 },
]);
expect(breakdown.total).toBe(1242);
```

Cover: an unconcluded run throws; the turn-efficiency bonus equals `budget - quotient(turnsElapsed, decayInterval)` clamped to zero (grinding decays it, rushing never exceeds the budget); zero coefficients yield zero lines; safe-product overflow throws before any line is produced; total equals the checked sum of every line; non-negativity of every line and the total. Cover the comparator: tier order `broke-cycle > became-heart > refused > died` dominates any score, score descends within a tier, and record ID ascends as the total-order tiebreak.

- [ ] **Step 2: Run scoring tests and verify RED**

Run: `npm test --workspace @woven-deep/engine -- --run test/score-run.test.ts`

Expected: FAIL because `scoreRun` does not exist.

- [ ] **Step 3: Implement checked scoring**

```ts
export type ScoreLineId = 'depth' | 'boss-defeats' | 'threat' | 'discoveries'
  | 'completion-bonus' | 'turn-efficiency';

export interface ScoreLine {
  readonly lineId: ScoreLineId;
  readonly quantity: number;
  readonly coefficient: number;
  readonly amount: number;
}

export interface ScoreBreakdown {
  readonly lines: readonly ScoreLine[];
  readonly total: number;
}

export function scoreRun(input: Readonly<{
  run: ActiveRun;                 // conclusion non-null
  content: CompiledContentPack;
}>): ScoreBreakdown;

export interface HallRecordOrdering {
  readonly recordId: OpaqueId;
  readonly completionType: CompletionType;
  readonly score: ScoreBreakdown;
}

export function compareHallRecords(left: HallRecordOrdering, right: HallRecordOrdering): number;
```

Lines, in this exact order: `depth` (`metrics.deepestDepth × depthCoefficient`), `boss-defeats` (`metrics.bossKills × bossDefeatCoefficient`), `threat` (`metrics.threatDefeated × threatCoefficient`), `discoveries` (`metrics.discoveriesRevealed × discoveryCoefficient`), `completion-bonus` (quantity `1`, coefficient `0`, amount `score.completionBonus[conclusion.completionType]`), `turn-efficiency` (quantity `quotient(metrics.turnsElapsed, turnEfficiencyDecayInterval)` via floor quotient/remainder division, coefficient `1`, amount `Math.max(0, turnEfficiencyBudget - quantity)` with checked subtraction). Every multiplication uses an explicit safe-product check; the total is a checked sum. Consumers never recompute — the breakdown stores every line plus the total. `compareHallRecords` maps tiers to `{ 'broke-cycle': 3, 'became-heart': 2, refused: 1, died: 0 }`, compares tier descending, then `score.total` descending, then `recordId` by code units ascending.

- [ ] **Step 4: Run scoring tests and verify GREEN**

Run: `npm test --workspace @woven-deep/engine -- --run test/score-run.test.ts && npm run typecheck --workspace @woven-deep/engine`

Expected: all scoring and comparator examples pass without floating-point paths.

- [ ] **Step 5: Commit scoring**

```bash
git add packages/engine/src packages/engine/test
git commit -m "feat: score concluded runs"
```

---

### Task 6: Model Hall records, Heart lineage, lifetime state, and heirloom selection

**Files:**
- Create: `packages/engine/src/run-records-model.ts`
- Create: `packages/engine/src/heirloom-selection.ts`
- Create: `packages/engine/test/run-records-model.test.ts`
- Create: `packages/engine/test/heirloom-selection.test.ts`
- Modify: `packages/engine/src/index.ts`

**Interfaces:**
- Consumes: `RunMetrics`, `RunConclusion`, `ScoreBreakdown`, `FactionReputation`, `RecordedHeirloomSnapshot`, `FallenChampionTemplateContentEntry.heirloomSelection`, `guaranteedUniqueItemIds`, `rollDie` on the `run-records` stream, and `DiscoveryProtectionUpdate` from 4B1.
- Produces: `HallRecord`, `FallenHeroBuildSnapshot`, `HallRecordEnrichment`, `StoredHallRecord`, `HeartLineageRecord`, `LifetimeState`, `LifetimeDeltas`, `AchievementGrant`, `deriveHallRecordId(runSeed, contentHash)`, and `selectHeirloom(input)`.

- [ ] **Step 1: Write failing record-model tests**

```ts
expect(deriveHallRecordId([1, 2, 3, 4], 'a'.repeat(64)))
  .toBe(`record.00000001000000020000000300000004.${'a'.repeat(16)}`);
```

Assert the ID is deterministic, matches the opaque-identifier grammar, and differs for a different seed or content hash. Assert `HallRecordEnrichment` and `HeartLineageRecord` shapes carry exactly the two closed enrichment fields — write a type-level test that assigning any extra enrichment property is rejected (`// @ts-expect-error` assignment of an object with a third key).

- [ ] **Step 2: Write failing heirloom-selection tests**

```ts
const first = selectHeirloom({ run: deadHeroRun, content, template, recordId });
const second = selectHeirloom({ run: deadHeroRun, content, template, recordId });
expect(first).toEqual(second);
expect(first.snapshot.sourceItemId).toBe('item.hero.sword');
expect(first.snapshot.originatingHallRecordId).toBe(recordId);
expect(deadHeroRun.rng['run-records']).not.toEqual(first.nextRunRecordsState);
```

Cover: only equipped instances are candidates (backpack items never); items tagged `heirloom`, `quest`, `objective`, or `nontransferable`, boss guaranteed uniques, `heirloomEligible: false` definitions, and definitions without `equipment` are excluded; weights equal `rarityWeights[rarity] + qualityRankBonus × qualityRank` where `qualityRank` counts the instance's positive enchantment modifier values; every eligible instance retains positive weight (a common depleted item can win under a forced roll); one unit is recorded from a stack; a two-handed item is one candidate; exactly one roll is consumed and no other stream moves; no eligible equipment yields the template's fallback relic (`contentId: template.fallbackItemId`, `sourceItemId: null`, `condition: 100`, `qualityRank: 0`, definition name/glyph/color) without consuming a roll; a living hero throws.

- [ ] **Step 3: Run model tests and verify RED**

Run: `npm test --workspace @woven-deep/engine -- --run test/run-records-model.test.ts test/heirloom-selection.test.ts`

Expected: FAIL because the record model and selection do not exist.

- [ ] **Step 4: Implement the record model**

```ts
export interface FallenHeroBuildSnapshot {
  readonly attributes: BaseAttributes;
  readonly equippedItemContentIds: readonly OpaqueId[];   // sorted unique
  readonly signatureAbilityIds: readonly OpaqueId[];      // [] in 4B3 (no hero spellbook state yet)
}

export interface HallRecord {
  readonly recordId: OpaqueId;            // deterministic: derived from run seed + content hash
  readonly heroName: string;
  readonly classTags: readonly string[];
  readonly completionType: CompletionType;
  readonly cause: RunConclusion['cause'];
  readonly deepestDepth: number;
  readonly score: ScoreBreakdown;
  readonly metrics: RunMetrics;           // copied snapshot
  readonly reputations: readonly FactionReputation[]; // finalized statistics
  readonly heirloom: RecordedHeirloomSnapshot;
  readonly build: FallenHeroBuildSnapshot; // engine facts feeding 4B1 standings normalization
  readonly runSeed: string;
  readonly contentHash: string;
}

export interface HallRecordEnrichment {
  readonly achievedAt: string;            // host-supplied ISO date; never engine-produced
  readonly portraitGlyph: string;         // host-supplied appearance; '@' default
}

export interface StoredHallRecord extends HallRecord {
  readonly enrichment: HallRecordEnrichment;
}

export interface HeartLineageRecord {
  readonly heroName: string;              // engine-validated at record time
  readonly classTags: readonly string[];
  readonly hallRecordId: OpaqueId;
  readonly enrichment: HallRecordEnrichment;
}

export interface AchievementGrant {
  readonly achievementId: OpaqueId;
  readonly criteriaId: AchievementCriteriaId;
  readonly name: string;
}

export interface LifetimeState {
  readonly conqueredChampionRecordIds: readonly OpaqueId[]; // sorted unique
  readonly grantedAchievementIds: readonly OpaqueId[];      // sorted unique
  readonly discoveryProtection: readonly DiscoveryProtectionBonus[]; // sorted by encounterId
  readonly totals: RunMetrics;
}

export interface LifetimeDeltas {
  readonly recordId: OpaqueId;            // idempotence key at the repository
  readonly newlyConqueredChampionRecordIds: readonly OpaqueId[];
  readonly achievementGrants: readonly AchievementGrant[];
  readonly discoveryProtectionUpdates: readonly DiscoveryProtectionUpdate[];
  readonly metrics: RunMetrics;           // this run's metrics, merged by the host
}

export function deriveHallRecordId(runSeed: Uint32State, contentHash: string): OpaqueId;
export function encodeRunSeed(runSeed: Uint32State): string; // 32 lowercase hex chars
```

`deriveHallRecordId` returns `` `record.${encodeRunSeed(runSeed)}.${contentHash.slice(0, 16)}` `` where `encodeRunSeed` concatenates each word as eight zero-padded lowercase hex digits. Host-enriched display fields stay outside `HallRecord`; the enrichment vocabulary is closed to exactly the achieved-at date and portrait/appearance, and lineage display combines it with the engine-validated hero name and class tags.

- [ ] **Step 5: Implement heirloom selection**

```ts
export function selectHeirloom(input: Readonly<{
  run: ActiveRun;                 // conclusion non-null (dead hero)
  content: CompiledContentPack;
  template: FallenChampionTemplateContentEntry;
  recordId: OpaqueId;
}>): Readonly<{ snapshot: RecordedHeirloomSnapshot; nextRunRecordsState: Uint32State }>;
```

Collect the dead hero's equipped item instances sorted by item ID; keep those whose definition has `heirloomEligible === true`, `equipment !== null`, positive `price` is not required, no `heirloom`/`quest`/`objective`/`nontransferable` tag, and no membership in `guaranteedUniqueItemIds(content)`. Weight each candidate with `template.heirloomSelection.rarityWeights[definition.rarity] + template.heirloomSelection.qualityRankBonus × qualityRank`, where `qualityRank` is the count of positive values in `instance.enchantment?.modifiers ?? {}`. Roll once with `rollDie(run.rng['run-records'], totalWeight)` and walk the cumulative weights. Record one unit: snapshot `contentId`, `sourceItemId: itemId`, `enchantment`, `condition`, `charges`, `fuel`, `qualityRank`, `displayName: definition.name`, `glyph`, `color`, `originatingHallRecordId: recordId`. With no eligible instance, return the fallback relic from `template.fallbackItemId` without consuming randomness (`nextRunRecordsState` equals the input state). Never reroll and never guarantee a minimum rarity.

- [ ] **Step 6: Run model suites and verify GREEN**

Run: `npm test --workspace @woven-deep/engine -- --run test/run-records-model.test.ts test/heirloom-selection.test.ts && npm run typecheck --workspace @woven-deep/engine`

Expected: all pass with deterministic selection and stream isolation.

- [ ] **Step 7: Commit the record model**

```bash
git add packages/engine/src packages/engine/test
git commit -m "feat: model hall records and heirloom selection"
```

---

### Task 7: Finalize runs exactly once with achievements and lifetime deltas

**Files:**
- Create: `packages/engine/src/run-finalize.ts`
- Create: `packages/engine/test/run-finalize.test.ts`
- Modify: `packages/engine/src/index.ts`

**Interfaces:**
- Consumes: `selectHeirloom`, `scoreRun`, `deriveHallRecordId`, `encodeRunSeed`, `HallRecord`/`LifetimeState`/`LifetimeDeltas`/`AchievementGrant`, `evaluateDiscoveryProtection`, `FallenHeroRunDecision`, `AchievementContentEntry`, and the `run.finalized`/`achievement.granted` events from Task 2.
- Produces: `finalizeRun(input)` — pure, finalize-once, consuming randomness only from `run-records`.

- [ ] **Step 1: Write failing finalization tests**

```ts
const finalized = finalizeRun({ run: concludedRun, content, lifetime: emptyLifetime });
expect(finalized.run.conclusion?.finalized).toBe(true);
expect(finalized.record.recordId).toBe(deriveHallRecordId(concludedRun.runSeed, concludedRun.contentHash));
expect(finalized.record.score.total).toEqual(scoreRun({ run: concludedRun, content }).total);
expect(finalized.events[0]).toMatchObject({ type: 'run.finalized', scoreTotal: finalized.record.score.total });
expect(() => finalizeRun({ run: finalized.run, content, lifetime: emptyLifetime })).toThrow(/finalized/);
expect(finalizeRun({ run: concludedRun, content, lifetime: emptyLifetime })).toEqual(finalized);
```

Cover, with table-driven lifetime/decision fixtures: an unconcluded run throws; a second call throws (finalize-once); byte-identical outputs for identical inputs; only `run-records` advances; the record copies metrics, reputations, hero name, sorted class tags, the build snapshot, `encodeRunSeed`, and the content hash; `deepestDepth` equals `metrics.deepestDepth`; the first-champion-defeat achievement is granted exactly when a retained `champion` decision is `defeated: true` and its `hallRecordId` is not in `lifetime.conqueredChampionRecordIds` and the achievement is not already in `lifetime.grantedAchievementIds`; the first-echo-defeat achievement is granted on the first lifetime `echo` decision defeat; already-granted achievements never regrant; `newlyConqueredChampionRecordIds` lists exactly the newly defeated champion record IDs; `discoveryProtectionUpdates` equal `evaluateDiscoveryProtection({ decisions: run.encounterDecisions, encounters })` sorted output; `deltas.metrics` equals the run metrics; `deltas.recordId` equals the record ID; events order is `run.finalized` first, then one `achievement.granted` per grant in sorted achievement-ID order.

- [ ] **Step 2: Run finalization tests and verify RED**

Run: `npm test --workspace @woven-deep/engine -- --run test/run-finalize.test.ts`

Expected: FAIL because `finalizeRun` does not exist.

- [ ] **Step 3: Implement finalization in the specified order**

```ts
export function finalizeRun(input: Readonly<{
  run: ActiveRun;               // conclusion non-null, finalized false
  content: CompiledContentPack;
  lifetime: LifetimeState;      // conquered champion IDs, granted achievement IDs, discovery protection, lifetime totals
}>): Readonly<{
  run: ActiveRun;               // finalized: true
  record: HallRecord;
  deltas: LifetimeDeltas;
  events: readonly DomainEvent[];
}>;
```

Guard: `conclusion === null` or `conclusion.finalized === true` → throw an invariant error. Steps, in order: (1) heirloom via `selectHeirloom` with `recordId = deriveHallRecordId(run.runSeed, run.contentHash)`; (2) score via `scoreRun`; (3) record assembly — `heroName: run.hero.name`, `classTags: []` sorted (heroes carry no class tags until character generation), `cause: conclusion.cause`, `build` from the dead hero's attributes and equipped item content IDs (sorted unique; `signatureAbilityIds: []`); (4) achievement evaluation against `run.fallenHeroDecisions` plus `lifetime`, resolving each granted criterion to its `AchievementContentEntry` (a defeated criterion with no authored achievement grants nothing); (5) `LifetimeDeltas` with the newly conquered champion record IDs, grants, `evaluateDiscoveryProtection` updates over the run's encounter decisions and the pack's encounters, and the run metrics; (6) events — one `run.finalized` (record ID, completion type, score total) followed by `achievement.granted` events, all hero-visible. Return `run` with `rng['run-records']` advanced and `conclusion.finalized: true`. Event IDs use `` `event.finalize.${record.recordId}` `` so identical inputs produce identical events. The engine never imports the repository; `LifetimeDeltas` is pure data the host applies.

- [ ] **Step 4: Run finalization suites and verify GREEN**

Run: `npm test --workspace @woven-deep/engine -- --run test/run-finalize.test.ts test/save-codec.test.ts`

Expected: all pass; the finalized run re-validates through the v6 decoder.

- [ ] **Step 5: Commit finalization**

```bash
git add packages/engine/src packages/engine/test
git commit -m "feat: finalize runs into hall records"
```

---

### Task 8: Add the run-record repository interface, in-memory implementation, and standings feed

**Files:**
- Create: `packages/engine/src/run-record-repository.ts`
- Create: `packages/engine/test/run-record-repository.test.ts`
- Modify: `packages/engine/src/index.ts`

**Interfaces:**
- Consumes: `StoredHallRecord`, `HeartLineageRecord`, `LifetimeState`, `LifetimeDeltas`, `compareHallRecords`, `FallenHeroStandingSnapshot`, and `RunMetrics` merging.
- Produces: `RunRecordRepository`, `createInMemoryRunRecordRepository()`, and `standingsFromRecords(records, limit)`.

- [ ] **Step 1: Write failing repository tests**

```ts
const repository = createInMemoryRunRecordRepository();
repository.appendRecord(storedRecordA);
expect(() => repository.appendRecord({ ...storedRecordA, heroName: 'Impostor' }))
  .toThrow(/immutable append-only Hall/);
repository.applyDeltas(deltas);
repository.applyDeltas(deltas);
expect(repository.lifetime().totals).toEqual(mergedOnce);
expect(repository.standings(10)[0]).toMatchObject({
  rank: 1, hallRecordId: storedRecordA.recordId, deathDepth: storedRecordA.cause.depth,
  heirloom: storedRecordA.heirloom, sourceContentHash: storedRecordA.contentHash,
});
```

Cover: `records()` returns an immutable snapshot in insertion order; duplicate record IDs are rejected; `standings(limit)` ranks only `died` records with a positive death depth by `compareHallRecords`, caps at `Math.min(limit, 10)`, assigns contiguous ranks from 1, and maps `attributes`/`equippedItemContentIds`/`signatureAbilityIds` from `record.build`, `portraitGlyph` from `enrichment.portraitGlyph`, and `classTags`/`heroName` from the record; a conquered record that remains the high scorer stays rank 1 (no promotion — retention is decided at run creation by 4B1); `currentHeart()` starts null; `recordHeart` replaces most-recent-wins with at most one current Heart; `applyDeltas` merges conquered IDs and achievement IDs as sorted unions, replaces discovery-protection bonuses by encounter ID with each update's `nextBonus`, merges metrics additively with checked addition except `deepestDepth` (maximum); reapplying deltas with an already-applied `recordId` changes nothing (idempotence).

- [ ] **Step 2: Run repository tests and verify RED**

Run: `npm test --workspace @woven-deep/engine -- --run test/run-record-repository.test.ts`

Expected: FAIL because the repository does not exist.

- [ ] **Step 3: Implement the interface and in-memory store**

```ts
export interface RunRecordRepository {
  standings(limit: number): readonly FallenHeroStandingSnapshot[];
  records(): readonly StoredHallRecord[];
  appendRecord(stored: StoredHallRecord): void;
  currentHeart(): HeartLineageRecord | null;
  recordHeart(record: HeartLineageRecord): void;
  lifetime(): LifetimeState;
  applyDeltas(deltas: LifetimeDeltas): void;
}

export function standingsFromRecords(
  records: readonly StoredHallRecord[], limit: number,
): readonly FallenHeroStandingSnapshot[];

export function createInMemoryRunRecordRepository(): RunRecordRepository;
```

`standingsFromRecords` filters `completionType === 'died' && cause.depth >= 1`, sorts with `compareHallRecords`, slices to `Math.min(limit, 10)`, and builds each snapshot: `rank: index + 1`, `hallRecordId: record.recordId`, `heroName`, `portraitGlyph: record.enrichment.portraitGlyph`, `classTags`, `attributes: record.build.attributes`, `equippedItemContentIds: record.build.equippedItemContentIds`, `signatureAbilityIds: record.build.signatureAbilityIds`, `deathDepth: record.cause.depth`, `sourceContentHash: record.contentHash`, `heirloom: record.heirloom`. The in-memory implementation keeps an applied-delta `recordId` set for idempotence and a single Heart slot where `recordHeart` overwrites (most-recent-wins; only `became-heart` completions will ever call it — nothing produces that type in 4B3, but the store and replacement rule are implemented and tested). Records are frozen copies; `appendRecord` rejects any `recordId` already present. This module is engine-adjacent pure TypeScript — no Node-only APIs, no clocks — so the browser boundary stays intact; guest (milestone 5) and profile (milestone 6) implementations replace it behind the same interface, and the server never accepts records or scores from the browser.

- [ ] **Step 4: Run repository suites and verify GREEN**

Run: `npm test --workspace @woven-deep/engine -- --run test/run-record-repository.test.ts test/browser-boundary.test.ts`

Expected: all pass and the production engine graph remains browser-safe.

- [ ] **Step 5: Commit the repository**

```bash
git add packages/engine/src packages/engine/test
git commit -m "feat: add run record repository"
```

---

### Task 9: Project metrics, conclusion, and finalization safely

**Files:**
- Modify: `packages/engine/src/projection.ts`
- Modify: `packages/engine/src/event-projection.ts`
- Modify: `packages/engine/src/model.ts`
- Create: `packages/engine/test/run-records-projection.test.ts`
- Modify: `packages/engine/test/projection.test.ts`
- Modify: `packages/engine/test/event-projection.test.ts`

**Interfaces:**
- Consumes: `GameplayProjection`, `projectGameplayState`, `projectDomainEvents`, `RunMetrics`, `RunConclusion`, `HallRecord`, `ScoreBreakdown`, `RecordedHeirloomSnapshot`, and `AchievementGrant`.
- Produces: `GameplayProjection.metrics` and `GameplayProjection.conclusion`, `RunConclusionProjection`, `projectRunConclusion(input)`, and hero-visible run-record event passthrough.

- [ ] **Step 1: Write failing gameplay-projection tests**

Assert the pre-conclusion gameplay projection exposes the exact current metrics read-only to the controlling hero (they are facts the hero already witnessed) and `conclusion: null`; after conclusion it exposes `{ completionType, cause }`. Assert no metric reveals hidden state existing projections redact and that random state, standings internals, decisions, and other heroes' records never project:

```ts
const projected = projectGameplayState({ state: livingRun, content });
expect(projected.metrics).toEqual(livingRun.metrics);
expect(projected.conclusion).toBeNull();
const projectedJson = JSON.stringify(projected);
for (const field of ['run-records', 'fallenHeroStandings', 'fallenHeroDecisions',
  'encounterDecisions', 'concludedAtRevision']) {
  expect(projectedJson).not.toContain(field);
}
```

- [ ] **Step 2: Write failing conclusion-projection and event tests**

```ts
const conclusionProjection = projectRunConclusion({
  run: finalized.run, record: finalized.record, achievements: grants,
});
expect(conclusionProjection).toMatchObject({
  completionType: 'died', finalized: true,
  score: finalized.record.score, heirloom: finalized.record.heirloom,
  metrics: finalized.run.metrics, achievements: grants,
});
expect(projectRunConclusion({ run: concludedRun, record: null, achievements: [] }))
  .toMatchObject({ finalized: false, score: null, heirloom: null });
expect(projectRunConclusion({ run: livingRun, record: null, achievements: [] })).toBeNull();
```

In `event-projection.test.ts`, assert `run.concluded`, `run.finalized`, and `achievement.granted` pass through to the controlling hero unchanged, and that a mismatched record (different `recordId` provenance than the run derives) throws.

- [ ] **Step 3: Run projection tests and verify RED**

Run: `npm test --workspace @woven-deep/engine -- --run test/run-records-projection.test.ts test/projection.test.ts test/event-projection.test.ts`

Expected: FAIL because the metrics and conclusion projections are absent.

- [ ] **Step 4: Implement the projection contract**

```ts
export interface RunConclusionProjection {
  readonly completionType: CompletionType;
  readonly cause: RunConclusion['cause'];
  readonly metrics: RunMetrics;
  readonly finalized: boolean;
  readonly score: ScoreBreakdown | null;                 // full breakdown once finalized
  readonly heirloom: RecordedHeirloomSnapshot | null;    // once finalized
  readonly achievements: readonly AchievementGrant[];
}

export function projectRunConclusion(input: Readonly<{
  run: ActiveRun;
  record: HallRecord | null;      // host supplies the finalizeRun output; null before finalization
  achievements: readonly AchievementGrant[];
}>): RunConclusionProjection | null;
```

Return `null` while `run.conclusion` is null. Once concluded — the run is over, nothing is hidden-state — expose the completion type, cause, metrics snapshot, and, when `record` is supplied and its `recordId` equals `deriveHallRecordId(run.runSeed, run.contentHash)` (else throw), the full score breakdown, heirloom, and granted achievements. Extend `GameplayProjection` with `readonly metrics: RunMetrics;` and `readonly conclusion: Readonly<{ completionType: CompletionType; cause: RunConclusion['cause'] }> | null;`, populated in `projectGameplayState`. In `projectDomainEvents`, add `case 'run.concluded': case 'run.finalized': case 'achievement.granted': output.push(event); break;` — the controlling hero always receives them; standings internals and other heroes' records have no projection path.

- [ ] **Step 5: Run projection suites and verify GREEN**

Run: `npm test --workspace @woven-deep/engine -- --run test/run-records-projection.test.ts test/projection.test.ts test/event-projection.test.ts test/browser-boundary.test.ts`

Expected: all pass and the production engine graph remains browser-safe.

- [ ] **Step 6: Commit projection contracts**

```bash
git add packages/engine/src packages/engine/test
git commit -m "feat: project run conclusion safely"
```

---

### Task 10: Prove replay, properties, demonstration, docs, roadmap, and release gates

**Files:**
- Create: `packages/engine/src/run-records-fixture.ts`
- Create: `packages/engine/test/run-records-replay.test.ts`
- Create: `packages/engine/test/run-records-properties.test.ts`
- Create: `scripts/run-records-demo.mjs`
- Create: `packages/engine/test/fixtures/run-records-demo-hashes.json`
- Create: `packages/engine/test/run-records-cli.test.ts`
- Create: `docs/operations/run-records.md`
- Modify: `packages/engine/src/index.ts`
- Modify: `packages/engine/test/arbitraries.ts`
- Modify: `packages/content/test/admin-docs.test.ts`
- Modify: `docs/server-admin/content-configuration.md`
- Modify: `docs/superpowers/plans/2026-07-13-implementation-roadmap.md`
- Modify: `package.json`
- Modify: `scripts/smoke-runner.mjs`
- Modify: `Dockerfile`

**Interfaces:**
- Consumes: the complete schema-v5 content and schema-v6 run-records engine vertical slice from Tasks 1–9, `runMerchantDemo` fixture patterns, and the merchant demo hash-pinning precedent.
- Produces: continuous/split finalization proof, a 512-seed invariant suite, `runRunRecordsDemo` with `RUN_RECORDS_REPLAY_BOUNDARIES`, a deterministic terminal demonstration with reviewed hashes, complete docs, the roadmap amendment, and release/Docker gates that keep every existing demo.

- [ ] **Step 1: Write failing split-replay coverage**

Build `run-records-fixture.ts` following the merchant-fixture pattern: `RUN_RECORDS_REPLAY_BOUNDARIES = ['before-group-fight', 'before-swarm', 'before-boss', 'before-trade', 'before-merchant-attack', 'before-death', 'before-finalize'] as const`, `RunRecordsDemoRecord`/`RunRecordsDemoResult` mirroring `MerchantDemoRecord`/`MerchantDemoResult` plus a `finalization: { record: HallRecord; deltas: LifetimeDeltas; events: readonly DomainEvent[] } | null` field, `createRunRecordsDemoRun(pack)`, `runRunRecordsDemo(pack, splitBoundaries?)`, and `runRecordsDemoEquivalent(left, right)`. The scenario fights a leader group, contains or flees a swarm, encounters a rare boss, trades with and then attacks a travelling merchant, dies, and finalizes through `finalizeRun` with an in-memory repository. In `run-records-replay.test.ts`, compare continuous execution with save/reload boundaries before and after every transition:

```ts
expect(encodeActiveRun(split.state)).toBe(encodeActiveRun(continuous.state));
expect(stableJson(split.finalization?.record)).toBe(stableJson(continuous.finalization?.record));
expect(stableJson(split.records.map((entry) => entry.projection)))
  .toBe(stableJson(continuous.records.map((entry) => entry.projection)));
```

Byte-identical final saves, records, deltas, authoritative events, public events, and projections after `finalizeRun` on both sides.

- [ ] **Step 2: Add 512-seed mixed-system properties**

In `run-records-properties.test.ts`, generate valid content within compiler bounds and mixed ordinary/trade command sequences. After every accepted command assert: schema-v6 validity; every metric a non-negative safe integer; metric monotonicity (no counter decreases, `deepestDepth` never falls); `kills >=` the `killsByModel` sum; conclusion consistency (dead hero ⟺ non-null conclusion, `died` completion, cause bounds); no command accepted after conclusion (every result is `invalid`/`run.concluded` or `rejected`); finalize-once (second `finalizeRun` throws); record determinism (`finalizeRun` twice from the same save is deep-equal); heirloom eligibility invariants (recorded `sourceItemId` was equipped, never backpack, never an excluded tag or boss unique); score non-negativity and breakdown-total equality (`total === lines.reduce(sum)`); delta idempotence at the repository (`applyDeltas` twice equals once); hidden projection contains no run-records stream, decisions, or standings fields; split-replay equality. Configure `numRuns: 512` with shrinking enabled; every shrunk counterexample becomes a fixed regression before implementation changes.

- [ ] **Step 3: Run replay/properties and verify GREEN**

Run: `npm test --workspace @woven-deep/engine -- --run test/run-records-replay.test.ts test/run-records-properties.test.ts`

Expected: all replay examples and 512 seeded property runs pass with shrinking enabled.

- [ ] **Step 4: Build the deterministic exit demo**

Add `"run-records:demo": "npm run build --workspace @woven-deep/content && npm run build --workspace @woven-deep/engine && node scripts/run-records-demo.mjs --verify"` to `package.json`. The script mirrors `scripts/merchant-demo.mjs` (`--verify`, `--hashes-only`, `--content-dir` arguments; sha-256 over `encodeActiveRun`, event arrays, and projections; a second `spawnSync` process compares hashes): it compiles bundled content, runs `runRunRecordsDemo` continuous and fully split, and proves the milestone — the automated simulation fights a leader group, contains or flees a swarm, encounters a rare boss, trades with and attacks a travelling merchant, dies (`run.concluded` with completion type `died` and killer credit), finalizes exactly once, and prints only observable data: the itemized score breakdown and total, the metrics snapshot, the heirloom snapshot, granted achievements, the Hall record ID, ranked standings from the in-memory repository, and the (empty) Heart lineage. It asserts a `recordHash = sha256(stableJson(record))` matches between processes, that the transcript never contains `fallenHeroDecisions`, `concludedAtRevision`, `run-records`, or any raw stream state, and that split execution is equivalent.

- [ ] **Step 5: Review and store demo hashes**

Run: `npm run run-records:demo`

Expected: the script prints stable nonempty `saveHash`, `eventHash`, `projectionHash`, and `recordHash` values twice and exits zero. Inspect the transcript for every exit-demo claim (group fight, swarm, boss, trade, merchant attack, death, single finalization, score/record/lineage output), then store those exact hashes in `packages/engine/test/fixtures/run-records-demo-hashes.json`. Write `run-records-cli.test.ts` following `merchant-cli.test.ts`: two `--verify` processes produce identical stdout containing the reviewed hashes, hidden fields never print, a drifted content directory fails with `reviewed run records demo hashes do not match`, and unknown arguments fail without a stack trace.

- [ ] **Step 6: Document authoring and client contracts**

Extend `docs/server-admin/content-configuration.md` with the achievement kind (fields, criteria registry values, one-achievement-per-criterion rule), score coefficients (every field, integer bounds, the turn-efficiency budget/decay formula), monster `threat`, the content v5 and save v6 migrations, and the bundled achievement names. Create `docs/operations/run-records.md` covering the client contract: `run.concluded` rejection of every post-conclusion command, the `run.concluded`/`run.finalized`/`achievement.granted` events, the finalization flow (`finalizeRun` inputs/outputs, finalize-once), the `RunRecordRepository` responsibilities, and host enrichment limited to exactly the achieved-at date and portrait/appearance attached at persistence time. Extend `admin-docs.test.ts` so `achievement`, `first-champion-defeat`, `first-echo-defeat`, `score`, and `threat` must appear in the docs.

- [ ] **Step 7: Update the roadmap and release gates**

In `docs/superpowers/plans/2026-07-13-implementation-roadmap.md`: mark **4B3 run records — complete** with links to `docs/superpowers/specs/2026-07-15-run-records-design.md` and this plan; amend milestone 7 per the superseding endgame requirements — the Heart of the Deep is a living person, not an artifact; replace "the Heart of the Deep return journey" with a **Final Chamber and endings** milestone that implements the Final Chamber encounter, the ending choices producing the `became-heart`, `refused`, and `broke-cycle` completion types, ending dialogue, lore prerequisites, and the Break-the-Cycle unlock content, wiring triggers into the 4B3 finalization pipeline; update milestone 7's exit demonstration from "recover the Heart, escape or die" to reaching the Final Chamber and finalizing each ending choice into its completion-type tier. Add the run-records demo to the gates: append `&& npm run run-records:demo` to the Dockerfile verification `RUN` line after `npm run merchant:demo`, and extend `scripts/smoke-runner.mjs` `verifyOnce` to require at least one served `kind === 'achievement'` entry alongside the existing merchant checks. Keep every existing engine/dungeon/gameplay/population/merchant gate.

- [ ] **Step 8: Run full verification**

Run, in order:

```bash
npm test
npm run typecheck
npm run build
npm run content:validate
npm run content:startup-gate
npm run run-records:demo
npm run merchant:demo
npm run population:demo
npm run gameplay:demo
npm run dungeon:demo
npm run smoke
docker compose build
docker compose up -d
docker compose ps
curl -fsS http://localhost:3000/api/health
docker compose down
git diff --check
git status --short
```

Expected: all tests, 512 seeded simulations, typecheck, build, content gates, every deterministic demo (existing demos re-pin their reviewed hashes for the v5 content and v6 save formats within their own fixtures if their hashes drift — inspect each transcript before storing), smoke, and Docker health pass; final Git status contains only the intended Task 10 changes before commit.

- [ ] **Step 9: Commit milestone verification**

```bash
git add packages scripts docs package.json Dockerfile
git commit -m "feat: complete run records milestone"
```

- [ ] **Step 10: Request final review**

Run the `superpowers:requesting-code-review` workflow against the complete branch diff from its merge base. Resolve every confirmed issue with a failing regression test, rerun the affected focused suite and the full verification block, then use `superpowers:verification-before-completion` before reporting 4B3 complete.
