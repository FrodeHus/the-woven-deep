# Guest Play Core (Milestone 5A) Design

Approved design for the first sub-milestone of milestone 5. It delivers a playable guest dungeon session in a desktop browser: a real engine run, rendered as an ASCII playfield with animated light, driven entirely by keyboard, persisted in `sessionStorage` for the lifetime of the browser session.

## Milestone 5 decomposition

Milestone 5 ("guest game and complete player interface") is too large for one plan and is split into four sub-milestones, each with its own spec, plan, and exit demonstration:

- **5A guest play core (this spec):** engine run constructor, guest session layer, DOM-cell renderer with the glow treatment, Tactical Triptych layout, keyboard survival commands, event log, session persistence.
- **5B character generation and run lifecycle:** engine character generation (attribute roll and point buy, classes, backgrounds, traits, starting equipment), title screen, the seven-step generation flow, run conclusion screen, and the guest Hall of Records backed by a session `RunRecordRepository`.
- **5C town slice:** engine town floor 0, the three town merchants, house storage, dungeon entrance, and their screens.
- **5D full interface:** inventory, character sheet, map, journal, and codex overlays, settings, help, keyboard rebinding, the accessibility pass, contextual onboarding, and the Living Tapestry art pass.

The roadmap gains this decomposition when the 5A plan is written.

## Decisions

- 5A runs start from a fixed default hero. A production engine constructor builds the run; character generation in 5B feeds the same constructor. Fixtures remain test-only surface.
- The play screen exposes the survival command set: movement and bump attack, wait, rest, pick up, descend, and a minimal backpack menu with equip, use, and drop. The full inventory overlay belongs to 5D.
- The client adds no dependencies. The session core is framework-free TypeScript; React binds to it through a hand-rolled `useSyncExternalStore` store; the content pack is fetched once with plain `fetch`. TanStack Query, Router, and Form were considered and deferred: the pack is a fetch-once immutable blob, 5A has a single screen, and there are no forms until 5B. Revisit at 5B.
- Verification is Playwright end-to-end plus Vitest component and unit tests. The run seed is fixed in tests, so the end-to-end script is deterministic.
- Rendering keeps engine-computed visibility and light truth per cell and layers a purely decorative animated glow above it (detailed below).

## Architecture

Three layers with one-way flow. The engine owns rules, the session layer owns orchestration, React owns presentation.

```
keyboard event
  → KeyRouter            (key + focus context → intent, or ignored)
  → GuestSession.dispatch(intent)
      → command-builder  (intent + projection → engine command)
      → resolveCommand   (engine)
      → projectGameplayState → snapshot
      → encodeActiveRun  → sessionStorage
  → store notifies subscribers
  → React re-renders the Triptych from the snapshot
```

### Engine additions (`packages/engine`)

The only engine change in 5A is a production run constructor:

- `createNewRun(input: { pack: CompiledContentPack; seed: Uint32State; hero: NewRunHero }): ActiveRun` — derives the RNG streams from the seed, procedurally generates floor 1 through the existing generation pipeline, places the hero at the entry, resolves the hero's starting equipment from content, records the initial floor entry (so `floorsEntered >= 1` holds), and returns a valid schema-v6 `ActiveRun` that passes `validateActiveRun`.
- `NewRunHero` carries name, attribute block, and starting-equipment content IDs. `DEFAULT_GUEST_HERO` is the exported fixed Wayfarer 5A uses: 10 in each of the five attributes (Might, Agility, Vitality, Wits, Resolve) and the Wayfarer starting gear resolved from the bundled pack.
- Browser-safe, deterministic, clock-free, covered by engine unit and property tests like every other engine module. Milestone 5B replaces only the `hero` argument, not the constructor.

### Guest session layer (`apps/web/src/session/`)

Framework-free TypeScript. No React imports; `sessionStorage` is reached through a two-method storage interface so tests inject a fake.

- `guest-session.ts` — owns the `ActiveRun` and the content pack. Boot order: fetch and validate the pack, try `decodeActiveRun` on the stored save, fall back to `createNewRun` with a fresh seed. Exposes `dispatch(intent)`, `subscribe(listener)`, and `getSnapshot()` returning `{ projection, log, status }`. Every applied command re-projects and persists.
- `command-builder.ts` — pure function from intent plus current projection to an engine command or a client-side rejection (for example, descend is only built when the hero stands on stairs). Rejections become log lines and never reach the engine.
- `event-log.ts` — pure fold of hero-visible domain events into log lines in a capped ring buffer. This is also where the accessibility requirement for textual equivalents of visual events (a light going out, a creature entering sight) is satisfied.
- `store.ts` — the roughly thirty-line `useSyncExternalStore` binding React consumes.

### React shell (`apps/web/src/ui/`)

The Tactical Triptych per the master design: the map is the primary center region and never yields primacy; side panels collapse into keyboard-accessible drawers at narrow widths.

