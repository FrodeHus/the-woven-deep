# Guest Experience Polish (Milestone 5D-2) Design

Approved design for the final sub-milestone of milestone 5 (decomposition in `docs/superpowers/specs/2026-07-15-guest-play-core-design.md`; 5D was split during 5D-1 brainstorming). 5D-2 delivers the polish layer over 5D-1's functional surfaces: the Living Tapestry art pass (world color, smooth lighting, effects, framing, transitions), contextual onboarding, the accessibility pass, and the 5D-1 follow-up riders.

## Decisions

- **No engine schema bumps and no engine behavior changes.** The engine's per-cell illumination and perception remain the gameplay authority; every visual upgrade is presentation-side, derived from projection data the client already receives. Content stays v7, saves stay v8.
- **Visibility-polygon lighting ships in this milestone** (backlog item promoted): a canvas layer renders smooth light; the DOM per-cell path remains complete as `classic` mode and automatic fallback.
- **Onboarding mastery is action-counted and device-persistent** (`localStorage`): each hint retires permanently after its action succeeds its counted number of times, per the master design's "dismiss permanently after demonstrated mastery."
- **The accessibility pass is all three parts**: audit-and-fix sweep, a high-contrast theme, and colorblind-safe reinforcement of color-only meaning.
- **World colorization is the art pass's center** (user direction: the current white/grey world is monotonous) — the master design's palette (mineral blues for structure, gold for the hero and important state, muted red for danger) finally lands on terrain.
- Out of scope: the champion `killerContentId` records-path leak (record semantics — revisit with milestone 6/7 record work), real content display-name/lore fields (future content-schema milestone), server work, tilesets.

## World color: the material palette

- A static material map in the renderer assigns each tile/token a base color family: mineral blue-grey walls, warm-neutral floor stone, brown doors/wood, gold-accented stairs, deep charcoal void; town stone slightly warmer than dungeon stone. Applied as per-cell material classes composed with the existing light pipeline.
- The visible-color floor (never darker than remembered) and remembered-desaturation rules hold **per material**; the styles-contract tests extend to assert the floor relationship for every material color, so palette tuning cannot silently reintroduce the inversion class of bug.
- Monsters, items, and fixtures keep their content-authored colors unchanged. Remembered cells desaturate toward the established grey so memory still reads as memory.

## Smooth lighting: the visibility-polygon canvas

- One `<canvas>` behind the glyph layer, viewport-sized, redrawn on projection or camera change. For each visible light source — fixtures from cells, the carried light at the hero's position — cast rays to wall-corner vertices derived from the projection's wall cells, build the visibility polygon, fill with a radial gradient in the light's color, composite additively, soften the rim for penumbra.
- With the canvas active, the glyph layer's per-cell brightness flattens toward uniform (the canvas carries the falloff look); the engine's per-cell intensity still decides what is lit for gameplay and perception. The polygon geometry is a pure function (walls in → polygon out) with unit tests; rendering quality is verified by eye in a real browser, the established acceptance gate for rendering work.
- Display setting `lighting: 'smooth' | 'classic'` (default smooth); `classic` is the current DOM rendering, kept complete, and the automatic fallback when canvas is unavailable. Reduced motion stops flicker animation but keeps static polygons.
- Determinism untouched: the canvas consumes only projection data; no gameplay-visible state changes.

## Effects vocabulary

Extend the 5A renderer's declarative event-to-effect table (one table, no second system): a distinct ember-bolt streak (warm particle trail), condition auras on afflicted actors (faint tinted pulse plus a glyph badge so the meaning is not color-only), per-fixture-token flicker variation for braziers/lamps, and a subtle shimmer on stairs and the dungeon entrance. Every entry declares its reduced-motion behavior (static or suppressed).

## Ornamental framing and transitions

- Panels and dialogs get the master design's restrained ornamental Unicode frame treatment through shared scaffold/panel CSS — one frame vocabulary, not per-panel art. Title and section headers use the same family.
- Screen transitions: a short fade-through-dark on title→play, descend/ascend, and death→conclusion. CSS-driven; fully suppressed under reduced motion (instant swap), honoring the master design's rule that reduced motion applies new state immediately.

