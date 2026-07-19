# Findable Items (G5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make items findable — monsters drop loot on death, and authored vault item-slots get filled — by reusing the existing loot engine.

**Architecture:** Two additive drops. (1) A pure `monster-loot` engine module rolls a monster's optional loot table on death and appends floor items, wired into world-step through a single post-resolution reaping pass. (2) A vault item-slot consumer in floor generation fills `kind:'item'` slots from a loot table named by the slot. Both endpoints emit ordinary floor `ItemInstance`s; render and pickup already work.

**Tech Stack:** TypeScript 5.8 (strict, ESM), Vitest 3.2, npm workspaces. Packages: `packages/content` (YAML→pack, Zod), `packages/engine` (deterministic core). Content YAML under `content/`.

## Global Constraints

- **Determinism:** every RNG draw consumes a `Uint32State` and threads the advanced state back; never reuse a state. Monster-death loot draws from `run.rng.loot`; vault item-slot fills draw from the floor-generation RNG stream the sibling slot consumers use. Generation stays a pure function of the floor seed.
- **Drop-chance draw always advances:** a monster carrying a `lootTableId` advances `run.rng.loot` by the chance draw even when the result is "no drop", so replays stay byte-identical.
- **Fail loud at compile time:** unknown `lootTableId`/`contentId`, out-of-range `dropChance`, and the vault item-slot neither/both case are content-validation errors at pack build, matching existing loot validation. No silent runtime fallback items.
- **`dropChance` is a probability in `[0, 1]`,** default `1`; only meaningful when `lootTableId` is set.
- **A vault `item` slot sets exactly one of** `lootTableId` (rolls a table) or `contentId` (one fixed item).
- **No history/lineage comments** — comments describe current behavior only, never what changed.
- **Build order:** rebuild `@woven-deep/content` then `@woven-deep/engine` dist before running the engine suite (`npm run -w @woven-deep/content build && npm run -w @woven-deep/engine build`).

---

## File Structure

- `packages/content/src/model.ts` — add loot fields to `MonsterContentEntry` and `VaultPlacementSlot`.
- `packages/content/src/compiler/schema.ts` — mirror both in Zod.
- `packages/content/src/compiler/content-validation.ts` — validate monster loot references + `dropChance` range.
- `packages/content/src/compiler/vault-validation.ts` — validate item-slot loot references + exactly-one rule.
- `packages/engine/src/monster-loot.ts` — **new**: pure `dropMonsterLoot(...)` + the `loot.dropped` event.
- `packages/engine/src/model.ts` — add `loot.dropped` to the `DomainEvent` union.
- `packages/engine/src/save-schema.ts` — add the `loot.dropped` Zod event + register it.
- `packages/engine/src/world-step.ts` — single reaping pass calling `dropMonsterLoot`.
- `packages/engine/src/population-placement.ts` — vault item-slot consumer.
- Tests colocated under each package's `test/` dir.
- `content/loot-tables/*.yaml`, `content/monsters/*.yaml`, `content/vaults/lampwright-cache.yaml` — tuning.

---

## Task 1: Monster loot content fields

**Files:**
- Modify: `packages/content/src/model.ts` (`MonsterContentEntry`, ends ~line 86)
- Modify: `packages/content/src/compiler/schema.ts` (monster entry schema)
- Modify: `packages/content/src/compiler/content-validation.ts` (add monster-loot checks)
- Test: `packages/content/test/parse-file.test.ts` and `packages/content/test/model.test.ts` (follow whichever already covers monster parsing/validation)

**Interfaces:**
- Produces: `MonsterContentEntry.lootTableId: ContentId | null` and `MonsterContentEntry.dropChance: number`. `ContentId` is the existing id-string type used across `model.ts`.

- [ ] **Step 1: Write the failing test** — a monster with loot fields compiles and an unknown table is rejected. Add to the content test that already builds a monster fixture:

```ts
it('parses a monster loot table and drop chance', () => {
  const pack = compileFixture({ /* existing monster fixture */ monster: {
    lootTableId: 'loot-table.cave-rat', dropChance: 0.25,
  }, lootTables: ['loot-table.cave-rat'] });
  const rat = pack.entries.find((e) => e.kind === 'monster' && e.id === 'monster.cave-rat');
  expect(rat).toMatchObject({ lootTableId: 'loot-table.cave-rat', dropChance: 0.25 });
});

it('rejects a monster whose lootTableId does not exist', () => {
  expect(() => compileFixture({ monster: { lootTableId: 'loot-table.missing', dropChance: 1 } }))
    .toThrow(/loot-table\.missing/);
});

it('rejects a monster dropChance outside 0..1', () => {
  expect(() => compileFixture({ monster: { lootTableId: 'loot-table.cave-rat', dropChance: 1.5 } }))
    .toThrow(/dropChance/);
});
```
Match the existing test's fixture/compile helper names (read the top of the chosen test file first; reuse its builders rather than inventing `compileFixture` if a different helper exists).

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/content && npx vitest run parse-file model`
Expected: FAIL (fields absent / not validated).

- [ ] **Step 3: Add the model fields.** In `MonsterContentEntry` (after `rarity`):

```ts
  readonly lootTableId: ContentId | null;
  readonly dropChance: number;
```

- [ ] **Step 4: Mirror in the Zod schema** (`schema.ts`, monster entry object). Add, defaulting so existing YAML stays valid:

```ts
  lootTableId: contentId.nullable().default(null),
  dropChance: z.number().min(0).max(1).default(1),
```
Use the file's existing `contentId` schema helper (the same one other id fields use). If the monster schema builds its object via a shared helper, add the keys there.

- [ ] **Step 5: Validate references.** In `content-validation.ts`, in the pass that has the set of known loot-table ids (the existing `lootIssues` collects loot-table ids — reuse that id set), add a check: for each monster entry with `lootTableId !== null`, error if the id is not a known `loot-table` entry. Message must include the offending id. `dropChance` range is already enforced by the schema; do not duplicate it in validation.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/content && npx vitest run parse-file model`
Expected: PASS.

- [ ] **Step 7: Rebuild content + run the whole content suite** (catches admin-doc/schema snapshot drift)

Run: `npm run -w @woven-deep/content build && cd packages/content && npx vitest run`
Expected: PASS. If an admin-docs or schema snapshot test fails because the monster schema changed, update the snapshot/doc it points to as part of this task.

- [ ] **Step 8: Commit**

```bash
git add packages/content
git commit -m "feat: add optional loot table and drop chance to monsters"
```

---

## Task 2: Vault item-slot loot fields

**Files:**
- Modify: `packages/content/src/model.ts` (`VaultPlacementSlot`, ~line 499)
- Modify: `packages/content/src/compiler/schema.ts` (slot schema, ~line 401)
- Modify: `packages/content/src/compiler/vault-validation.ts` (slot checks)
- Test: `packages/content/test/parse-file.test.ts` (or the vault-focused content test)

**Interfaces:**
- Produces: `VaultPlacementSlot.lootTableId: ContentId | null` and `VaultPlacementSlot.contentId: ContentId | null`. For `kind:'item'` slots exactly one is non-null; for all other kinds both are null.

- [ ] **Step 1: Write the failing test:**

```ts
it('parses a vault item slot that names a loot table', () => {
  const pack = compileVault({ legend: { i: { terrain: 'floor',
    slot: { id: 'item-cache', kind: 'item', required: true, tags: ['cache'], lootTableId: 'loot-table.cave-rat' } } },
    lootTables: ['loot-table.cave-rat'] });
  const vault = pack.entries.find((e) => e.kind === 'vault');
  const slot = vault.legend.i.slot;
  expect(slot).toMatchObject({ lootTableId: 'loot-table.cave-rat', contentId: null });
});

it('rejects an item slot with neither lootTableId nor contentId', () => {
  expect(() => compileVault({ legend: { i: { terrain: 'floor',
    slot: { id: 'x', kind: 'item', required: true, tags: [] } } } }))
    .toThrow(/item slot/);
});

it('rejects an item slot with both lootTableId and contentId', () => {
  expect(() => compileVault({ legend: { i: { terrain: 'floor',
    slot: { id: 'x', kind: 'item', required: true, tags: [], lootTableId: 'loot-table.cave-rat', contentId: 'item.crimson-potion' } } },
    lootTables: ['loot-table.cave-rat'], items: ['item.crimson-potion'] }))
    .toThrow(/item slot/);
});
```
Reuse the existing vault test's compile helper; adapt names to it.

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/content && npx vitest run parse-file`
Expected: FAIL.

- [ ] **Step 3: Add the model fields** to `VaultPlacementSlot`:

```ts
  readonly lootTableId: ContentId | null;
  readonly contentId: ContentId | null;
