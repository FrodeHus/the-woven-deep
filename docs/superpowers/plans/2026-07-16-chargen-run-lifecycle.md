# Character Generation and Run Lifecycle (5B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Milestone 5B — the seven-step character generation flow, title screen, run-conclusion screen, and guest Hall of Records, closing the loop from creating a hero to dying, reading the record, and rolling the next one.

**Architecture:** Content schema v6 adds `class`/`background`/`trait` kinds and a `pointBuy` balance table. Save schema v7 puts `classTags` and permanent `statModifiers` on the hero, threaded through every runtime `deriveActorStats` call so backgrounds and traits affect play. A pure engine chargen module (`rollAttributes`, point-buy arithmetic, `validateHeroChoices`, `heroFromChoices`) feeds the extended `createNewRun`, which now derives max health from the balance formulas. The web app gains a `ScreenState` machine (title → chargen → play → conclusion → hall), a pure wizard reducer, a finalize-exactly-once death flow, and a sessionStorage-backed `RunRecordRepository`.

**Tech Stack:** TypeScript 5.8+, Node.js 22.12+, Zod 4, React 19, Vite 7, Vitest 3.2, Playwright, fast-check. No new dependencies.

## Global Constraints

- Follow `docs/superpowers/specs/2026-07-16-chargen-run-lifecycle-design.md`; amend and reapprove before changing an approved rule.
- Engine stays browser-safe, deterministic, clock-free (`browser-boundary.test.ts` green). All chargen arithmetic is checked-integer.
- Content schema bumps 5 → 6; active-run save schema bumps 6 → 7 with exactly one ordered migration (v4→v5→v6→v7): preserve every v6 field byte-for-byte, default `hero.classTags: []` and `hero.statModifiers: {}`; preserve the current strict schema as `legacyActiveRunV6Schema`; all other versions stay rejected.
- No flat attribute bonuses: backgrounds/traits modify DERIVED stats only, through the existing `deriveActorStats` modifier pipeline.
- Chargen randomness is deterministic from a chargen seed via `deriveSeed`/`rollDie`; no new RNG stream; the chargen seed becomes the run seed.
- The portrait glyph never enters engine data: it lives in client session state and record enrichment only.
- Hall records: guest repository is sessionStorage-backed behind the existing `RunRecordRepository` interface, own storage key; records marked unverified/session-only; enrichment `achievedAt` is the session-relative "Run #N" marker, never a wall-clock date.
- `finalizeRun` is invoked exactly once per run by the app; the engine `finalized` flag is the truth.
- Client stays dependency-free; screens are a hand-rolled `ScreenState` union; wizard state is a pure reducer with illegal states unrepresentable.
- Hero names: 1–24 chars after trimming; letters, digits, spaces, apostrophes, hyphens; NFC-normalized.
- Field-name traps: command envelope `expectedRevision`; projection fields `actions`/`trade`/`actors`; `deriveActorStats` input arrays are `equipmentModifiers`/`conditionModifiers` (this plan adds `heroModifiers`).
- Demo hashes change ONLY with documented transcript-delta inspection before re-pinning. The maxHealth formula retune (below) is an expected, deliberate drift.
- RED/GREEN TDD, strictly RED-first, per task; focused conventional commits; review before the next task.

## Deliberate balance change (affects hashes and the pinned walk)

The bundled `maxHealth` formula is `{ base: 8, vitality: 2 }` (= 28 at all-10s), but 5A hard-coded hero HP at 20 and the spec requires all-10s to stay 20. This plan retunes the formula to `{ base: 10, vitality: 1 }` (= 20 at all-10s; every Vitality point is +1 HP). Consequences to handle where they land: the gameplay demo's fixture hero derives its stats from this formula, so `gameplay-demo-hashes.json` drifts (inspect: only derived-stat-dependent values change) — Task 4; the 5A pinned e2e walk is re-derived once — Task 9.

## File and Responsibility Map

### Content (`packages/content`, schema v6)

- `src/model.ts`: v6 constant; `ClassContentEntry`, `BackgroundContentEntry`, `TraitContentEntry`, `ClassKitDefinition`, `PointBuyDefinition` on `BalanceContentEntry`; kind ids + entry union.
- `src/compiler/schema.ts`: strict entry schemas; `pointBuy` on the balance schema; v6 literal.
- `src/compiler/content-validation.ts`: kit item/slot cross-checks, playable-classes-need-2-kits, unlockHint-required-when-locked, modifier keys ⊆ `DERIVED_STAT_NAMES`, point-buy table covers bounds with non-decreasing costs.
- `content/classes/*.yaml`, `content/backgrounds/*.yaml`, `content/traits/*.yaml`, `content/balance/core-gameplay.yaml`: bundled content per the spec.
- `docs/server-admin/content-configuration.md` + content test suites.

### Engine (`packages/engine`, save v7)

- `src/model.ts`: `HeroState` gains `classTags: readonly string[]` and `statModifiers: DerivedStatModifier`.
- `src/versions.ts`: `SAVE_SCHEMA_VERSION = 7`.
- `src/save-schema.ts`: strict v7 hero block; `legacyActiveRunV6Schema`.
- `src/save-codec.ts`: `migrateV6ToV7` in the ordered chain.
- `src/chargen.ts` (new): `rollAttributes`, `rerollAttributes`, `pointBuyCost`, `pointBuyValid`, `validateHeroChoices`, `heroFromChoices`, `HERO_NAME_RULES`.
- `src/new-run.ts`: extended `NewRunHero`; derived maxHealth; hero fields stored.
- `src/attributes.ts`: `heroModifiers` input on `deriveActorStats`.
- `src/projection.ts`, `src/world-step.ts`, `src/features.ts`: thread `hero.statModifiers` at the four hero call sites.
- `src/run-finalize.ts`: `classTags` from the hero.
- `src/fixture.ts`, `src/gameplay-fixture.ts`: hero-field defaults.

