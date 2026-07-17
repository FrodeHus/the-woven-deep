# Guest Interface (Milestone 5D-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The functional guest interface — six registry overlays (inventory, character sheet, map/journal, codex, settings, help), full key rebinding, font scale, reduced motion, clear-guest-session, and the identify target picker — per `docs/superpowers/specs/2026-07-17-guest-interface-design.md` (including its dated codex amendment) plus this plan's own Task 10 live-play amendment.

**Architecture:** One `overlay: OverlayId | null` on App state with a static registry (component, title, scope); a shared `OverlayScaffold` extracted from the existing dialog conventions; a framework-free settings module in the session layer feeding a resolved keymap into KeyRouter and root-level font-scale/motion classes; codex discovery from records + a session sighting cache. Web-only except one narrow, disclosed projection addition (Task 8).

**Tech Stack:** React 19 + Vite (dependency-free client), framework-free session core, Vitest + Testing Library, Playwright e2e.

## Global Constraints

- **No engine schema bumps.** Content stays v7, saves stay v8. A task needing one reports BLOCKED. The single permitted engine change is Task 8's actor-contentId projection field (projection-only; hash re-pin with inspected delta).
- Projections never leak hidden state (RNG streams, `fallenHeroDecisions`, `encounterDecisions`, `concludedAtRevision`, standings internals); undiscovered codex ids never reach the DOM.
- Overlays: one at a time; keyboard-first with mouse first-class; every dialog uses `useDialogFocusTrap`, `role="dialog"`, Esc-close with `stopPropagation` (the 5C Task 7b pattern), `useListNavigation` for roving lists.
- Settings live in `localStorage` key `woven-deep.settings.v1`; run save/Hall/portrait/sighting cache stay in `sessionStorage`. Corrupted settings → defaults + dismissible notice (5A pattern), never a crash.
- Help and all hint text render from the resolved keymap, never from key literals.
- Spec-reality resolution (binding): the content model has **no item lore/description field** (`packages/content/src/model.ts` — items carry name/glyph/color/category only), so the inventory detail pane renders name, category, identification state, effects, enchantment/unknown-properties, charges/fuel — no lore row. Do not add a content field.
- RED-first TDD; conventional commits; existing e2e specs stay green (Task 5 preserves the BackpackMenu key contract exactly so pinned walks survive).
- Demo hash fixtures: zero drift in every task except Task 8, whose delta must be projection-hash-only and exactly the added actor field.

## Key engine/web facts (verified at HEAD 890f0fa)