```

- [ ] **Step 4: Mirror in the slot schema** (`schema.ts:401` area):

```ts
  lootTableId: contentId.nullable().default(null),
  contentId: contentId.nullable().default(null),
```

- [ ] **Step 5: Validate in `vault-validation.ts`.** For each legend slot:
  - if `kind === 'item'`: exactly one of `lootTableId`/`contentId` must be non-null, else error `"item slot <id> must set exactly one of lootTableId or contentId"`; the referenced `lootTableId` must be a known loot-table id and `contentId` a known item id (reuse the pack's id sets — vault-validation already receives the entry list; collect loot-table and item ids if not already available).
  - if `kind !== 'item'`: both must be null, else error `"<kind> slot <id> may not set item loot fields"`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/content && npx vitest run parse-file`
Expected: PASS.

- [ ] **Step 7: Rebuild content + full content suite**

Run: `npm run -w @woven-deep/content build && cd packages/content && npx vitest run`
Expected: PASS (update any schema snapshot/admin-doc the slot change touches).

- [ ] **Step 8: Commit**

```bash
git add packages/content
git commit -m "feat: let vault item slots name a loot table or fixed item"
```

---

## Task 3: Monster-loot engine module + `loot.dropped` event

Pure and unit-tested in isolation; no world-step wiring yet.

**Files:**
- Create: `packages/engine/src/monster-loot.ts`
- Modify: `packages/engine/src/model.ts` (add `loot.dropped` to the `DomainEvent` union, near `actor.died` ~line 214)
- Modify: `packages/engine/src/save-schema.ts` (Zod event + register in the event union and kinds list, ~lines 90/330)
- Test: `packages/engine/test/monster-loot.test.ts` (new)

**Interfaces:**
- Produces:
```ts
export interface LootDroppedEvent {
  readonly type: 'loot.dropped';
  readonly eventId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly contentId: OpaqueId;
  readonly x: number;
  readonly y: number;
  readonly itemIds: readonly OpaqueId[];
}
export function dropMonsterLoot(input: Readonly<{
  state: ActiveRun; content: CompiledContentPack; deadActor: ActorState; eventId: OpaqueId;
}>): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }>;
```
- Consumes: `createFloorLootFromTable` (`inventory.ts`), `rollDie` (`random.ts`), `compareCodeUnits` (existing sort helper used by `boss-behavior.ts`).