### Web (`apps/web`)

- `src/session/wizard-reducer.ts` (new): pure wizard state machine + selectors.
- `src/session/run-records-storage.ts` (new): sessionStorage-backed `RunRecordRepository` (`RECORDS_KEY = 'woven-deep.guest-hall'`).
- `src/session/guest-session.ts`: snapshot gains `conclusion`; the app-facing finalize hook.
- `src/ui/screens/TitleScreen.tsx`, `ChargenScreen.tsx` (steps), `ConclusionScreen.tsx`, `HallScreen.tsx` (new); `src/App.tsx`: `ScreenState` machine; `?quickstart=` test seam; portrait/side-state key.
- `e2e/guest-play.spec.ts` (boot updates) + new `e2e/run-lifecycle.spec.ts`.
- Cleanup rider: `test/threat-popover.test.tsx` and `test/play-screen-tier.test.tsx` legacy storage fakes → keyed signature.

### Docs and gates

- `docs/superpowers/plans/2026-07-13-implementation-roadmap.md`: 5B recorded.
- `docs/operations/run-records.md`: guest Hall notes.

---

### Task 1: Content schema v6 — class, background, trait kinds and the point-buy table

**Files:**
- Modify: `packages/content/src/model.ts`
- Modify: `packages/content/src/compiler/schema.ts`
- Modify: `packages/content/src/compiler/content-validation.ts`
- Modify: `packages/content/test/model.test.ts`, `test/parse-file.test.ts`, `test/compile-directory.test.ts`, `test/default-content.test.ts`, `test/admin-docs.test.ts`
- Modify: `content/balance/core-gameplay.yaml` (pointBuy block only — the maxHealth retune is Task 4's, where its hash fallout is handled)
- Create: `content/classes/wayfarer.yaml`, `content/classes/lamplighter.yaml`, `content/classes/locked-classes.yaml`, `content/backgrounds/first-descent.yaml`, `content/traits/first-descent.yaml`
- Modify: `docs/server-admin/content-configuration.md`
- Modify: every `content/**/*.yaml` → `schemaVersion: 6`

**Interfaces:**
- Consumes: the achievement-kind precedent (`model.ts:4` kind ids, entry union ~`:486`; `compiler/schema.ts:216` entry schema example, `:589` union registration, `:630` version literal; `content-validation.ts:684` wiring; `content-schema.ts:58` + `parse-file.ts:61` version gates; `compile-directory.ts:96` hash input); `DERIVED_STAT_NAMES`; `z.partialRecord(z.enum(DERIVED_STAT_NAMES), ...)` precedent at `schema.ts:245`; the `actionCosts`-registry check precedent at `content-validation.ts:648`.
- Produces (exact shapes later tasks rely on):

```ts
export type ContentKindId = /* existing */ | 'class' | 'background' | 'trait';

export interface ClassKitEquippedItem { readonly contentId: OpaqueId; readonly slot: EquipmentSlot; readonly enabled?: boolean }
export interface ClassKitBackpackItem { readonly contentId: OpaqueId; readonly quantity?: number }
export interface ClassKitDefinition {
  readonly kitId: string;                     // kebab-case, unique within the class
  readonly name: string;
  readonly equipped: readonly ClassKitEquippedItem[];
  readonly backpack: readonly ClassKitBackpackItem[];
}
export interface ClassContentEntry extends BaseContentEntry {
  readonly kind: 'class';
  readonly description: string;               // 1..300 chars trimmed
  readonly playable: boolean;
  readonly silhouetteGlyph: string;           // exactly 1 char
  readonly unlockHint: string | null;         // required non-empty when playable === false
  readonly classTags: readonly string[];      // non-empty, kebab-case
  readonly kits: readonly ClassKitDefinition[]; // 2..3 when playable, 0..3 when locked
}
export interface BackgroundContentEntry extends BaseContentEntry {
  readonly kind: 'background';
  readonly description: string;
  readonly modifiers: Readonly<Partial<Record<DerivedStatName, number>>>; // non-zero safe ints, keys ⊆ DERIVED_STAT_NAMES
  readonly extraItems: readonly ClassKitBackpackItem[];
}
export interface TraitContentEntry extends BaseContentEntry {
  readonly kind: 'trait';
  readonly description: string;
  readonly modifiers: Readonly<Partial<Record<DerivedStatName, number>>>; // EXACTLY one key
}
export interface PointBuyDefinition {
  readonly budget: number;                                   // positive safe int
  readonly costs: readonly { readonly value: number; readonly cost: number }[];
  // ordered, covering every value attributeMinimum..attributeMaximum, costs non-decreasing, all safe non-negative ints
}
// BalanceContentEntry gains: readonly pointBuy: PointBuyDefinition;
export const CONTENT_SCHEMA_VERSION = 6 as const;
```

- [ ] **Step 1: Write failing model and parser tests**

```ts
// packages/content/test/model.test.ts additions
expect(CONTENT_SCHEMA_VERSION).toBe(6);
expect(CONTENT_KIND_IDS).toEqual(expect.arrayContaining(['class', 'background', 'trait']));

// packages/content/test/parse-file.test.ts additions — table-driven, one accept + rejects per rule
expect(parseContentFile(validClassYaml).entries[0]).toMatchObject({
  kind: 'class', playable: true, classTags: ['wayfarer'],
  kits: [expect.objectContaining({ kitId: 'blade', equipped: expect.any(Array) })],
});
expect(() => parseContentFile(lockedClassWithoutHint)).toThrow(/unlockHint/);
expect(() => parseContentFile(traitWithTwoModifiers)).toThrow(/exactly one/i);
expect(() => parseContentFile(backgroundWithUnknownStat)).toThrow(/meleeAccuracy|defense|search|Invalid/);
expect(parseContentFile(validBalanceYaml).entries[0]).toMatchObject({
  pointBuy: { budget: 30, costs: expect.arrayContaining([{ value: 3, cost: 0 }]) },
});
expect(() => parseContentFile(pointBuyWithDecreasingCosts)).toThrow(/non-decreasing/i);
expect(() => parseContentFile(v5File)).toThrow(/schema version/i);
```

Also cover: playable class with one kit rejected; kit referencing a missing item or wrong slot rejected at cross-file validation (`compileFixture` style, in `compile-directory.test.ts`); point-buy table with a gap in the value range rejected; `default-content.test.ts` asserts the bundled pack contains 4 classes (2 playable), 3 backgrounds, 5 traits; `admin-docs.test.ts` requires `class`, `background`, `trait`, `pointBuy`, and `unlockHint` to appear in the docs.

- [ ] **Step 2: Run and verify RED**

Run: `npm test --workspace @woven-deep/content -- --run test/model.test.ts test/parse-file.test.ts`
Expected: FAIL — version still 5, kinds missing.

- [ ] **Step 3: Implement types, schemas, and validation**

Add the interfaces above to `model.ts` (bump the version constant, extend `CONTENT_KIND_IDS` and the `ContentEntry` union). In `compiler/schema.ts`: strict Zod mirrors (copy the `achievementEntry` shape at `:216`); `modifiers` via `z.partialRecord(z.enum(DERIVED_STAT_NAMES), safeNonZeroInteger)` with a `.refine` for the trait's exactly-one-key rule; `pointBuy` inside the balance strictObject with a `.superRefine` checking full value coverage against `attributeMinimum`/`attributeMaximum` and non-decreasing costs; register all three entries in the discriminated union at `:589`. In `content-validation.ts`: a `classIssues` function (kit items exist in the pack; equipped entries name a slot the item's `equipment` allows — mirror how the engine's kit consumption will resolve slots; playable ⇒ ≥2 kits; locked ⇒ non-empty `unlockHint`) and `backgroundIssues` (extraItems exist), wired into `validateContentEntries` at `:684`.

- [ ] **Step 4: Author bundled content and bump every YAML**

`content/classes/wayfarer.yaml` (playable; blade kit: iron-sword main-hand / wooden-shield off-hand... torch must go somewhere — blade kit: iron sword main-hand, pitch torch off-hand enabled, leather armor body, 3 rations backpack + wooden shield backpack; ranger kit: hunting bow main-hand, wooden arrows ×20 backpack, pitch torch off-hand enabled, leather armor, 3 rations). `lamplighter.yaml` (lantern kit: brass lantern off-hand enabled, iron sword main-hand, leather armor, lamp oil ×2 + 3 rations backpack; torchbearer kit: pitch torch off-hand enabled + spare pitch torch backpack, iron sword, leather armor, 4 rations). `locked-classes.yaml`: Archivist (`silhouetteGlyph: 'A'`, hint about lore) and Warden (`'W'`, hint about defense), `playable: false`, `kits: []`. Backgrounds: caravan-guard `{ defense: 1 }`, deep-miner `{ search: 1 }` + lamp oil, ratcatcher `{ meleeAccuracy: 1 }` + 2 rations. Traits (5, one modifier each): keen-eyed `{ search: 2 }`, sure-footed `{ defense: 1 }`, steady-hands `{ disarm: 2 }`, brawler `{ meleeDamageBonus: 1 }`, sharpshooter `{ rangedAccuracy: 1 }`. Balance gains `pointBuy: { budget: 30, costs: [...] }` with escalating costs over the existing bounds (0 cost at the minimum value, rising steps toward the maximum — author the exact table against the bounds in `core-gameplay.yaml`). Bump every `content/**/*.yaml` to `schemaVersion: 6`. Document everything new in `content-configuration.md`.

- [ ] **Step 5: Run content gates and verify GREEN**

Run: `npm test --workspace @woven-deep/content && npm run content:validate`
Expected: all pass; the pack compiles with the new kinds. NOTE: the engine and web workspaces consume the pack — run `npm test` (root) once; engine fixtures assert nothing about content version, but if anything red-shifts, report it in your task report rather than patching other workspaces (Task 2+ owns them).

- [ ] **Step 6: Commit**

```bash
git add packages/content content docs/server-admin
git commit -m "feat: add class background and trait content"
```

---

### Task 2: Save schema v7 — hero class tags and permanent stat modifiers

**Files:**
- Modify: `packages/engine/src/model.ts` (HeroState)
- Modify: `packages/engine/src/versions.ts`
- Modify: `packages/engine/src/save-schema.ts`
- Modify: `packages/engine/src/save-codec.ts`
- Modify: `packages/engine/src/fixture.ts`, `src/new-run.ts` (field defaults only), `src/gameplay-fixture.ts` (if it builds HeroState directly)
- Modify: `packages/engine/test/model.test.ts`, `test/save-codec.test.ts`

**Interfaces:**
- Consumes: the v5→v6 migration precedent (`legacyActiveRunV5Schema` at `save-schema.ts:672`, `migrateV5ToV6` at `save-codec.ts:30-40`, dispatch at `:61`); `DerivedStatModifier` from `attributes.ts:10`; `DERIVED_STAT_NAMES`.
- Produces: `HeroState` with `readonly classTags: readonly string[]` and `readonly statModifiers: DerivedStatModifier`; `SAVE_SCHEMA_VERSION = 7`; `legacyActiveRunV6Schema`; `migrateV6ToV7`.

- [ ] **Step 1: Write failing migration tests**

```ts
// packages/engine/test/save-codec.test.ts additions
const decoded = decodeActiveRun(JSON.stringify(v6Fixture));
expect(decoded.schemaVersion).toBe(7);
expect(decoded.hero.classTags).toEqual([]);
expect(decoded.hero.statModifiers).toEqual({});
expect(stripV7Fields(decoded)).toEqual(v6Fixture);          // byte-preservation
const fromV4 = decodeActiveRun(JSON.stringify(v4Fixture));   // full chain still works
expect(fromV4.schemaVersion).toBe(7);
```

Strict v7 rejections: `statModifiers` with an unknown stat key; non-integer or unsafe modifier values; `classTags` entries that are empty strings; schema versions 3 and 8 rejected. Update `model.test.ts:16` to `SAVE_SCHEMA_VERSION).toBe(7)` and the run fixture assertions.

- [ ] **Step 2: Run and verify RED**

Run: `npm test --workspace @woven-deep/engine -- --run test/model.test.ts test/save-codec.test.ts`
Expected: FAIL — version 7 and the fields don't exist.

- [ ] **Step 3: Implement the bump**

Snapshot the current `activeRunSchema` as `legacyActiveRunV6Schema` (schemaVersion literal 6, current hero block WITHOUT the new fields) before extending the live schema — the exact discipline `legacyActiveRunV5Schema` shows. Extend `HeroState` and the strict `hero` schema: `classTags: z.array(z.string().trim().min(1)).readonly()`, `statModifiers: z.partialRecord(z.enum(DERIVED_STAT_NAMES), safeInteger)` (import or mirror how content constrains stat keys). `migrateV6ToV7` spreads the parsed v6 save and adds `hero: { ...v6.hero, classTags: [], statModifiers: {} }`. Extend the `decodeActiveRun` dispatch: 4/5/6 route through the ordered chain; bump `SAVE_SCHEMA_VERSION`. Give `fixture.ts`'s and `new-run.ts`'s hero literals the new fields (`classTags: []`, `statModifiers: {}` — real values arrive in Task 3).

- [ ] **Step 4: Run engine gates and verify GREEN**

Run: `npm test --workspace @woven-deep/engine && npm run typecheck --workspace @woven-deep/engine`
Expected: all pass (fixtures gain defaults; no behavior change yet, so demo hashes must NOT drift — if they do, stop and investigate).

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat: add hero identity save state and migration"
```

---

### Task 3: Engine chargen module and the extended NewRunHero

**Files:**
- Create: `packages/engine/src/chargen.ts`
- Create: `packages/engine/test/chargen.test.ts`
- Modify: `packages/engine/src/new-run.ts` (NewRunHero extension + DEFAULT_GUEST_HERO defaults)
- Modify: `packages/engine/src/index.ts`

**Interfaces:**
- Consumes: `deriveSeed`/`rollDie`/`Uint32State` (`random.ts:31/:59`), `BaseAttributes`, `ClassContentEntry`/`BackgroundContentEntry`/`TraitContentEntry`/`PointBuyDefinition` from Task 1, `NewRunHeroItem`/`NewRunBackpackItem` from `new-run.ts`.
- Produces:

```ts
// chargen.ts
export const ATTRIBUTE_ORDER = ['might', 'agility', 'vitality', 'wits', 'resolve'] as const;
export const HERO_NAME_RULES = { minLength: 1, maxLength: 24, pattern: /^[\p{L}\p{N} '\-]+$/u } as const;
export interface AttributeRoll { readonly attributes: BaseAttributes; readonly state: Uint32State }
export function rollAttributes(seed: Uint32State): AttributeRoll;          // 3d6 per attribute in ATTRIBUTE_ORDER
export function rerollAttributes(previous: AttributeRoll): AttributeRoll;  // next 15 draws from previous.state
export function pointBuyCost(attributes: BaseAttributes, pointBuy: PointBuyDefinition): number; // checked sum
export function pointBuyValid(attributes: BaseAttributes, balance: BalanceContentEntry): boolean;
export interface HeroChoices {
  readonly name: string;
  readonly method: 'roll' | 'point-buy';
  readonly attributes: BaseAttributes;
  readonly classId: OpaqueId;
  readonly kitId: string;
  readonly backgroundId: OpaqueId;
  readonly traitIds: readonly OpaqueId[];    // 0..2, unique
}
export function validateHeroChoices(input: Readonly<{ pack: CompiledContentPack; choices: HeroChoices }>): void; // throws naming the violation
export function heroFromChoices(input: Readonly<{ pack: CompiledContentPack; choices: HeroChoices }>): NewRunHero;

// new-run.ts — NewRunHero gains (all with values in DEFAULT_GUEST_HERO so existing consumers keep compiling):
//   readonly classTags: readonly string[];        // DEFAULT_GUEST_HERO: ['wayfarer']
//   readonly statModifiers: DerivedStatModifier;  // DEFAULT_GUEST_HERO: {}
```

- [ ] **Step 1: Write failing chargen tests**

```ts
// packages/engine/test/chargen.test.ts — representative; cover the full list below
it('rolls 3d6 per attribute deterministically and within bounds', () => {
  const first = rollAttributes([9, 8, 7, 6]);
  const second = rollAttributes([9, 8, 7, 6]);
  expect(first).toEqual(second);
  for (const name of ATTRIBUTE_ORDER) {
    expect(first.attributes[name]).toBeGreaterThanOrEqual(3);
    expect(first.attributes[name]).toBeLessThanOrEqual(18);
  }
});
it('reroll consumes a disjoint draw sequence', () => {
  const first = rollAttributes([9, 8, 7, 6]);
  const rerolled = rerollAttributes(first);
  expect(rerolled.attributes).not.toEqual(first.attributes); // astronomically unlikely to collide; if this seed collides, pick another
  expect(rerolled.state).not.toEqual(first.state);
});
it('computes point-buy cost from the table with exact budget edges', () => { /* all-min = 0; a block exactly at budget valid; +1 over invalid */ });
it('validateHeroChoices rejects each illegal choice', () => { /* locked class, foreign kitId, 3 traits, duplicate traits, out-of-bounds attribute, over-budget point buy, invalid name, unknown ids — table-driven, each asserting the thrown message names the field */ });
it('heroFromChoices assembles kit + background extras + merged modifiers', () => {
  const hero = heroFromChoices({ pack, choices: lamplighterLanternChoices });
  expect(hero.classTags).toEqual(['lamplighter']);
  expect(hero.equipped).toEqual(expect.arrayContaining([expect.objectContaining({ contentId: 'item.brass-lantern' })]));
  expect(hero.backpack).toEqual(expect.arrayContaining([expect.objectContaining({ contentId: 'item.lamp-oil' })]));
  expect(hero.statModifiers).toEqual({ search: 1, defense: 1 }); // deep-miner background + sure-footed trait
});
it('heroFromChoices output always passes validateHeroChoices (property)', () => { /* fast-check over seeds/class/kit/background/trait combos */ });
```

Property test: for 200 seeds, `rollAttributes`/`rerollAttributes` values always 3..18 and deterministic; `pointBuyCost` is checked-integer (overflow guard test with a poisoned table). Use the real bundled pack (same loader as `new-run.test.ts`).

- [ ] **Step 2: Run and verify RED**

Run: `npm test --workspace @woven-deep/engine -- --run test/chargen.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

`rollAttributes`: state starts at `deriveSeed(seed, 11)` (a fixed nonzero discriminator distinct from the stream discriminators 1–10 in `random.ts:7-18` — add a comment referencing them), then 15 sequential `rollDie(state, 6)` draws, summed in threes per `ATTRIBUTE_ORDER`. `rerollAttributes` continues from `previous.state`. `pointBuyCost`: look up each attribute's cost row (throw if absent), checked-add. `validateHeroChoices`: every rule from the test table, throwing `Error` messages that name the offending field; name validation applies `HERO_NAME_RULES` after `.trim()` and NFC normalization. `heroFromChoices`: resolve class → kit (equipped/backpack copied as `NewRunHeroItem`/`NewRunBackpackItem`), append background `extraItems`, merge background + trait `modifiers` with checked addition per stat key, return the extended `NewRunHero` with `classTags` from the class entry. Extend `NewRunHero` + `DEFAULT_GUEST_HERO` per the Interfaces block. Export everything from `index.ts`.

- [ ] **Step 4: GREEN + full engine suite**

Run: `npm test --workspace @woven-deep/engine && npm run typecheck --workspace @woven-deep/engine`
Expected: all pass; no hash drift (nothing consumes the new fields yet).

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat: add engine character generation module"
```

---

### Task 4: Derived max health and hero modifier threading

**Files:**
- Modify: `packages/engine/src/attributes.ts` (heroModifiers input)
- Modify: `packages/engine/src/new-run.ts` (derived maxHealth; store classTags/statModifiers on HeroState)
- Modify: `packages/engine/src/projection.ts:506`, `src/world-step.ts:112`, `src/world-step.ts:301`, `src/features.ts:194`
- Modify: `packages/engine/src/run-finalize.ts:96`
- Modify: `content/balance/core-gameplay.yaml` (maxHealth formula retune `{ base: 8, vitality: 2 }` → `{ base: 10, vitality: 1 }`)
- Modify: `packages/engine/test/new-run.test.ts`, `test/attributes.test.ts`, `test/run-finalize.test.ts`, plus whichever suites cover the threaded call sites (`test/projection.test.ts`, `test/world-step.test.ts`, `test/features.test.ts` — follow existing file names)
- Possibly re-pin: `packages/engine/test/fixtures/gameplay-demo-hashes.json` (formula retune fallout — inspect first)

**Interfaces:**
- Consumes: Task 2's `HeroState.classTags`/`statModifiers`; Task 3's extended `NewRunHero`; `deriveActorStats` (`attributes.ts:50`) and its four hero call sites.
- Produces: `ActorDerivationInput` gains `readonly heroModifiers?: readonly DerivedStatModifier[]` (folded after condition modifiers); `createNewRun` heroes carry real `classTags`/`statModifiers` and a derived `maxHealth`; `finalizeRun` records real class tags.

- [ ] **Step 1: Write failing tests**

```ts
// attributes.test.ts: heroModifiers folds after conditions; unknown keys still throw
expect(deriveActorStats({ attributes: TENS, formulas, equipmentModifiers: [], conditionModifiers: [], heroModifiers: [{ search: 2 }] }).search).toBe(12);
// new-run.test.ts: derived maxHealth
expect(heroActor(createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO })).maxHealth).toBe(20);   // 10 + 10*1 with the retuned formula
const tough = { ...DEFAULT_GUEST_HERO, attributes: { ...DEFAULT_GUEST_HERO.attributes, vitality: 14 } };
expect(heroActor(createNewRun({ pack, seed: SEED, hero: tough })).maxHealth).toBe(24);
expect(heroActor(createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO })).health).toBe(20);       // starts full
// hero state carries the fields
expect(createNewRun({ pack, seed: SEED, hero: { ...DEFAULT_GUEST_HERO, classTags: ['wayfarer'], statModifiers: { search: 1 } } }).hero.statModifiers).toEqual({ search: 1 });
// projection: hero derived stats include statModifiers (assert the character-sheet derived block reflects search+1)
// world-step/features: a hero with { defense: 1 } is harder to hit / { disarm: 2 } disarms better — assert through the existing test harnesses for those paths
// run-finalize.test.ts: record.classTags === run.hero.classTags
```

- [ ] **Step 2: RED**

Run: `npm test --workspace @woven-deep/engine -- --run test/attributes.test.ts test/new-run.test.ts test/run-finalize.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`deriveActorStats` gains optional `heroModifiers` folded after `conditionModifiers` (same unknown-key guard). Thread `state.hero.statModifiers` (as `[hero.statModifiers]`) at the four hero call sites — each site already distinguishes the hero (`projection.ts:506` explicitly; `world-step.ts:112/:301` and `features.ts:194` resolve any actor: pass `heroModifiers` only when `actor.actorId === state.hero.actorId`). `createNewRun`: store `classTags`/`statModifiers` on the `HeroState`, and compute `maxHealth` via `deriveActorStats({ attributes: hero.attributes, formulas: balance.formulas, equipmentModifiers: [], conditionModifiers: [], heroModifiers: [hero.statModifiers] }).maxHealth` (health starts at maxHealth). Retune the YAML formula. `run-finalize.ts:96` → `classTags: [...run.hero.classTags].sort()`.

