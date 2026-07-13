# YAML Condition Definitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hard-coded condition rules with strict YAML condition definitions and publish complete server-admin documentation for every YAML content surface.

**Architecture:** The content compiler owns the closed vocabulary, structural schemas, and cross-file reference validation. The browser-safe engine resolves compact saved `ConditionState` records through the run-bound compiled content pack and exposes pure helpers for stacking, modifiers, and rule traits. YAML may combine supported mechanics but never define executable code or arbitrary expressions.

**Tech Stack:** TypeScript 5.8, Zod 4, YAML 2.8, Vitest 3, existing stable content compiler and deterministic engine.

## Global Constraints

- Keep the engine browser-safe: no Node APIs, browser storage, I/O, ambient clock, or ambient randomness.
- Keep primitive effect operations and condition traits in closed TypeScript registries with strict Zod parameters.
- Tags are descriptive only and never activate simulation rules.
- Keep saved `ConditionState` compact; definitions remain in the exact content pack identified by `ActiveRun.contentHash`.
- Replace pre-release schema-v2 content in place; do not add compatibility adapters or migrations.
- Reject unknown fields, identifiers, references, modifier names, unsafe integers, and inconsistent duration or stacking combinations at compilation.
- Document every operator-editable YAML kind and every closed registry ID under `docs/server-admin/` in the same change that exposes it.
- Use test-driven development and commit each independently reviewable task.

---

### Task 1: Define strict condition content and bundled definitions

**Files:**
- Modify: `packages/content/src/model.ts`
- Modify: `packages/content/src/compiler/schema.ts`
- Modify: `packages/content/src/compiler/registries.ts`
- Modify: `packages/content/src/index.ts`
- Modify: `packages/content/test/parse-file.test.ts`
- Modify: `packages/content/test/default-content.test.ts`
- Create: `content/conditions/incapacitated.yaml`
- Create: `content/conditions/reaction-rules.yaml`

**Interfaces:**
- Consumes: existing `ContentEntry`, stable IDs, safe-integer schemas, compiled-pack hashing, and global content ordering.
- Produces: `CONTENT_KIND_IDS`, `DERIVED_STAT_NAMES`, `CONDITION_TRAIT_IDS`, `ConditionContentEntry`, `ConditionTraitId`, and strict parsed condition entries.

- [x] **Step 1: Write failing structural schema tests**

Add a complete timed/intensifying condition and a permanent condition to `parse-file.test.ts`:

```ts
it('parses strict timed and permanent condition definitions', () => {
  const entries = parseContentFile({ path: 'conditions/control.yaml', source: `schemaVersion: 2
entries:
  - kind: condition
    id: condition.stunned
    name: Stunned
    description: Cannot take normal actions or reactions.
    tags: [control, harmful]
    color: "#d8c46a"
    duration: { mode: timed, default: 100, maximum: 500 }
    stacking: { mode: intensify, maximumStacks: 3 }
    modifiersPerStack: { defense: -2 }
    traits: [condition-trait.incapacitated, condition-trait.suppresses-reactions]
  - kind: condition
    id: condition.warded
    name: Warded
    description: Protected until explicitly removed.
    tags: [beneficial]
    color: "#80b8ff"
    duration: { mode: permanent, default: null, maximum: null }
    stacking: { mode: refresh, maximumStacks: 1 }
    modifiersPerStack: { defense: 1 }
    traits: []
` });

  expect(entries).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'condition', id: 'condition.stunned' }),
    expect.objectContaining({ kind: 'condition', id: 'condition.warded' }),
  ]));
});
```

Add table-driven rejection cases for an unknown modifier, unknown trait, duplicate/unsorted traits, timed `default > maximum`, permanent numeric duration, and `refresh` with `maximumStacks > 1`.

- [x] **Step 2: Run the parser test to verify RED**

Run: `npm test --workspace @woven-deep/content -- --run test/parse-file.test.ts`