- `ScreenState` union at `apps/web/src/App.tsx:31-36`; owner `App` (`:198`), transitions via `setScreen`. `?quickstart=1` boots straight to play. `PORTRAIT_KEY = 'woven-deep.guest-portrait'` (`App.tsx:40`).
- KeyRouter (`apps/web/src/ui/KeyRouter.ts`): module-private `DIRECTION_KEYS` (`:12-21`, arrows/numpad/vi), exported `KEYMAP` (`:27-38`: `.` wait, `R` rest, `g` pickup, `>` descend, `<` ascend, `H` house, `T` trade-open), `routeKey({event, overlayOpen})` (`:51-71`) with shift gating for `i`/`R`/`H`/`T`, `createKeyDispatcher(handlers, isOverlayOpen, now?)` (`:97`), `REPEAT_INTERVAL_MS = 80`. Window listener wired in `PlayScreen.tsx:187-208`; overlay predicate at `:203-204` reads `backpackOpen || houseOpen || projection.trade !== undefined || pendingDecision !== null`.
- Dialog conventions: `useDialogFocusTrap(ref)` defined in `BackpackMenu.tsx:51` (consumers: BackpackMenu, DecisionPrompt, HouseScreen, TradeScreen); `useListNavigation(length)` in `apps/web/src/ui/screens/roving-focus.ts:11` returning `{selectedIndex, setSelectedIndex, registerItem, handleArrowKeys}`.
- `GameplayProjection` (`packages/engine/src/projection.ts:325-344`): `floor, hero, actors, features, groundItems, actions, trade?, metrics, conclusion, slots, house`. Hero (`:624-634`): `attributes`, `derived` (`{value, formula}` per `DERIVED_STAT_NAMES`: maxHealth, meleeAccuracy, meleeDamageBonus, rangedAccuracy, defense, search, disarm), `health`, `maxHealth`, `sightRadius`, `hungerStage`, `conditions` (`{conditionId, name, color, stacks, expiresAt}`), `equipment`, `backpack`, `backpackCapacity`, `knownAppearanceIds`. Items via `projectedOwnedItem` (`:521-526`) / `projectItem` (`identification.ts:109-140`) — no description field. Trade services carry `targetItemIds: OpaqueId[]` (`:465-477`). Cells: `knowledge ('unknown'|'remembered'|'visible'), glyph, token, intensity, tint, fixture` (`:35-51`). `slots` town-only (`:607-611`).
- `deriveActorStats` at `packages/engine/src/attributes.ts:51`; chargen preview consumes it via `wizardPreview` (`apps/web/src/session/wizard-reducer.ts:239-261`).
- Log: `apps/web/src/session/event-log.ts` — `LogLine {id, text, tone}`, `LOG_CAPACITY = 200`; snapshot exposes `log`; conclusion tail = `log.slice(-8)` (`App.tsx:149`).
- Records: `RunRecordRepository` (`packages/engine/src/run-record-repository.ts:123-131`); guest impl `apps/web/src/session/run-records-storage.ts` (`RECORDS_KEY = 'woven-deep.guest-hall'`). `HallRecord` (`run-records-model.ts:17-31`): `classTags[]` (NO classId), `cause.killerContentId`, `build.equippedItemContentIds[]`, numeric `metrics` only. `IdentificationState` = `{appearanceByContentId, knownAppearanceIds}` (`item-model.ts:39-42`).
- Storage seam: `apps/web/src/session/storage.ts` — `SessionStorageLike {get, set}` (`:8-11`), `browserSessionStorage()` (`:45`), `classifyStorageFailure` (`:36`). No localStorage use exists yet. Notices: persistent `role="alert"` `.storage-warning-banner` vs dismissible `role="status"` `.session-banner` (`App.tsx:172-182`, `withHallNotice` `:252-269`).
- CSS: `.playfield { font-size: calc(1rem * var(--zoom,1)); --cell-w: 1ch; --cell-h: 1lh }` (`styles.css:54-56`); `.cell-probe` (`:73`), un-zoomed `.cell-probe-base` (`:82`). Reduced-motion blocks at `:37` and `:182-186` (`.glow`/`.effect` overrides with load-bearing `!important`). `styles-contract.test.ts` parses the CSS text (brace-depth scan for the media block).
- BackpackMenu (`apps/web/src/ui/BackpackMenu.tsx`): opened by `i`; keys ArrowUp/Down select, `e` equip/unequip, `u` use, `d` drop, `l` toggle-light; dispatches `{type:'backpack', action, itemId}`; lists backpack stacks then equipped items. The 5A/5C e2e walks drive these exact keys.
- E2e: `guest-play.spec.ts`, `town-loop.spec.ts`, `run-lifecycle.spec.ts`; boot via `/play?quickstart=1&seed=11.22.33.44`; derivation recipe documented in spec headers (drive the built engine like `GuestSession.dispatch`, print key sequence); `guest:e2e` = build + playwright on port 4173.
- Content model (`packages/content/src/model.ts`): `description` exists on achievement/class/background/trait/condition only; classes carry `silhouetteGlyph`, `unlockHint`, `classTags`; identification pools name unidentified items (verb+noun + visuals).
- There is NO React error boundary anywhere in apps/web today; client-bug handling is inline in App.tsx (`boot-error` screen, `withHallNotice` banners).

---

### Task 1: Settings core and the rebindable keymap

