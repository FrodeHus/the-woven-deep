# Core Gameplay and Survival Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Milestone 4A's deterministic tactical loop: actors, integer-energy scheduling, combat and reactions, inventory and equipment, identification, survival resources, mutable dungeon features, rest, safe projection, and exact replay.

**Architecture:** Preserve `resolveCommand` as the pure public boundary while decomposing resolution into focused browser-safe modules. Replace the pre-release save and content shapes with active-run schema v3 and compiled-content schema v2, then route YAML-authored mechanics through strict registered behaviors and effects.

**Tech Stack:** TypeScript 5.8+, Node.js 22.12+, Zod 4, YAML 2.8, ROT.js 2.2.1, Vitest 3.2, fast-check 4.8.0, SQLite/Fastify/React integration gates, Docker Compose.

## Global Constraints

- Follow `docs/superpowers/specs/2026-07-13-core-gameplay-survival-design.md` exactly; changes to approved rules require a design amendment before implementation.
- The engine remains browser-safe and never imports React, Fastify, SQLite, browser storage, Node-only APIs, or ambient clocks and randomness.
- `resolveCommand` remains pure: no input mutation, I/O, global state, wall-clock reads, or untracked random calls.
- Only active-run schema v3 is accepted after Task 1; v0, v1, and v2 migration code and fixtures are removed and unsupported versions fail clearly.
- Only source and compiled content schema v2 is accepted after Task 2; all bundled YAML is converted in that task and schema v1 fails clearly.
- All gameplay arithmetic uses checked safe integers. Random consumption stays isolated to the existing named stream assigned to the subsystem.
- Orthogonal and diagonal movement both cost one normal action; diagonal movement cannot pass between two blocking orthogonal cells.
- Opportunity attacks are symmetric, require awareness and current hostility, and never apply to neutral actors until hostility is established.
- Backpack capacity counts stacks, equipped items consume no backpack slots, and carried light normally occupies a hand.
- Hunger and fuel advance from dungeon `worldTime`; town time is outside this milestone and consumes neither.
- Unknown identities, actors, features, geometry, future rolls, and private scheduler state never enter player projections or decision descriptors.
- New content behavior composes registered TypeScript mechanics; YAML contains no scripts, expressions, executable tags, or unvalidated behavior parameters.
- Use current maintained packages when they satisfy the exact contract. The small scheduler and die roller stay project-owned because their state transitions are versioned replay behavior.
- Do not use the disallowed technical term noted in project guidance; use stable, authoritative, primary, or content-hash wording as appropriate.
- Every task follows RED/GREEN TDD, runs its focused suite and affected package suite, ends with a clean commit, and receives a task review before the next task begins.

## File and responsibility map

### Content package

- `packages/content/src/model.ts`: public schema-v2 compiled content types.
- `packages/content/src/content-schema.ts`: browser-safe strict validation of stored or transferred compiled schema-v2 packs.
- `packages/content/src/compiler/schema.ts`: strict source schemas for monsters, items, spells, traps, loot tables, vaults, and balance.
- `packages/content/src/compiler/registries.ts`: compiler-visible behavior, targeting, and effect parameter contracts.
- `packages/content/src/compiler/content-validation.ts`: cross-reference, equipment, identification-pool, loot-cycle, and foundational-pool checks.
- `packages/content/src/compiler/compile-directory.ts`: deterministic file collection, global validation, stable compilation, and hash generation.
- `content/monsters/*.yaml`, `content/items/*.yaml`, `content/spells/*.yaml`, `content/traps/*.yaml`, `content/loot-tables/*.yaml`, `content/balance/*.yaml`: bundled proof content.

### Engine model and persistence

- `packages/engine/src/model.ts`: run envelope, command/result/event unions, shared identifiers, and re-exports of focused gameplay types.
- `packages/engine/src/actor-model.ts`: actors, attributes, derived statistics, relationships, awareness, health, and conditions.
- `packages/engine/src/item-model.ts`: item instances, locations, equipment slots, inventory, and identification state.
- `packages/engine/src/feature-model.ts`: door, trap, secret, and discovery state.
- `packages/engine/src/survival-model.ts`: hunger, fuel thresholds, recovery, and rest stop reasons.
- `packages/engine/src/save-schema.ts`: strict schema-v3 validation and cross-record invariants.
- `packages/engine/src/content-bound-validation.ts`: cross-checks a structurally valid run against its exact compiled content pack.

### Engine resolution

- `packages/engine/src/attributes.ts`: pure derived-stat calculation.
- `packages/engine/src/scheduler.ts`: ready-actor selection, checked energy changes, and world-time advancement.
- `packages/engine/src/actions.ts`: authoritative command-to-action validation and typed decision requests.
- `packages/engine/src/movement.ts`: eight-way deltas, corner checks, occupancy, and bump attacks.
- `packages/engine/src/targeting.ts`: range and trajectory validation without hidden-state disclosure.
- `packages/engine/src/effects.ts`: registered effect parameter validation and pure ordered resolution.
- `packages/engine/src/combat.ts`: d20 attack, structured damage, mitigation, healing, and death.
- `packages/engine/src/reactions.ts`: hostility-aware opportunity eligibility, ordering, and recovery.
- `packages/engine/src/inventory.ts`: pickup, drop, split, merge, location, and capacity transitions.
- `packages/engine/src/equipment.ts`: slot compatibility, handedness, displacement, and derived equipment effects.
- `packages/engine/src/identification.ts`: appearance allocation and knowledge transitions.
- `packages/engine/src/survival.ts`: time-based hunger, fuel, conditions, recovery, and warnings.
- `packages/engine/src/features.ts`: doors, passive discovery, Search, disarm, trap trigger, and secret reveal.
- `packages/engine/src/rest.ts`: bounded repeated world-step execution and stop conditions.
- `packages/engine/src/world-step.ts`: atomic orchestration from validated hero action back to the next hero decision boundary.
- `packages/engine/src/reducer.ts`: deduplication/revision shell delegating applied gameplay to `world-step.ts`.
- `packages/engine/src/projection.ts`: gameplay projection and action previews.
- `packages/engine/src/event-projection.ts`: visibility-aware public event redaction.

### Verification and demonstrations

- `packages/engine/test/*.test.ts`: focused model, schema-version, scheduler, action, combat, item, survival, feature, projection, and replay suites.
- `packages/content/test/*.test.ts`: source-schema, compiler, and bundled-content tests.
- `packages/engine/test/fixtures/gameplay-demo-hashes.json`: expected terminal demonstration hashes.
- `packages/engine/test/arbitraries.ts`: fast-check generators for valid gameplay snapshots and commands.
- `scripts/gameplay-demo.mjs`: cross-save combat and survival demonstration.
- `package.json`: root `gameplay:demo` command.
- `Dockerfile`: production build gate invokes the new demonstration.

---

### Task 1: Replace the pre-release save shape with active-run schema v3

**Files:**
- Create: `packages/engine/src/actor-model.ts`
- Create: `packages/engine/src/item-model.ts`
- Create: `packages/engine/src/feature-model.ts`
- Create: `packages/engine/src/survival-model.ts`
- Modify: `packages/engine/src/model.ts`
- Modify: `packages/engine/src/save-schema.ts`
- Modify: `packages/engine/src/save-codec.ts`
- Modify: `packages/engine/src/save-error.ts`
- Modify: `packages/engine/src/versions.ts`
- Modify: `packages/engine/src/fixture.ts`
- Modify: `packages/engine/src/generated-fixture.ts`
- Modify: `packages/engine/src/index.ts`
- Modify: `packages/engine/test/model.test.ts`
- Modify: `packages/engine/test/save-codec.test.ts`
- Delete: `packages/engine/src/save-schema-v1.ts`
- Delete: `packages/engine/src/migration.ts`
- Delete: `packages/engine/test/migration.test.ts`
- Delete: `packages/engine/test/fixtures/v0-save.json`
- Delete: `packages/engine/test/fixtures/v1-migrated-save.json`
- Delete: `packages/engine/test/fixtures/v2-migrated-save.json`

**Interfaces:**
- Consumes: existing `ActiveRun`, `FloorSnapshot`, `Uint32State`, save codec, generated fixtures, and typed save errors.
- Produces: `ActorState`, `ItemInstance`, `DungeonFeature`, `SurvivalState`, schema-v3 `ActiveRun`, `validateActiveRun(input)`, and strict unsupported-version decoding.

- [ ] **Step 1: Write failing schema-v3 model tests**

Replace the current format directly. Add tests that require the v3 fields and exact ordering:

```ts
it('stores gameplay state in schema v3', () => {
  const run = createDemoRun();
  expect(run.schemaVersion).toBe(3);
  expect(run.worldTime).toBe(0);
  expect(run.actors.map((actor) => actor.actorId)).toEqual(['hero.demo']);
  expect(run.items).toEqual([]);
  expect(run.identification.appearanceByContentId).toEqual({});
  expect(run.hero.actorId).toBe('hero.demo');
});

it('rejects duplicate actor and item identifiers', () => {
  const run = createDemoRun();
  expect(() => validateActiveRun({ ...run, actors: [run.actors[0], run.actors[0]] }))
    .toThrow(/actors\.1\.actorId.*strictly increasing/i);
});
```

- [ ] **Step 2: Run the model and save tests to verify RED**

Run: `npm test --workspace @woven-deep/engine -- --run test/model.test.ts test/save-codec.test.ts`

Expected: FAIL because schema v3 types, fields, and `SAVE_SCHEMA_VERSION = 3` do not exist.

- [ ] **Step 3: Add focused immutable gameplay model types**

Define the initial published contracts without adding behavior:

```ts
export type AttributeName = 'might' | 'agility' | 'vitality' | 'wits' | 'resolve';
export type Disposition = 'friendly' | 'neutral' | 'hostile';
export interface BaseAttributes { readonly might: number; readonly agility: number; readonly vitality: number; readonly wits: number; readonly resolve: number; }
export interface ActorState {
  readonly actorId: OpaqueId;
  readonly contentId: OpaqueId;
  readonly playerControlled: boolean;
  readonly floorId: OpaqueId;
  readonly x: number;
  readonly y: number;
  readonly attributes: BaseAttributes;
  readonly health: number;
  readonly maxHealth: number;
  readonly energy: number;
  readonly speed: number;
  readonly reactionReady: boolean;
  readonly disposition: Disposition;
  readonly awareActorIds: readonly OpaqueId[];
  readonly conditions: readonly ConditionState[];
}
```

Add equally strict `ItemInstance`, typed item locations, concrete door/trap/secret `DungeonFeature` records, hunger state, identification map, equipment map, and hero actor reference. Feature and item collections may be empty in new fixtures. Rewrite fixture closed-door terrain as door records where the fixture needs a door. Sort every identifier-bearing array by UTF-16 code-unit order before publication.

Extend `RecordedCommand` with `publicEvents`. Schema-v3 producers save authoritative `events` and already-redacted `publicEvents` together so duplicate command IDs can return the exact same observable result later.

