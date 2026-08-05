# Surrender to the Deep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player end a live run deliberately — "surrender to the Deep" — producing a Hall record that banks no Ancient Tablet fragments.

**Architecture:** A new `surrender` command concludes the run with a fifth `CompletionType`, `'surrendered'`. It resolves in the reducer's revision-only lane (the house/trade precedent), so it costs no turn, runs no world step, and draws from no RNG stream. Finalization pays out normally except that a surrendered run banks zero tablet fragments. The web client surfaces it as a Command Palette entry behind a single confirm dialog.

**Tech Stack:** TypeScript 5.8 ESM, npm workspaces, Vitest 3.2, Zod (strict), React 19 + Vite, Fastify.

**Spec:** `docs/superpowers/specs/2026-08-05-surrender-to-the-deep-design.md`

## Global Constraints

- **TDD is RED-first.** Write the failing test, run it, watch it fail for the stated reason, then implement. Never write implementation first.
- **Conventional commits, lowercase, no scope:** `feat:`, `fix:`, `test:`, `docs:`, `chore:`.
- **Determinism is the product.** The surrender transition must draw from **no** RNG stream and must not advance `turn` or `worldTime`.
- **Engine is browser-safe by enforced test** (`packages/engine/test/browser-boundary.test.ts`): no Node APIs, no React, no clocks, no `Math.random`, no storage in `packages/engine/src/`.
- **Build gotcha:** demo scripts and CLI tests import the compiled `packages/engine/dist`, and workspace-scoped `vitest` does NOT rebuild it. Before running any `*-demo` / `*-cli` suite: `npm run build --workspace @woven-deep/content && npm run build --workspace @woven-deep/engine`.
- **Full gate is `npm run verify`** (typecheck + lint + format:check + depcruise + knip + test), not `npm test`.
- **Schema numbers are claimed by whichever PR merges first.** This plan writes content `18` and save `20` (current live values: content `17`, save `19`). If either has moved by the time you branch, renumber to the next free value everywhere in this plan. Expect to renumber again after a rebase.
- **Never bulk-sed `schemaVersion` across the repo.** Content YAML files and save fixtures share that key, and `save-codec.ts` / `save-codec.test.ts` carry *save* versions that must not move with a content bump. Scope every sed to `content/`.
- **Never re-pin a drifted demo hash without diffing the transcript and explaining the delta.**

---

### Task 1: The fifth completion type

Adds `'surrendered'` to `CompletionType` and gives it a scoring bonus and a Hall tier. This is the content-schema bump; nothing consumes the new member yet, so the task lands green on its own.

**Files:**
- Modify: `packages/content/src/model/common.ts:22` (version), `:144` (the union)
- Modify: `content/balance/core-gameplay.yaml:72`
- Modify: all 158 `content/**/*.yaml` files carrying `schemaVersion: 17`
- Modify: `packages/engine/src/fixture.ts:59`
- Modify: `packages/engine/src/score-run.ts:142`
- Modify: `docs/server-admin/content-configuration.md`
- Test: `packages/content/test/completion-bonus.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `CompletionType` now includes `'surrendered'`. `HALL_TIER_RANK.surrendered === 0`. `balance.score.completionBonus.surrendered === 0`. Every later task depends on the union member existing.

- [ ] **Step 1: Write the failing test**

Create `packages/content/test/completion-bonus.test.ts`:

```ts
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { BalanceContentEntry, CompiledContentPack, CompletionType } from '../src/index.js';
import { compileContentDirectory } from '../src/compiler.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

/** Every completion the engine can conclude with must have a score bonus. A missing key would
 * score `undefined` and poison the checked-integer sum in `scoreRun`, so this is pinned rather
 * than left to the Record type -- YAML is validated at runtime, not by TypeScript. */
const ALL_COMPLETION_TYPES: readonly CompletionType[] = [
  'died',
  'surrendered',
  'refused',
  'became-heart',
  'broke-cycle',
];

describe('balance completion bonus', () => {
  it('covers every completion type', () => {
    const balance = pack.entries.find(
      (entry): entry is BalanceContentEntry => entry.kind === 'balance',
    );
    expect(balance).toBeDefined();
    for (const completionType of ALL_COMPLETION_TYPES) {
      expect(balance!.score.completionBonus[completionType]).toBeTypeOf('number');
    }
  });

  it('pays a surrendered run nothing', () => {
    const balance = pack.entries.find(
      (entry): entry is BalanceContentEntry => entry.kind === 'balance',
    );
    expect(balance!.score.completionBonus.surrendered).toBe(0);
  });
});
```

Confirm the compiler import path first — if `compileContentDirectory` is not exported from `../src/compiler.js`, copy the import line from `packages/content/test/potion-risk.test.ts`, which uses the same idiom.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace @woven-deep/content -- --run test/completion-bonus.test.ts`
Expected: FAIL — TypeScript rejects `'surrendered'` as a `CompletionType`, and `completionBonus.surrendered` is `undefined`.

- [ ] **Step 3: Widen the union and bump the content schema version**

In `packages/content/src/model/common.ts`:

```ts
export const CONTENT_SCHEMA_VERSION = 18 as const;
```

```ts
export type CompletionType = 'died' | 'became-heart' | 'refused' | 'broke-cycle' | 'surrendered';
```

- [ ] **Step 4: Add the bonus to both authored balance copies**

`content/balance/core-gameplay.yaml:72` — add the key, keeping the existing died-first ordering:

```yaml
      completionBonus: { died: 0, surrendered: 0, refused: 400, became-heart: 800, broke-cycle: 1500 }
```

