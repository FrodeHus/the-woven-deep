# Loot Coverage and Torch Curve Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Place the seven unobtainable spell tomes into chest and vendor loot tables, and reshape floor-torch supply into a curve that is generous in the shallow band, thin in mid, and absent in deep.

**Architecture:** Content-only change. Every edit is a loot-choice line in `content/loot-tables/*.yaml` using existing schema fields (`weight`, `minDepth`, `minimumQuantity`, `maximumQuantity`). Two new test files in `packages/content/test/` pin the invariants — one for item coverage and band depth-safety, one for the torch curve shape. No engine source changes, no schema bump, no save migration. The only non-content churn is re-pinning demo hash fixtures, which move because `contentHash` moves.

**Tech Stack:** TypeScript 5.8, Vitest 3.2, npm workspaces, Node >= 22.12, ESM. Content is YAML compiled by `@woven-deep/content` with strict Zod.

**Spec:** `docs/superpowers/specs/2026-08-04-loot-coverage-and-torch-curve-design.md`

## Global Constraints

- **Content schema stays v14.** No field is added; every field used here already exists on `LootChoiceDefinition`. Do not touch `schemaVersion:` in any file.
- **No save-schema bump.** No engine state field is added.
- **`item.pitch-torch` has `stackLimit: 1`.** Every torch loot choice must use `minimumQuantity: 1, maximumQuantity: 1`.
- **All new tome choices use `weight: 1`, `minimumQuantity: 1, maximumQuantity: 1`,** matching every tome already placed. The one exception is the spell vendor's `chain-spark-tome` at `weight: 2`, specified in Task 5.
- **Loot choice YAML is one flow-mapping per line**, in the exact key order `{ contentId, lootTableId, weight, minimumQuantity, maximumQuantity }` with `minDepth` appended last when present. Match the surrounding lines exactly.
- **`lootTableId: null` on every item choice.** A choice references either an item or a nested table, never both.
- **Never re-pin a drifted hash over an unexplained change** (CLAUDE.md). Task 7 covers the procedure.
- **Conventional commits, lowercase, no scope:** `feat:`, `fix:`, `test:`, `docs:`, `chore:`.
- **Working directory:** `/Users/frode.hus/src/github.com/frodehus/rogue/.claude/worktrees/feat-loot-coverage-torch-curve`, branch `worktree-feat-loot-coverage-torch-curve`, based on `origin/main` at `0f9a30db`. `npm install` has already been run here.

## Band reference

From `content/balance/core-gameplay.yaml`: `floorLoot.depthBands: { shallowMaxDepth: 6, midMaxDepth: 13 }`, `floorLoot.scatterCount: { minimum: 2, maximum: 4 }`.

| Band | Depths | Scatter table | Chest table |
| --- | --- | --- | --- |
| shallow | 1–6 | `loot-table.floor-scatter-shallow` | `loot-table.chest-shallow` |
| mid | 7–13 | `loot-table.floor-scatter-mid` | `loot-table.chest-mid` |
| deep | 14–20 | `loot-table.floor-scatter-deep` | `loot-table.chest-deep` |

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `packages/content/test/loot-coverage.test.ts` (new) | Every item is obtainable; no band table offers an item below its own `minDepth` | 1, 6 |
| `packages/content/test/torch-curve.test.ts` (new) | Torch weight share strictly decreases shallow → mid → deep, deep is zero | 2 |
| `content/loot-tables/floor-scatter-shallow.yaml` | Torch weight 3 → 7 | 3 |
| `content/loot-tables/floor-scatter-mid.yaml` | Add `pitch-torch` weight 2 | 3 |
| `content/loot-tables/chest-shallow.yaml` | Add `chain-spark-tome`, `weave-shield-tome` | 4 |
| `content/loot-tables/chest-mid.yaml` | Add `enervate-tome`, `arc-lance-tome`, `cinder-breath-tome` | 4 |
| `content/loot-tables/chest-deep.yaml` | Add `fireball-tome`, `frost-nova-tome` | 4 |
| `content/loot-tables/town-spellvendor.yaml` | Add `chain-spark-tome` w2, `fireball-tome` w1 `minDepth: 8` | 5 |
| `packages/engine/test/fixtures/*-demo-hashes.json` | Re-pin after transcript verification | 7 |

