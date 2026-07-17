# Guest Experience Polish (Milestone 5D-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The polish layer over 5D-1: world color, visibility-polygon canvas lighting, the effects vocabulary, ornamental framing, screen transitions, contextual onboarding, the accessibility pass, and the 5D-1 riders — per `docs/superpowers/specs/2026-07-18-experience-polish-design.md`.

**Architecture:** All presentation and host-side session state. A named CSS palette replaces scattered hex literals and hosts both the material colors and the high-contrast theme; one canvas layer behind the glyph grid renders polygon light from sources the client already knows (hero light via the pack, fixtures via cell token → vault-legend lookup); a framework-free hint engine drives onboarding; the a11y pass is checklist-driven with fixes in-milestone.

**Tech Stack:** React 19 + Vite (dependency-free), canvas 2D, framework-free session core, Vitest + Testing Library, Playwright e2e.

## Global Constraints

- **Zero engine changes of any kind** (no projection additions this milestone — the fact-check confirmed every needed input already reaches the client). Zero demo-hash drift in every task. A task needing an engine change reports BLOCKED.
- The engine's per-cell `intensity` stays the gameplay/perception authority; the canvas is look only, and `classic` mode (today's DOM rendering) remains complete and is the automatic fallback.
- Visible-vs-remembered brightness discipline holds per material and per theme (contract-tested from the real CSS; no reintroduced inversion).
- Reduced-motion completeness: every new animation/transition declares behavior in ALL FOUR motion blocks (`@media` global `styles.css:37`, effects media block `:182-187`, `.motion-reduced` `:199-202`, `.motion-full` `:216-223` — line refs pre-branch).
- Hint/help copy renders key names from the resolved keymap, never literals; copy in the game's register (plain, dark-fantasy, no filler).
- New persistent state: settings fields ride `woven-deep.settings.v1` (forward-tolerant — no version bump needed for additions, verified); onboarding mastery in NEW localStorage key `woven-deep.onboarding.v1` added to `GUEST_LOCAL_STORAGE_KEYS` AND the interface.spec.ts clear-session assertion list; landmarks ride the existing sightings blob.
- Pinned e2e walks stay green untouched; the onboarding hint strip renders outside the play grid and quickstart boots with onboarding OFF by default.
- RED-first TDD; conventional commits; browser-by-eye verification is the acceptance gate for every visual task (build + `node apps/server/dist/main.js` + Playwright MCP, kill servers, remove artifacts).

## Key facts (verified at HEAD 729631f)