## Contextual onboarding

- A framework-free hint engine in the session layer: a declarative hint list, each entry `{id, copy, trigger (predicate over projection/snapshot), masteryCondition (a counter over dispatched intents/results), priority}`. The first town visit surfaces movement → inspection → inventory → light → commerce → dungeon entry, one hint at a time.
- Presentation: a dismissible strip above the log. It never steals focus, never blocks input, and is keyboard-dismissable. Hint copy renders key names from the resolved keymap, never literals, and matches the game's register.
- Mastery counts and dismissals persist in `localStorage` (`woven-deep.onboarding.v1`, added to the clear-guest-session wipe list). A mastered or manually dismissed hint never returns on this device.
- Disable-all onboarding lives in settings and at the pre-chargen step (master design rule for experienced players). All hint copy is also readable in Help.
- The pinned e2e walks are protected: hints render outside the play grid, and `?quickstart=1` boots with onboarding disabled by default (the quickstart surface is a test seam; the e2e that tests onboarding opts in explicitly).

## Accessibility pass

1. **Audit + fix sweep**: a systematic checklist pass over every screen and overlay — focus order, roles and accessible names, live-region behavior for the log and hero-state announcements, keyboard reachability, reduced-motion completeness — with findings fixed in this milestone and the checklist recorded in the task report.
2. **High-contrast theme**: a settings display option re-deriving the full palette (including the new materials and both lighting modes) at WCAG AA contrast. The theme composes with the material system rather than replacing it. Deliberate AA exceptions in the default dark-fantasy theme are documented rather than silently shipped.
3. **Colorblind-safe cues**: sweep for color-only meaning (threat coloring, condition tints, light color) and reinforce each with a glyph, badge, or pattern.

## 5D-1 riders resolved here

- **Landmarks persistence**: the sighting cache gains a `landmarks` list (`{floorId, kind, name, x, y}`), captured when a merchant, stair, or the house is first perceived — names recorded at sighting time, which resolves the populationPresentation lookup gap host-side. The journal reads it, so merchants met stay listed after they wander out of sight. Host-side session state only.
- **Label humanization**: one shared humanizer module (generalizing 5D-1's `fixtureLabel`) provides display labels for effect ids and fixture tokens, used by the inventory detail pane and Help. Real content display-name fields remain backlogged for a content-schema milestone.

## Error handling

- Canvas initialization failure or absence falls back to `classic` rendering with no notice beyond a log-level breadcrumb — the game is fully playable either way.
- Corrupted onboarding storage resets to a fresh hint state with the standard dismissible notice; a corrupted sighting/landmark blob keeps the established reset-plus-notice behavior.
- All new settings fields ride the existing versioned settings blob with the same forward-tolerant load rules.

## Testing and exit demonstration

- Unit/component: material contract tests (visible-floor relationship per material; high-contrast AA assertions computed from the real CSS); polygon ray-caster unit tests (pure geometry, including single-wall occlusion, corner grazing, and enclosed-room cases); hint-engine table tests (trigger, mastery counting, persistence round-trip, disable-all, corrupted-blob reset); humanizer and landmarks tests (a merchant perceived once persists as a journal landmark).
- Real-browser verification by eye (the rendering acceptance gate): torch corridor and town under smooth lighting, multi-fixture scenes, framing, transitions, the high-contrast theme in both lighting modes.
- E2e: onboarding first-run flow (hints appear in order, mastery retires one, manual dismissal retires another, disable-all clears the strip) with explicit opt-in under quickstart; the lighting-mode toggle; existing specs stay green unchanged.
- Exit demonstration: `npm run guest:e2e` green including the new spec, plus every existing gate (root tests, typecheck, build, content gates, five demos, smoke).

## Out of scope for 5D-2

Server-side anything (milestone 6), the Final Chamber content (milestone 7), tilesets, audio, the champion records-path leak, content-schema display-name fields, and further balance work.