- [ ] **Step 4: Demo-hash inspection and GREEN**

Rebuild content+engine, run all demo verifications. Expected drift: `gameplay-demo-hashes.json` only (its fixture hero derives stats from the retuned formula). Inspect the transcript delta — acceptable changes are hero maxHealth/health and downstream derived-stat values ONLY; anything else → STOP and report. Re-pin with the delta described in your report. Then `npm test --workspace @woven-deep/engine && npm run typecheck` — all green.

- [ ] **Step 5: Commit**

```bash
git add packages/engine content/balance packages/engine/test/fixtures
git commit -m "feat: derive hero stats from chargen choices"
```

---

### Task 5: Wizard reducer and chargen screens

**Files:**
- Create: `apps/web/src/session/wizard-reducer.ts`
- Create: `apps/web/test/wizard-reducer.test.ts`
- Create: `apps/web/src/ui/screens/ChargenScreen.tsx` (step components may be siblings in `src/ui/screens/` if it grows past ~300 lines)
- Create: `apps/web/test/chargen-screen.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: engine `rollAttributes`/`rerollAttributes`/`pointBuyCost`/`pointBuyValid`/`validateHeroChoices`/`heroFromChoices`/`HeroChoices`/`ATTRIBUTE_ORDER`/`HERO_NAME_RULES`, `deriveActorStats`, content pack entries (`kind === 'class' | 'background' | 'trait'`), balance `pointBuy` + `attributeMinimum`/`attributeMaximum`.
- Produces:

```ts
// wizard-reducer.ts — pure, no React
export const PORTRAIT_GLYPHS = ['@', '@·gold', '@·ember', '@·mist', '@·moss'] as const; // ids; rendering maps to accent colors
export interface WizardState {
  readonly step: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  readonly name: string;
  readonly portraitGlyph: string;
  readonly method: 'roll' | 'point-buy' | null;
  readonly attributes: BaseAttributes | null;
  readonly rollState: AttributeRoll | null;
  readonly rerollUsed: boolean;
  readonly classId: OpaqueId | null;
  readonly kitId: string | null;
  readonly backgroundId: OpaqueId | null;
  readonly traitIds: readonly OpaqueId[];
}
export type WizardAction =
  | { type: 'set-name'; name: string } | { type: 'set-portrait'; glyph: string }
  | { type: 'choose-method'; method: 'roll' | 'point-buy' } | { type: 'roll' } | { type: 'reroll' }
  | { type: 'set-attribute'; attribute: AttributeName; value: number }   // point-buy only
  | { type: 'choose-class'; classId: OpaqueId } | { type: 'choose-kit'; kitId: string }
  | { type: 'choose-background'; backgroundId: OpaqueId } | { type: 'toggle-trait'; traitId: OpaqueId }
  | { type: 'next' } | { type: 'back' };
