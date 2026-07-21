# Character Genesis — Chargen UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the existing 7-step character-generation console to the "Character Genesis" mockup, grounded in the real (already-working) chargen — add a real trait-tag taxonomy, a Review readiness banner, and a "THE LOOM ACCEPTS" confirmation modal; omit epithets.

**Architecture:** The chargen is already fully built and well-tested (engine `chargen.ts` + `wizard-reducer.ts` + `apps/web/src/ui/screens/chargen/**`). This is a **presentation restyle** of that surface plus three small grounded additions. Reuse the existing redesign theme tokens (already in use across chargen: `bg-deep`, `text-fg`, `border-line`, `text-accs`, `var(--color-cool)`, etc.) — do NOT hardcode the mockup's raw hex. Preserve every `role`/`aria-*`/`data-testid`, button text the tests assert, and dispatched action shape: the RTL tests are behavior/ARIA-based, so Tailwind class changes are safe.

**Tech Stack:** React 19, Tailwind v4, TypeScript strict. Content YAML→Zod (`packages/content`). Engine (`packages/engine`). Vitest.

## Global Constraints

- **Reuse existing theme tokens**, never the mockup's raw hex. The mockup palette maps to tokens already in the code (deep/surface/raised/line/fg/fgs/muted/subtle/accent/accs/danger/good/cool/warn).
- **Ground to real content and real derived stats.** The mockup's data is placeholder. Real facts, all confirmed present:
  - Classes: `class.wayfarer` (W, playable, kits blade/ranger), `class.lamplighter` (L, playable, kits lantern/torchbearer), `class.archivist` (locked, unlockHint "Read three lore fragments recovered from fallen champions to unlock the Archivist."), `class.warden` (locked, unlockHint "Survive to depth ten without a single death to unlock the Warden.").
  - Backgrounds: `background.caravan-guard` (+1 **defense**), `background.deep-miner` (+1 **search**, +1 lamp-oil), `background.ratcatcher` (+1 **meleeAccuracy**, +2 travel-ration). Real backgrounds modify **derived stats**, NOT attributes — do NOT adopt the mockup's "+1 AGI" attribute deltas; keep the existing behavior where origin/trait deltas render on the **derived-stats** list (`heroModifierDeltas` in `HeroRecord`), never on attribute rows.
  - Point-buy: budget **30**, cost doubles **above value 10** (from `balance.pointBuy`, via `pointBuyCost`). NOT the mockup's "18 / above 12".
  - `startingCurrency: 40`.
  - Derived stats (`playerVisibleDerivedStats()` → 8): Max health, Max weave, Melee accuracy, Melee damage bonus, Ranged accuracy, Defense, Search, Disarm. Labels come from the single-sourced `DERIVED_STAT_LABELS` (`apps/web/src/ui/derived-stats-display.ts`) — already correct ("Search" not "Perception"; melee/ranged split; "Max weave" present). Do NOT introduce a "Perception" or single "Accuracy" label.
- **Weave already appears** in the preview automatically (`maxWeave` is in `playerVisibleDerivedStats()`); no special wiring.
- **Omit epithets.** No `HeroChoices` epithet field exists. Identity is name + portrait glyph picker only. Do not add an epithet picker.
- **Keep the `⊘` (locked) vs `–` (at-cap) marker distinction** already in `OptionRow` — do NOT adopt the mockup's `⊘`-for-at-cap.
- **Preserve behavior/tests:** every existing chargen test (engine `chargen.test.ts`; web `wizard-reducer.test.ts`, `chargen-screen.test.tsx`, and all `apps/web/src/ui/screens/chargen/*.test.tsx`) must stay green. Preserve `role`/`aria-*`, `data-testid` (`hero-record-portrait`, `hero-record-name-caret`), the dispatched action shapes, and the button texts the tests assert (`◂ BACK`, `NEXT ▸`, `WEAVE ▸`, `⟳ RANDOM`, `▸ WEAVE THE HERO`, the `POINT-BUY`/`ROLL 3D6` method toggle). If a test asserts exact copy you must change, update the test in the same task and say why.
- **DRY/YAGNI/TDD, frequent commits.** Do not fork the shared primitives (`OptionRow`, `FacetedOptionList`, `FilterBar`, `AttributeStepper`, `chargen-components`) — relayout/restyle them in place.

## Mockup design spec (distilled — the visual source of truth)

