# Hero Power Curve Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gap between the Deep's difficulty curve and the hero's flat innate power along three grind-proof axes: **tempering** (depth milestones grant attribute points), **enchanting** (a merchant service and a rare scroll finally produce enchantments in-run), and **spell scaling + echo casting** (wits scales spell damage/heals, and fallen casters echo forward what they knew).

**Architecture:** Attribute mutation finally exists, so the stored `maxHealth`/`maxWeave` fields stop being a one-time snapshot: a pure `synchronizeDerivedMaxima` pass makes them a cache of `deriveRunActorStats`'s outputs for the hero, which is also what fixes the long-standing inert-`maxHealth`-modifier bug. `hero.tempering` (save v16→v17) banks points from `metrics.deepestDepth` crossings and spends them through a new revision-only `temper` command. Enchanting adds a closed `enchantment` content kind (the `curse` kind from #121 is the exact precedent, since `ItemEnchantmentState.enchantmentId` needs a registry-validated id), drawn on a NEW named RNG stream `enchanting` by a fourth merchant service and a rare scroll. `spellPower` joins the closed derived-stat vocabulary and is threaded into effect resolution only at the spell seams, so item triggers and curses get zero by omission.

**Tech Stack:** TypeScript 5.8 ESM, Zod strict schemas, Vitest 3.2, React 19, npm workspaces (`@woven-deep/content`, `@woven-deep/engine`, `@woven-deep/session-core`, `@woven-deep/web`, `@woven-deep/server`).

**Spec:** `docs/superpowers/specs/2026-08-02-hero-power-curve-design.md` — read it before starting any task. It is the requirements; this plan is the route.

## Global Constraints

Every task's requirements implicitly include this section.

