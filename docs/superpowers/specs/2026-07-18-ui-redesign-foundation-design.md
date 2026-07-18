# UI Redesign — Foundation & In-Game Chrome (Sub-Project 1)

**Status:** Design approved (brainstorm), pending spec review.
**Date:** 2026-07-18
**Milestone:** UI redesign, sub-project 1 of 2.

## Context

The web client's UI was built dependency-free with hand-written CSS and hand-rolled
overlay scaffolding (`OverlayScaffold`, `focus-trap.ts`, `roving-focus.ts`). It has grown
messy and inconsistent: overlays render inline and re-flow the whole play view, the
inventory is a bullet list of browser-default buttons with a plain-text detail pane, and
each overlay reinvents its own list/tab/detail patterns. This redesign reverses the
founding dependency-free-client decision and adopts a well-known, actively maintained
component library to stop hand-rolling UI, with a coherent dark-fantasy visual language.

It is greenfield: no backwards compatibility with the current chrome is required.

## Scope

This is a **presentation-layer replacement**. It touches only `apps/web/src/ui/` and the
web build setup. It does not change the deterministic engine, the framework-free session
layer, or the ASCII grid renderer.

The full redesign is split into two sequential sub-projects sharing one foundation. **This
spec covers sub-project 1 only.**

### In scope (this spec)

- Build foundation: Tailwind CSS v4 + shadcn/ui (Base UI primitives) + a semantic design
  token set + the "Grimoire / ember" theme.
- Play-screen composition: **Layout A** (grid + persistent right rail + full-width log).
- Rebuild all six in-game overlays on library primitives:
  inventory, character sheet, map/journal, codex, settings, help.
- New **⌘K command palette** (`cmdk`) as the keyboard-first action spine.
- Restyle the supporting in-run screens to the new tokens/components:
  Hall, House, Trade, Conclusion, Sign-in.
- Retire the hand-rolled chrome CSS and overlay scaffolding.

### Out of scope (deferred to sub-project 2)

- Title screen and character-creation (chargen) **flow** redesign. In sub-project 1 these
  screens are minimally re-skinned to consume the new tokens/components so they stay
  visually consistent and functional; their flow/step/class-selection UX is redesigned in
  sub-project 2, which gets its own visual pass, spec, plan, and execution.
  - Design input for sub-project 2: a Claude Design handoff package for chargen
    (`The Woven Deep chargen.zip`) exists and should be unpacked into the repo and used as
    the visual/interaction inspiration when sub-project 2 begins.

### Explicitly untouched

- `apps/web/src/session/**` — guest session, intents, projections, settings, `KeyRouter`,
  `createKeyDispatcher`, storage, run-records. The rebuilt components consume the same
  `SessionSnapshot` and dispatch the same `PlayerIntent`s.
- `packages/engine`, `packages/content`.
- The ASCII grid + effects renderers: `GridRenderer.tsx`, `EffectsLayer.tsx`,
  `camera.ts`, `cell-color.ts`, `effects-map.ts`, `light-sources.ts`, and the
  grid/effects portions of `styles.css`. The grid is kept exactly as-is (scope decision).
- `apps/web/src/landing/**` — the marketing landing page is a separate surface with its
  own design and CSS; not part of this milestone.

## Decisions (from brainstorm)

| Decision | Choice |
|---|---|
| Redesign reach | Chrome + play-screen layout; keep the ASCII grid rendering as-is |
| Input targets | Keyboard-first + mouse, desktop viewports (no dedicated touch/phone layout) |
| Component layer | shadcn/ui on Base UI primitives + Tailwind + `cmdk` |
| Play-screen layout | A — Classic HUD: grid left, persistent right rail (vitals + minimap), full-width log strip; overlays enter as a right drawer |
| Inventory structure | 1 — equipped slot-grid on top, letter/arrow-navigable pack list, detail pane with contextual actions on the right |
| Aesthetic | A — Grimoire / ember: warm near-black, ember-gold accent, crimson danger token for HP/threats, serif headings + sans body, monospace in playfield + log |
| ⌘K palette | In scope this milestone |
| Title/chargen | Flow redesign deferred to sub-project 2; re-skin only here |

