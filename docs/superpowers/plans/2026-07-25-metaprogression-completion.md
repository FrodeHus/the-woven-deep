# Metaprogression Completion (7C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn achievements into a parameterized, referentially-validated criteria system with a real 10-entry roster, and make class-unlock conditions data-driven (fixing the current hint↔rule drift), behavior-identical for the two locked classes.

**Architecture:** A structured `criteria` discriminated union replaces the fixed `criteriaId` enum on achievement content; the deterministic engine (`run-finalize.ts`) evaluates it against the run outcome, using one new per-run signal (`RunMetrics.defeatedBossMonsterIds`) plus already-tracked `deepestDepth`/`completionType`/`fallenHeroDecisions`. A structured `unlock` union on class content replaces the hardcoded `UNLOCK_RULES` map in `session-core`. Both persisted changes (the metrics field; dropping the achievement event's `criteriaId`) carry save-schema version bumps + migrations.

**Tech Stack:** TypeScript 5.8 (strict + exactOptionalPropertyTypes), ESM `.js` specifiers, Zod v4 STRICT (`z.strictObject`/`z.discriminatedUnion`), Vitest, deterministic seeded engine. npm workspaces: `@woven-deep/content`, `@woven-deep/engine`, `@woven-deep/session-core`, `apps/server`, `apps/web`.

## Global Constraints

- **Determinism is a hard invariant.** Achievement/finalize logic stays pure and clock-free. Any change to `RunMetrics`, the achievement event, or content shifts demo fixtures; each demo-affecting task regenerates the content-hash-embed fixtures and diff-checks (intended grant/metrics shift on `run-records`/`endgame` vs benign hash-embed elsewhere), and the cross-process parity harness (`npx vitest run --root apps/server determinism-parity`) must stay green.
- **Save-schema changes require a `SAVE_SCHEMA_VERSION` bump + a migration** (mirror the existing `legacyActiveRunV*Schema` chain in `packages/engine/src/save-schema/migrations.ts`). Old saves must load: a new `metrics` field defaults to `[]`; the dropped achievement-event `criteriaId` is stripped on migration.
- **Behavior-preserving unlocks:** the two locked classes (`class.warden` = any Hall record with `deepestDepth >= 10`; `class.archivist` = `conqueredChampionRecordIds.length >= 3`) unlock under identical conditions after the refactor — only the source of truth moves from TS to content, and the hint text is corrected to match.
- **Caster/scope boundaries:** no new classes; no dialogue/journal (foreshadowing is deferred to issue #79); no new client surfaces (achievements already flow via the finalize/profile payloads); criteria use only already-tracked signals plus the one boss-set addition.
- STRICT content validation; every referenced id/value resolves. Run `npx prettier --write` on changed files; `npm run verify` must pass before each commit.
- **Fixture-regen recipe** (per affected demo): build content+engine, run the demo script WITHOUT `--verify` (it writes candidate hashes to a temp path), diff candidate vs the reviewed fixture, and copy over ONLY the intended/benign moves; then re-run `--verify`.

---

### Task 1: Per-run defeated-boss tracking (`RunMetrics.defeatedBossMonsterIds` + save-schema + migration)

**Files:**
- Modify: `packages/engine/src/run-metrics.ts` (add field to `RunMetrics`/`emptyRunMetrics`; accumulate in `foldRunMetrics` `boss.defeated` case; union in the lifetime aggregate)
- Modify: `packages/engine/src/save-schema/run-record.ts` (add field to the `runMetrics` schema), `packages/engine/src/save-schema/migrations.ts` (migration), `packages/engine/src/versions.ts` (bump `SAVE_SCHEMA_VERSION`)
- Test: `packages/engine/test/defeated-boss-metrics.test.ts` (create); extend an existing save round-trip/migration test

**Interfaces:**
- Produces: `RunMetrics.defeatedBossMonsterIds: readonly OpaqueId[]` (sorted ascending by `compareCodeUnits`, deduped) — the set of `monster` ids whose boss the run defeated. Consumed by Task 2's `achievementGrants`.

- [ ] **Step 1: Write the failing test for the fold**

Create `packages/engine/test/defeated-boss-metrics.test.ts`. It folds a `boss.defeated` event (with `encounterId: 'encounter.ashfather'`) through `foldRunMetrics` against real content and asserts `metrics.defeatedBossMonsterIds` contains `'monster.ashfather'` (the encounter's `definition.monsterId`), sorted+deduped, and that a run with no boss defeat yields `[]`.

```ts
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { emptyRunMetrics, foldRunMetrics } from '../src/index.js';

let content: CompiledContentPack;
beforeAll(async () => {
  content = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
});

describe('defeatedBossMonsterIds', () => {
  it('records the monster id of a defeated boss, resolved from the encounter', () => {
    const metrics = foldRunMetrics(emptyRunMetrics(), [
      { type: 'boss.defeated', eventId: 'event.x', populationId: 'pop.1', actorId: 'actor.1', encounterId: 'encounter.ashfather' },
    ] as never, content);
    expect(metrics.defeatedBossMonsterIds).toEqual(['monster.ashfather']);
  });

  it('is empty when no boss was defeated and dedupes/sorts multiple', () => {
    expect(emptyRunMetrics().defeatedBossMonsterIds).toEqual([]);
    const metrics = foldRunMetrics(emptyRunMetrics(), [
      { type: 'boss.defeated', eventId: 'e1', populationId: 'p', actorId: 'a', encounterId: 'encounter.tide-sovereign' },
      { type: 'boss.defeated', eventId: 'e2', populationId: 'p', actorId: 'a', encounterId: 'encounter.ashfather' },
      { type: 'boss.defeated', eventId: 'e3', populationId: 'p', actorId: 'a', encounterId: 'encounter.ashfather' },
    ] as never, content);
    expect(metrics.defeatedBossMonsterIds).toEqual(['monster.ashfather', 'monster.tide-sovereign']);
  });
});
```

> Implementer note: confirm `foldRunMetrics`'s exact signature (it takes prior metrics, events, and `content`) and the `boss.defeated` event field names from `packages/engine/src/run-metrics.ts` and `events-model.ts`; adjust the test's event literal to match. If `foldRunMetrics` is not exported from the barrel, import from `../src/run-metrics.js`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --root packages/engine defeated-boss-metrics`
Expected: FAIL — `defeatedBossMonsterIds` does not exist.

- [ ] **Step 3: Add the field to the model + fold**

In `packages/engine/src/run-metrics.ts`:
- Add `readonly defeatedBossMonsterIds: readonly OpaqueId[];` to `RunMetrics` (after `bossKills`), import `OpaqueId` if needed.
- Add `defeatedBossMonsterIds: [],` to `emptyRunMetrics()`.
- In `foldRunMetrics`, maintain a `defeatedBossMonsters = new Set<string>(metrics.defeatedBossMonsterIds)`; in the `case 'boss.defeated':` block, resolve the monster id from the event's `encounterId` and add it:

```ts
      case 'boss.defeated': {
        bossKills = checkedAdd(bossKills, 1, 'bossKills');
        const encounter = content.entries.find(
          (entry): entry is Extract<typeof entry, { kind: 'encounter' }> =>
            entry.kind === 'encounter' && entry.id === event.encounterId,
        );
        if (encounter && encounter.model === 'boss') defeatedBossMonsters.add(encounter.definition.monsterId);
        break;
      }
```

- In the metrics object the fold returns, add
  `defeatedBossMonsterIds: [...defeatedBossMonsters].sort(compareCodeUnits),`
  (import `compareCodeUnits` from `./stable-json.js` if not already).

If a separate lifetime aggregate function combines two `RunMetrics` (search `run-metrics.ts` for where lifetime totals are summed), union the two `defeatedBossMonsterIds` there: `[...new Set([...a.defeatedBossMonsterIds, ...b.defeatedBossMonsterIds])].sort(compareCodeUnits)`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --root packages/engine defeated-boss-metrics`
Expected: PASS.

- [ ] **Step 5: Save-schema field + version bump + migration**

- In `packages/engine/src/save-schema/run-record.ts`, add `defeatedBossMonsterIds: z.array(identifier).readonly()` to the `runMetrics` schema (match the existing field style; `identifier`/`OpaqueId` schema is already imported there).
- In `packages/engine/src/versions.ts`, bump `SAVE_SCHEMA_VERSION` by 1 (record the old value; e.g. `9 → 10`).
- In `packages/engine/src/save-schema/migrations.ts`, add a migration from the previous version that adds `defeatedBossMonsterIds: []` to every `metrics` object it encounters (in the active-run `metrics` and in each record's `metrics`). Mirror the newest existing `legacyActiveRunV*Schema` + its migration function: define a `legacyActiveRunV<old>Schema` capturing the pre-field shape and a migrator that spreads `metrics` with `defeatedBossMonsterIds: []`. Follow the exact chaining pattern already in the file.

- [ ] **Step 6: Migration + save round-trip test**

Extend the existing save-schema/migration test (find it via `grep -rl "SAVE_SCHEMA_VERSION\|legacyActiveRun" packages/engine/test`) with a case: a pre-bump save (metrics without `defeatedBossMonsterIds`) migrates to include `defeatedBossMonsterIds: []`, and a current save with the field round-trips (encode→decode) byte-identically. Follow the existing migration-test structure.

Run: `npm run build --workspace @woven-deep/content && npm run build --workspace @woven-deep/engine && npm run test --workspace @woven-deep/engine`
Expected: the new + migration tests PASS. The `*-cli.test.ts` fixture guards will now be RED because `run.metrics` gained a field (save/record hashes moved) — Step 7 regenerates them.

- [ ] **Step 7: Regenerate fixtures + diff-check + parity**

Regenerate the content-hash-embed demo fixtures (recipe in Global Constraints) for all 7 demos. Expected: every demo whose hashed save/record embeds `RunMetrics` moves its save/record hash by the added field; `run-records`/`endgame` additionally populate `defeatedBossMonsterIds` on runs that defeat bosses (intended). Diff-check each: no projection/events hash should move for a demo that defeats no boss beyond the metrics-shape change. Then:

```bash
npm run test --workspace @woven-deep/engine
npx vitest run --root apps/server determinism-parity
```
Expected: PASS.

- [ ] **Step 8: Full verify, format, commit**

```bash
npm run verify
npx prettier --write packages/engine/src/run-metrics.ts packages/engine/src/save-schema/run-record.ts packages/engine/src/save-schema/migrations.ts packages/engine/src/versions.ts packages/engine/test/defeated-boss-metrics.test.ts
git add packages/engine/ 
git commit -m "feat(engine): record the per-run set of defeated boss monster ids"
```

---

### Task 2: Parameterized achievement criteria (content model + engine evaluation + save-schema)

**Files:**
- Modify: `packages/content/src/model/achievement.ts`, `packages/content/src/compiler/schema/achievement.ts`, `packages/content/src/compiler/validation/achievement.ts`
- Modify: `content/achievements/first-defeats.yaml` (migrate the 2 existing to the new model)
- Modify: `packages/engine/src/run-finalize.ts` (rewrite `achievementGrants`), `packages/engine/src/run-records-model.ts` (`AchievementGrant`), `packages/engine/src/events-model.ts` (`AchievementGrantedEvent`), `packages/engine/src/save-schema/events.ts` (event schema), `packages/engine/src/save-schema/migrations.ts` (migration), `packages/engine/src/versions.ts` (bump)
- Modify: `apps/web/src/ui/overlays/SettingsOverlay.test.tsx` (mock update)
- Test: `packages/engine/test/achievement-criteria.test.ts` (create); `packages/content/test` compile

**Interfaces:**
- Consumes: `RunMetrics.defeatedBossMonsterIds` (Task 1).
- Produces: `AchievementCriteria` union + `ACHIEVEMENT_CRITERIA_TYPES`; `AchievementContentEntry.criteria`; `AchievementGrant { achievementId, name }` and `AchievementGrantedEvent { type, eventId, achievementId, name }` (both lose `criteriaId`).

- [ ] **Step 1: Replace the content model**

In `packages/content/src/model/achievement.ts`, replace the file body with:

```ts
import type { BaseContentEntry, ContentId } from './common.js';

export const ACHIEVEMENT_CRITERIA_TYPES = [
  'defeat-boss',
  'defeat-fallen-hero',
  'reach-depth',
  'complete-ending',
] as const;
export type AchievementCriteriaType = (typeof ACHIEVEMENT_CRITERIA_TYPES)[number];

export const ACHIEVEMENT_ENDINGS = ['became-heart', 'refused', 'broke-cycle'] as const;
export type AchievementEnding = (typeof ACHIEVEMENT_ENDINGS)[number];

export type AchievementCriteria =
  | { readonly type: 'defeat-boss'; readonly monsterId: ContentId }
  | { readonly type: 'defeat-fallen-hero'; readonly role: 'champion' | 'echo' }
  | { readonly type: 'reach-depth'; readonly depth: number }
  | { readonly type: 'complete-ending'; readonly ending: AchievementEnding };

export interface AchievementContentEntry extends BaseContentEntry {
  readonly kind: 'achievement';
  readonly description: string;
  readonly criteria: AchievementCriteria;
}
```

Remove `ACHIEVEMENT_CRITERIA_IDS`/`AchievementCriteriaId`. Update the content package barrel (`packages/content/src/model.ts` or `index.ts`) to export the new symbols and drop the old ones (follow how the old symbols were exported). `ContentId` is the existing id type in `common.ts`.

- [ ] **Step 2: Update the schema**

In `packages/content/src/compiler/schema/achievement.ts`:

```ts
import { z } from 'zod';
import { ACHIEVEMENT_ENDINGS } from '../../model.js';
import { base, contentId } from './common.js';

export const achievementEntry = z.strictObject({
  ...base,
  kind: z.literal('achievement'),
  description: z.string().trim().min(1).max(200),
  criteria: z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('defeat-boss'), monsterId: contentId }),
    z.strictObject({ type: z.literal('defeat-fallen-hero'), role: z.enum(['champion', 'echo']) }),
    z.strictObject({ type: z.literal('reach-depth'), depth: z.number().int().min(1).max(20) }),
    z.strictObject({ type: z.literal('complete-ending'), ending: z.enum(ACHIEVEMENT_ENDINGS) }),
  ]),
});
```

> Implementer note: use the same content-id schema helper the other schemas use for id references (grep `schema/common.ts` for the exported id validator — it may be named `contentId`, `identifier`, or similar). Match its name.

- [ ] **Step 3: Update validation (drop 1:1, add referential integrity)**

Rewrite `packages/content/src/compiler/validation/achievement.ts` so it no longer enforces one-achievement-per-criterion. Instead, for each achievement with a `defeat-boss` criterion, assert its `monsterId` resolves to a `monster` entry tagged `boss`:

```ts
import type { ContentCompileIssue } from '../error.js';
import { issue, type LocatedContentEntry } from './shared.js';

export function achievementIssues(
  locatedEntries: readonly LocatedContentEntry[],
): ContentCompileIssue[] {
  const issues: ContentCompileIssue[] = [];
  const bossMonsterIds = new Set(
    locatedEntries
      .filter(({ entry }) => entry.kind === 'monster' && entry.tags.includes('boss'))
      .map(({ entry }) => entry.id),
  );
  for (const { entry, file } of locatedEntries) {
    if (entry.kind !== 'achievement') continue;
    if (entry.criteria.type === 'defeat-boss' && !bossMonsterIds.has(entry.criteria.monsterId)) {
      issues.push(
        issue(
          file,
          `$.entries.${entry.id}.criteria.monsterId`,
          `defeat-boss achievement references ${entry.criteria.monsterId}, which is not a boss-tagged monster`,
        ),
      );
    }
  }
  return issues;
}
```

- [ ] **Step 4: Migrate the two existing achievements**

Rewrite `content/achievements/first-defeats.yaml` entries to the new model:

```yaml
schemaVersion: 7
entries:
  - kind: achievement
    id: achievement.defeated-the-deeps-champion
    name: Defeated the Deep's Champion
    tags: [fallen-hero, prestige]
    description: Defeat the Deep's Champion for the first time.
    criteria: { type: defeat-fallen-hero, role: champion }
  - kind: achievement
    id: achievement.silenced-an-echo
    name: Silenced an Echo
    tags: [fallen-hero]
    description: Defeat an Echo of a fallen hero for the first time.
    criteria: { type: defeat-fallen-hero, role: echo }
```

- [ ] **Step 5: Rewrite the engine evaluation + drop `criteriaId`**

In `packages/engine/src/run-records-model.ts`, change `AchievementGrant` to `{ readonly achievementId: OpaqueId; readonly name: string; }` (remove `criteriaId` and its `AchievementCriteriaId` import).

In `packages/engine/src/events-model.ts`, change `AchievementGrantedEvent` to drop `criteriaId` (remove the field + the `AchievementCriteriaId` import): `{ type: 'achievement.granted'; eventId; achievementId; name }`.

In `packages/engine/src/run-finalize.ts`, rewrite `achievementGrants` (and remove the `AchievementCriteriaId` import + the old `earnedCriteria` list) to evaluate each achievement's `criteria` against the run:

```ts
function criterionMet(
  criteria: AchievementCriteria,
  ctx: Readonly<{
    decisions: readonly FallenHeroRunDecision[];
    lifetime: LifetimeState;
    deepestDepth: number;
    completionType: HallRecord['completionType'];
    defeatedBossMonsterIds: readonly OpaqueId[];
  }>,
): boolean {
  switch (criteria.type) {
    case 'defeat-boss':
      return ctx.defeatedBossMonsterIds.includes(criteria.monsterId);
    case 'defeat-fallen-hero':
      return ctx.decisions.some((decision) => isFirstDefeat(decision, criteria.role, ctx.lifetime));
    case 'reach-depth':
      return ctx.deepestDepth >= criteria.depth;
    case 'complete-ending':
      return ctx.completionType === criteria.ending;
  }
}

function achievementGrants(
  input: Readonly<{ run: ActiveRun; lifetime: LifetimeState; content: CompiledContentPack }>,
): readonly AchievementGrant[] {
  const { run, lifetime, content } = input;
  const completionType = run.conclusion!.completionType;
  const ctx = {
    decisions: run.fallenHeroDecisions,
    lifetime,
    deepestDepth: run.metrics.deepestDepth,
    completionType,
    defeatedBossMonsterIds: run.metrics.defeatedBossMonsterIds,
  };
  return content.entries
    .filter(
      (entry): entry is AchievementContentEntry =>
        entry.kind === 'achievement' &&
        !lifetime.grantedAchievementIds.includes(entry.id) &&
        criterionMet(entry.criteria, ctx),
    )
    .map((entry): AchievementGrant => ({ achievementId: entry.id, name: entry.name }))
    .sort((left, right) => compareCodeUnits(left.achievementId, right.achievementId));
}
```

Update the single call site in `finalizeRun` from `achievementGrants({ decisions: run.fallenHeroDecisions, lifetime, content })` to `achievementGrants({ run, lifetime, content })`, and update the `grantEvents` map to drop `criteriaId` (`{ type: 'achievement.granted', eventId, achievementId: grant.achievementId, name: grant.name }`). Import `AchievementCriteria` from `@woven-deep/content`.

- [ ] **Step 6: Event save-schema + version bump + migration**

In `packages/engine/src/save-schema/events.ts`, change `achievementGrantedEvent` to drop `criteriaId` (remove that line + the `ACHIEVEMENT_CRITERIA_IDS` import): `z.strictObject({ type: z.literal('achievement.granted'), eventId: identifier, achievementId: identifier, name: heroName })`.

Bump `SAVE_SCHEMA_VERSION` again in `versions.ts`. In `migrations.ts`, add a migration from the Task-1 version that strips `criteriaId` from every persisted `achievement.granted` event (in both `events` and `publicEvents` arrays of each record). Mirror the file's existing legacy-event migration pattern.

- [ ] **Step 7: Fix the web test mock**

In `apps/web/src/ui/overlays/SettingsOverlay.test.tsx`, remove the `criteriaId: 'first-champion-defeat'` line from the achievement-granted event mock (the field no longer exists).

- [ ] **Step 8: Engine tests for each criteria type**

Create `packages/engine/test/achievement-criteria.test.ts`. Build a small content pack (or reuse `createDemoContentPack`) with one achievement per criteria type, and drive `finalizeRun` (or `achievementGrants` if you export a thin test seam) over concluded runs to assert: a run defeating `monster.ashfather` grants only the `defeat-boss` achievement; `deepestDepth: 15` grants `reach-depth{15}` but not `reach-depth{20}`; `completionType: 'broke-cycle'` grants the matching `complete-ending`; a champion first-defeat grants `defeat-fallen-hero{champion}`; grant-once holds (a run whose id is already in `lifetime.grantedAchievementIds` yields no duplicate). Mirror the run/lifetime construction in the existing `run-finalize` tests (grep `packages/engine/test` for `finalizeRun`).

Run: `npm run build --workspace @woven-deep/content && npm run build --workspace @woven-deep/engine && npx vitest run --root packages/engine achievement-criteria && npm run test --workspace @woven-deep/content`
Expected: PASS (content compiles under STRICT; criteria evaluate correctly).

- [ ] **Step 9: Regenerate fixtures + diff-check + parity + verify**

Regenerate the 7 content-hash-embed fixtures. `run-records`/`endgame` shift their `achievementGrants`/events (the migrated champion/echo grants now carry no `criteriaId`, and finalize output changed) — intended; diff-check. Then:

```bash
npm run test --workspace @woven-deep/engine
npx vitest run --root apps/server determinism-parity
npm run verify
```
Expected: PASS.

- [ ] **Step 10: Format and commit**

```bash
npx prettier --write packages/content/src/model/achievement.ts packages/content/src/compiler/schema/achievement.ts packages/content/src/compiler/validation/achievement.ts content/achievements/first-defeats.yaml packages/engine/src/run-finalize.ts packages/engine/src/run-records-model.ts packages/engine/src/events-model.ts packages/engine/src/save-schema/events.ts packages/engine/src/save-schema/migrations.ts packages/engine/src/versions.ts packages/engine/test/achievement-criteria.test.ts apps/web/src/ui/overlays/SettingsOverlay.test.tsx
git add packages/ content/ apps/
git commit -m "feat: parameterized achievement criteria (defeat-boss/fallen-hero/reach-depth/complete-ending)"
```

---

### Task 3: Data-driven class-unlock conditions (content model + class content)

**Files:**
- Modify: `packages/content/src/model/class.ts`, `packages/content/src/compiler/schema/class.ts`, `packages/content/src/compiler/validation/class.ts` (or wherever class validation lives)
- Modify: `content/classes/locked-classes.yaml`, `content/classes/lamplighter.yaml`, `content/classes/loomcaller.yaml`, `content/classes/wayfarer.yaml`
- Test: `packages/content/test` (class compile + biconditional guard)

**Interfaces:**
- Produces: `UnlockCondition` union + `ClassContentEntry.unlock: UnlockCondition | null`. Consumed by Task 4's `evaluateUnlocks`.

- [ ] **Step 1: Add the model**

In `packages/content/src/model/class.ts`, add:

```ts
export type UnlockCondition =
  | { readonly type: 'reach-depth'; readonly depth: number }
  | { readonly type: 'defeat-champions'; readonly count: number };
```

and add `readonly unlock: UnlockCondition | null;` to `ClassContentEntry` (next to `unlockHint`). Export `UnlockCondition` from the content barrel.

- [ ] **Step 2: Schema + validation**

In the class schema (`packages/content/src/compiler/schema/class.ts`), add:

```ts
  unlock: z
    .discriminatedUnion('type', [
      z.strictObject({ type: z.literal('reach-depth'), depth: z.number().int().min(1).max(20) }),
      z.strictObject({ type: z.literal('defeat-champions'), count: z.number().int().min(1) }),
    ])
    .nullable(),
```

Add a validation rule (in the class validation module, mirroring `achievementIssues`' shape) enforcing the biconditional: a `playable: false` class MUST have both `unlock !== null` and `unlockHint !== null`; a `playable: true` class MUST have both `null`. Emit an `issue` otherwise.

> Implementer note: find the class validation entry point (grep `packages/content/src/compiler/validation` for `class`); if none exists, add a `classIssues` function and register it where the other `*Issues` are aggregated (grep for `achievementIssues(` to find the registry).

- [ ] **Step 3: Convert the class content**

`content/classes/locked-classes.yaml` — set the structured `unlock` and corrected hints:

```yaml
  - kind: class
    id: class.archivist
    # ...unchanged fields...
    unlockHint: Defeat three of the Deep's champions to unlock the Archivist.
    unlock: { type: defeat-champions, count: 3 }
    # ...
  - kind: class
    id: class.warden
    # ...unchanged fields...
    unlockHint: Descend to depth ten to unlock the Warden.
    unlock: { type: reach-depth, depth: 10 }
    # ...
```

The three playable classes (`lamplighter.yaml`, `loomcaller.yaml`, `wayfarer.yaml`) each get `unlock: null` (they already have `unlockHint: null`).

- [ ] **Step 4: Test the biconditional + compile**

Add a content test (or extend an existing class test) asserting: the compiled pack has both locked classes with a non-null `unlock` matching the values above and non-null hints; each playable class has `unlock: null`; and that a fixture locked class missing `unlock` fails compilation (mirror how other `*Issues` rejection tests are written — grep `packages/content/test` for a `rejects` compile test).

Run: `npm run test --workspace @woven-deep/content`
Expected: PASS.

- [ ] **Step 5: Regenerate fixtures + verify + commit**

The class-content edits shift the pack content hash → regenerate the 7 content-hash-embed fixtures (benign hash-embed only — no simulation uses class `unlock`). Diff-check confirms only content-hash-embed fields moved. Then:

```bash
npm run test --workspace @woven-deep/engine && npx vitest run --root apps/server determinism-parity && npm run verify
npx prettier --write packages/content/ content/classes/
git add packages/content/ content/classes/ packages/engine/test/fixtures/
git commit -m "feat(content): data-driven class unlock conditions with corrected hints"
```

---

### Task 4: Data-driven `evaluateUnlocks` (session-core)

**Files:**
- Modify: `packages/session-core/src/unlocks.ts`
- Modify: `packages/session-core/test/unlocks.test.ts`

**Interfaces:**
- Consumes: `ClassContentEntry.unlock` (Task 3). `evaluateUnlocks`/`canStartClass` signatures unchanged.

- [ ] **Step 1: Rewrite the evaluator**

In `packages/session-core/src/unlocks.ts`, remove `UNLOCK_RULES` and rewrite `evaluateUnlocks` to read each locked class's `unlock` condition:

```ts
function unlockConditionMet(condition: UnlockCondition, input: EvaluateUnlocksInput): boolean {
  switch (condition.type) {
    case 'reach-depth':
      return input.records.some((record) => record.deepestDepth >= condition.depth);
    case 'defeat-champions':
      return input.lifetime.conqueredChampionRecordIds.length >= condition.count;
  }
}

export function evaluateUnlocks(input: EvaluateUnlocksInput): readonly string[] {
  return classEntries(input.content)
    .filter((entry) => !entry.playable && entry.unlock !== null && unlockConditionMet(entry.unlock, input))
    .map((entry) => entry.id)
    .sort();
}
```

Import `UnlockCondition` from `@woven-deep/content`. Leave `canStartClass`, `classEntryForHeroTags`, and `EvaluateUnlocksInput` unchanged.

- [ ] **Step 2: Rewrite the tests**

Update `packages/session-core/test/unlocks.test.ts` to drive the data-driven evaluator against the real (or a fixture) content pack: `class.warden` unlocks exactly when a record has `deepestDepth >= 10`; `class.archivist` unlocks exactly when `conqueredChampionRecordIds.length >= 3`; neither unlocks below threshold; an already-`playable` class is never returned; a locked class absent from content is never returned. Preserve the existing test's guarantees.

Run: `npm run build --workspace @woven-deep/content && npm run test --workspace @woven-deep/session-core`
Expected: PASS. (No demo fixtures change — this is server-side logic only.)

- [ ] **Step 3: Verify and commit**

```bash
npm run verify
npx prettier --write packages/session-core/src/unlocks.ts packages/session-core/test/unlocks.test.ts
git add packages/session-core/
git commit -m "feat(session-core): evaluate class unlocks from data-driven conditions"
```

---

### Task 5: Author the achievement roster (8 new achievements)

**Files:**
- Create: `content/achievements/milestone-bosses.yaml`, `content/achievements/endings.yaml`, `content/achievements/depths.yaml`
- Test: `packages/content/test/achievement-roster.test.ts` (create)

**Interfaces:** consumes the Task-2 criteria model. Produces 8 achievement entries (the 2 champion/echo already exist from Task 2).

- [ ] **Step 1: Author the milestone-boss achievements**

Create `content/achievements/milestone-bosses.yaml`:

```yaml
schemaVersion: 7
entries:
  - kind: achievement
    id: achievement.felled-the-ashfather
    name: Felled the Ashfather
    tags: [boss, prestige]
    description: Defeat the Ashfather at the fifth descent.
    criteria: { type: defeat-boss, monsterId: monster.ashfather }
  - kind: achievement
    id: achievement.drowned-the-sovereign
    name: Drowned the Sovereign
    tags: [boss, prestige]
    description: Defeat the Tide-Sovereign at the tenth descent.
    criteria: { type: defeat-boss, monsterId: monster.tide-sovereign }
  - kind: achievement
    id: achievement.silenced-the-herald
    name: Silenced the Herald
    tags: [boss, prestige]
    description: Defeat the Heart-Herald at the fifteenth descent.
    criteria: { type: defeat-boss, monsterId: monster.heart-herald }
```

- [ ] **Step 2: Author the ending achievements**

Create `content/achievements/endings.yaml`:

```yaml
schemaVersion: 7
entries:
  - kind: achievement
    id: achievement.broke-the-cycle
    name: Broke the Cycle
    tags: [ending, prestige]
    description: Reach the broke-cycle ending in the Final Chamber.
    criteria: { type: complete-ending, ending: broke-cycle }
  - kind: achievement
    id: achievement.became-the-heart
    name: Became the Heart
    tags: [ending, prestige]
    description: Reach the became-heart ending in the Final Chamber.
    criteria: { type: complete-ending, ending: became-heart }
  - kind: achievement
    id: achievement.walked-away
    name: Walked Away
    tags: [ending]
    description: Reach the refused ending in the Final Chamber.
    criteria: { type: complete-ending, ending: refused }
```

- [ ] **Step 3: Author the depth achievements**

Create `content/achievements/depths.yaml`:

```yaml
schemaVersion: 7
entries:
  - kind: achievement
    id: achievement.into-the-deep
    name: Into the Deep
    tags: [depth]
    description: Descend to depth fifteen.
    criteria: { type: reach-depth, depth: 15 }
  - kind: achievement
    id: achievement.the-final-descent
    name: The Final Descent
    tags: [depth, prestige]
    description: Descend to depth twenty, the Final Chamber.
    criteria: { type: reach-depth, depth: 20 }
```

- [ ] **Step 4: Roster sanity test**

Create `packages/content/test/achievement-roster.test.ts`: compile the real content, assert exactly 10 achievements, that each of the 4 criteria types is represented, that every `defeat-boss.monsterId` resolves to a boss-tagged monster, every `reach-depth.depth ∈ [1,20]`, every `complete-ending.ending` is a valid ending, and all achievement ids are unique.

Run: `npm run test --workspace @woven-deep/content`
Expected: PASS.

- [ ] **Step 5: Regenerate fixtures + diff-check + parity + verify**

New achievements shift the content hash (all 7 fixtures) AND the `run-records`/`endgame` demos now grant the new achievements their runs earn (boss defeats, endings, depths) → their `achievementGrants`/records/events hashes move (intended). Diff-check: intended grant shift on run-records/endgame; hash-embed only elsewhere. Then:

```bash
npm run test --workspace @woven-deep/engine
npx vitest run --root apps/server determinism-parity
npm run verify
```
Expected: PASS.

- [ ] **Step 6: Format and commit**

```bash
npx prettier --write content/achievements/ packages/content/test/achievement-roster.test.ts
git add content/achievements/ packages/content/test/ packages/engine/test/fixtures/
git commit -m "feat(content): achievement roster — boss defeats, endings, depth milestones"
```

---

### Task 6: Whole-feature verification

**Files:** none (verification + any residual fixture reconciliation).

- [ ] **Step 1: Full suite + all demos + parity**

```bash
npm run verify
npm run dungeon:demo && npm run gameplay:demo && npm run merchant:demo && npm run population:demo && npm run run-records:demo && npm run endgame:demo && npm run magic:demo && npm run engine:demo
npx vitest run --root apps/server determinism-parity
```
Expected: all PASS — every demo re-derives its reviewed hashes in two processes; parity green; the full workspace suite (content/engine/session-core/server/web) green.

- [ ] **Step 2: Commit any residual fixture reconciliation (if needed)**

If any demo `--verify` surfaced a fixture not yet regenerated, regenerate + diff-check it, then:

```bash
git add packages/engine/test/fixtures/
git commit -m "chore(engine): reconcile demo fixtures for 7C metaprogression"
```
(If nothing is outstanding, skip this commit.)

---

## Self-Review

**Spec coverage:**
- Parameterized criteria (defeat-boss/defeat-fallen-hero/reach-depth/complete-ending) — Task 2 model/schema/validation + engine eval; Task 1 supplies the boss set. ✓
- Loosened validation (drop 1:1, add referential integrity) — Task 2 Step 3. ✓
- Deterministic engine evaluation + grant-once — Task 2 Step 5/8. ✓
- Roster of 10 (3 boss, 3 ending, 2 depth, 2 retained champion/echo) — Task 2 (migrate 2) + Task 5 (8) + roster test. ✓
- Data-driven unlock conditions + behavior-preserving + corrected hints + biconditional guard — Task 3 (content) + Task 4 (evaluator). ✓
- New per-run `defeatedBossMonsterIds` + save-schema + migration + round-trip — Task 1. ✓
- Save-schema bumps + migrations for both persisted changes (metrics field; dropped event `criteriaId`) — Task 1 + Task 2. ✓
- Determinism: intended run-records/endgame shifts + parity green + per-task fixture regen — Tasks 1/2/5 + Task 6. ✓
- Foreshadowing deferred to #79; no new classes/surfaces — Global Constraints + out-of-scope. ✓

**Placeholder scan:** No TBD/TODO. Three "implementer note"s point at concrete lookups (exact `foldRunMetrics` signature, the content-id schema helper name, the class-validation registry) rather than gaps — each names what to grep and what to match.

**Type consistency:** `defeatedBossMonsterIds` defined in Task 1, consumed by Task 2's `criterionMet`. `AchievementCriteria`/`ACHIEVEMENT_CRITERIA_TYPES` defined in Task 2, used by Task 5's YAML. `UnlockCondition` defined in Task 3, consumed by Task 4's `unlockConditionMet`. `AchievementGrant`/`AchievementGrantedEvent` lose `criteriaId` consistently across model/events/save-schema/web-test in Task 2. Ending values (`became-heart`/`refused`/`broke-cycle`) match `completionType` minus `died` in both the criteria schema and the eval.