**Files:**
- Create: `apps/web/src/session/settings.ts`, `apps/web/test/settings.test.ts`
- Modify: `apps/web/src/session/storage.ts` (add `browserLocalStorage()`), `apps/web/src/ui/KeyRouter.ts`, `apps/web/test/key-router.test.ts`

**Interfaces:**
- Consumes: `SessionStorageLike`, `classifyStorageFailure` (storage.ts), the existing `KEYMAP`/`DIRECTION_KEYS` tables.
- Produces:

```ts
// settings.ts (framework-free, no React):
export type ActionId =
  | `move.${'n'|'ne'|'e'|'se'|'s'|'sw'|'w'|'nw'}`
  | 'wait' | 'rest' | 'pickup' | 'descend' | 'ascend'
  | 'inventory' | 'house' | 'trade'
  | 'character-sheet' | 'map-journal' | 'codex' | 'settings' | 'help';
export type KeyChord = Readonly<{ key: string; shift: boolean }>;   // serialized "Shift+T" / "i"
export interface Settings {
  readonly fontScale: 1 | 1.15 | 1.3 | 1.5;
  readonly reducedMotion: 'system' | 'on' | 'off';
  readonly bindings: Readonly<Partial<Record<ActionId, KeyChord>>>; // overrides only
}
export const SETTINGS_KEY = 'woven-deep.settings.v1';
export const DEFAULT_SETTINGS: Settings;
export function loadSettings(storage: SessionStorageLike): Readonly<{ settings: Settings; corrupted: boolean }>;
export function saveSettings(storage: SessionStorageLike, settings: Settings): Readonly<{ ok: boolean }>;
export const DEFAULT_BINDINGS: Readonly<Record<ActionId, KeyChord>>;   // vi/arrow defaults + i, Shift+H, Shift+T, c, m, x, o, Shift+? — arrows/numpad remain hardwired synonyms for movement, never rebindable away
export function resolveKeymap(overrides: Settings['bindings']):
  Readonly<{ byChord: ReadonlyMap<string, ActionId>; byAction: Readonly<Record<ActionId, KeyChord>> }>;
export function bindingConflict(overrides: Settings['bindings'], action: ActionId, chord: KeyChord): ActionId | null;
```

- KeyRouter change: `routeKey` gains a `keymap` parameter (the resolved map); the static `KEYMAP` collapses into `DEFAULT_BINDINGS`-derived behavior with identical defaults. `createKeyDispatcher(handlers, isOverlayOpen, getKeymap, now?)` reads the map fresh per keydown. Escape stays hardwired (`close-overlay`, not an ActionId). Every existing router test must pass unchanged against the default map — that is the compatibility proof.
- New action outcomes: `character-sheet`/`map-journal`/`codex`/`settings`/`help` route as `{type:'open-overlay', overlay: OverlayId}` (OverlayId arrives in Task 2; this task types it as the string union directly, they are the same strings minus `inventory`).
- Default open keys: `i` inventory (unchanged), `c` character sheet, `m` map/journal, `x` codex, `o` settings, `Shift+?` help. None collide with `DIRECTION_KEYS` (h/j/k/l/y/u/b/n), `.`/`R`/`g`/`>`/`<`/`Shift+H`/`Shift+T` — assert this statically in a test over `DEFAULT_BINDINGS`.

- [ ] RED: settings load/save round-trip; corrupted blob → `{settings: DEFAULT_SETTINGS, corrupted: true}`; unknown fields dropped on load (forward tolerance); `resolveKeymap` maps every ActionId, overrides shadow defaults, `bindingConflict` reports the holding action and `null` for self; a stored override that collides with another action's default is dropped at load with `corrupted: false` but a returned `droppedOverrides: ActionId[]`; keymap-compat table — every entry of the old `KEYMAP` routes identically through the new path; conflict-free `DEFAULT_BINDINGS` assertion. Then implement → web suite + typecheck → commit `feat: add settings core and rebindable keymap`.

---

### Task 2: Overlay infrastructure

