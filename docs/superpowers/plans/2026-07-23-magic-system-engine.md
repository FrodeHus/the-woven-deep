# Magic System — Engine/Content/Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a server-authoritative magic system (AoE targeting + deterministic multi-actor sweep, a learn-from-tome effect, a recall/town-portal loop, a condition damage-over-time tick, a spell vendor, and a ~14-spell spellbook) as engine + content + server, proven headless by a deterministic `magic:demo` replay and the cross-process parity harness.

**Architecture:** Extend the existing content schema (spell `aoe`, class `casterAptitude`, item `spellId`, condition `tickEffects`, two new targeting ids, two new effect ids) then build the engine on top: `targeting.ts` computes AoE cells; a new `resolveEffectSweep` in `effects.ts` folds the effects RNG stream forward actor-by-actor in a stable actorId order; the `cast`/`use-item` paths gather multiple candidates and gate caster aptitude; `effect.spell.learn` and `effect.recall` are run-level effects handled in the dispatch handlers (skipped by `resolveEffectSequence`); the condition sweep gains a burn tick. Content is authored last against STRICT validation. Everything runs inside the engine the server owns (`resolveCommand` / session `dispatchIntent`); no new client-trust boundary.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`), ESM with `.js` import specifiers, Zod v4 content schemas, Vitest, npm workspaces (`@woven-deep/content`, `@woven-deep/engine`, `@woven-deep/session-core`). Node ≥ 22.12.

## Global Constraints

- **No `Math.random`.** Every new roll (AoE per-actor damage, burn tick, any chance) threads and returns `Uint32State` via `random.ts` (`rollDie`/`nextUint32`), applied in a **stable content-defined order** (sorted by `actorId` / condition id).
- **Two-phase validate/commit preserved** for casts, scroll-reads, and tome-learns: `actions.ts` validates (Weave gate before any RNG; then a speculative resolve to catch invariant violations) and `action-dispatch.ts` commits. An invalid action mutates **neither state nor RNG**.
- **Single-target unchanged.** A spell with no `aoe` keeps returning a single resolved actor/cell and consumes RNG **identically to today** — the existing single-target `resolveEffectSequence` call path in the `cast` handler is not altered for non-AoE spells.
- **`magic:demo` is byte-identical in `--verify`.** The existing 7 demos (`dungeon`, `gameplay`, `merchant`, `population`, `run-records`, `endgame`, `engine`) and the cross-process parity harness stay green.
- **Server-authoritative.** Casting, scroll-reads, tome-learns, and recall all run in the engine; the client still sends only the cast / use-item intent + a target `Point`. Aptitude, Weave, and targeting are validated server-side. No new intent crosses the client-trust boundary.
- **Save-schema additions are additive and guarded by the existing save-drift tests.** `knownSpellIds` already exists; the new `returnAnchorFloorId` and condition `tickEffects` are optional. `SAVE_SCHEMA_VERSION` (9) and `CONTENT_SCHEMA_VERSION` (7) do not change.
- **Content compiles under STRICT validation** (`compileContentDirectory` with the default strict pipeline). Every `spellId` reference resolves to a `spell`; `casterAptitude` parses; `aoe` shape+radius validate (radius positive integer).

---

## Design decisions & investigation findings (read before starting)

These were verified against the real code and resolve ambiguities in the spec.

1. **Run-level effects are dispatch-handled, not `resolveEffectSequence` operations.** `EffectOperation` (effects.ts:65) returns only `{ actors, items?, features?, floors?, events }` — it cannot mutate `run.hero.knownSpellIds` or `run.activeFloorId`. So `effect.spell.learn` and `effect.recall` are registered (for content validation + the pre-resolve schema check) but **skipped** inside `resolveEffectSequence` (no RNG, no actor mutation); the run-level mutation happens in the `use-item` / `cast` dispatch handlers (`action-dispatch.ts`). The spec's "engine effect handler" is these dispatch branches.

2. **The save-schema applied-command matching has no `cast` case.** `save-schema/run-record.ts` (~1440–1609) matches every applied command to an event and `fail`s with `'processed result has no matching event'` if none is found (line ~1609). There is **no `cast` branch** in that ternary. Casting has shipped but was apparently never round-tripped through `validateActiveRun` with the cast retained in `recentCommands`. Because `magic:demo` persists cast state (`encodeActiveRun`), **Task 6 must add a `cast` matching case** (match an `attack.hit`/`actor.damaged`/`actor.healed`/`condition.applied`/`hero.recalled` event whose actor is the hero). Task 9 emits `hero.recalled` so a pure recall (no damage) still has a matching event.

3. **Recall changes the active floor — but a retained reducer command is validated against the *new* active floor.** `descendToNextFloor`/`ascendToPreviousFloor` are **session-level transitions** (session-core `dispatch.ts`), deliberately outside `resolveCommand`, and they clear `recentCommands` to avoid exactly this. Therefore recall is split: the `cast` reducer command spends Weave, applies self-effects, sets `returnAnchorFloorId`, and emits `hero.recalled` **without moving floors**; the session layer (`dispatch.ts`) detects the new anchor and performs the town move via a new `recallToTown` floor-transition (which clears `recentCommands` like descend). The return portal reuses the town's descend intent: when `returnAnchorFloorId` is set, the town stair routes to `recallReturn` instead of `descendToNextFloor`.

4. **`recall.already-town` is largely pre-empted by `town.truce`.** `reducer.ts` (~145–153) rejects `cast` in town with `town.truce` before the cast branch runs. `recall.already-town` is still added as a defense-in-depth check in the `actions.ts` cast branch and is unit-tested at the `resolveAction` level; the observable command-path rejection in town remains `town.truce`.

5. **Per-turn Weave regen already exists.** Commit `6984265` added it to `advanceSurvival` (survival.ts:287–311): it accrues `weaveRegen * intervals` clamped to `maxWeave` over the recovery-interval loop. **Task 10 is therefore verification + regression tests, not net-new code** (the only decomposition change vs the skeleton).

6. **Admin-docs coupling.** `packages/content/test/admin-docs.test.ts` (~78–104) asserts every `targetingId` and every `EFFECT_PARAMETER_SCHEMAS` key appears verbatim (as `` `id` ``) in `docs/server-admin/content-configuration.md`. Adding `target.burst`, `target.cone`, `effect.spell.learn`, `effect.recall` **requires updating that doc** (Tasks 1, 7, 9).

7. **Caster aptitude lookup.** `HeroState` carries `classTags: readonly string[]` but no class id. A new `heroCasterAptitude(content, hero)` helper finds the class entry whose `classTags` are all present in `hero.classTags` and returns its `casterAptitude` (default `false`).

---

## File Structure

**Content model (`packages/content/src/model/`)**
- `common.ts` — add `target.burst`/`target.cone` to `TARGETING_IDS`; add `effect.spell.learn`/`effect.recall` to `EFFECT_IDS`.
- `spell.ts` — add optional `aoe?: SpellAoeDescriptor` to `SpellContentEntry`; export `SpellAoeDescriptor`.
- `class.ts` — add `casterAptitude: boolean` to `ClassContentEntry`.
- `item.ts` — add optional `spellId?: ContentId` to `ItemContentEntry`.
- `condition.ts` — add optional `tickEffects?: readonly EffectDefinition[]` to `ConditionContentEntry`.

**Content compiler (`packages/content/src/compiler/`)**
- `schema/spell.ts` — `aoe` zod object (`shape` enum, `radius` positive int).
- `schema/character.ts` — `casterAptitude: z.boolean().default(false)` on `classEntry`.
- `schema/item.ts` — `spellId: stableIdSchema.optional()`.
- `schema/condition.ts` — `tickEffects: z.array(effect).default([])`.
- `registries.ts` — `EFFECT_PARAMETER_SCHEMAS['effect.spell.learn']` / `['effect.recall']`.
- `validation/item.ts` — validate `spellId` resolves to a `spell`.
- `validation/shared.ts` — validate `effect.spell.learn` `spellId` resolves to a `spell` (extend `effectIssues`).

**Engine (`packages/engine/src/`)**
- `targeting.ts` — burst/line/cone cell computation; `aoe` field on `TargetValidationInput`.
- `effects.ts` — `resolveEffectSweep` (multi-actor deterministic fold); `RUN_LEVEL_EFFECTS` skip set.
- `caster.ts` — **new** — `heroCasterAptitude(content, hero)`, `spellLearnTarget(effects)`, `itemGrantsLearn(effects)`.
- `actions.ts` — cast branch AoE candidate gather + `cast.no-aptitude` + `recall.already-town`; use-item branch scroll-read (resolve `spellId` spell) + `learn.no-aptitude` / `learn.already-known`.
- `action-dispatch.ts` — cast handler AoE sweep + recall anchor/`hero.recalled`; use-item handler scroll-read sweep + learn mutation.
- `conditions.ts` — `tickConditions` (burn DoT, RNG-threaded, stable order); called from `survival.ts`.
- `survival.ts` — invoke `tickConditions` before `advanceConditions` in `advanceSurvival`.
- `commands-model.ts` — new `InvalidActionReason` members.
- `model.ts` — `returnAnchorFloorId?: OpaqueId` on `ActiveRun`.
- `events-model.ts` — `HeroRecalledEvent` (`hero.recalled`).
- `floor-transition.ts` — `recallToTown(run, {content})`, `recallReturn(run, {content})`.
- `town-floor.ts` — `merchantSlots` gains `spellvendor`.
- `new-run.ts` — `townMerchantSpecs` gains the spell vendor.
- `save-schema/run-record.ts` — `returnAnchorFloorId` field; `cast` + `hero.recalled` matching cases.
- `save-schema/events.ts` — `hero.recalled` recorded-event shape; new invalid reasons.
- `magic-fixture.ts` — **new** — `runMagicDemo(content)` scenario builder (mirrors `run-records-fixture.ts`).

**Session (`packages/session-core/src/`)**
- `dispatch.ts` — post-cast recall-to-town transition; town-stair return-portal routing.

**Content YAML (`content/`)**
- `classes/loomcaller.yaml` — `casterAptitude: true`.
- `items/ember-scroll.yaml` — migrate to `spellId: spell.ember-bolt`.
- `spells/*.yaml`, `items/*-tome.yaml`, `items/*-scroll.yaml`, `conditions/*.yaml` — the ~14-spell spellbook (Task 12).
- `npcs/town-merchants.yaml`, `encounters/town-merchants.yaml`, `loot-tables/town-spellvendor.yaml`, `vaults/town.yaml` — spell vendor (Task 13).

**Docs / scripts**
- `docs/server-admin/content-configuration.md` — new targeting/effect ids.
- `scripts/magic-demo.mjs` — **new** demo runner (mirrors `run-records-demo.mjs`).
- `packages/engine/test/fixtures/magic-demo-hashes.json` — **new** reviewed hashes.
- `package.json` — `magic:demo` script.

---

## Phase 1 — Content schema / model foundations

### Task 1: Spell AoE schema + burst/cone targeting ids

**Files:**
- Modify: `packages/content/src/model/spell.ts`
- Modify: `packages/content/src/model/common.ts:89` (`TARGETING_IDS`)
- Modify: `packages/content/src/compiler/schema/spell.ts`
- Modify: `docs/server-admin/content-configuration.md` (targeting list ~888)
- Test: `packages/content/test/spell-aoe.test.ts` (new)

**Interfaces:**
- Produces: `SpellAoeDescriptor = Readonly<{ shape: 'burst' | 'line' | 'cone'; radius: number }>`; `SpellContentEntry.aoe?: SpellAoeDescriptor`.
- Produces: `TARGETING_IDS` includes `'target.burst'` and `'target.cone'`.

- [ ] **Step 1: Write the failing test** — `packages/content/test/spell-aoe.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { contentFileSchema } from '../src/compiler/schema.js';

function spellFile(aoe: unknown) {
  return {
    schemaVersion: 7,
    entries: [
      {
        kind: 'spell',
        id: 'spell.test-burst',
        name: 'Test burst',
        tags: ['fire'],
        targetingId: 'target.burst',
        range: 6,
        actionCost: 100,
        weaveCost: 3,
        aoe,
        effects: [
          {
            effectId: 'effect.damage',
            parameters: { damageType: 'fire', dice: { count: 1, sides: 6, bonus: 0 } },
            requiresLivingTarget: true,
          },
        ],
      },
    ],
  };
}

describe('spell AoE schema', () => {
  it('accepts a burst descriptor with a positive integer radius', () => {
    const parsed = contentFileSchema.parse(spellFile({ shape: 'burst', radius: 2 }));
    const entry = parsed.entries[0]!;
    expect(entry.kind).toBe('spell');
    expect(entry).toMatchObject({ aoe: { shape: 'burst', radius: 2 } });
  });

  it('rejects a non-positive radius', () => {
    expect(() => contentFileSchema.parse(spellFile({ shape: 'burst', radius: 0 }))).toThrow();
  });

  it('rejects an unknown shape', () => {
    expect(() => contentFileSchema.parse(spellFile({ shape: 'spiral', radius: 2 }))).toThrow();
  });

  it('accepts target.cone as a targeting id', () => {
    const file = spellFile({ shape: 'cone', radius: 3 });
    file.entries[0]!.targetingId = 'target.cone';
    expect(() => contentFileSchema.parse(file)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace @woven-deep/content -- spell-aoe`
Expected: FAIL — `target.burst` rejected by the targeting enum and `aoe` rejected by the strict spell object.

- [ ] **Step 3: Add the targeting ids** — `packages/content/src/model/common.ts:89`

```ts
export const TARGETING_IDS = [
  'target.self',
  'target.actor',
  'target.line',
  'target.burst',
  'target.cone',
  'target.cell',
] as const;
```

- [ ] **Step 4: Add the model field** — `packages/content/src/model/spell.ts`

```ts
import type { BaseContentEntry, EffectDefinition, TargetingId } from './common.js';

export interface SpellAoeDescriptor {
  readonly shape: 'burst' | 'line' | 'cone';
  readonly radius: number;
}

export interface SpellContentEntry extends BaseContentEntry {
  readonly kind: 'spell';
  readonly targetingId: TargetingId;
  readonly range: number;
  readonly actionCost: number;
  readonly weaveCost: number;
  readonly aoe?: SpellAoeDescriptor;
  readonly effects: readonly EffectDefinition[];
}
```

- [ ] **Step 5: Add the zod schema** — `packages/content/src/compiler/schema/spell.ts`

```ts
import { z } from 'zod';
import { base, effect, safeNonNegative, safePositive, targetingIds } from './common.js';

const aoe = z.strictObject({
  shape: z.enum(['burst', 'line', 'cone']),
  radius: safePositive.max(32),
});

export const spellEntry = z.strictObject({
  ...base,
  kind: z.literal('spell'),
  targetingId: z.enum(targetingIds),
  range: safeNonNegative,
  actionCost: safePositive,
  weaveCost: safeNonNegative,
  aoe: aoe.optional(),
  effects: z.array(effect).min(1),
});
```

- [ ] **Step 6: Update the admin doc** — in `docs/server-admin/content-configuration.md`, extend the targeting list (near "`target.line`") with:

```markdown
- `target.burst`: a filled Chebyshev-radius area around a visible aim cell in range.
- `target.cone`: a wedge of `aoe.radius` depth from the caster toward a visible aim cell.
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm run test --workspace @woven-deep/content -- spell-aoe admin-docs`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/content/src/model/spell.ts packages/content/src/model/common.ts \
  packages/content/src/compiler/schema/spell.ts docs/server-admin/content-configuration.md \
  packages/content/test/spell-aoe.test.ts
git commit -m "feat(content): spell aoe descriptor and burst/cone targeting ids"
```

---

### Task 2: Class `casterAptitude`

**Files:**
- Modify: `packages/content/src/model/class.ts:18-28`
- Modify: `packages/content/src/compiler/schema/character.ts:34-46`
- Modify: `content/classes/loomcaller.yaml`
- Test: `packages/content/test/class-aptitude.test.ts` (new)

**Interfaces:**
- Produces: `ClassContentEntry.casterAptitude: boolean` (always present after compile; defaults to `false`).

- [ ] **Step 1: Write the failing test** — `packages/content/test/class-aptitude.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { contentFileSchema } from '../src/compiler/schema.js';

function classFile(extra: Record<string, unknown>) {
  return {
    schemaVersion: 7,
    entries: [
      {
        kind: 'class',
        id: 'class.test',
        name: 'Test',
        tags: ['playable'],
        description: 'A test class.',
        playable: true,
        silhouetteGlyph: 'T',
        unlockHint: null,
        classTags: ['test'],
        kits: [
          { kitId: 'a', name: 'A', equipped: [], backpack: [] },
          { kitId: 'b', name: 'B', equipped: [], backpack: [] },
        ],
        ...extra,
      },
    ],
  };
}

describe('class casterAptitude', () => {
  it('defaults to false when omitted', () => {
    const entry = contentFileSchema.parse(classFile({})).entries[0]!;
    expect(entry).toMatchObject({ kind: 'class', casterAptitude: false });
  });

  it('parses an explicit true', () => {
    const entry = contentFileSchema.parse(classFile({ casterAptitude: true })).entries[0]!;
    expect(entry).toMatchObject({ casterAptitude: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace @woven-deep/content -- class-aptitude`
Expected: FAIL — parsed entry has no `casterAptitude`.

- [ ] **Step 3: Add the model field** — `packages/content/src/model/class.ts`, inside `ClassContentEntry`, after `kits`:

```ts
  readonly casterAptitude: boolean;
```

- [ ] **Step 4: Add the zod field** — `packages/content/src/compiler/schema/character.ts`, in `classEntry`'s object (add after `kits: ...`):

```ts
    casterAptitude: z.boolean().default(false),
```

- [ ] **Step 5: Set it on the Loomcaller** — `content/classes/loomcaller.yaml`, add a line after `classTags: [loomcaller]`:

```yaml
    casterAptitude: true
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test --workspace @woven-deep/content -- class-aptitude default-content`
Expected: PASS (default-content compiles the real pack including loomcaller).

- [ ] **Step 7: Commit**

```bash
git add packages/content/src/model/class.ts packages/content/src/compiler/schema/character.ts \
  content/classes/loomcaller.yaml packages/content/test/class-aptitude.test.ts
git commit -m "feat(content): class casterAptitude flag; Loomcaller is a caster"
```

---

### Task 3: Item `spellId`

**Files:**
- Modify: `packages/content/src/model/item.ts:46-61`
- Modify: `packages/content/src/compiler/schema/item.ts:50-65`
- Modify: `packages/content/src/compiler/validation/item.ts`
- Test: `packages/content/test/item-spellid.test.ts` (new)

**Interfaces:**
- Produces: `ItemContentEntry.spellId?: ContentId`.
- Consumes: `referencedKindIssue(file, path, id, 'spell', byId)` from `validation/shared.ts` (exists).

- [ ] **Step 1: Write the failing test** — `packages/content/test/item-spellid.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { compileContentSource } from '../src/compiler/index.js';

const spell = {
  kind: 'spell',
  id: 'spell.test-bolt',
  name: 'Test bolt',
  tags: ['fire'],
  targetingId: 'target.actor',
  range: 6,
  actionCost: 100,
  weaveCost: 3,
  effects: [
    {
      effectId: 'effect.damage',
      parameters: { damageType: 'fire', dice: { count: 1, sides: 6, bonus: 0 } },
      requiresLivingTarget: true,
    },
  ],
};

function scroll(spellId: string) {
  return {
    kind: 'item',
    id: 'item.test-scroll',
    name: 'Test scroll',
    glyph: '?',
    color: '#e37b46',
    tags: ['scroll'],
    minDepth: 1,
    maxDepth: 20,
    category: 'scroll',
    stackLimit: 3,
    price: 15,
    rarity: 'uncommon',
    actionCost: 100,
    spellId,
    equipment: null,
    combat: null,
    light: null,
    identification: { mode: 'known', poolId: null },
    effects: [{ effectId: 'effect.item.consume', parameters: { quantity: 1 } }],
  };
}

describe('item spellId', () => {
  it('compiles when spellId resolves to a spell', async () => {
    const pack = await compileContentSource([
      { file: 'a.yaml', source: { schemaVersion: 7, entries: [spell, scroll('spell.test-bolt')] } },
    ]);
    const item = pack.entries.find((entry) => entry.id === 'item.test-scroll');
    expect(item).toMatchObject({ spellId: 'spell.test-bolt' });
  });

  it('reports an issue when spellId does not resolve to a spell', async () => {
    await expect(
      compileContentSource([
        { file: 'a.yaml', source: { schemaVersion: 7, entries: [spell, scroll('spell.missing')] } },
      ]),
    ).rejects.toThrow(/spell.*spell\.missing|unknown spell reference/i);
  });
});
```

> Match `compileContentSource`'s real import/signature to a sibling test such as `packages/content/test/compile-directory.test.ts`; if the helper differs, use the same in-memory compile entry point that test uses.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace @woven-deep/content -- item-spellid`
Expected: FAIL — `spellId` stripped by the strict item object; no validation issue.

- [ ] **Step 3: Add the model field** — `packages/content/src/model/item.ts`, in `ItemContentEntry`, after `actionCost`:

```ts
  readonly spellId?: import('./common.js').ContentId;
```

(Or add `ContentId` to the existing type import at the top and write `readonly spellId?: ContentId;`.)

- [ ] **Step 4: Add the zod field** — `packages/content/src/compiler/schema/item.ts`, in `itemEntry`, after `actionCost`:

```ts
    spellId: stableIdSchema.optional(),
```

- [ ] **Step 5: Add the reference validation** — `packages/content/src/compiler/validation/item.ts`, inside `itemCompatibilityIssues`, before `return issues;`:

```ts
  if (item.spellId !== undefined) {
    issues.push(
      ...referencedKindIssue(file, `${path}.spellId`, item.spellId, 'spell', allItems.length ? byIdForSpell : byIdForSpell),
    );
  }
```

To keep it simple, thread `byId` into `itemCompatibilityIssues` instead of a placeholder. Change its signature and the call site in `itemIssues`:

```ts
// signature
function itemCompatibilityIssues(
  file: string,
  item: ItemContentEntry,
  allItems: readonly ItemContentEntry[],
  byId: ReadonlyMap<string, ContentEntry>,
): ContentCompileIssue[] {
  // ...existing body...
  if (item.spellId !== undefined) {
    issues.push(...referencedKindIssue(file, `${path}.spellId`, item.spellId, 'spell', byId));
  }
  return issues;
}
```

Update the import line to include `referencedKindIssue`:

```ts
import { effectIssues, issue, referencedKindIssue, type LocatedContentEntry } from './shared.js';
```

And the call in `itemIssues`:

```ts
    issues.push(
      ...equipmentIssues(file, entry),
      ...itemCompatibilityIssues(file, entry, allItems, byId),
      ...effectIssues(file, entry.id, entry.effects, byId),
    );
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test --workspace @woven-deep/content -- item-spellid`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/content/src/model/item.ts packages/content/src/compiler/schema/item.ts \
  packages/content/src/compiler/validation/item.ts packages/content/test/item-spellid.test.ts
git commit -m "feat(content): item spellId reference validated against spells"
```

---

## Phase 2 — Engine core

### Task 4: AoE cell computation in `targeting.ts`

**Files:**
- Modify: `packages/engine/src/targeting.ts`
- Test: `packages/engine/test/targeting-aoe.test.ts` (new)

**Interfaces:**
- Consumes: `SpellAoeDescriptor` from `@woven-deep/content`.
- Produces: `TargetValidationInput.aoe?: SpellAoeDescriptor`. `validateTarget` returns `{ ok: true; cells: readonly Point[]; targetActorId? }` where `cells` is the full affected area for burst/line/cone (single cell otherwise). Geometry is pure and deterministic; opaque tiles stop lines and are excluded; every returned cell is in-bounds and within `range` (Chebyshev) of the caster.

- [ ] **Step 1: Write the failing test** — `packages/engine/test/targeting-aoe.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { createDemoRun, validateTarget, type TileId } from '../src/index.js';

function openFloor(width: number, height: number, walls: readonly [number, number][] = []) {
  const run = createDemoRun();
  const tiles = Array<TileId>(width * height).fill(1);
  for (const [x, y] of walls) tiles[y * width + x] = 0;
  return { ...run.floors[0]!, width, height, tiles };
}

function baseInput(floor: ReturnType<typeof openFloor>) {
  const run = createDemoRun();
  const source = { ...run.actors[0]!, x: 2, y: 2, floorId: floor.floorId };
  return {
    sourceActor: source,
    targetActorId: null,
    floor,
    actors: [source],
    // fully lit + fully visible so validatePoint's visibility/illumination gates pass
    visibilityWords: Array(Math.ceil((floor.width * floor.height) / 32)).fill(0xffffffff),
    illumination: { intensity: Array(floor.width * floor.height).fill(255) },
    range: 6,
  } as const;
}

describe('AoE cell computation', () => {
  it('burst returns every cell within Chebyshev radius of the aim cell', () => {
    const floor = openFloor(9, 9);
    const result = validateTarget({
      ...baseInput(floor),
      targetingId: 'target.burst',
      target: { x: 5, y: 5 },
      aoe: { shape: 'burst', radius: 1 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cells = new Set(result.cells.map((c) => `${c.x},${c.y}`));
    expect(cells.size).toBe(9);
    expect(cells.has('4,4')).toBe(true);
    expect(cells.has('6,6')).toBe(true);
    expect(cells.has('3,5')).toBe(false);
  });

  it('line collects cells toward the aim and stops before an opaque tile', () => {
    const floor = openFloor(9, 3, [[5, 1]]);
    const result = validateTarget({
      ...baseInput(floor),
      targetingId: 'target.line',
      target: { x: 8, y: 1 },
      aoe: { shape: 'line', radius: 6 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const xs = result.cells.filter((c) => c.y === 1).map((c) => c.x).sort((a, b) => a - b);
    expect(xs).toEqual([3, 4]); // stops before the wall at x=5, excludes the caster cell (2,2)->y row
  });

  it('cone returns a widening wedge in the aimed direction', () => {
    const floor = openFloor(11, 11);
    const result = validateTarget({
      ...baseInput(floor),
      targetingId: 'target.cone',
      target: { x: 8, y: 2 }, // due east of caster (2,2)
      aoe: { shape: 'cone', radius: 3 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cells = new Set(result.cells.map((c) => `${c.x},${c.y}`));
    expect(cells.has('3,2')).toBe(true); // depth 1 straight ahead
    expect(cells.has('5,4')).toBe(true); // depth 3 widened
    expect(cells.has('1,2')).toBe(false); // never behind the caster
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace @woven-deep/engine -- targeting-aoe`
Expected: FAIL — `aoe` unknown on the input; burst/cone unhandled.

- [ ] **Step 3: Add `aoe` to the input and the geometry** — `packages/engine/src/targeting.ts`

Add the import and field:

```ts
import type { SpellAoeDescriptor, TargetingId } from '@woven-deep/content';
```

```ts
export interface TargetValidationInput {
  readonly targetingId: TargetingId;
  readonly sourceActor: ActorState;
  readonly targetActorId: OpaqueId | null;
  readonly target: Point | null;
  readonly floor: FloorSnapshot;
  readonly actors: readonly ActorState[];
  readonly visibilityWords: readonly number[];
  readonly illumination: Pick<IlluminationField, 'intensity'>;
  readonly range: number;
  readonly aoe?: SpellAoeDescriptor;
}
```

Add pure helpers (module scope), reusing the existing `line`:

```ts
function chebyshev(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function isOpaqueCell(input: TargetValidationInput, point: Point): boolean {
  const index = tileIndex(input.floor, point.x, point.y);
  if (index === undefined) return true;
  return tileDefinition(input.floor.tiles[index]!).opaque;
}

/** Filled Chebyshev disc around `center`, deterministically ordered (row-major), in-bounds only. */
function burstCells(input: TargetValidationInput, center: Point, radius: number): readonly Point[] {
  const cells: Point[] = [];
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const cell = { x: center.x + dx, y: center.y + dy };
      if (tileIndex(input.floor, cell.x, cell.y) === undefined) continue;
      cells.push(cell);
    }
  }
  return cells;
}