- [ ] **Step 4: Build strict schema-v3 parsing and cross-record validation**

Set `SAVE_SCHEMA_VERSION = 3`. Make `save-schema.ts` validate every field and then enforce:

```ts
validateOrderedIds(run.actors.map((actor) => actor.actorId), 'actors', 'actor', 'actorId');
validateOrderedIds(run.items.map((item) => item.itemId), 'items', 'item', 'itemId');
if (!run.actors.some((actor) => actor.actorId === run.hero.actorId && actor.playerControlled)) {
  fail('hero.actorId', 'hero must reference one player-controlled actor');
}
```

Validate safe integers, actor positions, item location uniqueness, equipment references, active-floor ownership, health bounds, energy bounds, awareness ordering, feature ownership, and no overlap between a living actor and another living actor on the same cell.

- [ ] **Step 5: Write failing unsupported-version decoding tests**

```ts
it.each([0, 1, 2, 4])('rejects unsupported schema version %i without partial state', (schemaVersion) => {
  try {
    decodeActiveRun(JSON.stringify({ schemaVersion }));
    expect.fail('expected unsupported version');
  } catch (error) {
    expect(error).toMatchObject({ kind: 'unsupported_version', path: 'schemaVersion' });
  }
});
```

Run: `npm test --workspace @woven-deep/engine -- --run test/save-codec.test.ts`

Expected: FAIL until decoding distinguishes unsupported versions before strict v3 validation.

- [ ] **Step 6: Remove legacy migration code and reject unsupported versions**

Delete `save-schema-v1.ts`, `migration.ts`, their tests, and the three old save fixtures. Remove `migration_failed` from `SaveLoadErrorKind`. Make `decodeActiveRun` parse JSON, inspect `schemaVersion`, return `unsupported_version` unless it equals `3`, and then call `validateActiveRun` exactly once.

- [ ] **Step 7: Rewrite all engine fixtures and run GREEN**

Update `createDemoRun`, `createGeneratedDemoRun`, checked-in generated fixtures, and every direct test state to construct v3 state. Do not retain compatibility builders.

Run: `npm test --workspace @woven-deep/engine -- --run test/model.test.ts test/save-codec.test.ts test/replay.test.ts test/generated-replay.test.ts`

Expected: PASS with direct schema-v3 save and replay assertions plus typed unsupported-version failures.

- [ ] **Step 8: Run the engine package gate and commit**

Run: `npm test --workspace @woven-deep/engine && npm run typecheck --workspace @woven-deep/engine && npm run build --workspace @woven-deep/engine`

Expected: all existing and new engine tests pass; typecheck and build exit 0.

Commit:

```bash
git add packages/engine
git commit -m "feat: replace active runs with gameplay state"
```

---

### Task 2: Replace the pre-release content shape with schema v2

**Files:**
- Create: `packages/content/src/compiler/registries.ts`
- Create: `packages/content/src/compiler/content-validation.ts`
- Create: `packages/content/src/content-schema.ts`
- Modify: `packages/content/src/model.ts`
- Modify: `packages/content/src/index.ts`
- Modify: `packages/content/src/compiler/schema.ts`
- Modify: `packages/content/src/compiler/parse-file.ts`
- Modify: `packages/content/src/compiler/compile-directory.ts`
- Modify: `packages/content/src/compiler/index.ts`
- Modify: `content/monsters/cave-rat.yaml`
- Modify: `content/items/brass-lantern.yaml`
- Modify: `content/vaults/lampwright-cache.yaml`
- Create: `content/balance/core-gameplay.yaml`
- Modify: `apps/server/src/content-repository.ts`
- Modify: `apps/server/test/content-repository.test.ts`
- Modify: `apps/server/test/app.test.ts`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/test/api.test.ts`
- Modify: `apps/web/test/App.test.tsx`
- Modify: `packages/content/test/model.test.ts`
- Modify: `packages/content/test/parse-file.test.ts`
- Modify: `packages/content/test/compile-directory.test.ts`

**Interfaces:**
- Consumes: deterministic compiler ordering, stable JSON hashing, and current monster/item/vault definitions.
- Produces: schema-v2 `CompiledContentPack`, `validateCompiledContentPack(input)`, strict source-v2 parsing, `TARGETING_REGISTRY`, `EFFECT_PARAMETER_SCHEMAS`, cross-reference validation, validated SQLite reads, and seven-kind web summaries with typed unsupported-version failures.

- [x] **Step 1: Write failing public-model and version-rejection tests**

```ts
it('exposes every schema-v2 content kind', () => {
  const kinds: ContentKind[] = ['monster', 'item', 'spell', 'trap', 'loot-table', 'balance', 'vault'];
  expect(kinds).toHaveLength(7);
});

it('rejects source schema v1 with a stable version diagnostic', () => {
  expect(() => parseContentFile({ path: 'legacy.yaml', source: 'schemaVersion: 1\nentries: []\n' }))
    .toThrow(/legacy\.yaml.*schemaVersion.*expected 2/i);
});

it('rejects a stored schema-v1 pack before exposing entries', () => {
  expect(() => validateCompiledContentPack({ schemaVersion: 1, hash: '0'.repeat(64), entries: [] }))
    .toThrow(/unsupported content schema version 1/i);
});
```

- [x] **Step 2: Run content tests to verify RED**

Run: `npm test --workspace @woven-deep/content -- --run test/model.test.ts test/parse-file.test.ts`

Expected: FAIL because schema-v2 kinds and strict version rejection are absent.

- [x] **Step 3: Define structured schema-v2 content contracts**

Set `CONTENT_SCHEMA_VERSION = 2` and define shared structures such as:

```ts
export interface DiceDefinition { readonly count: number; readonly sides: number; readonly bonus: number; }
export interface EffectDefinition { readonly effectId: string; readonly parameters: Readonly<Record<string, unknown>>; }
export interface MonsterContentEntry extends BaseContentEntry {
  readonly kind: 'monster';
  readonly attributes: BaseAttributeDefinition;
  readonly health: number;
  readonly speed: number;
  readonly accuracy: number;
  readonly defense: number;
  readonly perception: number;
  readonly damage: DiceDefinition;
  readonly armor: number;
  readonly resistances: Readonly<Record<DamageType, number>>;
  readonly disposition: 'friendly' | 'neutral' | 'hostile';
  readonly behaviorId: string;
  readonly behaviorParameters: Readonly<Record<string, unknown>>;
  readonly runAppearanceChance: number;
}
```

Add explicit item, spell, trap, loot-table, balance, and existing vault interfaces. Keep content data readonly and JSON-compatible. Implement `validateCompiledContentPack` with a strict discriminated Zod union and an early typed version check so stored content never reaches runtime resolution unvalidated.

- [x] **Step 4: Convert current bundled content and compiled output directly**

Convert the cave rat, brass lantern, Lampwright Cache, and a baseline core-gameplay balance file to `schemaVersion: 2` with complete strict fields. `compileContentDirectory` emits only `CompiledContentPack { schemaVersion: 2, hash, entries, generationReport }`. Any source or stored pack with another version is rejected; no adapter or compatibility defaults exist. Update every typed web and server pack fixture directly to schema v2.

- [x] **Step 5: Write failing strict schema-v2 parser tests**

Cover one valid source file per new kind and exact invalid cases:

```ts
it.each([
  ['dice count', 'entries.0.damage.count'],
  ['unknown targeting rule', 'entries.0.targetingId'],
  ['inconsistent handedness', 'entries.0.handedness'],
  ['negative action cost', 'entries.0.actionCost'],
])('rejects invalid %s with a stable path', (_name, path) => {
  expect(() => parseContentFile(invalidFixture(_name))).toThrow(new RegExp(path.replaceAll('.', '\\.')));
});
```

Run: `npm test --workspace @woven-deep/content -- --run test/parse-file.test.ts test/compile-directory.test.ts`

Expected: FAIL because source schema v2 and registry validation do not exist.

- [x] **Step 6: Implement strict parsing and first-pass semantic checks**

Accept source file `schemaVersion: 2` only. Use strict Zod objects with safe integer bounds. Add registries containing the initial stable identifiers and parameter schemas:

```ts
export const TARGETING_REGISTRY = ['target.self', 'target.actor', 'target.line', 'target.cell'] as const;
export const EFFECT_PARAMETER_SCHEMAS = {
  'effect.damage': z.strictObject({ damageType: z.enum(DAMAGE_TYPES), dice: diceSchema }),
  'effect.heal': z.strictObject({ dice: diceSchema }),
  'effect.condition.apply': z.strictObject({ conditionId: stableIdSchema, duration: safePositive }),
  'effect.condition.remove': z.strictObject({ conditionId: stableIdSchema }),
  'effect.force-move': z.strictObject({ distance: z.number().int().safe().min(1).max(8) }),
  'effect.reveal': z.strictObject({ radius: z.number().int().safe().min(1).max(32) }),
  'effect.fuel.transfer': z.strictObject({ maximum: safePositive }),
  'effect.light.toggle': z.strictObject({ enabled: z.boolean() }),
  'effect.item.consume': z.strictObject({ quantity: safePositive }),
  'effect.feature.mutate': z.strictObject({ state: stableIdSchema }),
} as const;
```

Validate effect parameters, references, equipment/handedness combinations, identification group compatibility, strictly positive loot weights, acyclic nested loot tables, one balance entry, and deterministic sorted diagnostics. Make `ContentPackRepository.get` parse stored JSON through `validateCompiledContentPack` rather than a type assertion. Make the browser-safe API parser do the same before counting all seven content kinds, including zero counts.

- [x] **Step 7: Run content GREEN and commit**

Run: `npm test --workspace @woven-deep/content && npm run build --workspace @woven-deep/content && npm test --workspace @woven-deep/server && npm test --workspace @woven-deep/web && npm run typecheck && npm run build`

Expected: content, server, and web suites pass; every workspace type-checks and builds. Schema-v1 source and stored packs fail with deterministic version diagnostics.

Commit:

```bash
git add packages/content content/monsters/cave-rat.yaml content/items/brass-lantern.yaml content/vaults/lampwright-cache.yaml content/balance/core-gameplay.yaml apps/server/src/content-repository.ts apps/server/test/content-repository.test.ts apps/server/test/app.test.ts apps/web/src/api.ts apps/web/test/api.test.ts apps/web/test/App.test.tsx
git commit -m "feat: replace content with gameplay schema"
```

---

### Task 3: Add derived attributes and the integer-energy scheduler

**Files:**
- Create: `packages/engine/src/attributes.ts`
- Create: `packages/engine/src/scheduler.ts`
- Modify: `packages/engine/src/index.ts`
- Modify: `packages/engine/package.json`
- Modify: `package-lock.json`
- Create: `packages/engine/test/attributes.test.ts`
- Create: `packages/engine/test/scheduler.test.ts`
- Create: `packages/engine/test/arbitraries.ts`
- Create: `packages/engine/test/gameplay-properties.test.ts`

**Interfaces:**
- Consumes: schema-v3 `ActorState`, runtime balance content, stable actor ordering, and safe-integer rules.
- Produces: `deriveActorStats(input)`, `selectReadyActor(actors)`, `advanceToNextReady(input)`, `chargeActionEnergy(actor, cost)`, and reusable fast-check actor/run generators.

- [x] **Step 1: Install the exact property-testing dependency**

Run: `npm install --save-dev fast-check@4.8.0 --workspace @woven-deep/engine`

Expected: `packages/engine/package.json` records `fast-check` in `devDependencies` and `package-lock.json` resolves 4.8.0.

- [x] **Step 2: Write failing derived-stat tests**

```ts
it('derives stats from attributes, equipment, and conditions without mutating input', () => {
  const input = actorDerivationFixture();
  const before = structuredClone(input);
  expect(deriveActorStats(input)).toEqual({
    maxHealth: 24, meleeAccuracy: 3, meleeDamageBonus: 2,
    rangedAccuracy: 4, defense: 12, search: 5, disarm: 4,
  });
  expect(input).toEqual(before);
});
```

Run: `npm test --workspace @woven-deep/engine -- --run test/attributes.test.ts`

Expected: FAIL because `deriveActorStats` is not defined.

- [x] **Step 3: Implement pure checked derived-stat calculation**

Accept base attributes, compiled balance coefficients, public equipment modifiers, and conditions. Validate all operands as safe integers before arithmetic. Return one immutable `DerivedActorStats` record; never cache it in `ActiveRun`.

- [x] **Step 4: Write failing scheduler examples**

```ts
it('lets equal-speed enemies act once between normal hero actions', () => {
  const state = schedulerFixture({ hero: { energy: 0, speed: 100 }, enemies: [{ id: 'monster.a', energy: 100, speed: 100 }] });
  expect(selectReadyActor(state.actors)?.actorId).toBe('monster.a');
  const afterEnemy = chargeActionEnergy(state.actors[1]!, 100);
  expect(advanceToNextReady({ worldTime: 0, actors: [state.actors[0]!, afterEnemy] }))
    .toMatchObject({ worldTime: 1, selectedActorId: 'hero.demo' });
});