**Files:**
- Create: `apps/web/src/ui/overlays/registry.ts`, `apps/web/src/ui/overlays/OverlayScaffold.tsx`, `apps/web/src/ui/overlays/OverlayErrorBoundary.tsx`, `apps/web/test/overlay-infrastructure.test.tsx`
- Modify: `apps/web/src/App.tsx` (overlay state + settings wiring + root font-scale/motion), `apps/web/src/ui/PlayScreen.tsx` (overlay predicate + host render), `apps/web/src/ui/BackpackMenu.tsx` (extract `useDialogFocusTrap` to `apps/web/src/ui/overlays/focus-trap.ts`, re-export for existing consumers), `apps/web/src/styles.css`

**Interfaces:**
- Consumes: Task 1's `resolveKeymap`/`Settings`; existing `useDialogFocusTrap`, `useListNavigation`.
- Produces:

```ts
// registry.ts:
export type OverlayId = 'inventory' | 'character-sheet' | 'map-journal' | 'codex' | 'settings' | 'help';
export interface OverlayDefinition {
  readonly id: OverlayId; readonly title: string; readonly scope: 'play' | 'global';
  readonly action: ActionId;                     // the opening action, for help/hints
}
export const OVERLAY_REGISTRY: Readonly<Record<OverlayId, OverlayDefinition>>;
// OverlayScaffold.tsx:
export function OverlayScaffold(props: Readonly<{
  title: string; onClose: () => void; children: ReactNode;
  testId: string;                                 // `overlay-${id}`
}>): JSX.Element;   // role="dialog", aria-label=title, focus trap, Esc closes with stopPropagation
// OverlayErrorBoundary.tsx: class component; on error renders the overlay frame with a
// "This screen hit a bug — Esc to close. The run is unaffected." alert; never unmounts the play surface.
```

- App owns `overlay: OverlayId | null` beside `ScreenState`; `open-overlay` outcomes set it (play-scope ids only when `screen === 'play'` with a live session; global ids from play AND from new title-screen entries "Codex / Settings / Help"). App loads settings on boot, applies `fontScale` as inline `fontSize: calc(1rem * scale)` on the app root and `reducedMotion` as a `motion-reduced` root class; CSS gains `.motion-reduced` duplicates of the existing `prefers-reduced-motion` overrides (same `!important` discipline, asserted by extending the styles-contract parser to the class block).
- PlayScreen's overlay predicate extends to `overlay !== null || ...existing`; the host renders `OVERLAY_REGISTRY[overlay]`'s component (component lookup lives in PlayScreen/App to keep the registry React-free) inside `OverlayErrorBoundary`. Trade/House/Decision/Backpack wiring untouched.
- The overlay host renders a placeholder `<p>Coming in a later task</p>` body for ids whose overlays land later — the infrastructure ships fully tested before any content overlay exists.

- [ ] RED: open/close each registry id via routed actions (play scope blocked outside play; global scope opens from title); only one overlay at a time (opening a second replaces nothing — the router is gated, assert the keydown is swallowed); Esc closes exactly once (no leak to the window dispatcher — compose PlayScreen like the 5C trade-close regression test); error boundary catches a throwing overlay body and play surface survives; font-scale style and motion class react to settings; styles-contract covers `.motion-reduced`. Then implement → web suite + typecheck → commit `feat: add overlay infrastructure`.

---

### Task 3: Settings overlay

**Files:**
- Create: `apps/web/src/ui/overlays/SettingsOverlay.tsx`, `apps/web/test/settings-overlay.test.tsx`
- Modify: `apps/web/src/App.tsx` (settings mutation callbacks + clear-guest-session), registry wiring

**Interfaces:**
- Consumes: Task 1 settings module, Task 2 scaffold; `SAVE_KEY`/`COMMAND_SEQUENCE_KEY`/`RECORDS_KEY`/`PORTRAIT_KEY` and the Task 8 sighting key for clearing.
- Produces: `SettingsOverlayProps { settings, onChange(next: Settings), onClearGuestSession(), keymap }`. Sections: font scale (4 steps, live preview), motion (system/on/off), bindings (every ActionId row: action label + current chord; Enter arms capture — next keydown becomes the chord; conflict → inline refusal naming the holding action; per-row and global reset), clear guest session (typed "clear" confirmation → wipes the five guest keys + settings → returns to title).