export function initialWizardState(seed: Uint32State): WizardState;   // seed retained for roll/reroll
export function wizardReduce(state: WizardState, action: WizardAction, context: { pack: CompiledContentPack; seed: Uint32State }): WizardState;
export function wizardChoices(state: WizardState): HeroChoices | null; // null until step 7 complete
export function wizardPreview(state: WizardState, pack: CompiledContentPack): DerivedActorStats | null; // live deriveActorStats
```

- [ ] **Step 1: Write failing reducer tests** — table-driven per step: `next` blocked until the step's requirement is met (empty name blocks step 1; no method blocks 2; no attributes block 3; locked `choose-class` is a no-op; `choose-kit` from another class is a no-op; third `toggle-trait` is a no-op; point-buy `set-attribute` that would exceed the budget or bounds is a no-op); `roll` populates attributes from the seed deterministically; `reroll` works once then becomes a no-op; `back` preserves entered data; `wizardChoices` null until complete, then matches the selections; `wizardPreview` reflects background+trait modifiers.

- [ ] **Step 2: RED** — `npm run test --workspace @woven-deep/web -- --run test/wizard-reducer.test.ts`

- [ ] **Step 3: Implement the reducer**, then **Step 4: the screens** — one component per step inside `ChargenScreen`, keyboard-first (arrow/enter selection lists reusing the focus conventions; the name field is the only input), locked classes rendered with `silhouetteGlyph`, name, and `unlockHint`, unselectable; derived-stats preview panel on steps 3 and 7; step 7 shows the full summary and Confirm. Component tests (`chargen-screen.test.tsx`): step progression via keyboard, locked-class rendering + rejection, preview values, confirm emits `wizardChoices` payload.

- [ ] **Step 5: GREEN + commit**

Run: `npm run test --workspace @woven-deep/web && npm run typecheck --workspace @woven-deep/web`

```bash
git add apps/web
git commit -m "feat: add character generation wizard"
```

---

### Task 6: Screen state machine, title screen, and boot rewiring

**Files:**
- Create: `apps/web/src/ui/screens/TitleScreen.tsx`
- Modify: `apps/web/src/App.tsx`
- Create: `apps/web/test/title-screen.test.tsx`
- Modify: `apps/web/test/app-boot.test.tsx`
- Modify: `apps/web/e2e/guest-play.spec.ts` (boot query only)
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: Task 5's `ChargenScreen`/`wizardChoices`/`initialWizardState`; `heroFromChoices`/`createNewRun`/`DEFAULT_GUEST_HERO`; `GuestSession` (constructor `{ pack, storage, seed? }`); `decodeActiveRun` (Continue probing); `parseSeedFromQuery` (App.tsx:24); `SAVE_KEY` from storage.ts.
- Produces:

```ts
// App.tsx
export type ScreenState =
  | { screen: 'title' }
  | { screen: 'chargen' }
  | { screen: 'play' }
  | { screen: 'conclusion' }   // payload wiring in Task 7
  | { screen: 'hall'; returnTo: 'title' | 'conclusion' };
