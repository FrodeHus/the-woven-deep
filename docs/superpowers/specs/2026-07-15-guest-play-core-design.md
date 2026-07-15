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

5A adds two production engine entry points. (Amended during planning: the engine has no descend command — floor transition is a host-driven `allocateFloorSeed` → `generateFloor` → `integrateGeneratedFloor` sequence, and performing that state surgery in the browser would move rules out of the engine. A second helper keeps the transition inside the engine boundary.)

- `descendToNextFloor(run, { content }): { state; events }` — validates the hero stands on the active floor's stair-down tile and the run is unconcluded, allocates the next floor seed, generates the next-depth floor through the existing pipeline, moves the hero to its stair-up, and integrates it through `integrateGeneratedFloor` (which records the floor entry and re-validates). Deterministic, browser-safe, engine-tested.

And the run constructor:

- `createNewRun(input: { pack: CompiledContentPack; seed: Uint32State; hero: NewRunHero }): ActiveRun` — derives the RNG streams from the seed, procedurally generates floor 1 through the existing generation pipeline, places the hero at the entry, resolves the hero's starting equipment from content, records the initial floor entry (so `floorsEntered >= 1` holds), and returns a valid schema-v6 `ActiveRun` that passes `validateActiveRun`.
- `NewRunHero` carries name, attribute block, and starting-equipment content IDs. `DEFAULT_GUEST_HERO` is the exported fixed Wayfarer 5A uses: 10 in each of the five attributes (Might, Agility, Vitality, Wits, Resolve) and a fixed starting loadout of bundled item IDs (iron sword and leather armor equipped, a lit pitch torch, travel rations in the backpack). No class content kind exists yet — class entries arrive with later milestones — so the loadout is data on `NewRunHero`, which is exactly the field 5B's character generation will populate from its equipment step.
- Browser-safe, deterministic, clock-free, covered by engine unit and property tests like every other engine module. Milestone 5B replaces only the `hero` argument, not the constructor.

### Guest session layer (`apps/web/src/session/`)

Framework-free TypeScript. No React imports; `sessionStorage` is reached through a two-method storage interface so tests inject a fake.

- `guest-session.ts` — owns the `ActiveRun` and the content pack. Boot order: fetch and validate the pack, try `decodeActiveRun` on the stored save, fall back to `createNewRun` with a fresh seed. Exposes `dispatch(intent)`, `subscribe(listener)`, and `getSnapshot()` returning `{ projection, log, status }`. Every applied command re-projects and persists.
- `command-builder.ts` — pure function from intent plus current projection to an engine command or a client-side rejection (for example, descend is only built when the hero stands on stairs). Rejections become log lines and never reach the engine.
- `event-log.ts` — pure fold of hero-visible domain events into log lines in a capped ring buffer. This is also where the accessibility requirement for textual equivalents of visual events (a light going out, a creature entering sight) is satisfied.
- `store.ts` — the roughly thirty-line `useSyncExternalStore` binding React consumes.

### React shell (`apps/web/src/ui/`)

The Tactical Triptych per the master design: the map is the primary center region and never yields primacy; side panels collapse into keyboard-accessible drawers at narrow widths.

- `GridRenderer` — DOM cells (a CSS grid of spans), one per map cell inside the current viewport: glyph, `--fg`, `--bg`, `--light` custom properties, and the knowledge state (`visible`, `remembered`, `unknown`) as a class. No game logic.
- Camera: the renderer shows a viewport window into the floor so maps larger than the pane render correctly. A pure `computeCamera` function owns the rule: the camera origin stays put while the hero moves inside a deadzone margin and scrolls just enough to restore the margin when the hero nears a viewport edge, clamped to the floor bounds (no void beyond the map is ever shown unless the floor is smaller than the viewport, which centers it). The margin equals the hero's sight radius, clamped per axis to just under half the viewport — this guarantees every engine-visible actor is on screen (nothing can attack the hero from beyond the viewport edge); on axes where the sight diameter approaches the viewport size this degrades gracefully toward center-lock. Cells keep world coordinates in their `data-cell` attributes so tests and the effects layer are viewport-independent; the effects layer stores effects in world coordinates and derives screen positions from the current camera each render, so a scroll mid-animation cannot strand an effect on the wrong cell, and clears transient effects on floor change.
- `HeroPanel` (left): health, resources, equipped gear, compact backpack. `ThreatPanel` (right): nearby actors with intent and health band, ground items, depth context. `LogPanel` (bottom): the event log plus context-sensitive control hints. `StatusBar` (top): location, hero identity, turn count. All pure functions of the snapshot.
- `BackpackMenu` — the survival-set item menu. Focus-trapped list; equip, use, drop; Escape closes; movement keys are blocked while it is open.
- `KeyRouter` — one keydown listener at the app root consulting a static keymap table (arrows, numpad, and vi keys for the eight directions; `.` wait; `R` rest; `g` pick up; `>` descend; `i` backpack). Rebinding arrives in 5D. Per the master design's input-routing rule, movement commands are blocked while any overlay, form field, or dialog has focus, and visible focus styling is never removed.