## Architecture & the boundary

The redesign is drawn differently, but means the same thing. React components under
`src/ui/` are rebuilt to consume the existing `SessionSnapshot` and dispatch the existing
`PlayerIntent`s; the session layer is the stable contract across the rebuild.

New foundation inside `apps/web`:

- **Tailwind CSS v4** via `@tailwindcss/vite`, CSS-first config.
- **shadcn/ui** configured (`components.json`) with copied primitives vendored into
  `src/ui/components/`: `Sheet` (drawer), `Dialog`, `Command` (cmdk), `Tabs`, `Tooltip`,
  `DropdownMenu`, and the form controls settings needs (`Button`, `Input`, `Switch`/
  `Select`, `Label`). Only primitives actually used are copied in.
- **One theme token file** of CSS variables that both the chrome and the grid glyph colors
  read from, so the palette never clashes.

The hand-written chrome CSS in `styles.css` is retired. The grid/effects CSS stays.

### Keyboard & focus coordination

Today `KeyRouter.routeKey` hardwires `Escape → close-overlay` and returns `null` for all
keys while an overlay is open (`overlayOpen` gate); `createKeyDispatcher` reads
`isOverlayOpen()` fresh per keydown. Base UI's `Sheet`/`Dialog` own their own focus-trap,
scroll-lock, focus-restore, and `Escape` handling.

The open-overlay path is therefore:

- The session still tracks "an overlay is open" so the global key dispatcher keeps
  suppressing gameplay keys while any overlay is mounted (unchanged gate).
- The overlay primitive owns its own dismissal — `Escape`, scrim click, close button —
  via Base UI's `onOpenChange`, which calls back into `session.closeOverlay()`. The
  hardwired `Escape → close-overlay` branch in `KeyRouter` is no longer the mechanism for
  library overlays; it remains only as a harmless fallback for any non-library transient.
- The hand-rolled `overlays/focus-trap.ts` and `screens/roving-focus.ts` helpers are
  retired in favor of the primitives' built-in focus management and roving (`Tabs`,
  `Command`, listbox roles).

The ⌘K palette registers a global `Cmd/Ctrl+K` handler (only while in play, no other
overlay open) that opens the `Command` dialog. Selecting an action dispatches the same
intent or opens the same overlay the keymap would.

## Foundation setup

1. Add Tailwind v4 + `@tailwindcss/vite` to `apps/web`; a single Tailwind entry CSS
   imports the theme tokens.
2. `shadcn` init targeting `src/ui/components/`, Base UI primitive layer, dark base.
3. Define the semantic token set (see Theming) as CSS variables on `:root`, mapped into
   Tailwind theme colors so utilities (`bg-surface`, `text-accent`, …) resolve to tokens.
4. Vendor the primitives listed above.

## Component & screen inventory

Every surface maps onto a small, reused primitive set.

| Surface | Primitive | Notes |
|---|---|---|
| Play screen | Layout A shell | grid + right rail (vitals/minimap) + full-width log; the fixed frame overlays open over |
| Inventory | `Sheet` (right drawer) | structure 1: slot-grid + pack list + detail pane |
| Character sheet | `Sheet` (right drawer) | reuses the list+detail skeleton |
| Map / journal | `Sheet` + `Tabs` | |
| Codex | `Dialog` + `Tabs` | class/item/spell/monster tabs replace hand-rolled tablist |
| Settings | `Dialog` + form controls | keymap rebinding lives here |
| Help | `Dialog` | |
| ⌘K palette | `Command` (cmdk) | new; filterable verb list → same intents/overlays |
| Hall / House / Trade / Conclusion / Sign-in | restyled | new tokens + `Button`/`Input`/`Dialog`; no flow change |
| Title / Chargen | re-skin only | flow redesign is sub-project 2 |