export const PORTRAIT_KEY = 'woven-deep.guest-portrait';
// ?quickstart=1 (test-only, documented): skip title+chargen, boot a session with DEFAULT_GUEST_HERO
// ?seed=a.b.c.d continues to pin both the chargen seed and the run seed
```

- [ ] **Step 1: Write failing tests** — `title-screen.test.tsx`: renders Enter the Deep + Hall always; Continue only when the injected storage holds a decodable save (build one with the real engine + codec); keyboard selection dispatches the right navigation callbacks. `app-boot.test.tsx` updates: default boot (no params, no save) lands on the title; `?quickstart=1` lands directly in play with a fresh default-hero session; `?seed=` + quickstart is deterministic; Enter the Deep → chargen screen mounts; completing the wizard (drive the reducer via UI, or mount ChargenScreen with a nearly-complete state helper exported for tests) constructs a `GuestSession` whose hero matches the choices; Continue resumes the stored run; the chosen portrait persists under `PORTRAIT_KEY`.

- [ ] **Step 2: RED** — `npm run test --workspace @woven-deep/web -- --run test/title-screen.test.tsx test/app-boot.test.tsx`

- [ ] **Step 3: Implement** — `App` holds `ScreenState`; the session is created lazily: quickstart/Continue construct it at boot/selection, chargen constructs it at confirm (`new GuestSession({ pack, storage, seed, hero })` — extend the constructor with an optional `hero?: NewRunHero` forwarded to `createNewRun`; default stays `DEFAULT_GUEST_HERO`). Title screen keyboard-first, reusing dialog focus conventions. Portrait glyph saved to `PORTRAIT_KEY` at confirm, loaded on Continue. Update the four existing e2e specs' boot query to `'/play?quickstart=1&seed=11.22.33.44'` — no other e2e edits here.

- [ ] **Step 4: GREEN** — full web suite + typecheck + rebuild + `npm run guest:e2e` (all four existing specs green via quickstart).

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat: add title screen and screen state machine"
```

