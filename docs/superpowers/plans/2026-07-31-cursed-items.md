# Cursed Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Some generated equipment is cursed — a passive drawback, a triggered sting, or both — welded on when equipped unidentified, with identification as counter-play and remove-curse (merchant service + rare scroll) as relief.

**Architecture:** A new closed content kind `curse` (content v11→v12) authored under `content/curses/`. Curse identity rides on `ItemInstance.curse` (save v13→v14), rolled once per eligible generated item on the loot stream that created it. Drawbacks apply on the **enchantment-side** path in `equipmentModifiers` so they never leak through `publicModifiers` before reveal. Equipping reveals and welds (new `item.cursed` failure reason on both unequip paths); a pure post-pass in `resolveCommand`'s world branch scans the command's emitted `DomainEvent`s once and fires matching triggers through the ordinary effect machinery. Relief is a third merchant service plus a new `effect.curse.remove` scroll.

**Tech Stack:** TypeScript 5.8 ESM, Zod strict schemas, Vitest 3.2, npm workspaces (`@woven-deep/content`, `@woven-deep/engine`, `@woven-deep/web`, `@woven-deep/server`).

**Spec:** `docs/superpowers/specs/2026-07-31-cursed-items-design.md` — read it before starting any task. It is the requirements; this plan is the route.

## Global Constraints

Every task's requirements implicitly include this section.

- **No floats. Checked integer arithmetic only.** Every bps comparison, cap, and half-health crossing uses safe integers and explicit `Number.isSafeInteger` guards. Never `value / 2` — compare `2 * health < maxHealth`. Never `Math.round`/`Math.floor` on a curse computation.
- **Named RNG streams only.** No `Math.random`, no `Date.now`, no clocks. Curse generation rolls draw from the loot stream the creating call site already threads (`loot-placement` for floor scatter and vault item slots; `loot` for chest contents and population rewards) — **no new stream is introduced**. Trigger chance rolls and trigger effect resolution draw from `effects`. Zero eligible items ⇒ zero draws.
- **Hidden fields are never projected.** Until `curse.revealed === true`, an unidentified cursed item must project exactly as an unidentified clean one — `unknownProperties: true` and nothing more. `projectItem` never emits curse name, `revealText`, or `drawbackModifiers` for an unrevealed curse; `publicModifiers` never carries curse drawbacks for an unidentified item.
- **No hard gates ([[design-principle-no-hard-gates]]).** Curse effects must never mutate terrain, doors, keys, stairs, or any win-path mechanic. Enforced structurally: `CURSE_TRIGGER_EFFECT_IDS` is a compile-time allowlist that excludes `effect.feature.mutate`, `effect.recall`, `effect.reveal`, `effect.light.toggle`, `effect.fuel.transfer`, `effect.item.consume`, `effect.spell.learn`, and `effect.curse.remove`. The descent-lock-free invariant suite stays green by construction.
- **Two schema bumps, no more.** Content v11→v12 in Task 1 (with a migration note in `docs/server-admin/content-configuration.md` — the versioned-note admin-docs test enforces it). Save v13→v14 in Task 3 (freeze `legacyActiveRunV13Schema` FIRST, then bump `SAVE_SCHEMA_VERSION`, then add exactly one ordered migration). No other task touches a schema version.
- **Demo hashes drift from Task 1 onward** (the content hash changes with v12). Do NOT re-pin mid-plan. Demo/CLI suites are expected-red from Task 1 to Task 13, which re-pins ONCE with per-fixture attribution. Per-task gates run targeted non-demo suites only. **An unexplained delta is a STOP — report BLOCKED, never re-pin over it.**
- **Build gotcha:** demo scripts and CLI tests import `packages/engine/dist`, and workspace-scoped vitest does NOT rebuild it. Before any demo/CLI run: `npm run build --workspace @woven-deep/content && npm run build --workspace @woven-deep/engine`.
- **Determinism is the product.** Continuous play and split save/reload replay must stay byte-identical (`encodeActiveRun` equality) with cursed items equipped.
- **GitNexus:** run `impact({target, direction: "upstream"})` before modifying any existing symbol and report the blast radius; run `detect_changes()` before every commit.
- **Prettier** every touched file. **Commits:** conventional, lowercase, no scope (`feat:`, `fix:`, `test:`, `docs:`, `chore:`). **TDD is RED-first** everywhere: write the failing test, run it, watch it fail, then implement.
- **CI budget:** the vitest worker heartbeat tolerates roughly 60s of blocked synchronous work per FILE on the 2-core runner. Keep any new statistical/property suite well under that; cap `fast-check` `numRuns` the way `gameplay-properties.test.ts:83-95` does.
- Branch: `feat/cursed-items`. Do not push until Task 13.

## Spec clarifications recorded here (amend-before-deviating)

Each was an under-specification found while mapping the spec onto the code. Task 13 amends the spec document with these.

1. **`trigger.effectId` is authored as a full effect block, not a bare id.** `resolveEffectSequence` requires an `EffectDefinition` (`{ effectId, parameters, requiresLivingTarget }`) with schema-validated parameters — a bare id is unresolvable. The trigger authors `effect:` using the shared `effect` schema from `packages/content/src/compiler/schema/common.ts:98`. The spec's example id `effect.weave.drain` does not exist in `EFFECT_IDS`; authored curses use real members of the allowlist.
2. **Curse rolls draw from the loot stream of the creating call site, not exclusively `loot-placement`.** Item creation spans two existing loot streams (`loot-placement` for floor scatter and vault item slots; `loot` for chest contents and population rewards). One shared helper threads whichever `Uint32State` its caller owns. Using `loot-placement` at chest-open time would couple world generation to player action ordering — a determinism hazard, not a determinism win. No new stream.
3. **Merchant stock is excluded from curse rolls.** Merchants refuse to buy revealed cursed items; selling them is the mirror-image exploit and the spec is silent. Restock stays clean.
4. **Dropping an equipped cursed item needs no new code.** `dropItem` (`packages/engine/src/inventory.ts:743`) already rejects anything not in the backpack with `item.unavailable`. Task 6 adds a regression test rather than a branch.
5. **The trigger post-pass runs BEFORE the conclusion boundary.** A curse trigger that kills the hero must conclude the run in the same transition, so the post-pass folds its events into `world.events` ahead of `concludeRunOnHeroDeath`. It is skipped when the run is already concluded or the hero's health is already 0 in `world.state` — which is the spec's "concluded runs never trigger", stated in terms the reducer can enforce.
6. **`effect.curse.remove` targets deterministically, not by command argument.** `use-item` carries no `targetItemId` (`commands-model.ts:40-43`), and existing item-targeted effects (`effect.fuel.transfer`, `boss-behavior.ts:245`) select from the actor's owned items sorted by `compareCodeUnits`. The scroll follows that pattern: first revealed cursed item by `itemId` order.
7. **Enchantment generation does not exist yet in shipping content** — `enchantment` is `null` at every creation site. The spec's "enchanted items roll at 2x" is implemented and tested exactly as written; it simply has no live trigger until enchantment generation ships. Not a blocker.
8. **The command schema literal is already an enum.** `commands.ts:123` uses `merchantServiceId`, not `z.literal(...)`; only the two `MERCHANT_SERVICE_IDS` copies and `primitives.ts:44` need the third member.

## File Map

| Unit | Files | Responsibility |
| --- | --- | --- |
| Curse content kind | `packages/content/src/model/curse.ts` (NEW), `model/common.ts`, `compiler/schema/curse.ts` (NEW), `compiler/schema.ts`, `compiler/schema/item.ts`, `compiler/schema/balance.ts`, `model/balance.ts` | v12 schema, closed vocabularies, artifact drawback-key validation (Task 1) |
| Curse roster | `content/curses/core-curses.yaml` (NEW), `content/balance/core-gameplay.yaml`, `content/items/*.yaml` | authored curses, balance knobs, `identification.mode: instance` sweep (Task 2) |
| Save v14 | `packages/engine/src/{versions.ts, item-model.ts, population-model.ts, save-schema/item.ts, save-schema/population.ts, save-schema/migrations.ts, save-codec.ts, content-bound-validation.ts}` | `ItemInstance.curse`, heirloom snapshot field, one ordered migration (Task 3) |
| Generation | `packages/engine/src/curse-generation.ts` (NEW), `loot-placement.ts`, `population-placement.ts`, `features.ts`, `inventory.ts` | banded roll, uniform identity draw (Task 4) |
| Modifiers | `packages/engine/src/equipment.ts:171-208` | enchantment-side drawback fold (Task 5) |
| Sticky + reveal | `packages/engine/src/{equipment.ts, curse.ts (NEW), events-model.ts, event-projection.ts, commands-model.ts, action-dispatch.ts, save-schema/primitives.ts}` | `item.cursed`, `curse.revealed` (Task 6) |
| Floor entry event | `packages/engine/src/{floor-transition.ts, events-model.ts, event-projection.ts}` | `floor.entered` DomainEvent (Task 7) |
| Triggers | `packages/engine/src/{curse-triggers.ts (NEW), reducer.ts}` | pure post-pass over emitted events (Task 8) |
| Remove-curse service | `packages/content/src/model/common.ts`, `compiler/registries.ts`, `compiler/schema/encounter.ts`, `packages/engine/src/{save-schema/primitives.ts, trade.ts, projection.ts, commerce.ts}`, `content/encounters/town-merchants.yaml` | third service, per-service target lists (Task 9) |
| Scroll | `packages/content/src/{model/common.ts, compiler/registries.ts}`, `packages/engine/src/effects.ts`, `content/items/sundering-scroll.yaml` (NEW), `content/loot-tables/*` | `effect.curse.remove` (Task 10) |
| Heirloom + champion | `packages/engine/src/{heirloom-selection.ts, inventory.ts}` | curse travels with the heirloom (Task 11) |
| Client | `apps/web/src/session/event-log.ts`, `apps/web/src/ui/{overlays/, screens/TradeScreen.tsx, panels.tsx}` | log line, item sheet, slot marker (Task 12) |
| Endgame | fixtures, `docs/server-admin/content-configuration.md`, the spec | re-pin, root gate, PR (Task 13) |

---

### Task 1: Content v12 — the `curse` kind

**Files:**
- Create: `packages/content/src/model/curse.ts`, `packages/content/src/compiler/schema/curse.ts`
- Modify: `packages/content/src/model/common.ts:20` (`CONTENT_SCHEMA_VERSION = 12`), `:22-40` (`CONTENT_KIND_IDS` + `'curse'`), the `ContentEntry` union, `packages/content/src/compiler/schema.ts:36-46` (add `curseEntry` to `contentSourceEntrySchema`), `packages/content/src/index.ts` (re-export the new model types), `packages/content/src/compiler/schema/item.ts:61-66` (artifact `drawbackModifiers` key validation)
- Modify: every `schemaVersion: 11` YAML envelope → 12 (sed sweep across `content/`), `docs/server-admin/content-configuration.md` (curse kind reference + v12 migration note)
- Test: `packages/content/test/parse-file.test.ts` and the validation suite (follow their existing case style)