Three-column shell (`grid-cols-[236px_1fr_340px]`, already present), all monospace except serif accents.

- **Top header bar:** left = `THE WOVEN DEEP` (serif, letter-spaced) · `❦` · `CHARACTER GENESIS · THE LOOM AWAITS` (muted); right = keyboard hint `↑↓ browse · enter choose · ◂ ▸ steps` (subtle, 11px).
- **Left rail (StepMenu):** each step row = zero-padded number `01..07` (accs when current, subtle otherwise) · a `▸ ` caret prefix on the current step's label · label (fgs current / fg satisfied / muted unsatisfied) · a second muted value line (ellipsized) · a trailing dot `●` (good) if satisfied else `○` (subtle). Current row: `bg-raised` + 2px left `accent` border. Below the list, a spacer, then a top-bordered **flavor footer**: `Many enter.` / `Few return.` / `All are woven in.` (subtle, 10px, line-height 1.7).
- **Center header:** `STEP {n} OF 7` (subtle, 10px, letter-spaced 2px) · serif title = the step name (fgs, 20px) · per-step subtitle (muted, 12px). Subtitles, in order:
  1. Identity — "Who descends, and how the Hall will write it."
  2. Calling — "What you are. Two callings are still locked below."
  3. Kit — "How your calling carries its tools."
  4. Attributes — "Spend the budget, or let the Loom cast the dice."
  5. Origin — "Where you came from. It follows you down."
  6. Traits — "Up to two marks. Or none — purity is also a choice."
  7. Review — "Read the record. Then pull the thread."
- **Center nav footer:** `◂ BACK` (bordered, muted; subtle when on step 1) · `{n} / 7` (subtle, centered) · `NEXT ▸` (raised bg, accent border, accs text; hover fills accent) — on step 7 the primary action is the WEAVE CTA in the right rail, keep the existing `WEAVE ▸`/next behavior the tests expect.
- **Option rows (Calling/Kit/Origin/Traits):** marker glyph (◆ selected / ◇ selectable / ⊘ locked / – at-cap) · name (14px) · right-aligned tag pills (1px line border, subtle, 10px, letter-spaced) · description line (muted, 12px, lh 1.5) · optional meta line (e.g. `+1 Defense` in good, unlock hint in cool). Selected row: `bg-raised` + accent border + 2px accent left edge. Keep `OptionRow`'s existing marker semantics.
- **Attributes:** method toggle (two buttons in a bordered box, active = accent bg / deep text). Point-buy: a dotted-leader "Budget remaining … {n}" line with trailing `· above 10 costs double`, then per-attribute rows (abbr in accs, name + note, a `▰▱` bar, − / value / + steppers). Roll: a `⚄ REROLL ONCE` / `FORGIVENESS SPENT` button + "The Loom casts once, forgives once." Keep the real `AttributeStepper`, real `pointBuyCost`, and the real budget (30, double >10).
- **Right rail (HeroRecord):** 56px portrait tile (1px double accent border, raised bg, the class `silhouetteGlyph` or the `@` glyph) · serif name (fgs; blinking caret placeholder when empty, keep `data-testid="hero-record-name-caret"`) · `CLASS · KIT` line (muted, uppercase). Then sections, each headed `· ─ ATTRIBUTES ─ ·` / `· ─ DERIVED ─ ·` / `· ─ LOADOUT ─ ·` / `· ─ MARKS ─ ·` (subtle, 10px, letter-spaced):
  - Attributes: abbr · `▰▱` bar · value · origin `+1` delta (good) — delta only where a background/trait actually modifies that attribute (in practice none do; the real deltas surface under Derived).
  - Derived: dot-leader rows (label ⋯ value + good delta) for the 8 player-visible derived stats, PLUS a final **Gold** row = `startingCurrency` (40) — flat, not a derived stat, no delta unless a future trait adds one.
  - Loadout: kit equipped + backpack + background extra items, glyph-colored.
  - Marks: chosen traits as `cool`-bordered pills; "Unmarked, as yet." when none.
  - Sticky bottom: `▸ WEAVE THE HERO` CTA (accent when ready, raised+disabled otherwise) + a hint line.
- **"THE LOOM ACCEPTS" modal** (on WEAVE, before confirming): centered raised panel, double accent border; `──── ❦ ────` / serif `THE LOOM ACCEPTS` / a woven-sentence naming the hero + calling + kit / "The Deep will remember this one. Eventually." / a `DESCEND` button that fires the real `onConfirm`. Escape or backdrop cancels.

