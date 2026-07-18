# Chargen "Console" Flow Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild character creation as a fixed three-pane "terminal console" (step menu · detail · live hero record) with the handoff's reordered 7-step flow, rendered in the Grimoire tokens/components from sub-project 1.

**Architecture:** Presentation rebuild of the chargen UI plus one small reorder in the session-layer wizard state machine. The pure reducer (`session/wizard-reducer.ts`) gets a remapped `stepSatisfied` for the new step order; everything else is React under `apps/web/src/ui/screens/`. `ChargenScreen.tsx` keeps its exact props so `App.tsx` is untouched. The engine still consumes the same `HeroChoices`.

**Tech Stack:** React 19, Vite 7, TypeScript 5.8; Tailwind v4 + the SP1 Grimoire tokens + vendored components (`Button`/`Input`, `cn`, `useListNavigation`); Vitest + Testing Library + user-event; Playwright e2e. All chargen logic (`pointBuyCost`, `rollAttributes`/`rerollAttributes`, `HERO_NAME_RULES`, `deriveActorStats`) comes from `@woven-deep/engine` unchanged.

## Global Constraints

- **Adapt, don't recolor:** build the handoff's structure/UX/interactions in the SP1 Grimoire tokens + existing components. Do NOT introduce the handoff's cooler console hex; use existing token utilities (`bg-surface`/`bg-raised`/`bg-deep`, `text-fg`/`text-muted`/`text-subtle`, `border-line`, `text-accent`/`bg-accent`, `text-danger`, `text-good`, `font-mono`). JetBrains Mono is already `--font-mono`.
- **Reordered 7-step flow:** `1 Identity → 2 Calling → 3 Kit → 4 Attributes → 5 Origin → 6 Traits → 7 Review`. The attribute-method choice (point-buy/3d6) is folded into the Attributes step; Origin (background) and Traits are separate steps.
- **Session-layer touch is exactly one file:** `apps/web/src/session/wizard-reducer.ts` (remap `stepSatisfied` to the new order). Do NOT change the `WizardState`/`WizardAction` shapes, the action semantics, `wizardChoices`, or `wizardPreview` — only the step→validity mapping. Do NOT modify `packages/engine`, `packages/content`, the grid renderer, or other screens/overlays.
- **`ChargenScreen.tsx` keeps its exact props** `{ pack, seed, settings?, onChangeSettings?, onConfirm }` so `App.tsx` needs no change. `onConfirm(choices: HeroChoices, portraitGlyph: string)` is the start-run call.
- **Preserve every validation exactly** (all enforced in the reducer already): name via `HERO_NAME_RULES`; point-buy budget via engine `pointBuyCost` + the `balance` content entry; one reroll per session; locked classes unselectable; ≤2 traits (`MAX_TRAITS`).
- **Conditional facets:** a step's search box + tag chips render ONLY when its option list length exceeds **6**; tags read from `entry.tags` (no schema change). With current content every list is ≤6, so facets ship dormant — but must be built and tested with a synthetic >6 list.
- **No history comments** (describe current behavior/intent, never what changed).
- **Build order:** build `@woven-deep/content` + `@woven-deep/engine` dist before the web suite.
- Node ≥22.12, ESM, TypeScript strict.

---

## File Structure

New, under `apps/web/src/ui/screens/chargen/`:
- `chargen-components.tsx` — small reusable ASCII pieces: `BlockBar`, `DotLeaderRow`, `TagChip`.
- `OptionRow.tsx` — the option-list row (marker · body · meta · tags; selected/locked variants).
- `AttributeStepper.tsx` — point-buy per-attribute row (abbr · label+cost · block-bar · −/value/+).
- `use-list-facets.ts` — the conditional search/tag hook.
- `FilterBar.tsx` — search input + `{shown}/{total}` + tag chips (rendered by list steps when facets visible).
- `HeroRecord.tsx` — the live right pane.
- `StepMenu.tsx` — the left BUILD ORDER pane.
- `steps.tsx` — the seven step bodies: `IdentityStep`, `CallingStep`, `KitStep`, `AttributesStep`, `OriginStep`, `TraitsStep`, `ReviewStep`.

Modified:
- `apps/web/src/session/wizard-reducer.ts` — remap `stepSatisfied`.
- `apps/web/src/ui/screens/ChargenScreen.tsx` — rebuilt into the three-pane `ChargenConsole` shell (same props).

Retired (deleted once unreferenced):
- `apps/web/src/ui/screens/chargen-steps.tsx` (its components are superseded by `chargen/steps.tsx`), and its dead `.chargen-*` styling assumptions.