Expected: FAIL because `condition` is not a content kind.

- [x] **Step 3: Add shared content vocabulary and model types**

In `packages/content/src/model.ts`, make the compiler-published vocabulary the single source used by model types and engine imports:

```ts
export const CONTENT_KIND_IDS = [
  'monster', 'item', 'spell', 'trap', 'loot-table', 'balance', 'vault', 'condition',
] as const;
export type ContentKind = typeof CONTENT_KIND_IDS[number];

export const DERIVED_STAT_NAMES = [
  'maxHealth', 'meleeAccuracy', 'meleeDamageBonus', 'rangedAccuracy',
  'defense', 'search', 'disarm',
] as const;
export type DerivedStatName = typeof DERIVED_STAT_NAMES[number];

export const CONDITION_TRAIT_IDS = [
  'condition-trait.avoids-opportunity-attacks',
  'condition-trait.incapacitated',
  'condition-trait.interrupts-rest',
  'condition-trait.suppresses-reactions',
] as const;
export type ConditionTraitId = typeof CONDITION_TRAIT_IDS[number];

export interface ConditionContentEntry extends BaseContentEntry {
  readonly kind: 'condition';
  readonly description: string;
  readonly color: string;
  readonly duration:
    | Readonly<{ mode: 'timed'; default: number; maximum: number }>
    | Readonly<{ mode: 'permanent'; default: null; maximum: null }>;
  readonly stacking: Readonly<{
    mode: 'replace' | 'refresh' | 'intensify';
    maximumStacks: number;
  }>;
  readonly modifiersPerStack: Readonly<Partial<Record<DerivedStatName, number>>>;
  readonly traits: readonly ConditionTraitId[];
}
```

Append `ConditionContentEntry` to `ContentEntry`. Export the constants and types through the browser-safe root `packages/content/src/index.ts`.

- [x] **Step 4: Add the strict Zod condition schema**

In `packages/content/src/compiler/schema.ts`, import the published arrays and define discriminated duration variants plus cross-field refinement:

```ts
const conditionDuration = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('timed'), default: safePositive, maximum: safePositive })
    .refine((value) => value.default <= value.maximum, {
      path: ['default'], message: 'default duration must not exceed maximum duration',
    }),
  z.strictObject({ mode: z.literal('permanent'), default: z.null(), maximum: z.null() }),
]);

const conditionEntry = z.strictObject({
  ...base,
  kind: z.literal('condition'),
  description: z.string().trim().min(1).max(500),
  color,
  duration: conditionDuration,
  stacking: z.strictObject({
    mode: z.enum(['replace', 'refresh', 'intensify']),
    maximumStacks: safePositive.max(100),
  }),
  modifiersPerStack: z.partialRecord(z.enum(DERIVED_STAT_NAMES), safeInteger).default({}),
  traits: z.array(z.enum(CONDITION_TRAIT_IDS)).default([]),
}).superRefine((entry, context) => {
  if (entry.stacking.mode !== 'intensify' && entry.stacking.maximumStacks !== 1) {
    context.addIssue({ code: 'custom', path: ['stacking', 'maximumStacks'],
      message: 'replace and refresh conditions require maximumStacks 1' });
  }
  for (let index = 1; index < entry.traits.length; index += 1) {
    if (entry.traits[index - 1]! >= entry.traits[index]!) {
      context.addIssue({ code: 'custom', path: ['traits', index],
        message: 'condition traits must be unique and sorted' });
      break;
    }
  }
});
```

Add `conditionEntry` to the content discriminated union. Keep `CONTENT_SCHEMA_VERSION` at `2` under the approved pre-release replacement policy.

- [x] **Step 5: Add bundled rule definitions and update stable expectations**

Create YAML definitions for:

- `condition.incapacitated`: permanent, refresh, one stack, `condition-trait.incapacitated`.
- `condition.reaction-suppressed`: timed, refresh, one stack, `condition-trait.suppresses-reactions`.
- `condition.disengaged`: timed, refresh, one stack, `condition-trait.avoids-opportunity-attacks`.
- `condition.restless`: timed, refresh, one stack, `condition-trait.interrupts-rest`.

Use sorted traits and ordinary presentation metadata. Update `default-content.test.ts` to expect the four condition IDs in global code-unit order and to validate the JSON-round-tripped pack.

- [x] **Step 6: Run content GREEN**

Run: `npm test --workspace @woven-deep/content -- --run test/parse-file.test.ts test/default-content.test.ts`

Expected: PASS with the new strict definitions and unchanged deterministic hashing behavior.

- [x] **Step 7: Commit**

```bash
git add packages/content content/conditions
git commit -m "feat: define conditions in YAML"
```

---

### Task 2: Validate condition references and duration contracts

**Files:**
- Modify: `packages/content/src/compiler/registries.ts`
- Modify: `packages/content/src/compiler/content-validation.ts`
- Modify: `packages/content/test/compile-directory.test.ts`
- Modify: `packages/content/test/content-schema.test.ts` if present; otherwise `packages/content/test/model.test.ts`

**Interfaces:**
- Consumes: compiled content map, `ConditionContentEntry`, and inline item/spell/trap `EffectDefinition` arrays.
- Produces: optional authored condition duration plus deterministic source-path diagnostics for missing, wrong-kind, permanent, and over-maximum references.

- [x] **Step 1: Write failing semantic-reference tests**

Extend the compile-directory fixture with a condition definition and add these cases:

```ts
it.each([
  ['missing condition', 'condition.missing', undefined, /unknown condition reference condition\.missing/],
  ['wrong content kind', 'item.lantern', undefined, /condition reference item\.lantern resolves to item/],
  ['duration above maximum', 'condition.stunned', 501, /duration 501 exceeds maximum 500/],
])('rejects %s', async (_label, conditionId, duration, message) => {
  const effect = conditionApplyEffect({ conditionId, duration });
  const root = await fixtureWithConditions(effect);
  await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(message);
});
```

Add a permanent-condition case that rejects any authored duration and accepts an omitted duration. Assert the exact issue file and path includes `effects.<index>.parameters.duration`.

- [x] **Step 2: Run the compiler test to verify RED**

Run: `npm test --workspace @woven-deep/content -- --run test/compile-directory.test.ts`

Expected: FAIL because duration is required and condition IDs are not resolved semantically.

- [x] **Step 3: Make authored duration optional and validate against definitions**

Change only the primitive parameter schema:

```ts
'effect.condition.apply': z.strictObject({
  conditionId: stableIdSchema,
  duration: safePositive.optional(),
}),
```

Extend `effectIssues` to receive the `byId` content map. After generic parameter validation succeeds, inspect condition operations:

```ts
function conditionReferenceIssues(
  file: string,
  path: string,
  effect: EffectDefinition,
  byId: ReadonlyMap<string, ContentEntry>,
): ContentCompileIssue[] {
  if (effect.effectId !== 'effect.condition.apply'
    && effect.effectId !== 'effect.condition.remove') return [];
  const conditionId = effect.parameters.conditionId;
  const target = typeof conditionId === 'string' ? byId.get(conditionId) : undefined;
  if (!target) return [issue(file, `${path}.parameters.conditionId`,
    `unknown condition reference ${String(conditionId)}`)];
  if (target.kind !== 'condition') return [issue(file, `${path}.parameters.conditionId`,
    `condition reference ${conditionId} resolves to ${target.kind}`)];
  if (effect.effectId !== 'effect.condition.apply') return [];
  const duration = effect.parameters.duration;
  if (target.duration.mode === 'permanent' && duration !== undefined) {
    return [issue(file, `${path}.parameters.duration`, 'permanent condition rejects a duration override')];
  }
  if (target.duration.mode === 'timed' && typeof duration === 'number'
    && duration > target.duration.maximum) {
    return [issue(file, `${path}.parameters.duration`,
      `duration ${duration} exceeds maximum ${target.duration.maximum}`)];
  }
  return [];
}
```