Task order is deliberate: both test files land first and fail (Tasks 1–2), the content edits turn them green (Tasks 3–5), the allowlist is tightened once (Task 6), and fixtures are re-pinned last (Task 7) so only one hash-verification round is needed.

---

### Task 1: Coverage tripwire and depth-safety test

Writes the test that proves the seven tomes are unobtainable and that no band table can offer an item below its own `minDepth`. Both assertions live in one file because both are invariants of the same thing: what a loot table is allowed to contain.

**Files:**
- Create: `packages/content/test/loot-coverage.test.ts`

**Interfaces:**
- Consumes: `compileContentDirectory` from `../src/compiler/index.js`; the types `ContentEntry`, `ItemContentEntry`, `LootTableContentEntry`, `BalanceContentEntry` from `../src/model.js`.
- Produces: nothing other tasks import. Task 6 edits the `PLACED_ELSEWHERE` constant in this file.

Background the implementer needs:

`LootChoiceDefinition` (in `packages/content/src/model/loot-table.ts`) is `{ contentId: ContentId | null, lootTableId: ContentId | null, weight: number, minimumQuantity: number, maximumQuantity: number, minDepth?: number, maxDepth?: number }`. An `ItemContentEntry` has `id`, `minDepth`, `maxDepth`, among others.

The engine's loot roller (`packages/engine/src/inventory.ts:109-110`) prunes on the **choice-level** `minDepth`/`maxDepth` only and ignores the item's own band. That is exactly why this test exists — it enforces in content what the engine does not enforce at runtime. Town/merchant tables are excluded because `packages/engine/src/merchant-stock.ts:87` does enforce item-level bounds for those.

- [ ] **Step 1: Write the failing test**

Create `packages/content/test/loot-coverage.test.ts`:

```ts
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileContentDirectory } from '../src/compiler/index.js';
import type {
  BalanceContentEntry,
  ContentEntry,
  ItemContentEntry,
  LootTableContentEntry,
} from '../src/model.js';

/**
 * Items that intentionally appear in no loot table because another system places them. Each is
 * named individually rather than matched by tag, so adding an item to this list is a deliberate
 * act that shows up in review.
 */
const PLACED_ELSEWHERE: Readonly<Record<string, string>> = {
  // Artifact singleton circulation (one instance per world, provenance-tracked).
  'item.bound-signet': 'artifact circulation',
  'item.marias-grace': 'artifact circulation',
  'item.thread-counts-needle': 'artifact circulation',
  'item.last-cartographers-compass': 'artifact circulation',
  'item.champion-fallback-relic': 'artifact circulation',
  // Encounter reward tables under content/encounters/.
  'item.ashfather-cinder': 'encounter reward',
  'item.heart-cinder': 'encounter reward',
  'item.warden-ember': 'encounter reward',
  'item.tide-crown': 'encounter reward',
  'item.herald-sigil': 'encounter reward',
  'item.echo-heartstone': 'encounter reward',
  // Placed by packages/engine/src/final-chamber-fragments.ts.
  'item.tablet-fragment.a': 'final chamber fragments',
  'item.tablet-fragment.b': 'final chamber fragments',
  'item.tablet-fragment.c': 'final chamber fragments',
};

/** The six tables the engine resolves by constructed id, one per kind per depth band. */
const BAND_TABLES = [
  { id: 'loot-table.floor-scatter-shallow', band: 'shallow' },
  { id: 'loot-table.floor-scatter-mid', band: 'mid' },
  { id: 'loot-table.floor-scatter-deep', band: 'deep' },
  { id: 'loot-table.chest-shallow', band: 'shallow' },
  { id: 'loot-table.chest-mid', band: 'mid' },
  { id: 'loot-table.chest-deep', band: 'deep' },
] as const;

async function loadPack() {
  return compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
}

function itemsOf(entries: readonly ContentEntry[]): ItemContentEntry[] {
  return entries.filter((entry): entry is ItemContentEntry => entry.kind === 'item');
}

function tablesOf(entries: readonly ContentEntry[]): LootTableContentEntry[] {
  return entries.filter(
    (entry): entry is LootTableContentEntry => entry.kind === 'loot-table',
  );
}

/**
 * The shallowest depth each band can roll at. Mirrors `representativeDepth` in
 * packages/engine/src/loot-placement.ts so retuning `floorLoot.depthBands` retunes this with it.
 */
function bandFloors(entries: readonly ContentEntry[]): Readonly<Record<string, number>> {
  const balance = entries.find(
    (entry): entry is BalanceContentEntry => entry.kind === 'balance',
  );
  if (balance === undefined) throw new Error('content pack has no balance entry');
  const { shallowMaxDepth, midMaxDepth } = balance.floorLoot.depthBands;
  return { shallow: 1, mid: shallowMaxDepth + 1, deep: midMaxDepth + 1 };
}

describe('loot coverage', () => {
  it('makes every item obtainable somewhere, or names the system that places it', async () => {
    const pack = await loadPack();
    const stocked = new Set(
      tablesOf(pack.entries).flatMap((table) =>
        table.choices
          .filter((choice) => choice.weight > 0 && choice.contentId !== null)
          .map((choice) => choice.contentId as string),
      ),
    );
    const orphans = itemsOf(pack.entries)
      .map((item) => item.id)
      .filter((id) => !stocked.has(id) && PLACED_ELSEWHERE[id] === undefined)
      .sort();
    expect(orphans).toEqual([]);
  });

  it('never offers an item in a band shallower than the item itself allows', async () => {
    const pack = await loadPack();
    const floors = bandFloors(pack.entries);
    const itemsById = new Map(itemsOf(pack.entries).map((item) => [item.id, item]));
    const violations: string[] = [];
    for (const { id: tableId, band } of BAND_TABLES) {
      const table = tablesOf(pack.entries).find((entry) => entry.id === tableId);
      if (table === undefined) throw new Error(`content pack has no ${tableId}`);
      for (const choice of table.choices) {
        if (choice.contentId === null) continue;
        const item = itemsById.get(choice.contentId);
        if (item === undefined) continue;
        const lowestReachable = Math.max(floors[band]!, choice.minDepth ?? 0);
        if (item.minDepth > lowestReachable) {
          violations.push(
            `${tableId} offers ${item.id} (minDepth ${item.minDepth}) at depth ${lowestReachable}`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test --workspace @woven-deep/content -- --run test/loot-coverage.test.ts
```

Expected: the first test FAILS, reporting exactly these seven ids:

```
item.arc-lance-tome
item.chain-spark-tome
item.cinder-breath-tome
item.enervate-tome
item.fireball-tome
item.frost-nova-tome
item.weave-shield-tome
```

The second test is expected to PASS already — it is a guard being installed ahead of the edits that could break it, not a red-to-green step. If the first test reports any id beyond those seven, STOP: an item was placed elsewhere that this plan does not know about, and `PLACED_ELSEWHERE` needs a reviewed addition rather than a silent one.

- [ ] **Step 3: Commit the failing test**

```bash
git add packages/content/test/loot-coverage.test.ts
git commit -m "test: pin that every item is obtainable and no band offers an item too shallow"
```

---

### Task 2: Torch curve shape test

Pins the *shape* of the light-supply curve rather than the literal weights, so retuning stays cheap but reversing the curve fails loudly.

**Files:**
- Create: `packages/content/test/torch-curve.test.ts`

**Interfaces:**
- Consumes: `compileContentDirectory`, and the types `ContentEntry`, `LootTableContentEntry` from `../src/model.js`.
- Produces: nothing other tasks import.

- [ ] **Step 1: Write the failing test**

Create `packages/content/test/torch-curve.test.ts`:

```ts
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileContentDirectory } from '../src/compiler/index.js';
import type { ContentEntry, LootTableContentEntry } from '../src/model.js';

const TORCH_ID = 'item.pitch-torch';

/** Floor scatter, shallow to deep. Chests are a separate supply and not part of this curve. */
const SCATTER_TABLES = [
  'loot-table.floor-scatter-shallow',
  'loot-table.floor-scatter-mid',
  'loot-table.floor-scatter-deep',
] as const;

async function loadPack() {
  return compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
}

function tableById(entries: readonly ContentEntry[], id: string): LootTableContentEntry {
  const table = entries.find(
    (entry): entry is LootTableContentEntry => entry.kind === 'loot-table' && entry.id === id,
  );
  if (table === undefined) throw new Error(`content pack has no ${id}`);
  return table;
}

/** Share of this table's total weight that rolls a torch, in basis points to stay integral. */
function torchShareBps(table: LootTableContentEntry): number {
  const total = table.choices.reduce((sum, choice) => sum + choice.weight, 0);
  if (total === 0) throw new Error(`${table.id} has zero total weight`);
  const torch = table.choices
    .filter((choice) => choice.contentId === TORCH_ID)
    .reduce((sum, choice) => sum + choice.weight, 0);
  return Math.round((torch * 10_000) / total);
}

describe('torch curve', () => {
  it('thins torch supply strictly with depth and cuts it off in the deep band', async () => {
    const pack = await loadPack();
    const [shallow, mid, deep] = SCATTER_TABLES.map((id) =>
      torchShareBps(tableById(pack.entries, id)),
    );
    expect({ deepIsZero: deep === 0, shallowOverMid: shallow > mid!, midOverDeep: mid! > deep! })
      .toEqual({ deepIsZero: true, shallowOverMid: true, midOverDeep: true });
  });

  it('keeps the shallow band the most torch-rich floor scatter in the run', async () => {
    const pack = await loadPack();
    const shallow = torchShareBps(tableById(pack.entries, 'loot-table.floor-scatter-shallow'));
    expect(shallow).toBeGreaterThanOrEqual(1500);
  });

  it('never stacks torches, which are stack-limited to one', async () => {
    const pack = await loadPack();
    const overstacked = pack.entries
      .filter((entry): entry is LootTableContentEntry => entry.kind === 'loot-table')
      .flatMap((table) =>
        table.choices
          .filter((choice) => choice.contentId === TORCH_ID && choice.maximumQuantity > 1)
          .map((choice) => `${table.id}: max ${choice.maximumQuantity}`),
      );
    expect(overstacked).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test --workspace @woven-deep/content -- --run test/torch-curve.test.ts
```

Expected: FAIL on both of the first two tests.

The first fails with `midOverDeep: false` — mid and deep are both `0` today, so `mid > deep` is false. The second fails because shallow's share is `3/33` = 909 bps, below the 1500 floor. The third is expected to PASS already (a guard, as in Task 1).

- [ ] **Step 3: Commit the failing test**

```bash
git add packages/content/test/torch-curve.test.ts
git commit -m "test: pin the floor-torch supply curve as strictly thinning with depth"
```

---

### Task 3: Reshape the torch curve

**Files:**
- Modify: `content/loot-tables/floor-scatter-shallow.yaml`
- Modify: `content/loot-tables/floor-scatter-mid.yaml`

**Interfaces:**
- Consumes: the tests from Task 2.
- Produces: torch shares of 1892 bps (shallow), 541 bps (mid), 0 (deep).

- [ ] **Step 1: Raise the shallow torch weight**

In `content/loot-tables/floor-scatter-shallow.yaml`, change the `pitch-torch` line's weight from 3 to 7. Replace:

```yaml
      - { contentId: item.pitch-torch, lootTableId: null, weight: 3, minimumQuantity: 1, maximumQuantity: 1 }
```

with:

```yaml
      - { contentId: item.pitch-torch, lootTableId: null, weight: 7, minimumQuantity: 1, maximumQuantity: 1 }
```

Leave every other line in the file untouched. Table total goes 33 → 37; torch share 9.1% → 18.9%; expected torches per floor 0.27 → 0.57 at the mean scatter count of 3.

- [ ] **Step 2: Add a thin torch trickle to the mid band**

In `content/loot-tables/floor-scatter-mid.yaml`, add one line to `choices`. Insert it immediately after the `item.lamp-oil` line so the two light-supply entries sit together:

```yaml
      - { contentId: item.pitch-torch, lootTableId: null, weight: 2, minimumQuantity: 1, maximumQuantity: 1 }
```

Table total goes 35 → 37; torch share 0% → 5.4%; expected torches per floor 0 → 0.16, roughly one across the whole seven-floor band.