---

### Task 1: Reorder the wizard step machine

**Files:**
- Modify: `apps/web/src/session/wizard-reducer.ts` (`stepSatisfied`, ~lines 107-117)
- Test: `apps/web/test/wizard-reducer.test.ts` (extend the existing reducer test file; if none exists, create it)

**Interfaces:**
- Consumes: existing `WizardState`, `WizardAction`, `wizardReduce`, `wizardChoices`, `initialWizardState`, `WizardContext` (unchanged shapes).
- Produces: the new step→meaning contract — `1` name/portrait, `2` classId, `3` kitId, `4` attributes (method+values), `5` backgroundId, `6` traits (optional), `7` review. `stepSatisfied` returns true for step 6 always (traits optional).

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/test/wizard-reducer.test.ts` (import `initialWizardState`, `wizardReduce`, `wizardChoices` from `../src/session/wizard-reducer.js`; build a `context` with the compiled default pack — reuse the test helper the repo already uses to load the pack, or `loadDefaultPack()`; seed via a fixed `Uint32State`). Assert the NEW order:
```ts
it('advances Identity(1) → Calling(2) → Kit(3) → Attributes(4) → Origin(5) → Traits(6) → Review(7)', () => {
  // name gates step 1
  let s = initialWizardState(seed);
  expect(wizardReduce(s, { type: 'next' }, ctx)).toBe(s);           // blocked: no name
  s = wizardReduce(s, { type: 'set-name', name: 'Ash' }, ctx);
  s = wizardReduce(s, { type: 'next' }, ctx); expect(s.step).toBe(2);
  // class gates step 2
  expect(wizardReduce(s, { type: 'next' }, ctx)).toBe(s);           // blocked: no class
  s = wizardReduce(s, { type: 'choose-class', classId: PLAYABLE_CLASS_ID }, ctx);
  s = wizardReduce(s, { type: 'next' }, ctx); expect(s.step).toBe(3);
  // kit gates step 3
  s = wizardReduce(s, { type: 'choose-kit', kitId: KIT_ID }, ctx);
  s = wizardReduce(s, { type: 'next' }, ctx); expect(s.step).toBe(4);
  // attributes gate step 4 (roll or point-buy)
  s = wizardReduce(s, { type: 'choose-method', method: 'roll' }, ctx);
  s = wizardReduce(s, { type: 'roll' }, ctx);
  s = wizardReduce(s, { type: 'next' }, ctx); expect(s.step).toBe(5);
  // background gates step 5
  s = wizardReduce(s, { type: 'choose-background', backgroundId: BG_ID }, ctx);
  s = wizardReduce(s, { type: 'next' }, ctx); expect(s.step).toBe(6);
  // traits optional — step 6 advances with zero traits
  s = wizardReduce(s, { type: 'next' }, ctx); expect(s.step).toBe(7);
  expect(wizardChoices(s)).toMatchObject({ name: 'Ash', classId: PLAYABLE_CLASS_ID, kitId: KIT_ID, backgroundId: BG_ID });
});

it('choosing a class on step 2 resets a previously chosen kit', () => {
  // reach step 2, choose class A, advance to 3, choose kit, back to 2, choose class B → kitId null
});

it('point-buy path also satisfies step 4', () => {
  // choose-method point-buy → attributes seeded non-null → step 4 advances
});
```
Resolve `PLAYABLE_CLASS_ID`, `KIT_ID`, `BG_ID` from the pack in the test (e.g. the first `kind==='class' && playable` entry, its `kits[0].kitId`, the first `kind==='background'`).

- [ ] **Step 2: Run to verify failure**

```bash
npm run build -w @woven-deep/content && npm run build -w @woven-deep/engine
npm run test -w @woven-deep/web -- wizard-reducer.test.ts
```
Expected: FAIL — old order gates class at step 4, so the step-2 class assertion fails.

- [ ] **Step 3: Remap `stepSatisfied`**

Replace the `stepSatisfied` switch body with the new order:
```ts
function stepSatisfied(state: WizardState): boolean {
  switch (state.step) {
    case 1: return nameIsValid(state.name);       // Identity
    case 2: return state.classId !== null;        // Calling
    case 3: return state.kitId !== null;          // Kit
    case 4: return state.attributes !== null;     // Attributes (method + values)
    case 5: return state.backgroundId !== null;   // Origin
    case 6: return true;                          // Traits (optional, capped in toggle-trait)
    case 7: return false;                         // Review (terminal)
  }
}
```
Leave every action, `wizardChoices`, and `wizardPreview` unchanged (their field requirements are order-independent). `choose-class` already resets `kitId`, which is now correct since Kit follows Calling.

- [ ] **Step 4: Run to verify pass**

```bash
npm run test -w @woven-deep/web -- wizard-reducer.test.ts
npm run typecheck -w @woven-deep/web
```
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/session/wizard-reducer.ts apps/web/test/wizard-reducer.test.ts
git commit -m "feat(chargen): reorder wizard step machine (Identity→Calling→Kit→Attributes→Origin→Traits→Review)"
```