`packages/engine/src/fixture.ts:59` — the same key in the inline test fixture:

```ts
          completionBonus: {
            died: 0,
            surrendered: 0,
            refused: 400,
            'became-heart': 800,
            'broke-cycle': 1500,
          },
```

- [ ] **Step 5: Bump every content file's declared schema version**

Scoped to `content/` only — never repo-wide:

```bash
grep -rl '^schemaVersion: 17' content/ | xargs sed -i '' 's/^schemaVersion: 17$/schemaVersion: 18/'
```

Verify the blast radius is exactly what you expect before moving on:

```bash
git diff --stat -- content/ | tail -1          # expect ~159 files (158 + core-gameplay.yaml)
git diff -- packages/ apps/ | grep -c schemaVersion   # expect 0
```

The second check is the one that matters: a `schemaVersion` change outside `content/` means the sed escaped its scope and touched save fixtures.

- [ ] **Step 6: Add the Hall tier**

`packages/engine/src/score-run.ts:142` — `surrendered` sits at the **same** tier as `died`, so ordering between them falls through to score:

```ts
const HALL_TIER_RANK: Readonly<Record<CompletionType, number>> = {
  'broke-cycle': 3,
  'became-heart': 2,
  refused: 1,
  died: 0,
  // Same tier as `died`, deliberately. Tier dominates score absolutely in `compareHallRecords`,
  // so a lower tier of its own would sort a depth-18 surrender beneath a depth-1 death. Both
  // outcomes are "did not make it out"; surrender's cost is paid in fragments, not in ordering.
  surrendered: 0,
};
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm run test --workspace @woven-deep/content -- --run test/completion-bonus.test.ts`
Expected: PASS, both cases.

- [ ] **Step 8: Document the schema bump**

Add a migration note to `docs/server-admin/content-configuration.md` in that file's established format for schema bumps (find the v16→v17 entry and follow its shape):

> **v17 → v18.** `CompletionType` gains `surrendered`. `balance.score.completionBonus` is a closed record over `CompletionType`, so every pack must add a `surrendered` key. A value of `0` reproduces the shipped balance. No other field changes.

- [ ] **Step 9: Verify the whole content workspace still compiles and validates**

Run: `npm run content:validate`
Expected: exits 0. Any file left at `schemaVersion: 17` fails loudly here with an "Unsupported content schema version" error naming the file.

- [ ] **Step 10: Commit**

```bash
git add packages/content/src/model/common.ts packages/content/test/completion-bonus.test.ts \
        packages/engine/src/fixture.ts packages/engine/src/score-run.ts \
        content/ docs/server-admin/content-configuration.md
git commit -m "feat: add the surrendered completion type"
```

---

### Task 2: Persist the new completion type

Widens the persisted enum and freezes a pre-change copy for the legacy chain. Without the freeze, widening the shared primitive retroactively changes what every old save is validated against — a v4 save would be allowed to claim `surrendered`, a state no v4 save could ever have held.

**Files:**
- Modify: `packages/engine/src/versions.ts:1`
- Modify: `packages/engine/src/save-schema/primitives.ts:112`
- Modify: `packages/engine/src/save-schema/migrations.ts` (13 `conclusion:` references, plus a new frozen schema and the new legacy schema)
- Modify: `packages/engine/src/save-schema/index.ts` (export the new legacy schema)
- Modify: `packages/engine/src/save-codec.ts:279-298`
- Test: `packages/engine/test/save-codec.test.ts` (extend)

**Interfaces:**
- Consumes: `CompletionType` including `'surrendered'` (Task 1).
- Produces: `SAVE_SCHEMA_VERSION = 20`. `legacyActiveRunV19Schema` exported from `save-schema/index.ts`. `migrateV19ToV20` appended to `ORDERED_MIGRATIONS`. A run whose `conclusion.completionType` is `'surrendered'` round-trips through `encodeActiveRun`/`decodeActiveRun`.

- [ ] **Step 1: Write the failing test**

Append to `packages/engine/test/save-codec.test.ts`. Match the file's existing idiom for building a run — reuse whatever helper the surrounding tests use to get an `ActiveRun` rather than constructing one by hand.

```ts
describe('surrendered conclusion', () => {
  it('round-trips byte-identically', () => {
    const base = /* the file's existing helper for a fresh ActiveRun */;
    const surrendered = validateActiveRun({
      ...base,
      conclusion: {
        completionType: 'surrendered' as const,
        cause: {
          killerContentId: null,
          depth: base.floors[0]!.depth,
          turn: base.turn,
          worldTime: base.worldTime,
        },
        concludedAtRevision: base.revision,
        finalized: false,
      },
    });

    const encoded = encodeActiveRun(surrendered);
    const decoded = decodeActiveRun(encoded);

    expect(decoded.conclusion?.completionType).toBe('surrendered');
    expect(encodeActiveRun(decoded)).toBe(encoded);
  });

  it('rejects a surrendered conclusion in a legacy save', () => {
    // A save written before v20 cannot have held `surrendered`; the frozen legacy enum is what
    // stops one being smuggled in by hand-editing a save file.
    const legacy = JSON.parse(encodeActiveRun(/* the file's helper for a v19-shaped save */)) as {
      schemaVersion: number;
      conclusion: unknown;
    };
    legacy.schemaVersion = 19;
    legacy.conclusion = {
      completionType: 'surrendered',
      cause: { killerContentId: null, depth: 1, turn: 0, worldTime: 0 },
      concludedAtRevision: 0,
      finalized: false,
    };
    expect(() => decodeActiveRun(JSON.stringify(legacy))).toThrow(SaveLoadError);
  });
});
```