---

## Task 1: Trait-tag taxonomy (content)

Add a real, meaningful tag taxonomy to the 8 traits so the Traits-step filter chips are grounded, replacing the mockup's body/mind/fortune placeholders.

**Files:**
- Modify: `content/traits/first-descent.yaml` (traits: keen-eyed, sure-footed, steady-hands, brawler, sharpshooter)
- Modify: `content/traits/light-out.yaml` (traits: born-in-the-dark, living-compass, dungeon-sense)
- Test: `packages/content/test/` (add/extend a trait-content test asserting the new tags compile and are present)
- Regenerate: `packages/engine/test/fixtures/{gameplay,merchant,population,run-records}-demo-hashes.json` (content-hash-embed class — see below)

**Taxonomy** (each trait keeps its existing `chargen` tag AND gains exactly one category tag; category tags are lowercase slugs):
- `combat` — `trait.brawler` (meleeDamageBonus), `trait.sharpshooter` (rangedAccuracy)
- `survival` — `trait.sure-footed` (defense), `trait.steady-hands` (disarm)
- `perception` — `trait.keen-eyed` (search)
- `darkness` — `trait.born-in-the-dark`, `trait.living-compass`, `trait.dungeon-sense` (the light-out feats)

- [ ] **Step 1: Add category tags to the five first-descent traits.** In `content/traits/first-descent.yaml`, extend each trait's `tags` list (currently `[chargen]`) to include its category: brawler→`combat`, sharpshooter→`combat`, sure-footed→`survival`, steady-hands→`survival`, keen-eyed→`perception`. Keep `chargen`.

- [ ] **Step 2: Add category tags to the three light-out traits.** In `content/traits/light-out.yaml`, add `darkness` to born-in-the-dark, living-compass, dungeon-sense (keep `chargen`).

- [ ] **Step 3: Write a content test asserting the taxonomy.** In a content test (extend an existing traits test or add `packages/content/test/trait-tags.test.ts`), compile the real content dir and assert each trait id carries both `chargen` and its expected category tag, and that the set of category tags across all chargen traits is exactly `{combat, survival, perception, darkness}`.

- [ ] **Step 4: Run the content build + test.** `npm run build --workspace @woven-deep/content && npm run test --workspace @woven-deep/content`. Expected: green, new assertions pass.