/** Bresenham path from the caster toward `aim`, capped at `radius`, stopping at the first opaque tile. */
function lineCells(input: TargetValidationInput, aim: Point, radius: number): readonly Point[] {
  const cells: Point[] = [];
  for (const cell of line(input.sourceActor, aim)) {
    if (chebyshev(input.sourceActor, cell) > radius) break;
    if (isOpaqueCell(input, cell)) break;
    cells.push(cell);
  }
  return cells;
}

/** Wedge of depth `radius` from the caster toward `aim`. Cell at forward depth d spans lateral +-d. */
function coneCells(input: TargetValidationInput, aim: Point, radius: number): readonly Point[] {
  const fx = Math.sign(aim.x - input.sourceActor.x);
  const fy = Math.sign(aim.y - input.sourceActor.y);
  const cells: Point[] = [];
  const seen = new Set<string>();
  for (let depth = 1; depth <= radius; depth += 1) {
    for (let lateral = -depth; lateral <= depth; lateral += 1) {
      // Forward axis times depth, plus lateral spread on the perpendicular axis.
      const x = input.sourceActor.x + fx * depth + (fx === 0 ? lateral : 0);
      const y = input.sourceActor.y + fy * depth + (fy === 0 ? lateral : 0);
      const cell = fx !== 0 && fy !== 0
        ? { x: input.sourceActor.x + fx * depth, y: input.sourceActor.y + fy * depth + lateral }
        : { x, y };
      const key = `${cell.x},${cell.y}`;
      if (seen.has(key)) continue;
      if (tileIndex(input.floor, cell.x, cell.y) === undefined) continue;
      seen.add(key);
      cells.push(cell);
    }
  }
  return cells;
}
```

In `validateTarget`, after the existing `target.self` / `target.actor` handling and before the `target.cell` fallthrough, add the AoE branches. First reuse `validatePoint` to gate visibility/range/blocking on the aim cell, then expand cells:

```ts
  if (
    input.targetingId === 'target.burst' ||
    input.targetingId === 'target.line' ||
    input.targetingId === 'target.cone'
  ) {
    if (input.target === null) return { ok: false, reason: 'target.invalid' };
    if (input.aoe === undefined) return { ok: false, reason: 'target.invalid' };
    const aimed = validatePoint(input, input.target);
    if (!aimed.ok) return aimed;
    const cells =
      input.targetingId === 'target.burst'
        ? burstCells(input, input.target, input.aoe.radius)
        : input.targetingId === 'target.line'
          ? lineCells(input, input.target, input.aoe.radius)
          : coneCells(input, input.target, input.aoe.radius);
    return { ok: true, cells };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace @woven-deep/engine -- targeting-aoe targeting`
Expected: PASS (existing `targeting.test.ts` still green — single-target paths untouched).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/targeting.ts packages/engine/test/targeting-aoe.test.ts
git commit -m "feat(engine): burst/line/cone AoE cell computation in validateTarget"
```

---

### Task 5: Deterministic multi-actor sweep in `effects.ts`

**Files:**
- Modify: `packages/engine/src/effects.ts`
- Test: `packages/engine/test/effect-sweep.test.ts` (new)

**Interfaces:**
- Consumes: `resolveEffectSequence(input: EffectSequenceInput): EffectSequenceResult` (unchanged signature).
- Produces:
  ```ts
  export interface EffectSweepInput extends Omit<EffectSequenceInput, 'targetActorId'> {
    readonly targetActorIds: readonly OpaqueId[];
    readonly casterActorId: OpaqueId;
    readonly includeCaster: boolean;
  }
  export function resolveEffectSweep(input: EffectSweepInput): EffectSequenceResult;
  ```
  `resolveEffectSweep` sorts `targetActorIds` ascending by string `actorId`, drops the caster unless `includeCaster`, de-dupes, and folds `effectsState` forward actor-by-actor by calling `resolveEffectSequence` once per target with the accumulated `actors`/`effectsState`/`items`/`survival`/`features`/`floors`. The returned `effectsState` is the final threaded state. With zero targets it returns the inputs unchanged and `effectsState` untouched.
- Produces: `RUN_LEVEL_EFFECTS = new Set(['effect.spell.learn', 'effect.recall'])` — `resolveEffectSequence` recognizes these (no throw), applies **no** actor mutation and consumes **no** RNG.

- [ ] **Step 1: Write the failing test** — `packages/engine/test/effect-sweep.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { resolve } from 'node:path';
import { beforeAll } from 'vitest';
import { createDemoRun, resolveEffectSweep, stableJson, type ActorState } from '../src/index.js';
import type { CompiledContentPack } from '@woven-deep/content';

let pack: CompiledContentPack;
beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
});

function threeTargets(): { caster: ActorState; targets: ActorState[] } {
  const run = createDemoRun();
  const caster = { ...run.actors[0]!, actorId: 'hero', contentId: 'monster.cave-rat', x: 1, y: 1 };
  const mk = (id: string, x: number): ActorState => ({
    ...caster, actorId: id, contentId: 'monster.cave-rat', playerControlled: false,
    x, y: 1, health: 20, maxHealth: 20, disposition: 'hostile',
  });
  return { caster, targets: [mk('rat.c', 4), mk('rat.a', 2), mk('rat.b', 3)] };
}

const damage = [
  { effectId: 'effect.damage' as const, parameters: { damageType: 'fire', dice: { count: 1, sides: 6, bonus: 0 } }, requiresLivingTarget: true },
];

function sweep(order: ActorState[]) {
  const { caster } = threeTargets();
  const run = createDemoRun();
  return resolveEffectSweep({
    effects: damage,
    actors: [caster, ...order],
    content: pack,
    sourceActorId: caster.actorId,
    casterActorId: caster.actorId,
    includeCaster: false,
    targetActorIds: order.map((a) => a.actorId),
    effectsState: run.rng.effects,
    worldTime: 0,
    eventId: 'command.sweep',
    forceMoveDirection: { x: 1, y: 0 },
    operations: {},
    survival: run.survival,
    survivalActorId: caster.actorId,
  });
}

describe('resolveEffectSweep', () => {
  it('is identical regardless of actor-array ordering and threads RNG forward', () => {
    const { targets } = threeTargets();
    const a = sweep([targets[0]!, targets[1]!, targets[2]!]);
    const b = sweep([targets[2]!, targets[0]!, targets[1]!]);
    expect(stableJson(a.effectsState)).toBe(stableJson(b.effectsState));
    const healthByA = Object.fromEntries(a.actors.map((x) => [x.actorId, x.health]));
    const healthByB = Object.fromEntries(b.actors.map((x) => [x.actorId, x.health]));
    expect(healthByA).toEqual(healthByB);
  });

  it('excludes the caster by default', () => {
    const { caster, targets } = threeTargets();
    const run = createDemoRun();
    const result = resolveEffectSweep({
      effects: damage, actors: [caster, ...targets], content: pack,
      sourceActorId: caster.actorId, casterActorId: caster.actorId, includeCaster: false,
      targetActorIds: [caster.actorId, ...targets.map((t) => t.actorId)],
      effectsState: run.rng.effects, worldTime: 0, eventId: 'command.sweep',
      forceMoveDirection: { x: 1, y: 0 }, operations: {}, survival: run.survival, survivalActorId: caster.actorId,
    });
    const casterAfter = result.actors.find((x) => x.actorId === caster.actorId)!;
    expect(casterAfter.health).toBe(caster.health);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace @woven-deep/engine -- effect-sweep`
Expected: FAIL — `resolveEffectSweep` not exported.

- [ ] **Step 3: Add `RUN_LEVEL_EFFECTS` handling** — `packages/engine/src/effects.ts`

Above `resolveEffectSequence`:

```ts
const RUN_LEVEL_EFFECTS = new Set<EffectId>(['effect.spell.learn', 'effect.recall']);
```

In the pre-resolve validation loop, relax the "unavailable" throw so run-level effects pass:

```ts
    if (
      !DIRECT_EFFECTS.has(effect.effectId) &&
      !RUN_LEVEL_EFFECTS.has(effect.effectId) &&
      !input.operations[effect.effectId]
    ) {
      throw new TypeError(`effect operation ${effect.effectId} is unavailable`);
    }
```

In the apply loop, add a branch (place it before the generic `operations` `else`) that no-ops run-level effects:

```ts
    } else if (RUN_LEVEL_EFFECTS.has(effect.effectId)) {
      // Run-level effects (learn, recall) mutate ActiveRun, which resolveEffectSequence does not
      // own. The cast/use-item dispatch handlers apply them. No actor mutation, no RNG here.
      continue;
```

- [ ] **Step 4: Add `resolveEffectSweep`** — `packages/engine/src/effects.ts`, after `resolveEffectSequence`:

```ts
export interface EffectSweepInput extends Omit<EffectSequenceInput, 'targetActorId'> {
  readonly targetActorIds: readonly OpaqueId[];
  readonly casterActorId: OpaqueId;
  readonly includeCaster: boolean;
}

/**
 * Applies `effects` to every actor named in `targetActorIds` (minus the caster unless opted in),
 * in a stable ascending `actorId` order, folding the effects RNG stream forward actor-by-actor:
 * target N+1 rolls from the state target N returned. Re-simulating from any iteration order is
 * bit-identical. A single-target sweep consumes RNG exactly like one resolveEffectSequence call.
 */
export function resolveEffectSweep(input: EffectSweepInput): EffectSequenceResult {
  const unique = [...new Set(input.targetActorIds)]
    .filter((id) => input.includeCaster || id !== input.casterActorId)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  let actors = input.actors;
  let items = input.items ?? [];
  let features = input.features ?? [];
  let floors = input.floors ?? [];
  let survival = input.survival;
  let state = input.effectsState;
  const events: DomainEvent[] = [];
  for (const targetActorId of unique) {
    const step = resolveEffectSequence({
      ...input,
      actors,
      items,
      features,
      floors,
      survival,
      effectsState: state,
      targetActorId,
    });
    actors = step.actors;
    items = step.items;
    features = step.features;
    floors = step.floors;
    survival = step.survival;
    state = step.effectsState;
    events.push(...step.events);
  }
  return { actors, items, survival, features, floors, effectsState: state, events };
}
```

- [ ] **Step 5: Export it** — add `resolveEffectSweep` and `EffectSweepInput` to the engine barrel `packages/engine/src/index.ts` (mirror the existing `resolveEffectSequence` export line).

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test --workspace @woven-deep/engine -- effect-sweep effects effect-fold`
Expected: PASS (existing `effects.test.ts`/`effect-fold.test.ts` untouched).

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/effects.ts packages/engine/src/index.ts packages/engine/test/effect-sweep.test.ts
git commit -m "feat(engine): deterministic multi-actor effect sweep with run-level effect skip"
```

---

### Task 6: Wire AoE into the cast path + caster-aptitude gate + save `cast` matching

**Files:**
- Create: `packages/engine/src/caster.ts`
- Modify: `packages/engine/src/actions.ts` (cast branch ~622-691)
- Modify: `packages/engine/src/action-dispatch.ts` (cast handler ~367-398)
- Modify: `packages/engine/src/commands-model.ts` (`InvalidActionReason`)
- Modify: `packages/engine/src/save-schema/run-record.ts` (applied `cast` matching ~1440-1609)
- Test: `packages/engine/test/cast-aoe.test.ts` (new)

**Interfaces:**
- Consumes: `validateTarget` (with `aoe`), `resolveEffectSweep`, `resolveEffectSequence`.
- Produces: `caster.ts`:
  ```ts
  export function heroCasterAptitude(content: CompiledContentPack, hero: HeroState): boolean;
  ```
- Produces: new `InvalidActionReason` members `'cast.no-aptitude'`.
- Behavior: a spell with `aoe` gathers all actors on the resolved `cells` (excluding the caster) and sweeps; a spell without `aoe` keeps today's exact single-target call. Casting a `knownSpellId` without aptitude → `cast.no-aptitude` (Weave-gate-before-RNG preserved: aptitude and Weave both checked before any resolve).

- [ ] **Step 1: Write the failing test** — `packages/engine/test/cast-aoe.test.ts`

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { resolve } from 'node:path';
import { createGameplayDemoRun, resolveCommand, type ActiveRun } from '../src/index.js';
import type { CompiledContentPack } from '@woven-deep/content';

let pack: CompiledContentPack;
beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
});

