# Chargen "Console" Flow Redesign (UI Redesign, Sub-Project 2)

**Status:** Design approved (brainstorm), pending spec review.
**Date:** 2026-07-18
**Milestone:** UI redesign, sub-project 2 of 2 (builds on sub-project 1, merged as PR #17).

## Context

Sub-project 1 delivered the UI foundation (Tailwind v4 + shadcn/Base UI + `cmdk` + the Grimoire/ember token set + shared components) and re-skinned the title and character-creation screens without changing their flow. This sub-project redesigns the **character-creation (chargen) flow itself** — from the current single-step wizard into a persistent three-pane "terminal console" with a live hero record — following a Claude Design handoff (`design_handoff_chargen_console`).

The design handoff is the structure/UX/interaction blueprint. Its cooler steel-blue palette and exact hex are **not** adopted; instead its layout, components, and interactions are rendered in sub-project 1's **Grimoire tokens** and existing component system for cohesion with the rest of the app. JetBrains Mono is already in `--font-mono`.

## Scope

### In scope
- Rebuild the chargen screen as a fixed **three-pane console**: left step menu, center detail pane, right live hero record.
- Adopt the handoff's reordered **7-step flow**: Identity → Calling → Kit → Attributes → Origin → Traits → Review.
- Fold the attribute-method choice (point-buy / 3d6) into the Attributes step as a segmented toggle; split the current combined Background/Traits step into two (Origin, Traits).
- Build the signature ASCII components (block-bar, dot-leader, option row, attribute stepper, tag chip) in Grimoire tokens.
- A **live hero record** pane that updates on every choice (portrait, name, attributes, derived stats with deltas, loadout).
- **Conditional** search + tag-facet filtering on list steps (shown only when a list exceeds a threshold).
- Update `session/wizard-reducer.ts` for the reordered step machine and validity.
- Update the chargen e2e path to drive the new console.

### Out of scope
- **Title screen** — left as its sub-project-1 re-skin (explicit scope decision).
- **Content-schema change** — the `tags` field already exists on every content entry; no schema bump. Populating facet tags on class/kit/background/trait YAML is optional and incremental, not required.
- The four playtest bugs reported 2026-07-18 (oil refill, healing, sparse spawns, edge-of-map wall render) — tracked separately.

### Explicitly untouched
- `packages/engine`, `packages/content` (no schema change; the engine still consumes the same `HeroChoices`).
- The ASCII grid renderer (`GridRenderer.tsx`/`EffectsLayer.tsx`/`camera.ts`/`cell-color.ts`/`effects-map.ts`/`light-sources.ts`).
- All other screens and overlays, and the landing page.

## Decisions (from brainstorm)

| Decision | Choice |
|---|---|
| Palette/fidelity | Adapt the handoff's structure/UX to the Grimoire tokens + existing components (not the handoff's cooler console hex) |
| Title screen | Out of scope — leave as the SP1 re-skin |
| Step flow | Adopt fully: reorder to Identity → Calling → Kit → Attributes → Origin → Traits → Review; fold method into Attributes; split Origin/Traits |
| Search/tag facets | Conditional — render only when a step's list exceeds ~6 items; tags from the existing `entry.tags` (no schema change) |
| Live hero record | Persistent right pane, driven by existing `wizardPreview`/`wizardChoices` |

## Architecture

A fixed-height three-column console that never grows; center and record panes scroll internally.

```
┌───────────────────────────────────────────────────────────────┐  title bar
├──────────────┬────────────────────────────────┬───────────────┤
│ BUILD ORDER  │  0N · STEP TITLE               │ HERO RECORD    │
│ (step menu)  │  filter bar (conditional)       │ (live)         │
│  01 Identity │  ── body (scrolls) ──           │ attributes     │
│› 0N …        │                                 │ derived stats  │
│              │  ◂ BACK    n/7    NEXT ▸         │ [ WEAVE HERO ] │
└──────────────┴────────────────────────────────┴───────────────┘
   left menu          center detail                right record
```

Units (each small, focused, independently testable):