- `GridRenderer` — DOM cells (a CSS grid of spans), one per visible map cell: glyph, `--fg`, `--bg`, `--light` custom properties, and the knowledge state (`visible`, `remembered`, `unknown`) as a class. No game logic.
- `HeroPanel` (left): health, resources, equipped gear, compact backpack. `ThreatPanel` (right): nearby actors with intent and health band, ground items, depth context. `LogPanel` (bottom): the event log plus context-sensitive control hints. `StatusBar` (top): location, hero identity, turn count. All pure functions of the snapshot.
- `BackpackMenu` — the survival-set item menu. Focus-trapped list; equip, use, drop; Escape closes; movement keys are blocked while it is open.
- `KeyRouter` — one keydown listener at the app root consulting a static keymap table (arrows, numpad, and vi keys for the eight directions; `.` wait; `R` rest; `g` pick up; `>` descend; `i` backpack). Rebinding arrives in 5D. Per the master design's input-routing rule, movement commands are blocked while any overlay, form field, or dialog has focus, and visible focus styling is never removed.

## Rendering: ASCII with animated light

Two layers over the same grid with a strict truth/decoration split.

**Cell layer (gameplay truth).** Each cell keeps its glyph and the engine-computed knowledge state and light intensity. What the player can see, target, and read in the log is decided only by this layer; the engine's visibility and light-radius rules are unchanged. Unknown cells render empty, remembered cells render dim and desaturated, visible cells scale brightness with `--light`.

**Glow layer (pure decoration).** One absolutely positioned overlay element per active light source — in 5A, the hero's carried light — rendered as a radial gradient centered on the source's cell position and blended over the grid with `mix-blend-mode: screen`. This produces a smooth warm falloff that breathes across cell boundaries instead of stepping per cell. A keyframe animation drives the living-flame feel: a slow scale and opacity drift on a two-to-three-second loop plus a faint low-amplitude flicker. The glow's base intensity and radius are driven by CSS custom properties fed from the engine's light state, so a dying torch visibly gutters as fuel runs down.

Constraints on the glow layer:

- `prefers-reduced-motion` renders it static; the 120 millisecond light transitions from the master design also collapse to immediate state changes.
- It is `aria-hidden` and ignores pointer events; selectable text and accessible markup are preserved.
- It animates only compositor-friendly properties (transform, opacity).
- Tests assert on the cell layer only, so the decorative layer cannot affect determinism.

The hero glyph carries the warm accent and a subtle text-shadow bloom; item glyphs get a faint category-colored shimmer only while visible and lit. The 5D art pass extends this same mechanism to ambient sources (braziers, spell effects) rather than introducing a second system.

## Persistence and error handling

- The session saves after every applied command using `encodeActiveRun` and restores with `decodeActiveRun` — the engine's versioned codec, never a bespoke JSON shape, per the cross-milestone save-format stability rule.
- A corrupt or unsupported stored save falls back to a fresh run with a visible notice; it never crashes the app.
- Storage-unavailable and storage-full produce distinct, actionable messages, as the master design requires; play continues unsaved with a persistent warning.
- The content pack is fetched from `GET /api/content/guest` and validated with `validateCompiledContentPack` before the session starts; fetch failures render a retry screen, and the session never starts on a partial pack.
- Engine command rejections surface as log lines, not dialogs.
- Closing the browser session discards everything, by design; nothing 5A stores outlives `sessionStorage`.

## Testing and exit demonstration

- **Engine (Vitest):** `createNewRun` unit tests (determinism for equal seeds, floor 1 generated, hero placed and equipped, `validateActiveRun` passes, `floorsEntered` recorded) plus a seeded property test folding it into the existing invariant suites.
- **Session (Vitest):** dispatch, persist, and restore round-trips against the real engine and real codec with a fake storage; command-builder table tests; event-log folds; corrupt-save and storage-failure fallbacks.
- **UI (Vitest + Testing Library):** GridRenderer knowledge states and custom properties; panels from fixture snapshots; KeyRouter focus rules; BackpackMenu focus trap.
- **End-to-end (Playwright, `e2e/guest-play.spec.ts`):** a seeded run driven by a scripted keyboard sequence that moves, bump-attacks a monster, picks up and uses an item, rests, and descends to floor 2, asserting rendered cells and log text along the way; a mid-run reload that restores the run; a cleared session that starts fresh. The seed is injected through a test-only query parameter.
- **Exit demonstration:** `npm run guest:e2e` green alongside every existing engine, content, demo, and Docker gate.

## Out of scope for 5A

Character generation and the title screen (5B), run conclusion and the guest Hall of Records (5B), town, town merchants, and house storage (5C), full-screen overlays, settings, help, rebinding, onboarding, and the complete accessibility and art passes (5D). Dungeon travelling merchants exist in the engine but get no trade screen until 5C; encountering one in 5A is survivable through the existing decision projection surfaced as log lines and a minimal choice prompt.