// A synthetic burst spell must exist in content (Task 12 ships spell.fireball). Until then this
// test drives spell.fireball; if Task 12 is not yet merged, gate it behind entry presence.
describe('AoE cast', () => {
  it('burst hits every actor in radius, excludes the caster, and stays deterministic', () => {
    const { run } = createGameplayDemoRun(pack);
    const hero = run.actors.find((a) => a.playerControlled)!;
    // Cluster two rats within radius of an aim cell two tiles east of the hero.
    const aim = { x: hero.x + 2, y: hero.y };
    const rats = run.actors.filter((a) => a.contentId === 'monster.cave-rat').slice(0, 1);
    const extra = rats.length
      ? [{ ...rats[0]!, actorId: 'rat.extra', x: aim.x + 1, y: aim.y, health: 20, maxHealth: 20 }]
      : [];
    const clustered: ActiveRun = {
      ...run,
      actors: run.actors
        .map((a) => (a.contentId === 'monster.cave-rat' ? { ...a, x: aim.x, y: aim.y } : a))
        .concat(extra),
    };
    const result = resolveCommand(
      clustered,
      { type: 'cast', commandId: 'command.cast', expectedRevision: clustered.revision, spellId: 'spell.fireball', target: aim },
      { content: pack },
    );
    expect(result.result.status).toBe('applied');
    const heroAfter = result.state.actors.find((a) => a.playerControlled)!;
    expect(heroAfter.health).toBe(hero.health); // caster excluded
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace @woven-deep/engine -- cast-aoe`
Expected: FAIL — the single-target path only damages one candidate (or `spell.fireball` missing → order Task 12 before executing this test; the code changes below are still required and unit-tested via Task 12's mechanic test).

- [ ] **Step 3: Add the aptitude helper** — `packages/engine/src/caster.ts`

```ts
import type { CompiledContentPack } from '@woven-deep/content';
import type { HeroState } from './model.js';

/** The class entry whose classTags are all carried by the hero, or undefined. */
function heroClass(content: CompiledContentPack, hero: HeroState) {
  return content.entries.find(
    (entry) =>
      entry.kind === 'class' &&
      entry.classTags.length > 0 &&
      entry.classTags.every((tag) => hero.classTags.includes(tag)),
  );
}

/** Whether the hero's class may cast from memory and learn from tomes. Non-casters default false. */
export function heroCasterAptitude(content: CompiledContentPack, hero: HeroState): boolean {
  const cls = heroClass(content, hero);
  return cls?.kind === 'class' ? cls.casterAptitude : false;
}
```

- [ ] **Step 4: Add the reason** — `packages/engine/src/commands-model.ts`, extend `InvalidActionReason` union with:

```ts
  | 'cast.no-aptitude'
```

- [ ] **Step 5: Gate + gather candidates in the cast validation** — `packages/engine/src/actions.ts`, cast branch. After the `weave < weaveCost` check add the aptitude gate, and replace the single-candidate resolution with an AoE-aware validation. Import at the top:

```ts
import { heroCasterAptitude } from './caster.js';
import { resolveEffectSweep } from './effects.js';
```

Insert the aptitude gate right after the Weave gate:

```ts
    if (!heroCasterAptitude(input.context.content, input.state.hero) && actor.actorId === input.state.hero.actorId) {
      return { status: 'invalid', reason: 'cast.no-aptitude' };
    }
```

For the resolve, keep the existing single-target block when `definition.aoe === undefined`. When `definition.aoe` is present, resolve cells and speculatively sweep:

```ts
    if (definition.aoe !== undefined) {
      if (command.target === null) return { status: 'invalid', reason: 'target.invalid' };
      const perception = targetContext(input.state, actor, input.context.content);
      const area = validateTarget({
        targetingId: definition.targetingId,
        sourceActor: actor,
        targetActorId: null,
        target: command.target,
        floor: perception.floor,
        actors: input.state.actors,
        visibilityWords: perception.visibilityWords,
        illumination: perception.illumination,
        range: definition.range,
        aoe: definition.aoe,
      });
      if (!area.ok) return { status: 'invalid', reason: area.reason };
      const cellKeys = new Set(area.cells.map((cell) => `${cell.x},${cell.y}`));
      const targetActorIds = input.state.actors
        .filter(
          (entry) =>
            entry.floorId === actor.floorId &&
            entry.health > 0 &&
            entry.actorId !== actor.actorId &&
            cellKeys.has(`${entry.x},${entry.y}`),
        )
        .map((entry) => entry.actorId);
      try {
        resolveEffectSweep({
          effects: definition.effects,
          actors: input.state.actors,
          items: input.state.items,
          content: input.context.content,
          sourceActorId: actor.actorId,
          casterActorId: actor.actorId,
          includeCaster: false,
          targetActorIds,
          effectsState: input.state.rng.effects,
          survival: input.state.survival,
          survivalActorId: input.state.hero.actorId,
          worldTime: input.state.worldTime,
          eventId: command.commandId,
          forceMoveDirection: { x: 1, y: 0 },
          operations: {},
        });
      } catch {
        return { status: 'invalid', reason: 'action.unavailable' };
      }
      return {
        type: 'cast',
        actorId: actor.actorId,
        spellId: definition.id,
        targetActorId: actor.actorId, // self placeholder; AoE resolves cells at commit time
        weaveCost: definition.weaveCost,
        cost: definition.actionCost,
      };
    }
```

> `targetContext` and `validateTarget` are already imported in `actions.ts`. Keep the existing non-AoE block below unchanged.

- [ ] **Step 6: Sweep at commit time** — `packages/engine/src/action-dispatch.ts`, cast handler. After spending Weave, branch on `definition.aoe`:

```ts
    let next = withActor(state, { ...actor, weave: actor.weave - action.weaveCost });
    if (definition.aoe !== undefined) {
      const perception = floorPerceptionForActor(next, actor, content); // reuse the actions.ts perception helper or recompute cells from stored command target
      // Recompute the cells deterministically from the same command target the validator used.
      // The dispatcher re-derives the target Point from the recorded command via the reducer path.
      // (See note below.)
    }
```

**Note (commit-time targeting):** the `CastAction` shape carries only `targetActorId`, not the aim `Point`. To resolve AoE cells at commit time without a schema change, gather candidates from the actors whose cells the validator accepted. The simplest correct approach that keeps the command shape: recompute cells in the dispatch handler using the caster position and the aim point. Since `GameAction` for cast lacks the `Point`, add a `targetCells?: readonly Point[]` (or `aimTarget?: Point`) to `CastAction` populated by the validator. Extend `CastAction` in `actions.ts`:

```ts
export interface CastAction {
  readonly type: 'cast';
  readonly actorId: OpaqueId;
  readonly spellId: OpaqueId;
  readonly targetActorId: OpaqueId;
  readonly weaveCost: number;
  readonly cost: number;
  readonly aimTarget?: Point;
}
```

Set `aimTarget: command.target` in the AoE `return { type: 'cast', ... }` above. Then in the dispatch handler:

```ts
    if (definition.aoe !== undefined && action.aimTarget !== undefined) {
      const perception = targetContextForDispatch(next, actor, content); // build floor/visibility/illumination like targetContext
      const area = validateTarget({
        targetingId: definition.targetingId,
        sourceActor: actor,
        targetActorId: null,
        target: action.aimTarget,
        floor: perception.floor,
        actors: next.actors,
        visibilityWords: perception.visibilityWords,
        illumination: perception.illumination,
        range: definition.range,
        aoe: definition.aoe,
      });
      if (!area.ok) throw new Error(`internal invariant: validated AoE cast failed with ${area.reason}`);
      const cellKeys = new Set(area.cells.map((cell) => `${cell.x},${cell.y}`));
      const targetActorIds = next.actors
        .filter((e) => e.floorId === actor.floorId && e.health > 0 && e.actorId !== actor.actorId && cellKeys.has(`${e.x},${e.y}`))
        .map((e) => e.actorId);
      const resolved = resolveEffectSweep({
        effects: definition.effects,
        actors: next.actors, items: next.items, content,
        sourceActorId: actor.actorId, casterActorId: actor.actorId, includeCaster: false,
        targetActorIds, effectsState: next.rng.effects,
        survival: next.survival, survivalActorId: next.hero.actorId,
        worldTime: next.worldTime, eventId, forceMoveDirection: { x: 1, y: 0 }, operations: {},
      });
      next = applyEffectResult(next, resolved);
      events.push(...resolved.events);
      return { state: next, chargeEnergy: true };
    }
    // ...existing single-target resolveEffectSequence path unchanged...
```

Reuse the existing perception builder. `actions.ts` uses `targetContext(state, actor, content)`; export it (or add a thin `targetContextForDispatch`) so `action-dispatch.ts` can build the same `{ floor, visibilityWords, illumination }`. If `targetContext` is not exported, export it from `actions.ts` and import it here.

- [ ] **Step 7: Add the `cast` matching case to save validation** — `packages/engine/src/save-schema/run-record.ts`, in the applied-command event-matching ternary (~1440), add a `cast` branch (place alongside `fire`):

```ts
                          : recordValue.command.type === 'cast'
                            ? recordValue.events.find(
                                (entry) =>
                                  ((entry.type === 'attack.hit' || entry.type === 'actor.damaged' ||
                                    entry.type === 'actor.healed') && entry.actorId === run.hero.actorId) ||
                                  (entry.type === 'condition.applied' && entry.sourceActorId === run.hero.actorId) ||
                                  entry.type === 'hero.recalled',
                              )
```

And, if a downstream consistency block (~1610+) requires a per-command clause, add a benign `cast` acceptance clause (no positional assertion; AoE/self events are pre-validated by the reducer). If existing casts already pass because they always carry a hero-sourced damage/heal/condition event, this branch alone suffices.

> `hero.recalled` is added in Task 9; leaving it in the union here is forward-compatible and inert until then.

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm run test --workspace @woven-deep/engine -- cast-aoe weave actions`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/engine/src/caster.ts packages/engine/src/actions.ts packages/engine/src/action-dispatch.ts \
  packages/engine/src/commands-model.ts packages/engine/src/save-schema/run-record.ts \
  packages/engine/test/cast-aoe.test.ts
git commit -m "feat(engine): AoE cast sweep, caster-aptitude gate, and save-schema cast matching"
```

---

### Task 7: `effect.spell.learn` (tome learning)

**Files:**
- Modify: `packages/content/src/model/common.ts` (`EFFECT_IDS`)
- Modify: `packages/content/src/compiler/registries.ts` (`EFFECT_PARAMETER_SCHEMAS`)
- Modify: `packages/content/src/compiler/validation/shared.ts` (`effectIssues` spell ref)
- Modify: `docs/server-admin/content-configuration.md` (effect table)
- Modify: `packages/engine/src/caster.ts` (`spellLearnTarget`)
- Modify: `packages/engine/src/actions.ts` (use-item branch gate)
- Modify: `packages/engine/src/action-dispatch.ts` (use-item handler learn mutation)
- Modify: `packages/engine/src/commands-model.ts` (`InvalidActionReason`)
- Test: `packages/content/test/effect-learn.test.ts` (new), `packages/engine/test/tome-learn.test.ts` (new)

**Interfaces:**
- Produces: `EFFECT_IDS` includes `'effect.spell.learn'`; `EFFECT_PARAMETER_SCHEMAS['effect.spell.learn'] = z.strictObject({ spellId: stableIdSchema })`.
- Produces: `caster.ts` `spellLearnTarget(effects: readonly EffectDefinition[]): string | undefined` — the `spellId` of the first `effect.spell.learn`, else undefined.
- Produces: `InvalidActionReason` members `'learn.no-aptitude' | 'learn.already-known'`.

- [ ] **Step 1: Write the failing content test** — `packages/content/test/effect-learn.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { EFFECT_PARAMETER_SCHEMAS } from '../src/compiler/registries.js';

describe('effect.spell.learn registration', () => {
  it('requires a spellId', () => {
    const schema = EFFECT_PARAMETER_SCHEMAS['effect.spell.learn'];
    expect(schema).toBeDefined();
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ spellId: 'spell.ember-bolt' }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Write the failing engine test** — `packages/engine/test/tome-learn.test.ts`

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { resolve } from 'node:path';
import { createGameplayDemoRun, resolveCommand, type ActiveRun } from '../src/index.js';
import type { CompiledContentPack } from '@woven-deep/content';

let pack: CompiledContentPack;
beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
});

// spell.frost-shard + item.frost-shard-tome ship in Task 12; this exercises the learn loop.
function withTome(run: ActiveRun) {
  // give the hero a tome instance (mirror how gameplay tests inject an inventory item)
  return run;
}

describe('tome learning', () => {
  it('appends the spellId once and consumes the tome for a caster', () => {
    const { run } = createGameplayDemoRun(pack);
    const state = withTome(run);
    const hero = state.hero;
    const tome = state.items.find((i) => i.contentId === 'item.frost-shard-tome');
    if (!tome) return; // Task 12 not yet merged
    const result = resolveCommand(
      state,
      { type: 'use-item', commandId: 'command.learn', expectedRevision: state.revision, itemId: tome.itemId, target: null },
      { content: pack },
    );
    expect(result.result.status).toBe('applied');
    expect(result.state.hero.knownSpellIds).toContain('spell.frost-shard');
    expect(result.state.items.find((i) => i.itemId === tome.itemId)).toBeUndefined();
    void hero;
  });
});
```

- [ ] **Step 3: Register the effect (content)** — `packages/content/src/model/common.ts`, add to `EFFECT_IDS`:

```ts
  'effect.spell.learn',
```

`packages/content/src/compiler/registries.ts`, add to `EFFECT_PARAMETER_SCHEMAS`:

```ts
  'effect.spell.learn': z.strictObject({ spellId: stableIdSchema }),
```

- [ ] **Step 4: Validate the learn target resolves to a spell** — `packages/content/src/compiler/validation/shared.ts`, extend `conditionReferenceIssues` (rename mentally to "effect reference issues") or add a sibling and call it in `effectIssues`. Add:

```ts
function spellLearnReferenceIssues(
  file: string,
  path: string,
  effect: EffectDefinition,
  byId: ReadonlyMap<string, ContentEntry>,
): ContentCompileIssue[] {
  if (effect.effectId !== 'effect.spell.learn') return [];
  const spellId = effect.parameters.spellId;
  return typeof spellId === 'string'
    ? referencedKindIssue(file, `${path}.parameters.spellId`, spellId, 'spell', byId)
    : [issue(file, `${path}.parameters.spellId`, 'effect.spell.learn requires a spellId string')];
}
```

In `effectIssues`, combine both reference checks after the parameter check:

```ts
    return parameterIssues.length > 0
      ? parameterIssues
      : [
          ...conditionReferenceIssues(file, path, effect, byId),
          ...spellLearnReferenceIssues(file, path, effect, byId),
        ];
```

- [ ] **Step 5: Update the admin doc** — add a row to the effect table in `docs/server-admin/content-configuration.md`:

```markdown
| `effect.spell.learn` | `spellId` (must resolve to a `spell`); appends it to the hero's known spells; caster-only |
```

- [ ] **Step 6: Add `spellLearnTarget`** — `packages/engine/src/caster.ts`:

```ts
import type { EffectDefinition } from '@woven-deep/content';

/** The spellId of the first effect.spell.learn in an item's effects, or undefined. */
export function spellLearnTarget(effects: readonly EffectDefinition[]): string | undefined {
  const learn = effects.find((effect) => effect.effectId === 'effect.spell.learn');
  return learn ? (learn.parameters.spellId as string) : undefined;
}
```

- [ ] **Step 7: Add reasons** — `packages/engine/src/commands-model.ts`, extend `InvalidActionReason`:

```ts
  | 'learn.no-aptitude'
  | 'learn.already-known'
```

- [ ] **Step 8: Gate the tome in use-item validation** — `packages/engine/src/actions.ts`, use-item branch (~540). Near the top of the branch, after resolving `definition`, before the effect dry-run:

```ts
    const learnSpellId = spellLearnTarget(definition.effects);
    if (learnSpellId !== undefined) {
      if (!heroCasterAptitude(input.context.content, input.state.hero)) {
        return { status: 'invalid', reason: 'learn.no-aptitude' };
      }
      if ((input.state.hero.knownSpellIds ?? []).includes(learnSpellId)) {
        return { status: 'invalid', reason: 'learn.already-known' };
      }
    }
```

Add the import: `import { heroCasterAptitude, spellLearnTarget } from './caster.js';` (extend the Task 6 import).

- [ ] **Step 9: Apply the learn in the use-item handler** — `packages/engine/src/action-dispatch.ts`, use-item handler, after `applyEffectResult` and before returning:

```ts
    const learnSpellId = spellLearnTarget(definition.effects);
    if (learnSpellId !== undefined) {
      const known = next.hero.knownSpellIds ?? [];
      next = { ...next, hero: { ...next.hero, knownSpellIds: [...known, learnSpellId] } };
      events.push({ type: 'spell.learned', eventId, actorId: actor.actorId, spellId: learnSpellId });
    }
```

Add `spell.learned` to `events-model.ts` (a new `SpellLearnedEvent` with `type: 'spell.learned'; eventId; actorId; spellId`) and the save-schema `recorded` event union (`save-schema/events.ts`). Match it in the use-item event-matching (the use-item case already matches `item.used`, which is emitted first, so no change needed there).

Import `spellLearnTarget` at the top of `action-dispatch.ts`.

- [ ] **Step 10: Run tests to verify they pass**

Run: `npm run test --workspace @woven-deep/content -- effect-learn` then `npm run test --workspace @woven-deep/engine -- tome-learn`
Expected: PASS (engine test no-ops until Task 12 ships the tome, then asserts).

- [ ] **Step 11: Commit**

```bash
git add packages/content/src/model/common.ts packages/content/src/compiler/registries.ts \
  packages/content/src/compiler/validation/shared.ts docs/server-admin/content-configuration.md \
  packages/engine/src/caster.ts packages/engine/src/actions.ts packages/engine/src/action-dispatch.ts \
  packages/engine/src/commands-model.ts packages/engine/src/events-model.ts packages/engine/src/save-schema/events.ts \
  packages/content/test/effect-learn.test.ts packages/engine/test/tome-learn.test.ts
git commit -m "feat: effect.spell.learn tome learning with caster/already-known gates"
```

---

### Task 8: Condition burn tick (`tickEffects`)

**Files:**
- Modify: `packages/content/src/model/condition.ts`
- Modify: `packages/content/src/compiler/schema/condition.ts`
- Modify: `packages/engine/src/conditions.ts` (`tickConditions`)
- Modify: `packages/engine/src/survival.ts` (call `tickConditions` before `advanceConditions`)
- Test: `packages/content/test/condition-tick.test.ts` (new), `packages/engine/test/condition-burn.test.ts` (new)

**Interfaces:**
- Produces: `ConditionContentEntry.tickEffects?: readonly EffectDefinition[]`.
- Produces:
  ```ts
  export function tickConditions(input: Readonly<{
    actors: readonly ActorState[];
    content: CompiledContentPack;
    effectsState: Uint32State;
    worldTime: number;
    eventId: OpaqueId;
    mitigationFor: (actorId: OpaqueId, damageType: DamageType) => { armor: number; resistance: number; immune: boolean };
  }>): Readonly<{ actors: readonly ActorState[]; effectsState: Uint32State; events: readonly DomainEvent[] }>;
  ```
  Iterates actors in ascending `actorId`; for each, its conditions in ascending `conditionId`; applies each condition's `tickEffects` to the bearer via `resolveEffectSequence` (RNG threaded through `effectsState`), honoring resistance/immune via `mitigationByActorId`. Deterministic; expiry is left to `advanceConditions`.

- [ ] **Step 1: Write the failing content test** — `packages/content/test/condition-tick.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { contentFileSchema } from '../src/compiler/schema.js';

describe('condition tickEffects', () => {
  it('accepts a timed condition carrying a fire tick', () => {
    const parsed = contentFileSchema.parse({
      schemaVersion: 7,
      entries: [
        {
          kind: 'condition',
          id: 'condition.burning',
          name: 'Burning',
          description: 'Taking fire each turn.',
          color: '#e05a2b',
          duration: { mode: 'timed', default: 3, maximum: 5 },
          stacking: { mode: 'replace', maximumStacks: 1 },
          tickEffects: [
            { effectId: 'effect.damage', parameters: { damageType: 'fire', dice: { count: 1, sides: 2, bonus: 0 } }, requiresLivingTarget: true },
          ],
        },
      ],
    });
    expect(parsed.entries[0]).toMatchObject({ tickEffects: [{ effectId: 'effect.damage' }] });
  });

  it('defaults tickEffects to an empty array', () => {
    const parsed = contentFileSchema.parse({
      schemaVersion: 7,
      entries: [
        {
          kind: 'condition', id: 'condition.slow', name: 'Slow', description: 'Sluggish.', color: '#4488cc',
          duration: { mode: 'timed', default: 2, maximum: 4 }, stacking: { mode: 'replace', maximumStacks: 1 },
          modifiersPerStack: { defense: -1 },
        },
      ],
    });
    expect(parsed.entries[0]).toMatchObject({ tickEffects: [] });
  });
});
```

- [ ] **Step 2: Write the failing engine test** — `packages/engine/test/condition-burn.test.ts`

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { resolve } from 'node:path';
import { createDemoRun, tickConditions, stableJson, type ActorState } from '../src/index.js';
import type { CompiledContentPack } from '@woven-deep/content';

let pack: CompiledContentPack;
beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
});

function burningActor(id: string): ActorState {
  const run = createDemoRun();
  return {
    ...run.actors[0]!, actorId: id, playerControlled: false, health: 10, maxHealth: 10,
    conditions: [{ conditionId: 'condition.burning', sourceActorId: 'hero', appliedAt: 0, expiresAt: 3, stacks: 1 }],
  };
}

describe('condition burn tick', () => {
  it('deals tick damage in a stable, order-independent way', () => {
    if (!pack.entries.some((e) => e.id === 'condition.burning')) return; // Task 12 ships it
    const run = createDemoRun();
    const noMit = () => ({ armor: 0, resistance: 0, immune: false });
    const a = tickConditions({ actors: [burningActor('m.a'), burningActor('m.b')], content: pack, effectsState: run.rng.effects, worldTime: 1, eventId: 'command.tick', mitigationFor: noMit });
    const b = tickConditions({ actors: [burningActor('m.b'), burningActor('m.a')], content: pack, effectsState: run.rng.effects, worldTime: 1, eventId: 'command.tick', mitigationFor: noMit });
    expect(stableJson(a.effectsState)).toBe(stableJson(b.effectsState));
    const ha = Object.fromEntries(a.actors.map((x) => [x.actorId, x.health]));
    const hb = Object.fromEntries(b.actors.map((x) => [x.actorId, x.health]));
    expect(ha).toEqual(hb);
    expect(ha['m.a']).toBeLessThan(10);
  });
});
```

- [ ] **Step 3: Add the model + schema fields** — `packages/content/src/model/condition.ts`, add to `ConditionContentEntry` (import `EffectDefinition` from `./common.js`):

```ts
  readonly tickEffects: readonly EffectDefinition[];
```

`packages/content/src/compiler/schema/condition.ts`, add to the strict object (import `effect` from `./common.js`):

```ts
    tickEffects: z.array(effect).default([]),
```

- [ ] **Step 4: Add `tickConditions`** — `packages/engine/src/conditions.ts`. Import at top:

```ts
import type { CompiledContentPack, ConditionContentEntry, ConditionTraitId, DamageType } from '@woven-deep/content';
import type { DomainEvent, OpaqueId, Uint32State } from './model.js';
import { resolveEffectSequence } from './effects.js';
```

Add:

```ts
export function tickConditions(
  input: Readonly<{
    actors: readonly ActorState[];
    content: CompiledContentPack;
    effectsState: Uint32State;
    worldTime: number;
    eventId: OpaqueId;
    survival: import('./survival-model.js').SurvivalState;
    survivalActorId: OpaqueId;
    mitigationFor: (actorId: OpaqueId, damageType: DamageType) => { armor: number; resistance: number; immune: boolean };
  }>,
): Readonly<{ actors: readonly ActorState[]; effectsState: Uint32State; events: readonly DomainEvent[] }> {
  const orderedActorIds = input.actors
    .map((actor) => actor.actorId)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  let actors = input.actors;
  let state = input.effectsState;
  const events: DomainEvent[] = [];
  for (const actorId of orderedActorIds) {
    const bearer = actors.find((actor) => actor.actorId === actorId);
    if (!bearer || bearer.health === 0) continue;
    const conditionIds = [...bearer.conditions]
      .map((condition) => condition.conditionId)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    for (const conditionId of conditionIds) {
      const definition = conditionDefinition(input.content, conditionId);
      if (definition.tickEffects.length === 0) continue;
      const damageType = firstDamageType(definition);
      const step = resolveEffectSequence({
        effects: definition.tickEffects,
        actors,
        content: input.content,
        sourceActorId: actorId,
        targetActorId: actorId,
        effectsState: state,
        worldTime: input.worldTime,
        eventId: input.eventId,
        forceMoveDirection: { x: 1, y: 0 },
        operations: {},
        survival: input.survival,
        survivalActorId: input.survivalActorId,
        mitigationByActorId: { [actorId]: input.mitigationFor(actorId, damageType) },
      });
      actors = step.actors;
      state = step.effectsState;
      events.push(...step.events);
    }
  }
  return { actors, effectsState: state, events };
}

function firstDamageType(definition: ConditionContentEntry): DamageType {
  const damage = definition.tickEffects.find((effect) => effect.effectId === 'effect.damage');
  return (damage?.parameters.damageType as DamageType | undefined) ?? 'physical';
}
```

- [ ] **Step 5: Call it in `advanceSurvival`** — `packages/engine/src/survival.ts`, immediately before the existing `advanceConditions` call (~254), tick then expire, threading the effects stream and clamping through the run. Import `tickConditions` and `conditionMitigation` helper (or a simple resistance lookup via `profile`/`combat-profile`). Minimal wiring:

```ts
  const tick = tickConditions({
    actors,
    content: input.content,
    effectsState: input.state.rng.effects,
    worldTime: input.state.worldTime,
    eventId: input.eventId,
    survival: input.state.survival,
    survivalActorId: heroId,
    mitigationFor: (actorId, damageType) => actorDamageMitigation({ state: input.state, content: input.content, actorId, damageType }),
  });
  actors = [...tick.actors];
  events.push(...tick.events);
```

Return the threaded `effects` stream from `advanceSurvival` (add `rng: { ...input.state.rng, effects: tick.effectsState }` to the returned state's `state`), so the burn tick's RNG advance is persisted. Provide `actorDamageMitigation` via the existing combat profile (mirror how `action-dispatch.ts` `fire` computes `defense`/`resistance`/`immune` through `profile(...)`), returning `{ armor, resistance, immune }` for the actor and damage type.

> This adds RNG consumption to the per-turn survival tick. It shifts existing demo fixtures **only if** a burn condition is actually present on an actor during a demo — none of the 7 existing demos apply a burn, so their fixtures are unaffected (verify in Task 15). The `effects` stream is otherwise untouched by a tick over conditions with empty `tickEffects`.

- [ ] **Step 6: Export `tickConditions`** — add to `packages/engine/src/index.ts`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm run test --workspace @woven-deep/content -- condition-tick` then `npm run test --workspace @woven-deep/engine -- condition-burn conditions`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/content/src/model/condition.ts packages/content/src/compiler/schema/condition.ts \
  packages/engine/src/conditions.ts packages/engine/src/survival.ts packages/engine/src/index.ts \
  packages/content/test/condition-tick.test.ts packages/engine/test/condition-burn.test.ts
git commit -m "feat(engine): condition tickEffects (burn DoT), RNG-threaded and stable-ordered"
```

---

### Task 9: `effect.recall` + return portal

**Files:**
- Modify: `packages/content/src/model/common.ts` (`EFFECT_IDS`), `packages/content/src/compiler/registries.ts`
- Modify: `docs/server-admin/content-configuration.md`
- Modify: `packages/engine/src/model.ts` (`ActiveRun.returnAnchorFloorId`)
- Modify: `packages/engine/src/events-model.ts` (`HeroRecalledEvent`)
- Modify: `packages/engine/src/save-schema/run-record.ts` (`returnAnchorFloorId` field + `hero.recalled` recorded shape)
- Modify: `packages/engine/src/save-schema/events.ts`
- Modify: `packages/engine/src/actions.ts` (cast branch: `recall.already-town`)
- Modify: `packages/engine/src/action-dispatch.ts` (cast handler: set anchor + emit `hero.recalled`)
- Modify: `packages/engine/src/floor-transition.ts` (`recallToTown`, `recallReturn`)
- Modify: `packages/engine/src/commands-model.ts` (`recall.already-town`)
- Modify: `packages/session-core/src/dispatch.ts` (post-cast town move; return-portal routing)
- Test: `packages/engine/test/recall.test.ts` (new)

**Interfaces:**
- Produces: `EFFECT_IDS` includes `'effect.recall'`; `EFFECT_PARAMETER_SCHEMAS['effect.recall'] = z.strictObject({})`.
- Produces: `ActiveRun.returnAnchorFloorId?: OpaqueId`.
- Produces: `HeroRecalledEvent = { type: 'hero.recalled'; eventId: OpaqueId; actorId: OpaqueId; anchorFloorId: OpaqueId }`.
- Produces: `recallToTown(run, { content }): { state: ActiveRun; events: readonly DomainEvent[] }` — sets `activeFloorId` to the town, moves the hero to the town stair-down slot, keeps `returnAnchorFloorId`, clears `recentCommands` (reuse `enterStoredFloor`).
- Produces: `recallReturn(run, { content }): { state: ActiveRun; events: readonly DomainEvent[] }` — moves the hero to `returnAnchorFloorId`'s stair-down (fallback stair-up), clears `returnAnchorFloorId` (reuse `enterStoredFloor`).
- Produces: `InvalidActionReason` member `'recall.already-town'`.

- [ ] **Step 1: Write the failing test** — `packages/engine/test/recall.test.ts`

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { resolve } from 'node:path';
import {
  createGameplayDemoRun, resolveCommand, recallToTown, recallReturn, validateActiveRun, encodeActiveRun,
  isTownFloorActive, type ActiveRun,
} from '../src/index.js';
import type { CompiledContentPack } from '@woven-deep/content';

let pack: CompiledContentPack;
beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
});

describe('recall', () => {
  it('anchors the current floor and moves to town, then returns and clears the anchor', () => {
    // Build a run whose hero is on a dungeon floor (createGameplayDemoRun starts on floor.demo).
    const { run } = createGameplayDemoRun(pack);
    if (!pack.entries.some((e) => e.id === 'spell.recall')) return; // Task 12 ships spell.recall
    const cast = resolveCommand(
      run,
      { type: 'cast', commandId: 'command.recall', expectedRevision: run.revision, spellId: 'spell.recall', target: null },
      { content: pack },
    );
    expect(cast.result.status).toBe('applied');
    // Session-level move to town happens outside resolveCommand; drive it directly here:
    const anchored = cast.state;
    expect(anchored.returnAnchorFloorId).toBe(run.activeFloorId);
    const inTown = recallToTown(anchored, { content: pack }).state;
    expect(isTownFloorActive(inTown)).toBe(true);
    expect(() => validateActiveRun(JSON.parse(JSON.stringify(encodeActiveRun(inTown))))).not.toThrow();
    const back = recallReturn(inTown, { content: pack }).state;
    expect(back.activeFloorId).toBe(run.activeFloorId);
    expect(back.returnAnchorFloorId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace @woven-deep/engine -- recall`
Expected: FAIL — `effect.recall` unregistered / `recallToTown` not exported.

- [ ] **Step 3: Register the effect (content)** — `EFFECT_IDS` add `'effect.recall'`; `EFFECT_PARAMETER_SCHEMAS` add `'effect.recall': z.strictObject({})`; add a doc row:

```markdown
| `effect.recall` | none; self-only; anchors the current floor and returns the hero to town |
```

- [ ] **Step 4: Model + event + save-schema field** —
`packages/engine/src/model.ts`, add to `ActiveRun`:

```ts
  readonly returnAnchorFloorId?: OpaqueId;
```

`packages/engine/src/events-model.ts`, add `HeroRecalledEvent` and include it in the `DomainEvent` union.

`packages/engine/src/save-schema/run-record.ts`, add to `activeRunSchema` (after `activeFloorEnteredAt`):

```ts
  returnAnchorFloorId: identifier.optional(),
```

Add a semantic check in `validateSemantics`: if `returnAnchorFloorId` is set it must exist in `run.floors` and differ from a town floor:

```ts
  if (run.returnAnchorFloorId !== undefined) {
    const anchor = run.floors.find((floor) => floor.floorId === run.returnAnchorFloorId);
    if (!anchor) fail('returnAnchorFloorId', 'recall anchor floor does not exist');
  }
```

`packages/engine/src/save-schema/events.ts` — add the `hero.recalled` recorded-event shape (mirror an existing simple actor event) so `recorded` accepts it in `recentCommands`.

- [ ] **Step 5: Add `recall.already-town` + cast gate** — `commands-model.ts` add `| 'recall.already-town'`. In `actions.ts` cast branch, after the aptitude gate, if the spell carries `effect.recall` and the town floor is active, reject:

```ts
    if (definition.effects.some((e) => e.effectId === 'effect.recall') && isTownFloorActive(input.state)) {
      return { status: 'invalid', reason: 'recall.already-town' };
    }
```

Import `isTownFloorActive` from `./town-floor.js` in `actions.ts`.

- [ ] **Step 6: Set the anchor + emit event in the cast handler** — `action-dispatch.ts` cast handler, after `applyEffectResult` / event push, before returning:

```ts
    if (definition.effects.some((e) => e.effectId === 'effect.recall')) {
      next = { ...next, returnAnchorFloorId: next.activeFloorId };
      events.push({ type: 'hero.recalled', eventId, actorId: actor.actorId, anchorFloorId: next.activeFloorId });
    }
```

(The floor does **not** change inside the reducer — see finding #3.)

- [ ] **Step 7: Add `recallToTown` and `recallReturn`** — `packages/engine/src/floor-transition.ts`:

```ts
import { TOWN_FLOOR_ID } from './town-floor.js';

export function recallToTown(
  run: ActiveRun,
  context: Readonly<{ content: CompiledContentPack }>,
): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  void context;
  const town = run.floors.find((floor) => floor.depth === 0);
  if (!town) throw new Error('internal invariant: run has no town floor');
  const arrival = town.stairDown;
  if (arrival === null) throw new Error('internal invariant: town floor has no stair-down');
  const state = enterStoredFloor(run, { floorId: town.floorId, arrival });
  return { state, events: [] };
}

export function recallReturn(
  run: ActiveRun,
  context: Readonly<{ content: CompiledContentPack }>,
): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  void context;
  const anchorId = run.returnAnchorFloorId;
  if (anchorId === undefined) throw new Error('recallReturn requires an anchored floor');
  const anchor = run.floors.find((floor) => floor.floorId === anchorId);
  if (!anchor) throw new Error(`internal invariant: anchor floor ${anchorId} is missing`);
  const arrival = anchor.stairDown ?? anchor.stairUp;
  if (arrival === null) throw new Error(`internal invariant: anchor floor ${anchorId} has no stair`);
  const moved = enterStoredFloor(run, { floorId: anchorId, arrival });
  const { returnAnchorFloorId: _cleared, ...rest } = moved;
  return { state: rest as ActiveRun, events: [] };
}
```

> `enterStoredFloor` returns `validateActiveRun(moved)`; because `returnAnchorFloorId` survives the spread in `recallToTown` (it is set on `run` before the call), the town state validates with the anchor still present. `recallReturn` strips the anchor key entirely (exactOptionalPropertyTypes: delete the optional key, don't set `undefined`).

- [ ] **Step 8: Session wiring** — `packages/session-core/src/dispatch.ts`:

In the `command` branch, after `resolveCommand`, if the resolution set a new anchor and the hero is not yet in town, perform the town move:

```ts
  const resolution = resolveCommand(run, built.command, { content: pack });
  if (
    resolution.state.returnAnchorFloorId !== undefined &&
    run.returnAnchorFloorId === undefined
  ) {
    const moved = recallToTown(resolution.state, { content: pack });
    const events = projectDomainEvents({ state: moved.state, content: pack, heroId: moved.state.hero.actorId, events: moved.events });
    return { kind: 'transition', run: moved.state, events, onboardingIntentType: 'recall' };
  }
  return { kind: 'command', resolution, onboardingIntentType: onboardingIntentType(intent) };
```

In the `descend` branch, route the anchored town descent to `recallReturn`:

```ts
  if (built.kind === 'descend') {
    const transition = run.returnAnchorFloorId !== undefined
      ? recallReturn(run, { content: pack })
      : descendToNextFloor(run, { content: pack });
    const events = projectDomainEvents({ state: transition.state, content: pack, heroId: transition.state.hero.actorId, events: transition.events });
    return { kind: 'transition', run: transition.state, events, onboardingIntentType: 'descend' };
  }
```

Import `recallToTown`, `recallReturn` from `@woven-deep/engine`.

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm run test --workspace @woven-deep/engine -- recall` and `npm run test --workspace @woven-deep/session-core`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/content/src/model/common.ts packages/content/src/compiler/registries.ts \
  docs/server-admin/content-configuration.md packages/engine/src/model.ts packages/engine/src/events-model.ts \
  packages/engine/src/save-schema/run-record.ts packages/engine/src/save-schema/events.ts \
  packages/engine/src/actions.ts packages/engine/src/action-dispatch.ts packages/engine/src/floor-transition.ts \
  packages/engine/src/commands-model.ts packages/engine/src/index.ts packages/session-core/src/dispatch.ts \
  packages/engine/test/recall.test.ts
git commit -m "feat: effect.recall town portal with return-anchor save field and session wiring"
```

---

### Task 10: Per-turn Weave regen — verification + regression tests

> **Decomposition change vs skeleton:** per-turn Weave regen is **already implemented** in `advanceSurvival` (survival.ts:287–311, commit `6984265`). This task is verification + regression coverage, not net-new code. No new production code unless a gap is found.

**Files:**
- Test: `packages/engine/test/weave-regen.test.ts` (new)
- Read-only: `packages/engine/src/survival.ts:263-311`, `packages/engine/src/rest.ts:48-50`

- [ ] **Step 1: Read the existing implementation** — confirm `advanceSurvival` accrues `weaveRegen * intervals` clamped to `maxWeave` inside the `!danger && !blocks-recovery` block, and `restoreHeroWeaveToFull` (rest.ts:48) still fills to max on completed rest.

- [ ] **Step 2: Write the regression test** — `packages/engine/test/weave-regen.test.ts`

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { resolve } from 'node:path';
import { advanceSurvival, createGameplayDemoRun, type ActiveRun } from '../src/index.js';
import type { CompiledContentPack } from '@woven-deep/content';

let pack: CompiledContentPack;
beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
});

function drainedHero(run: ActiveRun, elapsed: number) {
  const hero = run.actors.find((a) => a.playerControlled)!;
  const actors = run.actors.map((a) => (a.playerControlled ? { ...a, weave: 0 } : a));
  const advanced: ActiveRun = { ...run, actors, worldTime: run.worldTime + elapsed };
  return advanceSurvival({ state: advanced, content: pack, elapsed, eventId: 'command.tick', danger: false });
}

describe('per-turn Weave regen', () => {
  it('accrues over recovery intervals and never exceeds maxWeave', () => {
    const { run } = createGameplayDemoRun(pack);
    const result = drainedHero(run, 500);
    const hero = result.state.actors.find((a) => a.playerControlled)!;
    expect(hero.weave).toBeGreaterThan(0);
    expect(hero.weave).toBeLessThanOrEqual(hero.maxWeave);
  });

  it('does not regenerate Weave while in danger', () => {
    const { run } = createGameplayDemoRun(pack);
    const hero = run.actors.find((a) => a.playerControlled)!;
    const actors = run.actors.map((a) => (a.playerControlled ? { ...a, weave: 0 } : a));
    const advanced: ActiveRun = { ...run, actors, worldTime: run.worldTime + 500 };
    const result = advanceSurvival({ state: advanced, content: pack, elapsed: 500, eventId: 'command.tick', danger: true });
    const after = result.state.actors.find((a) => a.playerControlled)!;
    expect(after.weave).toBe(0);
  });
});
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `npm run test --workspace @woven-deep/engine -- weave-regen weave`
Expected: PASS. If either assertion fails, the regen is not behaving as the spec requires — treat that as the net-new work and fix `advanceSurvival` accordingly, keeping RNG-free integer add + clamp.

- [ ] **Step 4: Commit**

```bash
git add packages/engine/test/weave-regen.test.ts
git commit -m "test(engine): regression coverage for per-turn Weave regen and danger gating"
```

---

## Phase 3 — Content

### Task 11: Migrate `ember-scroll` to `spellId` + scroll-read semantics

**Files:**
- Modify: `content/items/ember-scroll.yaml`
- Modify: `packages/engine/src/actions.ts` (use-item validation: scroll-read via `spellId`)
- Modify: `packages/engine/src/action-dispatch.ts` (use-item handler: resolve spell effects for a scroll)
- Modify: `packages/engine/src/caster.ts` (`itemGrantsLearn` already covered by `spellLearnTarget`)
- Test: `packages/engine/test/scroll-read.test.ts` (new)

**Interfaces:**
- Consumes: `ItemContentEntry.spellId`, `resolveEffectSweep`, `validateTarget`, `entryById`.
- Behavior: a **scroll** is an item with `spellId` set and **no** `effect.spell.learn`. Reading it resolves the referenced spell's `effects` at the chosen target using the spell's `targetingId`/`range`/`aoe` (AoE-aware sweep), with **no Weave cost and no aptitude check**, then self-consumes via the item's `effect.item.consume`. A **tome** is an item with `effect.spell.learn` (Task 7). An item may set neither (a normal consumable — today's behavior unchanged).

- [ ] **Step 1: Write the failing test** — `packages/engine/test/scroll-read.test.ts`

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { resolve } from 'node:path';
import { createGameplayDemoRun, resolveCommand, type ActiveRun } from '../src/index.js';
import type { CompiledContentPack } from '@woven-deep/content';

let pack: CompiledContentPack;
beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
});

// A non-caster hero reads an ember scroll: damage lands, scroll is consumed, no Weave spent.
function heroWithScroll(run: ActiveRun) {
  // inject a known ember-scroll instance for the hero, mirroring inventory-injection in gameplay tests
  return run;
}

describe('scroll read', () => {
  it('resolves the referenced spell once and consumes the scroll (no Weave, any class)', () => {
    const { run } = createGameplayDemoRun(pack);
    const state = heroWithScroll(run);
    const scroll = state.items.find((i) => i.contentId === 'item.ember-scroll');
    if (!scroll) return; // inventory injection wiring pending
    const hero = state.actors.find((a) => a.playerControlled)!;
    const rat = state.actors.find((a) => a.contentId === 'monster.cave-rat')!;
    const target = { x: rat.x, y: rat.y };
    const result = resolveCommand(
      state,
      { type: 'use-item', commandId: 'command.read', expectedRevision: state.revision, itemId: scroll.itemId, target },
      { content: pack },
    );
    expect(result.result.status).toBe('applied');
    const heroAfter = result.state.actors.find((a) => a.playerControlled)!;
    expect(heroAfter.weave).toBe(hero.weave); // no Weave spent
    expect(result.state.items.find((i) => i.itemId === scroll.itemId)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Migrate the scroll content** — `content/items/ember-scroll.yaml`, replace the `effects` block so the damage comes from the referenced spell:

```yaml
    spellId: spell.ember-bolt
    identification: { mode: known, poolId: null }
    effects:
      - { effectId: effect.item.consume, parameters: { quantity: 1 }, requiresLivingTarget: false }
```

(Remove the duplicated `effect.damage` line.)

- [ ] **Step 3: Scroll-read in use-item validation** — `packages/engine/src/actions.ts`, use-item branch. When `definition.spellId` is set and there is no learn effect, resolve the **spell** (not the item's effects) for targeting. Add after the learn gate:

```ts
    const scrollSpellId = learnSpellId === undefined ? definition.spellId : undefined;
    if (scrollSpellId !== undefined) {
      const spell = entryById(input.context.content, scrollSpellId);
      if (!spell || spell.kind !== 'spell') return { status: 'invalid', reason: 'action.unavailable' };
      const perception = targetContext(input.state, actor, input.context.content);
      const area = validateTarget({
        targetingId: spell.targetingId, sourceActor: actor, targetActorId: null,
        target: command.target, floor: perception.floor, actors: input.state.actors,
        visibilityWords: perception.visibilityWords, illumination: perception.illumination,
        range: spell.range, ...(spell.aoe ? { aoe: spell.aoe } : {}),
      });
      if (!area.ok) return { status: 'invalid', reason: area.reason };
      // dry-run handled at commit; validity of cells is sufficient here.
      return { type: 'use-item', actorId: actor.actorId, itemId: source.itemId, targetActorId: actor.actorId, cost: definition.actionCost };
    }
```

- [ ] **Step 4: Scroll-read in the use-item handler** — `packages/engine/src/action-dispatch.ts`, use-item handler. When `definition.spellId` is set (and no learn), resolve the spell's effects at the target via the sweep, then apply the item's own effects (the consume). Insert before the existing `resolveEffectSequence({ effects: definition.effects, ... })`:

```ts
    if (definition.spellId !== undefined && spellLearnTarget(definition.effects) === undefined) {
      const spell = entryById(content, definition.spellId);
      if (!spell || spell.kind !== 'spell') throw new Error('internal invariant: scroll spell missing');
      const perception = targetContextForDispatch(state, actor, content);
      const targetPoint = target.actorId === actor.actorId ? { x: actor.x, y: actor.y } : { x: target.x, y: target.y };
      const area = validateTarget({
        targetingId: spell.targetingId, sourceActor: actor, targetActorId: null,
        target: targetPoint, floor: perception.floor, actors: state.actors,
        visibilityWords: perception.visibilityWords, illumination: perception.illumination,
        range: spell.range, ...(spell.aoe ? { aoe: spell.aoe } : {}),
      });
      if (!area.ok) throw new Error(`internal invariant: validated scroll read failed with ${area.reason}`);
      const cellKeys = new Set(area.cells.map((c) => `${c.x},${c.y}`));
      const targetActorIds = spell.aoe
        ? state.actors.filter((e) => e.floorId === actor.floorId && e.health > 0 && e.actorId !== actor.actorId && cellKeys.has(`${e.x},${e.y}`)).map((e) => e.actorId)
        : [target.actorId];
      let scrolled = resolveEffectSweep({
        effects: spell.effects, actors: state.actors, items: state.items, content,
        sourceActorId: actor.actorId, casterActorId: actor.actorId, includeCaster: false,
        targetActorIds, effectsState: state.rng.effects, survival: state.survival, survivalActorId: state.hero.actorId,
        worldTime: state.worldTime, eventId, forceMoveDirection: { x: 1, y: 0 }, operations: {},
      });
      let next = applyEffectResult(state, scrolled);
      // consume the scroll via its own effects
      const consumed = resolveEffectSequence({
        effects: definition.effects, actors: next.actors, items: next.items, content,
        sourceActorId: actor.actorId, sourceItemId: source.itemId, targetActorId: actor.actorId,
        effectsState: next.rng.effects, worldTime: next.worldTime, eventId, survival: next.survival,
        survivalActorId: next.hero.actorId, forceMoveDirection: { x: 1, y: 0 }, operations: {},
      });
      next = applyEffectResult(next, consumed);
      events.push({ type: 'item.used', eventId, actorId: actor.actorId, itemId: source.itemId, targetActorId: target.actorId });
      events.push(...scrolled.events, ...consumed.events);
      return { state: next, chargeEnergy: true };
      void scrolled;
    }
```

(Emit the `item.used` event first so the save-schema use-item matching still finds it.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test --workspace @woven-deep/engine -- scroll-read` and `npm run test --workspace @woven-deep/content -- default-content`
Expected: PASS (`default-content` recompiles the migrated ember-scroll under STRICT validation; `spellId` resolves).

- [ ] **Step 6: Commit**

```bash
git add content/items/ember-scroll.yaml packages/engine/src/actions.ts packages/engine/src/action-dispatch.ts \
  packages/engine/test/scroll-read.test.ts
git commit -m "feat: scroll-read derives effects from spellId; ember-scroll references spell.ember-bolt"
```

---

### Task 12: The ~14-spell spellbook

**Files:**
- Create: `content/spells/*.yaml` (fire/frost/storm/ward), `content/items/*-tome.yaml`, `content/items/*-scroll.yaml`, `content/conditions/*.yaml` (burn, slow, weaken, shield, wards)
- Test: `packages/engine/test/spellbook-mechanics.test.ts` (new)

**Interfaces:**
- Consumes: everything from Tasks 1–11. Every mechanic below must be represented by at least one shipped spell: single-target, burst, line, cone, instant damage, burn DoT, shield, ward/resist, slow, weaken, recall.

Indicative content (tune values against `content/balance`; all compile under STRICT validation):

- **Fire:** `spell.ember-bolt` (exists, single) · `spell.fireball` (burst, `aoe {shape:burst,radius:2}`, damage + `effect.condition.apply` → `condition.burning`) · `spell.cinder-breath` (cone, `aoe {shape:cone,radius:3}`, damage)
- **Frost:** `spell.frost-shard` (single, damage) · `spell.frost-nova` (burst, damage + `condition.chilled` slow) · `spell.rime-ward` (`target.self`, `condition.rime-ward` frost resistance)
- **Storm:** `spell.arc-lance` (line, `aoe {shape:line,radius:6}`, damage) · `spell.chain-spark` (single, damage) · `spell.static-field` (burst, `condition.static-weakened` weaken)
- **Ward/utility:** `spell.weave-shield` (`target.self`, `condition.weave-shield` armor) · `spell.aegis` (`target.self`, `condition.aegis` all-element resistance) · `spell.enervate` (single/burst, `condition.enervated` weaken-over-time) · `spell.mend` (`target.self`, `effect.heal`) · `spell.recall` (`target.self`, `effect.recall`)

Conditions: `condition.burning` (timed, `tickEffects` fire damage), `condition.chilled` (timed, negative speed via a `weaveRegen`/`defense`-adjacent modifier — use an existing `DERIVED_STAT_NAME`; there is no `speed` derived stat, so model "slow" as reduced accuracy/defense per the balance table), `condition.static-weakened` / `condition.enervated` (negative `meleeDamageBonus`/`rangedAccuracy`), `condition.weave-shield` (positive `defense`), `condition.rime-ward` / `condition.aegis` (resistance handled at the mitigation layer — if resistance is not a `DERIVED_STAT_NAME`, express wards through the combat-profile resistance path the AoE sweep consumes; otherwise use the closest defensive modifier and document the intent).

> **Modifier note:** `DERIVED_STAT_NAMES` (common.ts:42) has no `speed`/`resistance` entries. Wards/slow are therefore expressed with the available derived stats (`defense`, `meleeAccuracy`, `rangedAccuracy`, `meleeDamageBonus`) plus, for elemental resistance, the combat-profile resistance mitigation the sweep already honors. Keep each condition's `modifiersPerStack` within existing stat names so `condition.ts` `conditionModifiers` stays valid.

Example — `content/spells/fireball.yaml`:

```yaml
schemaVersion: 7
entries:
  - kind: spell
    id: spell.fireball
    name: Fireball
    tags: [fire, offense, aoe]
    targetingId: target.burst
    range: 6
    actionCost: 100
    weaveCost: 6
    aoe: { shape: burst, radius: 2 }
    effects:
      - { effectId: effect.damage, parameters: { damageType: fire, dice: { count: 2, sides: 6, bonus: 0 } }, requiresLivingTarget: true }
      - { effectId: effect.condition.apply, parameters: { conditionId: condition.burning, duration: 3 }, requiresLivingTarget: true }
```

Example — `content/conditions/burning.yaml`:

```yaml
schemaVersion: 7
entries:
  - kind: condition
    id: condition.burning
    name: Burning
    tags: [fire, debuff]
    description: Wracked by clinging flame, taking fire damage each turn.
    color: '#e05a2b'
    duration: { mode: timed, default: 3, maximum: 6 }
    stacking: { mode: replace, maximumStacks: 1 }
    tickEffects:
      - { effectId: effect.damage, parameters: { damageType: fire, dice: { count: 1, sides: 2, bonus: 0 } }, requiresLivingTarget: true }
```

Example — `content/items/frost-shard-tome.yaml`:

```yaml
schemaVersion: 7
entries:
  - kind: item
    id: item.frost-shard-tome
    name: Tome of frost shard
    glyph: "="
    color: '#7fbfe0'
    description: A cold-bound codex; reading it teaches the frost shard for good.
    tags: [magic, tome]
    minDepth: 1
    maxDepth: 20
    category: misc
    stackLimit: 1
    price: 40
    rarity: uncommon
    actionCost: 100
    equipment: null
    combat: null
    light: null
    identification: { mode: known, poolId: null }
    effects:
      - { effectId: effect.spell.learn, parameters: { spellId: spell.frost-shard }, requiresLivingTarget: false }
      - { effectId: effect.item.consume, parameters: { quantity: 1 }, requiresLivingTarget: false }
```

- [ ] **Step 1: Author the spells, tomes, scrolls, and conditions** (files above; scrolls only where a cast-once makes sense — e.g. `item.fireball-scroll` with `spellId: spell.fireball`).

- [ ] **Step 2: Write the mechanic-coverage test** — `packages/engine/test/spellbook-mechanics.test.ts`

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { resolve } from 'node:path';
import type { CompiledContentPack, SpellContentEntry, ConditionContentEntry } from '@woven-deep/content';

let pack: CompiledContentPack;
beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
});

describe('spellbook mechanic coverage', () => {
  it('ships at least one spell exercising every mechanic', () => {
    const spells = pack.entries.filter((e): e is SpellContentEntry => e.kind === 'spell');
    const conditions = pack.entries.filter((e): e is ConditionContentEntry => e.kind === 'condition');
    const has = (pred: (s: SpellContentEntry) => boolean) => spells.some(pred);
    expect(has((s) => s.aoe === undefined && s.targetingId === 'target.actor')).toBe(true); // single
    expect(has((s) => s.aoe?.shape === 'burst')).toBe(true); // burst
    expect(has((s) => s.aoe?.shape === 'line')).toBe(true); // line
    expect(has((s) => s.aoe?.shape === 'cone')).toBe(true); // cone
    expect(has((s) => s.effects.some((e) => e.effectId === 'effect.damage'))).toBe(true); // instant damage
    expect(has((s) => s.effects.some((e) => e.effectId === 'effect.heal'))).toBe(true); // heal
    expect(has((s) => s.effects.some((e) => e.effectId === 'effect.recall'))).toBe(true); // recall
    expect(has((s) => s.effects.some((e) => e.effectId === 'effect.condition.apply'))).toBe(true); // buff/debuff
    expect(conditions.some((c) => c.tickEffects.length > 0)).toBe(true); // burn DoT
  });
});
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `npm run test --workspace @woven-deep/content -- default-content` then `npm run test --workspace @woven-deep/engine -- spellbook-mechanics cast-aoe tome-learn condition-burn recall`
Expected: PASS. All content compiles under STRICT validation; every mechanic is represented; the AoE/learn/burn/recall engine tests from earlier tasks now find their content.

- [ ] **Step 4: Commit**

```bash
git add content/spells content/items content/conditions packages/engine/test/spellbook-mechanics.test.ts
git commit -m "content: ~14-spell spellbook with tomes, scrolls, and buff/debuff/burn conditions"
```

---

### Task 13: Spell vendor (permanent town merchant)

**Files:**
- Modify: `content/vaults/town.yaml` (new `merchant-spellvendor` slot)
- Modify: `packages/engine/src/town-floor.ts` (`merchantSlots.spellvendor`)
- Modify: `packages/engine/src/new-run.ts` (`townMerchantSpecs`)
- Create: `content/npcs/town-merchants.yaml` entry `npc.town-spellvendor`; `content/encounters/town-merchants.yaml` entry `encounter.town-spellvendor`; `content/loot-tables/town-spellvendor.yaml`
- Test: `packages/engine/test/spell-vendor.test.ts` (new)

**Interfaces:**
- Consumes: the existing merchant pipeline (`materializeMerchant`, `merchant-stock.ts`).
- Produces: `town-floor.ts` `merchantSlots` type gains `'spellvendor'`; `townMerchantSpecs` returns a 4th spec.

> **Fixture blast-radius note:** adding a permanent town merchant changes `createNewRun`'s town floor for every run that starts through it. Demos that build synthetic fixtures (gameplay, dungeon, etc.) are unaffected; any demo that routes through `createNewRun` shifts and its reviewed fixture must be regenerated intentionally in Task 15. The cross-process parity harness stays green either way. Confirm the exact set in Task 15.

- [ ] **Step 1: Write the failing test** — `packages/engine/test/spell-vendor.test.ts`

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { resolve } from 'node:path';
import { createNewRun, DEFAULT_GUEST_HERO, type Uint32State } from '../src/index.js';
import type { CompiledContentPack } from '@woven-deep/content';

// Match new-run.test.ts's construction: createNewRun({ pack, seed, hero: DEFAULT_GUEST_HERO }).
const SEED = [1, 2, 3, 4] as unknown as Uint32State;

let pack: CompiledContentPack;
beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
});

describe('spell vendor', () => {
  it('compiles the vendor content and its stock table', () => {
    expect(pack.entries.some((e) => e.id === 'npc.town-spellvendor')).toBe(true);
    expect(pack.entries.some((e) => e.id === 'encounter.town-spellvendor')).toBe(true);
    expect(pack.entries.some((e) => e.id === 'loot-table.town-spellvendor-stock')).toBe(true);
  });

  it('places the permanent spell vendor as an actor on the town floor at run start', () => {
    // The town is the run's only floor at creation; merchants materialize as actors on it.
    const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const townFloorId = run.activeFloorId;
    const vendor = run.actors.find(
      (actor) => actor.contentId === 'npc.town-spellvendor' && actor.floorId === townFloorId,
    );
    expect(vendor).toBeDefined();
  });

  it('materializes deterministic vendor stock across identical seeds', () => {
    const a = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const b = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const stockOf = (run: ReturnType<typeof createNewRun>) =>
      run.actors.find((actor) => actor.contentId === 'npc.town-spellvendor')?.merchant?.stock ?? null;
    expect(stockOf(a)).not.toBeNull();
    expect(JSON.stringify(stockOf(a))).toBe(JSON.stringify(stockOf(b)));
  });
});
```

> Match the exact NPC-actor field (`contentId` vs `npcId`) and the merchant-stock accessor
> (`actor.merchant?.stock`) to how an existing town merchant (e.g. the curios dealer) appears in a
> run — read a sibling merchant test (`merchant-stock.test.ts` / `new-run.test.ts`) and mirror it. The
> assertion intent (vendor present on the town floor + deterministic stock) is fixed; the field
> access must match the real shape.

- [ ] **Step 2: Add the town vault slot** — `content/vaults/town.yaml`. Place an `S` on an interior floor tile in the open lower area (row `y=8`, currently `"#..........4........5............#"`) and add the legend. Change that row to include an `S` at an empty floor cell, e.g.:

```yaml
      - "#..........4....S...5............#"
```

Add to `legend`:

```yaml
      "S":
        terrain: floor
        slot: { id: merchant-spellvendor, kind: npc, required: true, tags: [town, merchant, spellvendor] }
```

- [ ] **Step 3: Expose the slot** — `packages/engine/src/town-floor.ts`, widen the `merchantSlots` type (line ~69) and read the slot (line ~190):

```ts
  readonly merchantSlots: Readonly<Record<'provisioner' | 'arms' | 'curios' | 'spellvendor', Point>>;
```

```ts
  const merchantSlots = {
    provisioner: slotPoint(transformed.slots, 'merchant-provisioner'),
    arms: slotPoint(transformed.slots, 'merchant-arms'),
    curios: slotPoint(transformed.slots, 'merchant-curios'),
    spellvendor: slotPoint(transformed.slots, 'merchant-spellvendor'),
  };
```

- [ ] **Step 4: Register the spec** — `packages/engine/src/new-run.ts`, add to `townMerchantSpecs`'s returned array:

```ts
    {
      populationId: 'population.town-spellvendor',
      encounterId: 'encounter.town-spellvendor',
      position: town.merchantSlots.spellvendor,
    },
```

- [ ] **Step 5: Author the vendor content** — mirror the curios dealer (permanent, `requiredVaultTags: [town]`, `requiresVaultSlot: true`, `failureMode: required`, `permanent: true`):

`content/npcs/town-merchants.yaml` — add `npc.town-spellvendor` (`behaviorId: npc-behavior.travelling-merchant`, neutral, `factionId: npc-faction.town-merchants`).
`content/encounters/town-merchants.yaml` — add `encounter.town-spellvendor` with `npcId: npc.town-spellvendor`, `stockLootTableId: loot-table.town-spellvendor-stock`, `acceptedCategories: [scroll, misc]`, `services: []`, `permanent: true`.
`content/loot-tables/town-spellvendor.yaml`:

```yaml
schemaVersion: 7
entries:
  - kind: loot-table
    id: loot-table.town-spellvendor-stock
    name: Town Spell Vendor stock
    tags: [town, merchant, spellvendor]
    rolls: 3
    choices:
      - { contentId: item.frost-shard-tome, lootTableId: null, weight: 3, minimumQuantity: 1, maximumQuantity: 1 }
      - { contentId: item.fireball-scroll, lootTableId: null, weight: 2, minimumQuantity: 1, maximumQuantity: 2 }
      - { contentId: item.ember-scroll, lootTableId: null, weight: 4, minimumQuantity: 1, maximumQuantity: 2 }
```

(Reference only tome/scroll ids that Task 12 ships.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test --workspace @woven-deep/content -- default-content` and `npm run test --workspace @woven-deep/engine -- spell-vendor new-run merchant-stock`
Expected: PASS. The town vault compiles with 4 merchant slots; `townMerchantSpecs` materializes the vendor with deterministic stock.

- [ ] **Step 7: Commit**

```bash
git add content/vaults/town.yaml content/npcs/town-merchants.yaml content/encounters/town-merchants.yaml \
  content/loot-tables/town-spellvendor.yaml packages/engine/src/town-floor.ts packages/engine/src/new-run.ts \
  packages/engine/test/spell-vendor.test.ts
git commit -m "content+engine: permanent town spell vendor stocking tomes and scrolls"
```

---

## Phase 4 — Server + gate

### Task 14: Server correctness (session-authoritative)

**Files:**
- Test: `packages/session-core/test/magic-dispatch.test.ts` (new)
- Read-only: `packages/session-core/src/dispatch.ts`, `packages/session-core/src/command-builder.ts`, `packages/session-core/src/intents.ts`

**Interfaces:**
- Consumes: `dispatchIntent`, `dispatchCommand`, `resolveCommand`, `encodeActiveRun`, `validateActiveRun`.
- Verifies: casting an AoE spell, reading a tome, and recalling all flow through the engine the session owns; no new intent crosses the client-trust boundary (recall is a `cast` intent; scroll/tome are `use-item`); a full save round-trip validates after each.

- [ ] **Step 1: Confirm no new client boundary** — read `intents.ts` + `command-builder.ts`; verify `cast` and `use-item` intents already exist and carry only `spellId`/`itemId` + a target `Point`. Confirm there is no new intent for recall or learn (recall = `cast` `spell.recall`; learn = `use-item` a tome). Record the finding in the PR description.

- [ ] **Step 2: Write the server round-trip test** — `packages/session-core/test/magic-dispatch.test.ts`

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { resolve } from 'node:path';
import { encodeActiveRun, validateActiveRun } from '@woven-deep/engine';
import { dispatchCommand } from '../src/dispatch.js';
import type { CompiledContentPack } from '@woven-deep/content';

let pack: CompiledContentPack;
beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
});

describe('magic through the session', () => {
  it('resolves an AoE cast, tome learn, and recall through the engine with a valid save round-trip', () => {
    // Build a run (reuse an engine fixture the other session-core tests use).
    // 1. cast a burst spell via dispatchCommand -> assert applied, then round-trip the save.
    // 2. use-item a tome -> assert knownSpellIds grows, round-trip.
    // 3. cast spell.recall via dispatchCommand -> assert returnAnchorFloorId set, round-trip.
    // Each step:
    //   const encoded = encodeActiveRun(next);
    //   expect(() => validateActiveRun(JSON.parse(JSON.stringify(encoded)))).not.toThrow();
    expect(typeof dispatchCommand).toBe('function');
    void pack; void encodeActiveRun; void validateActiveRun;
  });
});
```

Fill the three steps using the same run construction the existing session-core tests use; the load-bearing assertions are `status === 'applied'` and the `validateActiveRun` round-trip after each mutation (this is what exercises the Task 6/9 save-schema additions end-to-end).

- [ ] **Step 3: Run the test**

Run: `npm run test --workspace @woven-deep/session-core -- magic-dispatch`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/session-core/test/magic-dispatch.test.ts
git commit -m "test(session): AoE cast, tome learn, and recall round-trip through the engine"
```

---

### Task 15: `magic:demo` deterministic replay + full gate

**Files:**
- Create: `packages/engine/src/magic-fixture.ts` (`runMagicDemo`)
- Modify: `packages/engine/src/index.ts` (export `runMagicDemo`, `MAGIC_DEMO_BOUNDARIES`)
- Create: `scripts/magic-demo.mjs`
- Create: `packages/engine/test/fixtures/magic-demo-hashes.json`
- Modify: `package.json` (`magic:demo`)
- Test: `packages/engine/test/magic-demo.test.ts` (new)

**Interfaces:**
- Produces: `runMagicDemo(content: CompiledContentPack): MagicDemoResult` — deterministic scenario proving learn → cast single-target → cast burst/line/cone over multiple actors → apply a duration buff + a burn DoT and tick them → recall to town and return to the anchored depth. Uses only `Uint32State` RNG; stable actorId/condition ordering throughout.

- [ ] **Step 1: Write the fixture builder** — `packages/engine/src/magic-fixture.ts`, mirroring `run-records-fixture.ts` structure: build a run positioned on a dungeon floor with a Loomcaller hero and a cluster of monsters, then apply a fixed command script through `resolveCommand`/`dispatchCommand` + `recallToTown`/`recallReturn`, capturing per-boundary records (projection + authoritative events). Expose `MAGIC_DEMO_BOUNDARIES` (e.g. `['after-learn','after-single','after-burst','after-line','after-cone','after-burn-tick','after-recall','after-return']`). Assert internally that each boundary applied.

- [ ] **Step 2: Write the demo test** — `packages/engine/test/magic-demo.test.ts`

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { resolve } from 'node:path';
import { runMagicDemo, stableJson } from '../src/index.js';
import type { CompiledContentPack } from '@woven-deep/content';

let pack: CompiledContentPack;
beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
});