Run this after registry parameter validation for item, spell, and trap effects. Preserve deterministic issue sorting.

- [x] **Step 4: Prove compiled-pack validation repeats semantic checks**

Add a test that serializes a valid pack, mutates an effect condition reference, and verifies `validateCompiledContentPack` rejects it. This ensures downloaded or stored compiled packs cannot bypass source compilation.

- [x] **Step 5: Run content package GREEN**

Run: `npm test --workspace @woven-deep/content && npm run typecheck --workspace @woven-deep/content`

Expected: all content tests and type checking pass.

- [x] **Step 6: Commit**

```bash
git add packages/content
git commit -m "feat: validate condition content references"
```

---

### Task 3: Resolve definitions, stacking, traits, and modifiers in the engine

**Files:**
- Create: `packages/engine/src/conditions.ts`
- Modify: `packages/engine/src/effects.ts`
- Modify: `packages/engine/src/attributes.ts`
- Modify: `packages/engine/src/fixture.ts`
- Modify: `packages/engine/src/index.ts`
- Modify: `packages/engine/test/conditions.test.ts`
- Modify: `packages/engine/test/effects.test.ts`
- Modify: `packages/engine/test/attributes.test.ts`

**Interfaces:**
- Consumes: `CompiledContentPack`, `ConditionContentEntry`, compact `ConditionState`, actor arrays, authored optional duration, and absolute world time.
- Produces: `conditionDefinition`, `validateActiveConditions`, `actorHasConditionTrait`, `conditionModifiers`, `applyCondition`, and definition-driven `resolveEffectSequence` behavior.

- [x] **Step 1: Write failing lookup, trait, and modifier tests**

Create fixtures whose condition IDs deliberately do not imply their behavior:

```ts
it('resolves traits and linear modifiers by content rather than condition ID', () => {
  const content = packWithCondition({
    id: 'condition.blue', traits: ['condition-trait.incapacitated'],
    modifiersPerStack: { defense: -2 },
  });
  const actor = actorWithCondition('condition.blue', 3);
  expect(actorHasConditionTrait(actor, 'condition-trait.incapacitated', content)).toBe(true);
  expect(conditionModifiers(actor, content)).toEqual([{ defense: -6 }]);
});
```

Add rejection tests for a missing definition and unsafe multiplication.

- [x] **Step 2: Write failing stacking tests**

Cover replace, refresh, intensify, intensify-at-cap, permanent deadline, authored duration, default duration, and input immutability. Use exact resulting `sourceActorId`, `appliedAt`, `expiresAt`, `stacks`, and `condition.applied` event values.

- [x] **Step 3: Run the engine tests to verify RED**

Run: `npm run build --workspace @woven-deep/content && npm test --workspace @woven-deep/engine -- --run test/conditions.test.ts test/effects.test.ts test/attributes.test.ts`

Expected: FAIL because the content-backed condition helpers do not exist.

- [x] **Step 4: Implement the pure condition module**

Create `conditions.ts` with these public contracts:

```ts
export function conditionDefinition(
  content: CompiledContentPack,
  conditionId: OpaqueId,
): ConditionContentEntry;

export function actorHasConditionTrait(
  actor: ActorState,
  trait: ConditionTraitId,
  content: CompiledContentPack,
): boolean;

export function validateActiveConditions(
  actors: readonly ActorState[],
  content: CompiledContentPack,
): void;

export function conditionModifiers(
  actor: ActorState,
  content: CompiledContentPack,
): readonly DerivedStatModifier[];

export function applyCondition(input: Readonly<{
  actors: readonly ActorState[];
  content: CompiledContentPack;
  targetActorId: OpaqueId;
  sourceActorId: OpaqueId;
  conditionId: OpaqueId;
  duration?: number;
  worldTime: number;
  eventId: OpaqueId;
}>): Readonly<{ actors: readonly ActorState[]; events: readonly DomainEvent[] }>;
```