Do **not** touch `content/loot-tables/floor-scatter-deep.yaml`. Deep staying torchless is the point of the curve — deep light supply is lamp oil for the brass lantern, per PR #196.

Do **not** touch `content/loot-tables/chest-shallow.yaml`'s existing `pitch-torch` weight-3 entry. The request concerned torches on the floor, and #196 tuned that chest entry deliberately.

- [ ] **Step 3: Validate the content pack compiles**

```bash
npm run content:validate
```

Expected: PASS. If Zod rejects a line, the flow-mapping key order or indentation does not match its neighbours — compare against an adjacent line character by character.

- [ ] **Step 4: Run the torch curve test to verify it passes**

```bash
npm run test --workspace @woven-deep/content -- --run test/torch-curve.test.ts
```

Expected: all three tests PASS.

- [ ] **Step 5: Commit**

```bash
git add content/loot-tables/floor-scatter-shallow.yaml content/loot-tables/floor-scatter-mid.yaml
git commit -m "feat: torches litter the shallow floors and thin out as the dungeon deepens"
```

---

### Task 4: Place the seven tomes in chests

**Files:**
- Modify: `content/loot-tables/chest-shallow.yaml`
- Modify: `content/loot-tables/chest-mid.yaml`
- Modify: `content/loot-tables/chest-deep.yaml`

**Interfaces:**
- Consumes: the coverage test from Task 1.
- Produces: all seven previously-orphaned tome ids referenced by a loot table with `weight > 0`.

No choice-level `minDepth` is needed anywhere in this task: each band's lowest depth already clears each tome's own `minDepth` (shallow starts at 1 and both shallow tomes are `minDepth: 1`; mid starts at 7 and deep at 14, both far above the `minDepth: 2` and `minDepth: 3` tomes). Task 1's second test enforces this rather than trusting it.

- [ ] **Step 1: Add the two uncommon tomes to the shallow chest**

In `content/loot-tables/chest-shallow.yaml`, append these two lines to the end of `choices`:

```yaml
      - { contentId: item.chain-spark-tome, lootTableId: null, weight: 1, minimumQuantity: 1, maximumQuantity: 1 }
      - { contentId: item.weave-shield-tome, lootTableId: null, weight: 1, minimumQuantity: 1, maximumQuantity: 1 }
```

Both are `minDepth: 1`, uncommon, priced 40 and 35. Table total 26 → 28; tome share 0% → 7.1%.

- [ ] **Step 2: Add three tomes to the mid chest**

In `content/loot-tables/chest-mid.yaml`, insert these three lines immediately after the existing `item.mend-tome` line so all four tomes sit together:

```yaml
      - { contentId: item.enervate-tome, lootTableId: null, weight: 1, minimumQuantity: 1, maximumQuantity: 1 }
      - { contentId: item.arc-lance-tome, lootTableId: null, weight: 1, minimumQuantity: 1, maximumQuantity: 1 }
      - { contentId: item.cinder-breath-tome, lootTableId: null, weight: 1, minimumQuantity: 1, maximumQuantity: 1 }
```

Table total 22 → 25; tome share 4.5% → 16.0%. The rare `minDepth: 3` tomes land mid rather than deep on purpose: a permanent spell-learn at depth 7 pays out over thirteen remaining floors, where the same tome at depth 16 has four floors to earn itself back.

- [ ] **Step 3: Add two tomes to the deep chest**

In `content/loot-tables/chest-deep.yaml`, insert these two lines immediately after the existing `item.static-field-tome` line:

```yaml
      - { contentId: item.fireball-tome, lootTableId: null, weight: 1, minimumQuantity: 1, maximumQuantity: 1 }
      - { contentId: item.frost-nova-tome, lootTableId: null, weight: 1, minimumQuantity: 1, maximumQuantity: 1 }
```

Table total 25 → 27; tome share 8.0% → 14.8%.

- [ ] **Step 4: Validate the content pack compiles**

```bash
npm run content:validate
```

Expected: PASS.

- [ ] **Step 5: Run the coverage test**

```bash
npm run test --workspace @woven-deep/content -- --run test/loot-coverage.test.ts
```