- **`ChargenConsole`** (rebuilds `ChargenScreen.tsx`) — the three-column shell + title bar; owns the current step and the per-step UI-only filter state (`query`/`activeTag`, reset on step change); wires the reducer.
- **`StepMenu`** (left) — one row per step (caret · zero-padded number · label · status dot · current-value line); ↑↓/click navigation via the existing `useListNavigation`, guarded against skipping an unfinished step.
- **`DetailPane`** (center) — header (step tag + title), optional `FilterBar`, a scrollable body that renders the active step's component, and a footer (`◂ BACK · n/7 · NEXT ▸`; step 7 `WEAVE ▸`).
- **`HeroRecord`** (right) — portrait tile + name (blinking caret when empty, gated by `prefers-reduced-motion`) · CLASS·KIT · attributes as block-bars · derived stats as dot-leader rows with green `+n` deltas · loadout (equipped + backpack) · pinned `▸ WEAVE THE HERO` CTA (accent when valid). Reads `wizardPreview`/`wizardChoices`.
- **Per-step bodies:** `IdentityStep` (name input with `>` prompt + `⟳ RANDOM` + portrait picker), `CallingStep`/`KitStep`/`OriginStep` (`OptionRow` lists; Calling shows glyph tile + PLAYABLE/LOCKED with unlock hint on disabled rows), `AttributesStep` (`POINT-BUY / ROLL 3D6` segmented toggle → point meter + `AttributeStepper` rows, or roll readout + reroll), `TraitsStep` (multi-select `OptionRow`, capped at 2 with an `{n}/2` indicator), `ReviewStep` (dot-leader summary + flavor line).
- **Signature components** (new, reusable, token-styled): `BlockBar` (renders `█`×n colored + `█`×(cells−n) in `--bar-empty`, `white-space:nowrap`), `DotLeaderRow` (label · dotted spacer · value(+delta)), `OptionRow` (marker · body · meta · tag chips; selected/locked variants), `AttributeStepper` (abbr · label+cost · block-bar · −/value/+ with disabled-at-bounds), `TagChip`.

### Boundary

This sub-project touches the session layer at exactly one file: **`session/wizard-reducer.ts`** (step enum/order, `stepSatisfied`, folding method into the attributes step, splitting Origin/Traits validity). This is correct for a flow redesign — the wizard state machine lives there. `wizardChoices` still emits the same `HeroChoices` shape at the final step; only the collection order changes, so the engine is unaffected. Everything else is presentation (`apps/web/src/ui/screens/**` + new components). No content-schema change.

## State & data flow

- **Build choices** (reducer): name, method, attributes-per-method, portrait glyph, classId, kitId, backgroundId, traitIds, step. Validity + the live preview derive from it (`stepSatisfied`, `wizardChoices`, `wizardPreview` — extended for the reordered steps).
- **UI-only per list step** (component state, reset on step change): `query` (search) and `activeTag`.
- **Live record:** every dispatch updates the reducer → `HeroRecord` and `StepMenu` current-value lines re-render immediately.
- **Weave the Hero:** the Review step's CTA wires to the existing start-run call (the current chargen-confirm path in `App.tsx`).

## Conditional facets

The `FilterBar` (search input + `{shown}/{total}` count + tag chips) renders for a step **only when its option list length exceeds a threshold (6)**. Below that, the list shows without filter chrome. Tag chips are derived from the union of `entry.tags` across the step's options; `ALL` clears. Search is case-insensitive substring over name + description, client-side, with a zero-state ("No matches — clear the filter…").

## Validation (preserve exactly)

Name 1–24 chars (letters/numbers/spaces/apostrophes/hyphens); point-buy budget ≤30 with the handoff's cost curve; one reroll per session; locked classes unselectable (disabled + unlock hint); ≤2 traits. Reflected in enabled/disabled styling and whether NEXT advances.

## Keyboard

Arrow keys move roving focus through the active list (wrap at ends) via `useListNavigation`; Left/Right/± adjust the focused attribute in point-buy; the search input is its own focus scope so it doesn't swallow list navigation; the step menu is ↑↓/click navigable; Escape behavior unchanged.

## Testing

- **Reducer unit tests** (`wizard-reducer`): the reordered step order, `stepSatisfied` per new step, method-within-attributes, Origin/Traits split validity, `wizardChoices` still emits the correct `HeroChoices`, point-buy budget + reroll + trait cap.
- **Component tests:** each step body (Identity/Calling/Kit/Attributes/Origin/Traits/Review), `HeroRecord` live updates + deltas, `StepMenu` navigation + guard, the conditional `FilterBar` (hidden ≤6 items, shown + filtering >6), and the signature components (`BlockBar` cell math, `OptionRow` locked/selected, `AttributeStepper` bounds).
- **e2e:** update the chargen path to drive the new console end-to-end (name → calling → kit → attributes → origin → traits → weave → run starts), preserving the existing "creates a hero and starts a run" assertion.
- Build order caveat: build `@woven-deep/content` + `@woven-deep/engine` dist before the web suite.

## Execution

Isolated worktree on `feat/chargen-flow-redesign` (branched off `main`), subagent-driven: fresh implementer per task, per-task spec+quality review, whole-branch review, PR.