- **No hard gates ([[design-principle-no-hard-gates]]).** Every axis is optional power, never a progress gate. Victory remains skill + loot; these are the loot's force multipliers. The descent-lock-free invariant suite must stay green — Task 12 re-runs it as the proof.
- **No XP, no levels, no kill-grinding of any kind.** The score's turn-decay line stays the anti-grind spine. Tempering milestones are facts derived from `metrics.deepestDepth`, with zero randomness and no per-monster data.
- **No attribute growth beyond `attributeMaximum` (30).** The chargen cap is the lifetime cap. When ALL attributes are capped, points bank harmlessly forever ("held by the Deep").
- **No spell ranks** (duplicate tomes stay rejected); scaling is stat-derived only. **No enchanting of artifacts, no re-rolling curses, no enchantment removal.** **No score-model changes** — Task 12 pins the score model byte-for-byte.
- **The curse 2× weighting stays generation-only.** Service and scroll enchanting never triggers a curse roll. `curse-generation.ts` reads `enchantment !== null` at generation time and that is the whole of it — do not "fix" it into a retroactive gamble. Curse drawbacks remain forbidden from `maxHealth` (the #121 compile rule stands).
- **Checked integer arithmetic** everywhere: the health/weave rescale on temper, the spellPower divisor, and the rarity magnitude scaling all use explicit safe-integer guards and quotient/remainder division. Never `Math.round`, never a float that survives an expression.
- **Randomness budget: exactly one new stream, consumed by exactly two call sites.** `enchanting` is drawn only by the enchant service and the tempering-steel scroll. Tempering consumes none; the `temper` command consumes none; the derived-maxima sync consumes none; spellPower consumes none. An enchant-free run must show ZERO movement of the `enchanting` state beyond its seed-derived initial value.
- **Two schema bumps, no more.** Save v16→v17 in Task 2: freeze `legacyActiveRunV16Schema` FIRST, and — because the shared `hero` sub-schema changes shape — freeze `legacyHeroPreTempering` and wire it into **every** legacy entry version v4–v16 (the standing #121 Task-3 lesson, most recently applied to the haunts standing sub-schema). Content v13→v14 in Task 3 with migration notes in `docs/server-admin/content-configuration.md`. No other task touches a schema version.
- **The RNG stream list freeze holds.** `LEGACY_RNG_STREAM_NAMES`, `LEGACY_V5_RNG_STREAM_NAMES`, `LEGACY_V11_RNG_STREAM_NAMES`, and `LEGACY_V12_RNG_STREAM_NAMES` are frozen literals and stay exactly as they are; `enchanting` is appended to the LIVE `RNG_STREAM_NAMES` only, and the v16→v17 migration synthesizes its state from the run seed via `deriveRngStreams` — the same shape the v11→v12 `loot-placement` addition used (`save-codec.ts:120-128`).
- **New invalid-action reasons need the reason↔command coupling.** `temper.unavailable` and `temper.capped` must be added to the reason↔command consistency check in `save-schema/run-record.ts` (~`:2150-2234`) in the SAME task that introduces them. Without it every rejection of the new command throws on persist — the exact `offer` lesson from the haunts plan.
- **Determinism is the product.** Continuous play and split save/reload replay stay byte-identical (`encodeActiveRun` equality) with tempering banked and spent, enchantments applied, and spells scaled.
- **Wanderer rewind semantics are deliberate and pinned.** Tempering state rides the run blob, and so does `metrics.deepestDepth` — so a rewind restores pre-checkpoint tempering wholesale AND re-grants the milestone when the rewound hero re-crosses the depth. That is correct: the rewound hero re-earns it. Task 12 pins it.
- **Demo hashes drift from Task 2 onward** (schemaVersion, the new `rng.enchanting` key, `hero.tempering`, and content v14's pack hash). Do NOT re-pin mid-plan. Demo/CLI suites are expected-red from Task 2 to Task 13, which re-pins ONCE with per-fixture attribution. **An unexplained delta is a STOP — report BLOCKED, never re-pin over it.** In particular an enchant-free demo must show contentHash + schemaVersion + rng-shape deltas and NOTHING else.
- **Build gotcha:** demo scripts and CLI tests import `packages/engine/dist`, and workspace-scoped vitest does NOT rebuild it. Before any demo/CLI run: `npm run build --workspace @woven-deep/content && npm run build --workspace @woven-deep/engine`.
- **CI-only checks, run before pushing:** `npx prettier --write` on every touched file, `npx depcruise` (no new import cycles — the `depth-band.ts` and `actor-removal.ts` extractions are the standing lessons), `npx knip` (every new export consumed). Keep any new test file well under ~45s.
- **GitNexus:** run `impact({target, direction: "upstream"})` before modifying any existing symbol and report the blast radius; run `detect_changes()` before every commit.
- **TDD is RED-first** everywhere: write the failing test, run it, watch it fail, then implement. **Commits:** conventional, lowercase, no scope (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).
- Branch: `feat/power-curve`. Do not push until Task 14.

## Spec clarifications recorded here (amend-before-deviating)

Each was an under-specification found while mapping the spec onto the code. Task 14 amends the spec document with all eleven.

1. **"Authoritative derived maxima" is implemented as a synchronization pass, not as a rewrite of every reader.** The pure save-schema invariant `health <= maxHealth` (`save-schema/run-record.ts:452-455`) is content-free and cannot consult `deriveRunActorStats`. If readers used derived values while the stored field stayed stale, a +maxHealth item would immediately produce an unsavable run. So `synchronizeDerivedMaxima` recomputes and stores the hero's `maxHealth`/`maxWeave` at the end of every command; every existing reader (`projection.ts:808`, `effects.ts:160`, `survival.ts:331`/`:362`, `rest.ts:50`/`:167`/`:265`, `curse-triggers.ts:77`) then reads an authoritative value with no change of its own. That is the spec's semantics, achieved where the code can actually hold it.
2. **The sync applies to the HERO ACTOR ONLY.** `content-bound-validation.ts:138` pins a champion/echo actor's `maxHealth` to its normalized template health; syncing those actors would break that invariant on the next validation. Monsters carry no equipment and no hero modifiers, so they have nothing to sync.
3. **A dropping maximum clamps current health/weave down, floor 1 for health.** The spec specifies proportional rescaling on temper (a rising max) but is silent on unequipping a +maxHealth item. Clamping down is required — the save invariant demands it — and the floor-1 rule mirrors the temper rescale so a stat swap can never kill the hero.
4. **`spellPower` joins `DERIVED_STAT_NAMES`.** Balance `formulas` are validated and derived per derived-stat name, so expressing spellPower "within the existing linear-formula machinery" means adding it to the closed derived-stat vocabulary (a content change). Equipment and enchantments may therefore grant `+spellPower` for free, which is a feature; curse drawbacks may too, which is consistent with every other stat (only `maxHealth` is forbidden to curses).
5. **The `−10` baseline rides the formula's `base`, not a second knob.** The spec's `floor(max(0, wits − 10) / 4)` is authored as `spellPower: { base: -10, wits: 1 }` plus `spellPowerDivisor: 4`. The linear machinery produces `wits − 10`; the divisor and the zero-floor are applied once, outside it. No `spellPowerBaseline` knob is introduced.
6. **The enchantment table is a closed content KIND, plus a balance block.** `ItemEnchantmentState.enchantmentId` needs a registry-validated id exactly as `ItemCurseState.curseId` does, and #121 already established the pattern for that: a new closed kind. So content v14 adds `kind: 'enchantment'` (pools expressed as per-entry `categories` + `modifiers` + `weight`) and a `balance.enchanting` block for the per-rarity magnitude scaling. This is the spec's "enchantments block" expressed the way this codebase expresses tables.
7. **`temper` is a revision-only command, not a `GameAction`.** The spec says it costs no turn energy — "a reflection, not an action". So it is dispatched in the reducer's modal-command family (beside trade/dialogue/house), before the world branch: no world step, no turn, no energy, no randomness, revision +1.
8. **The chargen attribute base is derived, never stored.** `attributes = base + spent` is enforced as `attributes[a] - spent[a]` landing inside `[attributeMinimum, attributeMaximum]` for every attribute, plus `attributes[a] <= attributeMaximum`. Storing the base would create a second source of truth for a value the run already implies.
9. **spellPower is passed at the spell seams, never inferred inside `resolveEffectSequence`.** `EffectSequenceInput.spellPower?: number` defaults to 0, so item triggers, curse triggers, condition ticks, boss phases, features, and swarm effects get zero by omission — structurally satisfying "not item triggers, not curses" rather than relying on a runtime check. The three seams that pass it are the shared item-spell helpers (`actions.ts:102-130`, `action-dispatch.ts:60-80`) and the `cast` action resolver (`action-dispatch.ts:577-590`). Before implementing, `grep -rn "abilityIds" packages/engine/src` to confirm whether champion/echo ability casting resolves through one of those seams; if it resolves elsewhere, that site passes `spellPower` too (the spec requires monster/champion parity).
10. **Echo-casting ties break by `compareCodeUnits(spellId)`.** "Highest weave cost" alone is not a total order, and standings must be deterministic.
11. **Re-enchant price is the service's authored `basePrice` doubled**, computed at plan time, with the same faction-tier treatment identify already receives. The spec says "double price" without saying which price; the base is the only one the trade machinery has.

## File Map

| Unit | Files | Responsibility |
| --- | --- | --- |
| Authoritative maxima | `packages/engine/src/{derived-maxima.ts (NEW), reducer.ts, floor-transition.ts}` | the sync pass + the inert-modifier fix (Task 1) |
| Save v17 | `packages/engine/src/{versions.ts, model.ts, new-run.ts, save-schema/population.ts, save-schema/migrations.ts, save-codec.ts, save-schema/run-record.ts}` | `hero.tempering`, the `enchanting` stream (Task 2) |
| Content v14 | `packages/content/src/{model/common.ts, model/balance.ts, model/enchantment.ts (NEW), compiler/schema.ts, compiler/schema/balance.ts, compiler/schema/enchantment.ts (NEW), compiler/registries.ts}`, `content/**`, `docs/server-admin/content-configuration.md` | knobs, kind, service id, effect id (Task 3) |
| Milestones | `packages/engine/src/{tempering.ts (NEW), run-metrics.ts, floor-transition.ts, events-model.ts, event-projection.ts}` | banking on depth crossing (Task 4) |
| Temper command | `packages/engine/src/{commands-model.ts, reducer.ts, tempering.ts, save-schema/commands.ts, save-schema/primitives.ts, save-schema/run-record.ts}` | spend + recompute (Task 5) |
| Enchant draws | `packages/engine/src/{enchanting.ts (NEW), content-bound-validation.ts}` | the `enchanting` stream draw (Task 6) |
| Service | `packages/content/src/model/common.ts`, `packages/engine/src/{save-schema/primitives.ts, trade.ts, commerce.ts, projection.ts}`, `content/encounters/town-merchants.yaml` | fourth service (Task 7) |
| Scroll | `packages/content/src/model/common.ts`, `packages/engine/src/{effects.ts, actions.ts}`, `content/items/tempering-steel-scroll.yaml (NEW)`, loot tables | `effect.item.enchant` (Task 8) |
| spellPower | `packages/content/src/model/common.ts`, `packages/engine/src/{attributes.ts, spell-power.ts (NEW), effects.ts, actions.ts, action-dispatch.ts}` | wits-scaled spell output (Task 9) |
| Echo casting | `packages/engine/src/run-finalize.ts` | signature ability capture (Task 10) |
| Client | `apps/web/src/{session/*, ui/overlays/TemperOverlay.tsx (NEW), ui/screens/TradeScreen.tsx}`, `packages/session-core/src/*` | temper UI, enchant UI, log lines (Task 11) |
| Pins | `packages/engine/test/*`, `apps/web/test/*` | score, descent, Wanderer rewind, stream isolation (Task 12) |
| Endgame | fixtures, docs, the spec (Tasks 13-14) |

---

### Task 1: Derived maxima become authoritative (the inert-modifier fix)

**Files:**
- Create: `packages/engine/src/derived-maxima.ts`, `packages/engine/test/derived-maxima.test.ts`
- Modify: `packages/engine/src/reducer.ts` (the world branch, after the action + world step resolve and BEFORE the conclusion boundary), `packages/engine/src/floor-transition.ts` (each transition's returned state)
- Modify: `packages/engine/src/index.ts` (export the module)

**Interfaces — Produces (every later task uses these names exactly):**

```ts
// packages/engine/src/derived-maxima.ts
/**
 * Refreshes the HERO actor's stored `maxHealth`/`maxWeave` from `deriveRunActorStats`, clamping
 * current health and weave into the new bounds. Pure, idempotent, and randomness-free.
 *
 * The stored fields are a CACHE of the derived outputs, not an independent snapshot: `health <=
 * maxHealth` is a content-free save invariant (`save-schema/run-record.ts:452`), so a derived
 * value that readers honored while the stored field stayed stale would make a +maxHealth item
 * produce an unsavable run. Refreshing the cache instead makes every existing reader (HUD, heal
 * caps, rest, the below-half curse crossing) authoritative without touching one of them.
 *
 * Hero only: a champion/echo actor's `maxHealth` is pinned to its normalized template health by
 * `content-bound-validation.ts:138`, and monsters carry neither equipment nor hero modifiers.
 */
export function synchronizeDerivedMaxima(
  state: ActiveRun,
  content: CompiledContentPack,
): ActiveRun;
```

Run `impact({target: "resolveCommand", direction: "upstream"})` and `impact({target: "deriveRunActorStats", direction: "upstream"})` first and report the blast radius.

- [ ] **Step 1: Write the failing tests**

```ts
it('raises the stored maximum when a +maxHealth item is equipped', () => {
  const run = heroWearingNothing();
  const equipped = equipVitalityRing(run); // ring with { maxHealth: +5 }
  const synced = synchronizeDerivedMaxima(equipped, pack);
  expect(heroActor(synced).maxHealth).toBe(heroActor(run).maxHealth + 5);
});

it('lowers the stored maximum and clamps health when the item comes off', () => {
  const worn = synchronizeDerivedMaxima(equipVitalityRing(heroAtFullHealth()), pack);
  const bare = synchronizeDerivedMaxima(unequipVitalityRing(worn), pack);
  expect(heroActor(bare).maxHealth).toBe(heroActor(bare).maxHealth);
  expect(heroActor(bare).health).toBe(heroActor(bare).maxHealth);
});

it('never clamps health below 1', () => {
  const drained = synchronizeDerivedMaxima(heroWithMaxHealthDrainedToZero(), pack);
  expect(heroActor(drained).health).toBeGreaterThanOrEqual(1);
  expect(heroActor(drained).maxHealth).toBeGreaterThanOrEqual(1);
});

it('is idempotent', () => {
  const once = synchronizeDerivedMaxima(equipVitalityRing(heroAtFullHealth()), pack);
  expect(synchronizeDerivedMaxima(once, pack)).toEqual(once);
});

it('consumes no randomness', () => {
  const before = equipVitalityRing(heroAtFullHealth());
  expect(synchronizeDerivedMaxima(before, pack).rng).toEqual(before.rng);
});

it('leaves champion and echo actors untouched', () => {
  const withHaunt = runWithPlacedChampion();
  const synced = synchronizeDerivedMaxima(withHaunt, pack);
  expect(synced.actors.filter((actor) => !actor.playerControlled)).toEqual(
    withHaunt.actors.filter((actor) => !actor.playerControlled),
  );
});
```

The regression matrix the spec asks for — every reader of the stored field — goes in the same file, driven through `resolveCommand` so the sync's placement in the reducer is what is actually proven:

```ts
it('shows the raised maximum on the HUD projection', () => {
  const state = equipViaCommand(heroAtFullHealth(), vitalityRingId);
  expect(projectGameplayState({ state, content: pack }).hero.maxHealth).toBe(baseMax + 5);
});

it('heals up to the raised maximum', () => {
  const state = drinkPotion(equipViaCommand(woundedHero(), vitalityRingId));
  expect(heroActor(state).health).toBeLessThanOrEqual(baseMax + 5);
  expect(heroActor(state).health).toBeGreaterThan(baseMax);
});

it('rests to the raised maximum', () => {
  const state = restUntilHealed(equipViaCommand(woundedHero(), vitalityRingId));
  expect(heroActor(state).health).toBe(baseMax + 5);
});

it('crosses below-half against the raised maximum', () => {
  // The curse trigger fires when 2 * health < maxHealth; the raised bar moves that crossing.
  const state = damageTo(equipViaCommand(heroAtFullHealth(), vitalityRingId), halfOfRaisedMax - 1);
  expect(lastEventsOf(state).some((event) => event.type === 'curse.revealed')).toBe(true);
});

it('restores weave to the raised maximum', () => {
  const state = restUntilHealed(equipViaCommand(spentWeaveHero(), witsRingId));
  expect(heroActor(state).weave).toBe(baseMaxWeave + 3);
});

it('keeps a synced run savable', () => {
  const state = equipViaCommand(heroAtFullHealth(), vitalityRingId);
  const encoded = encodeActiveRun(state);
  expect(encodeActiveRun(decodeActiveRun(encoded, pack))).toBe(encoded);
});
```

If the fixture pack has no `+maxHealth` equipment item, add one to the engine's test fixture pack (not to shipping content) — the point of this task is that such an item finally works.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace @woven-deep/engine -- --run test/derived-maxima.test.ts`
Expected: FAIL — `derived-maxima.js` does not exist, and the stored maximum never moves.

- [ ] **Step 3: Write the implementation**

```ts
const MINIMUM_LIVING_HEALTH = 1;

export function synchronizeDerivedMaxima(
  state: ActiveRun,
  content: CompiledContentPack,
): ActiveRun {
  const hero = state.actors.find((actor) => actor.actorId === state.hero.actorId);
  if (!hero) throw new Error('internal invariant: hero actor does not exist');
  const derived = deriveRunActorStats({ state, content, actor: hero });
  const maxHealth = Math.max(MINIMUM_LIVING_HEALTH, derived.maxHealth);
  const maxWeave = Math.max(0, derived.maxWeave);
  if (!Number.isSafeInteger(maxHealth) || !Number.isSafeInteger(maxWeave)) {
    throw new RangeError('derived maxima must be safe integers');
  }
  // A dead hero stays dead: the conclusion boundary owns health 0, and floor-1 clamping here
  // would resurrect a corpse between the killing blow and `concludeRunOnHeroDeath`.
  const health =
    hero.health === 0 ? 0 : Math.min(Math.max(MINIMUM_LIVING_HEALTH, hero.health), maxHealth);
  const weave = Math.min(hero.weave, maxWeave);
  if (hero.maxHealth === maxHealth && hero.maxWeave === maxWeave && hero.health === health && hero.weave === weave) {
    return state;
  }
  return withActor(state, { ...hero, maxHealth, maxWeave, health, weave });
}
```

Call it from exactly two places:
- `reducer.ts`'s world branch, on the post-world-step state, **before** the `concludeRunOnHeroDeath` boundary — so a maximum that drops as a condition expires cannot leave the run unsavable, and so the conclusion sees the same numbers the player will.
- `floor-transition.ts`, on each transition's returned state (descend generated/stored, the Final Chamber, ascend, both recalls) — transitions bypass `resolveCommand` entirely.

Do NOT call it from `new-run.ts`: `createNewRun` already derives the maxima from the same formulas, and an extra pass there would be a no-op that only risks moving a pinned digest.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace @woven-deep/engine -- --run test/derived-maxima.test.ts` then the engine suite excluding `*-demo`/`*-cli` files, then `npm run typecheck`.
Expected: PASS. Demo digests should NOT move for this task — nothing in shipping content grants `maxHealth`, so the sync is a no-op on every demo transcript. **If a demo digest moves here, that is unexplained: stop and report BLOCKED.**

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "fix: make derived maxima authoritative so max-health modifiers finally apply"
```

---

### Task 2: Save v17 — `hero.tempering` and the `enchanting` stream

**Files:**
- Modify: `packages/engine/src/versions.ts:1` (`SAVE_SCHEMA_VERSION = 17`) and `:5-17` (`RNG_STREAM_NAMES` + `'enchanting'`), `packages/engine/src/model.ts` (the `schemaVersion: 17` literal, `HeroState.tempering`), `packages/engine/src/new-run.ts:370-385` (the constructed hero), `packages/engine/src/save-schema/population.ts:38-48` (the `hero` object), `packages/engine/src/save-schema/migrations.ts` (freeze two schemas; rewire the hero references), `packages/engine/src/save-codec.ts` (import + `migrateV16ToV17` + the chain), `packages/engine/src/save-schema/run-record.ts` (the `attributes = base + spent` invariant)
- Test: `packages/engine/test/save-codec.test.ts`, `packages/engine/test/new-run.test.ts`

**Interfaces — Produces (every later task uses these names exactly):**

```ts
// packages/engine/src/model.ts
export interface HeroTemperingState {
  /** Milestone points earned and not yet spent. Never negative. */
  readonly banked: number;
  /** How many points have been spent on each attribute, kept so the UI can tell the story and so
   * validation can pin `attributes = chargen base + spent`. */
  readonly spent: Readonly<Record<AttributeName, number>>;
}
// HeroState gains, after `statModifiers`:
readonly tempering: HeroTemperingState;

// packages/engine/src/versions.ts -- RNG_STREAM_NAMES gains, appended LAST:
  'enchanting',
```

Zod mirror (`packages/engine/src/save-schema/population.ts`, inside the `hero` object):

```ts
  tempering: z.strictObject({
    banked: safeNonNegative,
    spent: z.strictObject({
      might: safeNonNegative,
      agility: safeNonNegative,
      vitality: safeNonNegative,
      wits: safeNonNegative,
      resolve: safeNonNegative,
    }),
  }),
```

Run `impact({target: "deriveRngStreams", direction: "upstream"})` first and report the blast radius.

- [ ] **Step 1: Write the failing tests**

```ts
it('migrates a v16 save to zeroed tempering and a seed-derived enchanting stream', () => {
  const v16 = { ...structuredClone(encodedFixture()), schemaVersion: 16 };
  delete (v16.hero as Record<string, unknown>).tempering;
  delete (v16.rng as Record<string, unknown>).enchanting;
  const decoded = decodeActiveRun(JSON.stringify(v16), pack);
  expect(decoded.schemaVersion).toBe(17);
  expect(decoded.hero.tempering).toEqual({
    banked: 0,
    spent: { might: 0, agility: 0, vitality: 0, wits: 0, resolve: 0 },
  });
  expect(decoded.rng.enchanting).toEqual(deriveRngStreams(decoded.runSeed).enchanting);
});

it('defaults tempering and the enchanting stream for every legacy entry version', () => {
  for (const version of [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] as const) {
    const decoded = decodeActiveRun(JSON.stringify(legacyFixtureAtVersion(version)), pack);
    expect(decoded.schemaVersion).toBe(17);
    expect(decoded.hero.tempering.banked).toBe(0);
    expect(decoded.rng.enchanting).toEqual(deriveRngStreams(decoded.runSeed).enchanting);
  }
});

it('leaves every pre-existing stream state untouched by the migration', () => {
  const v16 = legacyFixtureAtVersion(16);
  const decoded = decodeActiveRun(JSON.stringify(v16), pack);
  for (const stream of Object.keys(v16.rng) as (keyof typeof v16.rng)[]) {
    expect(decoded.rng[stream]).toEqual(v16.rng[stream]);
  }
});

it('round-trips a tempered hero byte-identically', () => {
  const run = withTempering(baseRun(), { banked: 2, spent: { might: 1, agility: 0, vitality: 3, wits: 0, resolve: 0 } });
  const encoded = encodeActiveRun(run);
  expect(encodeActiveRun(decodeActiveRun(encoded, pack))).toBe(encoded);
});

it('rejects spent points the attributes cannot account for', () => {
  const run = withTempering(baseRunWithAttributes({ vitality: 2 }), {
    banked: 0,
    spent: { might: 0, agility: 0, vitality: 5, wits: 0, resolve: 0 },
  });
  expect(() => decodeActiveRun(encodeActiveRun(run), pack)).toThrow(/tempering/);
});

it('rejects a negative banked count', () => {
  const run = withTempering(baseRun(), { banked: -1, spent: zeroSpent() });
  expect(() => decodeActiveRun(encodeActiveRun(run), pack)).toThrow(/banked/);
});

it('starts a new run with zeroed tempering', () => {
  expect(createNewRun({ pack, seed, hero }).hero.tempering).toEqual({
    banked: 0,
    spent: { might: 0, agility: 0, vitality: 0, wits: 0, resolve: 0 },
  });
});
```

`legacyFixtureAtVersion` must produce **genuine** pre-tempering blobs — no `tempering` key, no `enchanting` stream. A fixture derived from a current encode proves nothing.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace @woven-deep/engine -- --run test/save-codec.test.ts test/new-run.test.ts`
Expected: FAIL — `tempering` is an unrecognized key under `strictObject`.

- [ ] **Step 3: Write the implementation, in this order**

1. **Freeze first, sub-schema included.** In `save-schema/migrations.ts`:
   - Add `legacyHeroPreTempering` — a literal copy of today's live `hero` object (actorId, name, sightRadius, backpackCapacity, currency, classTags, statModifiers, optional knownSpellIds) with NO `tempering`. Leave the existing `legacyHero` (the v4-era four-field shape) exactly as it is.
   - **Rewire every reference.** `grep -n 'hero,' packages/engine/src/save-schema/migrations.ts` and point every legacy top-level schema that embeds the live `hero` at `legacyHeroPreTempering`, dropping `hero` from the import list. A surviving live reference makes a genuine old save require the new field — the standing #121 Task-3 failure.
   - Add `legacyActiveRunV16Schema`, a frozen literal snapshot of today's live `activeRunSchema` with `schemaVersion: z.literal(16)`, using `legacyHeroPreTempering` and — critically — `legacyV12RngEntries` for `rng` (a v16 save carries the eleven-stream list; `LEGACY_V12_RNG_STREAM_NAMES` stays frozen and untouched).
2. `versions.ts`: `SAVE_SCHEMA_VERSION = 17`, and append `'enchanting'` to `RNG_STREAM_NAMES` **last** so the derivation order of the existing streams is unchanged (verify `deriveRngStreams` derives per-name rather than positionally before relying on this; if it is positional, appending last is what preserves every existing stream's seed).
3. `model.ts`: `HeroTemperingState`, `HeroState.tempering`, `schemaVersion: 17`.
4. `save-schema/population.ts`: the `tempering` zod object above inside `hero`.
5. `new-run.ts`: `tempering: { banked: 0, spent: { might: 0, agility: 0, vitality: 0, wits: 0, resolve: 0 } }` on the constructed hero.
6. Migration in `save-codec.ts`, immediately after `migrateV15ToV16`:

```ts
// Two additive facts, neither of which any older save could have had: nobody had banked a
// tempering point before tempering existed, and the `enchanting` stream is synthesized from the
// run seed exactly the way `loot-placement` was synthesized at the v11->v12 bump -- so a resumed
// legacy run enchants on the same stream a fresh run of that seed would have used.
function migrateV16ToV17(input: unknown): unknown {
  const v16 = legacyActiveRunV16Schema.parse(input);
  const derived = deriveRngStreams(v16.runSeed);
  return {
    ...v16,
    schemaVersion: 17,
    rng: { ...v16.rng, enchanting: derived.enchanting },
    hero: {
      ...v16.hero,
      tempering: {
        banked: 0,
        spent: { might: 0, agility: 0, vitality: 0, wits: 0, resolve: 0 },
      },
    },
  };
}
```

   Widen the `migrateLegacy` `schemaVersion` union to `4 | ... | 16`, wrap every existing chain arm in `migrateV16ToV17(...)`, and add the `schemaVersion === 16` arm.
7. `save-schema/run-record.ts`, in `validateSemantics` beside the other hero invariants:

```ts
  // The chargen base is DERIVED, never stored: a second copy of it would be a second source of
  // truth for a number the run already implies. Every spent point must therefore be accounted for
  // by the attribute it was spent on, and no attribute may exceed the lifetime cap.
  for (const [attribute, spent] of Object.entries(run.hero.tempering.spent) as [
    AttributeName,
    number,
  ][]) {
    const base = savedHeroActor.attributes[attribute] - spent;
    if (!Number.isSafeInteger(base) || base < 0) {
      fail(`hero.tempering.spent.${attribute}`, 'spent tempering exceeds the attribute itself');
    }
  }
```

   The `attributeMaximum` bound is content-dependent, so it lives in `content-bound-validation.ts` instead — add it there in Task 5 alongside the command that can reach the cap.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace @woven-deep/engine -- --run test/save-codec.test.ts test/new-run.test.ts`, the engine non-demo suite, `npm run typecheck`.
Expected: PASS. Demo/CLI suites are now expected-red through Task 12.

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat: save schema v17 with hero tempering and the enchanting stream"
```

---

### Task 3: Content v14 — knobs, the `enchantment` kind, the service and effect ids

**Files:**
- Create: `packages/content/src/model/enchantment.ts`, `packages/content/src/compiler/schema/enchantment.ts`, `content/enchantments/core-enchantments.yaml`
- Modify: `packages/content/src/model/common.ts` (`CONTENT_SCHEMA_VERSION = 14`, `CONTENT_KIND_IDS`, the `ContentEntry` union, `DERIVED_STAT_NAMES` + `'spellPower'`, `MERCHANT_SERVICE_IDS` + `'merchant-service.enchant'`, `EFFECT_IDS` + `'effect.item.enchant'`), `packages/content/src/model/balance.ts`, `packages/content/src/compiler/schema.ts`, `packages/content/src/compiler/schema/balance.ts`, `packages/content/src/compiler/registries.ts`, `packages/content/src/index.ts`
- Modify: `content/balance/core-gameplay.yaml`, every `schemaVersion: 13` envelope → 14 (sweep across `content/`), `docs/server-admin/content-configuration.md`
- Test: the content parse/validation suite

**Interfaces — Produces:**

```ts
// packages/content/src/model/enchantment.ts
import type { BaseContentEntry, DerivedStatName, ItemCategory } from './common.js';

export interface EnchantmentContentEntry extends BaseContentEntry {
  readonly kind: 'enchantment';
  /** Item categories this enchantment may be drawn for. Never includes `currency`. */
  readonly categories: readonly ItemCategory[];
  /** Strictly POSITIVE derived-stat modifiers. Enchanting is a gamble about magnitude, never
   * about sign: a drawback is what a curse is for. */
  readonly modifiers: Readonly<Record<DerivedStatName, number>>;
  /** Relative draw weight within its eligible pool. */
  readonly weight: number;
}

// packages/content/src/model/balance.ts -- BalanceContentEntry gains:
readonly tempering: Readonly<{ depths: readonly number[] }>;
readonly spellPowerDivisor: number;
readonly enchanting: Readonly<{
  /** Magnitude scaling per item rarity, in basis points of the authored modifier. */
  readonly rarityMagnitudeBps: Readonly<Record<ItemRarity, number>>;
}>;
// and `formulas` gains the authored `spellPower` entry (see below).
```

- [ ] **Step 1: Write the failing tests**

```ts
it('compiles an enchantment entry', async () => {
  const pack = await compileSource(enchantmentSource({}));
  expect(pack.entries.find((entry) => entry.kind === 'enchantment')).toMatchObject({
    id: 'enchantment.keen-edge',
    categories: ['weapon'],
    modifiers: { meleeAccuracy: 1 },
    weight: 10,
  });
});

it('rejects a non-positive enchantment modifier', async () => {
  await expect(compileSource(enchantmentSource({ modifiers: { defense: -1 } }))).rejects.toThrow(
    /positive/,
  );
});

it('rejects an unknown derived stat in an enchantment', async () => {
  await expect(compileSource(enchantmentSource({ modifiers: { luck: 1 } }))).rejects.toThrow(/luck/);
});

it('rejects an enchantment with no eligible category', async () => {
  await expect(compileSource(enchantmentSource({ categories: [] }))).rejects.toThrow(/categories/);
});

it('rejects a currency category', async () => {
  await expect(compileSource(enchantmentSource({ categories: ['currency'] }))).rejects.toThrow(
    /currency/,
  );
});

it('compiles the tempering, spellPower, and enchanting balance knobs', async () => {
  const balance = balanceEntry(await compileShippingPack());
  expect(balance.tempering.depths).toEqual([3, 6, 9, 12, 15, 18]);
  expect(balance.spellPowerDivisor).toBe(4);
  expect(balance.formulas.spellPower).toEqual({ base: -10, wits: 1 });
  expect(balance.enchanting.rarityMagnitudeBps.legendary).toBeGreaterThan(
    balance.enchanting.rarityMagnitudeBps.common,
  );
});

it('rejects unsorted or duplicated tempering depths', async () => {
  await expect(compileSource(balanceSource({ temperingDepths: [6, 3] }))).rejects.toThrow(/depths/);
  await expect(compileSource(balanceSource({ temperingDepths: [3, 3] }))).rejects.toThrow(/depths/);
});

it('rejects a zero spellPowerDivisor', async () => {
  await expect(compileSource(balanceSource({ spellPowerDivisor: 0 }))).rejects.toThrow(/divisor/);
});

it('knows the fourth merchant service and the enchant effect', () => {
  expect(MERCHANT_SERVICE_IDS).toContain('merchant-service.enchant');
  expect(EFFECT_IDS).toContain('effect.item.enchant');
  expect(DERIVED_STAT_NAMES).toContain('spellPower');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace @woven-deep/content`
Expected: FAIL — `kind: enchantment` is not a member of the discriminated union and the knobs do not exist.

- [ ] **Step 3: Write the implementation**

`packages/content/src/compiler/schema/enchantment.ts`:

```ts
import { z } from 'zod';
import { DERIVED_STAT_NAMES, ITEM_CATEGORIES } from '../../model/common.js';
import { base, safePositive } from './common.js';

const ENCHANTABLE_CATEGORIES = ITEM_CATEGORIES.filter((category) => category !== 'currency');

export const enchantmentEntry = z.strictObject({
  ...base,
  kind: z.literal('enchantment'),
  categories: z
    .array(z.enum(ENCHANTABLE_CATEGORIES as [string, ...string[]]))
    .min(1)
    .readonly(),
  // Positive only: enchanting gambles on magnitude, never on sign. A drawback is a curse's job,
  // and #121's compile rule already owns that half of the design.
  modifiers: z.record(z.enum(DERIVED_STAT_NAMES), safePositive).refine(
    (value) => Object.keys(value).length > 0,
    { message: 'an enchantment must grant at least one positive modifier' },
  ),
  weight: safePositive,
});
```

`packages/content/src/compiler/schema/balance.ts`, inside the same `strictObject`:

```ts
    tempering: z.strictObject({
      depths: z
        .array(z.number().int().safe().positive())
        .min(1)
        .refine(
          (values) => values.every((value, index) => index === 0 || value > values[index - 1]!),
          { message: 'tempering depths must be strictly ascending' },
        )
        .readonly(),
    }),
    spellPowerDivisor: z.number().int().safe().min(1),
    enchanting: z.strictObject({
      rarityMagnitudeBps: z.strictObject({
        common: safePositive,
        uncommon: safePositive,
        rare: safePositive,
        legendary: safePositive,
      }),
    }),
```

`content/balance/core-gameplay.yaml`:

```yaml
    formulas:
      # ...existing entries, unchanged...
      spellPower: { base: -10, wits: 1 }
    tempering:
      depths: [3, 6, 9, 12, 15, 18]
    spellPowerDivisor: 4
    enchanting:
      rarityMagnitudeBps: { common: 10000, uncommon: 12500, rare: 15000, legendary: 20000 }
```

`content/enchantments/core-enchantments.yaml` — at least one entry per enchantable category so no eligible item can ever draw from an empty pool (Task 6 asserts that invariant):

```yaml
schemaVersion: 14
entries:
  - kind: enchantment
    id: enchantment.keen-edge
    name: Keen Edge
    tags: [enchantment, weapon]
    categories: [weapon]
    modifiers: { meleeAccuracy: 1 }
    weight: 10

  - kind: enchantment
    id: enchantment.hungering-bite
    name: Hungering Bite
    tags: [enchantment, weapon]
    categories: [weapon]
    modifiers: { meleeDamageBonus: 1 }
    weight: 6

  - kind: enchantment
    id: enchantment.warded-plate
    name: Warded Plate
    tags: [enchantment, armor]
    categories: [armor, shield]
    modifiers: { defense: 1 }
    weight: 10

  - kind: enchantment
    id: enchantment.deep-lungs
    name: Deep Lungs
    tags: [enchantment, armor]
    categories: [armor, ring]
    modifiers: { maxHealth: 3 }
    weight: 4

  - kind: enchantment
    id: enchantment.woven-thought
    name: Woven Thought
    tags: [enchantment, ring]
    categories: [ring]
    modifiers: { maxWeave: 2, spellPower: 1 }
    weight: 4

  - kind: enchantment
    id: enchantment.steady-flame
    name: Steady Flame
    tags: [enchantment, light]
    categories: [light]
    modifiers: { lightOutRevealRadius: 1 }
    weight: 8
```

`enchantment.deep-lungs` is deliberate: it is the first shipping item modifier that grants `maxHealth`, which is exactly the bug Task 1 fixed. Add an engine test in Task 6 asserting an item carrying it raises the hero's bar.

Wire `enchantmentEntry` into `contentSourceEntrySchema`, add `'enchantment'` to `CONTENT_KIND_IDS` and `EnchantmentContentEntry` to the `ContentEntry` union, re-export the model, add `'spellPower'` to `DERIVED_STAT_NAMES`, `'merchant-service.enchant'` to `MERCHANT_SERVICE_IDS`, `'effect.item.enchant'` to `EFFECT_IDS`, set `CONTENT_SCHEMA_VERSION = 14`, sweep every `schemaVersion: 13` envelope to 14, and add the v14 migration note to `docs/server-admin/content-configuration.md` covering: the `enchantment` kind, the `tempering`/`spellPowerDivisor`/`enchanting` balance knobs, the required `formulas.spellPower` entry, `merchant-service.enchant`, and `effect.item.enchant`.

Note that adding `'spellPower'` to `DERIVED_STAT_NAMES` makes `formulas.spellPower` REQUIRED for every pack (`deriveActorStats` throws for a missing formula), which is why the YAML entry above is not optional.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace @woven-deep/content && npm run content:validate && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/content content docs/server-admin/content-configuration.md
git commit -m "feat: content schema v14 with enchantments, tempering, and spell power knobs"
```

---

### Task 4: Milestone banking

**Files:**
- Create: `packages/engine/src/tempering.ts`, `packages/engine/test/tempering.test.ts`
- Modify: `packages/engine/src/floor-transition.ts` (after `metrics.deepestDepth` updates), `packages/engine/src/events-model.ts`, `packages/engine/src/event-projection.ts`
- Modify: `packages/engine/src/index.ts`

**Interfaces — Produces:**

```ts
// packages/engine/src/tempering.ts
/**
 * Banks one tempering point for every authored milestone depth the run has now reached but had
 * not before. Facts derived from `metrics.deepestDepth` and the already-spent history -- zero
 * randomness, no per-monster data, no kill grinding. Reaching several milestones in one
 * transition (theoretical) banks several points.
 */
export function grantTemperingMilestones(
  input: Readonly<{
    state: ActiveRun;
    content: CompiledContentPack;
    previousDeepestDepth: number;
    eventId: OpaqueId;
  }>,
): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }>;

// packages/engine/src/events-model.ts
export interface HeroTemperingBankedEvent {
  readonly type: 'hero.tempering-banked';
  readonly eventId: OpaqueId;
  readonly depth: number;
  readonly banked: number;
}
```

**Consumes:** `hero.tempering` (Task 2); `balance.tempering.depths` (Task 3).

Run `impact({target: "descendToNextFloor", direction: "upstream"})` first and report the blast radius.

- [ ] **Step 1: Write the failing tests**

```ts
it('banks a point the first time a milestone depth is reached', () => {
  const { state, events } = grantTemperingMilestones({
    state: runAtDepth(3),
    content: pack,
    previousDeepestDepth: 2,
    eventId: 'e1',
  });
  expect(state.hero.tempering.banked).toBe(1);
  expect(events).toContainEqual(expect.objectContaining({ type: 'hero.tempering-banked', depth: 3, banked: 1 }));
});

it('does not bank again for the same depth', () => {
  const first = grantTemperingMilestones({ state: runAtDepth(3), content: pack, previousDeepestDepth: 2, eventId: 'e1' });
  const second = grantTemperingMilestones({ state: first.state, content: pack, previousDeepestDepth: 3, eventId: 'e2' });
  expect(second.state.hero.tempering.banked).toBe(1);
  expect(second.events).toEqual([]);
});

it('banks several points when several milestones are crossed at once', () => {
  const { state, events } = grantTemperingMilestones({
    state: runAtDepth(7),
    content: pack,
    previousDeepestDepth: 2,
    eventId: 'e1',
  });
  expect(state.hero.tempering.banked).toBe(2); // depths 3 and 6
  expect(events).toHaveLength(2);
});

it('banks nothing between milestones', () => {
  const { state, events } = grantTemperingMilestones({ state: runAtDepth(5), content: pack, previousDeepestDepth: 4, eventId: 'e1' });
  expect(state.hero.tempering.banked).toBe(0);
  expect(events).toEqual([]);
});

it('counts already-spent points as earned, so a spent milestone never re-banks', () => {
  const spentAtThree = withTempering(runAtDepth(3), { banked: 0, spent: { ...zeroSpent(), might: 1 } });
  const { state } = grantTemperingMilestones({ state: spentAtThree, content: pack, previousDeepestDepth: 3, eventId: 'e1' });
  expect(state.hero.tempering.banked).toBe(0);
});

it('consumes no randomness', () => {
  const before = runAtDepth(3);
  expect(grantTemperingMilestones({ state: before, content: pack, previousDeepestDepth: 2, eventId: 'e1' }).state.rng)
    .toEqual(before.rng);
});

it('banks on a real descent through the transition path', () => {
  const transition = descendToNextFloor(runOnStairDownAtDepth(2), { content: pack });
  expect(transition.state.hero.tempering.banked).toBe(1);
  expect(transition.events).toContainEqual(expect.objectContaining({ type: 'hero.tempering-banked' }));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace @woven-deep/engine -- --run test/tempering.test.ts`
Expected: FAIL — `tempering.js` does not exist.

- [ ] **Step 3: Write the implementation**

```ts
/** Points this run has already earned: banked plus every point already spent. Milestones are
 * idempotent against this total, which is what makes "first time reached" survive spending. */
function earnedPoints(tempering: HeroTemperingState): number {
  return (
    tempering.banked +
    Object.values(tempering.spent).reduce((total, spent) => total + spent, 0)
  );
}

export function grantTemperingMilestones(
  input: Readonly<{ state: ActiveRun; content: CompiledContentPack; previousDeepestDepth: number; eventId: OpaqueId }>,
): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  const { depths } = balanceEntry(input.content).tempering;
  const reachedNow = depths.filter((depth) => depth <= input.state.metrics.deepestDepth);
  const earned = earnedPoints(input.state.hero.tempering);
  // Milestones are ordered and cumulative, so "how many are owed" is a subtraction, not a diff of
  // two depth sets: it stays correct across a Wanderer rewind (which lowers `deepestDepth` AND
  // restores the earned total together, so re-crossing genuinely re-earns) and across a save
  // written by a build with a shorter milestone list.
  const owed = Math.max(0, reachedNow.length - earned);
  if (owed === 0) return { state: input.state, events: [] };
  const newly = reachedNow.slice(reachedNow.length - owed);
  const banked = input.state.hero.tempering.banked + owed;
  if (!Number.isSafeInteger(banked)) throw new RangeError('banked tempering overflowed');
  return {
    state: { ...input.state, hero: { ...input.state.hero, tempering: { ...input.state.hero.tempering, banked } } },
    events: newly.map((depth, index) => ({
      type: 'hero.tempering-banked' as const,
      eventId: `${input.eventId}.temper-${String(index)}`,
      depth,
      banked: input.state.hero.tempering.banked + index + 1,
    })),
  };
}
```

Call it from `floor-transition.ts` in every path that can raise `deepestDepth`, immediately after the metrics update and before `synchronizeDerivedMaxima` (Task 1), passing the pre-transition `metrics.deepestDepth`. Add `HeroTemperingBankedEvent` to the `DomainEvent` union, a pass-through case in `event-projection.ts` (it is the player's own progress — hero-visible), and the presentation-kind member `'hero-tempering-banked'`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace @woven-deep/engine -- --run test/tempering.test.ts test/floor-transition.test.ts` then the engine non-demo suite.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat: bank a tempering point at every depth milestone"
```

---

### Task 5: The `temper` command and the recompute

**Files:**
- Modify: `packages/engine/src/commands-model.ts` (`TemperCommand`, the `GameCommand` union, `InvalidActionReason` + two members), `packages/engine/src/reducer.ts` (the modal-command family), `packages/engine/src/tempering.ts` (`resolveTemper`), `packages/engine/src/save-schema/commands.ts`, `packages/engine/src/save-schema/primitives.ts` (the live `blockReason` enum), `packages/engine/src/save-schema/run-record.ts` (the reason↔command coupling), `packages/engine/src/content-bound-validation.ts` (the `attributeMaximum` bound), `packages/engine/src/events-model.ts` + `event-projection.ts` (`hero.tempered`)
- Test: `packages/engine/test/tempering.test.ts`, `packages/engine/test/save-codec.test.ts`

**Interfaces — Produces:**

```ts
// packages/engine/src/commands-model.ts
export interface TemperCommand extends CommandEnvelope {
  readonly type: 'temper';
  readonly attribute: AttributeName;
}
// InvalidActionReason gains exactly two members:
| 'temper.unavailable'   // no banked point
| 'temper.capped'        // that attribute is already at attributeMaximum

// packages/engine/src/tempering.ts
/**
 * Spends one banked point on `attribute`: +1 to the attribute, the stored maxima recomputed from
 * the formulas, and current health/weave rescaled proportionally in checked-integer quotient math
 * so a tempered hero is never healed or hurt by the change alone. Pure and randomness-free.
 */
export function resolveTemper(
  input: Readonly<{
    state: ActiveRun;
    content: CompiledContentPack;
    attribute: AttributeName;
    eventId: OpaqueId;
  }>,
): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }>;

// packages/engine/src/events-model.ts
export interface HeroTemperedEvent {
  readonly type: 'hero.tempered';
  readonly eventId: OpaqueId;
  readonly attribute: AttributeName;
  readonly value: number;      // the attribute's new value
  readonly remaining: number;  // points still banked
}
```

**Consumes:** `hero.tempering` (Task 2); `synchronizeDerivedMaxima` (Task 1); `balance.attributeMaximum`.

Run `impact({target: "resolveCommand", direction: "upstream"})` first and report the blast radius.

- [ ] **Step 1: Write the failing tests**

```ts
it('spends a banked point and raises the attribute', () => {
  const { state, events } = resolveTemper({ state: heroWithBankedPoints(1), content: pack, attribute: 'vitality', eventId: 'e1' });
  expect(heroActor(state).attributes.vitality).toBe(baseVitality + 1);
  expect(state.hero.tempering).toEqual({ banked: 0, spent: { ...zeroSpent(), vitality: 1 } });
  expect(events).toContainEqual(expect.objectContaining({ type: 'hero.tempered', attribute: 'vitality', remaining: 0 }));
});

it('recomputes the maxima from the formulas', () => {
  const { state } = resolveTemper({ state: heroWithBankedPoints(1), content: pack, attribute: 'vitality', eventId: 'e1' });
  expect(heroActor(state).maxHealth).toBe(baseMaxHealth + 1); // maxHealth { base: 10, vitality: 1 }
});

it('keeps a full-health hero at full health', () => {
  const { state } = resolveTemper({ state: fullHealthHeroWithPoint(), content: pack, attribute: 'vitality', eventId: 'e1' });
  expect(heroActor(state).health).toBe(heroActor(state).maxHealth);
});

it('scales a wounded hero proportionally', () => {
  // health 10 / max 20 -> max 21 -> floor(10 * 21 / 20) = 10
  const { state } = resolveTemper({ state: woundedHeroWithPoint({ health: 10, maxHealth: 20 }), content: pack, attribute: 'vitality', eventId: 'e1' });
  expect(heroActor(state).maxHealth).toBe(21);
  expect(heroActor(state).health).toBe(10);
});

it('never drops a living hero below 1 health', () => {
  const { state } = resolveTemper({ state: oneHealthHeroWithPoint(), content: pack, attribute: 'vitality', eventId: 'e1' });
  expect(heroActor(state).health).toBeGreaterThanOrEqual(1);
});

it('scales weave the same way', () => {
  const { state } = resolveTemper({ state: heroWithBankedPoints(1), content: pack, attribute: 'wits', eventId: 'e1' });
  expect(heroActor(state).maxWeave).toBe(baseMaxWeave + 1);
});

it('consumes no randomness and no turn', () => {
  const before = heroWithBankedPoints(1);
  const { state } = resolveTemper({ state: before, content: pack, attribute: 'might', eventId: 'e1' });
  expect(state.rng).toEqual(before.rng);
  expect(state.turn).toBe(before.turn);
  expect(state.worldTime).toBe(before.worldTime);
  expect(heroActor(state).energy).toBe(heroActor(before).energy);
});

it('rejects a temper with no banked point', () => {
  const resolved = resolveCommand(heroWithBankedPoints(0), temperCommand('might'), { content: pack });
  expect(resolved.result).toMatchObject({ status: 'invalid', reason: 'temper.unavailable' });
});

it('rejects a temper on a capped attribute while alternatives exist', () => {
  const resolved = resolveCommand(heroWithCappedMight(), temperCommand('might'), { content: pack });
  expect(resolved.result).toMatchObject({ status: 'invalid', reason: 'temper.capped' });
});

it('holds points forever when every attribute is capped', () => {
  const state = heroWithEveryAttributeCapped(2);
  for (const attribute of ATTRIBUTE_NAMES) {
    expect(resolveCommand(state, temperCommand(attribute), { content: pack }).result).toMatchObject({
      status: 'invalid',
      reason: 'temper.capped',
    });
  }
  expect(state.hero.tempering.banked).toBe(2);
});

it('rejects a temper on a concluded run', () => {
  expect(resolveCommand(concludedRun(), temperCommand('might'), { content: pack }).result).toMatchObject({
    reason: 'run.concluded',
  });
});

it('persists a rejected temper without throwing', () => {
  const rejected = resolveCommand(heroWithBankedPoints(0), temperCommand('might'), { content: pack });
  const encoded = encodeActiveRun(rejected.state);
  expect(encodeActiveRun(decodeActiveRun(encoded, pack))).toBe(encoded);
});

it('round-trips an applied temper', () => {
  const applied = resolveCommand(heroWithBankedPoints(1), temperCommand('vitality'), { content: pack });
  const encoded = encodeActiveRun(applied.state);
  expect(encodeActiveRun(decodeActiveRun(encoded, pack))).toBe(encoded);
});
```

The two persistence tests are not optional: without the reason↔command coupling, an invalid `temper` result fails `validateActiveRun` the moment it is recorded.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace @woven-deep/engine -- --run test/tempering.test.ts`
Expected: FAIL — `'temper'` is not a `GameCommand`.

- [ ] **Step 3: Write the implementation**

`resolveTemper`'s rescale, in checked quotient math:

```ts
/** `value * newMax / oldMax`, floored, with a living floor of 1. Quotient division on safe
 * integers -- never a float that survives the expression. */
function rescale(value: number, oldMax: number, newMax: number, floor: number): number {
  if (![value, oldMax, newMax].every(Number.isSafeInteger)) {
    throw new RangeError('rescale operands must be safe integers');
  }
  if (oldMax <= 0) return Math.min(Math.max(floor, value), newMax);
  const numerator = value * newMax;
  if (!Number.isSafeInteger(numerator)) throw new RangeError('rescale overflowed');
  return Math.min(newMax, Math.max(floor, Math.trunc(numerator / oldMax)));
}
```

`resolveTemper` then: increments the attribute on the hero actor, increments `spent[attribute]`, decrements `banked`, derives the new maxima through `deriveRunActorStats`, rescales `health` (floor 1) and `weave` (floor 0), and emits `hero.tempered`. Call `synchronizeDerivedMaxima` on the result as a belt-and-braces idempotent pass so the stored cache and the derived value can never disagree.

Reducer wiring — `temper` joins the revision-only family, dispatched beside the `final-chamber-choice` gate and BEFORE the world branch (spec clarification 7):

```ts
  if (command.type === 'temper') {
    const validation = validateTemperCommand({ state: current, command, content: context.content });
    if (!validation.ok) {
      return recordInvalid(current, context.content, command, validation.reason, preEvents, prePublicEvents);
    }
    assertCountersCanAdvance(current, false);
    // Revision only: tempering is a reflection, not an action. No turn, no world time, no energy,
    // no survival tick, and no randomness -- exactly the trade/dialogue/house posture.
    const result = {
      status: 'applied',
      commandId: command.commandId,
      revision: current.revision + 1,
      turn: current.turn,
    } as const;
    const resolved = resolveTemper({ state: current, content: context.content, attribute: command.attribute, eventId: command.commandId });
    /* …record + project exactly as the trade branch does… */
  }
```

`validateTemperCommand` returns `{ ok: false, reason: 'temper.unavailable' }` when `banked === 0` and `{ ok: false, reason: 'temper.capped' }` when the chosen attribute is already at `balance.attributeMaximum` (regardless of whether alternatives exist — the all-capped case is simply every choice returning `temper.capped`, which is the spec's "points bank harmlessly forever").

Schema and validation:
- `save-schema/commands.ts`: `z.strictObject({ ...commandBase, type: z.literal('temper'), attribute: z.enum(ATTRIBUTE_NAMES) })`.
- `save-schema/primitives.ts`: add both reasons to the LIVE `blockReason` enum only.
- `save-schema/run-record.ts` (~`:2150-2234`): add `const temperCommand = recordValue.command.type === 'temper';` and `const temperReason = recordValue.result.reason === 'temper.unavailable' || recordValue.result.reason === 'temper.capped';`, then `if (temperReason && !temperCommand) fail(...'temper reason requires a temper command')`, and add `temperReason` to the final catch-all `non-movement command reason is inconsistent` disjunction. **This is the whole point of the two persistence tests above.**
- `content-bound-validation.ts`: assert every hero attribute is `<= balanceEntry(pack).attributeMaximum` and that `attributes[a] - tempering.spent[a] >= balanceEntry(pack).attributeMinimum`, completing the derived-base invariant Task 2 started in the content-free half.
- `events-model.ts` / `event-projection.ts`: `HeroTemperedEvent` in the `DomainEvent` union, a hero-visible pass-through, and the presentation-kind member `'hero-tempered'`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace @woven-deep/engine -- --run test/tempering.test.ts test/save-codec.test.ts` then the engine non-demo suite and `npm run typecheck`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat: add the temper command and its stat recompute"
```

---

### Task 6: Enchantment draws on the `enchanting` stream

**Files:**
- Create: `packages/engine/src/enchanting.ts`, `packages/engine/test/enchanting.test.ts`
- Modify: `packages/engine/src/content-bound-validation.ts` (validate `enchantment.enchantmentId` against the pack, beside the curse check), `packages/engine/src/index.ts`

**Interfaces — Produces:**

```ts
// packages/engine/src/enchanting.ts
/** True for an item the enchant service and scroll may target: an ordinary equipment category,
 * not an artifact, and not carrying a REVEALED curse. An unrevealed curse is invisible to hero and
 * merchant alike, which is the same gamble the identify service exists to resolve. */
export function enchantable(content: CompiledContentPack, item: ItemInstance): boolean;

/**
 * Draws one enchantment for `item` on the `enchanting` stream: a single weighted pick over the
 * pack's `enchantment` entries eligible for the item's category, with each modifier scaled by the
 * item rarity's `rarityMagnitudeBps` (quotient math, minimum 1). Exactly ONE draw, always -- an
 * ineligible item must be rejected by the caller before this is reached, never here, so the stream
 * position is a function of accepted enchants alone.
 */
export function drawEnchantment(
  input: Readonly<{ content: CompiledContentPack; item: ItemInstance; state: Uint32State }>,
): Readonly<{ enchantment: ItemEnchantmentState; state: Uint32State }>;
```

**Consumes:** the `enchantment` content kind and `balance.enchanting` (Task 3); the `enchanting` stream (Task 2).

- [ ] **Step 1: Write the failing tests**

```ts
it('draws an enchantment eligible for the item category', () => {
  const { enchantment } = drawEnchantment({ content: pack, item: ironSword(), state: [1, 2, 3, 4] });
  const entry = pack.entries.find((candidate) => candidate.id === enchantment.enchantmentId)!;
  expect(entry.kind).toBe('enchantment');
  expect((entry as EnchantmentContentEntry).categories).toContain('weapon');
});

it('is deterministic for a fixed stream state', () => {
  const first = drawEnchantment({ content: pack, item: ironSword(), state: [7, 7, 7, 7] });
  const second = drawEnchantment({ content: pack, item: ironSword(), state: [7, 7, 7, 7] });
  expect(first).toEqual(second);
});

it('consumes exactly one draw', () => {
  const state: Uint32State = [1, 2, 3, 4];
  expect(drawEnchantment({ content: pack, item: ironSword(), state }).state).toEqual(
    rollDie(state, totalEligibleWeightFor('weapon')).state,
  );
});

it('scales magnitude by item rarity', () => {
  const common = drawEnchantment({ content: pack, item: commonSword(), state: [5, 5, 5, 5] });
  const legendary = drawEnchantment({ content: pack, item: legendarySword(), state: [5, 5, 5, 5] });
  expect(legendary.enchantment.enchantmentId).toBe(common.enchantment.enchantmentId);
  for (const [stat, value] of Object.entries(legendary.enchantment.modifiers)) {
    expect(value).toBeGreaterThanOrEqual(common.enchantment.modifiers[stat]!);
  }
});

it('never scales a modifier below 1', () => {
  const { enchantment } = drawEnchantment({ content: packWithTinyMagnitudes, item: commonSword(), state: [1, 1, 1, 1] });
  expect(Object.values(enchantment.modifiers).every((value) => value >= 1)).toBe(true);
});

it('rejects an artifact and a revealed-cursed item as unenchantable', () => {
  expect(enchantable(pack, artifactInstance())).toBe(false);
  expect(enchantable(pack, revealedCursedSword())).toBe(false);
  expect(enchantable(pack, unrevealedCursedSword())).toBe(true);
  expect(enchantable(pack, healingPotion())).toBe(false);
  expect(enchantable(pack, ironSword())).toBe(true);
});

it('has a non-empty pool for every enchantable category in the shipping pack', () => {
  for (const category of ENCHANTABLE_CATEGORIES) {
    expect(
      shippingPack.entries.filter(
        (entry) => entry.kind === 'enchantment' && entry.categories.includes(category),
      ).length,
    ).toBeGreaterThan(0);
  }
});

it('makes a maxHealth enchantment move the hero bar', () => {
  // The first shipping item modifier that grants maxHealth -- the Task 1 fix in live content.
  const state = synchronizeDerivedMaxima(withEnchantedRing('enchantment.deep-lungs'), pack);
  expect(heroActor(state).maxHealth).toBe(baseMaxHealth + 3);
});

it('never rolls a curse when an item is enchanted after generation', () => {
  const { enchantment } = drawEnchantment({ content: pack, item: ironSword(), state: [1, 2, 3, 4] });
  const enchanted = { ...ironSword(), enchantment };
  expect(enchanted.curse).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace @woven-deep/engine -- --run test/enchanting.test.ts`
Expected: FAIL — `enchanting.js` does not exist.

- [ ] **Step 3: Write the implementation**

```ts
const BPS_RESOLUTION = 10000;

export const ENCHANTABLE_CATEGORIES: readonly ItemCategory[] = [
  'weapon',
  'armor',
  'shield',
  'ring',
  'light',
];

function scaledMagnitude(authored: number, bps: number): number {
  const numerator = authored * bps;
  if (!Number.isSafeInteger(numerator)) throw new RangeError('enchantment magnitude overflowed');
  // Quotient division on an exact integer numerator -- the codebase's no-float idiom -- with a
  // floor of 1 so a low-rarity scaling can never erase a modifier the author declared.
  return Math.max(1, Math.trunc(numerator / BPS_RESOLUTION));
}
```

`drawEnchantment` collects eligible entries sorted by `compareCodeUnits(id)`, sums their weights, takes ONE `rollDie(state, totalWeight)`, walks the cumulative weights to pick, then builds `{ enchantmentId, modifiers }` with every authored modifier scaled by `rarityMagnitudeBps[definition.rarity]`. It throws when the eligible pool is empty — the shipping-pack test above is the guard that keeps that unreachable in practice, and a content pack that violates it should fail loudly rather than silently skip enchanting.

`enchantable` returns `ENCHANTABLE_CATEGORIES.includes(definition.category) && definition.artifact === null && item.curse?.revealed !== true`.

`content-bound-validation.ts`, beside the curse check added in #121:

```ts
    if (item.enchantment !== null) {
      const enchantment = pack.entries.find(
        (entry) => entry.kind === 'enchantment' && entry.id === item.enchantment!.enchantmentId,
      );
      if (!enchantment) {
        throw new Error(
          `content-bound validation: item ${item.itemId} carries unknown enchantment ${item.enchantment.enchantmentId}`,
        );
      }
    }
```

Check first whether recovered-heirloom enchantments can name an id no `enchantment` entry defines (they round-trip whatever a record held). If the heirloom path can produce a legacy id, degrade there the way `recordedHeirloomContentId` already degrades rather than throwing — verify by reading `createRecordedHeirloom` before committing.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace @woven-deep/engine -- --run test/enchanting.test.ts` then the engine non-demo suite.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat: draw enchantments on the enchanting stream"
```

---

### Task 7: The `merchant-service.enchant` service

**Files:**
- Modify: `packages/engine/src/save-schema/primitives.ts` (the engine's `MERCHANT_SERVICE_IDS` copy + the command enum), `packages/engine/src/trade.ts:360-500` (`serviceTargetItemIds`, `planService`) and `:680-760` (`resolveTradeCommand`), `packages/engine/src/commerce.ts` (pricing), `packages/engine/src/projection.ts:670-690` (per-service targets)
- Modify: `content/encounters/town-merchants.yaml` (the authored service + faction `serviceIds`)
- Test: `packages/engine/test/trade.test.ts` (or whichever suite covers services), content validation

**Consumes:** `drawEnchantment`, `enchantable` (Task 6); `'merchant-service.enchant'` (Task 3).

Run `impact({target: "planService", direction: "upstream"})` and `impact({target: "serviceTargetItemIds", direction: "upstream"})` first and report the blast radius.

- [ ] **Step 1: Write the failing tests**

```ts
it('lists only enchantable owned items as service targets', () => {
  const targets = serviceTargetItemIds({ state: heroWithMixedPack(), content: pack, serviceId: 'merchant-service.enchant' });
  expect(targets).toContain(ironSwordId);
  expect(targets).not.toContain(artifactId);
  expect(targets).not.toContain(revealedCursedSwordId);
  expect(targets).not.toContain(healingPotionId);
});

it('enchants an unenchanted item at the base price', () => {
  const resolved = resolveTradeCommand({ state: tradingHero(), content: pack, command: enchantCommand(ironSwordId) });
  const item = resolved.state.items.find((candidate) => candidate.itemId === ironSwordId)!;
  expect(item.enchantment).not.toBeNull();
  expect(item.identified).toBe(true);
  expect(heroCurrency(resolved.state)).toBe(startingCurrency - basePrice);
});

it('re-enchants an already-enchanted item at double price, replacing the old draw', () => {
  const once = resolveTradeCommand({ state: tradingHero(), content: pack, command: enchantCommand(ironSwordId) });
  const first = once.state.items.find((candidate) => candidate.itemId === ironSwordId)!.enchantment;
  const twice = resolveTradeCommand({ state: once.state, content: pack, command: enchantCommand(ironSwordId) });
  const second = twice.state.items.find((candidate) => candidate.itemId === ironSwordId)!.enchantment;
  expect(second).not.toBeNull();
  expect(heroCurrency(twice.state)).toBe(heroCurrency(once.state) - basePrice * 2);
  expect([first, second]).toBeDefined(); // a fresh draw: it may legitimately be worse
});

it('refuses an artifact', () => {
  expect(planService({ state: tradingHero(), content: pack, command: enchantCommand(artifactId), session })).toMatchObject({
    ok: false,
  });
});

it('refuses a revealed-cursed item', () => {
  expect(planService({ state: tradingHero(), content: pack, command: enchantCommand(revealedCursedSwordId), session })).toMatchObject({
    ok: false,
  });
});

it('advances the enchanting stream and nothing else', () => {
  const before = tradingHero();
  const after = resolveTradeCommand({ state: before, content: pack, command: enchantCommand(ironSwordId) });
  expect(after.state.rng.enchanting).not.toEqual(before.rng.enchanting);
  for (const stream of RNG_STREAM_NAMES.filter((name) => name !== 'enchanting')) {
    expect(after.state.rng[stream]).toEqual(before.rng[stream]);
  }
});

it('does not enchant when the hero cannot pay', () => {
  const broke = tradingHero({ currency: 0 });
  const resolved = resolveTradeCommand({ state: broke, content: pack, command: enchantCommand(ironSwordId) });
  expect(resolved.state.items.find((candidate) => candidate.itemId === ironSwordId)!.enchantment).toBeNull();
  expect(resolved.state.rng.enchanting).toEqual(broke.rng.enchanting);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace @woven-deep/engine -- --run test/trade.test.ts`
Expected: FAIL — the service id is not a member of the engine's enum.

- [ ] **Step 3: Write the implementation**

Add `'merchant-service.enchant'` to the engine's `MERCHANT_SERVICE_IDS` copy in `save-schema/primitives.ts` and to the trade command's service enum (`save-schema/commands.ts` uses `merchantServiceId`, so the one enum edit covers it — verify).

`serviceTargetItemIds`, beside the remove-curse branch:

```ts
  if (serviceId === 'merchant-service.enchant') {
    // Owned means equipped OR in the backpack: the smith works on what the hero brought, and the
    // hero can carry an item in either place while standing at the stall.
    return state.items
      .filter(
        (item) =>
          (item.location.type === 'equipped' || item.location.type === 'backpack') &&
          item.location.actorId === state.hero.actorId &&
          enchantable(content, item),
      )
      .map((item) => item.itemId)
      .sort(compareCodeUnits);
  }
```

`planService`'s enchant branch: resolve the target from `command.targetItemId`, re-run `enchantable` (the projection is a convenience, never a trust boundary), and price it as `basePrice * (item.enchantment === null ? 1 : 2)` before the faction tier adjustment identify already receives — assert the doubled price is a safe integer.

`resolveTradeCommand`'s enchant branch: draw with `drawEnchantment({ content, item, state: state.rng.enchanting })`, write `{ ...item, enchantment, identified: true }`, write the advanced stream back into `state.rng.enchanting`, deduct the currency, and emit the service event the other services emit. The draw must happen ONLY after payment is confirmed — the "cannot pay" test above is what pins that ordering, and it is what keeps the stream a function of accepted enchants alone.

Author the service in `content/encounters/town-merchants.yaml` mirroring the identify entry (`basePrice: 80`, the same faction-tier block), and add `merchant-service.enchant` to the appropriate faction's `serviceIds`. Copy for the service, stating the authored gamble rule: `Re-forging an enchanted piece costs double, and the Weave may give you less than it gave before.`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace @woven-deep/engine -- --run test/trade.test.ts`, `npm run content:validate`, the engine non-demo suite.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine content
git commit -m "feat: add the enchant merchant service"
```

---

### Task 8: The scroll of tempering steel

**Files:**
- Create: `content/items/tempering-steel-scroll.yaml`
- Modify: `packages/engine/src/effects.ts` (the `effect.item.enchant` resolver + `DIRECT_EFFECT_IDS`), `packages/engine/src/actions.ts` (the no-eligible-target rejection), `content/loot-tables/*` (deep tables only)
- Test: `packages/engine/test/effects.test.ts`

**Consumes:** `drawEnchantment`, `enchantable` (Task 6); `'effect.item.enchant'` (Task 3).

- [ ] **Step 1: Write the failing tests**

```ts
it('enchants the first eligible item, equipped before backpack, by itemId order', () => {
  const resolved = readScroll(heroWith({ equipped: ['item.b.0002', 'item.a.0003'], backpack: ['item.a.0001'] }));
  expect(enchantmentOf(resolved, 'item.a.0003')).not.toBeNull(); // equipped wins over backpack
  expect(enchantmentOf(resolved, 'item.a.0001')).toBeNull();
});

it('skips artifacts and revealed-cursed items when choosing a target', () => {
  const resolved = readScroll(heroWith({ equipped: [artifactId, revealedCursedSwordId, ironSwordId] }));
  expect(enchantmentOf(resolved, ironSwordId)).not.toBeNull();
  expect(enchantmentOf(resolved, artifactId)).toBeNull();
});

it('rejects the read and consumes nothing when no item is eligible', () => {
  const state = heroWithOnlyPotions();
  const resolved = resolveCommand(state, readTemperingScroll(state), { content: pack });
  expect(resolved.result).toMatchObject({ status: 'invalid', reason: 'target.invalid' });
  expect(resolved.state.items.some((item) => item.contentId === 'item.tempering-steel-scroll')).toBe(true);
  expect(resolved.state.rng.enchanting).toEqual(state.rng.enchanting);
});

it('re-enchants an already-enchanted item', () => {
  const resolved = readScroll(heroWithEnchantedSword());
  expect(enchantmentOf(resolved, ironSwordId)).not.toBeNull();
});

it('draws on the enchanting stream only', () => {
  const before = heroWithSword();
  const after = readScroll(before);
  for (const stream of RNG_STREAM_NAMES.filter((name) => name !== 'enchanting' && name !== 'effects')) {
    expect(after.rng[stream]).toEqual(before.rng[stream]);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace @woven-deep/engine -- --run test/effects.test.ts`
Expected: FAIL — `effect.item.enchant` is unregistered.

- [ ] **Step 3: Write the implementation**

Register `effect.item.enchant` with an empty parameter schema, add it to `DIRECT_EFFECT_IDS`, and resolve it by selecting the target the same way `effect.curse.remove` selects its item (the sundering precedent) — with the spec's ordering:

```ts
/** Equipped first, then backpack; within each, `compareCodeUnits(itemId)` order. The equipped-first
 * rule matches the scroll's fiction (the steel you are holding) and is what the sundering scroll's
 * own convention establishes for item-targeted effects: deterministic, never a command argument. */
function firstEnchantableItemId(
  content: CompiledContentPack,
  items: readonly ItemInstance[],
  actorId: OpaqueId,
): OpaqueId | undefined {
  const owned = (type: 'equipped' | 'backpack') =>
    items
      .filter(
        (item) =>
          item.location.type === type &&
          item.location.actorId === actorId &&
          enchantable(content, item),
      )
      .map((item) => item.itemId)
      .sort(compareCodeUnits);
  return owned('equipped')[0] ?? owned('backpack')[0];
}
```

The effect draws with the run's `enchanting` state through the effect operations seam (the same way `effect.curse.remove` mutates items), writes the enchantment and `identified: true`, and returns the advanced stream state.

In `actions.ts`, the use-item validation path rejects with `'target.invalid'` when the item's effects include `effect.item.enchant` and `firstEnchantableItemId` is `undefined`, so the scroll is not consumed — mirroring the sundering scroll's existing arm exactly.

`content/items/tempering-steel-scroll.yaml` — copy `content/items/sundering-scroll.yaml`'s structure (same category, stackLimit, identification pool, actionCost):

```yaml
    id: item.tempering-steel-scroll
    name: Scroll of Tempering Steel
    rarity: rare
    minDepth: 8
    effects:
      - effectId: effect.item.enchant
        parameters: {}
        requiresLivingTarget: false
```

Add one low-weight choice to `loot-table.floor-scatter-deep` and `loot-table.chest-deep` only.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace @woven-deep/engine -- --run test/effects.test.ts`, `npm run content:validate`, the engine non-demo suite.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine content
git commit -m "feat: add the scroll of tempering steel"
```

---

### Task 9: spellPower in spell-sourced damage and heals

**Files:**
- Create: `packages/engine/src/spell-power.ts`, `packages/engine/test/spell-power.test.ts`
- Modify: `packages/engine/src/effects.ts:75-95` (`EffectSequenceInput.spellPower`) and the damage/heal resolution, `packages/engine/src/actions.ts:102-130` + `:744-760` (the item-spell seam), `packages/engine/src/action-dispatch.ts:60-80` + `:577-590` (the item-spell seam and the cast resolver)

**Interfaces — Produces:**

```ts
// packages/engine/src/spell-power.ts
/**
 * The caster's spell bonus: `floor(max(0, spellPower) / spellPowerDivisor)` where `spellPower` is
 * the ordinary derived stat (`{ base: -10, wits: 1 }` in shipping balance, so raw is `wits - 10`).
 * Quotient math on safe integers; never negative. Identical for heroes, monsters, and champions --
 * they all derive from their own stats through the same call.
 */
export function spellPowerFor(
  input: Readonly<{ state: ActiveRun; content: CompiledContentPack; actor: ActorState }>,
): number;
```

**Consumes:** `spellPower` in `DERIVED_STAT_NAMES` and `spellPowerDivisor` (Task 3).

Run `impact({target: "resolveEffectSequence", direction: "upstream"})` first and report the blast radius — it has fifteen call sites, and only three of them may pass a non-zero `spellPower`.

- [ ] **Step 1: Write the failing tests**

```ts
it('is zero at or below the baseline wits', () => {
  expect(spellPowerFor({ state, content: pack, actor: actorWithWits(10) })).toBe(0);
  expect(spellPowerFor({ state, content: pack, actor: actorWithWits(4) })).toBe(0);
});

it('adds one per divisor step above the baseline', () => {
  expect(spellPowerFor({ state, content: pack, actor: actorWithWits(14) })).toBe(1);
  expect(spellPowerFor({ state, content: pack, actor: actorWithWits(17) })).toBe(1);
  expect(spellPowerFor({ state, content: pack, actor: actorWithWits(18) })).toBe(2);
});

it('counts a +spellPower equipment modifier', () => {
  expect(spellPowerFor({ state: withWovenThoughtRing(state), content: pack, actor: heroActor(state) })).toBe(
    spellPowerFor({ state, content: pack, actor: heroActor(state) }) + 1,
  );
});

it('raises a cast spell damage roll by the caster bonus', () => {
  const low = castSpellWith({ wits: 10 });
  const high = castSpellWith({ wits: 18 });
  expect(damageDealtIn(high)).toBe(damageDealtIn(low) + 2);
});

it('raises a scroll-cast heal by the caster bonus', () => {
  const low = readHealingScrollWith({ wits: 10 });
  const high = readHealingScrollWith({ wits: 18 });
  expect(healedIn(high)).toBe(healedIn(low) + 2);
});

it('leaves a curse trigger unscaled', () => {
  expect(damageDealtIn(fireCurseTriggerWith({ wits: 18 }))).toBe(
    damageDealtIn(fireCurseTriggerWith({ wits: 10 })),
  );
});

it('leaves a non-spell item effect unscaled', () => {
  expect(healedIn(drinkPotionWith({ wits: 18 }))).toBe(healedIn(drinkPotionWith({ wits: 10 })));
});

it('leaves a plain weapon attack unscaled', () => {
  expect(damageDealtIn(attackWith({ wits: 18 }))).toBe(damageDealtIn(attackWith({ wits: 10 })));
});

it('scales a monster caster from its own stats', () => {
  expect(damageDealtIn(monsterCastWith({ wits: 18 }))).toBe(damageDealtIn(monsterCastWith({ wits: 10 })) + 2);
});

it('consumes no additional randomness', () => {
  const low = castSpellWith({ wits: 10 });
  const high = castSpellWith({ wits: 18 });
  expect(high.state.rng.effects).toEqual(low.state.rng.effects);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace @woven-deep/engine -- --run test/spell-power.test.ts`
Expected: FAIL — `spell-power.js` does not exist and no bonus is applied.

- [ ] **Step 3: Write the implementation**

```ts
export function spellPowerFor(
  input: Readonly<{ state: ActiveRun; content: CompiledContentPack; actor: ActorState }>,
): number {
  const raw = deriveRunActorStats({ state: input.state, content: input.content, actor: input.actor }).spellPower;
  const divisor = balanceEntry(input.content).spellPowerDivisor;
  if (!Number.isSafeInteger(raw) || !Number.isSafeInteger(divisor) || divisor < 1) {
    throw new RangeError('spell power derivation requires safe integers and a positive divisor');
  }
  // `raw` is already `wits - baseline` (the formula carries the baseline in its `base` term), so a
  // caster below the baseline contributes nothing rather than a penalty. Truncation on a positive
  // numerator IS floor -- the codebase's quotient idiom, no float survives.
  return raw <= 0 ? 0 : Math.trunc(raw / divisor);
}
```

`effects.ts`: add `readonly spellPower?: number;` to `EffectSequenceInput` with this doc comment:

```ts
  /**
   * The caster's spell bonus, added to every `effect.damage` and `effect.heal` amount this
   * sequence rolls. Defaults to 0, which is how "not item triggers, not curses" is enforced
   * STRUCTURALLY: only the spell seams pass it, so every other call site gets zero by omission
   * rather than by a runtime check somebody could later remove.
   */
  readonly spellPower?: number;
```

Apply it where damage and heal amounts are computed, after the dice roll and before mitigation for damage (so armor still subtracts from the scaled total), and before the missing-health clamp for heals. Guard the sum with `checkedSafeInteger`.

Pass it from exactly three seams, each computing `spellPowerFor` for the SOURCE actor:
- `actions.ts:102-130` — the shared "using this item casts a spell" validation helper (scroll `spellId` and artifact `artifact.signature.spellId`);
- `action-dispatch.ts:60-80` — its dispatch-side twin;
- `action-dispatch.ts:577-590` — the `cast` action resolver.

Before implementing, run `grep -rn "abilityIds" packages/engine/src` and confirm whether champion/echo ability casting resolves through one of those seams; if it resolves elsewhere, that site passes `spellPower` too — the spec requires monster/champion parity (clarification 9).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace @woven-deep/engine -- --run test/spell-power.test.ts` then the engine non-demo suite.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat: scale spell damage and healing with the caster's wits"
```

---

### Task 10: Echo casting — record the hero's signature abilities

**Files:**
- Modify: `packages/engine/src/run-finalize.ts:42-52` (`buildSnapshot`)
- Test: `packages/engine/test/run-finalize.test.ts`, `packages/engine/test/champion.test.ts`

**Consumes:** `hero.knownSpellIds`; `template.abilityLimit`.

This is a **producer fix, not a schema change**: `FallenHeroBuildSnapshot.signatureAbilityIds` already exists, is already migrated everywhere, and already flows into `normalizeFallenHero`'s ability clamp. Old records simply carry empty lists, so haunts of pre-curve heroes cast nothing — which is correct.

- [ ] **Step 1: Write the failing tests**

```ts
it('records the hero known spells as signature abilities', () => {
  const { record } = finalizeRun({ run: concludedHeroKnowing(['spell.ember', 'spell.mend']), content: pack, lifetime });
  expect(record.build.signatureAbilityIds).toEqual(['spell.ember', 'spell.mend'].sort(compareCodeUnits));
});

it('caps the recorded abilities at the template limit, highest weave cost first', () => {
  // abilityLimit 3; costs: gale 5, ember 4, mend 2, spark 1
  const { record } = finalizeRun({
    run: concludedHeroKnowing(['spell.spark', 'spell.mend', 'spell.ember', 'spell.gale']),
    content: pack,
    lifetime,
  });
  expect(record.build.signatureAbilityIds).toEqual(['spell.gale', 'spell.ember', 'spell.mend']);
});

it('breaks weave-cost ties deterministically by spell id', () => {
  const { record } = finalizeRun({ run: concludedHeroKnowing(['spell.b-tie', 'spell.a-tie']), content: pack, lifetime });
  expect(record.build.signatureAbilityIds).toEqual(['spell.a-tie', 'spell.b-tie']);
});

it('records nothing for a hero who knew no spells', () => {
  const { record } = finalizeRun({ run: concludedHeroKnowing([]), content: pack, lifetime });
  expect(record.build.signatureAbilityIds).toEqual([]);
});

it('drops a spell the current pack no longer defines', () => {
  const { record } = finalizeRun({ run: concludedHeroKnowing(['spell.ember', 'spell.deleted']), content: pack, lifetime });
  expect(record.build.signatureAbilityIds).toEqual(['spell.ember']);
});

it('round-trips the abilities through a standing', () => {
  const standings = standingsFromRecords([storedRecordWithAbilities(['spell.ember'])], 10);
  expect(standings[0]!.signatureAbilityIds).toEqual(['spell.ember']);
});

it('gives a placed champion its recorded abilities', () => {
  const placed = placeFallenHeroEncounters({ run: runWithCasterStanding(), floor: deathDepthFloor(), content: pack });
  const population = placed.populations.find((candidate) => candidate.model === 'champion')!;
  expect(population.abilityIds).toEqual(['spell.ember']);
});

it('consumes no additional randomness', () => {
  const run = concludedHeroKnowing(['spell.ember', 'spell.mend']);
  const finalized = finalizeRun({ run, content: pack, lifetime });
  expect(finalized.run.rng['run-records']).toEqual(heirloomOnlyRunRecordsState(run));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace @woven-deep/engine -- --run test/run-finalize.test.ts`
Expected: FAIL — `signatureAbilityIds` is `[]` unconditionally.

- [ ] **Step 3: Write the implementation**

In `buildSnapshot`, replace the hardcoded `signatureAbilityIds: []`:

```ts
function signatureAbilityIds(
  run: ActiveRun,
  content: CompiledContentPack,
  template: FallenChampionTemplateContentEntry,
): readonly OpaqueId[] {
  // A hero's SIGNATURE spells are the expensive ones -- what they were remembered for, not what
  // they cast every turn. Ties break by id so the standing is deterministic (a total order is
  // required: `compareHallRecords` downstream assumes stable standings).
  return (run.hero.knownSpellIds ?? [])
    .flatMap((spellId) => {
      const spell = content.entries.find((entry) => entry.id === spellId);
      return spell?.kind === 'spell' ? [{ spellId, weaveCost: spell.weaveCost }] : [];
    })
    .sort(
      (left, right) =>
        right.weaveCost - left.weaveCost || compareCodeUnits(left.spellId, right.spellId),
    )
    .slice(0, template.abilityLimit)
    .map((candidate) => candidate.spellId);
}
```

`buildSnapshot` takes `content` and the template (it is already looked up in `finalizeRun` via `fallenChampionTemplate`). Note that `normalizeFallenHero` throws a `RangeError` for an echo whose ability selection cannot be made strictly weaker, and `placeFallenHeroEncounters` already catches exactly that and skips the placement — a caster hero with one signature spell therefore produces a champion that casts and an echo that quietly does not appear, which is pre-existing, tested behavior. Do not change it here; add a test asserting it still holds.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace @woven-deep/engine -- --run test/run-finalize.test.ts test/champion.test.ts` then the engine non-demo suite.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat: record signature spells so haunts cast what their hero knew"
```

---

### Task 11: Client — temper overlay, banked prompt, enchant service, log lines

**Files:**
- Create: `apps/web/src/ui/overlays/TemperOverlay.tsx`
- Modify: `packages/session-core/src/intents.ts` + `command-builder.ts` + `ws-protocol.ts`, `apps/server/src/ws-protocol.ts` (`validateIntent`), `apps/web/src/session/event-log.ts`, `apps/web/src/ui/overlays/registry.ts` + `OverlayHost.tsx`, `apps/web/src/ui/key-router.ts` (or wherever the keybinding table lives), `apps/web/src/ui/screens/TradeScreen.tsx` (the fourth service), `packages/engine/src/projection.ts` (project `hero.tempering`)
- Test: `apps/web/test/event-log.test.ts`, a new `apps/web/test/temper-overlay.test.tsx`, `apps/web/test/trade-screen.test.tsx` (or the existing trade suite)

**Interfaces — Produces:**

```ts
// packages/engine/src/projection.ts -- the hero projection gains (player-known: their own growth):
tempering: Readonly<{
  banked: number;
  spent: Readonly<Record<AttributeName, number>>;
  /** Attributes still below `attributeMaximum`. Empty means every point is held by the Deep. */
  temperable: readonly AttributeName[];
}>;

// packages/session-core/src/intents.ts -- PlayerIntent gains:
  | { readonly type: 'temper'; readonly attribute: AttributeName }
```

**Consumes:** `hero.tempered` / `hero.tempering-banked` (Tasks 4-5); the enchant service (Task 7).

- [ ] **Step 1: Write the failing tests**

```ts
it('logs the banking line', () => {
  expect(renderEvent({ type: 'hero.tempering-banked', eventId: 'e1', depth: 3, banked: 1 })).toMatchObject({
    text: 'The Deep tempers those who dare it.',
    tone: 'info',
  });
});

it('logs the spend', () => {
  expect(
    renderEvent({ type: 'hero.tempered', eventId: 'e1', attribute: 'vitality', value: 13, remaining: 0 }),
  ).toMatchObject({ text: 'Vitality hardens to 13.', tone: 'info' });
});

it('logs the two temper refusals', () => {
  expect(renderInvalidAction('temper.unavailable')).toMatchObject({ text: 'The Deep has given you nothing to spend.' });
  expect(renderInvalidAction('temper.capped')).toMatchObject({ text: 'That part of you can harden no further.' });
});

it('shows one row per attribute with the banked count', () => {
  render(<TemperOverlay projection={projectionWithBanked(2)} onTemper={vi.fn()} onClose={vi.fn()} />);
  expect(screen.getByText('2 points banked')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /Might|Agility|Vitality|Wits|Resolve/ })).toHaveLength(5);
});

it('disables a capped attribute', () => {
  render(<TemperOverlay projection={projectionWithCappedMight()} onTemper={vi.fn()} onClose={vi.fn()} />);
  expect(screen.getByRole('button', { name: /Might/ })).toBeDisabled();
});

it('says the points are held when everything is capped', () => {
  render(<TemperOverlay projection={projectionAllCapped(2)} onTemper={vi.fn()} onClose={vi.fn()} />);
  expect(screen.getByText('Held by the Deep.')).toBeInTheDocument();
});

it('dispatches the chosen attribute', async () => {
  const onTemper = vi.fn();
  render(<TemperOverlay projection={projectionWithBanked(1)} onTemper={onTemper} onClose={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: /Vitality/ }));
  expect(onTemper).toHaveBeenCalledWith('vitality');
});

it('builds a temper command from the intent', () => {
  expect(
    buildIntent({ intent: { type: 'temper', attribute: 'wits' }, projection: projectionWithBanked(1), commandId: 'c.1', expectedRevision: 4, pack }),
  ).toMatchObject({ kind: 'command', command: { type: 'temper', attribute: 'wits' } });
});

it('rejects a temper intent with no banked point before it reaches the wire', () => {
  expect(
    buildIntent({ intent: { type: 'temper', attribute: 'wits' }, projection: projectionWithBanked(0), commandId: 'c.1', expectedRevision: 4, pack }).kind,
  ).toBe('rejected');
});

it('validates the temper intent over the wire', () => {
  expect(parseClientMessage(JSON.stringify({ type: 'command', commandId: 'c.1', expectedRevision: 1, intent: { type: 'temper', attribute: 'wits' } })).ok).toBe(true);
  expect(parseClientMessage(JSON.stringify({ type: 'command', commandId: 'c.1', expectedRevision: 1, intent: { type: 'temper', attribute: 'luck' } })).ok).toBe(false);
});

it('lists the enchant service with its own targets', () => {
  render(<TradeScreen projection={projectionWithEnchantService()} {...handlers} />);
  expect(screen.getByText(/Enchant/)).toBeInTheDocument();
  expect(screen.getByText(/costs double/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace @woven-deep/web -- --run test/event-log.test.ts test/temper-overlay.test.tsx`
Expected: FAIL — the overlay does not exist and the events fall through to the default branch.

- [ ] **Step 3: Write the implementation**

Project `hero.tempering` (with `temperable` computed as the attributes strictly below `balanceEntry(content).attributeMaximum`) so the client never re-derives the cap. Add the three log arms plus the two invalid-action arms. Build `TemperOverlay` on the chargen attribute-row styling (reuse `AttributeStepper`'s row markup and theme tokens; introduce no new colour literal), register it in the overlay registry with a rebindable key and a command-palette entry, and show a non-blocking affordance in the HUD while `tempering.banked > 0`. Add the `temper` arm to `command-builder.ts` (rejecting with `The Deep has given you nothing to spend.` when `banked === 0`) and to `validateIntent` (`case 'temper': return isOneOf(value.attribute, ATTRIBUTE_NAMES);`). Add the fourth service row to `TradeScreen`'s Services tab, reading `service.targetItemIds` exactly as the other three do.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace @woven-deep/web && npm run test --workspace @woven-deep/server && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web apps/server packages/session-core packages/engine
git commit -m "feat: surface tempering and enchanting in the client"
```

---

### Task 12: Regression pins

**Files:**
- Modify: `packages/engine/test/score-run.test.ts`, the descent-lock-free invariant suite, `packages/engine/test/enchanting.test.ts`, `apps/web/test/guest-session.test.ts`
- Test: this task is entirely tests

- [ ] **Step 1: Write the pins**

```ts
it('leaves the score model untouched by tempering, enchanting, and spell power', () => {
  const tempered = temperTwice(enchantSword(baseConcludedRun()));
  expect(scoreRun({ run: tempered, content: pack })).toEqual(scoreRun({ run: baseConcludedRun(), content: pack }));
});

it('keeps every descent reachable with no tempering spent and no enchantment', () => {
  // The no-hard-gates proof: the existing invariant suite, re-run against a v17 run.
  expect(descentLockFreeReport(freshRun())).toMatchObject({ locked: [] });
});

it('never advances the enchanting stream in a run that never enchants', () => {
  const played = playFiftyTurns(freshRun());
  expect(played.rng.enchanting).toEqual(deriveRngStreams(played.runSeed).enchanting);
});

it('rewinds tempering wholesale with a wanderer checkpoint', () => {
  const storage = memoryStorage();
  const session = wandererSession(storage);
  descendToDepth(session, 3);
  temper(session, 'vitality');                     // spend the depth-3 point
  const afterSpend = session.getSnapshot().projection.hero.tempering;
  descendToDepth(session, 4);
  killHero(session);
  session.riseAgain();
  expect(session.getSnapshot().projection.hero.tempering).toEqual(afterSpend);
});

it('re-grants a milestone when a rewound hero re-crosses it', () => {
  // Deliberate and spec-stated: `metrics.deepestDepth` rides the blob, so it rewinds with the run
  // and the rewound hero genuinely re-earns the point by diving again.
  const storage = memoryStorage();
  const session = wandererSession(storage);
  descendToDepth(session, 2);                      // checkpoint at depth 2
  descendToDepth(session, 3);                      // banks the depth-3 point
  killHero(session);
  session.riseAgain();
  expect(session.getSnapshot().projection.hero.tempering.banked).toBe(0);
  descendToDepth(session, 3);
  expect(session.getSnapshot().projection.hero.tempering.banked).toBe(1);
});
```

- [ ] **Step 2: Run them**

Run: `npm run test --workspace @woven-deep/engine && npm run test --workspace @woven-deep/web`
Expected: PASS. Any failure here is a real regression in the feature, not a bad pin — fix the feature.

- [ ] **Step 3: Commit**

```bash
git add packages/engine/test apps/web/test
git commit -m "test: pin score, descent, stream isolation, and wanderer tempering semantics"
```

---

### Task 13: Re-pin the demo digests

**Files:**
- Modify: `packages/engine/test/fixtures/gameplay-demo-hashes.json`, `merchant-demo-hashes.json`, `population-demo-hashes.json`, `dungeon-demo-hashes.json`, `run-records-demo-hashes.json`, `endgame-demo-hashes.json`, `magic-demo-hashes.json`, plus any pinned digest literal in `packages/engine/test/new-run.test.ts`

- [ ] **Step 1: Rebuild and run every demo**

```bash
npm run build --workspace @woven-deep/content && npm run build --workspace @woven-deep/engine
npm run gameplay:demo && npm run merchant:demo && npm run population:demo && npm run dungeon:demo && npm run run-records:demo
```

- [ ] **Step 2: Attribute every delta BEFORE touching a fixture**

Permitted causes, and nothing else:

- **save-shape:** `SAVE_SCHEMA_VERSION` 17, the new `rng.enchanting` key in every encoded blob, and `hero.tempering` on every hero. Every demo shows this.
- **contentHash:** content v14 (the enchantment kind, the three balance knobs, the required `formulas.spellPower` entry, the service, the effect id, the scroll, the loot-table entries). Every demo shows this.
- **behavioral, tempering:** any demo that reaches depth 3 banks a point. `hero.tempering.banked` moves; nothing else does, because banking consumes no randomness and the demos never spend.
- **behavioral, spellPower:** a demo whose hero or monsters actually CAST changes damage/heal amounts. The `magic-demo` is the expected home of this; confirm the delta equals the caster's derived bonus per cast and that no RNG stream moved.
- **behavioral, echo casting:** the `run-records` demo now records non-empty `signatureAbilityIds` for a caster hero, which changes its standings and therefore any champion it later places.

**An enchant-free demo must show ZERO movement of `rng.enchanting` beyond its seed-derived initial value, and zero movement of every other stream.** Any other delta is UNEXPLAINED. Report BLOCKED with the transcript diff. Do not re-pin over it.

- [ ] **Step 3: Re-pin once**

```bash
git add packages/engine/test
git commit -m "chore: re-pin demo digests for the hero power curve"
```

Per-fixture attributions in the commit body, one line per fixture.

- [ ] **Step 4: Verify green**

Run: `npm test`
Expected: PASS, all workspaces.

---

### Task 14: Root gate, docs, spec amendments, PR

**Files:**
- Modify: `docs/superpowers/specs/2026-08-02-hero-power-curve-design.md` (the eleven clarifications), `docs/server-admin/content-configuration.md` (confirm the v14 notes landed in Task 3)

- [ ] **Step 1: Full root gate**

```bash
npm run build --workspace @woven-deep/content && npm run build --workspace @woven-deep/engine
npm test && npm run typecheck && npm run smoke
```
Expected: all green, including the descent-lock-free invariant suite (the no-hard-gates proof) and the score pins.

- [ ] **Step 2: CI-only checks**

```bash
npx prettier --write $(git diff --name-only main... | grep -E '\.(ts|tsx|json|md|yaml)$')
npx depcruise --config .dependency-cruiser.cjs packages apps
npx knip
```
Expected: prettier rewrites only formatting; depcruise reports no cycles (`derived-maxima.ts`, `tempering.ts`, `enchanting.ts`, and `spell-power.ts` are leaves off `stats.ts`/`balance.ts` with no back-edges); knip reports no unused exports (`synchronizeDerivedMaxima`, `grantTemperingMilestones`, `resolveTemper`, `drawEnchantment`, `enchantable`, `ENCHANTABLE_CATEGORIES`, `spellPowerFor` are all consumed).

- [ ] **Step 3: Amend the spec**

Fold the eleven "Spec clarifications recorded here" entries into `docs/superpowers/specs/2026-08-02-hero-power-curve-design.md` as an `## Amendments (2026-08-02, during implementation)` section. Confirm `docs/server-admin/content-configuration.md` documents the `enchantment` kind, the `tempering`/`spellPowerDivisor`/`enchanting` balance knobs, the required `formulas.spellPower` entry, `merchant-service.enchant`, `effect.item.enchant`, and the v14 migration note.

```bash
git add docs
git commit -m "docs: record the hero power curve spec amendments"
```

- [ ] **Step 4: Detect changes and open the PR**

Run `detect_changes({scope: "compare", base_ref: "main"})` and confirm the affected symbols match this plan's File Map. Then push `feat/power-curve` and open the PR: title `feat: hero power curve — tempering, enchanting, and spell scaling`, body linking the spec, listing the eleven amendments and the per-fixture digest attributions, and calling out the inert-`maxHealth`-modifier fix as a shipped bug fix in its own right.

---

## Self-Review

**1. Spec coverage.** Tempering milestones from `metrics.deepestDepth` with zero randomness and multi-milestone banking → Task 4. The `temper` command with the banked/capped/all-capped rules, no turn energy, no randomness, and `hero.tempered` → Task 5. The recompute with proportional checked-integer rescaling → Task 5, resting on Task 1's authoritative maxima. The inert-maxHealth-modifier fix with the full reader regression matrix → Task 1, exercised in live content by `enchantment.deep-lungs` in Task 6. `hero.tempering` state with the `attributes = base + spent` invariant → Task 2 (content-free half) and Task 5 (the `attributeMaximum` half). The enchant service with rarity-scaled pools, re-enchant replacement at double price, and artifact/cursed refusal → Tasks 6-7. The tempering-steel scroll with equipped-then-backpack `compareCodeUnits` targeting and no-target non-consumption → Task 8. The `enchanting` stream with its freeze-respecting migration and stream isolation → Tasks 2, 6, 12. The generation-only curse weighting → Global Constraints plus a Task 6 pin. spellPower through cast and scroll paths with monster parity and zero effect on non-spell damage → Task 9. Echo casting via `buildSnapshot` with weave-cost capping and a champion actually casting → Task 10. Client log line, prompt affordance, overlay, keybinding, palette entry → Task 11. Wanderer rewind semantics, score untouched, no-hard-gates → Task 12. Both migrations with genuine legacy fixtures → Tasks 2-3; attributed re-pins → Task 13. Non-goals are satisfied by omission: no XP/levels/kill-grinding anywhere, no growth past `attributeMaximum` (enforced in two places), no spell ranks (the duplicate-tome rejection is untouched), no artifact enchanting or curse re-rolling or enchantment removal (`enchantable` forbids the first two structurally and no removal path is added), no score changes (pinned). No gaps found.

**2. Placeholder scan.** Every code step carries real TypeScript, TSX, YAML, or Zod. Five items are verification instructions against live source, each naming exactly where to look: whether `deriveRngStreams` derives per-name or positionally (Task 2 Step 3, which is why `enchanting` is appended last), whether champion ability casting resolves through one of the three spell seams (Task 9, with the grep given), whether recovered heirlooms can name an enchantment id the pack no longer defines (Task 6 Step 3, with the function to read), whether the trade command's service enum is single-sourced through `merchantServiceId` (Task 7 Step 3), and the keybinding table's location (Task 11). None is a deferred decision, and the per-suite fixture helpers are all described by the existing helpers they extend.

**3. Type consistency.** `HeroTemperingState` / `hero.tempering.banked` / `hero.tempering.spent` are defined once in Task 2 and read with those exact names in Tasks 4, 5, 11, 12. `synchronizeDerivedMaxima(state, content)` keeps one signature across Tasks 1, 4, 5, 6. `grantTemperingMilestones` and `resolveTemper` take the same `{ state, content, … , eventId }` input shape as every other pure engine helper in this codebase. `drawEnchantment({ content, item, state })` returns `{ enchantment, state }` and is called identically in Tasks 7 and 8; `enchantable(content, item)` is the one eligibility predicate in Tasks 6, 7, and 8. `spellPowerFor({ state, content, actor })` has one signature in Task 9 and is the only producer of `EffectSequenceInput.spellPower`. `'temper.unavailable'` and `'temper.capped'` are the two new reason strings everywhere — in `InvalidActionReason`, the live `blockReason` enum, the reason↔command coupling, and the client's invalid-action switch. `'hero.tempering-banked'` and `'hero.tempered'` are the two new event type strings, each added to the `DomainEvent` union, the `event-projection.ts` pass-through, and the presentation-kind union in the task that introduces it. `'merchant-service.enchant'`, `'effect.item.enchant'`, `'spellPower'`, and `'enchantment'` are added to their closed vocabularies in Task 3 and consumed unchanged thereafter.