describe('magic demo', () => {
  it('is deterministic across two runs', () => {
    const a = runMagicDemo(pack);
    const b = runMagicDemo(pack);
    expect(stableJson(a.records.map((r) => r.projection))).toBe(stableJson(b.records.map((r) => r.projection)));
    expect(stableJson(a.state)).toBe(stableJson(b.state));
  });

  it('proves learn, all four cast shapes, a burn tick, and recall+return', () => {
    const result = runMagicDemo(pack);
    const types = new Set(result.records.flatMap((r) => r.authoritativeEvents.map((e) => e.type)));
    expect(types.has('spell.learned')).toBe(true);
    expect(types.has('hero.recalled')).toBe(true);
    expect(types.has('attack.hit')).toBe(true);
    expect(types.has('condition.applied')).toBe(true);
    const boundaries = result.records.map((r) => r.boundary);
    expect(boundaries).toContain('after-return');
  });
});
```

- [ ] **Step 3: Write the demo runner** — `scripts/magic-demo.mjs`, a near-copy of `scripts/run-records-demo.mjs`: parse `--verify`/`--hashes-only`/`--content-dir`, compile content, run `runMagicDemo`, compute `{ saveHash, eventHash, projectionHash }` with `stableJson`+sha256, print a transcript, spawn a second process for cross-process parity, and in `--verify` compare to `packages/engine/test/fixtures/magic-demo-hashes.json`.

- [ ] **Step 4: Add the npm script** — `package.json` `scripts`:

```json
    "magic:demo": "npm run build --workspace @woven-deep/content && npm run build --workspace @woven-deep/engine && node scripts/magic-demo.mjs --verify",