- GridRenderer (`apps/web/src/ui/GridRenderer.tsx`): one span per cell, windowed client-side from the FULL floor (`projection.floor.cells` covers the whole floor; unknown cells carry no tileId/glyph). Props `{projection, camera, viewport}` (`:6-10`); visible cells set `--light` + `--fg` via `visibleForeground` (`:66-67`); glyph precedence hero→actor→item→fixture→cell (`:65`). Cell classes: cell-empty/-unknown/-remembered/-visible.
- Effects: `EffectsLayer.tsx` — sibling of GridRenderer inside `.playfield`; `.glow` for the HERO's carried light only, resolved from the pack via `equippedLightSource` (`:41-59` — `{color, radius, fuelFraction}`); transient effects from `effectsForEvents` in `apps/web/src/ui/effects-map.ts` (`switch` on event.type → `'hit-flash'|'attack-streak'|'death-burst'`, `MAX_TRANSIENT_EFFECTS=12`, per-kind lifetimes `:28-32`, dual cleanup animationend + timeout because reduced-motion never fires animationend).
- DOM nesting: `.playfield` (relative, overflow hidden, `PlayScreen.tsx:330`) > probes + `.playfield-grid` + `.effects-layer`. A canvas slots as a `.playfield` child BEFORE `.playfield-grid`.
- Camera: `viewportForPane` (`layout.ts:46-57`, MIN 30×12), `computeCamera` (camera.ts), probe→state flow in `PlayScreen.tsx:180-223`, `--zoom` inline at `:330`.
- Terrain: `TILE_DEFINITIONS` (`packages/engine/src/terrain.ts:16-24`): 0 wall `#` opaque, 1 floor `.`, 2 closed-door `+` opaque, 3 pillar `O` opaque, 4 stair-up `<`, 5 stair-down `>`, 6 void (opaque). `cell.token` ∈ terrain.wall/floor/door/pillar/stair/void (both stairs share `terrain.stair` — tileId distinguishes).
- Light sources client-side WITHOUT engine changes: hero light via `equippedLightSource`; fixtures via `cell.fixture` (`{lightId, glyph, token}`) + vault-legend lookup by presentation token (the `collectLightFixtures` pattern in `HelpOverlay.tsx:74-88` already reads `pack.entries[kind==='vault'].legend[*].light` → glyph/color/radius/strength). Non-hero actors' carried lights are not identifiable as sources — accepted limitation, per-cell tint still shades those cells.
- styles.css (430 lines): NO custom-property palette — hex literals throughout (gold `#e8c879`/`#f1d898`, border `#3d465f`, muted `#7d89a8`, alert `#db7f78`, panel `#232a3d`, root fg `#aab3d1`, bg `#121521`); `--fg` is the only per-cell color path (no material coloring exists); `.cell-remembered {color:#4b526b; filter:saturate(0.4); opacity:0.55}` (`:88`), `.cell-visible` (`:93`). Panel borders: `1px solid #3d465f` across tapestry/panels/drawers/log/chargen/hall/map (`:12,252,267,277,323,338,379,389,412`), gold accent on active (`:30,290,...`). styles-contract helpers: `extractBlocksAfterMarker`, `extractReducedMotionBlocks` (`test/styles-contract.test.ts:20,42`).
- Settings (`session/settings.ts`): `Settings {fontScale, reducedMotion, bindings}` (`:21-26`); `loadSettings` forward-tolerant — new fields validate-with-fallback like fontScale (`:200-205` pattern), NO key bump needed. SettingsOverlay sections at `SettingsOverlay.tsx:113-234`.
- Onboarding hooks: `isQuickstart` (`App.tsx:79-80`); quickstart boots straight to play (`:352`); wizard steps 1-7 (`wizard-reducer.ts:16,100-110`) — the disable-onboarding pre-chargen toggle slots on step 1; TitleScreen options `TitleScreen.tsx:46-55`.
- Sightings (`session/codex.ts`): `Sightings {monsterIds, itemIds}` (`:18-21`), `SIGHTINGS_KEY` sessionStorage, `accumulateSightings(prev, projection)` (`:92-116`), synced at boot + every publish (`guest-session.ts:109,312-322,410`). MapJournal `landmarksFor(floor, actors, slots)` derives fresh (`MapJournalOverlay.tsx:186-214`), not persisted.
- Humanizer: `fixtureLabel` inline in `HelpOverlay.tsx:71-75`; raw effect ids render at `InventoryOverlay.tsx:149-150` (`{effect.effectId}`).
- Transitions: App screen switching is instant conditional returns (`App.tsx:479,503,544,553`); no screen animation exists.
- A11y baseline: the ONLY aria-live is `LogPanel` `role="log" aria-live="polite"` (`panels.tsx:149`); StatusBar `role="status"` (`:161`); alerts/status inventory in App.tsx `:212,217,425,430,435,464,474,509,560,589`, SettingsOverlay `:171,177`, OverlayErrorBoundary `:36`, HallScreen `:124,126`. EffectsLayer is aria-hidden.
- Clear-session: `GUEST_SESSION_STORAGE_KEYS` (`clear-guest-session.ts:11-13`), `GUEST_LOCAL_STORAGE_KEYS` (`:16`, holds settings.v1); interface.spec.ts asserts the exact key lists (`:211-224`).