---

### Task 7: Death flow — conclusion surfacing, finalize-once, sessionStorage Hall repository

**Files:**
- Create: `apps/web/src/session/run-records-storage.ts`
- Create: `apps/web/test/run-records-storage.test.ts`
- Modify: `apps/web/src/session/guest-session.ts`
- Modify: `apps/web/test/guest-session.test.ts`
- Create: `apps/web/src/ui/screens/ConclusionScreen.tsx`
- Create: `apps/web/test/conclusion-screen.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: engine `finalizeRun({ run, content, lifetime })` → `{ run, record, deltas, events }`; `projectRunConclusion({ run, record, achievements })` → `RunConclusionProjection`; `RunRecordRepository` interface + `deepFreezeCopy`/`standingsFromRecords` patterns (`run-record-repository.ts:17/:102`); `StoredHallRecord`/`HallRecordEnrichment`/`LifetimeState`/`LifetimeDeltas`; `SessionStorageLike` keyed get/set; `SessionSnapshot` (guest-session.ts:26).
- Produces:

```ts
// run-records-storage.ts
export const RECORDS_KEY = 'woven-deep.guest-hall';
export function createSessionRunRecordRepository(storage: SessionStorageLike): RunRecordRepository;
// serializes { records, heart, lifetime, appliedDeltaRecordIds } under RECORDS_KEY on every mutation;
// hydrates (and validates shape) on creation; corrupt blob → discarded with a thrown SessionHallCorruptError
// the caller surfaces as a notice while the active run survives.

