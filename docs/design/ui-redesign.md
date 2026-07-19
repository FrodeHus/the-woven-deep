# UI Redesign

**Status:** In progress — sub-project 1 (foundation & in-game chrome) shipped as PR #17;
sub-project 2 (chargen console flow redesign) is next

**Package:** `apps/web/src/ui/`

The web client's UI was originally built dependency-free with hand-written CSS and
hand-rolled overlay scaffolding (`OverlayScaffold`, `focus-trap.ts`, `roving-focus.ts`),
per the deliberate 5A–5D decision documented in `guest-client.md`. By the end of
milestone 5 that had grown messy and inconsistent: overlays reflowed the whole play view,
the inventory was a bullet list of default browser buttons, and every overlay reinvented
its own list/tab/detail pattern. This redesign reverses the dependency-free decision and
adopts a maintained component library, in two sequential sub-projects sharing one
foundation.

It's a **presentation-layer replacement only**. It touches `apps/web/src/ui/` and the web
build setup; it does not change the deterministic engine, the framework-free session
layer, or the ASCII grid renderer (`GridRenderer.tsx`, `EffectsLayer.tsx`, `camera.ts`,
`cell-color.ts`, `effects-map.ts`, `light-sources.ts` are explicitly untouched — the grid
stays exactly as `guest-client.md` describes it). The session layer
(`apps/web/src/session/**`) is the stable contract the whole rebuild is drawn against:
rebuilt components consume the same `SessionSnapshot` and dispatch the same
`PlayerIntent`s as before.

## Sub-project 1: foundation and in-game chrome (shipped)

**Foundation**: Tailwind CSS v4 (`@tailwindcss/vite`, CSS-first config) + shadcn/ui on
Base UI primitives, vendored into `src/ui/components/` (only primitives actually used:
`Sheet`, `Dialog`, `Command`/cmdk, `Tabs`, `Tooltip`, `DropdownMenu`, plus the form
controls settings needs) + one semantic CSS-variable token file both chrome and the grid's
glyph colors read from, so the palette can never clash between the two. The hand-written
chrome CSS in `styles.css` was retired; the grid/effects CSS stayed in plain CSS
deliberately, to avoid touching the render path.

**Aesthetic — "Grimoire / ember"**: warm near-black surfaces, ember-gold accent, crimson
danger token for HP/threats, serif headings, sans body, monospace retained in the
playfield and message log (preserves the roguelike feel and grid alignment). Tokens:
`--bg-deep`/`--bg-surface`/`--bg-raised`/`--border` for surfaces, `--fg`/`--fg-muted`/
`--fg-subtle` for text, `--accent`/`--danger`/`--good`/`--cool`/`--warn` for accents — the
grid's glyph colors reference the same accent/good/danger/cool tokens.

**Play-screen layout A** ("Classic HUD"): the ASCII grid stays the fixed focal region on
the left/main; a persistent fixed-width right rail holds vitals (HP/MP, conditions) above
a minimap; a full-width bottom log is fixed, scrollable, monospace, severity-colored, and
never reflows. Overlays enter as a right `Sheet` (drawer) over a dimmed-but-visible grid,
replacing the old inline reflow.

**Inventory drawer (structure 1)**: a compact spatial equipped-slot grid on top; below,
two columns — a category-filtered, letter/arrow-navigable pack list (glyph + name +
quantity + equipped badge) on the left, a detail pane (name, meta, description,
contextual action buttons showing their keybinding) on the right. This list+detail
skeleton is shared with the character sheet and codex rebuilds, so the pattern only
needed building once.

**⌘K command palette** (new): a `cmdk` `Command` dialog listing every available player
verb — overlay openers, descend/ascend, rest/wait/pickup, context verbs like trade/house
when available — filtered as you type, arrow-navigable, Enter to invoke. It is
deliberately **a discovery surface over the same action set**, not a parallel command
path: invoking an entry dispatches the exact same `PlayerIntent` or opens the exact same
overlay the keymap would.