---

### Task 2: BlockBar, DotLeaderRow, TagChip

**Files:**
- Create: `apps/web/src/ui/screens/chargen/chargen-components.tsx`
- Test: `apps/web/src/ui/screens/chargen/chargen-components.test.tsx`

**Interfaces:**
- Produces:
  - `BlockBar({ value, max, cells, color? }: { value: number; max: number; cells: number; color?: string }): JSX.Element` — renders `n = Math.round((value / max) * cells)` filled `█` (colored via `color` inline, default `text-accent`) then `cells - n` empty `█` in `--bar-empty` (`text-[color:var(--color-bar-empty)]` — add `--color-bar-empty: #20293c`-equivalent-warm to `tokens.css`? NO: reuse existing `text-subtle`/a muted token; use `text-[color:var(--color-line)]` for empty). `white-space:nowrap; letter-spacing:1px`. `aria-hidden` (the numeric value is shown beside it by callers).
  - `DotLeaderRow({ label, value, delta? }: { label: string; value: string; delta?: number }): JSX.Element` — `label` · a flex spacer with a dotted bottom border · `value`; when `delta` is a nonzero number, append ` +{delta}` in `text-good` (or `text-danger` if negative).
  - `TagChip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }): JSX.Element` — a small button; selected → `bg-accent text-deep`, else `border border-line text-muted`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BlockBar, DotLeaderRow, TagChip } from './chargen-components.js';