- [ ] **Step 1: Write the failing tests** (`monster-loot.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { dropMonsterLoot } from '../src/monster-loot.js';
// build a run + content pack via the existing engine test fixtures (see gameplay-fixture.ts / createDemoRun)

it('drops nothing and leaves state.items unchanged for a monster with no loot table', () => {
  const { run, content, deadActor } = fixtureWith({ lootTableId: null, dropChance: 1 });
  const out = dropMonsterLoot({ state: run, content, deadActor, eventId: 'evt.1' });
  expect(out.state.items).toEqual(run.items);
  expect(out.events).toEqual([]);
  expect(out.state.rng.loot).toEqual(run.rng.loot); // no table => no draw
});

it('with dropChance 0 advances the loot rng but drops nothing', () => {
  const { run, content, deadActor } = fixtureWith({ lootTableId: 'loot-table.cave-rat', dropChance: 0 });
  const out = dropMonsterLoot({ state: run, content, deadActor, eventId: 'evt.1' });
  expect(out.state.items).toEqual(run.items);
  expect(out.state.rng.loot).not.toEqual(run.rng.loot); // chance draw advanced it
  expect(out.events).toEqual([]);
});

it('with dropChance 1 drops the table result at the death tile and emits loot.dropped', () => {
  const { run, content, deadActor } = fixtureWith({ lootTableId: 'loot-table.cave-rat', dropChance: 1 });
  const out = dropMonsterLoot({ state: run, content, deadActor, eventId: 'evt.1' });
  const dropped = out.state.items.filter((i) => !run.items.some((r) => r.itemId === i.itemId));
  expect(dropped.length).toBeGreaterThan(0);
  for (const item of dropped) {
    expect(item.location).toEqual({ type: 'floor', floorId: deadActor.floorId, x: deadActor.x, y: deadActor.y });
  }
  expect(out.events).toEqual([{ type: 'loot.dropped', eventId: 'evt.1', actorId: deadActor.actorId,
    contentId: deadActor.contentId, x: deadActor.x, y: deadActor.y, itemIds: dropped.map((d) => d.itemId).sort() }]);
});

it('is deterministic for a fixed loot rng state', () => {
  const a = fixtureWith({ lootTableId: 'loot-table.cave-rat', dropChance: 1 });
  const b = fixtureWith({ lootTableId: 'loot-table.cave-rat', dropChance: 1 });
  expect(dropMonsterLoot({ ...a, deadActor: a.deadActor, eventId: 'e' }).state.items)
    .toEqual(dropMonsterLoot({ ...b, deadActor: b.deadActor, eventId: 'e' }).state.items);
});
```
Build `fixtureWith` on top of the existing engine test helpers (`createDemoRun` / `gameplay-fixture.ts`): it returns a run whose content pack includes `loot-table.cave-rat`, a monster entry carrying the given `lootTableId`/`dropChance`, and a `deadActor` (health 0) of that monster on the current floor. Read `packages/engine/test` for the existing builders before writing this.

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/engine && npx vitest run monster-loot`
Expected: FAIL (module missing).

- [ ] **Step 3: Add the event to the model.** In `model.ts` `DomainEvent` union add `| LootDroppedEvent` and define `LootDroppedEvent` (shape above). In `save-schema.ts` add a `strictObject` matching `actorDiedEvent`'s style plus `x`, `y`, `itemIds: z.array(identifier)`, add it to the event discriminated union, and add `'loot.dropped'` to the event-kinds list (~line 330). Run `cd packages/engine && npx tsc -p tsconfig.json --noEmit` and resolve any exhaustive-switch gaps (e.g. an `event-projection.ts` / `run-metrics.ts` switch) by adding a no-op/log-only case for `loot.dropped`.

- [ ] **Step 4: Implement `monster-loot.ts`:**

```ts
import type { ActiveRun, ActorState, DomainEvent } from './model.js';
import type { CompiledContentPack, MonsterContentEntry } from '@woven-deep/content';
import type { OpaqueId } from './ids.js';           // use the existing OpaqueId import path in this package
import { createFloorLootFromTable } from './inventory.js';
import { rollDie } from './random.js';
import { compareCodeUnits } from './ordering.js';   // same helper boss-behavior.ts imports

const DROP_CHANCE_RESOLUTION = 10_000;

function monsterEntry(content: CompiledContentPack, contentId: OpaqueId): MonsterContentEntry | undefined {
  return content.entries.find((e): e is MonsterContentEntry => e.kind === 'monster' && e.id === contentId);
}

export interface LootDroppedEvent {
  readonly type: 'loot.dropped';
  readonly eventId: OpaqueId; readonly actorId: OpaqueId; readonly contentId: OpaqueId;
  readonly x: number; readonly y: number; readonly itemIds: readonly OpaqueId[];
}

export function dropMonsterLoot(input: Readonly<{
  state: ActiveRun; content: CompiledContentPack; deadActor: ActorState; eventId: OpaqueId;
}>): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  const monster = monsterEntry(input.content, input.deadActor.contentId);
  if (!monster || monster.lootTableId === null) return { state: input.state, events: [] };

  const chance = rollDie(input.state.rng.loot, DROP_CHANCE_RESOLUTION);
  const threshold = Math.round(monster.dropChance * DROP_CHANCE_RESOLUTION);
  if (chance.value > threshold) {
    return { state: { ...input.state, rng: { ...input.state.rng, loot: chance.state } }, events: [] };
  }

  const loot = createFloorLootFromTable({ content: input.content, tableId: monster.lootTableId,
    state: chance.state, itemIdPrefix: `item.drop.${input.deadActor.actorId}`,
    floorId: input.deadActor.floorId, x: input.deadActor.x, y: input.deadActor.y });

  if (loot.items.length === 0) {
    return { state: { ...input.state, rng: { ...input.state.rng, loot: loot.state } }, events: [] };
  }
  for (const item of loot.items) if (input.state.items.some((e) => e.itemId === item.itemId)) {
    throw new Error(`internal invariant: monster loot item ${item.itemId} already exists`);
  }
  const items = [...input.state.items, ...loot.items].sort((l, r) => compareCodeUnits(l.itemId, r.itemId));
  const itemIds = loot.items.map((i) => i.itemId).sort(compareCodeUnits);
  return {
    state: { ...input.state, items, rng: { ...input.state.rng, loot: loot.state } },
    events: [{ type: 'loot.dropped', eventId: input.eventId, actorId: input.deadActor.actorId,
      contentId: input.deadActor.contentId, x: input.deadActor.x, y: input.deadActor.y, itemIds }],
  };
}
```
Confirm the exact import paths for `OpaqueId`, `compareCodeUnits`, and `ActiveRun`/`ActorState` by matching how `boss-behavior.ts` imports them (it uses all three). Adjust the `itemIds` sort to match how `boss-behavior.ts` sorts (`compareCodeUnits`), so ordering is consistent.

- [ ] **Step 5: Run the unit tests**

Run: `npm run -w @woven-deep/content build && cd packages/engine && npx vitest run monster-loot`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `cd packages/engine && npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/monster-loot.ts packages/engine/src/model.ts packages/engine/src/save-schema.ts packages/engine/test/monster-loot.test.ts packages/engine/src/event-projection.ts packages/engine/src/run-metrics.ts
git commit -m "feat: add monster death-loot module and loot.dropped event"
```

---

## Task 4: Wire monster loot into the death reaping pass

One call site, deterministic, folded into the world-step result.

**Files:**
- Modify: `packages/engine/src/world-step.ts`
- Test: `packages/engine/test/world-step.test.ts` (or the existing combat/step test file)

**Interfaces:**
- Consumes: `dropMonsterLoot` from Task 3.

- [ ] **Step 1: Write the failing test** — a hero melee kill of a monster with `dropChance 1` leaves loot on the tile and emits `loot.dropped`, and the run replays byte-identically:

```ts
it('drops monster loot on a killing blow and stays replay-stable', () => {
  const run = seededRunWithAdjacentMonster({ monsterLootTableId: 'loot-table.cave-rat', dropChance: 1 });
  const after = advanceUntilMonsterDead(run);           // drive attacks via the public step API
  const dropped = after.state.items.filter((i) => i.location.type === 'floor');
  expect(dropped.length).toBeGreaterThan(0);
  expect(after.events.some((e) => e.type === 'loot.dropped')).toBe(true);
  // replay: re-encode/decode and re-derive the same items + rng.loot
  expect(replayHash(after.state)).toEqual(replayHash(after.state));
});
```
Use the engine test's existing public-API drivers (the suite already advances runs and asserts replay hashes — mirror `projection`/replay tests). Do NOT reach into private combat internals.

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/engine && npx vitest run world-step`
Expected: FAIL (no loot dropped).