Expected: the depth-safety test PASSES. The coverage test still FAILS, but now reports nothing — every one of the seven is placed. Verify the reported `orphans` array is `[]`; if it still lists ids, a line was mistyped, so compare the id spelling against `content/items/`.

Note: both tests should now pass. If the coverage test passes here, that is the expected end state for this task.

- [ ] **Step 6: Commit**

```bash
git add content/loot-tables/chest-shallow.yaml content/loot-tables/chest-mid.yaml content/loot-tables/chest-deep.yaml
git commit -m "feat: the seven unreachable tomes finally turn up in chests"
```

---

### Task 5: Stock two tomes with the spell vendor

Widens a thin merchant table (5 choices for 3 rolls) and gives found-vs-bought a real second path.

**Files:**
- Modify: `content/loot-tables/town-spellvendor.yaml`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `chain-spark-tome` and `fireball-tome` obtainable by purchase as well as by chest.

- [ ] **Step 1: Add the two vendor choices**

In `content/loot-tables/town-spellvendor.yaml`, append these two lines to the end of `choices`:

```yaml
      - { contentId: item.chain-spark-tome, lootTableId: null, weight: 2, minimumQuantity: 1, maximumQuantity: 1 }
      - { contentId: item.fireball-tome, lootTableId: null, weight: 1, minimumQuantity: 1, maximumQuantity: 1, minDepth: 8 }
```

`chain-spark-tome` sits in the base band (no guard), joining `frost-shard-tome` and `recall-tome` as an early purchase. `fireball-tome` carries an explicit choice-level `minDepth: 8`, placing it one restock milestone above the existing `fireball-scroll` (`minDepth: 5`) and below `aegis-tome` (`minDepth: 10`).

The `minDepth: 8` guard is load-bearing here in a way it is not in Task 4: merchant depth is the run's high-water mark (`Math.max(1, run.metrics.deepestDepth)`, `packages/engine/src/merchant-stock.ts:225`), not a band floor, so without the guard the tome would appear as soon as the item's own `minDepth: 3` is cleared.

Update the table's leading comment to describe the widened stock. Replace:

```yaml
    # Base band (no minDepth/maxDepth) covers the earliest tomes and scrolls a hero can already
    # use; the table widens at two restock milestones as the run deepens: fireball scroll at
    # depth 5 and the legendary aegis tome at depth 10.
```

with:

```yaml
    # Base band (no minDepth/maxDepth) covers the earliest tomes and scrolls a hero can already
    # use; the table widens at three restock milestones as the run deepens: fireball scroll at
    # depth 5, the fireball tome at depth 8, and the legendary aegis tome at depth 10.
```

- [ ] **Step 2: Validate the content pack compiles**

```bash
npm run content:validate
```

Expected: PASS.

- [ ] **Step 3: Run the full content suite**

```bash
npm run test --workspace @woven-deep/content
```

Expected: all PASS, including `default-content.test.ts`, whose pinned counts (`item: 58`, `loot-table: 28`) must be unchanged — this plan adds no items and no tables. If either count moved, a file was added by mistake; STOP and investigate rather than updating the pin.

- [ ] **Step 4: Commit**

```bash
git add content/loot-tables/town-spellvendor.yaml
git commit -m "feat: the spell vendor deals in two more tomes as the run deepens"
```

---

### Task 6: Tighten the coverage allowlist

The `PLACED_ELSEWHERE` allowlist is the one place this work could rot: an entry that stops being accurate silently excuses a real orphan. This task verifies each of the fourteen claims against the tree rather than trusting the comment.

**Files:**
- Modify: `packages/content/test/loot-coverage.test.ts`

**Interfaces:**
- Consumes: the file created in Task 1.
- Produces: a verified allowlist.

- [ ] **Step 1: Verify every allowlist claim**

Run each check and confirm it returns at least one hit:

```bash
grep -rn "bound-signet\|marias-grace\|thread-counts-needle\|last-cartographers-compass\|champion-fallback-relic" packages/engine/src/ | head
grep -rln "ashfather-cinder\|heart-cinder\|warden-ember\|tide-crown\|herald-sigil\|echo-heartstone" content/encounters/
grep -rn "TABLET_FRAGMENT_TAG\|tablet-fragment" packages/engine/src/final-chamber-fragments.ts
```