// guest-session.ts
// SessionSnapshot gains: readonly conclusion: RunConclusionProjection | null;
// GuestSession gains: finalizeConcludedRun(repository: RunRecordRepository, enrichment: HallRecordEnrichment): RunConclusionProjection;
//   - throws if the run is unconcluded; returns the existing projection without re-finalizing when run.conclusion.finalized is already true
//   - otherwise: finalizeRun with repository.lifetime(), repository.appendRecord({ ...record, enrichment }), repository.applyDeltas(deltas),
//     persist the finalized run through the codec, fold the finalize events into the log, republish the snapshot
```

- [ ] **Step 1: Write failing repository tests** — behavioral parity with the in-memory suite (append-only immutability incl. deep-freeze nested mutation, duplicate rejection, delta idempotence, standings shape) PLUS persistence: a second `createSessionRunRecordRepository` over the same storage sees the same records/lifetime; a corrupt blob throws `SessionHallCorruptError` and leaves the storage key cleared. Reuse the real engine to build a genuine `StoredHallRecord` (drive a fixture run to death via `resolveCommand`, `finalizeRun` it — follow `run-finalize.test.ts` fixtures).

- [ ] **Step 2: Write failing session/conclusion tests** — `guest-session.test.ts`: a run driven to death surfaces `snapshot.conclusion` (non-null, `finalized: false` before the app finalizes); `finalizeConcludedRun` returns the full projection (score, heirloom, achievements), appends exactly one record, is idempotent on second call (no duplicate append — assert repository record count), persists the finalized run (reload → `conclusion.finalized === true`, and `finalizeConcludedRun` after reload does NOT re-append). `conclusion-screen.test.tsx`: renders cause with killer name, the last-moments recap (pass the log tail as a prop), the itemized score table rows from `ScoreBreakdown.lines`, heirloom, achievements, the "unverified · this session only" marker, and the three actions (Hall / new hero / title) as keyboard-reachable buttons.

- [ ] **Step 3: RED** — the three new/changed test files.

- [ ] **Step 4: Implement** — repository per the interface (reuse `deepFreezeCopy` semantics — import if exported, else mirror with a comment; check first); session surfacing: after every dispatch, if `run.conclusion !== null`, compute `projectRunConclusion({ run, record: null, achievements: [] })` into the snapshot (cheap, pure); `finalizeConcludedRun` per the contract above. App wiring: when `snapshot.conclusion` first becomes non-null, the app calls `finalizeConcludedRun(repository, { achievedAt: `Run #${repository.records().length + 1}`, portraitGlyph })` and switches `ScreenState` to `conclusion`, passing the returned projection + log tail to `ConclusionScreen`. Restored already-finalized runs (Continue into a dead run) route straight to the conclusion screen without re-finalizing.

- [ ] **Step 5: GREEN + commit** — full web suite + typecheck.

```bash
git add apps/web
git commit -m "feat: finalize runs into the guest hall"
```

---

### Task 8: Hall of Records screen

**Files:**
- Create: `apps/web/src/ui/screens/HallScreen.tsx`
- Create: `apps/web/test/hall-screen.test.tsx`
- Modify: `apps/web/src/App.tsx` (hall wiring from title and conclusion)
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: `RunRecordRepository.records()` (`StoredHallRecord[]`), `compareHallRecords` (engine export) for the tier-then-score sort, `ScoreBreakdown` for the expandable breakdown, Task 6's `ScreenState` (`{ screen: 'hall'; returnTo }`).
- Produces: `<HallScreen repository={...} onBack={...} />`.

- [ ] **Step 1: Write failing tests** — records listed sorted by `compareHallRecords` (build 3 real records with different scores/completion types via the engine fixtures); each row shows portrait glyph, name, class tags, depth, score total, and the "Run #N" marker; outcome and class filters narrow the list; Enter on a row expands the score breakdown lines; every record row and filter is keyboard-reachable; empty Hall renders an explanatory line; the "unverified · this session only" banner is present; Escape/back returns to `returnTo`.

- [ ] **Step 2: RED**, **Step 3: implement** (pure render over `repository.records()`; filters are local component state; sorting via `[...records].sort(compareHallRecords)`), **Step 4: GREEN** (full web suite + typecheck).

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat: add guest hall of records screen"
```