The second case is the one that pins the freeze. If the file has no existing helper that produces a v19-shaped save, build the object from a current save and overwrite `schemaVersion` as shown — the point is only that the *legacy* schema rejects the value.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace @woven-deep/engine -- --run test/save-codec.test.ts`
Expected: FAIL — the first case fails because `completionType` is a 4-member `z.enum` that rejects `'surrendered'`.

- [ ] **Step 3: Freeze the pre-change conclusion schema**

In `packages/engine/src/save-schema/migrations.ts`, above the legacy run schemas, add the frozen copy. Read the live `runConclusionSchema` in `save-schema/` first and mirror its shape exactly, substituting only the enum:

```ts
/**
 * The conclusion shape as it stood through save v19, frozen here because `completionType` gained
 * `surrendered` at v20. Legacy run schemas reference the LIVE sub-schemas, so without this freeze
 * widening the live enum would retroactively let a v4 save claim a completion that did not exist
 * when it was written. Every legacy run schema below points at this, never at the live schema.
 */
const legacyRunConclusionPreSurrenderSchema = z.strictObject({
  completionType: z.enum(['died', 'became-heart', 'refused', 'broke-cycle']),
  cause: z.strictObject({
    killerContentId: identifier.nullable(),
    depth: safeNonNegative,
    turn: safeNonNegative,
    worldTime: safeNonNegative,
  }),
  concludedAtRevision: safeNonNegative,
  finalized: z.boolean(),
});
```

- [ ] **Step 4: Repoint every legacy run schema at the frozen copy**

All 13 occurrences in `migrations.ts` (lines 465, 512, 561, 662, 712, 760, 814, 868, 919, 968, 1017, 1065, 1109) change from:

```ts
  conclusion: runConclusionSchema.nullable(),
```

to:

```ts
  conclusion: legacyRunConclusionPreSurrenderSchema.nullable(),
```

This is a safe `replace_all` within this one file — but confirm the count is 13 afterward, and confirm the live schema in `save-schema/run-record.ts` was **not** touched.

- [ ] **Step 5: Widen the live enum and bump the save version**

`packages/engine/src/save-schema/primitives.ts:112`:

```ts
export const completionType = z.enum([
  'died',
  'became-heart',
  'refused',
  'broke-cycle',
  'surrendered',
]);
```

`packages/engine/src/versions.ts:1`:

```ts
export const SAVE_SCHEMA_VERSION = 20 as const;
```

- [ ] **Step 6: Add the v19 legacy schema and its migration**

In `migrations.ts`, add `legacyActiveRunV19Schema` by copying `legacyActiveRunV18Schema` wholesale and changing only `schemaVersion: z.literal(19)`, plus any sub-shape that moved at v19 (diff v18 against the live schema to find out; if nothing else moved, the literal is the only difference). Export it from `save-schema/index.ts` alongside the others.

In `save-codec.ts`, add the migration next to the existing ones:

```ts
/**
 * v19 -> v20: `completionType` gained `surrendered`. No save written at v19 or earlier can carry
 * it, so this is an identity pass over `conclusion` and rewrites nothing. It exists because the
 * ordered chain is the record of what changed and when, and a widened enum that skips the chain
 * leaves a gap in that record.
 */
function migrateV19ToV20(input: unknown): unknown {
  const v19 = legacyActiveRunV19Schema.parse(input);
  return { ...v19, schemaVersion: 20 };
}
```

Then extend both chain tables in `save-codec.ts:279-298`:

```ts
const LEGACY_SCHEMA_VERSIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19] as const;
```

```ts
const ORDERED_MIGRATIONS: readonly ((input: unknown) => unknown)[] = [
  // ... existing entries unchanged ...
  migrateV18ToV19,
  migrateV19ToV20,
];
```

`ORDERED_MIGRATIONS[i]` must migrate `LEGACY_SCHEMA_VERSIONS[i]`; both arrays gain exactly one entry, so the index alignment holds.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm run test --workspace @woven-deep/engine -- --run test/save-codec.test.ts`
Expected: PASS, including every pre-existing legacy-migration case. A failure in an *old* case means the freeze in Step 3 does not match the real pre-change shape — fix the frozen schema, not the old test.

- [ ] **Step 8: Commit**

```bash
git add packages/engine/src/versions.ts packages/engine/src/save-schema/ \
        packages/engine/src/save-codec.ts packages/engine/test/save-codec.test.ts
git commit -m "feat: persist the surrendered completion type at save v20"
```

---

### Task 3: The surrender command

The heart of the feature. A new command that concludes the run in the reducer's revision-only lane.

**Files:**
- Modify: `packages/engine/src/commands-model.ts:103-112` (interface + union)
- Modify: `packages/engine/src/reducer.ts` (new branch after the house branch, ~line 438)
- Test: `packages/engine/test/surrender.test.ts` (create)

**Interfaces:**
- Consumes: `CompletionType` with `'surrendered'` (Task 1); save v20 (Task 2) — without it, `validateActiveRun` rejects the concluded run this task produces.
- Produces: `SurrenderCommand { type: 'surrender' }` on the `GameCommand` union. `resolveCommand(state, { type: 'surrender', ... })` returns an applied result at `revision + 1` with `turn` unchanged and `state.conclusion.completionType === 'surrendered'`.

- [ ] **Step 1: Write the failing tests**