**Interfaces — Produces (later tasks import these verbatim):**

```ts
// packages/content/src/model/curse.ts
import type { BaseContentEntry, EffectDefinition, EffectId } from './common.js';

export const CURSE_TRIGGER_EVENTS = ['on-kill', 'on-hurt-below-half', 'on-floor-enter'] as const;
export type CurseTriggerEvent = (typeof CURSE_TRIGGER_EVENTS)[number];

/**
 * Effects a curse trigger may fire. Deliberately excludes every effect that can touch terrain,
 * features, traversal, or item inventories — a curse must never gate the win path.
 */
export const CURSE_TRIGGER_EFFECT_IDS = [
  'effect.damage',
  'effect.heal',
  'effect.condition.apply',
  'effect.condition.remove',
  'effect.force-move',
  'effect.hunger.restore',
] as const satisfies readonly EffectId[];
export type CurseTriggerEffectId = (typeof CURSE_TRIGGER_EFFECT_IDS)[number];

export const CURSE_CHANCE_BPS_DEFAULT = 10000;

export interface CurseTriggerDefinition {
  readonly on: CurseTriggerEvent;
  readonly effect: EffectDefinition;
  readonly chanceBps: number; // 1..10000
}

export interface CurseContentEntry extends BaseContentEntry {
  readonly kind: 'curse';
  readonly revealText: string;
  readonly drawbackModifiers: Readonly<Record<string, number>>; // DerivedStatName keys, values < 0
  readonly trigger: CurseTriggerDefinition | null;
}
```

Add to `packages/content/src/model/common.ts`: `'curse'` in `CONTENT_KIND_IDS` and `CurseContentEntry` in the `ContentEntry` union, plus `export type * from './curse.js'` wherever the package re-exports sibling models (mirror how `identification-pool.js` is re-exported).

- [ ] **Step 1: Write the failing tests**

Add to the content parse/validation suite:

```ts
it('compiles a curse with drawbacks and a trigger', async () => {
  const pack = await compileSource(`
schemaVersion: 12
entries:
  - kind: curse
    id: curse.hungering-edge
    name: Hungering Edge
    tags: [curse]
    revealText: "The blade drinks deep — and will not let go."
    drawbackModifiers: { maxHealth: -3 }
    trigger:
      on: on-kill
      chanceBps: 5000
      effect:
        effectId: effect.damage
        parameters: { damageType: arcane, dice: { count: 1, sides: 3, bonus: 0 } }
`);
  const entry = pack.entries.find((candidate) => candidate.id === 'curse.hungering-edge');
  expect(entry).toMatchObject({
    kind: 'curse',
    revealText: 'The blade drinks deep — and will not let go.',
    drawbackModifiers: { maxHealth: -3 },
    trigger: { on: 'on-kill', chanceBps: 5000 },
  });
});

it('defaults an omitted chanceBps to always', async () => {
  const pack = await compileSource(curseSource({ chanceBps: undefined }));
  const entry = pack.entries.find((candidate) => candidate.kind === 'curse');
  expect(entry).toMatchObject({ trigger: { chanceBps: 10000 } });
});

it('rejects an unknown trigger vocabulary member', async () => {
  await expect(compileSource(curseSource({ on: 'on-sneeze' }))).rejects.toThrow(/on/);
});

it('rejects a trigger effect outside the curse allowlist', async () => {
  await expect(
    compileSource(curseSource({ effectId: 'effect.feature.mutate' })),
  ).rejects.toThrow(/effect.feature.mutate/);
});

it('rejects an unknown derived stat key in drawbackModifiers', async () => {
  await expect(compileSource(curseSource({ drawbackModifiers: { luck: -1 } }))).rejects.toThrow(
    /luck/,
  );
});

it('rejects a non-negative drawback value', async () => {
  await expect(
    compileSource(curseSource({ drawbackModifiers: { defense: 1 } })),
  ).rejects.toThrow(/negative/);
});

it('rejects a curse with neither drawbacks nor a trigger', async () => {
  await expect(
    compileSource(curseSource({ drawbackModifiers: {}, trigger: null })),
  ).rejects.toThrow(/drawbackModifiers or trigger/);
});

it('rejects a positive value in an artifact drawbackModifiers block', async () => {
  await expect(compileSource(artifactSource({ drawbackModifiers: { defense: 1 } }))).rejects.toThrow(
    /negative/,
  );
});

it('rejects an unknown derived stat key in an artifact drawbackModifiers block', async () => {
  await expect(compileSource(artifactSource({ drawbackModifiers: { luck: -1 } }))).rejects.toThrow(
    /luck/,
  );
});
```