Expected: the second returns encounter YAML paths; the third returns `packages/engine/src/final-chamber-fragments.ts:4`. If any group returns nothing, that item is **not** placed by the system the allowlist claims — remove it from `PLACED_ELSEWHERE` and let the test fail, because it is a genuine orphan.

- [ ] **Step 2: Run the content suite once more**

```bash
npm run test --workspace @woven-deep/content -- --run test/loot-coverage.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit if anything changed**

If Step 1 required an allowlist edit:

```bash
git add packages/content/test/loot-coverage.test.ts
git commit -m "test: drop an allowlist claim that no placement system backs"
```

If nothing changed, skip the commit and proceed.

---

### Task 7: Rebuild, run the full gate, and re-pin fixtures

Content changed, so `contentHash` changed, so demo hash fixtures move. This task establishes *why* each moved before re-pinning any of them.

**Files:**
- Modify: `packages/engine/test/fixtures/*-demo-hashes.json` (only those that move)

**Interfaces:**
- Consumes: all prior tasks.
- Produces: a green `npm test`.

- [ ] **Step 1: Rebuild both dists**

```bash
npm run build --workspace @woven-deep/content && npm run build --workspace @woven-deep/engine
```

This is mandatory before any demo or CLI suite. Workspace-scoped vitest does **not** rebuild the dists, and a stale dist produces green results against old code — #196's own transcript records a re-pin round that was misattributed for exactly this reason.

- [ ] **Step 2: Run the full root gate**

```bash
npm test 2>&1 | tail -60
```

Expected: some of the seven demo hash suites FAIL on drifted hashes. Record which fixtures moved and which components within each. The seven are `dungeon`, `endgame`, `gameplay`, `magic`, `merchant`, `population`, `run-records`.

- [ ] **Step 3: Explain every drift before touching a fixture**

For each failing demo, print the full transcript rather than the hash-only `--verify` output, and diff it against the same demo built from `origin/main`:

```bash
npm run gameplay:demo > /tmp/after-gameplay.txt
git stash && npm run build --workspace @woven-deep/content && npm run build --workspace @woven-deep/engine
npm run gameplay:demo > /tmp/before-gameplay.txt
git stash pop && npm run build --workspace @woven-deep/content && npm run build --workspace @woven-deep/engine
diff /tmp/before-gameplay.txt /tmp/after-gameplay.txt
```

Repeat per failing demo (`merchant:demo`, `population:demo`, `dungeon:demo`, `run-records:demo`, `magic:demo`, `endgame:demo`).

The expected pattern, per #196: hashes that embed the save (which encodes `contentHash`) and hashes that embed the `deriveHallRecordId(seed, contentHash)` Hall record ID move; event, projection, records, and standings hashes stay byte-identical.

**This change differs from #196 in one important way.** #196 edited tables its demo fixtures never drew from. This change edits `floor-scatter-shallow`, `floor-scatter-mid`, and all three chest tables — tables that a floor-generating demo *does* roll against. A genuine draw shift is therefore plausible: adding a choice changes a table's total weight, which changes which choice a given RNG draw selects. That is a legitimate, explainable change, not a bug — but it must be **stated** in the commit message with the specific items that changed hands, not absorbed silently.

STOP and report if any component moves for a reason traceable to neither `contentHash` propagation nor a weight-total draw shift in a table this plan edited.

- [ ] **Step 4: Re-pin the fixtures**

**There is no `--update` flag.** `--verify` is the only argument the demo scripts accept, and supplying it twice is an error. The re-pin mechanism is: run the demo *without* `--verify`, which writes a candidate hashes file and prints its path, then copy that candidate over the reviewed fixture.

Candidate paths differ by script — `gameplay`, `dungeon`, and `population` write to a fixed `/tmp/<name>-demo-hashes.json`; `endgame`, `magic`, `merchant`, and `run-records` write into a fresh `mkdtemp` directory. Both forms print the path as `candidate hashes written <path>`, so always read the path from stdout rather than assuming it.

For each demo whose drift was explained in Step 3:

```bash
node scripts/gameplay-demo.mjs            # prints: candidate hashes written <path>
cp <path-from-stdout> packages/engine/test/fixtures/gameplay-demo-hashes.json
```

Note the npm `*:demo` scripts append `--verify` themselves and rebuild both dists first, so invoke `node scripts/<name>-demo.mjs` directly here. The dists are already current from Step 1.

The seven fixtures are `dungeon`, `endgame`, `gameplay`, `magic`, `merchant`, `population`, and `run-records`. Re-pin only the ones that actually moved.

- [ ] **Step 5: Run the full gate to green**

```bash
npm test 2>&1 | tail -30
npm run typecheck
```

Expected: both PASS.

- [ ] **Step 6: Commit with the explanation in the message**

```bash
git add packages/engine/test/fixtures/
git commit -m "test: re-pin demo hashes for the loot table additions

Every moved component traced to one of two causes, verified by diffing
full demo transcripts against origin/main rather than hash-only output:

- contentHash propagation (embedded in the save, and via the derived
  Hall record ID in deriveHallRecordId(seed, contentHash))
- <list the specific draw shifts, table by table, or state that none occurred>

No component moved for an unexplained reason."
```

Replace the placeholder line with the actual findings from Step 3 before committing.

---

### Task 8: Push and open a pull request

**Files:** none.

- [ ] **Step 1: Confirm the working tree is clean and the gate is green**

```bash
git status --short
npm test 2>&1 | tail -5
```

- [ ] **Step 2: Push and open a draft PR**

```bash
git push -u origin worktree-feat-loot-coverage-torch-curve
gh pr create --draft --base main \
  --title "feat: loot coverage for the orphan tomes and a floor-torch depth curve" \
  --body "Implements docs/superpowers/specs/2026-08-04-loot-coverage-and-torch-curve-design.md

**Tome coverage.** Seven spell tomes existed with prices and \`effect.spell.learn\` but were referenced by no loot table, vault, encounter, or merchant — unobtainable since 2026-07-23. All seven are now placed: \`chain-spark\` and \`weave-shield\` in the shallow chest, \`enervate\`/\`arc-lance\`/\`cinder-breath\` in mid, \`fireball\`/\`frost-nova\` in deep, each at weight 1. The spell vendor also stocks \`chain-spark-tome\` (w2) and \`fireball-tome\` (w1, minDepth 8).

**Torch curve.** Floor scatter torch weight goes 3 → 7 in shallow (9.1% → 18.9% share, ~0.27 → ~0.57 torches per floor) and gains a weight-2 entry in mid (0 → 5.4%). Deep stays torchless, preserving #196's rule that deep light supply is lantern oil.

**Guards.** \`packages/content/test/loot-coverage.test.ts\` fails the build on any future item with no home, and pins that no band table offers an item below its own \`minDepth\` — which the engine does not enforce at runtime (\`inventory.ts:109-110\` prunes on choice-level bands only). \`torch-curve.test.ts\` pins the curve's shape rather than its literal weights."
```

- [ ] **Step 3: Report the PR URL**

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: tome chest placement → Task 4; vendor placement → Task 5; torch curve → Task 3; coverage tripwire → Task 1 + 6; depth-safety pin → Task 1; torch curve pin → Task 2; fixture fallout → Task 7; `default-content.test.ts` count check → Task 5 Step 3. The spec's non-goals are respected: no schema bump, no new items, no `scatterCount` change, no general weight audit, no change to `chest-shallow`'s torch entry.

**Placeholder scan.** One intentional placeholder remains: Task 7 Step 6's commit-message line listing draw shifts, which cannot be known before Step 3 runs. It is explicitly flagged as needing replacement. No other TBDs.

**Type consistency.** `torchShareBps` returns basis points in both the function and its call sites. `bandFloors` returns a record keyed by the same `'shallow' | 'mid' | 'deep'` strings used in `BAND_TABLES`. `PLACED_ELSEWHERE` is `Record<string, string>` and is read via `=== undefined` in Task 1 and edited in Task 6. `LootChoiceDefinition.contentId` is nullable and is null-checked before every use.

**One risk worth restating.** Task 7 Step 3 is the only step where a judgement call is required rather than a command run. It is also the step where #196 went wrong once. The instruction to diff full transcripts rather than hash-only output is the guard.