Use checked safe-integer helpers for stack increments, modifier multiplication, and absolute deadlines. Throw an internal-invariant error for an unresolved or wrong-kind definition. Sort resulting actor conditions by `conditionId` and never mutate the input pack, actors, or conditions.

`validateActiveConditions` checks every actor condition, including actors not currently eligible for scheduling. It rejects an unresolved definition, stacks above `maximumStacks`, a permanent definition with a non-null deadline, or a timed definition with a null deadline. This is the content-bound half of save validation; the structural save codec remains independent of content I/O.

- [x] **Step 5: Route condition effects through the new module**

Add `content: CompiledContentPack` to `EffectSequenceInput`. Replace inline condition-apply logic with `applyCondition`; keep removal and expiration state transitions pure. Update every effect fixture and `createDemoContentPack()` with the required condition definitions.

- [x] **Step 6: Share derived-stat vocabulary without duplication**

In `attributes.ts`, import and re-export `DERIVED_STAT_NAMES` and `DerivedStatName` from `@woven-deep/content`. Keep `deriveActorStats`'s existing `conditionModifiers` input and feed it the output of the new helper at higher-level callers. Do not make `deriveActorStats` search a content pack itself.

- [x] **Step 7: Run focused GREEN**

Run: `npm run build --workspace @woven-deep/content && npm test --workspace @woven-deep/engine -- --run test/conditions.test.ts test/effects.test.ts test/attributes.test.ts && npm run typecheck --workspace @woven-deep/engine`

Expected: all focused tests pass with exact event and stack assertions.

- [x] **Step 8: Commit**

```bash
git add packages/engine
git commit -m "feat: resolve YAML condition rules"
```

---

### Task 4: Remove scheduler special IDs and expose rule traits to later systems

**Files:**
- Modify: `packages/engine/src/scheduler.ts`
- Modify: `packages/engine/test/scheduler.test.ts`
- Modify: `packages/engine/test/save-codec.test.ts`
- Modify: `docs/superpowers/plans/2026-07-13-core-gameplay-survival.md`

**Interfaces:**
- Consumes: `actorHasConditionTrait`, compiled content, scheduler actor state, and the exact run content hash.
- Produces: content-aware `selectReadyActor` and `advanceToNextReady`; Task 6 consumes the same trait helper for reactions and Task 12 consumes it for rest.

- [ ] **Step 1: Write a failing scheduler test using an unrelated condition ID**

```ts
it('excludes actors by the incapacitated trait rather than a special ID', () => {
  const content = packWithCondition({
    id: 'condition.blue', traits: ['condition-trait.incapacitated'],
  });
  const sleeping = actor({ actorId: 'monster.sleeping', energy: 1000,
    conditions: [conditionState('condition.blue')] });
  const hero = actor({ actorId: 'hero.demo', playerControlled: true, energy: 100 });
  expect(selectReadyActor([sleeping, hero], content)?.actorId).toBe('hero.demo');
});
```

Add the inverse assertion: an actor carrying `condition.incapacitated` without the trait remains eligible. This proves names and tags have no hidden behavior.

- [ ] **Step 2: Run scheduler RED**

Run: `npm test --workspace @woven-deep/engine -- --run test/scheduler.test.ts`

Expected: FAIL because scheduler selection has no content argument and still compares a special ID.

- [ ] **Step 3: Make scheduler selection content-aware**

Remove `INCAPACITATED_CONDITION_ID`. Change signatures consistently:

```ts
export function selectReadyActor(
  actors: readonly ActorState[],
  content: CompiledContentPack,
): ActorState | undefined;

export interface SchedulerState {
  readonly worldTime: number;
  readonly actors: readonly ActorState[];
  readonly content: CompiledContentPack;
}
```