Create `packages/engine/test/surrender.test.ts`. The header mirrors `test/final-chamber-choice.test.ts`:

```ts
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createNewRun,
  DEFAULT_GUEST_HERO,
  descendToNextFloor,
  heroActor,
  resolveCommand,
  type ActiveRun,
  type GameCommand,
} from '../src/index.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

const SEED = [7, 14, 21, 28] as const;
const context = () => ({ content: pack });

function freshRun(): ActiveRun {
  return createNewRun({ seed: SEED, hero: DEFAULT_GUEST_HERO, content: pack });
}

function surrenderCommand(run: ActiveRun): GameCommand {
  return {
    type: 'surrender',
    commandId: 'command.surrender.1',
    expectedRevision: run.revision,
  };
}

describe('surrender', () => {
  it('concludes the run as surrendered', () => {
    const run = freshRun();
    const { state, result } = resolveCommand(run, surrenderCommand(run), context());

    expect(result.status).toBe('applied');
    expect(state.conclusion).not.toBeNull();
    expect(state.conclusion!.completionType).toBe('surrendered');
    expect(state.conclusion!.cause.killerContentId).toBeNull();
    expect(state.conclusion!.finalized).toBe(false);
  });

  it('leaves the hero alive', () => {
    const run = freshRun();
    const { state } = resolveCommand(run, surrenderCommand(run), context());
    expect(heroActor(state).health).toBeGreaterThan(0);
  });

  it('costs no turn and no world time', () => {
    const run = freshRun();
    const { state, result } = resolveCommand(run, surrenderCommand(run), context());

    expect(result.revision).toBe(run.revision + 1);
    expect(result.turn).toBe(run.turn);
    expect(state.turn).toBe(run.turn);
    expect(state.worldTime).toBe(run.worldTime);
  });

  it('draws from no RNG stream', () => {
    const run = freshRun();
    const { state } = resolveCommand(run, surrenderCommand(run), context());
    // Byte-identical stream state is the determinism claim: surrender must be free of every
    // named stream, not merely of the ones a fresh run happens to touch.
    expect(JSON.stringify(state.rng)).toBe(JSON.stringify(run.rng));
  });

  it('records the conclusion at the revision the command produced', () => {
    const run = freshRun();
    const { state, result } = resolveCommand(run, surrenderCommand(run), context());
    expect(state.conclusion!.concludedAtRevision).toBe(result.revision);
  });

  it('rejects a second surrender with run.concluded', () => {
    const run = freshRun();
    const first = resolveCommand(run, surrenderCommand(run), context());
    const second = resolveCommand(
      first.state,
      { type: 'surrender', commandId: 'command.surrender.2', expectedRevision: first.state.revision },
      context(),
    );

    expect(second.result.status).toBe('invalid');
    expect(second.result.status === 'invalid' && second.result.reason).toBe('run.concluded');
    expect(second.state.conclusion!.completionType).toBe('surrendered');
  });

  it('is accepted in town at depth 0', () => {
    const run = freshRun();
    const activeFloor = run.floors.find((floor) => floor.floorId === run.activeFloorId);
    expect(activeFloor!.depth).toBe(0); // a fresh run starts in town; guard the premise
    const { result } = resolveCommand(run, surrenderCommand(run), context());
    expect(result.status).toBe('applied');
  });

  it('is accepted below town', () => {
    const descended = descendToNextFloor(freshRun(), { content: pack }).state;
    const { state, result } = resolveCommand(descended, surrenderCommand(descended), context());
    expect(result.status).toBe('applied');
    const floor = state.floors.find((candidate) => candidate.floorId === state.activeFloorId);
    expect(state.conclusion!.cause.depth).toBe(floor!.depth);
  });
});
```

If `descendToNextFloor` needs the hero standing on the stair-down, lift the `teleportHeroTo` helper from `test/final-chamber-choice.test.ts:29-37` verbatim rather than reinventing it.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace @woven-deep/engine -- --run test/surrender.test.ts`
Expected: FAIL — TypeScript rejects `type: 'surrender'` as it is not on the `GameCommand` union.

- [ ] **Step 3: Add the command type**

In `packages/engine/src/commands-model.ts`, beside `FinalChamberChoiceCommand`:

```ts
/**
 * Gives the run up. Available at every point in a live run at any depth, town included -- the
 * motivating case is a hero who has run out of light and cannot find their way, but the command
 * is not gated on light: a gate would have to model every future light source and every future
 * way to relight one, and would still refuse a player who is lost for some other reason.
 */
export interface SurrenderCommand extends CommandEnvelope {
  readonly type: 'surrender';
}
```

and add `| SurrenderCommand` to the `GameCommand` union at `:197`.

- [ ] **Step 4: Resolve it in the revision-only lane**

In `packages/engine/src/reducer.ts`, immediately after the house-command branch closes (~line 438) and **before** `const validation = validatePlayerAction(...)`:

```ts
  // Surrender advances the revision only -- exactly like the house and trade branches above, and
  // deliberately NOT like the Final Chamber choice, which is an ordinary player action charged a
  // turn and followed by a full world step. Routing surrender that way would let the world act
  // (and possibly kill the hero) inside the transition that concludes the run, which would leave
  // `concludeRunOnChoice` throwing on an already-concluded run. Here nothing steps: no turn, no
  // world time, no survival tick, no RNG draw.
  //
  // The already-concluded case never reaches this branch: the generic `state.conclusion !== null`
  // guard at the top of `resolveCommand` already rejected it with `run.concluded`.
  if (command.type === 'surrender') {
    assertCountersCanAdvance(current, false);
    const result = {
      status: 'applied',
      commandId: command.commandId,
      revision: current.revision + 1,
      turn: current.turn,
    } as const;
    const resolved = concludeRunOnChoice({
      state: current,
      completionType: 'surrendered',
      turn: current.turn,
      eventId: command.commandId,
    });
    const events = [...preEvents, ...resolved.events];
    const publicEvents = [
      ...prePublicEvents,
      ...projectDomainEvents({
        state: resolved.state,
        content: context.content,
        heroId: resolved.state.hero.actorId,
        events: resolved.events,
      }),
    ];
    return {
      state: record(resolved.state, context.content, command, result, events, publicEvents),
      result,
      events: publicEvents,
    };
  }