### Play-screen layout A

Fixed CSS-grid shell that never reflows the playfield:

- Left / main: the ASCII `GridRenderer` + `EffectsLayer`, unchanged, as the fixed focal
  region.
- Right rail (persistent, fixed width): vitals block (HP/MP, conditions) above a minimap.
- Bottom (full width): the message log — fixed, scrollable, monospace, newest-at-bottom,
  severity-colored. Never reflows.
- Overlays enter as a right `Sheet` over a dimmed-but-visible grid.

### Inventory drawer (structure 1)

Right `Sheet`. Top: equipped gear as a compact spatial slot-grid (weapon/armor/shield/
light/ring/amulet). Below, two columns: a category-filtered, letter/arrow-navigable pack
list (glyph + name + quantity, equipped badge) on the left; a detail pane (name, meta,
description, contextual action buttons showing their keybinding) on the right. Fully
keyboard-driven and mouse-first. The list+detail skeleton is a shared component the
character sheet and codex reuse.

### ⌘K command palette

`cmdk` `Command` dialog listing the player's available verbs (open inventory, character
sheet, map, codex, settings, help; descend, ascend, rest, wait, pickup; and context verbs
like trade/house when available), filtered as you type, arrow-navigable, `Enter` to
invoke, `Esc` to dismiss. Each entry shows its bound key. Invoking an entry dispatches the
exact `PlayerIntent` or opens the exact overlay the keymap resolves to — it is a discovery
surface over the same action set, not a parallel command path.

## Theming & typography

One semantic token set drives chrome and grid glyphs:

- Surfaces: `--bg-deep`, `--bg-surface`, `--bg-raised`, `--border`.
- Text: `--fg`, `--fg-muted`, `--fg-subtle`.
- Accents: `--accent` (ember gold), `--danger` (crimson — HP/threats), `--good`,
  `--cool`, `--warn`.

Grid glyph colors reference the same accent/good/danger/cool tokens so the playfield and
chrome share a palette.

Typography:

- Serif headings (grimoire weight) for titles/section headers.
- Sans body for descriptions and dense menu text (readability).
- Monospace retained in the playfield and message log (preserves the roguelike soul and
  grid alignment).

Interactions stay subtle: short transitions, keyboard focus rings visible on keyboard nav.

## Testing strategy

- **Session-layer tests stay green untouched** — this is the proof the boundary held.
  `KeyRouter`, projections, settings, codex/inventory projection logic in `src/session/`
  do not change.
- **Component tests are rewritten** against the new components (Testing Library +
  user-event). Each rebuilt surface lands with its own tests: drawer open/close, keyboard
  navigation of the pack list, tab switching, ⌘K filter + invoke, focus behavior.
- **e2e specs updated as each screen lands.** The six Playwright specs
  (`guest-play`, `interface`, `town-loop`, `run-lifecycle`, `polish`, `auth`) reference
  overlay/interaction selectors that change; each is updated to the new DOM. `auth` is
  least affected (sign-in restyle only).
- Build order caveat unchanged: build `@woven-deep/content` and `@woven-deep/engine` dist
  before running the web suite.

## Risks & notes

- **Tailwind adoption is a one-time shift** for a currently hand-CSS client; the grid/
  effects CSS is deliberately left in plain CSS to avoid touching the render path.
- **Escape/focus handoff** (above) is the one subtle integration point; it gets explicit
  test coverage.
- shadcn's Base UI default is current as of 2026-07; if a specific primitive is smoother
  on Radix, that primitive may be copied from the Radix recipe — the vendored code is
  ours either way.

## Execution

Subagent-driven: fresh implementer per task, per-task review (spec + quality), whole-branch
review, PR. Isolated worktree/branch.