- [ ] RED: rebind flow (arm, capture, persisted via `saveSettings`, router honors it — compose with PlayScreen and walk with the new key); conflict refusal (capturing `g` for inventory names pickup and leaves both intact); arrows/numpad still move after rebinding `move.w` away from `h`; reset restores `DEFAULT_BINDINGS`; motion/font-scale changes persist and re-render; clear-guest-session requires the exact word, wipes storage (assert all keys null), lands on title. Then implement → web suite + typecheck → commit `feat: add settings overlay`.

---

### Task 4: Help overlay

**Files:**
- Create: `apps/web/src/ui/overlays/HelpOverlay.tsx`, `apps/web/test/help-overlay.test.tsx`

**Interfaces:**
- Consumes: `resolveKeymap` output + `OVERLAY_REGISTRY` (key reference generated from `byAction` — never literals), content pack presentation data (glyph legend), Task 2 scaffold.
- Produces: `HelpOverlayProps { keymap, pack }`. Three sections: controls (one row per ActionId, grouped movement/actions/screens, chords formatted from the live map), glyph legend (hero `@`, monster glyphs from pack monsters, item category glyphs, terrain from the tile vocabulary, fixtures), mechanics notes (hunger, light and fuel, identification, the town truce, death finality — short static prose).

- [ ] RED: rebinding inventory to `p` makes help render `p` (no literal `i` anywhere in the controls section markup); legend renders every playable-relevant glyph from the real pack with names; keyboard-only scroll/navigation. Then implement → web suite + typecheck → commit `feat: add help overlay`.

---

### Task 5: Inventory overlay

**Files:**
- Create: `apps/web/src/ui/overlays/InventoryOverlay.tsx`, `apps/web/test/inventory-overlay.test.tsx`
- Modify: `apps/web/src/ui/PlayScreen.tsx` (route `i`/`open-backpack` to the overlay), `apps/web/src/ui/BackpackMenu.tsx` (deleted — absorbed), `apps/web/test/` (BackpackMenu tests migrate to the overlay preserving every assertion)

**Interfaces:**
- Consumes: `projection.hero.backpack`/`equipment`/`backpackCapacity`, `projectedOwnedItem` shapes, the `{type:'backpack', action, itemId}` intent (unchanged), Task 2 scaffold.
- Produces: the overlay REPLACES BackpackMenu but preserves its key contract byte-for-byte — `i` opens, ArrowUp/Down select, `e` equip/unequip, `u` use, `d` drop, `l` toggle-light, Esc closes — so the pinned 5A/5C e2e walks stay green without re-derivation (this is the plan's resolution of the spec's "decided by what the tests anchor to" rule). Additions on top: category filter (Tab cycles all/weapons/armor/consumables/light/other mapping the projected `category` values), name sort (stable, locale-free), a detail pane for the selected item (name, category, quantity, identification state incl. unidentified verb+noun presentation, effects, enchantment or unknown-properties marker, charges/fuel/condition, equipped-slot marker). Browsing free; actions dispatch the existing commands and the overlay re-renders from the projection without closing.
- `snapshot.backpackOpen` becomes the single overlay field's `'inventory'` value — the session's `setBackpackOpen` seam migrates to `setOverlay('inventory'|null)` or App-owned state; pick whichever keeps `guest-session.ts` framework-free and the existing session tests intact, and disclose the choice.

- [ ] RED: migrate every BackpackMenu test assertion first and keep them green against the overlay (the compatibility proof); then filter/sort/detail tests (unidentified item shows verb+noun and no contentId anywhere in markup; equip from overlay updates equipment slot and stays open; full-backpack drop rejection surfaces the standard log line). E2e sanity: run `guest-play.spec.ts` and `town-loop.spec.ts` unchanged — both must pass. Then implement → web suite + typecheck + those two e2e specs → commit `feat: absorb the backpack into the inventory overlay`.