it('orders readiness by energy, player priority, then actor id', () => {
  expect(selectReadyActor(readyTieFixture()).actorId).toBe('hero.demo');
});
```

Run: `npm test --workspace @woven-deep/engine -- --run test/scheduler.test.ts`

Expected: FAIL because scheduler functions do not exist.

- [x] **Step 5: Implement the pure scheduler contract**

Use readiness threshold `100`. Select greater energy first, then player-controlled actors, then UTF-16 actor ID. When none are ready, calculate the smallest positive integer elapsed value for any scheduled actor to reach readiness, add `speed * elapsed` with checked arithmetic, and return new actor records plus new `worldTime`. Exclude dead and incapacitated actors. Charging a heavy action may create negative energy within the validated bound.

- [x] **Step 6: Add seeded property tests**

In `arbitraries.ts`, generate sorted unique actor IDs, safe speed, energy, and health values, with at least one living actor eligible for normal scheduling. Add properties:

```ts
fc.assert(fc.property(schedulerStateArbitrary, (state) => {
  const before = structuredClone(state);
  const result = advanceToNextReady(state);
  expect(state).toEqual(before);
  expect(Number.isSafeInteger(result.worldTime)).toBe(true);
  expect(result.actors.every((actor) => Number.isSafeInteger(actor.energy))).toBe(true);
  expect(result.selectedActorId).not.toBeNull();
}), { seed: 0x4a01, numRuns: 500 });
```

Also prove stable selection under input-array permutation after normalization and deterministic failure on overflow.

- [x] **Step 7: Run GREEN and commit**

Run: `npm test --workspace @woven-deep/engine -- --run test/attributes.test.ts test/scheduler.test.ts test/gameplay-properties.test.ts`

Expected: all focused examples and 500-run properties pass.

Run: `npm test --workspace @woven-deep/engine && npm run typecheck --workspace @woven-deep/engine`

Expected: engine suite and typecheck pass.

Commit:

```bash
git add packages/engine package-lock.json
git commit -m "feat: schedule deterministic actor turns"
```

---
### Task 4: Expand commands, decisions, and eight-direction movement

**Files:**
- Create: `packages/engine/src/actions.ts`
- Create: `packages/engine/src/movement.ts`
- Modify: `packages/engine/src/model.ts`
- Modify: `packages/engine/src/terrain.ts`
- Modify: `packages/engine/src/reducer.ts`
- Modify: `packages/engine/src/save-schema.ts`
- Modify: `packages/engine/src/index.ts`
- Modify: `packages/engine/src/fixture.ts`
- Create: `packages/engine/test/actions.test.ts`
- Create: `packages/engine/test/movement.test.ts`
- Modify: `packages/engine/test/reducer.test.ts`
- Modify: `packages/engine/test/save-codec.test.ts`

**Interfaces:**
- Consumes: schema-v3 actors/floors, derived stats, terrain definitions, command deduplication, and current movement reducer behavior.
- Produces: eight-way `Direction`, expanded `GameCommand`, `DecisionRequiredResult`, `GameAction`, `ActionResolverRegistry`, `validatePlayerAction(input)`, `movementDestination(input)`, and `movementAction(input)`.

- [x] **Step 1: Write failing eight-way movement and corner tests**

```ts
it.each([
  ['northwest', -1, -1], ['north', 0, -1], ['northeast', 1, -1],
  ['west', -1, 0], ['east', 1, 0],
  ['southwest', -1, 1], ['south', 0, 1], ['southeast', 1, 1],
] as const)('maps %s to its delta', (direction, x, y) => {
  expect(directionDelta(direction)).toEqual({ x, y });
});

it('rejects a diagonal between two blocking side cells', () => {
  expect(movementAction(sealedCornerFixture('southeast'))).toEqual({
    status: 'invalid', reason: 'blocked.corner',
  });
});
```

Run: `npm test --workspace @woven-deep/engine -- --run test/movement.test.ts`

Expected: FAIL because diagonal directions and `blocked.corner` do not exist.

- [x] **Step 2: Add command, action, and decision unions**

Extend public types with complete choices only:

```ts
export type Direction = 'north' | 'northeast' | 'east' | 'southeast' | 'south' | 'southwest' | 'west' | 'northwest';
export type GameCommand = MoveCommand | WaitCommand | AttackCommand | FireCommand | CastCommand | ThrowItemCommand
  | UseItemCommand | EquipCommand | UnequipCommand | PickupCommand | DropCommand | SplitStackCommand | RefuelCommand | ToggleLightCommand
  | OpenDoorCommand | CloseDoorCommand | SearchCommand | DisarmCommand | RestCommand;
export interface ResolutionContext { readonly content: CompiledContentPack; }
export interface DecisionRequiredResult {
  readonly status: 'decision_required';
  readonly commandId: OpaqueId;
  readonly revision: number;
  readonly turn: number;
  readonly decision: PublicDecision;
}
```

Define `GameAction` separately from `GameCommand`; it contains authoritative action cost and resolved actor/item/feature references but never enters an external request or save.

- [x] **Step 3: Implement movement classification without combat resolution**

`movementAction` validates bounds, terrain, mutable door state, both orthogonal side cells for diagonals, and actor occupancy. It returns one of:

```ts
type MovementActionResult =
  | { readonly status: 'move'; readonly to: Point; readonly cost: number }
  | { readonly status: 'bump-attack'; readonly targetActorId: OpaqueId; readonly cost: number }
  | { readonly status: 'decision_required'; readonly decision: ConfirmAggressionDecision }
  | { readonly status: 'invalid'; readonly reason: MovementInvalidReason };
```

Hostile occupancy becomes `bump-attack`. Friendly occupancy is `blocked.actor`. Neutral occupancy returns a public aggression confirmation and does not change state.

- [x] **Step 4: Write failing decision immutability and deduplication tests**

```ts
it('does not record or mutate a decision-required command', () => {
  const { run, context } = neutralBumpFixture();
  const before = encodeActiveRun(run);
  const resolution = resolveCommand(run, move('command.neutral', run.revision, 'east'), context);
  expect(resolution.result.status).toBe('decision_required');
  expect(encodeActiveRun(resolution.state)).toBe(before);
  expect(resolution.events).toEqual([]);
});
```

Run: `npm test --workspace @woven-deep/engine -- --run test/actions.test.ts test/reducer.test.ts`

Expected: FAIL because `decision_required` is not handled.

- [x] **Step 5: Implement the command-validation shell**

Change the public entry point to `resolveCommand(state, command, context: ResolutionContext)`. Require `context.content.hash === state.contentHash` before command processing; a mismatch is an internal invariant error and publishes nothing. Update every fixture, replay helper, CLI, and test call site to pass its exact compiled pack.

`validatePlayerAction` looks up only authoritative state, compiled content, and balance. It returns complete `GameAction`, `DecisionRequiredResult`, or typed invalid reason. Route action kinds through a closed `ActionResolverRegistry`; an action whose later subsystem is not registered yet returns `action.unavailable` without consuming time or randomness. Each owning task replaces that result with its complete registered resolver and tests the transition. Update reducer ordering to keep duplicate-command and revision checks first. Rejected, invalid, and decision-required commands consume no random state or time; only invalid processed commands enter the recent-command ring, preserving the existing protocol contract.

Update save schemas for expanded recorded command/event unions while permitting a processed command to contain an ordered event array rather than exactly one event.

- [x] **Step 6: Run movement and reducer GREEN**

Run: `npm test --workspace @woven-deep/engine -- --run test/movement.test.ts test/actions.test.ts test/reducer.test.ts test/save-codec.test.ts test/perception.test.ts`

Expected: all focused tests pass, including sealed corners, neutral decisions, and cardinal-direction regression fixtures.

- [x] **Step 7: Run package gate and commit**

Run: `npm test --workspace @woven-deep/engine && npm run typecheck --workspace @woven-deep/engine`

Expected: engine suite and typecheck pass.

Commit:

```bash
git add packages/engine
git commit -m "feat: validate tactical player actions"
```

---

### Task 5: Resolve effects, conditions, targeting, and combat

**Files:**
- Create: `packages/engine/src/targeting.ts`
- Create: `packages/engine/src/effects.ts`
- Create: `packages/engine/src/combat.ts`
- Modify: `packages/engine/src/random.ts`
- Modify: `packages/engine/src/actor-model.ts`
- Modify: `packages/engine/src/model.ts`
- Modify: `packages/engine/src/save-schema.ts`
- Modify: `packages/engine/src/index.ts`
- Create: `packages/engine/test/targeting.test.ts`
- Create: `packages/engine/test/effects.test.ts`
- Create: `packages/engine/test/combat.test.ts`
- Create: `packages/engine/test/conditions.test.ts`
- Modify: `packages/engine/test/save-codec.test.ts`

**Interfaces:**
- Consumes: compiled monster/item/spell/effect content, `DerivedActorStats`, `rng.combat`, actor state, light/terrain occlusion, and typed actions.
- Produces: `rollDie(state, sides)`, `validateTarget(input)`, `resolveAttack(input)`, `applyHealing(input)`, `resolveEffectSequence(input)`, `advanceConditions(input)`, and combat/effect domain events.

- [x] **Step 1: Write failing die, attack, critical, and mitigation tests**

Use fixed combat states rather than mocking randomness:

```ts
it('treats natural one as a miss and natural twenty as doubled damage dice', () => {
  expect(resolveAttack(attackFixture({ combatState: stateProducing(1) })).events[0]).toMatchObject({ type: 'attack.missed', naturalRoll: 1 });
  expect(resolveAttack(attackFixture({ combatState: stateProducing(20), damage: { count: 1, sides: 6, bonus: 2 } })).events)
    .toContainEqual(expect.objectContaining({ type: 'attack.hit', critical: true, rolledDice: 2 }));
});