Write `curseSource(overrides)` and `artifactSource(overrides)` as local helpers in the test file that emit the YAML envelope above with the named field replaced (the artifact helper emits a legendary item with an `artifact` block; copy the shape from `content/items/artifacts.yaml`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace @woven-deep/content`
Expected: FAIL — `kind: curse` is not a member of the discriminated union, and the artifact cases pass no validation.

- [ ] **Step 3: Write the implementation**

`packages/content/src/compiler/schema/curse.ts`:

```ts
import { z } from 'zod';
import { CURSE_TRIGGER_EFFECT_IDS, CURSE_TRIGGER_EVENTS } from '../../model/curse.js';
import { DERIVED_STAT_NAMES } from '../../model/common.js';
import { base, effect } from './common.js';

const negativeDerivedStatModifiers = z
  .record(z.enum(DERIVED_STAT_NAMES), z.number().int().safe().negative())
  .refine((value) => Object.values(value).every((amount) => amount < 0), {
    message: 'drawback modifier values must be negative safe integers',
  });

const curseTrigger = z.strictObject({
  on: z.enum(CURSE_TRIGGER_EVENTS),
  effect: effect.refine(
    (value) => (CURSE_TRIGGER_EFFECT_IDS as readonly string[]).includes(value.effectId),
    (value) => ({
      message:
        `curse trigger effect ${value.effectId} is not in the curse allowlist; ` +
        'curses may never mutate terrain, features, or traversal',
    }),
  ),
  chanceBps: z.number().int().safe().min(1).max(10000).default(10000),
});

export const curseEntry = z
  .strictObject({
    ...base,
    kind: z.literal('curse'),
    revealText: z.string().trim().min(1).max(300),
    drawbackModifiers: negativeDerivedStatModifiers.default({}),
    trigger: curseTrigger.nullable().default(null),
  })
  .superRefine((entry, context) => {
    if (Object.keys(entry.drawbackModifiers).length === 0 && entry.trigger === null) {
      context.addIssue({
        code: 'custom',
        path: ['drawbackModifiers'],
        message: 'a curse must declare drawbackModifiers or trigger, or both',
      });
    }
  });
```

In `packages/content/src/compiler/schema/item.ts:61-66`, replace the artifact block's `drawbackModifiers: z.record(z.string(), safeInteger)` with `negativeDerivedStatModifiers` (export it from `schema/curse.ts` and import, or lift it into `schema/common.ts` — pick one and use it in both places; do not duplicate the literal).

Wire `curseEntry` into `contentSourceEntrySchema` (`compiler/schema.ts:36-46`), add `'curse'` to `CONTENT_KIND_IDS`, add `CurseContentEntry` to the `ContentEntry` union, set `CONTENT_SCHEMA_VERSION = 12`, sweep every `schemaVersion: 11` envelope in `content/` to 12, and add the v12 migration note to `docs/server-admin/content-configuration.md` ("v12 adds the `curse` content kind and enforces DERIVED_STAT_NAMES keys with negative values on artifact `drawbackModifiers`").

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace @woven-deep/content && npm run content:validate && npm run typecheck`
Expected: PASS. Engine demo suites are now expected-red (content hash drift) — that is the plan's Task 13 debt, not a failure.

- [ ] **Step 5: Commit**

```bash
git add packages/content docs/server-admin/content-configuration.md content
git commit -m "feat: content schema v12 with the curse kind"
```

---

### Task 2: Curse roster, balance knobs, and the identification sweep

**Files:**
- Create: `content/curses/core-curses.yaml`
- Modify: `content/balance/core-gameplay.yaml` (new `curses` block), `packages/content/src/compiler/schema/balance.ts:69-95` (zod), `packages/content/src/model/balance.ts` (TS mirror), plus every duplicated balance literal (find them with `grep -rn "encounterDensity" packages apps`)
- Modify: `content/items/*.yaml` for base equipment in `weapon`, `armor`, `shield`, `ring`, `light` — set `identification: { mode: instance, poolId: <pool or null> }`. Items carrying an `artifact` block stay `mode: known`.
- Test: content validation suite; a new engine test asserting the eligible-category set resolves to a non-empty item list

**Interfaces — Produces:**

```ts
// packages/content/src/model/balance.ts — BalanceContentEntry gains:
readonly curses: Readonly<{
  readonly chanceBps: Readonly<{ shallow: number; mid: number; deep: number }>;
  readonly enchantedMultiplierBps: number;
  readonly capBps: number;
}>;
```

Curse ids produced for later tasks: `curse.hungering-edge`, `curse.leaden-weight`, `curse.cold-tether`, `curse.hollow-step`, `curse.gnawing-want`.

- [ ] **Step 1: Author the balance knobs and the roster**

In `content/balance/core-gameplay.yaml`, beside `encounterDensity`:

```yaml
    curses:
      chanceBps: { shallow: 1000, mid: 2000, deep: 3500 }
      enchantedMultiplierBps: 20000
      capBps: 5000
```

Zod in `packages/content/src/compiler/schema/balance.ts` (inside the same `strictObject` that holds `encounterDensity`):

```ts
    curses: z.strictObject({
      chanceBps: z.strictObject({
        shallow: z.number().int().safe().min(0).max(10000),
        mid: z.number().int().safe().min(0).max(10000),
        deep: z.number().int().safe().min(0).max(10000),
      }),
      enchantedMultiplierBps: z.number().int().safe().min(10000).max(100000),
      capBps: z.number().int().safe().min(0).max(10000),
    }),
```

`content/curses/core-curses.yaml`:

```yaml
schemaVersion: 12
entries:
  - kind: curse
    id: curse.hungering-edge
    name: Hungering Edge
    tags: [curse, weapon]
    revealText: "The blade drinks deep — and will not let go."
    drawbackModifiers: { maxHealth: -3 }
    trigger:
      on: on-kill
      chanceBps: 5000
      effect:
        effectId: effect.damage
        parameters: { damageType: arcane, dice: { count: 1, sides: 3, bonus: 0 } }

  - kind: curse
    id: curse.leaden-weight
    name: Leaden Weight
    tags: [curse, armor]
    revealText: "It settles onto you like wet earth, and does not lift."
    drawbackModifiers: { defense: -1, meleeAccuracy: -1 }
    trigger: null

  - kind: curse
    id: curse.cold-tether
    name: Cold Tether
    tags: [curse, ring]
    revealText: "Something on the other end of it pulls, once, and waits."
    drawbackModifiers: { maxWeave: -2 }
    trigger:
      on: on-floor-enter
      chanceBps: 3000
      effect:
        effectId: effect.condition.apply
        parameters: { conditionId: condition.chilled, duration: 300 }

  - kind: curse
    id: curse.hollow-step
    name: Hollow Step
    tags: [curse, light]
    revealText: "Your own shadow arrives a moment after you do."
    drawbackModifiers: { lightOutRevealRadius: -1 }
    trigger:
      on: on-hurt-below-half
      chanceBps: 10000
      effect:
        effectId: effect.force-move
        parameters: { distance: 1 }

  - kind: curse
    id: curse.gnawing-want
    name: Gnawing Want
    tags: [curse, ring]
    revealText: "A hunger that is not yours takes up residence behind your ribs."
    drawbackModifiers: { search: -1 }
    trigger:
      on: on-floor-enter
      chanceBps: 10000
      effect:
        effectId: effect.damage
        parameters: { damageType: physical, dice: { count: 1, sides: 2, bonus: 0 } }
```

`condition.chilled` must exist in `content/conditions/` — check first with `grep -rn "id: condition\." content/conditions/` and substitute a real condition id if it does not.

- [ ] **Step 2: Sweep the identification modes**

For every item YAML whose `category` is `weapon`, `armor`, `shield`, `ring`, or `light` AND whose `artifact` is `null`, set `identification: { mode: instance, poolId: null }`. Leave consumables, keys, currency, fragments, and artifacts untouched. Verify no item is left with `mode: instance` and a `poolId` naming a pool whose `category` disagrees (the existing pool validator will say so).

- [ ] **Step 3: Run validation**

Run: `npm run content:validate && npm run test --workspace @woven-deep/content && npm run typecheck`
Expected: PASS (update any bundled entry-count fixture by the number of new entries).

- [ ] **Step 4: Commit**

```bash
git add content packages/content
git commit -m "feat: author the curse roster and balance knobs"
```

---

### Task 3: Save v14 — `ItemInstance.curse`

**Files:**
- Modify: `packages/engine/src/versions.ts:1` (`SAVE_SCHEMA_VERSION = 14`), `packages/engine/src/item-model.ts:25-37`, `packages/engine/src/population-model.ts:131-146`, `packages/engine/src/save-schema/item.ts:49-60`, `packages/engine/src/save-schema/population.ts:137-155`, `packages/engine/src/save-schema/migrations.ts` (freeze `legacyActiveRunV13Schema`), `packages/engine/src/save-codec.ts:131-184`, `packages/engine/src/content-bound-validation.ts:688-694`
- Test: `packages/engine/test/save-codec.test.ts`

**Interfaces — Produces (every later task uses these names exactly):**

```ts
// packages/engine/src/item-model.ts
export interface ItemCurseState {
  readonly curseId: OpaqueId;
  readonly revealed: boolean;
}
// ItemInstance gains, after `heirloom`:
readonly curse?: ItemCurseState;

// packages/engine/src/population-model.ts — RecordedHeirloomSnapshot gains, after `fuel`:
readonly curse: ItemCurseState | null;
```

Zod mirrors:

```ts
// packages/engine/src/save-schema/item.ts
export const itemCurse = z.strictObject({ curseId: identifier, revealed: z.boolean() });
// itemFields gains:  curse: itemCurse.optional(),
// save-schema/population.ts — heirloom gains:  curse: itemCurse.nullable(),
```

The compile-time drift assertion at `save-schema/item.ts:113` forces the `ItemInstance`/schema pair to agree; it will fail loudly if only one side is edited.

- [ ] **Step 1: Write the failing tests**

```ts
it('migrates a v13 save by defaulting the curse field to absent', () => {
  const v13 = { ...structuredClone(encodedFixture()), schemaVersion: 13 };
  for (const item of v13.items as Record<string, unknown>[]) delete item.curse;
  const decoded = decodeActiveRun(JSON.stringify(v13), { content: pack });
  expect(decoded.items.every((item) => item.curse === undefined)).toBe(true);
  expect(decoded.schemaVersion).toBe(14);
});

it('round-trips a cursed item byte-identically', () => {
  const run = withCursedItem(baseRun(), { curseId: 'curse.hungering-edge', revealed: true });
  const encoded = encodeActiveRun(run);
  expect(encodeActiveRun(decodeActiveRun(encoded, { content: pack }))).toBe(encoded);
});

it('rejects a curse block naming a curse the pack does not define', () => {
  const run = withCursedItem(baseRun(), { curseId: 'curse.not-real', revealed: false });
  expect(() => decodeActiveRun(encodeActiveRun(run), { content: pack })).toThrow(/curse.not-real/);
});

it('preserves the curse across a recorded heirloom snapshot', () => {
  const snapshot = { ...heirloomFixture(), curse: { curseId: 'curse.leaden-weight', revealed: true } };
  const run = withRecordedHeirloom(baseRun(), snapshot);
  const decoded = decodeActiveRun(encodeActiveRun(run), { content: pack });
  expect(recordedHeirloomOf(decoded).curse).toEqual({
    curseId: 'curse.leaden-weight',
    revealed: true,
  });
});
```

`withCursedItem`, `withRecordedHeirloom`, and `recordedHeirloomOf` are local test helpers over the existing save-codec fixtures in that file — build them from the fixture helpers already there rather than inventing new fixture modules.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace @woven-deep/engine -- --run test/save-codec.test.ts`
Expected: FAIL — `curse` is an unrecognized key under `strictObject`.

- [ ] **Step 3: Write the implementation, in this order**

1. **Freeze first.** In `packages/engine/src/save-schema/migrations.ts`, add `legacyActiveRunV13Schema` as a literal snapshot of today's live schema shape, following exactly how `legacyActiveRunV12Schema` (`:466`) was frozen. Do not reference live schema objects from it.
2. Bump `SAVE_SCHEMA_VERSION = 14` in `versions.ts:1`.
3. Add `ItemCurseState` and the two optional/nullable fields to `item-model.ts` and `population-model.ts`; add `itemCurse` and the two zod fields.
4. Migration in `save-codec.ts`, immediately after `migrateV12ToV13`:

```ts
// The curse bump is field-absence only: a mid-run v13 save resumes with no cursed items, so
// nothing already in that hero's pack sprouts a curse on load.
function migrateV13ToV14(input: unknown): unknown {
  const v13 = legacyActiveRunV13Schema.parse(input);
  return { ...v13, schemaVersion: 14 };
}
```

Widen the `migrateLegacy` `schemaVersion` union to `4 | 5 | ... | 13` and wrap every existing chain arm in `migrateV13ToV14(...)`, following the mechanical pattern already in `:143-184`.

5. Content-bound validation in `content-bound-validation.ts`, beside the enchantment-key loop at `:688-694`:

```ts
    if (item.curse !== undefined) {
      const curse = pack.entries.find(
        (entry) => entry.kind === 'curse' && entry.id === item.curse!.curseId,
      );
      if (!curse) {
        throw new Error(
          `content-bound validation: item ${item.itemId} carries unknown curse ${item.curse.curseId}`,
        );
      }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace @woven-deep/engine -- --run test/save-codec.test.ts` then the engine suite excluding demo/CLI files.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat: save schema v14 with the item curse field"
```

---

### Task 4: Generation — banded curse rolls

**Files:**
- Create: `packages/engine/src/curse-generation.ts`, `packages/engine/test/curse-generation.test.ts`
- Modify: `packages/engine/src/loot-placement.ts` (scatter items), `packages/engine/src/population-placement.ts:1328-1360` (`fillItemSlots` results), `packages/engine/src/features.ts:543-552` (chest contents), `packages/engine/src/inventory.ts:387-465` (`createPopulationLoot` results)
- Modify: `packages/engine/src/index.ts` (export the module)

**Interfaces — Produces:**

```ts
// packages/engine/src/curse-generation.ts
export const CURSE_ELIGIBLE_CATEGORIES: readonly ItemCategory[] = [
  'weapon', 'armor', 'shield', 'ring', 'light',
];

/** True for a generated instance that may carry a curse: an eligible category, not an artifact. */
export function curseEligible(content: CompiledContentPack, item: ItemInstance): boolean;

/**
 * Rolls one curse chance per eligible item, in `compareCodeUnits` itemId order, threading the
 * caller's own loot stream. Ineligible items consume nothing; zero eligible items consume nothing.
 */
export function applyCurseRolls(
  input: Readonly<{
    content: CompiledContentPack;
    items: readonly ItemInstance[];
    band: DepthBand;
    state: Uint32State;
  }>,
): Readonly<{ items: readonly ItemInstance[]; state: Uint32State }>;
```

**Consumes:** `depthBandFor` and `DepthBand` from `loot-placement.ts:41-49`; `balanceEntry(content).curses` from Task 2; the `curse` kind from Task 1; `ItemCurseState` from Task 3.

- [ ] **Step 1: Write the failing tests**

```ts
it('consumes no randomness when no item is eligible', () => {
  const state: Uint32State = [1, 2, 3, 4];
  const result = applyCurseRolls({
    content: pack,
    items: [potion(), scroll()],
    band: 'deep',
    state,
  });
  expect(result.state).toEqual(state);
  expect(result.items.every((item) => item.curse === undefined)).toBe(true);
});

it('never curses an artifact', () => {
  const result = applyCurseRolls({
    content: pack,
    items: [artifactInstance()],
    band: 'deep',
    state: [1, 2, 3, 4],
  });
  expect(result.items[0]!.curse).toBeUndefined();
});

it('is deterministic for a fixed stream state', () => {
  const first = applyCurseRolls({ content: pack, items: swords(8), band: 'mid', state: [7, 7, 7, 7] });
  const second = applyCurseRolls({ content: pack, items: swords(8), band: 'mid', state: [7, 7, 7, 7] });
  expect(first.items).toEqual(second.items);
  expect(first.state).toEqual(second.state);
});

it('curses more often in deep bands than shallow ones', () => {
  const rate = (band: DepthBand) => {
    let state: Uint32State = [3, 1, 4, 1];
    let cursed = 0;
    for (let index = 0; index < 400; index += 1) {
      const rolled = applyCurseRolls({ content: pack, items: [sword(index)], band, state });
      if (rolled.items[0]!.curse) cursed += 1;
      state = rolled.state;
    }
    return cursed;
  };
  expect(rate('deep')).toBeGreaterThan(rate('shallow'));
});

it('doubles the chance for an enchanted item and caps it', () => {
  // capBps 5000, deep chanceBps 3500 -> 7000 doubled, capped to 5000.
  expect(
    curseChanceBps({ balance: balanceEntry(pack).curses, band: 'deep', enchanted: true }),
  ).toBe(5000);
  expect(
    curseChanceBps({ balance: balanceEntry(pack).curses, band: 'shallow', enchanted: true }),
  ).toBe(2000);
});

it('creates a curse instance that names a real pack curse and starts unrevealed', () => {
  const forced = applyCurseRolls({
    content: packWithCurseChance(10000),
    items: [sword(0)],
    band: 'deep',
    state: [9, 9, 9, 9],
  });
  const curse = forced.items[0]!.curse!;
  expect(curse.revealed).toBe(false);
  expect(pack.entries.some((entry) => entry.kind === 'curse' && entry.id === curse.curseId)).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace @woven-deep/engine -- --run test/curse-generation.test.ts`
Expected: FAIL — module `curse-generation.js` does not exist.

- [ ] **Step 3: Write the implementation**

```ts
const BPS_RESOLUTION = 10000;

export function curseChanceBps(
  input: Readonly<{
    balance: Readonly<{ chanceBps: Readonly<Record<DepthBand, number>>; enchantedMultiplierBps: number; capBps: number }>;
    band: DepthBand;
    enchanted: boolean;
  }>,
): number {
  const base = input.balance.chanceBps[input.band];
  if (!Number.isSafeInteger(base) || base < 0) {
    throw new RangeError(`curse chance for band ${input.band} must be a non-negative safe integer`);
  }
  if (!input.enchanted) return Math.min(base, input.balance.capBps);
  const scaled = Math.trunc((base * input.balance.enchantedMultiplierBps) / BPS_RESOLUTION);
  if (!Number.isSafeInteger(scaled)) throw new RangeError('curse chance overflowed');
  return Math.min(scaled, input.balance.capBps);
}
```

`Math.trunc` on an exact integer quotient is the codebase's quotient-division idiom (no float ever survives the expression); assert the numerator is a safe integer before dividing.

`applyCurseRolls` walks `items` sorted by `compareCodeUnits(itemId)`, skips ineligible instances without consuming randomness, and for each eligible instance draws `rollDie(state, BPS_RESOLUTION)`; a value `<= curseChanceBps(...)` then draws `rollDie(state, curseIds.length)` to pick uniformly from the pack's `curse` entry ids sorted ascending, attaching `{ curseId, revealed: false }`. Returns items in the caller's original order with the curse fields attached.

Call sites, each threading its own stream and its own band:
- `loot-placement.ts` — after scatter piles are created, before returning `{ items, features, state: cursor }`; band from `depthBandFor(floor.depth, bands)`.
- `population-placement.ts:1328-1335` — over `itemSlots.items`, threading `run.rng['loot-placement']`.
- `features.ts:543-552` — over the chest's created loot, threading `run.rng.loot`.
- `inventory.ts` `createPopulationLoot` — over `loot.items` only (never `unique`, which is boss canon), threading the same `lootState` cursor before it is written back.

Merchant restock is deliberately NOT a call site (spec clarification 3).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace @woven-deep/engine -- --run test/curse-generation.test.ts` then the engine non-demo suite.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat: roll curses onto generated equipment by depth band"
```

---

### Task 5: Modifiers — enchantment-side drawbacks

**Files:**
- Modify: `packages/engine/src/equipment.ts:171-208` (`equipmentModifiers`)
- Test: `packages/engine/test/` — the equipment/stats suite that already covers `equipmentModifiers`

**Consumes:** `ItemInstance.curse` (Task 3); the `curse` content kind's `drawbackModifiers` (Task 1).

Run `impact({target: "equipmentModifiers", direction: "upstream"})` first and report the blast radius before editing.

- [ ] **Step 1: Write the failing test**

```ts
it('applies curse drawbacks on the enchantment side, never in publicModifiers', () => {
  const run = withEquippedCursedSword({ curseId: 'curse.leaden-weight', revealed: true, identified: false });
  const [source] = equipmentModifiers({ run, content: pack, actorId: heroId(run) });
  expect(source!.modifiers).toMatchObject({ defense: 7, meleeAccuracy: -1 }); // sword defense 8, curse -1
  expect(source!.publicModifiers.meleeAccuracy).toBeUndefined();
  expect(source!.publicModifiers.defense).toBe(8);
});

it('exposes curse drawbacks in publicModifiers once the item is identified', () => {
  const run = withEquippedCursedSword({ curseId: 'curse.leaden-weight', revealed: true, identified: true });
  const [source] = equipmentModifiers({ run, content: pack, actorId: heroId(run) });
  expect(source!.publicModifiers).toEqual(source!.modifiers);
});

it('leaves an uncursed item unchanged', () => {
  const run = withEquippedSword();
  const [source] = equipmentModifiers({ run, content: pack, actorId: heroId(run) });
  expect(source!.modifiers).toEqual(source!.publicModifiers);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace @woven-deep/engine -- --run test/equipment.test.ts`
Expected: FAIL — curse drawbacks are not applied at all.

- [ ] **Step 3: Write the implementation**

In `equipmentModifiers`, after the enchantment loop at `:202-204` and before `sources.push(...)`:

```ts
    // Curse drawbacks ride the enchantment-side path, never `base`. `publicModifiers` falls back to
    // `base` for an unidentified item, so folding a curse into `base` would leak the drawback on the
    // character sheet before the hero has any way to know the item is cursed. Artifact drawbacks can
    // safely fold into `base` above only because artifacts are always identification mode `known`.
    const curseId = item.curse?.curseId;
    if (curseId !== undefined) {
      const curse = input.content.entries.find(
        (entry) => entry.kind === 'curse' && entry.id === curseId,
      );
      if (!curse || curse.kind !== 'curse') {
        throw new Error(`internal invariant: curse definition ${curseId} does not exist`);
      }
      for (const [name, amount] of Object.entries(curse.drawbackModifiers)) {
        modifiers[name] = (modifiers[name] ?? 0) + amount;
      }
    }
```

Note that `modifiers` at `:201` is already a mutable copy of `base`, so this touches only the enchantment-side object.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace @woven-deep/engine -- --run test/equipment.test.ts` then the engine non-demo suite.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat: apply curse drawbacks on the enchantment side"
```

---

### Task 6: Sticky, reveal-on-equip, and `curse.revealed`

**Files:**
- Create: `packages/engine/src/curse.ts`, `packages/engine/test/curse.test.ts`
- Modify: `packages/engine/src/equipment.ts:28-35` and `:91-93` (failure unions), `:41-89` (displacement loop), `:135-147` (`unequipItem`), `packages/engine/src/events-model.ts`, `packages/engine/src/event-projection.ts`, `packages/engine/src/commands-model.ts:218-245` (`InvalidActionReason`), `packages/engine/src/save-schema/primitives.ts:49+` (`blockReason` — live list only, frozen legacies untouched), `packages/engine/src/action-dispatch.ts` (equip path emits the reveal), `packages/engine/src/identification.ts` (`identifyItemCompletely` reveals), `packages/engine/src/commerce.ts:215-240` (`merchantAcceptsItem`)

**Interfaces — Produces:**

```ts
// packages/engine/src/curse.ts
export interface CurseRevealedEvent {
  readonly type: 'curse.revealed';
  readonly eventId: OpaqueId;
  readonly itemId: OpaqueId;
  readonly curseId: OpaqueId;
  readonly revealText: string;
}

/** True while a revealed cursed item is welded to the hero's body. */
export function itemIsWelded(item: ItemInstance): boolean;

/**
 * Marks an item's curse revealed and returns the reveal event. A no-op (same run, no events) for an
 * uncursed item or one whose curse is already revealed, so every caller can invoke it blind.
 */
export function revealItemCurse(
  input: Readonly<{ run: ActiveRun; content: CompiledContentPack; itemId: OpaqueId; eventId: OpaqueId }>,
): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }>;
```

`CurseRevealedEvent` joins the `DomainEvent` union in `events-model.ts` and is a hero-visible `PublicEvent` (pass-through in `event-projection.ts` beside `identification.appearance-revealed` at `:187`).

Failure unions gain `'item.cursed'`:

```ts
// equipment.ts:35 and :93
| Readonly<{ ok: false; reason: 'item.missing' | 'item.unavailable' | 'inventory.full' | 'item.cursed' }>
```

Also add `'item.cursed'` to `InvalidActionReason` (`commands-model.ts`) and to the live `blockReason` enum in `save-schema/primitives.ts`.

Run `impact` on `unequipItem`, `equipmentPlan`, and `merchantAcceptsItem` before editing; report the blast radius.

- [ ] **Step 1: Write the failing tests**

```ts
it('reveals the curse and emits curse.revealed when the item is equipped', () => {
  const run = withBackpackCursedSword({ revealed: false });
  const resolved = resolveCommand(run, equipCommand(run), { content: pack });
  expect(resolved.events).toContainEqual(
    expect.objectContaining({ type: 'curse.revealed', curseId: 'curse.leaden-weight' }),
  );
  expect(itemOf(resolved.state, swordId).curse).toEqual({
    curseId: 'curse.leaden-weight',
    revealed: true,
  });
});

it('refuses to unequip a revealed cursed item', () => {
  const run = withEquippedCursedSword({ revealed: true });
  expect(unequipItem({ run, actorId: heroId(run), slot: 'main-hand' })).toEqual({
    ok: false,
    reason: 'item.cursed',
  });
});

it('refuses to displace a revealed cursed item when equipping over its slot', () => {
  const run = withEquippedCursedSword({ revealed: true });
  expect(
    equipmentPlan({ run, content: pack, actorId: heroId(run), itemId: axeId, slot: 'main-hand' }),
  ).toEqual({ ok: false, reason: 'item.cursed' });
});

it('still allows unequipping a cursed item whose curse is unrevealed', () => {
  const run = withEquippedCursedSword({ revealed: false });
  expect(unequipItem({ run, actorId: heroId(run), slot: 'main-hand' }).ok).toBe(true);
});

it('reveals the curse when the item is identified, without equipping it', () => {
  const run = withBackpackCursedSword({ revealed: false });
  const identified = identifyItemCompletely({ run, content: pack, itemId: swordId, eventId: 'e1' });
  expect(itemOf(identified.state, swordId).curse!.revealed).toBe(true);
  expect(itemOf(identified.state, swordId).location.type).toBe('backpack');
  expect(identified.events).toContainEqual(expect.objectContaining({ type: 'curse.revealed' }));
});

it('lets a backpack-revealed cursed item be dropped freely', () => {
  const run = withBackpackCursedSword({ revealed: true });
  expect(dropItem({ run, actorId: heroId(run), itemId: swordId, quantity: 1 }).ok).toBe(true);
});

it('refuses to drop an equipped cursed item', () => {
  const run = withEquippedCursedSword({ revealed: true });
  expect(dropItem({ run, actorId: heroId(run), itemId: swordId, quantity: 1 })).toEqual({
    ok: false,
    reason: 'item.unavailable',
  });
});

it('refuses to buy a revealed cursed item', () => {
  const item = cursedSwordInstance({ revealed: true, location: backpack });
  expect(merchantAcceptsItem(item, swordDefinition, merchantEncounter, new Set())).toBe(false);
});

it('still buys an item whose curse is unrevealed', () => {
  const item = cursedSwordInstance({ revealed: false, location: backpack });
  expect(merchantAcceptsItem(item, swordDefinition, merchantEncounter, new Set())).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace @woven-deep/engine -- --run test/curse.test.ts`
Expected: FAIL — `curse.js` does not exist and `'item.cursed'` is not in the failure union.

- [ ] **Step 3: Write the implementation**

`packages/engine/src/curse.ts`:

```ts
export function itemIsWelded(item: ItemInstance): boolean {
  return (
    item.curse !== undefined && item.curse.revealed && item.location.type === 'equipped'
  );
}
```

`revealItemCurse` looks the instance up, returns `{ state: input.run, events: [] }` when there is no curse or it is already revealed, and otherwise maps the item to `{ ...item, curse: { ...item.curse, revealed: true } }` and emits one `curse.revealed` carrying the pack curse's `revealText`.

- `unequipItem` (`equipment.ts:135-147`): after resolving `itemId`, look the instance up and `if (itemIsWelded(instance)) return { ok: false, reason: 'item.cursed' };` — before the `inventory.full` capacity check, so a full pack never masks the real reason.
- `equipmentPlan` (`:62-77`): inside the displacement loop, when a candidate overlaps `occupied` and `itemIsWelded(item)`, return `{ ok: false, reason: 'item.cursed' }` immediately.
- Equip path in `action-dispatch.ts`: after a successful `equipItem`, call `revealItemCurse` and append its events to the equip transition's events.
- `identifyItemCompletely` (`identification.ts`): after the `identifyItem` step, call `revealItemCurse` on the same item and append its events. It takes `content` already.
- `merchantAcceptsItem` (`commerce.ts:226-239`): add `item.curse?.revealed !== true &&` to the conjunction with a comment stating that an unrevealed curse is invisible to merchant and hero alike, which is the gamble the identify service exists to resolve.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace @woven-deep/engine -- --run test/curse.test.ts` then the engine non-demo suite and `npm run typecheck`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat: weld revealed cursed items to the hero"
```

---

### Task 7: The `floor.entered` DomainEvent

**Files:**
- Modify: `packages/engine/src/events-model.ts` (event interface + union), `packages/engine/src/event-projection.ts` (hero-visible pass-through), `packages/engine/src/floor-transition.ts` (`descendToNextFloor` both branches at `:152`+, `ascendToPreviousFloor` at `:291`+, and the Final Chamber branch)
- Test: `packages/engine/test/floor-transition.test.ts`

**Interfaces — Produces:**

```ts
// packages/engine/src/events-model.ts
export interface FloorEnteredEvent {
  readonly type: 'floor.entered';
  readonly eventId: OpaqueId;
  readonly floorId: OpaqueId;
  readonly depth: number;
  readonly firstEntry: boolean;
}
```

`firstEntry` is `true` only when the floor was generated (or authored) by this transition, `false` for a stored re-entry or an ascent. Task 8 fires `on-floor-enter` on every `floor.entered` regardless of `firstEntry` — walking a staircase is walking a staircase — but the flag is what the client and later balance work need.

Run `impact` on `descendToNextFloor`, `ascendToPreviousFloor`, and `enterStoredFloor` first.

- [ ] **Step 1: Write the failing test**

```ts
it('emits floor.entered on a generated descent', () => {
  const result = descendToNextFloor(runOnStairDown(), { content: pack });
  expect(result.events).toContainEqual(
    expect.objectContaining({ type: 'floor.entered', depth: 2, firstEntry: true }),
  );
});

it('emits floor.entered with firstEntry false on a stored re-descent', () => {
  const result = descendToNextFloor(runThatAlreadyVisitedBelow(), { content: pack });
  expect(result.events).toContainEqual(
    expect.objectContaining({ type: 'floor.entered', firstEntry: false }),
  );
});

it('emits floor.entered on an ascent', () => {
  const result = ascendToPreviousFloor(runOnStairUp(), { content: pack });
  expect(result.events).toContainEqual(
    expect.objectContaining({ type: 'floor.entered', firstEntry: false }),
  );
});

it('emits floor.entered on entering the Final Chamber', () => {
  const result = descendToNextFloor(runOnStairDownAboveTheChamber(), { content: pack });
  expect(result.events).toContainEqual(
    expect.objectContaining({ type: 'floor.entered', depth: FINAL_CHAMBER_DEPTH, firstEntry: true }),
  );
});

it('consumes no randomness to emit the event', () => {
  const before = runOnStairDown();
  const after = descendToNextFloor(before, { content: pack });
  expect(after.state.rng.effects).toEqual(before.rng.effects);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace @woven-deep/engine -- --run test/floor-transition.test.ts`
Expected: FAIL — no `floor.entered` event exists.

- [ ] **Step 3: Write the implementation**

Add `FloorEnteredEvent` to `events-model.ts` and its union; add `case 'floor.entered':` to the pass-through group in `event-projection.ts:184-189`.

In `floor-transition.ts`, build the event beside the existing per-floor bookkeeping (the `applySignatureRecharge` recharge site, `:124-143`, is the precedent for "one deterministic thing that happens on floor entry"):

```ts
function floorEnteredEvent(
  input: Readonly<{ floorId: OpaqueId; depth: number; firstEntry: boolean; eventId: OpaqueId }>,
): FloorEnteredEvent {
  return {
    type: 'floor.entered',
    eventId: input.eventId,
    floorId: input.floorId,
    depth: input.depth,
    firstEntry: input.firstEntry,
  };
}
```

Emit it from all four paths: the stored branch of `descendToNextFloor` (`firstEntry: false`), the Final Chamber branch (`true`), the generated branch (`true`), and `ascendToPreviousFloor` (`false`). `ascendToPreviousFloor` currently returns `events: []` and takes no `eventId`; thread the command's `eventId` in from its caller the same way `descendToNextFloor`'s callers already supply one, or reuse the transition's existing event id source if one is already in scope — check the call sites in `action-dispatch.ts` before choosing.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace @woven-deep/engine -- --run test/floor-transition.test.ts` then the engine non-demo suite.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat: emit floor.entered on every floor transition"
```

---

### Task 8: The trigger post-pass

**Files:**
- Create: `packages/engine/src/curse-triggers.ts`, `packages/engine/test/curse-triggers.test.ts`
- Modify: `packages/engine/src/reducer.ts:388-412` (the world branch, before `concludeRunOnHeroDeath`)

**Interfaces — Produces:**

```ts
// packages/engine/src/curse-triggers.ts
/**
 * Scans one command's emitted DomainEvents once and fires every equipped curse whose trigger
 * matches. Pure: state in, state + appended events out. Each equipped curse fires at most once per
 * command even when several events would match it. Chance rolls and effect resolution both draw
 * from the `effects` stream, in equipped-slot order then itemId order, so the sequence is stable.
 */
export function applyCurseTriggers(
  input: Readonly<{
    state: ActiveRun;
    content: CompiledContentPack;
    events: readonly DomainEvent[];
    eventId: OpaqueId;
  }>,
): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }>;
```

**Consumes:** `revealItemCurse` (Task 6); `floor.entered` (Task 7); `resolveEffectSequence` (`effects.ts:173`) and `applyEffectResult` (`effects.ts:41`); `withRngStream(state, 'effects', next)` (`effects.ts:37`).

- [ ] **Step 1: Write the failing tests**

```ts
it('fires on-kill only for a kill the hero made', () => {
  const state = withEquippedCursedSword({ curseId: 'curse.hungering-edge', revealed: true });
  const heroKill = applyCurseTriggers({
    state,
    content: pack,
    events: [diedEvent({ killerActorId: heroId(state) })],
    eventId: 'c1',
  });
  const monsterKill = applyCurseTriggers({
    state,
    content: pack,
    events: [diedEvent({ killerActorId: 'actor.rat' })],
    eventId: 'c1',
  });
  expect(heroKill.events.length).toBeGreaterThan(0);
  expect(monsterKill.events).toEqual([]);
  expect(monsterKill.state.rng.effects).toEqual(state.rng.effects);
});

it('fires on-hurt-below-half exactly on the crossing', () => {
  const state = withEquippedCursedLight({ curseId: 'curse.hollow-step', revealed: true, maxHealth: 20 });
  // 20 -> 9 crosses; 20 -> 10 (exactly half) does not; 9 -> 8 is already below and does not re-cross.
  expect(fired(state, damagedEvent({ amount: 11, health: 9 }))).toBe(true);
  expect(fired(state, damagedEvent({ amount: 10, health: 10 }))).toBe(false);
  expect(fired(state, damagedEvent({ amount: 1, health: 8 }))).toBe(false);
});

it('fires at most once per command even with several matching events', () => {
  const state = withEquippedCursedSword({ curseId: 'curse.hungering-edge', revealed: true });
  const once = applyCurseTriggers({
    state,
    content: pack,
    events: [diedEvent({ killerActorId: heroId(state) }), diedEvent({ killerActorId: heroId(state) })],
    eventId: 'c1',
  });
  expect(once.events.filter((event) => event.type === 'attack.hit')).toHaveLength(1);
});

it('fires two distinct equipped curses from one event', () => {
  const state = withTwoEquippedOnKillCurses();
  const result = applyCurseTriggers({
    state,
    content: pack,
    events: [diedEvent({ killerActorId: heroId(state) })],
    eventId: 'c1',
  });
  expect(result.events.filter((event) => event.type === 'attack.hit')).toHaveLength(2);
});

it('never fires a curse on an unequipped or unrevealed item', () => {
  for (const state of [withBackpackCursedSword({ revealed: true }), withEquippedCursedSword({ revealed: false })]) {
    const result = applyCurseTriggers({
      state,
      content: pack,
      events: [diedEvent({ killerActorId: heroId(state) })],
      eventId: 'c1',
    });
    expect(result.events).toEqual([]);
    expect(result.state.rng.effects).toEqual(state.rng.effects);
  }
});

it('reveals an unrevealed curse when its trigger fires', () => {
  // Reachable only if a future path equips without revealing; the post-pass covers it regardless.
  const state = forceTriggerOnUnrevealed();
  const result = applyCurseTriggers({ state, content: pack, events: [floorEnteredEvent()], eventId: 'c1' });
  expect(result.events).toContainEqual(expect.objectContaining({ type: 'curse.revealed' }));
});

it('draws only from the effects stream', () => {
  const state = withEquippedCursedSword({ curseId: 'curse.hungering-edge', revealed: true });
  const result = applyCurseTriggers({
    state,
    content: pack,
    events: [diedEvent({ killerActorId: heroId(state) })],
    eventId: 'c1',
  });
  expect(result.state.rng.effects).not.toEqual(state.rng.effects);
  expect(result.state.rng.loot).toEqual(state.rng.loot);
  expect(result.state.rng['loot-placement']).toEqual(state.rng['loot-placement']);
  expect(result.state.rng.combat).toEqual(state.rng.combat);
});
```

Reducer-level test in the reducer suite:

```ts
it('does not run the post-pass on a concluded run', () => {
  const concluded = concludedRunWithEquippedCurse();
  const resolved = resolveCommand(concluded, moveCommand(concluded), { content: pack });
  expect(resolved.result).toMatchObject({ status: 'invalid', reason: 'run.concluded' });
  expect(resolved.state.rng.effects).toEqual(concluded.rng.effects);
});

it('concludes the run when a curse trigger lands the killing blow', () => {
  const nearDeath = runWithLethalOnFloorEnterCurse();
  const resolved = resolveCommand(nearDeath, descendCommand(nearDeath), { content: pack });
  expect(resolved.state.conclusion).not.toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace @woven-deep/engine -- --run test/curse-triggers.test.ts`
Expected: FAIL — module `curse-triggers.js` does not exist.

- [ ] **Step 3: Write the implementation**

Matching, computed once over `input.events`:

```ts
const heroId = input.state.hero.actorId;
const maxHealth = derivedStats({ state: input.state, content: input.content, actorId: heroId }).maxHealth;
const matched = new Set<CurseTriggerEvent>();
for (const event of input.events) {
  if (event.type === 'actor.died' && event.killerActorId === heroId) matched.add('on-kill');
  if (event.type === 'actor.damaged' && event.actorId === heroId) {
    // Checked-integer crossing: post-damage health is below half AND pre-damage health was not.
    const before = event.health + event.amount;
    if (!Number.isSafeInteger(before)) throw new RangeError('damage crossing overflowed');
    if (2 * event.health < maxHealth && 2 * before >= maxHealth) matched.add('on-hurt-below-half');
  }
  if (event.type === 'floor.entered') matched.add('on-floor-enter');
}
if (matched.size === 0) return { state: input.state, events: [] };
```

Then walk the hero's equipped items in `SLOT_ORDER` then `compareCodeUnits(itemId)` order; for each whose curse's `trigger.on` is in `matched`, draw `rollDie(effectsState, 10000)` and fire when `value <= trigger.chanceBps`. Firing means: `revealItemCurse` (appending its event), then `resolveEffectSequence({ effects: [trigger.effect], sourceActorId: heroId, targetActorId: heroId, effectsState, operations: {}, ... })` and `applyEffectResult`, threading the effects state forward with `withRngStream`. Every allowlisted effect id is a member of `DIRECT_EFFECTS` (`effects.ts:96-104`), so `operations: {}` is correct and `resolveEffectSequence` will not throw `effect operation ... is unavailable`.

Reducer wiring, in `reducer.ts` between the `world` resolution (`:388`) and `concludeRunOnHeroDeath` (`:412`):

```ts
  // Curse triggers resolve inside the same transition, on the events the command just emitted, and
  // BEFORE the conclusion boundary -- a curse that lands the killing blow must conclude the run here
  // rather than leaving a dead hero in an unconcluded state. Skipped for an already-dead hero and an
  // already-concluded run, which is the spec's "concluded runs never trigger".
  const triggered =
    world.state.conclusion === null && heroActor(world.state).health > 0
      ? applyCurseTriggers({
          state: world.state,
          content: context.content,
          events: world.events,
          eventId: command.commandId,
        })
      : { state: world.state, events: [] as readonly DomainEvent[] };
  const worldEvents = [...world.events, ...triggered.events];
  const triggerPublicEvents =
    triggered.events.length === 0
      ? []
      : projectDomainEvents({
          state: triggered.state,
          content: context.content,
          heroId: triggered.state.hero.actorId,
          events: triggered.events,
        });
```

Then feed `triggered.state` and `worldEvents` into `concludeRunOnHeroDeath` in place of `world.state`/`world.events`, and replace the `conclusionEvents = concludedEvents.slice(world.events.length)` slice base with `worldEvents.length`. Append `triggerPublicEvents` to `world.publicEvents` where `worldPublicEvents` is assembled. Trade, dialogue, and house branches are untouched — they emit none of the three matching event types.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace @woven-deep/engine -- --run test/curse-triggers.test.ts test/reducer.test.ts` then the engine non-demo suite.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat: fire curse triggers from a reducer post-pass"
```

---

### Task 9: The remove-curse merchant service

**Files:**
- Modify: `packages/content/src/model/common.ts:141-145` and `packages/content/src/compiler/registries.ts` (`MERCHANT_SERVICE_IDS` + `'merchant-service.remove-curse'` in BOTH copies), `packages/content/src/compiler/schema/encounter.ts:247-266` (per-service constraint superRefine), `packages/engine/src/save-schema/primitives.ts:44-47` (`merchantServiceId` enum), `packages/engine/src/trade.ts:377-435` (`planService`) and `:652-716` (`resolveTradeCommand`), `packages/engine/src/projection.ts:629-661` (per-service target lists), `content/encounters/town-merchants.yaml:89-90`
- Test: `packages/engine/test/` merchant/trade suites; the content validation suite

**Interfaces — Produces:**

```ts
// packages/engine/src/projection.ts — the projected service entry gains a per-service list:
{ serviceId, unitPrice, remainingUses, targetItemIds }  // targetItemIds now computed per serviceId
```

`packages/engine/src/trade.ts` gains an exported helper used by both `planService` and `projectActiveTrade`:

```ts
/** Item ids the given service can legally act on for this hero, sorted by compareCodeUnits. */
export function serviceTargetItemIds(
  input: Readonly<{ state: ActiveRun; content: CompiledContentPack; serviceId: MerchantServiceId }>,
): readonly OpaqueId[];
```

- `merchant-service.identify` → hero-owned items with something left to identify (today's `identifyTargetIds` logic, moved here verbatim).
- `merchant-service.remove-curse` → hero-owned items whose `curse` exists and `revealed === true`.
- `merchant-service.strongbox` → `[]` (it takes no target).

Run `impact` on `planService`, `resolveTradeCommand`, and `projectActiveTrade` first.

- [ ] **Step 1: Write the failing tests**

```ts
it('lists identify and remove-curse targets separately', () => {
  const projection = projectActiveTrade({ state: runWithCursedAndUnidentifiedItems(), content: pack });
  const identify = projection.services.find((s) => s.serviceId === 'merchant-service.identify')!;
  const remove = projection.services.find((s) => s.serviceId === 'merchant-service.remove-curse')!;
  expect(identify.targetItemIds).toEqual([unidentifiedId]);
  expect(remove.targetItemIds).toEqual([revealedCursedId]);
});

it('removes the curse and keeps everything else about the item', () => {
  const before = runTradingWithRemoveCurse();
  const item = itemOf(before, revealedCursedId);
  const after = resolveCommand(before, removeCurseCommand(before, revealedCursedId), { content: pack });
  const healed = itemOf(after.state, revealedCursedId);
  expect(healed.curse).toBeUndefined();
  expect(healed.enchantment).toEqual(item.enchantment);
  expect(healed.identified).toBe(item.identified);
  expect(healed.location).toEqual(item.location);
});

it('makes an equipped cursed item unequippable again after removal', () => {
  const after = resolveCommand(runTradingWithEquippedCurse(), removeCurseCommand(...), { content: pack });
  expect(unequipItem({ run: after.state, actorId: heroId(after.state), slot: 'main-hand' }).ok).toBe(true);
});

it('rejects remove-curse on an item with no curse', () => {
  const resolved = resolveCommand(runTradingWithRemoveCurse(), removeCurseCommand(before, cleanId), {
    content: pack,
  });
  expect(resolved.result).toMatchObject({ status: 'invalid', reason: 'trade.target-invalid' });
});

it('rejects remove-curse on an unrevealed curse', () => {
  const resolved = resolveCommand(runTradingWithRemoveCurse(), removeCurseCommand(before, hiddenCursedId), {
    content: pack,
  });
  expect(resolved.result).toMatchObject({ status: 'invalid', reason: 'trade.target-invalid' });
});

it('charges the authored price and consumes a use', () => {
  const before = runTradingWithRemoveCurse();
  const after = resolveCommand(before, removeCurseCommand(before, revealedCursedId), { content: pack });
  expect(after.state.hero.currency).toBe(before.hero.currency - 30);
  expect(after.events).toContainEqual(
    expect.objectContaining({ type: 'trade.service-purchased', serviceId: 'merchant-service.remove-curse' }),
  );
});
```

Content test:

```ts
it('rejects a remove-curse service authored with a null target requirement mismatch', async () => {
  await expect(compileSource(merchantSource({ serviceId: 'merchant-service.remove-curse', maximumUses: 0 })))
    .rejects.toThrow(/remove-curse/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace @woven-deep/engine -- --run test/merchant-services.test.ts` (use the file that already covers `merchant-service.identify`)
Expected: FAIL — `'merchant-service.remove-curse'` is not a member of the enum.

- [ ] **Step 3: Write the implementation**

Add `'merchant-service.remove-curse'` to `MERCHANT_SERVICE_IDS` in `packages/content/src/model/common.ts:141-145` and `packages/content/src/compiler/registries.ts`, and to `merchantServiceId` in `packages/engine/src/save-schema/primitives.ts:44-47`. Do NOT touch frozen legacy literals in `save-schema/migrations.ts` or `tradeServiceCommandV7`.

In `compiler/schema/encounter.ts`'s `merchantService` superRefine (`:255-266`), add beside the strongbox rule:

```ts
    if (service.serviceId === 'merchant-service.remove-curse' && service.maximumUses < 1) {
      context.addIssue({
        code: 'custom',
        path: ['maximumUses'],
        message: 'the remove-curse service requires at least one use',
      });
    }
```

In `trade.ts`, extract today's `identifyTargetIds` block out of `projection.ts:629-644` into the exported `serviceTargetItemIds` helper described above, then use it in three places: `projectActiveTrade`'s `.map` (`targetItemIds: serviceTargetItemIds({ state, content, serviceId: service.serviceId })`), and `planService`'s target validation for both targeted services. `planService`'s targeted branch becomes: reject when `command.targetItemId === null`; reject when the item id is not in `serviceTargetItemIds(...)` for `command.serviceId`; otherwise price and return as today. That collapses the identify-specific `appearanceUnknown` logic into the shared helper and keeps the two services honest against one definition of "legal target".

In `resolveTradeCommand`'s `trade-service` branch (`:672-716`), add a `remove-curse` arm before the identify tail:

```ts
    if (command.serviceId === 'merchant-service.remove-curse') {
      const targetItemId = command.targetItemId!;
      const nextState: ActiveRun = {
        ...charged,
        items: charged.items.map((item) => {
          if (item.itemId !== targetItemId) return item;
          // Removal deletes the curse and nothing else: enchantment, identification, condition,
          // charges, fuel, and location all survive. An equipped item simply stops being welded.
          const { curse: _removed, ...rest } = item;
          return rest;
        }),
      };
      return {
        state: nextState,
        events: [
          {
            type: 'trade.service-purchased',
            eventId: command.commandId,
            merchantPopulationId: trade.merchantPopulationId,
            serviceId: command.serviceId,
            targetItemId,
            price: plan.plan.price,
            currency: plan.plan.currency,
            remainingUses,
          },
        ],
      };
    }
```

Author the service in `content/encounters/town-merchants.yaml` on the curios dealer, beside identify:

```yaml
        - { serviceId: merchant-service.remove-curse, basePrice: 30, minimumUses: 1, maximumUses: 1, tierIds: [neutral, trusted] }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace @woven-deep/engine -- --run test/merchant-services.test.ts`, `npm run test --workspace @woven-deep/content`, `npm run content:validate`, `npm run typecheck`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages content
git commit -m "feat: add the remove-curse merchant service"
```

---

### Task 10: `effect.curse.remove` and the scroll of sundering

**Files:**
- Modify: `packages/content/src/model/common.ts` `EFFECT_IDS` (~`:155`), `packages/content/src/compiler/registries.ts` `EFFECT_PARAMETER_SCHEMAS`, `packages/engine/src/effects.ts:96-104` (`DIRECT_EFFECTS`) and the sequence loop
- Create: `content/items/sundering-scroll.yaml`
- Modify: a deep-weighted loot table in `content/loot-tables/`
- Test: `packages/engine/test/effects.test.ts`; content validation

**Interfaces — Produces:** effect id `'effect.curse.remove'` with parameter schema `z.strictObject({})`, and content id `item.sundering-scroll`.

`effect.curse.remove` is deliberately NOT a member of `CURSE_TRIGGER_EFFECT_IDS` (Task 1's allowlist) — a curse can never fire curse removal.

- [ ] **Step 1: Write the failing tests**

```ts
it('removes the curse from the first revealed cursed item in itemId order', () => {
  const run = withTwoRevealedCursedItems(); // item.a.0001 and item.a.0002
  const result = resolveEffectSequence({
    ...effectInput(run),
    effects: [{ effectId: 'effect.curse.remove', parameters: {}, requiresLivingTarget: false }],
  });
  expect(result.items!.find((item) => item.itemId === 'item.a.0001')!.curse).toBeUndefined();
  expect(result.items!.find((item) => item.itemId === 'item.a.0002')!.curse).toBeDefined();
});

it('leaves an unrevealed curse alone', () => {
  const result = resolveEffectSequence({
    ...effectInput(withBackpackCursedSword({ revealed: false })),
    effects: [{ effectId: 'effect.curse.remove', parameters: {}, requiresLivingTarget: false }],
  });
  expect(result.items!.some((item) => item.curse !== undefined)).toBe(true);
});

it('consumes no randomness whether or not it finds a target', () => {
  const input = effectInput(runWithNoCursedItems());
  const result = resolveEffectSequence({
    ...input,
    effects: [{ effectId: 'effect.curse.remove', parameters: {}, requiresLivingTarget: false }],
  });
  expect(result.effectsState).toEqual(input.effectsState);
});

it('does not consume the scroll when there is no cursed item to sunder', () => {
  const resolved = resolveCommand(runWithScrollAndNoCurse(), useScrollCommand(...), { content: pack });
  expect(resolved.result).toMatchObject({ status: 'invalid', reason: 'target.invalid' });
  expect(itemOf(resolved.state, scrollId).quantity).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace @woven-deep/engine -- --run test/effects.test.ts`
Expected: FAIL — `unregistered effect effect.curse.remove`.

- [ ] **Step 3: Write the implementation**

Add `'effect.curse.remove'` to `EFFECT_IDS` and `EFFECT_PARAMETER_SCHEMAS['effect.curse.remove'] = z.strictObject({})`. Add it to `DIRECT_EFFECTS` in `effects.ts` and handle it in the sequence loop beside `effect.item.consume`:

```ts
    if (effect.effectId === 'effect.curse.remove') {
      // Targets like effect.fuel.transfer does: the actor's own items, deterministically first by
      // itemId. use-item carries no item target, so this is the codebase's item-targeting contract.
      const cursed = items
        .filter(
          (item) =>
            (item.location.type === 'backpack' || item.location.type === 'equipped') &&
            item.location.actorId === input.targetActorId &&
            item.curse?.revealed === true,
        )
        .sort((left, right) => compareCodeUnits(left.itemId, right.itemId));
      const target = cursed[0];
      if (target) {
        items = items.map((item) => {
          if (item.itemId !== target.itemId) return item;
          const { curse: _removed, ...rest } = item;
          return rest;
        });
        events.push({
          type: 'curse.removed',
          eventId: input.eventId,
          itemId: target.itemId,
          curseId: target.curse!.curseId,
        });
      }
      continue;
    }
```

Add `CurseRemovedEvent` (`{ type: 'curse.removed'; eventId; itemId; curseId }`) to `events-model.ts` and its union, plus a pass-through case in `event-projection.ts` gated on `itemVisible(event.itemId)` (mirror `item.identified` at `:325-328`).

The use-item validation path (`actions.ts`) rejects with the existing `'target.invalid'` reason when the item's effects include `effect.curse.remove` and the hero holds no revealed cursed item, so the scroll is not consumed.

`content/items/sundering-scroll.yaml` — copy the structure of `content/items/ember-scroll.yaml` (same category, stackLimit, identification pool, actionCost) with:

```yaml
    id: item.sundering-scroll
    name: Scroll of Sundering
    rarity: rare
    minDepth: 8
    effects:
      - effectId: effect.curse.remove
        parameters: {}
        requiresLivingTarget: false
```

Add one low-weight choice for `item.sundering-scroll` to `loot-table.floor-scatter-deep` and `loot-table.chest-deep` only (rare + deep-weighted per the spec).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace @woven-deep/engine -- --run test/effects.test.ts`, `npm run content:validate`, engine non-demo suite.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages content
git commit -m "feat: add the scroll of sundering and its curse removal effect"
```

---

### Task 11: Heirlooms and champion snapshots

**Files:**
- Modify: `packages/engine/src/heirloom-selection.ts:112-130` (`instanceSnapshot`) and the fallback snapshot at `:82-95`, `packages/engine/src/inventory.ts:467-520` (`createRecordedHeirloom`) and `:524-563` (`recordedHeirloomContentId`)
- Test: `packages/engine/test/heirloom-selection.test.ts` and the inventory/champion suite

**Consumes:** `RecordedHeirloomSnapshot.curse` (Task 3).

Run `impact` on `selectHeirloom`, `createRecordedHeirloom`, and `recordedHeirloomContentId` first.

- [ ] **Step 1: Write the failing tests**

```ts
it('carries the curse into the heirloom snapshot, revealed', () => {
  const { snapshot } = selectHeirloom({ run: concludedWithEquippedCursedSword(), content: pack, template, recordId });
  expect(snapshot.curse).toEqual({ curseId: 'curse.leaden-weight', revealed: true });
});

it('reveals an unrevealed curse when the item becomes an heirloom', () => {
  const { snapshot } = selectHeirloom({ run: concludedWithHiddenCursedSword(), content: pack, template, recordId });
  expect(snapshot.curse).toEqual({ curseId: 'curse.leaden-weight', revealed: true });
});

it('records a null curse for the fallback relic', () => {
  const { snapshot } = selectHeirloom({ run: concludedWithNoEquipment(), content: pack, template, recordId });
  expect(snapshot.curse).toBeNull();
});

it('materializes a recovered heirloom still cursed and revealed', () => {
  const { item } = createRecordedHeirloom({
    content: pack,
    snapshot: { ...heirloomFixture(), curse: { curseId: 'curse.leaden-weight', revealed: true } },
    itemId: 'item.recovered.0001',
    floorId,
    x: 3,
    y: 4,
  });
  expect(item.curse).toEqual({ curseId: 'curse.leaden-weight', revealed: true });
});

it('degrades to the fallback relic when the recorded curse no longer exists in the pack', () => {
  const resolved = recordedHeirloomContentId({
    content: pack,
    snapshot: { ...heirloomFixture(), curse: { curseId: 'curse.deleted', revealed: true } },
    equippedItemContentIds: [heirloomFixture().contentId],
    fallbackItemId: 'item.champion-fallback-relic',
  });
  expect(resolved).toBe('item.champion-fallback-relic');
});

it('drops the curse when the snapshot degrades to the fallback relic', () => {
  const { item, fallback } = createRecordedHeirloom({
    content: pack,
    snapshot: { ...heirloomFixture(), contentId: 'item.deleted', curse: { curseId: 'curse.leaden-weight', revealed: true } },
    itemId: 'item.recovered.0001',
    floorId,
    x: 3,
    y: 4,
  });
  expect(fallback).toBe(true);
  expect(item.curse).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace @woven-deep/engine -- --run test/heirloom-selection.test.ts`
Expected: FAIL — `snapshot.curse` is `undefined`, not the expected object.

- [ ] **Step 3: Write the implementation**

`instanceSnapshot` (`heirloom-selection.ts:112`) gains, after `fuel`:

```ts
    // The Hall knows the item's history: a cursed heirloom travels cursed and revealed, so the
    // recovering hero sees what they are picking up before they touch it.
    curse: instance.curse ? { curseId: instance.curse.curseId, revealed: true } : null,
```

The fallback snapshot at `:82-95` gains `curse: null`.

`createRecordedHeirloom` (`inventory.ts:490-513`) gains, on the item it builds:

```ts
    // A degraded fallback relic resolved a different item than the record named, so the recorded
    // curse belongs to nothing here -- exactly the reasoning the charges branch above already uses.
    ...(fallback || input.snapshot.curse === null ? {} : { curse: input.snapshot.curse }),
```

`recordedHeirloomContentId` (`:524`) gains a compatibility clause beside `modifiersCompatible`:

```ts
  const curseCompatible =
    input.snapshot.curse === null ||
    input.content.entries.some(
      (entry) => entry.kind === 'curse' && entry.id === input.snapshot.curse!.curseId,
    );
```

and `curseCompatible &&` joins the returned conjunction. This follows the existing content-drift policy: an unresolvable reference degrades to the fallback relic rather than throwing.

The champion inventory snapshot schema already round-trips through `save-schema/population.ts`'s `heirloom` object, which Task 3 extended — no further schema work here.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace @woven-deep/engine -- --run test/heirloom-selection.test.ts` then the engine non-demo suite.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat: carry curses through heirlooms and champion snapshots"
```

---

### Task 12: Client — log lines, item sheet, slot marker

**Files:**
- Modify: `apps/web/src/session/event-log.ts` (`curse.revealed`, `curse.removed`, `floor.entered`, and the `item.cursed` invalid-action case)
- Modify: the item detail/inspect surface in `apps/web/src/ui/overlays/` (the pane that renders `ItemView` facts) and the equipment-slot rendering in `apps/web/src/ui/panels.tsx`
- Modify: `apps/web/src/ui/screens/TradeScreen.tsx` (Services tab reads the per-service `targetItemIds`)
- Test: `apps/web/src/session/event-log.test.ts` and the touched component tests

**Consumes:** `curse.revealed` / `curse.removed` PublicEvents (Tasks 6, 10); `floor.entered` (Task 7); `item.cursed` invalid reason (Task 6); per-service `targetItemIds` (Task 9).

- [ ] **Step 1: Write the failing tests**

```ts
it('logs the authored reveal text when a curse reveals', () => {
  expect(
    describeEvent({
      type: 'curse.revealed',
      eventId: 'e1',
      itemId: 'item.a.0001',
      curseId: 'curse.leaden-weight',
      revealText: 'It settles onto you like wet earth, and does not lift.',
    }),
  ).toMatchObject({ text: 'It settles onto you like wet earth, and does not lift.', tone: 'curse' });
});

it('logs a removal', () => {
  expect(
    describeEvent({ type: 'curse.removed', eventId: 'e1', itemId: 'item.a.0001', curseId: 'curse.leaden-weight' }),
  ).toMatchObject({ text: 'The weight lifts. The thing is only iron again.' });
});

it('logs the refusal when a cursed item will not come free', () => {
  expect(describeEvent(invalidAction('item.cursed'))).toMatchObject({
    text: 'It will not come free.',
  });
});
```

Component tests: the detail pane shows the curse name and its drawbacks for a revealed cursed `ItemView` and shows nothing curse-related for an unrevealed one; the equipment slot renders the cursed marker only for a revealed cursed equipped item; the Services tab lists remove-curse with only that service's own targets.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace @woven-deep/web`
Expected: FAIL — the event types fall through to the default branch.

- [ ] **Step 3: Write the implementation**

Add the three `case` arms to `event-log.ts`'s switch beside `item.identified`, and the `'item.cursed'` arm to the nested `action.invalid` reason switch beside `'light.inextinguishable'` (`:93`). `floor.entered` is silent in the log (descent already narrates itself) — add it as an explicit no-op case so the exhaustiveness check stays honest, with a one-line comment saying why.

Detail pane: read the run's compiled pack for the curse entry named by the projected item's curse, render name plus drawback lines using the existing derived-stat label helper in `apps/web/src/ui/labels.ts`. Render nothing when the projection carries no curse — the projection is the only source of truth here, and it withholds the curse until revealed (Task 6 + the Global Constraints hidden-fields rule).

Equipment slots: a subtle marker glyph or muted accent on a slot whose item is revealed-cursed. Reuse an existing theme token from `apps/web/src/ui/theme/`; do not introduce a new color literal.

TradeScreen Services tab: replace any use of a shared identify-derived target list with `service.targetItemIds` read off each projected service. Verify by reading the component that no other call site assumed the old single list.

**Projection check:** `projectItem` (`identification.ts:170-218`) must be extended in this task to emit `curse: { curseId, name, revealText, drawbackModifiers }` ONLY when `item.curse?.revealed === true` AND the item is otherwise projected in its identified form. Add an engine test asserting an unrevealed cursed item projects byte-identically to a clean unidentified one of the same content id.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace @woven-deep/web && npm run typecheck --workspace @woven-deep/web` plus the engine projection suite.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web packages/engine
git commit -m "feat: surface curses in the log, item sheet, and trade services"
```

---

### Task 13: Re-pin, root gate, docs, PR

**Files:**
- Modify: `packages/engine/test/fixtures/*-demo-hashes.json`, `docs/server-admin/content-configuration.md`, `docs/superpowers/specs/2026-07-31-cursed-items-design.md` (the eight recorded clarifications)

- [ ] **Step 1: Rebuild and inspect every drift**

```bash
npm run build --workspace @woven-deep/content && npm run build --workspace @woven-deep/engine
npm run gameplay:demo && npm run merchant:demo && npm run population:demo && npm run dungeon:demo && npm run run-records:demo
```

For EACH fixture, write down the attribution before touching it. Expected causes, and nothing else:
- **contentHash-only:** the pack changed (v12, the curse roster, the identification sweep, the new service, the scroll). Every demo shows this.
- **save-shape:** `SAVE_SCHEMA_VERSION` 14 in every encoded blob.
- **behavioral, loot streams:** the per-eligible-item curse roll in `applyCurseRolls` shifts `loot-placement` and `loot` for any demo that generates eligible equipment. Confirm the shift is a stream-position shift and that item identities downstream are consistent with one extra draw per eligible item — dump the transcript delta and read it.
- **behavioral, effects stream:** only in demos where a cursed item is actually equipped and a trigger matches. If a demo shows effects-stream drift with no cursed item equipped in its transcript, that is UNEXPLAINED.
- **behavioral, identification:** the `identification.mode: instance` sweep changes how items project and adds shuffle draws in `allocateIdentificationMap` on the `effects` stream at run creation. Expect this in every demo.

**An unexplained delta is a STOP.** Report BLOCKED with the transcript diff. Do not re-pin over it.

- [ ] **Step 2: Re-pin once**

```bash
git add packages/engine/test/fixtures
git commit -m "chore: re-pin demo hashes for cursed items"
```

Put the per-fixture attributions in the commit body, one line per fixture.

- [ ] **Step 3: Amend the spec and the admin docs**

Fold the eight "Spec clarifications recorded here" entries into `docs/superpowers/specs/2026-07-31-cursed-items-design.md` as an "Amendments (2026-07-31, during implementation)" section, and confirm `docs/server-admin/content-configuration.md` documents: the `curse` kind reference, the `curses` balance block, the `merchant-service.remove-curse` service, `effect.curse.remove`, and the v12 migration note.

```bash
git add docs
git commit -m "docs: record the cursed items spec amendments"
```

- [ ] **Step 4: Root gate**

```bash
npm test && npm run typecheck && npm run smoke
```
Expected: all green. The descent-lock-free invariant suite must be green — that is the no-hard-gates proof.

- [ ] **Step 5: Detect changes and open the PR**

Run `detect_changes({scope: "compare", base_ref: "main"})` and confirm the affected symbols match this plan's file map. Then push `feat/cursed-items` and open the PR: title `feat: cursed items with reveal, sticky equipment, and remove-curse`, body closing #121, linking the spec, listing the eight amendments and the demo-hash attributions.

---

## Self-Review

**1. Spec coverage.** Content v12 curse kind + all four compile rules + artifact drawback validation → Task 1. Eligible categories moved to `identification.mode: instance` and balance knobs → Task 2. Save v14 `ItemInstance.curse` + heirloom snapshot + frozen legacy + one migration + no hidden-field leak → Tasks 3 and 12. Generation with banded chance, enchanted doubling, cap, uniform identity, zero-eligible-zero-draws → Task 4. Enchantment-side modifiers → Task 5. Sticky on both unequip paths + reveal on equip + reveal on identify + drop and merchant refusals + `item.cursed` reason → Task 6. `floor.entered` in all three transition paths → Task 7. All three triggers, once per command per curse, reveal-on-fire, concluded runs never trigger → Task 8. Remove-curse service with per-service target lists → Task 9. Scroll of sundering + `effect.curse.remove` → Task 10. Heirloom travels cursed-and-revealed + champion round-trip → Task 11. Client log line, item sheet, slot marker, services tab → Task 12. Error handling: compile failures Task 1, runtime rejections Tasks 9 and 10, save content-drift Tasks 3 and 11. The descent-lock-free invariant is discharged structurally by `CURSE_TRIGGER_EFFECT_IDS` (Task 1) and re-run in Task 13. No gaps found.

**2. Placeholder scan.** Every code step carries real TypeScript, YAML, or Zod. Three named checks remain for the implementer to verify against live source rather than assume: `condition.chilled`'s existence (Task 2 Step 1 says how), the `ascendToPreviousFloor` event-id source (Task 7 Step 3 says where to look), and the exact merchant/trade test file names (Tasks 6 and 9 identify them by the behavior they already cover). Those are verification instructions, not deferred decisions.

**3. Type consistency.** `ItemCurseState` / `item.curse` / `curse.curseId` / `curse.revealed` are used identically in Tasks 3, 4, 5, 6, 8, 9, 10, 11, 12. `CURSE_TRIGGER_EVENTS`, `CURSE_TRIGGER_EFFECT_IDS`, `CurseTriggerDefinition.effect` (an `EffectDefinition`, never a bare id) are consistent between Tasks 1, 2, and 8. `applyCurseRolls` and `curseChanceBps` keep the same signatures in Task 4's tests and implementation. `serviceTargetItemIds` is defined once in Task 9 and consumed by both `planService` and `projectActiveTrade`. `revealItemCurse` is defined in Task 6 and called from Tasks 6 and 8 with the same input shape. `item.cursed` is the reason string everywhere; `curse.revealed` and `curse.removed` are the two event type strings everywhere.