## Rendering: ASCII with a modern effects layer

The playfield stays old-school ASCII; everything modern lives in a decorative effects layer above it. Two layers over the same grid with a strict truth/decoration split.

**Cell layer (gameplay truth).** Each cell keeps its glyph and the engine-computed knowledge state and light intensity. What the player can see, target, and read in the log is decided only by this layer; the engine's visibility and light-radius rules are unchanged. Unknown cells render empty, remembered cells render dim and desaturated, visible cells scale brightness with `--light`.

**Effects layer (pure decoration).** One overlay pane above the grid hosting two kinds of effect, both positioned in cell coordinates and rendered as absolutely positioned DOM elements:

- *Persistent light sources.* One radial-gradient glow per active light source — in 5A, the hero's carried light — blended over the grid with `mix-blend-mode: screen`, producing a smooth warm falloff that breathes across cell boundaries instead of stepping per cell. The animation mimics the physical source: a torch flickers with a low-amplitude irregular gutter on top of a slow two-to-three-second drift, while a steadier source (a lantern) barely wavers. Base intensity and radius are CSS custom properties fed from the engine's light and fuel state, so a dying torch visibly gutters as fuel runs down, and the flicker profile is keyed by the light source's content identity so new source types get their own character in content-adjacent CSS rather than new code.
- *Transient event effects.* Short-lived elements spawned from hero-visible domain events and removed when their animation ends: a hit flash on the struck cell for melee damage, a brief streak along the attack line for ranged and spell attacks (the ember-bolt and dart-trap events in the bundled content), and a fading burst on a death. The event-to-effect mapping is one declarative table in the renderer; 5D's art pass extends the vocabulary (ambient braziers, richer spell signatures, condition auras) through that same table rather than a second system.

Constraints on the effects layer:

- `prefers-reduced-motion` renders glows static and replaces transient effects with an immediate, single-frame state change; the 120 millisecond light transitions from the master design also collapse to immediate.
- Effects never carry information the cell layer and log do not: every effect corresponds to a logged, cell-visible event, so nothing is playable-by-effects-only and nothing is lost with effects reduced.
- The layer is `aria-hidden` and ignores pointer events; selectable text and accessible markup are preserved.
- It animates only compositor-friendly properties (transform, opacity, filter).
- Tests assert on the cell layer and log only, so the decorative layer cannot affect determinism; transient effects are additionally capped (oldest dropped first) so event bursts cannot accumulate unbounded DOM nodes.

The hero glyph carries the warm accent and a subtle text-shadow bloom; item glyphs get a faint category-colored shimmer only while visible and lit.

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
- **UI (Vitest + Testing Library):** GridRenderer knowledge states and custom properties; panels from fixture snapshots; KeyRouter focus rules; BackpackMenu focus trap; the event-to-effect mapping table (each mapped event spawns the declared effect and unmapped events spawn nothing), with the animations themselves left to visual review.
- **End-to-end (Playwright, `e2e/guest-play.spec.ts`):** a seeded run driven by a scripted keyboard sequence that moves, bump-attacks a monster, picks up and uses an item, rests, and descends to floor 2, asserting rendered cells and log text along the way; a mid-run reload that restores the run; a cleared session that starts fresh. The seed is injected through a test-only query parameter.
- **Exit demonstration:** `npm run guest:e2e` green alongside every existing engine, content, demo, and Docker gate.

## Out of scope for 5A

Character generation and the title screen (5B), run conclusion and the guest Hall of Records (5B), town, town merchants, and house storage (5C), full-screen overlays, settings, help, rebinding, onboarding, and the complete accessibility and art passes (5D). Dungeon travelling merchants exist in the engine but get no trade screen until 5C; encountering one in 5A is survivable through the existing decision projection surfaced as log lines and a minimal choice prompt.