it('applies armor and resistance to effective damage with immunity allowed to reach zero', () => {
  expect(resolveDamage(damageFixture({ rolled: 10, armor: 3, resistance: 20 }))).toBe(6);
  expect(resolveDamage(damageFixture({ rolled: 10, immune: true }))).toBe(0);
});
```

Run: `npm test --workspace @woven-deep/engine -- --run test/combat.test.ts`

Expected: FAIL because combat functions and events do not exist.

- [x] **Step 2: Implement deterministic structured dice and combat**

Add `rollDie` using rejection sampling over `nextUint32` so every face is unbiased and all consumed states are returned. `resolveAttack` consumes only `rng.combat`, applies d20 accuracy versus defense, natural rules, twice-rolled critical dice, flat modifiers once, armor, integer percentage resistance, vulnerability, immunity, minimum effective hit damage, health reduction, and immediate death.

Return:

```ts
export interface CombatResolution {
  readonly actors: readonly ActorState[];
  readonly combatState: Uint32State;
  readonly events: readonly DomainEvent[];
  readonly targetDied: boolean;
}
```

Every event includes effective values and stable actor/content identifiers but no future random state.

- [x] **Step 3: Write failing targeting and hidden-state tests**

```ts
it('accepts a visible unobstructed line target', () => {
  expect(validateTarget(lineTargetFixture())).toEqual({ ok: true, cells: expectedLine });
});

it('does not return a hidden actor id in an invalid public target reason', () => {
  const result = validateTarget(hiddenTargetFixture());
  expect(stableJson(result)).not.toContain('monster.hidden');
});
```

Run: `npm test --workspace @woven-deep/engine -- --run test/targeting.test.ts`

Expected: FAIL because target validation is absent.

- [x] **Step 4: Implement range, trajectory, and public target validation**

Support `target.self`, `target.actor`, `target.line`, and `target.cell`. Validate Chebyshev range, floor ownership, line obstruction, actor visibility, and target relationship using existing field-of-view and terrain adapters. Return authoritative details only on success; failure reasons use public categories such as `target.not_visible`, `target.out_of_range`, and `target.blocked`.

- [x] **Step 5: Write failing effect and condition tests**

```ts
it('applies an ordered damage then condition sequence', () => {
  const result = resolveEffectSequence(effectFixture(['effect.damage', 'effect.condition.apply']));
  expect(result.events.map((event) => event.type)).toEqual(['attack.hit', 'actor.damaged', 'condition.applied']);
});

it('advances absolute condition deadlines from world time', () => {
  expect(advanceConditions(conditionFixture({ worldTime: 12, expiresAt: 12 })).events)
    .toContainEqual(expect.objectContaining({ type: 'condition.expired' }));
});
```

Run: `npm test --workspace @woven-deep/engine -- --run test/effects.test.ts test/conditions.test.ts`

Expected: FAIL because the registry resolver is absent.

- [x] **Step 6: Implement the closed effect registry and conditions**

Map every compiler-published effect ID to a browser-safe pure resolver with the same strict parameter schema. Prevalidate the full sequence and target contract before applying its first effect. Apply effects in authored order, explicitly skip a `requiresLivingTarget` step after target death, and return updated state, named random stream states, and ordered events. Implement damage, healing, condition add/remove, and forced movement directly. Define an injected `EffectOperations` contract for reveal, fuel transfer, light toggle, item consumption, and feature mutation; the closed registry delegates those operations through the contract. The reducer initially supplies rejecting operations that return `action.unavailable` before publication, and Tasks 7, 8, and 11 register their atomic implementations with focused transition tests.

- [x] **Step 7: Run combat/effect GREEN and package gate**

Run: `npm test --workspace @woven-deep/engine -- --run test/combat.test.ts test/targeting.test.ts test/effects.test.ts test/conditions.test.ts test/save-codec.test.ts`

Expected: all focused tests pass with exact event ordering and stream assertions.

Run: `npm test --workspace @woven-deep/engine && npm run typecheck --workspace @woven-deep/engine`

Expected: engine suite and typecheck pass.

- [x] **Step 8: Commit**

```bash
git add packages/engine
git commit -m "feat: resolve deterministic combat effects"
```

---

### Task 5A: Move condition definitions into YAML

- [x] Execute `docs/superpowers/plans/2026-07-13-yaml-condition-definitions.md` completely before Task 6.
- [x] Require every operator-editable YAML kind and closed registry ID to remain documented under `docs/server-admin/`.

---

### Task 6: Add relationships, opportunity reactions, and atomic world steps

**Files:**
- Create: `packages/engine/src/reactions.ts`
- Create: `packages/engine/src/world-step.ts`
- Create: `packages/engine/src/behavior.ts`
- Modify: `packages/engine/src/actions.ts`
- Modify: `packages/engine/src/movement.ts`
- Modify: `packages/engine/src/reducer.ts`
- Modify: `packages/engine/src/perception.ts`
- Modify: `packages/engine/src/model.ts`
- Modify: `packages/engine/src/index.ts`
- Create: `packages/engine/test/reactions.test.ts`
- Create: `packages/engine/test/world-step.test.ts`
- Create: `packages/engine/test/behavior.test.ts`
- Modify: `packages/engine/test/reducer.test.ts`
- Modify: `packages/engine/test/replay.test.ts`

**Interfaces:**
- Consumes: scheduler, actions, movement attempt, combat, conditions, schema-v3 relationship/awareness state, and perception refresh.
- Produces: `relationshipBetween(run, leftId, rightId)`, `eligibleOpportunityAttackers(input)`, `resolveOpportunityAttacks(input)`, `chooseBehaviorAction(input)`, and `resolveWorldStep(input)`.

- [x] **Step 1: Write failing hostility and neutral-aggression tests**

```ts
it('makes confirmed aggression hostile before the attack roll and saves it', () => {
  const result = resolveWorldStep(confirmAggressionFixture());
  expect(relationshipBetween(result.state, 'hero.demo', 'npc.neutral')).toBe('hostile');
  expect(result.events[0]).toMatchObject({ type: 'relationship.changed', relationship: 'hostile' });
});

it('never creates a reaction between neutral actors', () => {
  expect(eligibleOpportunityAttackers(neutralDepartureFixture())).toEqual([]);
});
```

Run: `npm test --workspace @woven-deep/engine -- --run test/reactions.test.ts`

Expected: FAIL because relationship and reaction functions do not exist.

- [x] **Step 2: Implement saved symmetric relationship lookup**

Store sorted relationship overrides by normalized actor pair. Default to hostile if either actor's declared disposition is hostile toward the other, neutral when either is neutral, and friendly otherwise. An explicit aggression confirmation writes a hostile override before attack resolution, even when the attack misses.

- [x] **Step 3: Write failing opportunity eligibility, ordering, and recovery tests**

```ts
it('resolves aware hostile reactions by stable actor id before movement', () => {
  const result = resolveOpportunityAttacks(twoHostileDepartureFixture());
  expect(result.events.filter((event) => event.type === 'reaction.triggered').map((event) => event.actorId))
    .toEqual(['monster.a', 'monster.b']);
  expect(result.movementAllowed).toBe(true);
});

it('cancels movement after root but resolves already-triggered living attackers', () => {
  const result = resolveOpportunityAttacks(rootedDepartureFixture());
  expect(result.movementAllowed).toBe(false);
  expect(result.events.filter((event) => event.type === 'reaction.triggered')).toHaveLength(2);
});

it('recovers a spent reaction only after a normal scheduled turn', () => {
  expect(completeNormalActorTurn({ ...actorFixture(), reactionReady: false }).reactionReady).toBe(true);
});
```

Run: same focused command.

Expected: FAIL on opportunity rules.

- [x] **Step 4: Implement symmetric reaction resolution**

Capture eligible attackers at movement attempt time. Require alive, hostile, aware, capable, in reach, and `reactionReady`. Consume each reaction before its attack. Resolve by stable ID. Stop after mover death; retain remaining reactions when they never trigger. Root, stun, or another movement blocker cancels movement while already-triggered living attackers continue. Use the compiled condition traits `condition-trait.suppresses-reactions` and `condition-trait.avoids-opportunity-attacks`; descriptive tags never activate rules.

- [x] **Step 5: Write failing complete world-step tests**

```ts
it('applies the hero action then actors until the hero is selected again', () => {
  const result = resolveWorldStep(equalSpeedCombatFixture());
  expect(result.events.map((event) => event.type)).toEqual([
    'hero.moved', 'actor.turn.started', 'attack.hit', 'actor.damaged', 'actor.turn.completed',
  ]);
  expect(result.state.worldTime).toBe(1);
  expect(selectReadyActor(result.state.actors)?.actorId).toBe('hero.demo');
});
```

Run: `npm test --workspace @woven-deep/engine -- --run test/world-step.test.ts test/reducer.test.ts`

Expected: FAIL because atomic orchestration is absent.

- [x] **Step 6: Implement the minimal 4A behavior and world-step loop**

Register `behavior.approach-and-attack`: attack an adjacent hostile, otherwise take one legal eight-way step that reduces Chebyshev distance using fixed direction ordering, otherwise wait. It sees only its own authoritative perception input and consumes no random stream.

`resolveWorldStep` applies the hero action, charges energy, repeatedly selects or advances actors, applies time transitions through a callback, resolves non-player actions, restores a completed actor's reaction, stops at hero selection/death/decision, then refreshes perception. It returns authoritative events and a conservative public sequence captured at each event's resolution point: hero-authored or hero-targeted events and events whose participants are visible at that point. Unseen sound conversion is added in Task 12; until then unseen events are omitted, never exposed. Enforce a tested maximum internal-action safety bound that throws before publication on a non-progressing loop.

- [x] **Step 7: Delegate applied reducer commands to world steps**

Keep protocol, decision, and invalid handling in `reducer.ts`. Applied actions call `resolveWorldStep`, increment player `turn` once, increment `revision` once, record ordered authoritative `events` and event-time `publicEvents` in one `RecordedCommand`, and update the appropriate random streams returned by the world step. Duplicate command IDs return the stored result and stored `publicEvents` byte-for-byte.

- [x] **Step 8: Run replay GREEN and commit**

Run: `npm test --workspace @woven-deep/engine -- --run test/reactions.test.ts test/behavior.test.ts test/world-step.test.ts test/reducer.test.ts test/replay.test.ts test/generated-replay.test.ts`

Expected: all focused suites pass and save-split replay remains identical.

Run: `npm test --workspace @woven-deep/engine && npm run typecheck --workspace @woven-deep/engine`

Expected: engine suite and typecheck pass.

Commit:

```bash
git add packages/engine
git commit -m "feat: resolve atomic combat world steps"
```

---

### Task 7: Implement item locations, backpack capacity, and stack operations

**Files:**
- Create: `packages/engine/src/inventory.ts`
- Create: `packages/engine/src/content-bound-validation.ts`
- Modify: `packages/engine/src/item-model.ts`
- Modify: `packages/engine/src/actions.ts`
- Modify: `packages/engine/src/effects.ts`
- Modify: `packages/engine/src/save-schema.ts`
- Modify: `packages/engine/src/model.ts`
- Modify: `packages/engine/src/index.ts`
- Create: `packages/engine/test/inventory.test.ts`
- Modify: `packages/engine/test/actions.test.ts`
- Modify: `packages/engine/test/save-codec.test.ts`
- Modify: `packages/engine/test/gameplay-properties.test.ts`

**Interfaces:**
- Consumes: schema-v3 item instances and locations, compiled item definitions, complete item commands, actor/floor positions, and effect item-consumption dispatch.
- Produces: `validateContentBoundRun(run, pack)`, `inventorySlotCount(input)`, `canStack(left, right)`, `pickupItem(input)`, `dropItem(input)`, `splitStack(input)`, `mergeStacks(input)`, and `consumeItemQuantity(input)`.

- [x] **Step 1: Write failing stack compatibility and capacity tests**

```ts
it('merges only gameplay-identical stack instances', () => {
  expect(canStack(item({ fuel: 10 }), item({ fuel: 10 }))).toBe(true);
  expect(canStack(item({ fuel: 10 }), item({ fuel: 9 }))).toBe(false);
  expect(canStack(item({ identified: true }), item({ identified: false }))).toBe(false);
});