The private eligibility check becomes `actor.health > 0 && !actorHasConditionTrait(actor, 'condition-trait.incapacitated', content)`. Call `validateActiveConditions` once at the command/content attachment boundary before scheduling so every saved actor condition is checked, not only conditions consulted during selection. Update all scheduler callers and fixtures explicitly; do not install a global content singleton or infer content from IDs.

- [ ] **Step 4: Preserve save/replay behavior**

Run save-codec and replay tests with actors carrying defined conditions. Verify the definition remains absent from encoded active-run bytes while the exact `contentHash` remains present.

Run: `npm test --workspace @woven-deep/engine -- --run test/scheduler.test.ts test/save-codec.test.ts test/replay.test.ts`

Expected: PASS.

- [ ] **Step 5: Amend downstream roadmap contracts**

Ensure Task 6 explicitly checks:

```ts
actorHasConditionTrait(attacker, 'condition-trait.suppresses-reactions', content)
actorHasConditionTrait(mover, 'condition-trait.avoids-opportunity-attacks', content)
```

Ensure Task 12 explicitly uses `condition-trait.interrupts-rest`, including the ordinary-condition negative test. Do not implement reactions or rest in this prerequisite.

- [ ] **Step 6: Run engine GREEN and commit**

Run: `npm test --workspace @woven-deep/engine && npm run typecheck --workspace @woven-deep/engine`

Expected: all engine tests and type checking pass.

```bash
git add packages/engine docs/superpowers/plans/2026-07-13-core-gameplay-survival.md
git commit -m "refactor: schedule actors by condition traits"
```

---

### Task 5: Publish and enforce the server-admin YAML reference

**Files:**
- Create: `docs/server-admin/README.md`
- Create: `docs/server-admin/content-configuration.md`
- Modify: `docs/operations/content-and-storage.md`
- Create: `packages/content/test/admin-docs.test.ts`

**Interfaces:**
- Consumes: `CONTENT_KIND_IDS`, targeting/damage/equipment/vault arrays, behavior/effect registries, `CONDITION_TRAIT_IDS`, compiler bounds, and existing container operations.
- Produces: the operator-facing content reference and a package-gate check that every published YAML kind and registry ID is documented.

- [ ] **Step 1: Write the failing documentation-consistency test**

Read the admin reference from the repository root and require exact backticked tokens:

```ts
it('documents every YAML content kind and closed registry ID', async () => {
  const reference = await readFile(resolve(import.meta.dirname,
    '../../../docs/server-admin/content-configuration.md'), 'utf8');
  const required = [
    ...CONTENT_KIND_IDS,
    ...damageTypes,
    ...targetingIds,
    ...equipmentSlots,
    ...vaultPlacementKinds,
    ...Object.keys(BEHAVIOR_PARAMETER_SCHEMAS),
    ...Object.keys(EFFECT_PARAMETER_SCHEMAS),
    ...CONDITION_TRAIT_IDS,
  ];
  for (const identifier of required) {
    expect(reference, `missing admin documentation for ${identifier}`)
      .toContain(`\`${identifier}\``);
  }
});
```

Export any currently private compiler vocabulary arrays needed by this test through `@woven-deep/content/compiler`; keep the engine's root browser-safe graph free of Node modules.

- [ ] **Step 2: Run the docs test to verify RED**

Run: `npm test --workspace @woven-deep/content -- --run test/admin-docs.test.ts`

Expected: FAIL because the server-admin reference does not exist.

- [ ] **Step 3: Create the server-admin index**

`docs/server-admin/README.md` links to the content reference and the existing storage/backup operations. State that changes must be validated in staging, mounted read-only as a complete content directory, and reviewed like code because they change deterministic gameplay and the content hash.

- [ ] **Step 4: Write the complete content-configuration reference**

Use these exact top-level sections so administrators can scan and link to stable anchors:

```markdown
# Server content configuration