- [ ] **Step 5: Regenerate the four content-hash-embed demo fixtures.** Adding tags moves the compiled content-pack hash, which is embedded into saved-state hashes. Regenerate exactly the four fixtures that carry a saveHash-class field: run the demo generators (`npm run gameplay:demo`, `npm run population:demo`, `npm run merchant:demo`, `npm run run-records:demo`) in their regenerate mode (follow each `scripts/*-demo.mjs`'s existing regenerate flag/env — the same mechanism prior content changes used), then confirm the diff touches ONLY saveHash-class fields (contentHash-derived), not event/projection hashes. Engine/dungeon demos must be UNCHANGED. Eyeball the diff and confirm no behavior hash moved.

- [ ] **Step 6: Verify determinism.** `npm run engine:demo && npm run dungeon:demo && npm run gameplay:demo && npm run population:demo && npm run merchant:demo && npm run run-records:demo` — all VERIFY OK. `npm run test --workspace @woven-deep/engine` green.

- [ ] **Step 7: Commit.**
```bash
git add content/traits/ packages/content/test/ packages/engine/test/fixtures/
git commit -m "content: add a trait-tag taxonomy (combat/survival/perception/darkness)"
```

## Task 2: Chargen shell restyle (header, left rail, center header, nav footer)

Restyle `ChargenScreen` + `StepMenu` to the mockup shell, reusing theme tokens. No behavior change.

**Files:**
- Modify: `apps/web/src/ui/screens/ChargenScreen.tsx` (top header bar copy + keyboard hint; center step-header block with `STEP N OF 7` + serif title + per-step subtitle; nav footer styling)
- Modify: `apps/web/src/ui/screens/chargen/StepMenu.tsx` (zero-padded numbers, caret, value line, done dot, current-row styling, flavor footer)
- Create: `apps/web/src/ui/screens/chargen/step-copy.ts` (the 7 subtitles + the flavor-footer lines, single-sourced)
- Test: `apps/web/src/ui/screens/chargen/StepMenu.test.tsx`, `apps/web/test/chargen-screen.test.tsx` (adjust only where copy/structure the test asserts changed; keep role/aria/testid coverage)

- [ ] **Step 1: Add `step-copy.ts`** exporting `STEP_SUBTITLES: Record<1..7, string>` (the 7 subtitles verbatim from the spec) and `LOOM_FOOTER_LINES = ['Many enter.', 'Few return.', 'All are woven in.']`.

- [ ] **Step 2: Restyle the top header bar** in `ChargenScreen.tsx` — `THE WOVEN DEEP` (serif) · `❦` · `CHARACTER GENESIS · THE LOOM AWAITS` on the left; keyboard hint `↑↓ browse · enter choose · ◂ ▸ steps` on the right. Tokens only.

- [ ] **Step 3: Restyle the center step-header block** — replace the current header with `STEP {step} OF 7` (subtle, letter-spaced) + serif step title (from `STEP_LABELS`) + `STEP_SUBTITLES[step]`. Keep the existing step-body switch and `stepProps` untouched.

- [ ] **Step 4: Restyle the nav footer** — `◂ BACK` / `{n} / 7` / `NEXT ▸`(or existing `WEAVE ▸`) to the mockup look; preserve `canAdvance`/dispatch and the exact button texts the tests assert.

- [ ] **Step 5: Restyle `StepMenu` rows** — zero-padded `0{n}`, `▸ ` caret on current, value line (keep the existing `currentValue()` name-resolution), trailing `●`/`○` dot (from `stepIsSatisfied`), current-row `bg-raised` + accent left border. Append the flavor footer (`LOOM_FOOTER_LINES`) below a spacer with a top border. Keep `role="option"`, jump gating, and name resolution.

- [ ] **Step 6: Run web tests.** `npm run test --workspace @woven-deep/web -- StepMenu chargen-screen`. Fix assertions only where copy/DOM you intentionally changed; keep all role/aria/testid checks. Expected: green.

- [ ] **Step 7: Commit.** `feat: restyle chargen shell (header, step rail, nav) to Character Genesis mockup`

## Task 3: HeroRecord preview restyle + Gold line + attribute-label normalization

**Files:**
- Modify: `apps/web/src/ui/screens/chargen/HeroRecord.tsx` (portrait tile, serif name, CLASS·KIT line, `· ─ SECTION ─ ·` headers, attribute/derived/loadout/marks styling, WEAVE CTA + hint; add Gold row from `startingCurrency`)
- Modify: `apps/web/src/ui/screens/chargen/steps/AttributesStep.tsx`, `steps/ReviewStep.tsx` (use `ATTRIBUTE_LABELS` from `derived-stats-display.ts` instead of ad-hoc capitalization)
- Test: `apps/web/src/ui/screens/chargen/HeroRecord.test.tsx` (keep testids `hero-record-portrait`/`hero-record-name-caret`, delta/enable coverage; add a Gold-row assertion)

- [ ] **Step 1: Restyle the record header** — 56px portrait tile (double accent border, raised bg, class `silhouetteGlyph` or `@`), serif name with the empty-name blinking caret (`data-testid="hero-record-name-caret"`), `CLASS · KIT` uppercase muted line. Keep `data-testid="hero-record-portrait"`.

- [ ] **Step 2: Restyle the four sections** with `· ─ ATTRIBUTES ─ ·` etc. headers — attribute rows (`▰▱` bar + value + real origin/trait attribute delta, which is normally empty), derived dot-leader rows (label ⋯ value + good delta from `heroModifierDeltas`, using `DERIVED_STAT_LABELS`), loadout (glyph-colored kit+background items), marks (`cool`-bordered trait pills / "Unmarked, as yet.").

- [ ] **Step 3: Add the Gold row** to the Derived section — label "Gold", value `` `${balance.startingCurrency}g` `` read from the pack's balance entry (same source the engine uses). Flat, no delta. Place it after the derived stats. (If a trait later grants gold, a delta can be added then — YAGNI now.)

- [ ] **Step 4: Restyle the WEAVE CTA** — `▸ WEAVE THE HERO` (accent when `canWeave`, raised/disabled otherwise) + hint line ("The Loom is ready." / "Complete the ○ steps to weave."). Keep the existing `onWeave`/`canWeave` props and button text.

- [ ] **Step 5: Normalize attribute labels** — in `AttributesStep.tsx` and `ReviewStep.tsx`, import and use `ATTRIBUTE_LABELS` (and abbreviations) from `derived-stats-display.ts` instead of `.charAt(0).toUpperCase()`.

- [ ] **Step 6: Run web tests.** `npm run test --workspace @woven-deep/web -- HeroRecord AttributesStep ReviewStep steps-`. Add the Gold-row assertion. Expected: green.

- [ ] **Step 7: Commit.** `feat: restyle chargen hero-record preview + add Gold line`

## Task 4: Step-body restyle (Identity, Calling, Kit, Attributes, Origin, Traits, Review)

Restyle the 7 step bodies + shared option primitives to the mockup, grounded in real content. No behavior change beyond styling and the Attributes copy fix.

**Files:**
- Modify: `apps/web/src/ui/screens/chargen/steps/{IdentityStep,CallingStep,KitStep,AttributesStep,OriginStep,TraitsStep,ReviewStep}.tsx`
- Modify: `apps/web/src/ui/screens/chargen/OptionRow.tsx`, `FacetedOptionList.tsx`, `FilterBar.tsx`, `AttributeStepper.tsx`, `chargen-components.tsx` (restyle in place; do NOT fork)
- Test: the corresponding `*.test.tsx` under `apps/web/src/ui/screens/chargen/` (adjust copy assertions you change; keep role/aria/marker/keyboard coverage)

- [ ] **Step 1: Identity** — name `Input` + `⟳ RANDOM` button + portrait glyph picker (`role=listbox`) styled to the mockup; NO epithet section. Keep name validation + onboarding checkbox + testids.

- [ ] **Step 2: Calling / Kit / Origin** — restyle via `OptionRow`/`FacetedOptionList` to the mockup option-row look (marker, name, right tag pills, description, meta). Origin meta shows the real `+1 {DerivedLabel}` (defense/search/meleeAccuracy) via `modifiersMeta`. Keep locked-class `⊘` + unlock hint and single-select markers.

- [ ] **Step 3: Attributes** — restyle the method toggle + steppers; the point-buy budget line reads the real budget (30) and shows `· above 10 costs double` (NOT ">12"). Keep the `POINT-BUY`/`ROLL 3D6` toggle text and the reroll-once control.

- [ ] **Step 4: Traits** — restyle rows; `–` at-cap marker at 2/2 (keep the OptionRow disabled semantics, not the mockup's `⊘`); show the `n/2` counter. (Filter chips wired in Task 5.)

- [ ] **Step 5: Review** — restyle the dot-leader summary rows (Name/Calling/Kit/Attributes/Origin/Marks/Starting gold) to the mockup; real values. (Readiness banner in Task 6.)

- [ ] **Step 6: Restyle shared primitives** `OptionRow`/`FacetedOptionList`/`FilterBar`/`AttributeStepper`/`chargen-components` in place to match the mockup, preserving all props, markers, `role`/`aria`, and keyboard navigation.

- [ ] **Step 7: Run web tests.** `npm run test --workspace @woven-deep/web -- chargen`. Fix only intentionally-changed copy; keep behavior coverage. Expected: green.

- [ ] **Step 8: Commit.** `feat: restyle chargen step bodies to Character Genesis mockup`

## Task 5: Traits-step filter chips wired to the taxonomy

Drive the Traits `FilterBar` chips from the real category tags (Task 1), excluding the internal `chargen` marker.

**Files:**
- Modify: `apps/web/src/ui/screens/chargen/steps/TraitsStep.tsx` (map each trait's tags to the display taxonomy, dropping `chargen`, before passing to `FacetedOptionList`)
- Test: `apps/web/src/ui/screens/chargen/steps-origin-traits.test.tsx` (assert the category chips appear and filter)

- [ ] **Step 1: Filter the `chargen` tag out of trait entries' displayed tags** in `TraitsStep.tsx` so `useListFacets` unions only the category tags (`combat/survival/perception/darkness`) into chips and the row tag pills show the category, not `chargen`.

- [ ] **Step 2: Add a test** asserting the four category chips render for the Traits step and that clicking a chip filters the list to that category (e.g. `combat` → brawler + sharpshooter), and `ALL` clears.

- [ ] **Step 3: Run web tests.** `npm run test --workspace @woven-deep/web -- steps-origin-traits FacetedOptionList use-list-facets`. Expected: green.

- [ ] **Step 4: Commit.** `feat: drive chargen trait filter chips from the tag taxonomy`

## Task 6: Review readiness banner

Add a "ready / threads-missing" banner to the Review step, listing incomplete steps by name.

**Files:**
- Modify: `apps/web/src/ui/screens/chargen/steps/ReviewStep.tsx`
- Test: `apps/web/src/ui/screens/chargen/steps-review.test.tsx`

- [ ] **Step 1: Compute readiness** from the existing `stepIsSatisfied(state, n)` for steps 1..6. When all satisfied, render a `good`-bordered banner: "Every thread is in place. Pull it — weave the hero and descend." When not, render a `warn`-bordered banner naming the incomplete steps (via `STEP_LABELS`): "Threads are missing: {Names}. Steps marked ○ in the left rail still need choices."

- [ ] **Step 2: Write tests** — a complete state shows the ready banner (good); a state missing (e.g.) Calling shows the warn banner naming "Calling". Use the existing wizard-state test helpers.

- [ ] **Step 3: Run web tests.** `npm run test --workspace @woven-deep/web -- steps-review`. Expected: green.

- [ ] **Step 4: Commit.** `feat: add chargen Review readiness banner`

## Task 7: "THE LOOM ACCEPTS" confirmation modal

Insert a confirmation modal between the WEAVE action and `onConfirm`.

**Files:**
- Create: `apps/web/src/ui/screens/chargen/LoomAcceptsModal.tsx`
- Modify: `apps/web/src/ui/screens/ChargenScreen.tsx` (open the modal on WEAVE when valid; `DESCEND` fires the real `onConfirm(choices, portraitGlyph)`; Escape/backdrop cancels)
- Test: `apps/web/test/chargen-screen.test.tsx` (WEAVE opens the modal; DESCEND calls `onConfirm` with the right args; cancel does not)

- [ ] **Step 1: Build `LoomAcceptsModal`** — a focus-trapped dialog (`role="dialog"`, `aria-modal`, labelled), centered raised panel with double accent border: `──── ❦ ────` / serif `THE LOOM ACCEPTS` / a woven sentence naming the hero + calling + kit (compose from the wizard state + pack names) / "The Deep will remember this one. Eventually." / a `DESCEND` button + Escape/backdrop close. Reuse the existing overlay/dialog primitive if one exists in `apps/web/src/ui/components/`.

- [ ] **Step 2: Wire it into `ChargenScreen`** — the WEAVE action (currently calling `onConfirm`) instead opens the modal when the choices are valid; `DESCEND` calls the real `onConfirm(wizardChoices, portraitGlyph)`; cancel closes without confirming. Preserve the existing valid-gating.

- [ ] **Step 3: Update the screen test** — completing the flow + clicking WEAVE opens the modal (does NOT immediately confirm); clicking DESCEND calls `onConfirm` with `(wizardChoices, portraitGlyph)`; Escape/backdrop cancels without calling `onConfirm`.

- [ ] **Step 4: Run web tests.** `npm run test --workspace @woven-deep/web -- chargen-screen`. Expected: green.

- [ ] **Step 5: Commit.** `feat: add THE LOOM ACCEPTS chargen confirmation modal`

## Task 8: Whole-surface verification

- [ ] **Step 1: Full gate.** From the worktree root: `npm run verify`. Expected exit 0 (typecheck, lint, format:check, depcruise, knip, all suites).
- [ ] **Step 2: Demo replays.** `npm run engine:demo && npm run dungeon:demo && npm run gameplay:demo && npm run population:demo && npm run merchant:demo && npm run run-records:demo` — all VERIFY OK (only the four content-hash-embed fixtures moved, from Task 1; engine/dungeon unchanged).
- [ ] **Step 3: Format.** If `format:check` flags anything, run the formatter and re-verify.
- [ ] **Step 4: Commit any format fixups.**

## Self-review notes

- Spec coverage: layout restyle (Tasks 2–4), trait-tag taxonomy (Tasks 1, 5), Review banner (Task 6), confirmation modal (Task 7), omit epithets (Task 4 Step 1), keep ⊘/– (Task 4 Step 4), real content/derived/point-buy/Gold (Tasks 2–4, Global Constraints). All from the user's three decisions + the design doc.
- Already-done (do NOT redo): DERIVED_STAT_LABELS consolidation, Perception→Search, melee/ranged split, Weave-in-preview — all present on main.
- The one content change (Task 1) is the only source of demo-hash movement; everything else is web-only and must not move any hash.