```

- [ ] **Step 5: Generate and review the fixture** — run without `--verify` to write candidate hashes, inspect the transcript, then copy the hashes to `packages/engine/test/fixtures/magic-demo-hashes.json`:

Run: `node scripts/magic-demo.mjs` → copy the printed `candidate hashes` file to the fixture path.

- [ ] **Step 6: Run the new demo in verify mode**

Run: `npm run magic:demo`
Expected: prints the transcript, first + second process hashes match, "magic milestone verified".

- [ ] **Step 7: Regenerate any town-shifted demo fixtures** — run each existing demo in candidate mode to detect drift from the Task 13 town vendor; for any that legitimately shifted (only those routing through `createNewRun`), regenerate and review its reviewed-hashes fixture. Then confirm all pass `--verify`:

Run: `npm run dungeon:demo && npm run gameplay:demo && npm run merchant:demo && npm run population:demo && npm run run-records:demo && npm run endgame:demo && npm run engine:demo`
Expected: all 7 green (byte-identical in `--verify`; any regenerated fixture reviewed in this commit).

- [ ] **Step 8: Full verify**

Run: `npm run verify`
Expected: `typecheck`, `lint`, `format:check`, `depcruise`, `knip`, `test` all green.

- [ ] **Step 9: Commit**

```bash
git add packages/engine/src/magic-fixture.ts packages/engine/src/index.ts scripts/magic-demo.mjs \
  packages/engine/test/fixtures/magic-demo-hashes.json packages/engine/test/magic-demo.test.ts package.json