```

`concludeRunOnChoice` is already imported at `reducer.ts:35`. It supplies the null killer, the hero's active-floor depth, and `concludedAtRevision: state.revision + 1`, which equals `result.revision`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test --workspace @woven-deep/engine -- --run test/surrender.test.ts`
Expected: PASS, all eight cases.

- [ ] **Step 6: Run the full engine suite for regressions**

Run: `npm run test --workspace @woven-deep/engine`
Expected: PASS. Pay attention to any exhaustiveness failure over `GameCommand` — a `switch` elsewhere that now lacks a `surrender` arm surfaces here, and the right fix is to add the arm, not to widen the switch's default.

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/commands-model.ts packages/engine/src/reducer.ts \
        packages/engine/test/surrender.test.ts
git commit -m "feat: let a run be surrendered to the Deep"
```

---

### Task 4: What surrender costs

The dock: a surrendered run banks no tablet fragments. Plus the artifact-stint correction, since a surrendered hero did not escape with anything.

**Files:**
- Modify: `packages/engine/src/run-finalize.ts:172` (fragments), `:202` (stint outcome)
- Modify: `apps/web/src/session/artifact-view.ts:107` (exhaustive record)
- Test: `packages/engine/test/surrender.test.ts` (extend)

**Interfaces:**
- Consumes: the `surrender` command (Task 3).
- Produces: `finalizeRun` on a surrendered run returns `deltas.newlyCollectedFragmentIds === []` and stints whose carried outcome is `'died-with'`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/engine/test/surrender.test.ts`. Reuse whatever helper the existing finalize tests use to put fragments in the hero's inventory — look at `packages/engine/test/` for the suite covering `newlyCollectedFragmentIds` and lift its setup rather than hand-rolling item instances.

```ts
describe('surrender finalization', () => {
  it('banks no tablet fragments', () => {
    const holding = /* run with every tablet fragment in the hero's inventory */;
    const surrendered = resolveCommand(holding, surrenderCommand(holding), context()).state;

    const { deltas } = finalizeRun({ run: surrendered, content: pack, lifetime: emptyLifetime() });

    expect(deltas.newlyCollectedFragmentIds).toEqual([]);
  });

  it('banks the same fragments when the run ends in death instead', () => {
    // The paired case: without it, an empty result proves nothing -- the setup might simply have
    // failed to give the hero any fragments.
    const holding = /* the same run */;
    const died = /* conclude the same run by killing the hero */;

    const { deltas } = finalizeRun({ run: died, content: pack, lifetime: emptyLifetime() });

    expect(deltas.newlyCollectedFragmentIds.length).toBeGreaterThan(0);
  });

  it('still produces a heirloom and a death inventory', () => {
    const run = freshRun();
    const surrendered = resolveCommand(run, surrenderCommand(run), context()).state;

    const { record } = finalizeRun({ run: surrendered, content: pack, lifetime: emptyLifetime() });

    expect(record.heirloom).toBeDefined();
    expect(record.deathInventory.length).toBeGreaterThan(0);
    expect(record.completionType).toBe('surrendered');
  });

  it('records a carried artifact as died-with, never escaped-with', () => {
    const carrying = /* run with an artifact in the hero's inventory */;
    const surrendered = resolveCommand(carrying, surrenderCommand(carrying), context()).state;

    const { artifactDeltas } = finalizeRun({
      run: surrendered,
      content: pack,
      lifetime: emptyLifetime(),
    });

    const carried = artifactDeltas.stints.filter((stint) => stint.newStatus === 'lost');
    expect(carried.length).toBe(1);
    expect(carried[0]!.stint.outcome).toBe('died-with');
  });

  it('scores a zero completion bonus', () => {
    const run = freshRun();
    const surrendered = resolveCommand(run, surrenderCommand(run), context()).state;

    const { record } = finalizeRun({ run: surrendered, content: pack, lifetime: emptyLifetime() });

    const line = record.score.lines.find((candidate) => candidate.lineId === 'completion-bonus');
    expect(line!.amount).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace @woven-deep/engine -- --run test/surrender.test.ts`
Expected: FAIL — the fragments case returns the held fragment ids rather than `[]`, and the artifact case returns `'escaped-with'`.

- [ ] **Step 3: Dock the fragments**

In `packages/engine/src/run-finalize.ts`, extend `newlyCollectedFragmentIds` (`:172`). Amend the existing doc comment to state the new rule, then guard:

```ts
function newlyCollectedFragmentIds(
  run: ActiveRun,
  content: CompiledContentPack,
  lifetime: LifetimeState,
): readonly OpaqueId[] {
  // A surrendered run banks nothing. The hero gave themselves to the Deep, and the Deep keeps
  // what they were carrying -- so the fragments are lost rather than remembered, and contribute
  // nothing toward the `broke-cycle` ending in any future run. This is the whole cost of
  // surrendering: the score bonus is zero, the same as an ordinary death.
  if (run.conclusion!.completionType === 'surrendered') return [];

  return tabletFragmentIds(content)
    .filter(
      (fragmentId) =>
        heroHoldsFragment(run, fragmentId) && !lifetime.collectedFragmentIds.includes(fragmentId),
    )
    .sort(compareCodeUnits);
}
```

`finalizeRun` already throws on a null conclusion before this is reached, so the non-null assertion matches the surrounding code's existing posture.

- [ ] **Step 4: Correct the artifact stint outcome**

`run-finalize.ts:202` — a surrendered hero did not carry anything out:

```ts
  // `escaped-with` means the hero LEFT the Deep holding it. A surrendered hero did not leave, so
  // it reads the same as a death.
  const carriedOutcome: ArtifactStint['outcome'] =
    input.completionType === 'died' || input.completionType === 'surrendered'
      ? 'died-with'
      : 'escaped-with';
```

- [ ] **Step 5: Close the exhaustive record on the web side**

`apps/web/src/session/artifact-view.ts:107` — `ESCAPE_TEXT` is `Record<CompletionType, string>` and will not typecheck without the key, even though Step 4 makes it unreachable:

```ts
const ESCAPE_TEXT: Readonly<Record<CompletionType, string>> = {
  'broke-cycle': 'broke the cycle with it',
  'became-heart': 'was bound into the Heart with it',
  refused: 'refused the Deep with it',
  died: OUTCOME_TEXT['died-with'],
  // Unreachable: a surrendered run never produces an `escaped-with` stint (see `artifactStints`).
  // Required for the record to close, and reads as a death if it ever did surface.
  surrendered: OUTCOME_TEXT['died-with'],
};
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test --workspace @woven-deep/engine -- --run test/surrender.test.ts`
Expected: PASS, all thirteen cases.

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/run-finalize.ts apps/web/src/session/artifact-view.ts \
        packages/engine/test/surrender.test.ts
git commit -m "feat: a surrendered run banks no tablet fragments"
```

---

### Task 5: Carry surrender over the wire

The registered (server-authoritative) path. The browser asks; the server's engine decides.

**Files:**
- Modify: `packages/session-core/src/ws-protocol.ts:76-82`
- Modify: `apps/server/src/ws-protocol.ts:272`
- Modify: `apps/server/src/routes/ws-play.ts:188`
- Test: `apps/server/test/ws-protocol.test.ts` (extend — confirm the actual filename first)

**Interfaces:**
- Consumes: the `surrender` `GameCommand` (Task 3).
- Produces: a `{ type: 'surrender'; commandId: string; expectedRevision: number }` client message, parsed by the server and dispatched into the play session.

- [ ] **Step 1: Write the failing test**

Extend the server's ws-protocol parse suite. Mirror the shape of the existing `final-chamber-choice` parse cases in that file:

```ts
describe('surrender message', () => {
  it('parses a well-formed surrender', () => {
    const parsed = parseClientMessage(
      JSON.stringify({ type: 'surrender', commandId: 'command.1', expectedRevision: 7 }),
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.message).toEqual({
      type: 'surrender',
      commandId: 'command.1',
      expectedRevision: 7,
    });
  });

  it('rejects a surrender missing its envelope fields', () => {
    const parsed = parseClientMessage(JSON.stringify({ type: 'surrender' }));
    expect(parsed.ok).toBe(false);
  });
});
```

Match `parseClientMessage`'s real exported name and result shape from the existing tests in that file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace @woven-deep/server`
Expected: FAIL — an unknown message type is rejected.

- [ ] **Step 3: Add the message to the shared protocol**

`packages/session-core/src/ws-protocol.ts`, on the client-message union beside `final-chamber-choice`:

```ts
  | {
      /** Gives the run up. Carries no payload beyond the envelope: the server's engine decides
       * everything about the conclusion, exactly as it does for every other command. */
      readonly type: 'surrender';
      readonly commandId: string;
      readonly expectedRevision: number;
    }
```

- [ ] **Step 4: Parse it server-side**

`apps/server/src/ws-protocol.ts`, beside the `final-chamber-choice` branch at `:272`. Follow that branch's exact validation idiom for `commandId` and `expectedRevision`:

```ts
  if (parsed.type === 'surrender') {
    if (!isCommandEnvelope(parsed)) {
      return { ok: false, reason: 'malformed surrender' };
    }
    return {
      ok: true,
      message: {
        type: 'surrender',
        commandId: parsed.commandId,
        expectedRevision: parsed.expectedRevision,
      },
    };
  }
```

If the file has no shared envelope predicate, inline the same field checks the `final-chamber-choice` branch uses rather than inventing a helper.

- [ ] **Step 5: Dispatch it into the play session**

`apps/server/src/routes/ws-play.ts`, beside the `final-chamber-choice` dispatch at `:188`:

```ts
  if (message.type === 'surrender') {
    return session.dispatch({
      type: 'surrender',
      commandId: message.commandId,
      expectedRevision: message.expectedRevision,
    });
  }
```

Match the surrounding code's actual dispatch call — copy the `final-chamber-choice` block and change the type and payload, so the reply plumbing stays identical.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test --workspace @woven-deep/server && npm run test --workspace @woven-deep/session-core`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/session-core/src/ws-protocol.ts apps/server/src/ws-protocol.ts \
        apps/server/src/routes/ws-play.ts apps/server/test/