**Keyboard/focus handoff** (the one subtle integration point, given explicit test
coverage): Base UI's `Sheet`/`Dialog` own their own focus-trap, scroll-lock, focus-
restore, and Escape handling now. `KeyRouter` keeps tracking "an overlay is open" so the
global dispatcher still suppresses gameplay keys, but its hardwired `Escape → close-
overlay` branch is no longer the mechanism for library overlays — it survives only as a
harmless fallback for any non-library transient. The hand-rolled `focus-trap.ts` and
`roving-focus.ts` helpers were retired in favor of the primitives' built-in focus
management.

**Everything else** (Hall, House, Trade, Conclusion, Sign-in) got restyled onto the new
tokens/`Button`/`Input`/`Dialog` with no flow change. Title and chargen got a **re-skin
only** in this sub-project — their flow redesign is sub-project 2.

## Sub-project 2: chargen "console" flow redesign (next)

Rebuilds the character-creation screen from a single-step wizard into a persistent
**three-pane terminal console** with a live hero record, following a Claude Design
handoff (`design_handoff_chargen_console`). The handoff supplies structure/UX/interaction
guidance only — its cooler steel-blue palette is explicitly **not** adopted; the layout
renders in sub-project 1's Grimoire tokens and component system instead, for visual
cohesion with the rest of the app.

**Layout**: fixed-height three columns that never grow (center and record panes scroll
internally) — left `StepMenu` (one row per step: caret, zero-padded number, label, status
dot, current-value line), center `DetailPane` (step header, optional conditional filter
bar, scrollable body, `◂ BACK · n/7 · NEXT ▸` footer), right `HeroRecord` (portrait, name,
CLASS·KIT, attributes as block-bars, derived stats as dot-leader rows with `+n` deltas,
loadout, pinned `▸ WEAVE THE HERO` CTA) that updates live on every dispatch.

**Reordered 7-step flow** (from the handoff, replacing the original ordering): Identity →
Calling → Kit → Attributes → Origin → Traits → Review. The attribute-method choice
(point-buy vs. 3d6) folds into the Attributes step as a segmented toggle rather than its
own step; the old combined Background/Traits step splits into separate Origin and Traits
steps. Validation is preserved exactly: name 1–24 chars, point-buy budget with the
existing cost curve, one reroll per session, locked classes unselectable with their
unlock hint, ≤2 traits.

**New signature components**, token-styled and reusable: `BlockBar` (filled/empty block
glyphs), `DotLeaderRow` (label · dotted spacer · value/delta), `OptionRow` (marker · body
· meta · tag chips, with selected/locked variants), `AttributeStepper` (abbreviation,
label+cost, block-bar, −/value/+ disabled at bounds), `TagChip`.

**Conditional search/tag facets**: a `FilterBar` (search + count + tag chips) renders for
a step's option list only when it exceeds ~6 items; below that threshold the list renders
without filter chrome at all. Tags come from the existing `entry.tags` field — no content-
schema change (facet tags on class/kit/background/trait YAML are optional, incremental
authoring, not a required part of this sub-project).

**The one touched boundary**: `session/wizard-reducer.ts` — step enum/order,
`stepSatisfied`, folding method into the attributes step, the Origin/Traits split.
`wizardChoices` still emits the identical `HeroChoices` shape at the final step; only
collection order changes, so `packages/engine` and `packages/content` are unaffected —
no content-schema bump, and the engine still consumes the same `HeroChoices` it always
did. Everything else is new presentation under `apps/web/src/ui/screens/**`.

**Explicitly out of scope for sub-project 2**: the title screen (stays the sub-project-1
re-skin); the four playtest bugs reported 2026-07-18 (oil refill, healing, sparse spawns,
edge-of-map wall render — tracked separately, see `future.md`); the ASCII grid renderer
(untouched, as always).