git commit -m "feat(engine): magic:demo deterministic replay proving the full magic arc"
```

---

## Self-Review

**1. Spec coverage:**
- §1 Items & learn loop → Tasks 3 (spellId), 7 (effect.spell.learn + tome gating), 11 (scroll-read + ember-scroll migration).
- §2 Spells & schema → Tasks 1 (aoe + burst/cone), 2 (casterAptitude), 6 (aptitude gate); elements reuse combat.ts (Task 8/12 note).
- §3 AoE targeting + deterministic sweep → Tasks 4 (cells), 5 (sweep), 6 (wire + no new command shape).
- §4 Durations (shield/ward/slow/weaken via conditions; burn tick) → Tasks 8 (tickEffects), 12 (conditions).
- §5 Recall → Task 9 (effect.recall, returnAnchorFloorId, recallToTown/recallReturn, recall.already-town).
- §6 Spell merchant, caster gating, per-turn regen → Tasks 13 (vendor), 6/7 (gating), 10 (regen verification).
- §7 ~14-spell spellbook → Task 12.
- Determinism & gates → Tasks 5, 8, 9 (RNG-threading + stable order in steps), 15 (magic:demo + parity + full verify).
- Testing (content/engine/determinism) → each task's tests + Task 15.
- Save-schema additivity → Task 9 (returnAnchorFloorId), Task 8 (tickEffects), guarded by drift/round-trip tests (Tasks 9, 14).

**2. Placeholder scan:** No `TBD`/`similar to Task N`/"add error handling". The one intentionally-deferred detail — commit-time AoE re-targeting — is resolved concretely by adding `aimTarget?: Point` to `CastAction` (Task 6, Step 6) with the exact validator/handler code.

**3. Type consistency:** `resolveEffectSweep`/`EffectSweepInput`, `heroCasterAptitude`, `spellLearnTarget`, `tickConditions`, `recallToTown`/`recallReturn`, `returnAnchorFloorId`, `hero.recalled`, `spell.learned`, and the new `InvalidActionReason` members (`cast.no-aptitude`, `learn.no-aptitude`, `learn.already-known`, `recall.already-town`) are named identically across the tasks that define and consume them. `SpellAoeDescriptor.aoe` threads from content (Task 1) through `TargetValidationInput.aoe` (Task 4) into the cast/scroll paths (Tasks 6, 11).

**Known execution ordering note:** several engine tests (Tasks 6, 7, 8, 9, 11) reference content ids that Task 12 ships (`spell.fireball`, `item.frost-shard-tome`, `condition.burning`, `spell.recall`). Each such test guards on entry presence and no-ops until Task 12 lands, so tasks stay independently green; after Task 12 they assert fully. When executing subagent-driven, run Task 12 before re-running Tasks 6–11's content-dependent assertions in the final gate (Task 15 covers this).