---

### Task 6: Character sheet overlay

**Files:**
- Create: `apps/web/src/ui/overlays/CharacterSheetOverlay.tsx`, `apps/web/test/character-sheet-overlay.test.tsx`

**Interfaces:**
- Consumes: `projection.hero` (attributes, `derived` with formulas, health/maxHealth, sightRadius, hungerStage, conditions with `expiresAt`, equipment), `projection.metrics` (current-run stats: kills, damage dealt/taken, items collected/identified, currency earned/spent, floors, deepest depth, turns, rests), snapshot worldTime for condition remaining-duration display.
- Produces: read-only sheet: attribute block, derived stats WITH their formula strings (the projection already carries `{value, formula}` — render both), resistances only if present on the hero projection (verify; if absent, omit the section rather than extending the projection — resistances are actor-level combat data not currently projected for the hero; disclose in the report), conditions with stacks and remaining time (`expiresAt - worldTime`, "—" in town where time is frozen), hunger stage, sight radius, run statistics.

- [ ] RED: renders every derived stat name from `DERIVED_STAT_NAMES` with formula text; a poisoned fixture hero shows the condition with remaining duration; town snapshot shows the frozen-time marker; no dispatch surface exists (no buttons, no key actions besides close/scroll). Then implement → web suite + typecheck → commit `feat: add character sheet overlay`.

---

### Task 7: Map and journal overlay

**Files:**
- Create: `apps/web/src/ui/overlays/MapJournalOverlay.tsx`, `apps/web/test/map-journal-overlay.test.tsx`

**Interfaces:**
- Consumes: `projection.floor` cells (knowledge/glyph/token/intensity), `projection.actors` (visible-only by construction), `projection.slots` (town), `snapshot.log` (full 200-line retention), `projection.metrics.deepestDepth`, stair positions via the floor's cell tokens.
- Produces: two tabs (Tab key cycles, also clickable). **Map**: the full floor at a fixed compact cell size (own CSS class, e.g. `--map-cell: 0.6em`; scrolls inside the pane; camera-independent), unknown cells blank, remembered cells dim, visible cells lit, hero marker, stairs marked when known; reuses cell glyph/tint data verbatim — no re-derivation of visibility. **Journal**: objective line (static current-milestone text: reach the Heart, escape — sourced from one exported constant so milestone 7 can wire the real objective), the retained log history (scrollable, newest last), landmarks list derived on render: stairs seen (remembered/visible stair cells), merchants met (actors perceived on this floor + town slots), the house (town slot). No new engine state, no new projection fields.