---

### Task 1: The named palette and the material colors

**Files:**
- Modify: `apps/web/src/styles.css` (introduce `:root` custom properties for every recurring literal + the material set; `.mat-*` cell rules), `apps/web/src/ui/GridRenderer.tsx` (material class from token/tileId), `apps/web/test/styles-contract.test.ts`, `apps/web/test/grid-renderer.test.tsx` (or the existing renderer test home)

**Interfaces:**
- Consumes: `cell.token`/`cell.tileId` (terrain vocabulary above), `visibleForeground` (unchanged), the existing cell classes.
- Produces:

```ts
// GridRenderer: materialClass(cell): '' | `mat-${'wall'|'floor'|'door'|'pillar'|'stair-up'|'stair-down'|'void'}`
//   from token (stairs split by tileId). Applied on remembered AND visible cells beside the knowledge class.
// styles.css :root gains the named palette: --ink, --ground, --gold, --gold-bright, --line, --muted,
//   --alert, --panel, --mat-wall, --mat-floor, --mat-door, --mat-stair, --mat-void (+ any literal that
//   recurs ≥2 times becomes a variable; single-use literals may stay). Every EXISTING rule that used a
//   recurring literal switches to its variable — zero visual change for non-material UI (same values).
// Material coloring: .cell-visible.mat-wall { --mat: var(--mat-wall) } etc.; the visible color becomes
//   the material tinted by light — implement by feeding the material color into visibleForeground's
//   call site as the BASE color the light tint modulates (extend visibleForeground with an optional
//   base parameter or compose in GridRenderer; keep cell-color.ts's all-hue floor guarantee intact and
//   extend its property tests over every material base). Remembered cells: material hue heavily
//   desaturated toward the established #4b526b family (CSS filter as today), still dimmer than any visible.
```

- Palette values are authored in the Living Tapestry direction (mineral blue-grey walls, warm-neutral floor, brown door/wood, gold-accented stairs, deep charcoal void; town slightly warmer via a `.playfield-town` modifier class fed from `projection.floor.town`). Exact hex values are tuned BY EYE in Task 2's browser pass — author sensible starting values now.
- [ ] RED: materialClass table test (every token/tileId → expected class; unknown cells → none); styles-contract extensions — a palette-completeness check (no raw hex literal remains in rules that reference the named recurring colors; parse the real CSS), and the visible-floor relationship asserted PER material color (compute luminance of each `--mat-*` under `visibleForeground` at intensity 1 vs remembered — reuse the cell-color test helpers); cell-color property tests extended over material bases. Then implement → web suite + typecheck → commit `feat: paint the world with the material palette`.

---

### Task 2: High-contrast theme and palette browser tuning

**Files:**
- Modify: `apps/web/src/session/settings.ts` (`theme: 'tapestry' | 'high-contrast'`, default tapestry), `apps/web/src/App.tsx` (root class `theme-high-contrast`), `apps/web/src/ui/overlays/SettingsOverlay.tsx` (Display section gains the theme radio), `apps/web/src/styles.css` (the theme block re-declaring the palette variables), tests beside each