it('counts backpack stacks but excludes equipped items', () => {
  expect(inventorySlotCount(capacityFixture())).toEqual({ used: 2, capacity: 3 });
});
```

Run: `npm test --workspace @woven-deep/engine -- --run test/inventory.test.ts`

Expected: FAIL because inventory functions do not exist.

- [x] **Step 2: Implement exact item-location and stack invariants**

Use a discriminated location union:

```ts
export type ItemLocation =
  | { readonly type: 'backpack'; readonly actorId: OpaqueId }
  | { readonly type: 'equipped'; readonly actorId: OpaqueId; readonly slot: EquipmentSlot }
  | { readonly type: 'floor'; readonly floorId: OpaqueId; readonly x: number; readonly y: number };
```

`canStack` compares content ID, public/hidden identity state, charges, fuel, enchantment, and condition. Structural save validation requires positive safe quantity and exactly one valid location. `validateContentBoundRun` then checks content existence, definition stack limits, actor templates, equipment compatibility, feature definitions, balance reference, and exact content-hash equality against the compiled pack.

- [x] **Step 3: Write failing pickup, drop, split, merge, and conservation tests**

```ts
it('fails atomically when pickup would exceed slot capacity', () => {
  const input = fullBackpackPickupFixture();
  expect(pickupItem(input)).toEqual({ ok: false, reason: 'inventory.full' });
  expect(input.run).toEqual(input.before);
});

it('splits and merges without changing total quantity', () => {
  const split = splitStack(splitFixture({ quantity: 7, splitQuantity: 3 }));
  expect(split.items.reduce((sum, entry) => sum + entry.quantity, 0)).toBe(7);
  expect(mergeStacks(mergeFixture(split.items)).items).toHaveLength(1);
});
```

Run: same focused command.

Expected: FAIL on transitions.

- [x] **Step 4: Implement immutable inventory transitions**

Sort compatible ground items by item ID. Pickup merges before allocating a new slot. Split requires caller-supplied stable new item ID and rejects collisions. Drop preserves quantity and places at the actor cell. Merge retains the lexically smaller item ID and removes only the emptied instance. Consumption removes an item at zero quantity in the unpublished transition and emits effective quantity events.

- [x] **Step 5: Wire complete commands and effect consumption**

Validate item ownership, visibility, floor/cell, quantity, capacity, and new ID before the world step. Call `validateContentBoundRun` at the public resolution boundary before resolving an action against content. Applied pickup/drop/split actions cost their balance-defined energy. Browsing is not a command. `effect.item.consume` calls the same quantity transition rather than duplicating logic.

Register the complete item-backed action transactions. `Fire` validates a compatible weapon and ammunition stack before the world step, then consumes exactly one ammunition unit only after targeting succeeds and the shot begins. `Throw` removes the declared quantity and either consumes or places the thrown instance according to its registered effect. `Use` consumes only the quantity declared by its effect. Invalid or decision-required actions leave every quantity unchanged. Add focused tests for empty ammunition, incompatible ammunition, last-unit removal, thrown-item placement, and rollback before publication.

- [x] **Step 6: Add property-based conservation tests**

Generate valid stack lists and legal split/merge/transfer sequences. Assert total quantity is conserved except for explicit consumption, every live item has one location, capacity never exceeds its bound, input is unchanged, and stable JSON output repeats for the same sequence and property seed.

- [x] **Step 7: Run GREEN and commit**

Run: `npm test --workspace @woven-deep/engine -- --run test/inventory.test.ts test/actions.test.ts test/effects.test.ts test/combat.test.ts test/save-codec.test.ts test/gameplay-properties.test.ts`

Expected: focused examples and properties pass.

Run: `npm test --workspace @woven-deep/engine && npm run typecheck --workspace @woven-deep/engine`

Expected: engine suite and typecheck pass.

Commit:

```bash
git add packages/engine
git commit -m "feat: manage immutable backpack items"
```

---

### Task 8: Equip gear and bind carried light to item fuel

**Files:**
- Create: `packages/engine/src/equipment.ts`
- Modify: `packages/engine/src/item-model.ts`
- Modify: `packages/engine/src/light-model.ts`
- Modify: `packages/engine/src/lighting.ts`
- Modify: `packages/engine/src/perception.ts`
- Modify: `packages/engine/src/actions.ts`
- Modify: `packages/engine/src/world-step.ts`
- Modify: `packages/engine/src/save-schema.ts`
- Modify: `packages/engine/src/index.ts`
- Create: `packages/engine/test/equipment.test.ts`
- Modify: `packages/engine/test/lighting.test.ts`
- Modify: `packages/engine/test/perception.test.ts`
- Modify: `packages/engine/test/gameplay-properties.test.ts`

**Interfaces:**
- Consumes: inventory transitions, item equipment definitions, actor equipment references, derived-stat calculator, light-source calculation, and equip/toggle/refuel actions.
- Produces: `equipmentPlan(input)`, `equipItem(input)`, `unequipItem(input)`, `equipmentModifiers(input)`, and `itemLightSources(input)`.

- [x] **Step 1: Write failing handedness and displacement tests**

```ts
it('reserves both hands for two-handed equipment', () => {
  expect(equipmentPlan(twoHandedWithShieldFixture())).toEqual({
    ok: true,
    equip: [{ itemId: 'weapon.great-axe.1', slot: 'main-hand' }],
    unequip: ['shield.1'],
    reservedSlots: ['main-hand', 'off-hand'],
  });
});

it('rejects a one-handed definition that also reserves both hands', () => {
  expect(() => validateContentBoundRun(inconsistentHandednessRun(), inconsistentHandednessPack()))
    .toThrow(/handedness.*reserved slots/i);
});

it('fails without a turn when displaced gear cannot fit', () => {
  expect(equipItem(fullBackpackDisplacementFixture())).toEqual({ ok: false, reason: 'inventory.full' });
});
```

Run: `npm test --workspace @woven-deep/engine -- --run test/equipment.test.ts`

Expected: FAIL because equipment planning does not exist.

- [x] **Step 2: Implement explicit slots and atomic equipment planning**

Support `main-hand`, `off-hand`, `body`, `head`, `hands`, `feet`, `neck`, `left-ring`, and `right-ring`. Validate item compatibility and handedness from compiled content. Plan all displacements first, prove backpack capacity, then publish every location change together. Never silently drop an item. Equipping and unequipping consume time only after a valid plan is applied.

- [x] **Step 3: Write failing equipment-derived-stat tests**

```ts
it('changes derived stats only through equipped definitions', () => {
  const before = deriveActorStats(unarmoredFixture());
  const after = deriveActorStats(armoredFixture());
  expect(after.defense - before.defense).toBe(2);
  expect(after).toEqual(deriveActorStats(armoredFixture()));
});
```

Run: same focused command.

Expected: FAIL because equipment modifiers are not connected.

- [x] **Step 4: Implement pure equipment modifiers**

Fold equipped item definitions in equipment-slot order. Apply integer modifiers once, expose an itemized explanation for projection, and pass the result to `deriveActorStats`. Item instance hidden enchantments contribute only to authoritative totals; their explanation is redacted until identified.

- [x] **Step 5: Write failing item-backed light tests**

```ts
it('emits light only from an enabled equipped or placed fueled item', () => {
  expect(itemLightSources(equippedTorchFixture({ fuel: 5, enabled: true }))).toHaveLength(1);
  expect(itemLightSources(equippedTorchFixture({ fuel: 0, enabled: true }))).toEqual([]);
  expect(itemLightSources(backpackTorchFixture())).toEqual([]);
});
```

Run: `npm test --workspace @woven-deep/engine -- --run test/equipment.test.ts test/lighting.test.ts test/perception.test.ts`

Expected: FAIL because light is not derived from item instances.

- [x] **Step 6: Bind item lights to existing illumination**

Generate transient `LightSource` records from equipped or floor-placed light items with positive fuel and enabled state. Keep fixed environmental lights unchanged. Use stable light IDs derived from item IDs, refresh perception after equip/unequip/toggle/refuel, and ensure previews use known item properties without revealing unknown terrain.

- [x] **Step 7: Add equipment properties and run GREEN**

Generate legal inventory/equipment states and action sequences. Assert no slot overlap, two-handed reservations, one location per item, capacity after displacement, and no light from backpack/empty/disabled items.

Run: `npm test --workspace @woven-deep/engine -- --run test/equipment.test.ts test/lighting.test.ts test/perception.test.ts test/gameplay-properties.test.ts`

Expected: focused suites and properties pass.

- [x] **Step 8: Run package gate and commit**

Run: `npm test --workspace @woven-deep/engine && npm run typecheck --workspace @woven-deep/engine`

Expected: engine suite and typecheck pass.

Commit:

```bash
git add packages/engine
git commit -m "feat: equip gear and carried lights"
```

---

### Task 9: Allocate and project per-run item identification

**Files:**
- Create: `packages/engine/src/identification.ts`
- Modify: `packages/engine/src/random.ts`
- Modify: `packages/engine/src/item-model.ts`
- Modify: `packages/engine/src/effects.ts`
- Modify: `packages/engine/src/actions.ts`
- Modify: `packages/engine/src/projection.ts`
- Modify: `packages/engine/src/save-schema.ts`
- Modify: `packages/engine/src/index.ts`
- Create: `packages/engine/test/identification.test.ts`
- Modify: `packages/engine/test/projection.test.ts`
- Modify: `packages/engine/test/replay.test.ts`
- Modify: `packages/engine/test/save-codec.test.ts`

**Interfaces:**
- Consumes: compiled identification groups, `rng.effects`, item effect use, item projection, and schema-v3 identification state.
- Produces: `allocateIdentificationMap(input)`, `identifyAppearance(input)`, `identifyItem(input)`, and `projectItem(input)`.

- [x] **Step 1: Write failing deterministic shuffle and stream-isolation tests**

```ts
it('allocates a stable bijection and advances only effects rng', () => {
  const input = identificationFixture();
  const result = allocateIdentificationMap(input);
  expect(new Set(Object.values(result.appearanceByContentId)).size).toBe(input.contentIds.length);
  expect(result.rng.encounters).toEqual(input.rng.encounters);
  expect(result.rng.effects).not.toEqual(input.rng.effects);
  expect(allocateIdentificationMap(input)).toEqual(result);
});