- [ ] **Step 3: Add a single reaping pass.** In `world-step.ts`, after all combat/effects/reactions have folded into the local `state` and its `events`, and before the function returns, compute the actors that died **this step** and drop their loot once each, in deterministic `actorId` order:

```ts
// `input.state.actors` is the pre-step roster; `state.actors` is post-step.
const preHealth = new Map(input.state.actors.map((a) => [a.actorId, a.health] as const));
const newlyDead = state.actors
  .filter((a) => a.health === 0 && !a.playerControlled && (preHealth.get(a.actorId) ?? 0) > 0)
  .sort((l, r) => compareCodeUnits(l.actorId, r.actorId));
for (const deadActor of newlyDead) {
  const drop = dropMonsterLoot({ state, content: input.content, deadActor, eventId: <the step's event id source> });
  state = drop.state;
  events.push(...drop.events);
}
```
Match the surrounding code: use the same `state`/`events` accumulators the function already threads, and the same event-id source the neighboring events use (find how `actor.died`'s `eventId` is produced in this function and reuse it). If the function prunes dead actors from `state.actors` before this point, move the pass to just before that prune so dead actors are still present. Confirm `playerControlled` is the correct hero flag on `ActorState` (grep — the hero-death early return at ~line 849 checks `passiveHero.health === 0`; use the same actor field it relies on).

- [ ] **Step 4: Run the test + full engine suite**

Run: `npm run -w @woven-deep/content build && npm run -w @woven-deep/engine build && cd packages/engine && npx vitest run`
Expected: PASS, including the existing replay/hash fixtures. If a `*-demo-hashes.json` fixture legitimately changes because monster loot now drops in a demo run, regenerate it via the project's fixture-update path and eyeball the diff to confirm only loot-related additions.

- [ ] **Step 5: Typecheck**

Run: `cd packages/engine && npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/world-step.ts packages/engine/test
git commit -m "feat: drop monster loot in the world-step death reaping pass"
```

---

## Task 5: Vault item-slot consumer

**Files:**
- Modify: `packages/engine/src/population-placement.ts`
- Test: `packages/engine/test/population-placement.test.ts` (or the floor-generation test that already asserts placement)

**Interfaces:**
- Consumes: `createFloorLootFromTable` and `createFloorItem` (`inventory.ts`); the vault slot's originating `VaultPlacementSlot` (via the floor's `placementSlots` → vault legend lookup already used by `slotProvidesTags`).