- [ ] RED: a floor with mixed knowledge renders exactly the known subset (assert an unknown cell's glyph is absent from markup); visible-only actors appear; journal shows >8 log lines (deeper than the conclusion tail proves the source is the full retention); landmarks list the town's three merchant slots + house door in town and the stair-down once seen in a dungeon fixture. Then implement → web suite + typecheck → commit `feat: add map and journal overlay`.

---

### Task 8: Codex — sighting cache, derivation, and overlay

**Files:**
- Create: `apps/web/src/session/codex.ts`, `apps/web/src/ui/overlays/CodexOverlay.tsx`, `apps/web/test/codex.test.ts`, `apps/web/test/codex-overlay.test.tsx`
- Modify: `packages/engine/src/projection.ts` (actor `contentId`), `packages/engine/test/projection.test.ts`, `apps/web/src/session/guest-session.ts` (sighting accumulation on publish), demo hash fixtures (projection-only re-pin)

**Interfaces:**
- Consumes: `RunRecordRepository.records()`, session snapshot, content pack, `SessionStorageLike`.
- Produces:

```ts
// Engine (the one permitted projection change): ObservableActor gains readonly contentId: OpaqueId | null
// (null for the hero and fallen-champion actors whose template id would leak build provenance — mirror
// what the name/glyph already reveal, nothing more). Hidden-state greps must stay clean; re-pin demo
// projection hashes ONLY after inspecting that the transcript delta is exactly this field.
// codex.ts:
export const SIGHTINGS_KEY = 'woven-deep.guest-codex';
export interface Sightings { readonly monsterIds: readonly string[]; readonly itemIds: readonly string[] }
export function loadSightings(storage): Sightings;                        // corrupt → empty, notice
export function accumulateSightings(prev: Sightings, projection: GameplayProjection): Sightings;
  // adds visible actors' contentIds and identified owned/ground/stock items' contentIds; pure, dedup, ordered
export interface CodexState { readonly categories: readonly CodexCategory[] }
export interface CodexCategory { readonly kind: 'class'|'item'|'spell'|'monster'; readonly entries: readonly CodexEntry[] }
export type CodexEntry =
  | { readonly discovered: true; readonly contentId: string; readonly name: string; readonly glyph: string;
      readonly color: string; readonly description: string | null; readonly firstSeenRun: number | null }
  | { readonly discovered: false; readonly silhouetteGlyph: string };     // NO id, NO name — structurally spoiler-free
export function deriveCodexState(input: Readonly<{ records: readonly StoredHallRecord[];
  snapshot: SessionSnapshot | null; sightings: Sightings; pack: CompiledContentPack }>): CodexState;
```

- Discovery rules (from the amended spec): monsters = sightings ∪ record `cause.killerContentId`s; items = sightings (identified only) ∪ record `build.equippedItemContentIds`; classes = active hero's `classId` ∪ records whose `classTags` contain all of a class's `classTags` (tags are distinctive per bundled class — assert that in a content-fixture test so a future ambiguous class fails loudly); spells = no source yet → all undiscovered (the category renders, honestly empty of discoveries). `firstSeenRun` = 1-based index of the earliest record carrying the id, else null (active-run/sighting-only).
- GuestSession accumulates sightings after every publish (and on boot restore) and persists them; storage failure downgrades gracefully (session-memory only + the standard warning).
- Overlay: category tabs, list+detail panes, discovered entries full (name/glyph/description where content has one, class unlockHint for locked classes per the chargen convention), undiscovered as `???` silhouettes; a "session-only, like your Hall records" footer line.

- [ ] RED (engine first): projection test for actor contentId incl. the hero-null and champion-null rules and hidden-state greps; rebuild + inspect demo delta + re-pin (document the inspection). Then codex.ts property tests: accumulate is monotone/dedup; a killer id in a record implies monster discovery with `firstSeenRun`; undiscovered entries carry no id/name (serialize the whole CodexState and grep); classes-by-tags uniqueness fixture. Overlay tests: undiscovered markup contains no content ids (serialize DOM); discovered monster shows name+glyph; empty spells category renders its silhouette row. Then implement → engine + web suites + typecheck → commit `feat: add the unlock codex` (split engine projection change into its own first commit `feat: project perceived actor content ids`).

---

### Task 9: Identify target picker

**Files:**
- Modify: `apps/web/src/ui/screens/TradeScreen.tsx`, `apps/web/test/trade-screen.test.tsx`

**Interfaces:**
- Consumes: `services[].targetItemIds` (already projected), the backpack projection for names/glyphs, the existing `trade-service` intent (already takes `targetItemId`).
- Produces: selecting the identify service (Enter) opens an inline target list (names via unidentified presentation, glyphs) instead of dispatching with `targetItemIds[0]`; Enter dispatches `trade-service` with the chosen id; Esc returns to the services list WITHOUT closing the trade screen (nested-Esc: the picker's Esc handler stops propagation, the scaffold pattern). Services with `targetItemIds.length === 0` show the existing disabled/invalid path unchanged; the strongbox (targetItemId null) path is untouched — assert it.

- [ ] RED: picker lists exactly the eligible items; choosing the SECOND item identifies that item (assert via projection change post-dispatch, the established real-resolveCommand style); Esc from picker keeps trade open; strongbox purchase flow byte-identical to the current test. E2e: extend or re-run the town-loop spec only if it exercised identify (it did not — the loop uses strongbox; state so). Then implement → web suite + typecheck → commit `feat: pick the identify target`.

---

### Task 10: Rendering fix — visible tint floor (live-play report, 2026-07-17)

**Files:**
- Modify: `apps/web/src/ui/GridRenderer.tsx:65-66`, `apps/web/src/styles.css:87-93`, `apps/web/test/styles-contract.test.ts` (or a grid-renderer test beside it)

**The bug (user screenshot, mechanism verified):** 5C floored `.cell-visible`'s *opacity* (`calc(0.62 + 0.38 * var(--light,1))`), but the glyph *color* is `--fg` = the engine's per-cell RGB illumination (`GridRenderer.tsx:66`). At the light-radius rim, intensity ≈ single digits of 255, so the tint is near-black: walls inside the radius edge vanish (dark glyph, dark ground) and then REAPPEAR one cell further out as remembered gray `#4b526b`. The brightness inversion moved from the opacity channel into the color channel.

**Interfaces:**
- Consumes: `cell.tint` (engine RGB, authoritative), `cell.intensity`; the remembered gray constant.
- Produces: a visible cell's rendered color never perceptually darker than the remembered gray. Implementation shape: in GridRenderer, compute `--fg` as a blend that floors brightness — e.g. per-channel `max` against a floor color derived from the remembered gray, or `mix(baseVisibleColor, tint, intensity/255)` with the mix floor chosen so the darkest visible output stays clearly above `#4b526b`'s perceived luminance. Pure presentation: the engine's tint/intensity fields are untouched, gameplay-visible lighting semantics unchanged, the light COLOR still reads through at healthy intensities (a gold torch rim must still look gold-ish, just never black).

- [ ] RED where assertable: a unit test over the extracted blend function (`visibleForeground(tint, intensity): string` exported from GridRenderer or a small `cell-color.ts`) — relative luminance of the output at intensity 1 exceeds the remembered gray's, monotone in intensity, identity-ish at 255; styles-contract keeps the opacity relationship. REAL-BROWSER VERIFICATION (required, per the Task 8/5C precedent): build + serve, Playwright at 1440×900, torch corridor scene — walls fade smoothly from lit gold to dim-but-legible to remembered gray with NO invisible band; iterate values by eye; record observations + final values in the report. Kill any servers started. Then web suite + typecheck → commit `fix: floor visible cell color above remembered gray`.

---

### Task 11: E2e, docs, and the roadmap gate

**Files:**
- Create: `apps/web/e2e/interface.spec.ts`
- Modify: `docs/superpowers/plans/2026-07-13-implementation-roadmap.md`, `apps/web/e2e/README.md` (if key reference tables exist there)

**The interface spec** (seeded, keyboard-only, derivation per the documented harness recipe): boot to town → open and close every overlay by key (`c`, `m`, `x`, `o`, `Shift+?`, `i` — assert each `overlay-*` testid appears and Esc returns to play with the hero still responsive) → in settings, rebind `move.w` to `q`, walk west with `q` (assert position via the aria hero label), rebind back → set font scale 1.3 and complete a five-step walk (assert the playfield probe still yields a consistent camera — the walk succeeding IS the assertion) → open codex, assert the provisioner (met in town) is discovered and the monsters tab shows only silhouettes (nothing perceived yet) → descend, fight the derived first kill, ascend, open codex — the killed monster's name now appears → trade with the curios dealer and identify via the picker (buy an unidentified potion first if the derived stock has one; if the seeded stock has no unidentified item, document choosing a different seed for THIS spec — the other specs keep theirs) → clear-guest-session from settings → assert fresh title. Passes twice consecutively.

- [ ] Steps: derive and write the spec RED-first (assertions before walk); run the full verification block: root `npm test`, typecheck, build, `content:validate`, `content:startup-gate`, `guest:e2e` (ALL specs incl. the three pinned walks, green twice), all five demos, smoke. Roadmap: record 5D-1 gate-green with links; note 5D-2 as next. Commit `feat: prove the guest interface end to end`, then the final whole-branch review per `superpowers:requesting-code-review`.