---

### Task 9: End-to-end lifecycle proof, walk re-derivation, cleanup, docs, roadmap

**Files:**
- Create: `apps/web/e2e/run-lifecycle.spec.ts`
- Modify: `apps/web/e2e/guest-play.spec.ts` (re-derive the pinned walk against the retuned stats)
- Modify: `apps/web/test/threat-popover.test.tsx`, `test/play-screen-tier.test.tsx` (keyed storage fakes — the hotfix-review rider)
- Modify: `docs/superpowers/plans/2026-07-13-implementation-roadmap.md`
- Modify: `docs/operations/run-records.md`

**Interfaces:**
- Consumes: the complete 5B slice; the walk-derivation harness documented in `guest-play.spec.ts`'s header and `.superpowers` reports from 5A (if absent, re-derive per the spec-header notes).

- [ ] **Step 1: Wizard e2e** — in `run-lifecycle.spec.ts`: `goto('/play?seed=11.22.33.44')` (NO quickstart) → title → Enter the Deep → drive all seven steps by keyboard (name "Testa", portrait, roll, reroll, switch to point buy, allocate a legal block, Lamplighter + lantern kit, deep-miner background, two traits, confirm) → assert the play screen shows the Lamplighter loadout (brass lantern equipped in the hero panel) and the derived HP from the allocated Vitality.

- [ ] **Step 2: Death-loop e2e** — same spec file: quickstart-boot a seeded run, get the hero killed fast (derive a seed/short input script where waiting adjacent to the first cave-rat without retaliating drains 20 HP — the derivation harness approach from 5A; document the derivation in the spec header) → conclusion screen assertions (cause names the rat, score table rows present, "Recorded in the Hall" marker) → View Hall → the record row exists with "Run #1" → New hero → back at chargen.

- [ ] **Step 3: Re-derive the pinned walk** — the retuned maxHealth formula may shift combat outcomes in `guest-play.spec.ts`'s 107-key walk. Rebuild everything, run the walk; if it breaks, re-derive with the harness and update the pinned keys + header notes. Keep all four legacy specs green.

- [ ] **Step 4: Storage-fake cleanup** — update the two legacy fakes to the keyed `get(key)/set(key, value)` signature with real read-back behavior.

- [ ] **Step 5: Docs + roadmap** — `run-records.md`: guest Hall section (sessionStorage repository, enrichment vocabulary usage, unverified marker). Roadmap: 5B recorded under the milestone 5 decomposition (gate-green phrasing; link spec + this plan).

- [ ] **Step 6: Full verification**

```bash
npm test && npm run typecheck && npm run build
npm run content:validate && npm run content:startup-gate
npm run guest:e2e
npm run gameplay:demo && npm run merchant:demo && npm run population:demo && npm run dungeon:demo && npm run run-records:demo
npm run smoke
git status --short
```

Expected: everything green; only intended files changed.

- [ ] **Step 7: Commit**

```bash
git add apps/web docs
git commit -m "feat: prove chargen and run lifecycle end to end"
```

- [ ] **Step 8: Final review** — run the `superpowers:requesting-code-review` workflow against the branch diff from its merge base; fix confirmed issues RED-first; rerun the affected suites and the verification block before reporting 5B complete.
