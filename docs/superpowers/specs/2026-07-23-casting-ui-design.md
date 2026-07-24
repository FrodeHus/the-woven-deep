# Client Casting UI (Spec B) — design spec

**Status:** design (brainstormed with the user 2026-07-23). Second of the two magic specs; **Spec A
(the magic engine, PR #84) is merged to `main`** — all engine/content/server work is done. This
milestone builds the player-facing casting UI in `apps/web`. Branch `feat/casting-ui` off `main`.

Makes the shipped magic **usable in the client**: the engine already ships ~14 spells (5 of them
AoE — burst/line/cone), offensive scrolls, tomes, recall, and a spell vendor, but the client can
only target single-target spells. This spec adds AoE targeting with a live footprint preview,
offensive-scroll targeting, a browsable spellbook overlay, and recall/merchant/learn polish.

## What already works (do NOT rebuild)

The web client already has a working single-target cast pipeline:
- **`cast` intent** exists (`packages/session-core/src/intents.ts`): `{ type: 'cast'; spellId; target:
  {x,y} }`. The client sends only this; the server re-validates via `validateTarget`.
- **`SpellsPanel`** (`apps/web/src/ui/panels/SpellsPanel.tsx`) — an always-on HUD panel, one button
  per `castableSpells` entry, disabled when unaffordable, click → enters targeting.
- **Targeting mode** — `useSpellTargeting.ts` (a separate `window` keydown listener: Escape=cancel,
  Enter=confirm, arrows=cycle candidates), `spell-targeting.ts` (`computeValidTargets`, a client
  MIRROR of the engine's `validateTarget`, advisory-only, kept in parity by tests),
  `TargetingOverlay.tsx` (renders `targeting-cell-dim`/`-valid`/`-reticle` cells), plus map click
  (`PlayScreen.tsx handleMapClick` reads `data-cell="x,y"`) and right-click cancel.
- **Grid rendering** — `GridRenderer.tsx` renders one `<span data-cell="x,y">` per viewport slot
  (DOM, not canvas); overlays are pixel-positioned siblings over the grid; `camera` maps world→screen.
- **`castableSpells` projection** flows fully to the client already (`CastableSpellView` →
  `ServerRunSnapshot`/profile-session → `HeroView.castableSpells`), consumed by `SpellsPanel`/
  `CommandPalette`/`useSpellTargeting`.
- **Overlays** — a closed `OverlayId` registry (`inventory|character-sheet|map-journal|codex|settings|
  help`) with `ListDetail` (`components/ListDetail.tsx`) as the reusable list+detail primitive
  (`InventoryOverlay` is the model: list + detail pane + action keys). Base UI / cmdk / Tailwind v4.
- **Recall return-portal (server)** — `packages/session-core/src/dispatch.ts` already reroutes the
  town's descend/stair intent to `recallReturn` when `run.returnAnchorFloorId` is set. No new client
  intent needed for the return.

## The gaps this spec closes

1. **AoE is invisible to the client.** `CastableSpellView` (`packages/engine/src/projection.ts`)
   drops the spell's `aoe` descriptor; the client mirror `spell-targeting.ts` only handles
   `target.self`/`target.actor` (burst/line/cone fall through to empty candidates), and
   `TargetCandidate.affected` is a placeholder always `[cell]`. Its comments literally say "no AoE
   spell exists yet" — stale since #84. So the 5 shipped AoE spells cannot be aimed or previewed.
2. **Offensive scrolls can't be aimed.** The client item-use intent is `{ type: 'backpack'; action:
   'use'; itemId }` — no target. An ember-scroll / fireball-scroll (which cast a targeted/AoE spell)
   has nowhere to send its aim.
3. **No browsable spellbook.** Only the minimal HUD panel exists — no descriptions, AoE badges, or
   learn view.
4. **Recall/merchant/learn** lack client affordances (the mechanics work; the UX is bare).

## Design

### 1. Foundation — shared AoE geometry + projection metadata

- **Single-source geometry (the key architectural decision).** The engine's `burstCells`/`lineCells`/
  `coneCells` (`packages/engine/src/targeting.ts`) read raw `FloorSnapshot.tiles`/visibility and are
  not client-importable. Rather than DUPLICATE them into the client mirror (the current "port +
  parity-test" convention, which risks the preview drifting from what the server actually hits),
  **extract the pure shape geometry into a shared, dependency-injected module** — pure functions that
  take `isOpaque(point: Point): boolean` and `inBounds(point: Point): boolean` callbacks (plus origin/
  aim/radius) and return the cell set. The engine calls it with tile-derived callbacks (behavior
  identical to today); the client mirror calls it with fogged-projection-derived callbacks. The
  ALGORITHM is single-source (no drift); the client's fog-limited INPUT keeps the preview correctly
  advisory while the server stays authoritative. Home the shared module where both `@woven-deep/
  engine` and `apps/web` can import it without a dependency cycle (a small shared geometry unit — e.g.
  in `@woven-deep/engine` exported for client reuse, or `@woven-deep/session-core` — decide the exact
  home in the plan; it must not create a new cycle).
  - The engine refactor is **behavior-preserving**: `validateTarget`'s output is unchanged, guarded by
    the existing targeting tests, all 8 demos byte-identical, and the parity harness green.
- **`CastableSpellView.aoe`.** Add `aoe?: { shape: 'burst'|'line'|'cone'; radius: number }` to
  `CastableSpellView` and populate it in `projectHeroView` (copy `entry.aoe`). Also widen/expose
  what the UI needs for the overlay: keep `targetingId` (already present). The client computes
  affordability itself (`hero.weave >= weaveCost`), unchanged.

### 2. AoE targeting UX — free cursor + live footprint

- Extend the existing targeting mode to a **free cursor** for AoE (and unify single-target):
  - Arrow keys move a reticle cell around the map, **clamped to the spell's `range`** (Chebyshev from
    the hero); mouse hover sets the reticle to the hovered cell; the reticle is the aim `Point`.
  - The **footprint** (`TargetCandidate.affected`, now the real cell set from the shared geometry)
    updates live under the reticle. Rendered via `TargetingOverlay` reusing `targeting-cell-valid`
    for affected cells and `targeting-cell-reticle` for the aim cell; out-of-footprint in-range cells
    stay `targeting-cell-dim`.
  - **Affected actors** in the footprint get a distinct highlight (so the player sees who gets hit).
  - `Enter`/left-click confirms → dispatches `{ type: 'cast', spellId, target: reticle }`. `Escape`/
    right-click cancels (already wired). Single-target (`target.actor`/`target.self`) spells keep the
    cursor snapping onto valid actors / self.
  - Affordances: out-of-range aim is visibly invalid (can't confirm); insufficient-Weave is blocked
    at panel/overlay entry (spell disabled) and re-checked; an aim with no valid effect still allows
    confirm where the engine would (empty-ground AoE is legal — the server accepts it).

### 3. Offensive scroll targeting — the one intent-shape change

- Extend the client item-use intent to carry an **optional target**: `{ type: 'backpack'; action:
  'use'; itemId; target?: { x, y } }` (mirror in the command-builder so the engine `use-item`
  command — which already accepts `target: Point | null` — receives it).
- When the player uses an item whose content has a `spellId` with a **targeted** spell (targeting id
  is `target.actor`/`target.burst`/`target.line`/`target.cone`), the client enters the **same
  targeting mode** as casting (close the inventory overlay, aim with the free cursor + footprint,
  confirm) and dispatches `use` **with** the chosen `target`. Self-target scrolls, potions, food, and
  **tomes** (learn) stay fire-and-forget (no target step). The server validates the scroll's spell
  targeting exactly as for a cast.
- The targeting mode is generalized to be launched by either a spell (dispatch `cast`) or a scroll
  (dispatch `use`+target) — one shared aim flow, two dispatch targets.

### 4. Spellbook overlay — browse/detail (quick-cast panel stays)

- New `spellbook` overlay: add `'spellbook'` to `OverlayId` (`overlays/registry.ts`), a new
  `ActionId`/keybinding (`session/settings.ts` + `KeyRouter.ts`), and a body case in `OverlayHost`.
  Built on `ListDetail`:
  - **List:** one row per known spell — name, Weave cost, range, an **AoE-shape badge**
    (burst r2 / line / cone), and affordable/known state (dimmed when unaffordable).
  - **Detail pane:** description, effects summary, targeting/AoE info, and a **Cast** button that
    enters targeting mode (same flow as the panel). Spell display metadata (description/effects) is
    read from the client's already-loaded content pack (the same pack the client uses to render item
    details) — `castableSpells` supplies the runtime state (known/cost/range/aoe), the content pack
    supplies static prose. No new projection field beyond `aoe` is required for this. Keyboard nav via `ListDetail`'s built-in
    arrow/Home/End; a single-letter cast action key consistent with the inventory pattern.
- The always-on **`SpellsPanel`** HUD stays for quick-cast (click/hotkey → aim). The overlay is the
  browse/learn surface; both enter the same targeting mode.

### 5. Recall, spell merchant, learn — reuse + polish

- **Recall** is a `target.self` spell — casts from the panel/overlay via the existing self-cast path
  (no aim step). **Return-portal:** the server already reroutes the town dungeon-stair to
  `recallReturn` when `returnAnchorFloorId` is set — the UX work is **relabeling** that stair
  interaction ("Return to depth N" instead of "Descend", plus a hint) when an anchor is present.
  Surface the pending anchor to the client (it is on the run state / snapshot — confirm it reaches
  the projection; if not, add it to the snapshot).
- **Spell merchant:** the town spell-vendor is a trade merchant — buying tomes/scrolls reuses the
  existing **trade screen** unchanged. Polish only: an AoE/spell affordance (badge) on spell items in
  the trade list so the player can tell what a tome/scroll teaches/casts.
- **Learn-from-tome:** reading a tome is item-use (fire-and-forget) that learns the spell. Add clear
  **feedback** (a toast/log line "Learned Fireball") and ensure the newly-known spell appears in the
  panel/overlay immediately (it flows through `castableSpells` on the next snapshot — confirm).

### 6. Determinism, testing, scope

- **Determinism boundary preserved.** The client sends only `cast` / `use`+target intents; the server
  re-validates aptitude, Weave, and targeting. The UI **previews** (advisory, fog-limited) but never
  enforces engine rules. The shared-geometry extraction changes NO engine behavior — `validateTarget`
  output identical, all 8 demos byte-identical, cross-process parity harness green.
- **Testing:**
  - *Geometry parity:* the shared geometry returns identical cells for engine-tile input vs a full-
    visibility client-projection input on the same map, per shape (burst/line/cone), including
    opacity-stop for line and range clamping. The engine's existing `targeting`/`targeting-aoe` tests
    stay green through the refactor.
  - *Targeting mode:* cursor move within range, live footprint per shape, affected-actor highlight,
    confirm dispatches `cast` with the reticle cell, cancel (Escape/right-click), out-of-range can't
    confirm, empty-ground AoE confirmable.
  - *Scroll targeting:* using a targeted scroll enters targeting and dispatches `use`+target; a
    non-targeted consumable/tome stays fire-and-forget.
  - *Spellbook overlay:* list renders known spells with AoE badges + affordability; detail pane Cast
    enters targeting; opens/closes via its key; guest/no-spells state.
  - *Recall/merchant/learn:* the town stair relabels to "Return to depth N" when anchored; a tome-read
    surfaces learned feedback and the spell appears; the trade list shows spell affordances.
  - Web tests use vitest + testing-library/jsdom (note the known intermittent overlay/settings web
    flakes — new tests should avoid the same parallel-load fragility where possible).
- **In scope:** AoE targeting + live preview, offensive-scroll targeting (the optional-target item-use
  intent), the spellbook overlay, and recall/merchant/learn polish, plus the behavior-preserving
  shared-geometry extraction.
- **Out of scope:** any new spells/mechanics/content (engine work is complete), spell upgrading/
  cooldowns, manual multi-target selection, mobile/touch gestures, and rebindable AoE-specific keys
  beyond the existing keymap system.

## Scope boundary
Spec B completes the magic system's player-facing surface. It is UI-only in `apps/web` plus (a) the
`CastableSpellView.aoe` projection field, (b) the optional `target` on the item-use intent/command-
builder, and (c) the behavior-preserving shared-geometry extraction touching `packages/engine`'s
targeting. No new gameplay, no server-authority changes.