git commit -m "feat: carry surrender over the play websocket"
```

---

### Task 6: Surrender in the client

The player-facing surface: a palette entry, one confirm dialog, and an ending screen.

**Files:**
- Modify: `apps/web/src/session/guest-session.ts` (beside `chooseFinalChamber`, ~line 378)
- Modify: `apps/web/src/session/profile-session.ts` (beside `chooseFinalChamber`, ~line 558)
- Modify: `apps/web/src/ui/CommandPalette.tsx`
- Create: `apps/web/src/ui/overlays/SurrenderConfirm.tsx`
- Modify: `apps/web/src/ui/screens/ConclusionScreen.tsx:29-55`
- Test: `apps/web/src/ui/overlays/SurrenderConfirm.test.tsx` (create)

**Interfaces:**
- Consumes: `surrender` command (Task 3), `surrender` ws message (Task 5).
- Produces: `GuestSession.surrender(): void` and `ProfileSession.surrender(): void`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/ui/overlays/SurrenderConfirm.test.tsx`, following the idiom of `HelpOverlay.test.tsx` for render/query helpers:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SurrenderConfirm } from './SurrenderConfirm.js';

describe('SurrenderConfirm', () => {
  it('names both consequences so the player cannot be surprised', () => {
    render(<SurrenderConfirm open onOpenChange={() => {}} onConfirm={() => {}} />);
    expect(screen.getByRole('dialog')).toHaveTextContent(/end/i);
    expect(screen.getByRole('dialog')).toHaveTextContent(/fragment/i);
  });

  it('surrenders only on confirm', () => {
    const onConfirm = vi.fn();
    render(<SurrenderConfirm open onOpenChange={() => {}} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole('button', { name: /keep going/i }));
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /surrender/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace @woven-deep/web -- --run src/ui/overlays/SurrenderConfirm.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Build the confirm dialog**

Create `apps/web/src/ui/overlays/SurrenderConfirm.tsx`, using the same `Dialog` primitives `CommandPalette.tsx` imports from `../components/dialog.js`:

```tsx
import type { JSX } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../components/dialog.js';

export interface SurrenderConfirmProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: () => void;
}

/**
 * The one confirmation between the player and the end of their run. Single-step by design -- no
 * type-to-confirm -- but it states both consequences in plain terms, because a player who reads
 * this dialog must not be able to be surprised by what happens after they click through it.
 */
export function SurrenderConfirm({
  open,
  onOpenChange,
  onConfirm,
}: SurrenderConfirmProps): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Surrender to the Deep?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-fg">
          You set down what you were carrying and stop walking. The dark closes over you without
          any particular malice, the way water closes over a stone.
        </p>
        <p className="text-sm text-muted-fg">
          Your run ends now and the Hall records it. Any Ancient Tablet fragments you are carrying
          are lost — the Deep keeps them, and they will not count toward breaking the cycle.
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => onOpenChange(false)}>
            Keep going
          </button>
          <button type="button" onClick={onConfirm}>
            Surrender
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

Match the surrounding button styling — copy the class names off an existing dialog's buttons rather than leaving these bare.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace @woven-deep/web -- --run src/ui/overlays/SurrenderConfirm.test.tsx`
Expected: PASS, both cases.

- [ ] **Step 5: Add the session dispatch methods**

`apps/web/src/session/guest-session.ts`, beside `chooseFinalChamber`:

```ts
  /**
   * Dispatches the `surrender` command -- the ONLY path that ever produces one. Like
   * `chooseFinalChamber`, this never goes through `buildIntent`/`PlayerIntent`: there is no intent
   * for a conclusion. The UI always reaches it through the confirm dialog, never automatically.
   */
  surrender(): void {
    this.notice = null;
    const command: GameCommand = {
      type: 'surrender',
      commandId: this.nextCommandId(),
      expectedRevision: this.run.revision,
    };
    this.handleResolution(dispatchCommand(this.run, command, { pack: this.pack }));
  }
```

`apps/web/src/session/profile-session.ts`, beside its `chooseFinalChamber`:

```ts
  surrender(): void {
    this.notice = null;
    this.lastDispatchedIntentType = null;
    this.send({
      type: 'surrender',
      commandId: this.nextCommandId(),
      expectedRevision: this.serverSnapshot.revision,
    });
  }
```

- [ ] **Step 6: Add the palette entry**

In `apps/web/src/ui/CommandPalette.tsx`, add a `CommandItem` for surrender in the same group as the other non-overlay verbs. It takes a new `onSurrender: () => void` prop (add it to `CommandPaletteProps`), which `PlayScreen` wires to opening `SurrenderConfirm`. **No keybind** — do not add an `ActionId` or a `CommandShortcut` for it:

```tsx
        <CommandItem
          value="surrender"
          onSelect={() => {
            onOpenChange(false);
            onSurrender();
          }}
        >
          Surrender to the Deep
        </CommandItem>
```

Deliberately no keymap entry: a single stray keypress must never be able to end a run, and an action taken at most once per run does not earn a key.

Then in `PlayScreen.tsx`, hold the dialog's open state, pass `onSurrender={() => setSurrenderOpen(true)}` to the palette, and render `<SurrenderConfirm open={surrenderOpen} onOpenChange={setSurrenderOpen} onConfirm={() => { setSurrenderOpen(false); session.surrender(); }} />` beside the other dialogs.

- [ ] **Step 7: Add the ending copy**

`apps/web/src/ui/screens/ConclusionScreen.tsx` — both records are exhaustive over the completion type, so `COMPLETION_HEADLINE` will not typecheck without the new key:

```tsx
const COMPLETION_HEADLINE: Readonly<Record<RunConclusionProjection['completionType'], string>> = {
  died: 'You have fallen.',
  surrendered: 'You gave yourself to the Deep.',
  'became-heart': 'You have become the Heart.',
  'broke-cycle': 'You have broken the cycle.',
  refused: 'You have refused the Deep.',
};
```

and in `COMPLETION_EPILOGUE`:

```tsx
  surrendered:
    'You stop walking. There is nothing left to burn and nowhere further to feel your way, so ' +
    'you set down what you carried and let the dark have you. It is not violent. The Deep has ' +
    'been waiting a long time and is in no hurry, and what it takes it keeps.',
```

- [ ] **Step 8: Typecheck and run the web suite**

Run: `npm run typecheck --workspace @woven-deep/web && npm run test --workspace @woven-deep/web`
Expected: PASS. Vitest does not typecheck, so the `typecheck` half is what proves both exhaustive records closed.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/session/ apps/web/src/ui/
git commit -m "feat: surface surrender in the client behind a confirm"
```

---

### Task 7: Full gate and hash reconciliation

**Files:**
- Possibly modify: `packages/engine/test/fixtures/*-demo-hashes.json`

**Interfaces:**
- Consumes: every prior task.
- Produces: a green `npm run verify`.

- [ ] **Step 1: Rebuild the compiled dist**

Run: `npm run build --workspace @woven-deep/content && npm run build --workspace @woven-deep/engine`

This is mandatory before any demo runs. Demos import `packages/engine/dist`, and a workspace-scoped test run does not rebuild it — skipping this can produce a green demo against stale code.

- [ ] **Step 2: Run every hash-pinned demo**

```bash
npm run gameplay:demo && npm run merchant:demo && npm run population:demo && \
npm run dungeon:demo && npm run run-records:demo && npm run endgame:demo && npm run magic:demo
```

Expected: all pass with no drift. Engine behaviour is unchanged for every existing command and no RNG stream moved, so the pinned transcript hashes should hold even though `contentHash` changed.

- [ ] **Step 3: If any hash drifted, diff before re-pinning**

Do **not** re-pin because this plan predicted a content-hash change. Decode the demo's saves before and after and diff them to find what actually moved:

```bash
git stash && npm run build --workspace @woven-deep/content && \
  npm run build --workspace @woven-deep/engine && node scripts/gameplay-demo.mjs > /tmp/before.txt
git stash pop && npm run build --workspace @woven-deep/content && \
  npm run build --workspace @woven-deep/engine && node scripts/gameplay-demo.mjs > /tmp/after.txt
diff /tmp/before.txt /tmp/after.txt
```

Only re-pin once you can state in one sentence what changed and why it is correct. Put that sentence in the commit message. If the delta is anything other than the content hash itself, stop — something in this plan had an unintended behavioural effect.

- [ ] **Step 4: Run the full gate**

Run: `npm run verify`
Expected: PASS — typecheck, lint, format:check, depcruise, knip, and every workspace's tests.

`knip` is the one most likely to complain: if it flags `SurrenderCommand` or `SurrenderConfirm` as unused, that means a wiring step was missed (the type is not on the union, or the dialog is not rendered by `PlayScreen`). Fix the wiring — do not add a knip ignore.

- [ ] **Step 5: Commit any fixes and push**

```bash
git add -A
git commit -m "chore: reconcile demo hashes for the surrendered completion type"
git push -u origin HEAD
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| Voluntary non-death conclusion, no turn/no RNG | 3 (steps 1, 4) |
| Availability everywhere including town | 3 (steps 1, 4) |
| `CompletionType` gains `surrendered` | 1 |
| `completionBonus` in both authored copies | 1 (step 4) |
| Content schema bump + migration notes | 1 (steps 3, 5, 8) |
| `HALL_TIER_RANK` equal to `died` | 1 (step 6) |
| `SurrenderCommand` on the union | 3 (step 3) |
| Reducer revision-only branch | 3 (step 4) |
| Save schema widen + freeze + migration | 2 |
| Fragments docked | 4 (step 3) |
| Heirloom kept | 4 (step 1, third case) |
| Haunt eligibility unchanged | no task — falls out of producing an ordinary record; nothing filters on completion type |
| Artifact stint `died-with` | 4 (steps 4, 5) |
| Server hops | 5 |
| Palette entry, no keybind | 6 (step 6) |
| Single confirm dialog | 6 (steps 3, 6) |
| Conclusion headline + epilogue | 6 (step 7) |
| Session dispatch both modes | 6 (step 5) |
| Testing list (10 items) | 1 (item 10), 2 (items 5, 6), 3 (items 1-4), 4 (items 7-9) |
| Expected hash drift | 7 |

No spec requirement is unassigned.

**Placeholder scan:** The `/* ... */` markers in Tasks 4 and 6 are deliberate pointers to existing test setup helpers whose exact names must be read off the codebase, not invented. Each names what to look for and where. Every other step carries literal content.

**Type consistency:** `SurrenderCommand` (Task 3) is referenced by the same name in Tasks 5 and 7. `surrender()` is the method name on both sessions (Task 6 step 5) and matches the `onSurrender` prop wiring in step 6. `legacyRunConclusionPreSurrenderSchema` and `legacyActiveRunV19Schema` (Task 2) are used only within Task 2. `'surrendered'` is the string literal throughout — never `'surrender'`, which is the *command* type. Those two are one letter apart and must not be transposed.