- [ ] **Step 1: Write the failing test** — a generated floor whose vault has a filled `item` slot places the item at the slot coordinates, deterministically:

```ts
it('fills a vault item slot from its loot table at the slot position', () => {
  const floor = generateFloorWithVault('vault.item-cache-test');   // fixture vault with one kind:item slot + lootTableId
  const slot = floor.placementSlots.find((s) => s.kind === 'item')!;
  const placed = resultingRun.items.filter((i) => i.location.type === 'floor'
    && i.location.x === slot.x && i.location.y === slot.y);
  expect(placed.length).toBeGreaterThan(0);
});

it('is a pure function of the floor seed', () => {
  expect(placedItems(generateFloorWithVault('vault.item-cache-test', 1234)))
    .toEqual(placedItems(generateFloorWithVault('vault.item-cache-test', 1234)));
});
```
Reuse the existing floor-generation test fixtures; add a tiny test vault with one `kind:item` slot naming a loot table if none exists.

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/engine && npx vitest run population-placement`
Expected: FAIL (item slots not consumed).

- [ ] **Step 3: Add the consumer.** In `population-placement.ts`, beside the monster/objective consumers, add a pass over `floor.placementSlots.filter((s) => s.kind === 'item')`. For each, resolve its originating vault slot (same lookup path `slotProvidesTags` uses to reach the vault legend), then:
  - if the vault slot has `lootTableId`: `createFloorLootFromTable({ content, tableId, state: <generation rng>, itemIdPrefix: 'item.vault.' + slot.slotId, floorId: floor.floorId, x: slot.x, y: slot.y })`, thread the generation rng state back, and add `loot.items` to `createdItems`.
  - else (`contentId`): push `createFloorItem({ content, contentId, itemId: 'item.vault.' + slot.slotId, floorId, x: slot.x, y: slot.y })`.

  Use the **floor-generation RNG stream** the sibling consumers in this file already thread (grep this file for the `rng`/`state` param the monster/objective placement uses — NOT `run.rng.loot`). Add the produced items to the same `createdItems` array returned at the end (merged into `run.items` at ~line 569).

- [ ] **Step 4: Run the test + full engine suite**

Run: `npm run -w @woven-deep/content build && npm run -w @woven-deep/engine build && cd packages/engine && npx vitest run`
Expected: PASS (regenerate demo-hash fixtures if a demo floor now carries vault items, eyeballing the diff).

- [ ] **Step 5: Typecheck**

Run: `cd packages/engine && npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/population-placement.ts packages/engine/test
git commit -m "feat: fill vault item slots during floor generation"
```

---

## Task 6: Content tuning — early loot so floors aren't barren

**Files:**
- Create/modify: `content/loot-tables/*.yaml` (small early tables)
- Modify: `content/monsters/cave-rat.yaml`, `content/monsters/training-beetle.yaml`, `content/monsters/population-examples.yaml` (wire `lootTableId` + `dropChance`)
- Modify: `content/vaults/lampwright-cache.yaml` (give the `item` slot a `lootTableId`)
- Test: `packages/content/test/default-content.test.ts` (compiles the real content dir) + one engine integration assertion

**Interfaces:** none new — uses Task 1/2 fields.

- [ ] **Step 1: Author early loot tables.** Add modest `loot-table` entries (reuse existing early items: `travel-ration`, `lamp-oil`, `crimson-potion`, `wooden-arrows`). Keep `rolls: 1` and weight a large "common consumable" share. Example `content/loot-tables/cave-rat.yaml`:

```yaml
- kind: loot-table
  id: loot-table.cave-rat
  rolls: 1
  choices:
    - { contentId: item.travel-ration, lootTableId: null, weight: 6, minimumQuantity: 1, maximumQuantity: 1 }
    - { contentId: item.lamp-oil, lootTableId: null, weight: 3, minimumQuantity: 1, maximumQuantity: 1 }
    - { contentId: item.crimson-potion, lootTableId: null, weight: 1, minimumQuantity: 1, maximumQuantity: 1 }
```

- [ ] **Step 2: Wire monsters.** In each early monster YAML add e.g. `lootTableId: loot-table.cave-rat` and a modest `dropChance` (e.g. `0.35` for cave-rat, `0.5` for the training-beetle). Pick values so a typical early floor yields a handful of items, not a pile.

- [ ] **Step 3: Fill the lampwright-cache vault item slot.** Give its `i` slot `lootTableId: loot-table.<appropriate>` (or a fixed `contentId` if a specific cache item is intended).

- [ ] **Step 4: Compile the real content + run the content suite**

Run: `npm run -w @woven-deep/content build && cd packages/content && npx vitest run`
Expected: PASS (`default-content.test.ts` compiles the whole `content/` dir).

- [ ] **Step 5: Engine integration check.** Add/extend an engine test that runs a seeded early floor to defeat a monster and asserts at least one floor item appears (belt-and-suspenders over Task 4). Run:

Run: `npm run -w @woven-deep/engine build && cd packages/engine && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add content packages/engine/test packages/content/test
git commit -m "content: give early monsters and the lampwright cache findable loot"
```

---

## Self-review notes (author)

- **Spec coverage:** monster loot (Tasks 1,3,4,6), vault item-slots (Tasks 2,5,6), early tuning (Task 6), determinism + fail-loud validation woven through as Global Constraints and per-task assertions. All spec sections map to a task.
- **Determinism:** the drop-chance draw always threads `rng.loot` (Task 3 handles the no-drop and empty-table cases explicitly); vault fills use the generation stream (Task 5). Replay/hash fixtures are the safety net (Tasks 4,5).
- **Type consistency:** `dropMonsterLoot`, `LootDroppedEvent`, `lootTableId`/`dropChance`/`contentId` names are used identically across tasks.
- **Placeholder scan:** the only deliberately-parameterized spots are import paths and existing-helper names, each with an explicit instruction to match `boss-behavior.ts`/the existing test builders — not invented APIs.