## Safe editing workflow
## Directory and file discovery
## File envelope and common fields
## Identifiers and cross-file references
## Balance entries
## Monster entries
## Item entries
## Spell entries
## Trap entries
## Loot-table entries
## Vault entries
## Condition entries
## Closed behavior registry
## Closed targeting registry
## Closed primitive-effect registry
## Closed condition-trait registry
## Validation diagnostics
## Content hashes, active runs, and rollback
## Complete examples
```

For every entry field, include a table with field path, YAML type, required/default, accepted bounds or enum, and gameplay meaning. Include complete copyable YAML documents for all eight content kinds, not fragments. Explain that adding a new instance or combination of existing primitives needs only YAML, while a new primitive behavior/effect/trait requires code, a strict schema, tests, and a documentation update.

Document safe deployment commands exactly:

```bash
npm run content:validate -- /absolute/path/to/content
docker compose up -d --force-recreate --wait --wait-timeout 60
node scripts/smoke.mjs http://localhost:3000
```

Explain that the mounted directory replaces rather than overlays bundled content, startup rejects the entire pack on any issue, and an active run cannot silently switch to a different content hash.

- [ ] **Step 5: Link operations documentation without duplicating schema**

At the start of `docs/operations/content-and-storage.md`, link to `../server-admin/content-configuration.md`. Keep operational mount, verification, and SQLite backup procedures there; keep field definitions solely in the server-admin reference.

- [ ] **Step 6: Run documentation and full repository GREEN**

Run:

```bash
npm test --workspace @woven-deep/content -- --run test/admin-docs.test.ts
npm test
npm run typecheck
npm run build
npm run content:validate
git diff --check
```

Expected: documentation consistency, all workspace tests, all type checks, production builds, bundled content validation, and whitespace checks pass.

- [ ] **Step 7: Commit**

```bash
git add docs/server-admin docs/operations/content-and-storage.md packages/content/test/admin-docs.test.ts packages/content/src
git commit -m "docs: publish server YAML reference"
```

---

### Task 6: Review the prerequisite and resume core gameplay

**Files:**
- Modify: `docs/superpowers/plans/2026-07-13-yaml-condition-definitions.md`
- Modify: `docs/superpowers/plans/2026-07-13-core-gameplay-survival.md`

**Interfaces:**
- Consumes: all prior task gates and commits.
- Produces: a checked-off prerequisite and a clean boundary for core-gameplay Task 6.

- [ ] **Step 1: Review the complete diff against the design**

Verify there is no hard-coded condition ID in engine rule logic:

```bash
rg -n "condition\.[a-z]" packages/engine/src
```

Expected: condition identifiers may occur in event names or fixtures, but scheduling and rule decisions use `ConditionTraitId` helpers.

Verify no YAML scripting surface exists:

```bash
rg -n "eval\(|new Function|script|expression" packages/content/src packages/engine/src
```

Expected: no executable content mechanism.

- [ ] **Step 2: Re-run the final gate from clean package outputs**

Run:

```bash
npm test
npm run typecheck
npm run build
npm run content:validate
git status --short
```

Expected: every command passes and only the two plan checkbox updates remain.

- [ ] **Step 3: Mark both plans complete and commit tracking**

Check every completed step in this plan and mark core-gameplay Task 5A complete. Commit only those tracking changes:

```bash
git add docs/superpowers/plans/2026-07-13-yaml-condition-definitions.md docs/superpowers/plans/2026-07-13-core-gameplay-survival.md
git commit -m "docs: complete YAML condition prerequisite"
```

- [ ] **Step 4: Resume Task 6**

Continue at `### Task 6: Add relationships, opportunity reactions, and atomic world steps` in `docs/superpowers/plans/2026-07-13-core-gameplay-survival.md`. Use the condition-trait helpers already established; do not recreate suppression tags or special condition IDs.