```

Run: `npm test --workspace @woven-deep/engine -- --run test/identification.test.ts`

Expected: FAIL because identification allocation does not exist.

- [x] **Step 2: Implement unbiased saved appearance allocation**

Sort compatible content and appearance IDs, then perform Fisher-Yates using unbiased bounded draws from `rng.effects`. Validate equal pool sizes and one-to-one assignment. Save `appearanceByContentId` sorted by content ID and known appearance IDs sorted by ID. Assert every other named random stream remains byte-identical.

- [x] **Step 3: Write failing use-then-reveal and equipment-identity tests**

```ts
it('applies an unknown consumable before identifying its appearance', () => {
  const result = resolveWorldStep(useUnknownPotionFixture());
  expect(result.events.map((event) => event.type)).toEqual([
    'item.used', 'actor.healed', 'identification.appearance-revealed', 'item.consumed',
  ]);
});

it('identifies enchanted equipment per instance only', () => {
  const result = identifyItem(twoMatchingEnchantedItemsFixture(), 'sword.1');
  expect(result.items.find((item) => item.itemId === 'sword.1')?.identified).toBe(true);
  expect(result.items.find((item) => item.itemId === 'sword.2')?.identified).toBe(false);
});
```

Run: same focused command.

Expected: FAIL because knowledge transitions are absent.

- [x] **Step 4: Implement appearance and per-instance knowledge transitions**

After a consumable's effects resolve, add its appearance ID to known appearances before the final projection. Explicit identify effects can reveal an appearance or one item instance. Keep mechanical knowledge hero-scoped and saved. Consumption uses inventory logic and preserves event order.

- [x] **Step 5: Write failing hidden-item projection tests**

```ts
it('projects shuffled appearance without hidden content or enchantment', () => {
  const json = stableJson(projectItem(unknownEnchantedPotionFixture()));
  expect(json).toContain('appearance.smoky');
  expect(json).not.toContain('item.healing-potion');
  expect(json).not.toContain('enchantment');
});
```

Run: `npm test --workspace @woven-deep/engine -- --run test/identification.test.ts test/projection.test.ts`

Expected: FAIL on redaction.

- [x] **Step 6: Project only current item knowledge**

Known consumables expose content ID, name, effects, and exact known modifiers. Unknown consumables expose appearance ID, category, quantity, and visible state. Unidentified equipment exposes base public definition and an explicit unknown-property marker, while authoritative derived stats remain correct.

- [x] **Step 7: Run replay GREEN and commit**

Run: `npm test --workspace @woven-deep/engine -- --run test/identification.test.ts test/projection.test.ts test/replay.test.ts test/save-codec.test.ts`

Expected: focused tests pass, including save/load after partial identification.

Run: `npm test --workspace @woven-deep/engine && npm run typecheck --workspace @woven-deep/engine`

Expected: engine suite and typecheck pass.

Commit:

```bash
git add packages/engine
git commit -m "feat: identify shuffled run items"
```

---

### Task 10: Advance hunger, fuel, recovery, and timed conditions

**Files:**
- Create: `packages/engine/src/survival.ts`
- Modify: `packages/engine/src/survival-model.ts`
- Modify: `packages/engine/src/world-step.ts`
- Modify: `packages/engine/src/effects.ts`
- Modify: `packages/engine/src/perception.ts`
- Modify: `packages/engine/src/save-schema.ts`
- Modify: `packages/engine/src/model.ts`
- Modify: `packages/engine/src/index.ts`
- Create: `packages/engine/test/survival.test.ts`
- Modify: `packages/engine/test/world-step.test.ts`
- Modify: `packages/engine/test/lighting.test.ts`
- Modify: `packages/engine/test/gameplay-properties.test.ts`

**Interfaces:**
- Consumes: exact scheduler elapsed time, balance hunger/fuel/recovery settings, item-backed light, conditions, healing/damage effects, and perception refresh.
- Produces: `advanceSurvival(input)`, `hungerStage(input)`, `consumeFuel(input)`, and ordered survival/resource events.

- [ ] **Step 1: Write failing hunger-stage and elapsed-time tests**

```ts
it.each([
  [80, 'sated'], [50, 'hungry'], [20, 'weak'], [0, 'starving'],
] as const)('maps reserve %i to %s', (reserve, stage) => {
  expect(hungerStage({ reserve, thresholds: testThresholds })).toBe(stage);
});

it('drains by elapsed world time rather than command count', () => {
  const result = advanceSurvival(survivalFixture({ elapsed: 7, hunger: 20, fuel: 12 }));
  expect(result.survival.hungerReserve).toBe(13);
  expect(result.items.find((item) => item.itemId === 'torch.1')?.fuel).toBe(5);
});
```

Run: `npm test --workspace @woven-deep/engine -- --run test/survival.test.ts`

Expected: FAIL because survival advancement does not exist.

- [ ] **Step 2: Implement staged hunger and exact fuel consumption**

Clamp hunger at zero, emit each crossed threshold once in chronological order, apply weak-stage modifiers through conditions/derived stats, and apply starvation damage at absolute configured deadlines. Drain fuel only from enabled equipped or floor-placed sources. Emit threshold warnings once and disable at zero. Recompute light/perception after any source disables.

- [ ] **Step 3: Write failing food, refuel, and conservation tests**

```ts
it('records effective food restoration at the cap', () => {
  const result = resolveEffectSequence(foodEffectFixture({ reserve: 95, maximum: 100, restore: 20 }));
  expect(result.events).toContainEqual(expect.objectContaining({ type: 'hunger.restored', amount: 5 }));
});

it('transfers fuel without creating or losing units', () => {
  const result = transferFuel(refuelFixture({ from: 9, to: 7, capacity: 12 }));
  expect(result.fromFuel + result.toFuel).toBe(16);
  expect(result).toMatchObject({ fromFuel: 4, toFuel: 12 });
});
```

Run: same focused command.

Expected: FAIL on resource effects.

- [ ] **Step 4: Implement food, refuel, toggle, and recovery**

Food applies bounded effective restoration then its additional effect sequence. Refuel validates compatibility, ownership, positive transfer, and capacity before applying. Extinguish and relight toggle enabled state with exact events. Recovery uses elapsed time, current hunger stage, conditions, danger flag, and balance coefficients; healing is capped and reports effective values.

- [ ] **Step 5: Integrate survival into every scheduler clock advance**

In `resolveWorldStep`, call `advanceSurvival` immediately after adding scheduler elapsed time and before selecting an actor made ready by that advance. If starvation or a timed condition kills the hero, stop without granting input. If it kills another actor, remove that actor from readiness. Keep survival stream consumption isolated to the effect stream only when a declared effect requires randomness.

- [ ] **Step 6: Add property tests and run GREEN**

Generate safe reserves, fuel stacks, elapsed values, and legal transfers. Assert bounds, conservation, monotonic world time, warning uniqueness, deterministic output, and no fuel drain from backpack/disabled/empty items.

Run: `npm test --workspace @woven-deep/engine -- --run test/survival.test.ts test/world-step.test.ts test/lighting.test.ts test/gameplay-properties.test.ts`

Expected: focused examples and properties pass.

- [ ] **Step 7: Run package gate and commit**

Run: `npm test --workspace @woven-deep/engine && npm run typecheck --workspace @woven-deep/engine`

Expected: engine suite and typecheck pass.

Commit:

```bash
git add packages/engine
git commit -m "feat: advance dungeon survival clocks"
```

---

### Task 11: Add mutable doors, traps, secrets, Search, and disarm

**Files:**
- Create: `packages/engine/src/features.ts`
- Modify: `packages/engine/src/feature-model.ts`
- Modify: `packages/engine/src/actions.ts`
- Modify: `packages/engine/src/movement.ts`
- Modify: `packages/engine/src/effects.ts`
- Modify: `packages/engine/src/perception.ts`
- Modify: `packages/engine/src/projection.ts`
- Modify: `packages/engine/src/save-schema.ts`
- Modify: `packages/engine/src/index.ts`
- Create: `packages/engine/test/features.test.ts`
- Modify: `packages/engine/test/movement.test.ts`
- Modify: `packages/engine/test/perception.test.ts`
- Modify: `packages/engine/test/projection.test.ts`

**Interfaces:**
- Consumes: schema-v3 door features, tile/visibility/light rules, Wits-derived search stat, effects RNG, trap content, complete feature commands, and projection knowledge.
- Produces: `featureAt(input)`, `openDoor(input)`, `closeDoor(input)`, `applyPassiveDiscovery(input)`, `searchFeatures(input)`, `disarmTrap(input)`, `triggerTrap(input)`, and `projectFeature(input)`.

- [ ] **Step 1: Write failing mutable-door geometry tests**

```ts
it('changes movement, sight, and light when a door opens', () => {
  const closed = doorFixture('closed');
  expect(featureBlocksMovement(closed)).toBe(true);
  const opened = openDoor({ run: closed.run, actorId: 'hero.demo', featureId: 'door.1' });
  expect(featureBlocksMovement(opened.run)).toBe(false);
  expect(projectFloor(afterPerception(opened.run)).cells[behindDoorIndex].knowledge).toBe('visible');
});