**Interfaces:**
- Consumes: Task 1's named palette (the theme ONLY re-declares `:root` variables under `.theme-high-contrast` — no per-component overrides), the settings forward-tolerance pattern (validate-with-fallback, no key bump).
- Produces: `Settings.theme`; the theme block; a pure `relativeLuminance`/`contrastRatio` test helper (shared with Task 1's assertions if not already extracted).

- [ ] RED: settings round-trip + fallback for the new field; App applies the class; styles-contract asserts the high-contrast block re-declares EVERY palette variable and that computed contrast for the load-bearing pairs (text on ground, gold on panel, materials vs background, log tones, remembered vs visible) meets WCAG AA (≥4.5:1 normal text, ≥3:1 large/glyph) — computed from the real CSS values, no copied numbers. Then implement → BROWSER PASS (required): tune BOTH themes by eye — default tapestry for the monotony fix (the user's complaint: white/grey world; the pass must end with visibly colored terrain that still reads dark-fantasy), high-contrast for legibility; screenshots at each iteration; record final values. Document deliberate AA exceptions in the DEFAULT theme in the report and as CSS comments. Kill servers, remove artifacts → web suite + typecheck → commit `feat: add the high-contrast theme` (palette tuning may amend Task 1's values in this commit — disclose).

---

### Task 3: Ornamental framing

**Files:**
- Modify: `apps/web/src/styles.css` (one shared frame vocabulary: `--frame-*` variables + `.framed` composition classes applied to the existing panel/dialog/drawer/log/header rules at their current border sites `:12,252,267,277,323,338,379,389,412`), `apps/web/test/styles-contract.test.ts`

**Interfaces:**
- Consumes: Tasks 1-2's palette (frames use `--line`/`--gold` family; the high-contrast theme inherits automatically since frames reference variables).
- Produces: restrained ornamental Unicode framing — corner/edge treatment on panels and dialogs plus title/section header ornaments — implemented as CSS (border-image or pseudo-element corner glyphs like `◆`/`╍` family; pick ONE consistent vocabulary; decorative pseudo-elements are `aria-hidden` by construction, verify screen readers don't announce them — content stays outside pseudo-elements).

- [ ] RED where assertable: styles-contract asserts the frame classes exist and reference palette variables (no new raw hex); a component test asserts panels carry the frame class and no decorative text enters the accessibility tree (serialize the a11y tree of a framed panel — names unchanged). Then implement → BROWSER PASS (required): full-tier and compact-tier screenshots, both themes; restraint check by eye (the master design says "restrained" — if it reads busy, reduce). → web suite + typecheck → commit `feat: frame the interface`.

---

### Task 4: Screen transitions

**Files:**
- Create: `apps/web/src/ui/ScreenFade.tsx`, `apps/web/test/screen-fade.test.tsx`
- Modify: `apps/web/src/App.tsx` (wrap screen switches), `apps/web/src/ui/PlayScreen.tsx` or `guest-session` seam ONLY if descend/ascend need a hook beyond screen-level (they happen inside play — the fade triggers on `activeFloorId` change, read from the projection), `apps/web/src/styles.css` (fade keyframes + all four motion blocks)

**Interfaces:**
- Consumes: App's screen union; `projection.floor` floorId changes for descend/ascend; the motion-class contract (system/media, `.motion-reduced` forces off, `.motion-full` forces on).
- Produces: `ScreenFade` — a wrapper that plays a short fade-through-dark (~220ms out, ~220ms in, `--ground` color) on: title→play, chargen→play, floor change within play, play→conclusion. Input is NOT blocked artificially; the fade is visual only (keydowns during fade behave as without it — assert). Under reduced motion the swap is instant (no fade element at all, not a zero-duration animation — the master design's "applies the new state immediately").

- [ ] RED: component test — fade element present after a screen/floor change and removed on animationend+timeout (the EffectsLayer dual-cleanup pattern); reduced-motion renders no fade element; keydown during fade reaches the dispatcher (compose with PlayScreen). styles-contract: keyframes declared and disabled/enabled correctly in all four motion blocks. Then implement → BROWSER PASS: title→play, descend, death→conclusion by eye, both motion modes → web suite + typecheck → the three pinned e2e specs re-run green (fades must not break walk timing — Playwright auto-waits; if a spec flakes on the fade, the fade element must be `pointer-events:none` and excluded from actionability waits via `aria-hidden` + zero interactability; fix the fade, never the spec) → commit `feat: fade between screens`.

---

### Task 5: Visibility-polygon geometry (pure)

**Files:**
- Create: `apps/web/src/ui/light-geometry.ts`, `apps/web/test/light-geometry.test.ts`

**Interfaces:**
- Consumes: nothing but plain data (framework-free, no DOM).
- Produces:

```ts
export interface LightOccluder { readonly x: number; readonly y: number }   // opaque cell (grid coords)
export function visibilityPolygon(input: Readonly<{
  origin: Readonly<{ x: number; y: number }>;        // light center in CELL coordinates (fractional ok: x+0.5)
  radius: number;                                     // cells
  occluders: readonly LightOccluder[];                // opaque cells within radius+1 (caller pre-filters)
}>): readonly (readonly [number, number])[];          // polygon vertices, CCW, cell coordinates
// Algorithm: cast rays to each occluder-corner vertex (±epsilon pair per corner) plus a coarse angular
// sweep fallback (e.g. every 6°) so open areas produce a smooth circle-approximation clipped at radius;
// intersect each ray with occluder squares (AABB slab test); sort hits by angle; dedupe.
```

- [ ] RED, table-driven: open field → radius-bounded polygon (all vertices ≈ radius); single wall block → shadow wedge behind it (a point behind the wall is outside the polygon — point-in-polygon helper in the test); corner grazing (light exactly diagonal to a wall corner — no leak through the diagonal); enclosed room → polygon hugs the walls; origin inside an occluder → empty polygon; determinism (same input, same output, no Math.random — assert twice). Property test: every vertex within radius+ε; polygon is simple (no self-intersection via a segment-pair sweep on small cases). Then implement → web suite + typecheck → commit `feat: add visibility polygon geometry`.

---

### Task 6: The light canvas

**Files:**
- Create: `apps/web/src/ui/LightCanvas.tsx`, `apps/web/test/light-canvas.test.tsx`
- Modify: `apps/web/src/ui/PlayScreen.tsx` (mount inside `.playfield` before the grid), `apps/web/src/ui/GridRenderer.tsx` (smooth-mode glyph brightness flattening), `apps/web/src/session/settings.ts` (`lighting: 'smooth' | 'classic'`, default smooth), `apps/web/src/ui/overlays/SettingsOverlay.tsx` (Display section), `apps/web/src/styles.css`

**Interfaces:**
- Consumes: Task 5's `visibilityPolygon`; light sources client-side: hero via the existing `equippedLightSource(projection, pack)` seam (EffectsLayer — extract it to a shared `light-sources.ts` so both consumers use one resolver, refactor EffectsLayer's import, zero behavior change there), fixtures via `cell.fixture.token` → vault-legend lookup (generalize HelpOverlay's `collectLightFixtures` into the same `light-sources.ts`: `fixtureLightsFor(projection, pack): {x, y, color, radius, strength}[]` — fixture cells from the projection, spec from the pack legend by token, only for cells with `knowledge === 'visible'`); occluders from explored opaque cells (`tileId` 0/2/3/6) within each light's radius.
- Produces: a `<canvas>` behind the glyph grid, sized to viewport×cellPx (device-pixel-ratio aware), redrawn on projection/camera/zoom change: per source, `visibilityPolygon` → path → radial gradient fill in the source color (alpha falls with distance; strength scales peak alpha) → `globalCompositeOperation: 'lighter'`; a soft rim via a small blur or a second lower-alpha expanded pass. Smooth mode flattens `.cell-visible` brightness (a `.lighting-smooth` playfield class makes `--light` contribute less/none to opacity — the canvas carries falloff; the visible-vs-remembered floor STILL holds via the styles-contract). `classic` mode renders no canvas and keeps today's CSS exactly. Canvas unavailable (jsdom, old browser) → automatic classic with a log-level breadcrumb, no crash — the component renders null.

- [ ] RED: light-sources.ts unit tests (hero resolver behavior preserved — port EffectsLayer's existing expectations; fixture resolver maps a visible town lamp cell to the legend spec, invisible fixture excluded); LightCanvas component tests in jsdom (renders null/fallback without canvas 2D; mounts with a mocked 2d context and issues ≥1 fill per visible source; classic setting renders nothing); settings field round-trip; styles-contract for `.lighting-smooth` (floor relationship preserved). Then implement → BROWSER PASS (the milestone's centerpiece — iterate hard): torch corridor (smooth falloff, wall shadows, no rim artifacts), town multi-fixture scene (three lamps + hero light compositing), toggle smooth/classic live in settings, reduced motion (static polygons, no flicker), both themes, zoom 1 and 2 (canvas tracks the zoomed cell size via the probe values). Screenshots at each stage; record final gradient/alpha values → web suite + typecheck → pinned e2e specs green (canvas is aria-hidden and pointer-events:none) → commit `feat: light the deep with visibility polygons`.

---

### Task 7: Effects vocabulary

**Files:**
- Modify: `apps/web/src/ui/effects-map.ts` (new kinds + mapping), `apps/web/src/ui/EffectsLayer.tsx` (render arms + lifetimes), `apps/web/src/ui/GridRenderer.tsx` (fixture flicker variation + stair shimmer cell classes), `apps/web/src/styles.css` (keyframes + all four motion blocks), tests beside each

**Interfaces:**
- Consumes: the event stream `effectsForEvents` already switches on; hero conditions from `projection.hero.conditions` (actor conditions are NOT projected — auras are hero-only plus event-driven flashes on actors; state this limit in code comments); `cell.fixture.token` for per-fixture flicker; palette variables.
- Produces: ember-bolt gets a distinct warm streak (map the spell/projectile event distinctly from generic attack-streak — read the event vocabulary in effects-map and pick the honest discriminator; if events don't distinguish spell from thrown item, use the projectile item/spell id carried on the event, and if nothing distinguishes, report the limitation and keep one streak — do NOT invent event data); hero condition aura (a faint tinted pulse on the hero cell while a condition is active, tint from the condition's projected `color`, plus a small glyph badge beside the StatusBar/VitalsStrip so the meaning is not color-only — the badge is the Task 9 colorblind pattern, land it here); fixture flicker variation (per-token animation-delay/duration jitter derived deterministically from the fixture's lightId hash — no Math.random); stair/entrance shimmer (subtle periodic sheen on `mat-stair` cells, suppressed under reduced motion).

- [ ] RED: effects-map table tests for every new mapping (including the no-discriminator fallback if that's what the events force); EffectsLayer renders an aura while a condition is active and removes it on expiry; deterministic flicker jitter (same lightId → same delay, test twice); styles-contract for the new keyframes across all four motion blocks; MAX_TRANSIENT_EFFECTS still respected. Then implement → BROWSER PASS: ember-bolt in a real fight if reachable (or the dart trap), condition aura via a poison/disengage scenario if reachable — where a scene isn't reachable in a short session, verify the effect by dispatching the event shape in a component harness and say so → web suite + typecheck → commit `feat: extend the effects vocabulary`.

---

### Task 8: Contextual onboarding

**Files:**
- Create: `apps/web/src/session/onboarding.ts`, `apps/web/src/ui/HintStrip.tsx`, `apps/web/test/onboarding.test.ts`, `apps/web/test/hint-strip.test.tsx`
- Modify: `apps/web/src/session/settings.ts` (`onboarding: 'on' | 'off'`, default on), `apps/web/src/session/clear-guest-session.ts` (add the onboarding key), `apps/web/src/App.tsx` (quickstart forces off; wiring), `apps/web/src/ui/PlayScreen.tsx` (strip above the log slot), `apps/web/src/ui/screens/chargen-steps.tsx` + `wizard-reducer.ts` (step-1 disable toggle), `apps/web/src/ui/overlays/HelpOverlay.tsx` (hints listed), `apps/web/src/ui/overlays/SettingsOverlay.tsx` (toggle), `apps/web/e2e/interface.spec.ts` (clear-session key list)

**Interfaces:**
- Consumes: settings, the resolved keymap (copy interpolates chords), projection/snapshot for triggers, dispatched intents/results for mastery counting (hook where GuestSession publishes results — a pure fold like the sightings sync).
- Produces:

```ts
// onboarding.ts (framework-free):
export const ONBOARDING_KEY = 'woven-deep.onboarding.v1';           // localStorage
export interface HintDefinition { readonly id: string; readonly copy: (keymap) => string;
  readonly trigger: (projection, snapshot) => boolean; readonly mastery: Readonly<{ kind: 'intent-count';
  intentType: string; count: number }>; readonly priority: number }
export const HINTS: readonly HintDefinition[];  // movement(10 moves) → inspection(hover/popover or sheet open 1) →
  // inventory(open 1) → light(toggle or fuel view 1) → commerce(1 completed trade) → dungeon entry(1 descend)
export interface OnboardingState { readonly counts: Readonly<Record<string, number>>;
  readonly dismissed: readonly string[] }
export function loadOnboarding(storage): OnboardingState;            // corrupt → fresh + notice flag
export function recordIntent(state, intentType): OnboardingState;    // pure fold
export function activeHint(state, hints, projection, snapshot, enabled): HintDefinition | null;
  // highest-priority triggered hint not mastered/dismissed; null when disabled
```

- HintStrip: dismissible strip above the log — `role="note"` (NOT alert/live — it must not interrupt), keyboard-dismissable via a dedicated key shown in the strip (pick a free key, e.g. `0` or `'`; check the keymap for collisions the Task-1-5D-1 way), never focused automatically, never blocks input. Rendered outside `.playfield-grid`.
- Wizard step 1 gains the "Show guidance on your first delve" toggle (default from settings; writing back to settings on confirm); settings has the same toggle; quickstart boots force `off` (App, beside `isQuickstart`).
- [ ] RED: onboarding.ts table tests (trigger/mastery/dismiss/priority/disable/corrupt-reset/persistence round-trip); HintStrip (renders active hint copy with the LIVE chord — rebind test; dismiss retires; no focus steal — activeElement unchanged on appear); clear-session wipes the key (unit + the e2e assertion list update); quickstart-off default (app-boot test). Then implement → web suite + typecheck → pinned specs green (strip absent under quickstart) → commit `feat: guide the first delve`.

---

### Task 9: Accessibility audit, fixes, and colorblind sweep

**Files:**
- Create: `docs/design/a11y-audit-2026-07.md` (the checklist record — committed, not gitignored)
- Modify: whatever the audit finds (expected: `apps/web/src/ui/panels.tsx` — hero-state announcements; focus-order fixes; label gaps), `apps/web/src/styles.css` (colorblind reinforcements), tests beside each fix

**Interfaces:**
- Consumes: the baseline inventory (Key facts: LogPanel is the only aria-live; alerts/status listed), every screen/overlay shipped through 5D-2.
- Produces: the audit doc — a table: surface × checks (focus order, roles/names, keyboard reachability, live-region behavior, contrast, reduced-motion, color-only meaning) × finding × fix commit. Expected concrete fixes (verify, don't assume): hero health/hunger threshold changes announced politely (a visually-hidden `role="status"` fed from significant transitions — NOT every tick; define thresholds: health crossing 50%/25%, hunger stage change, condition gain/loss — the strip must not spam the SR); threat-panel color-coding gains glyph reinforcement; light-tint meaning (if any) reinforced; any focus-order/label findings from walking every surface with the keyboard and an SR-simulating pass.
- The colorblind sweep covers: threat coloring, condition tints (badge landed in Task 7 — verify), log tones (tone conveyed by prefix glyph not only color), material palette (materials differ by glyph inherently — document as pass).

- [ ] Process: walk EVERY screen/overlay keyboard-only recording the checklist; fix findings RED-first each with a test; the audit doc lists deliberate exceptions (dark-fantasy contrast choices in the default theme, pointing at the high-contrast theme as the accessible alternative). → web suite + typecheck → commit `fix: close the accessibility audit` (+ `docs: record the accessibility audit`).

---

### Task 10: Riders — landmarks persistence and label humanization

**Files:**
- Create: `apps/web/src/ui/labels.ts`, `apps/web/test/labels.test.ts`
- Modify: `apps/web/src/session/codex.ts` (Sightings gains `landmarks`), `apps/web/src/session/guest-session.ts` (accumulate landmarks in the same sync), `apps/web/src/ui/overlays/MapJournalOverlay.tsx` (journal reads persisted landmarks ∪ live derivation), `apps/web/src/ui/overlays/HelpOverlay.tsx` (use labels.ts, delete the inline `fixtureLabel`), `apps/web/src/ui/InventoryOverlay.tsx` (humanized effect labels), tests beside each

**Interfaces:**
- Consumes: `accumulateSightings`'s established pure-fold + sync seam; `landmarksFor`'s current derivation (it becomes the live half).
- Produces:

```ts
// codex.ts: Sightings gains readonly landmarks: readonly {floorId: string; kind: 'merchant'|'stair-up'|
//   'stair-down'|'house'; name: string; x: number; y: number}[]  — captured on first perception (merchant
//   name from the visible actor at sighting time; stairs/house from cells/slots). Forward-tolerant load
//   (old blobs without landmarks load with []). Dedup by (floorId, kind, x, y).
// labels.ts: humanize(token: string): string — the fixtureLabel algorithm generalized (last dot segment,
//   dashes to spaces, capitalize); effectLabel(effectId, parameters): string — humanize + a small map for
//   parameterized phrasing where obvious (e.g. heal amounts) without inventing semantics; used by
//   InventoryOverlay detail and HelpOverlay.
```

- [ ] RED: accumulate-landmarks tests (merchant perceived once persists across a projection where it's gone; stairs persist; dedup; forward-tolerant load of a landmarks-less blob); journal shows a persisted merchant after it leaves sight (component test);  labels tests (fixture token, effect id, parameter phrasing); HelpOverlay/InventoryOverlay swap covered by their existing tests updated. Then implement → web suite + typecheck → commit `feat: remember landmarks and humanize labels`.

---

### Task 11: E2e, docs, and the roadmap gate

**Files:**
- Create: `apps/web/e2e/polish.spec.ts`
- Modify: `docs/superpowers/plans/2026-07-13-implementation-roadmap.md`, `apps/web/e2e/README.md`

**The polish spec** (seeded; onboarding opted IN via a query param or pre-seeded settings — the quickstart default is off, so the spec seeds `localStorage`/settings before boot, following interface.spec.ts's storage-seeding precedent if one exists or `page.addInitScript`): boot → hints appear in priority order (movement first) → walk 10 steps, movement hint retires, next hint appears → dismiss one manually, it stays gone → open settings, disable onboarding, strip vanishes → toggle lighting to classic (assert the canvas absent), back to smooth (canvas present) → switch theme to high-contrast (assert the root class + a computed-style spot check) → descend (fade plays unless reduced motion; not asserted by timing — assert the fade element appears then disappears) → clear-session storage assertion now includes `woven-deep.onboarding.v1`. Passes twice consecutively. Existing four specs green untouched.

- [ ] Steps: write the spec RED-first; run the full verification block: root `npm test`, typecheck, build, `content:validate`, `content:startup-gate` (Docker; report verbatim if down), `guest:e2e` ALL five specs green twice, all five demos (zero drift — no engine changes all milestone), smoke. Roadmap: 5D-2 gate-green with links; milestone 5 recorded COMPLETE; milestone 6 (server/profiles) noted next. Commit `feat: prove the polish end to end`, then the final whole-branch review per `superpowers:requesting-code-review`.