describe('BlockBar', () => {
  it('fills round(value/max*cells) cells and pads the rest, total = cells', () => {
    const { container } = render(<BlockBar value={6} max={30} cells={10} />);
    const text = container.textContent ?? '';
    expect([...text].filter((c) => c === '█')).toHaveLength(10); // 2 filled + 8 empty
  });
});
describe('DotLeaderRow', () => {
  it('shows a positive delta in the positive tone', () => {
    render(<DotLeaderRow label="Defense" value="15" delta={2} />);
    expect(screen.getByText(/\+2/)).toBeInTheDocument();
  });
});
describe('TagChip', () => {
  it('calls onClick', async () => {
    const onClick = vi.fn();
    render(<TagChip label="Melee" selected={false} onClick={onClick} />);
    screen.getByRole('button', { name: 'Melee' }).click();
    expect(onClick).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm run test -w @woven-deep/web -- chargen-components.test.tsx` → FAIL (module missing).

- [ ] **Step 3: Implement the three components** in `chargen-components.tsx` per the interfaces above, token-styled, `font-mono`. `BlockBar` builds the two glyph runs with `'█'.repeat(n)` / `'█'.repeat(cells - n)` inside spans (filled span colored, empty span muted), wrapped `aria-hidden` with `whitespace-nowrap tracking-[1px]`.

- [ ] **Step 4: Run to verify pass** — the test file + `npx tsc -p apps/web/tsconfig.json --noEmit` (exit 0).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui/screens/chargen/chargen-components.tsx apps/web/src/ui/screens/chargen/chargen-components.test.tsx
git commit -m "feat(chargen): BlockBar, DotLeaderRow, TagChip components"
```

---

### Task 3: OptionRow + AttributeStepper

**Files:**
- Create: `apps/web/src/ui/screens/chargen/OptionRow.tsx`, `apps/web/src/ui/screens/chargen/AttributeStepper.tsx`
- Test: `apps/web/src/ui/screens/chargen/OptionRow.test.tsx`, `apps/web/src/ui/screens/chargen/AttributeStepper.test.tsx`

**Interfaces:**
- Consumes: `BlockBar` (Task 2).
- Produces:
  - `OptionRow({ glyph?, glyphColor?, name, meta?, description?, tags?, marker, selected, locked, lockHint?, onSelect }: { glyph?: string; glyphColor?: string; name: string; meta?: string; description?: string; tags?: readonly string[]; marker: 'single' | 'multi'; selected: boolean; locked?: boolean; lockHint?: string; onSelect: () => void }): JSX.Element` — `role="option"` `aria-selected={selected}`; single-select marker `(•)`/`( )`, multi-select `[×]`/`[ ]`, locked `⊘`; locked → `aria-disabled`, dashed border, `onSelect` inert, shows `lockHint`. Selected → `border-accent bg-raised`. Optional 40px glyph tile.
  - `AttributeStepper({ abbr, abbrColor, label, cost, value, max, canDecrement, canIncrement, onDecrement, onIncrement }: {...}): JSX.Element` — colored `abbr`, `label` + `{cost} pts` note, a `BlockBar`, and `−`/value/`+` buttons; `−`/`+` disabled per `canDecrement`/`canIncrement`.

- [ ] **Step 1: Write failing tests** — OptionRow: selected shows `(•)` and `aria-selected="true"`; locked row is `aria-disabled` and `onSelect` is NOT called on click, and shows its `lockHint`; multi variant shows `[×]` when selected. AttributeStepper: `+` disabled when `canIncrement={false}` and clicking it does not call `onIncrement`; `−` calls `onDecrement`.

- [ ] **Step 2: Run to verify failure** — modules missing.

- [ ] **Step 3: Implement** both components, token-styled, reusing `BlockBar`. Locked `OptionRow` renders a non-interactive element (or a `disabled` button) so click is inert.

- [ ] **Step 4: Run tests + typecheck** — PASS + exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui/screens/chargen/OptionRow.tsx apps/web/src/ui/screens/chargen/AttributeStepper.tsx apps/web/src/ui/screens/chargen/OptionRow.test.tsx apps/web/src/ui/screens/chargen/AttributeStepper.test.tsx
git commit -m "feat(chargen): OptionRow + AttributeStepper components"
```

---

### Task 4: Conditional facets — `use-list-facets` + FilterBar

**Files:**
- Create: `apps/web/src/ui/screens/chargen/use-list-facets.ts`, `apps/web/src/ui/screens/chargen/FilterBar.tsx`
- Test: `apps/web/src/ui/screens/chargen/use-list-facets.test.tsx`

**Interfaces:**
- Consumes: `TagChip` (Task 2).
- Produces:
  - `FACET_THRESHOLD = 6` (exported const).
  - `useListFacets<T extends { name: string; description?: string; tags: readonly string[] }>(items: readonly T[]): { visible: boolean; query: string; setQuery: (q: string) => void; activeTag: string | null; setActiveTag: (t: string | null) => void; allTags: readonly string[]; filtered: readonly T[]; shown: number; total: number }` — `visible = items.length > FACET_THRESHOLD`; `filtered` applies case-insensitive substring over `name`+`description` and, when `activeTag` is set, `tags.includes(activeTag)`; `allTags` = sorted union of item tags. Selection state resets naturally because each list step mounts fresh per step.
  - `FilterBar({ facets }: { facets: ReturnType<typeof useListFacets<...>> }): JSX.Element | null` — returns `null` when `!facets.visible`; else a search `Input` (`⌕` prefix) + `{shown}/{total}` + a chip row (`ALL` + one `TagChip` per tag).

- [ ] **Step 1: Write failing tests**

```tsx
it('is hidden at or below the threshold', () => {
  const { result } = renderHook(() => useListFacets(makeItems(6)));
  expect(result.current.visible).toBe(false);
});
it('is visible above the threshold and filters by query (name+description, case-insensitive)', () => {
  const { result } = renderHook(() => useListFacets(makeItems(7)));
  expect(result.current.visible).toBe(true);
  act(() => result.current.setQuery('ITEM 3'));
  expect(result.current.filtered.map((i) => i.name)).toEqual(['item 3']);
});
it('filters by active tag and ALL clears it', () => { /* setActiveTag('melee') → only tagged items; setActiveTag(null) → all */ });
```
(`makeItems(n)` builds `n` items `{ name: 'item i', description: '', tags: i % 2 ? ['melee'] : ['ranged'] }`.)

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** the hook (`useState` for query/activeTag; `useMemo` for `allTags`/`filtered`) and `FilterBar`.

- [ ] **Step 4: Run tests + typecheck.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui/screens/chargen/use-list-facets.ts apps/web/src/ui/screens/chargen/FilterBar.tsx apps/web/src/ui/screens/chargen/use-list-facets.test.tsx
git commit -m "feat(chargen): conditional list facets (search + tag chips)"
```

---

### Task 5: HeroRecord (live right pane)

**Files:**
- Create: `apps/web/src/ui/screens/chargen/HeroRecord.tsx`
- Test: `apps/web/src/ui/screens/chargen/HeroRecord.test.tsx`

**Interfaces:**
- Consumes: `BlockBar`, `DotLeaderRow` (Task 2); `wizardPreview`, `wizardChoices`, `WizardState`, `PORTRAIT_GLYPHS` (reducer); `ATTRIBUTE_ORDER`, `DERIVED_STAT_NAMES` (engine, as used by the current `PreviewPanel`).
- Produces: `HeroRecord({ state, pack, onWeave, canWeave }: { state: WizardState; pack: CompiledContentPack; onWeave: () => void; canWeave: boolean }): JSX.Element` — portrait tile (class glyph or `PORTRAIT_GLYPHS`), name (blinking `_` caret when empty, gated by `motion-reduced`), `CLASS · KIT` + origin line, attribute `BlockBar` rows (10 cells), derived-stat `DotLeaderRow`s with green `+n` when a background/trait modifier applies (derive the same way `wizardPreview` does — compute the base-vs-modified delta), a loadout block (equipped rows + backpack rows from the chosen class kit + background `extraItems`), and a pinned `▸ WEAVE THE HERO` `Button` (accent when `canWeave`, calling `onWeave`).

- [ ] **Step 1: Write the failing test** — render `HeroRecord` with a stub `state` (name set, a chosen class/kit/background, rolled attributes) inside a pack; assert: the name renders; each `ATTRIBUTE_ORDER` attribute shows its value; at least one derived stat renders; the `WEAVE THE HERO` button is enabled when `canWeave` and calls `onWeave` on click; with an empty name the caret element is present.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** `HeroRecord`. Reuse the `wizardPreview` math for derived stats; for the `+delta`, compute derived stats with and without the hero modifiers (or read modifier sums) and pass the difference to `DotLeaderRow`. Loadout: resolve the chosen `class.kits.find(k => k.kitId === state.kitId)` equipped/backpack + the background's `extraItems`, mapping item `contentId`→`pack` entry for glyph/name.

- [ ] **Step 4: Run tests + typecheck.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui/screens/chargen/HeroRecord.tsx apps/web/src/ui/screens/chargen/HeroRecord.test.tsx
git commit -m "feat(chargen): live HeroRecord pane"
```

---

### Task 6: Identity + Attributes step bodies

**Files:**
- Create: `apps/web/src/ui/screens/chargen/steps.tsx` (start it here with these two step bodies + the shared `StepProps`)
- Test: `apps/web/src/ui/screens/chargen/steps-identity-attributes.test.tsx`

**Interfaces:**
- Consumes: reducer actions (`set-name`, `set-portrait`, `set-onboarding-enabled`, `choose-method`, `roll`, `reroll`, `set-attribute`); `PORTRAIT_GLYPHS`, `HERO_NAME_RULES`, `ATTRIBUTE_ORDER`, `pointBuyCost` (as the current `NameStep`/`AttributesStep` use them); `AttributeStepper` (Task 3); `BlockBar` (Task 2); `useListNavigation`.
- Produces (from `steps.tsx`): `StepProps = { state: WizardState; pack: CompiledContentPack; dispatch: (a: WizardAction) => void }`; `IdentityStep(props: StepProps)`, `AttributesStep(props: StepProps)`.
  - `IdentityStep`: name `Input` with a `>` prompt + `⟳ RANDOM` name button (pick a random valid name from a small curated list, dispatch `set-name`) + a validity hint; the portrait picker (roving focus over `PORTRAIT_GLYPHS`, `set-portrait`); the onboarding checkbox (`set-onboarding-enabled`). Preserve the exact behavior/labels of the current `NameStep`.
  - `AttributesStep`: a `POINT-BUY / ROLL 3D6` segmented toggle (dispatch `choose-method`); when `roll`, a "Roll attributes" button (`roll`) then a readout + a reroll button (disabled by `rerollUsed`); when `point-buy`, a 30-cell point meter (`BlockBar` of spent vs budget) + `AttributeStepper` rows (dispatch `set-attribute`, `±` disabled at bounds/over-budget using engine `pointBuyCost` + the `balance` entry). Fold in the current `MethodStep` + `AttributesStep` + `PointBuyAttributes` behavior.

- [ ] **Step 1: Write failing tests** — IdentityStep: typing a name dispatches `set-name`; clicking a portrait dispatches `set-portrait`; `⟳ RANDOM` dispatches a `set-name` with a name passing `HERO_NAME_RULES`. AttributesStep: clicking `ROLL 3D6` then "Roll" dispatches `choose-method`+`roll`; in point-buy, `+` on an attribute dispatches `set-attribute` with `value = current+1`, and `+` is disabled when the increment would exceed budget (assert no dispatch).

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** both step bodies in `steps.tsx`, reusing the existing reducer actions and the mapped balance-entry logic from the current `PointBuyAttributes`.

- [ ] **Step 4: Run tests + typecheck.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui/screens/chargen/steps.tsx apps/web/src/ui/screens/chargen/steps-identity-attributes.test.tsx
git commit -m "feat(chargen): Identity + Attributes step bodies"
```

---

### Task 7: Calling + Kit step bodies

**Files:**
- Modify: `apps/web/src/ui/screens/chargen/steps.tsx` (add `CallingStep`, `KitStep`)
- Test: `apps/web/src/ui/screens/chargen/steps-calling-kit.test.tsx`

**Interfaces:**
- Consumes: `OptionRow` (Task 3), `useListFacets`+`FilterBar` (Task 4), `useListNavigation`; reducer actions `choose-class`, `choose-kit`; the pack's class entries (`kind==='class'`, `playable`, `silhouetteGlyph`, `unlockHint`, `kits`, `tags`).
- Produces: `CallingStep(props: StepProps)`, `KitStep(props: StepProps)`.
  - `CallingStep`: `OptionRow` list of ALL classes (playable + locked); locked rows disabled with `lockHint = entry.unlockHint`; glyph tile from `silhouetteGlyph`; single-select via `choose-class`. Wrap in `useListFacets(classes)` + `FilterBar`.
  - `KitStep`: if no class chosen, render "Choose a calling first."; else `OptionRow` list of `chosenClass.kits` (single-select via `choose-kit`, `kit.kitId`/`kit.name`). Facets over kits.

- [ ] **Step 1: Write failing tests** — CallingStep: a playable class row selects (dispatch `choose-class`); a locked class row is `aria-disabled`, shows its unlock hint, and does NOT dispatch on click. KitStep: with a class in `state.classId`, kit rows render and selecting dispatches `choose-kit`; with no class, the "choose a calling first" message shows.

- [ ] **Step 2–4:** run-fail, implement, run-pass + typecheck.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui/screens/chargen/steps.tsx apps/web/src/ui/screens/chargen/steps-calling-kit.test.tsx
git commit -m "feat(chargen): Calling + Kit step bodies"
```

---

### Task 8: Origin + Traits step bodies

**Files:**
- Modify: `apps/web/src/ui/screens/chargen/steps.tsx` (add `OriginStep`, `TraitsStep`)
- Test: `apps/web/src/ui/screens/chargen/steps-origin-traits.test.tsx`

**Interfaces:**
- Consumes: `OptionRow`, `useListFacets`+`FilterBar`, `useListNavigation`; reducer actions `choose-background`, `toggle-trait`; pack background entries (`kind==='background'`, `modifiers`, `extraItems`, `tags`) and trait entries (`kind==='trait'`, `modifiers`, `tags`); `MAX_TRAITS` behavior (2) via the reducer.
- Produces: `OriginStep(props: StepProps)`, `TraitsStep(props: StepProps)`.
  - `OriginStep`: single-select `OptionRow` list of backgrounds (`choose-background`); show each background's stat `modifiers` as `+n` meta. Facets over backgrounds.
  - `TraitsStep`: multi-select `OptionRow` list of traits (`toggle-trait`); a `{n}/2` indicator; when `state.traitIds.length >= 2`, un-selected rows are visually `aria-disabled` (the reducer already refuses the toggle, so also gate the UI). Facets over traits.

- [ ] **Step 1: Write failing tests** — OriginStep: selecting a background dispatches `choose-background`. TraitsStep: toggling a trait dispatches `toggle-trait`; the `{n}/2` indicator reflects `state.traitIds.length`; with 2 traits already selected, an unselected row is `aria-disabled`.

- [ ] **Step 2–4:** run-fail, implement, run-pass + typecheck.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui/screens/chargen/steps.tsx apps/web/src/ui/screens/chargen/steps-origin-traits.test.tsx
git commit -m "feat(chargen): Origin + Traits step bodies"
```

---

### Task 9: Review step + StepMenu

**Files:**
- Modify: `apps/web/src/ui/screens/chargen/steps.tsx` (add `ReviewStep`)
- Create: `apps/web/src/ui/screens/chargen/StepMenu.tsx`
- Test: `apps/web/src/ui/screens/chargen/steps-review.test.tsx`, `apps/web/src/ui/screens/chargen/StepMenu.test.tsx`

**Interfaces:**
- Consumes: `DotLeaderRow` (Task 2), pack entry lookups; `WizardState`; `useListNavigation`; `stepSatisfied`-equivalent (derive per-step "set" status from state, see below).
- Produces:
  - `ReviewStep(props: StepProps)`: dot-leader summary rows (name, calling, kit, origin, traits, attributes, key derived stats) + a flavor line. Read-only.
  - `StepMenu({ state, current, onJump }: { state: WizardState; current: WizardState['step']; onJump: (step: WizardState['step']) => void }): JSX.Element` — one row per step: caret (active only), zero-padded number, label, status dot (`●` set / `○` unset), and a muted current-value line (name / class name / kit name / attribute method / background name / trait count / "—"). `↑↓`/click navigation via `useListNavigation`; guard so a click cannot jump to a step whose prerequisites are unmet (a step is reachable if every earlier step is satisfied). Provide a `STEP_LABELS` map: `1 Identity, 2 Calling, 3 Kit, 4 Attributes, 5 Origin, 6 Traits, 7 Review`.

- [ ] **Step 1: Write failing tests** — ReviewStep: renders the chosen name/class/kit/background and an attribute summary. StepMenu: renders 7 rows with the correct labels; the active step shows the caret; a step whose prerequisites are unmet is not jumpable (clicking it does not call `onJump`), a satisfied earlier step is.

- [ ] **Step 2–4:** run-fail, implement, run-pass + typecheck.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui/screens/chargen/steps.tsx apps/web/src/ui/screens/chargen/StepMenu.tsx apps/web/src/ui/screens/chargen/steps-review.test.tsx apps/web/src/ui/screens/chargen/StepMenu.test.tsx
git commit -m "feat(chargen): Review step + StepMenu"
```

---

### Task 10: Assemble the ChargenConsole shell

**Files:**
- Rebuild: `apps/web/src/ui/screens/ChargenScreen.tsx` (into the three-pane console; SAME props)
- Delete: `apps/web/src/ui/screens/chargen-steps.tsx` (superseded) — only after confirming nothing else imports it
- Test: `apps/web/src/ui/screens/ChargenScreen.test.tsx` (rebuild/update the existing chargen-screen test to the console)

**Interfaces:**
- Consumes: `StepMenu` (Task 9), `HeroRecord` (Task 5), all step bodies (Tasks 6-9); `initialWizardState`, `wizardReduce`, `wizardChoices`, `WizardState`, `WizardAction` (reducer).
- Produces: `ChargenScreen(props: ChargenScreenProps): JSX.Element` with the UNCHANGED `ChargenScreenProps` `{ pack, seed, settings?, onChangeSettings?, onConfirm }`. Layout: title bar over a CSS grid `grid-cols-[236px_1fr_340px]` (fixed height, internal scroll on center + record). Owns `useState<WizardState>` + `dispatch` (via `wizardReduce`), renders the active step body via an inline `state.step` switch (so each body remounts on step change → its facet state resets), the footer (`◂ BACK · n/7 · NEXT ▸`; step 7 `WEAVE ▸`), and passes `wizardChoices(state)`/`canWeave` into `HeroRecord`. On weave (step 7, choices non-null): write onboarding back via `onChangeSettings` if changed, then `onConfirm(choices, state.portraitGlyph)` — preserve the current confirm logic verbatim.

- [ ] **Step 1: Write/adjust the failing test** — `ChargenScreen.test.tsx`: render with the default pack + a spy `onConfirm`; drive a full creation via clicks/keys (name → calling → kit → roll attributes → origin → advance past traits → weave) and assert `onConfirm` is called with a valid `HeroChoices` + the portrait glyph. Also assert the three panes are present (`StepMenu`, center body, `HeroRecord`) and that `WEAVE` is disabled until step 7 with valid choices.

- [ ] **Step 2: Run to verify failure** — the new console DOM/props aren't there yet.

- [ ] **Step 3: Rebuild `ChargenScreen.tsx`** into the console shell per the interface. Keep `ChargenScreenProps` byte-identical so `App.tsx` is untouched. Delete `chargen-steps.tsx` after `grep -rn "chargen-steps" apps/web/src` returns nothing.

- [ ] **Step 4: Run the full web suite + typecheck + build**

```bash
npm run test -w @woven-deep/web
npm run typecheck -w @woven-deep/web
npm run build -w @woven-deep/web
```
Expected: PASS + clean + build ok. (If a pre-existing `chargen-screen.test.tsx` under `apps/web/test/` asserts the old wizard DOM, update it to the console here, preserving its behavioral assertions.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui/screens/ChargenScreen.tsx apps/web/src/ui/screens/ChargenScreen.test.tsx
git rm apps/web/src/ui/screens/chargen-steps.tsx
git commit -m "feat(chargen): assemble three-pane ChargenConsole; retire old wizard steps"
```

---

### Task 11: e2e + dead-CSS cleanup

**Files:**
- Modify: `apps/web/e2e/*.spec.ts` (whichever drives chargen — likely `guest-play.spec.ts`/`run-lifecycle.spec.ts`)
- Modify: `apps/web/src/styles.css` (remove now-dead `.chargen-*` rules if any remain unreferenced)
- Test: the Playwright suite

**Interfaces:**
- Consumes: nothing new. Produces: green e2e driving the console; no dead chargen CSS.

- [ ] **Step 1: Find the chargen e2e path**

```bash
grep -rn "chargen\|Weave\|Confirm\|Roll attributes\|Next\b" apps/web/e2e
```
Identify the spec(s) that create a hero.

- [ ] **Step 2: Update the chargen e2e interactions** to the new console DOM: name input → Calling option → Kit option → Attributes (roll or point-buy) → Origin option → advance past Traits → `WEAVE`. Preserve each spec's end assertion (a hero is created and a run starts). Do NOT weaken assertions.

- [ ] **Step 3: Remove dead chargen CSS** — `grep -rn "chargen" apps/web/src/styles.css`; delete only rules with zero `.tsx` consumers (verify by grep). Preserve everything still referenced and the grid/effects keep-zone.

- [ ] **Step 4: Run the full e2e + unit + typecheck + build**

```bash
npm run build -w @woven-deep/content && npm run build -w @woven-deep/engine && npm run build -w @woven-deep/web && npm run build -w @woven-deep/server
npm run e2e -w @woven-deep/web
npm run test -w @woven-deep/web
npx tsc -p apps/web/tsconfig.json --noEmit
```
Expected: all e2e green; unit green; typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e apps/web/src/styles.css
git commit -m "test(chargen): drive the console in e2e; retire dead chargen CSS"
```

---

## Self-Review

**1. Spec coverage:**
- Three-pane console (menu · detail · live record) → Tasks 5 (record), 9 (menu), 10 (shell). ✅
- Reordered 7-step flow + reducer touch → Task 1. ✅
- Method folded into Attributes; Origin/Traits split → Tasks 6, 8. ✅
- Signature components (block-bar, dot-leader, option row, attribute stepper, tag chip) → Tasks 2, 3. ✅
- Conditional facets (search + tags, threshold 6, from `entry.tags`) → Task 4 (+ used in 7, 8). ✅
- Preserved validation (name, point-buy, one reroll, locked classes, ≤2 traits) → enforced in the reducer (unchanged), exercised in Tasks 1, 6, 7, 8. ✅
- `ChargenScreen` props unchanged / `App.tsx` untouched → Task 10 Global Constraints. ✅
- e2e updated; dead CSS retired → Task 11. ✅
- Engine/content/grid untouched → Global Constraints + per-task file lists. ✅

**2. Placeholder scan:** No TBD/TODO. Component-heavy tasks give exact interfaces, real test assertions, exact commands, and real code for the novel logic (reducer remap, BlockBar math, facets hook, HeroRecord deltas, console assembly); per-step bodies are specified by their exact reducer actions + data reads + representative tests, reusing the components built in Tasks 2-4 — each is independently testable.

**3. Type consistency:** `StepProps = { state, pack, dispatch }` is defined in Task 6 and consumed unchanged in Tasks 7-9. `useListFacets`'s return type (Task 4) is consumed by `FilterBar` and the list steps. `ChargenScreenProps` stays exactly `{ pack, seed, settings?, onChangeSettings?, onConfirm }`. Reducer action names match the mapped `WizardAction` union verbatim (`choose-class`/`choose-kit`/`choose-background`/`toggle-trait`/`choose-method`/`roll`/`reroll`/`set-attribute`/`set-name`/`set-portrait`/`set-onboarding-enabled`/`next`/`back`). `kitId` is `string`; other ids `OpaqueId`.

Note for the executor: `FACET_THRESHOLD = 6` means every current list (2 classes shown, 2 kits, 3 backgrounds, 5 traits) hides its FilterBar; Task 4's tests exercise the visible/filtering path with a synthetic 7-item list.