it('refuses to close an occupied doorway without time', () => {
  expect(closeDoor(occupiedDoorFixture())).toEqual({ ok: false, reason: 'door.occupied' });
});
```

Run: `npm test --workspace @woven-deep/engine -- --run test/features.test.ts test/movement.test.ts test/perception.test.ts`

Expected: FAIL because mutable door operations are absent.

- [ ] **Step 2: Implement door state and geometry integration**

Closed and locked doors block movement, sight, and light; open doors permit them. Validate adjacency, feature state, registered lock behavior, and occupancy before applying. Refresh perception immediately after geometry changes. Schema-v3 fixtures represent every mutable door directly as a stable feature and retain its terrain tile as cover presentation.

- [ ] **Step 3: Write failing passive discovery and reload-safety tests**

```ts
it('grants one passive contribution for a newly illuminated context', () => {
  const once = applyPassiveDiscovery(passiveDiscoveryFixture());
  const twice = applyPassiveDiscovery({ ...passiveDiscoveryFixture(), run: once.run });
  expect(twice.run.features).toEqual(once.run.features);
});

it('does not gain another passive contribution after save and load', () => {
  const once = applyPassiveDiscovery(passiveDiscoveryFixture()).run;
  const loaded = decodeActiveRun(encodeActiveRun(once));
  expect(applyPassiveDiscovery({ ...passiveDiscoveryFixture(), run: loaded }).run).toEqual(loaded);
});
```

Run: `npm test --workspace @woven-deep/engine -- --run test/features.test.ts test/save-codec.test.ts`

Expected: FAIL because discovery contexts are not saved.

- [ ] **Step 4: Implement passive and active discovery progress**

Use hidden safe-integer difficulty. Derive a context key from hero position, illumination band, tools, and relevant conditions. A new nearby context adds Wits/light contribution once and records the sorted key. Search costs time, visits eligible nearby features by feature ID, applies reduced repeated-context progress with minimum one, and reveals any feature reaching difficulty. Reveal events precede geometry refresh.

- [ ] **Step 5: Write failing disarm, trigger, and secret projection tests**

```ts
it('reveals a hidden trap before its triggered effects', () => {
  const result = triggerTrap(hiddenTrapFixture());
  expect(result.events.map((event) => event.type).slice(0, 2)).toEqual(['feature.revealed', 'trap.triggered']);
});

it('projects an undiscovered secret as cover terrain only', () => {
  const json = stableJson(projectFloor(secretPassageFixture()));
  expect(json).toContain('terrain.wall');
  expect(json).not.toContain('secret.1');
});
```

Run: `npm test --workspace @woven-deep/engine -- --run test/features.test.ts test/projection.test.ts`

Expected: FAIL on trap/secret behavior.

- [ ] **Step 6: Implement disarm, trigger, and secret reveal**

Disarm uses one effects-stream skill roll and configured outcomes: success, safe failure, tool damage, or trigger. Trigger reveals first, invokes the trap's validated effect sequence, and applies reset/disable state. An undiscovered secret projects its cover terrain and no feature ID; discovery changes public knowledge and refreshes geometry.

- [ ] **Step 7: Run GREEN and commit**

Run: `npm test --workspace @woven-deep/engine -- --run test/features.test.ts test/movement.test.ts test/perception.test.ts test/projection.test.ts test/save-codec.test.ts`

Expected: focused suites pass with exact discovery and event ordering.

Run: `npm test --workspace @woven-deep/engine && npm run typecheck --workspace @woven-deep/engine`

Expected: engine suite and typecheck pass.

Commit:

```bash
git add packages/engine
git commit -m "feat: reveal mutable dungeon features"
```

---

### Task 12: Add interruptible rest and hidden-state-safe gameplay projection

**Files:**
- Create: `packages/engine/src/rest.ts`
- Create: `packages/engine/src/event-projection.ts`
- Modify: `packages/engine/src/world-step.ts`
- Modify: `packages/engine/src/actions.ts`
- Modify: `packages/engine/src/projection.ts`
- Modify: `packages/engine/src/model.ts`
- Modify: `packages/engine/src/index.ts`
- Create: `packages/engine/test/rest.test.ts`
- Create: `packages/engine/test/event-projection.test.ts`
- Modify: `packages/engine/test/projection.test.ts`
- Modify: `packages/engine/test/browser-boundary.test.ts`
- Modify: `packages/engine/test/gameplay-properties.test.ts`

**Interfaces:**
- Consumes: complete world-step execution, recovery, visible/aware threats, sound events, hunger/fuel stages, conditions, feature/item/actor projections, and typed rest command.
- Produces: `resolveRest(input)`, `RestStopReason`, `projectGameplayState(input)`, `projectDomainEvents(input)`, and public action/decision descriptors.

- [ ] **Step 1: Write failing rest-stop tests for trait-bearing conditions**

```ts
it.each([
  ['full-health', fullHealthRestFixture],
  ['maximum-duration', maximumDurationFixture],
  ['visible-danger', visibleDangerFixture],
  ['aware-hostile', awareHostileFixture],
  ['damage', damageDuringRestFixture],
  ['meaningful-sound', soundDuringRestFixture],
  ['hunger-warning', hungerWarningFixture],
  ['fuel-warning', fuelWarningFixture],
  ['condition-change', conditionChangeFixture],
  ['decision-required', decisionDuringRestFixture],
  ['hero-death', deathDuringRestFixture],
] as const)('stops for %s', (reason, fixture) => {
  expect(resolveRest(fixture()).stopReason).toBe(reason);
});
```

Run: `npm test --workspace @woven-deep/engine -- --run test/rest.test.ts`

Expected: FAIL because rest resolution does not exist.

Include one ordinary active condition without `condition-trait.interrupts-rest` and prove it does not stop rest. Include one differently named condition with the trait and prove that it does, so no condition ID becomes a hidden rule.

- [ ] **Step 2: Implement bounded rest through ordinary world steps**

Validate positive maximum duration from balance and command. Repeatedly resolve the same wait action and scheduler/time pipeline used by normal play. After every internal action/event group, evaluate stop conditions in the exact priority order listed in the spec. Return all events, elapsed time, effective healing, and one typed stop reason. Enforce maximum internal actions and never directly assign health or skip actor actions.

- [ ] **Step 3: Write failing gameplay projection tests**

```ts
it('includes hero resources and visible actors but excludes private scheduler data', () => {
  const json = stableJson(projectGameplayState(gameplayProjectionFixture()));
  expect(json).toContain('monster.visible');
  expect(json).toContain('hungerStage');
  expect(json).not.toContain('monster.hidden');
  expect(json).not.toContain('appearanceByContentId');
  expect(json).not.toContain('reactionReady');
  expect(json).not.toContain('rng');
});

it('projects only public options in a decision request', () => {
  const json = stableJson(projectDecision(hiddenDecisionFixture()));
  expect(json).not.toContain('secret.1');
  expect(json).not.toContain('monster.hidden');
});
```

Run: `npm test --workspace @woven-deep/engine -- --run test/projection.test.ts`

Expected: FAIL because the gameplay projection is incomplete.

- [ ] **Step 4: Implement a composed gameplay projection**

Compose the existing floor projection with hero attributes and derived explanations, health, hunger stage, observable conditions, equipment, backpack items, fuel, identification knowledge, visible actors, discovered features, ground items, and public action availability. Use item and feature projectors from prior tasks. Never copy authoritative records wholesale.

Visible actor intent appears only when its next registered action is already deterministic from public state. Previews show known range, trajectory, cost, modifiers, and effect ranges without rolling or revealing unknown cells.

- [ ] **Step 5: Write failing event-redaction and sound tests**

```ts
it('redacts an unseen attacker while preserving an audible direction', () => {
  expect(projectDomainEvents(unseenAttackEventsFixture())).toEqual([
    { type: 'sound.heard', category: 'combat', direction: 'east', distanceBand: 'near' },
    { type: 'hero.damaged', amount: 3, damageType: 'physical' },
  ]);
});
```

Run: `npm test --workspace @woven-deep/engine -- --run test/event-projection.test.ts`

Expected: FAIL because authoritative events are not redacted.

- [ ] **Step 6: Implement visibility-aware event projection**

Project each event against knowledge at the event's resolution point. Visible participants expose public IDs/presentation; unseen sources become categorized sounds with eight-way direction and coarse distance band. Never expose exact hidden coordinates, hidden content IDs, rolls by unseen actors, future decisions, or private state. Hero damage and resource changes remain observable even when their source is hidden. Replace the conservative projector from Task 6 and persist the finished sequence in `RecordedCommand.publicEvents`; command deduplication returns that saved sequence without re-projecting against later knowledge.

- [ ] **Step 7: Add projection noninterference properties**

Generate pairs of valid authoritative runs that share the same player knowledge but differ only in hidden actors, features, identities, and random streams. Assert `projectGameplayState(left) === projectGameplayState(right)` and projected decisions/events contain no hidden identifiers.

- [ ] **Step 8: Run GREEN and commit**

Run: `npm test --workspace @woven-deep/engine -- --run test/rest.test.ts test/projection.test.ts test/event-projection.test.ts test/browser-boundary.test.ts test/gameplay-properties.test.ts`

Expected: focused suites and noninterference properties pass.

Run: `npm test --workspace @woven-deep/engine && npm run typecheck --workspace @woven-deep/engine`

Expected: engine suite and typecheck pass.

Commit:

```bash
git add packages/engine
git commit -m "feat: rest and project gameplay safely"
```

---

### Task 13: Ship strict bundled gameplay content and a seeded gameplay fixture

**Files:**
- Modify: `content/monsters/cave-rat.yaml`
- Create: `content/monsters/training-beetle.yaml`
- Modify: `content/items/brass-lantern.yaml`
- Create: `content/items/iron-sword.yaml`
- Create: `content/items/hunting-bow.yaml`
- Create: `content/items/wooden-arrows.yaml`
- Create: `content/items/leather-armor.yaml`
- Create: `content/items/wooden-shield.yaml`
- Create: `content/items/pitch-torch.yaml`
- Create: `content/items/lamp-oil.yaml`
- Create: `content/items/travel-ration.yaml`
- Create: `content/items/crimson-potion.yaml`
- Create: `content/items/ashen-potion.yaml`
- Create: `content/items/ember-scroll.yaml`
- Create: `content/items/etched-ring.yaml`
- Create: `content/spells/ember-bolt.yaml`
- Create: `content/traps/rusty-dart-trap.yaml`
- Create: `content/loot-tables/early-provisions.yaml`
- Modify: `content/balance/core-gameplay.yaml`
- Modify: `content/vaults/lampwright-cache.yaml`
- Modify: `packages/content/src/compiler/content-validation.ts`
- Modify: `packages/content/test/default-content.test.ts`
- Modify: `packages/content/test/compile-directory.test.ts`
- Create: `packages/engine/src/gameplay-fixture.ts`
- Modify: `packages/engine/src/index.ts`
- Create: `packages/engine/test/gameplay-fixture.test.ts`

**Interfaces:**
- Consumes: content schema v2/compiler validation, generated floor insertion, gameplay actor/item/feature models, and all 4A resolvers.
- Produces: a complete bundled schema-v2 pack, deterministic generation-pool report, and `createGameplayDemoRun(pack)` returning a valid seeded v3 run plus demonstration IDs.

- [ ] **Step 1: Write failing foundational-content and pool-report tests**

```ts
it('contains every core gameplay category and one balance entry', async () => {
  const pack = await compileDefaultContent();
  expect(kindCounts(pack)).toEqual({
    monster: 2, item: 13, spell: 1, trap: 1, 'loot-table': 1, balance: 1, vault: 1,
  });
});

it('reports provision, light, offense, defense, and identification coverage', async () => {
  expect((await compileDefaultContent()).generationReport.foundationalCategories)
    .toEqual(['defense', 'food', 'healing', 'identification', 'light', 'offense']);
});
```

Run: `npm test --workspace @woven-deep/content -- --run test/default-content.test.ts test/compile-directory.test.ts`

Expected: FAIL because proof content and complete semantic validation are missing.

- [ ] **Step 2: Author schema-v2 YAML proof content**

Extend the source-schema-2 files converted in Task 2 and add the exact files listed above. Use only registered behavior, target, and effect IDs. Give potion definitions compatible shuffled appearances, make the etched ring individually unidentified, make torch/lantern fuel distinct, and ensure early loot contains positive weighted access to food, healing, light, offense, and defense.

Keep values intentionally small and demonstration-oriented. Do not add classes, campaign depth bands, town stock, bosses, or profile unlocks.

- [ ] **Step 3: Complete compiler semantic validation**

Require at least one monster, item, vault, balance entry, and each foundational category. Validate every cross-reference, loot acyclicity, identification pool bijection, effect/target parameters, equipment compatibility, action costs, hunger threshold ordering, speed/energy bounds, damage/resistance ranges, and stable diagnostic ordering. Include source file and entry ID in every error.

- [ ] **Step 4: Write failing seeded gameplay-fixture tests**

```ts
it('builds the same valid gameplay run twice', () => {
  const first = createGameplayDemoRun(compiledPack);
  const second = createGameplayDemoRun(compiledPack);
  expect(stableJson(first.run)).toBe(stableJson(second.run));
  expect(validateActiveRun(first.run)).toEqual(first.run);
  expect(validateContentBoundRun(first.run, compiledPack)).toEqual(first.run);
  expect(first.ids).toMatchObject({ hero: 'hero.gameplay-demo', rat: 'monster.cave-rat.1', beetle: 'monster.training-beetle.1' });
});
```

Run: `npm test --workspace @woven-deep/engine -- --run test/gameplay-fixture.test.ts`

Expected: FAIL because the fixture builder does not exist.

- [ ] **Step 5: Build the deterministic generated-floor scenario**

Use the existing floor-seed allocation and generator. Select valid cells by sorted row-major candidates with explicit distance and line-of-sight constraints. Place the hero, rat, beetle, proof items, one door, one hidden trap, and one secret passage as v3 records. Allocate identification from `rng.effects`, initialize actor energy at the normal threshold, refresh perception, validate the finished run structurally and against the supplied pack, and return all stable IDs needed by scripted commands.

This builder is a demonstration fixture, not the 4B population algorithm.

- [ ] **Step 6: Run content and integration GREEN**

Run: `npm run content:validate`

Expected: exits 0, prints the new deterministic hash and total entry count.

Run: `npm test --workspace @woven-deep/content && npm test --workspace @woven-deep/engine -- --run test/gameplay-fixture.test.ts && npm test --workspace @woven-deep/web && npm test --workspace @woven-deep/server`

Expected: all affected package suites pass.

- [ ] **Step 7: Commit**

```bash
git add content packages/content packages/engine
git commit -m "feat: add core gameplay content"
```

---

### Task 14: Demonstrate replay, strengthen properties, and run milestone gates

**Files:**
- Create: `scripts/gameplay-demo.mjs`
- Modify: `package.json`
- Modify: `Dockerfile`
- Create: `packages/engine/test/gameplay-cli.test.ts`
- Create: `packages/engine/test/gameplay-replay.test.ts`
- Modify: `packages/engine/test/gameplay-properties.test.ts`
- Create: `packages/engine/test/fixtures/gameplay-demo-hashes.json`

**Interfaces:**
- Consumes: compiled default content, `createGameplayDemoRun`, full command reducer, strict save codec, gameplay projection, public event projection, and stable JSON hashing.
- Produces: `npm run gameplay:demo`, checked-in expected hashes, cross-process proof, and final Milestone 4A verification evidence.

- [ ] **Step 1: Write failing continuous-versus-split replay tests**

Script a complete scenario using stable IDs from the fixture:

```ts
const commands = [
  equip('command.01', 'item.iron-sword.1', 'main-hand'),
  equip('command.02', 'item.pitch-torch.1', 'off-hand'),
  move('command.03', 'northeast'),
  attack('command.04', 'monster.cave-rat.1'),
  move('command.05', 'west'), // leaves reach and triggers an opportunity attack
  equip('command.06', 'item.hunting-bow.1', 'main-hand'), // displaces sword and torch because the bow reserves both hands
  fire('command.07', 'item.hunting-bow.1', 'item.wooden-arrows.1', 'monster.training-beetle.1'),
  equip('command.08', 'item.iron-sword.1', 'main-hand'),
  equip('command.09', 'item.pitch-torch.1', 'off-hand'),
  use('command.10', 'item.crimson-potion.1'),
  openDoor('command.11', 'door.demo.1'),
  search('command.12'),
  disarm('command.13', 'trap.rusty-dart.1'),
  rest('command.14', 12),
] as const;
```

Compare uninterrupted execution with saves after commands 2, 5, and 8. Assert byte-identical final save, command results, authoritative events, public events, and gameplay projections.

Run: `npm test --workspace @woven-deep/engine -- --run test/gameplay-replay.test.ts`

Expected: FAIL because the fixture script and expected output are not connected.

- [ ] **Step 2: Implement the replay harness and fix only revealed seam defects**

Use public package exports, not source-only imports. Apply each command with the current revision, encode/decode at requested boundaries, and collect stable JSON records. If the test exposes a seam defect, add the smallest focused regression beside the owning module before fixing it.

- [ ] **Step 3: Write the failing CLI test**

```ts
it('repeats gameplay hashes across two Node processes', () => {
  const first = runGameplayDemo();
  const second = runGameplayDemo();
  expect(first.status).toBe(0);
  expect(second.status).toBe(0);
  expect(first.stdout).toBe(second.stdout);
  expect(first.stdout).toContain('deterministic core gameplay replay verified');
});
```

Run: `npm test --workspace @woven-deep/engine -- --run test/gameplay-cli.test.ts`

Expected: FAIL because `scripts/gameplay-demo.mjs` and the root script are absent.

- [ ] **Step 4: Implement the terminal demonstration**

Add `"gameplay:demo": "npm run build --workspace @woven-deep/content && npm run build --workspace @woven-deep/engine && node scripts/gameplay-demo.mjs --verify"`.

The CLI prints concise ordered sections for movement/corner rules, combat rolls and effective damage, opportunity reactions, item/equipment/identity changes, hunger/fuel/rest transitions, door/trap/secret changes, final actor/item resources, public projection, and stable hashes. `--verify` compares checked-in hashes and internally repeats continuous/split execution.

- [ ] **Step 5: Extend the production Docker verification**

Add `npm run gameplay:demo` to the Docker build-stage verification command after the existing engine and dungeon demonstrations. Do not add runtime development dependencies to the final image.

- [ ] **Step 6: Complete cross-system properties**

Run at least 500 seeded sequences built from schema-valid commands. Assert after every applied step:

```ts
expect(validateActiveRun(step.state)).toEqual(step.state);
expect(validateContentBoundRun(step.state, compiledPack)).toEqual(step.state);
expect(step.state.worldTime).toBeGreaterThanOrEqual(previous.worldTime);
expect(itemQuantityInvariant(step.state)).toBe(true);
expect(equipmentInvariant(step.state)).toBe(true);
expect(reactionInvariant(step.state)).toBe(true);
expect(hiddenStateInvariant(step.state, projectGameplayState(step.state))).toBe(true);
```

Print fast-check seed and shrink path on failure. Add fixed regression examples for every shrunk counterexample before changing implementation.

- [ ] **Step 7: Run focused demonstration GREEN**

Run: `npm run gameplay:demo`

Expected: exits 0 and prints `deterministic core gameplay replay verified` with hashes matching `gameplay-demo-hashes.json`.

Run: `npm test --workspace @woven-deep/engine -- --run test/gameplay-replay.test.ts test/gameplay-cli.test.ts test/gameplay-properties.test.ts`

Expected: replay, cross-process, schema-invariant, conservation, reaction, and noninterference tests pass.

- [ ] **Step 8: Run every fresh milestone gate**

Run in this order from the repository root:

```bash
npm ci
npm run content:validate
npm test
npm run typecheck
npm run build
npm run engine:demo
npm run dungeon:demo
npm run gameplay:demo
docker compose build
git diff --check
git status --short
```

Expected:

- Install succeeds with the lockfile unchanged.
- Content validation reports the checked-in gameplay pack hash and expected entry count.
- All server, web, content, and engine tests pass.
- Every workspace type-checks and builds.
- All three deterministic demonstrations verify.
- Docker image builds and repeats tests, typechecks, builds, and demonstrations.
- `git diff --check` emits no output.
- `git status --short` lists only the intended Task 14 files before commit.

- [ ] **Step 9: Commit the demonstration and verification**

```bash
git add scripts/gameplay-demo.mjs package.json Dockerfile packages/engine/test/gameplay-cli.test.ts packages/engine/test/gameplay-replay.test.ts packages/engine/test/gameplay-properties.test.ts packages/engine/test/fixtures/gameplay-demo-hashes.json
git commit -m "feat: demonstrate core gameplay survival"
```

---

## Milestone completion review

After Task 14 commits:

1. Generate one whole-branch review package from the branch merge base through final HEAD.
2. Dispatch a fresh reviewer to inspect the complete design, plan, diff, live files, schema replacement and rejection behavior, content, hidden-state boundaries, properties, demonstrations, and dependency choices.
3. Classify findings as Critical, Important, or Minor. Fix every Critical and Important issue in one focused RED/GREEN review wave; fix Minor issues when they are local and low risk.
4. Rerun the same whole-branch reviewer against the updated complete diff until no Critical or Important findings remain.
5. Run the full fresh milestone gate list again from the reviewed head; do not rely on task-agent reports.
6. Refresh GitNexus, remove generated helper files from the worktree, confirm the index matches HEAD, and confirm tracked status is clean.
7. Use the finishing-development-branch workflow to offer local merge, draft PR, keep, or discard choices. Report Milestone 4A only; do not describe parent Milestone 4, 4B, or the full game as complete.
