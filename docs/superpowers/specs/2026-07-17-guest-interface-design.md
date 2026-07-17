# Guest Interface (Milestone 5D-1) Design

Approved design for the fourth sub-milestone of milestone 5 (decomposition in `docs/superpowers/specs/2026-07-15-guest-play-core-design.md`, which scoped 5D as the full interface). 5D was split during brainstorming: **5D-1** (this spec) delivers the functional surfaces — inventory, character sheet, map/journal, unlock codex, settings, help, and the identify target picker carried over from 5C. **5D-2** (its own later spec) delivers contextual onboarding, the accessibility pass, the Living Tapestry art pass, and optionally the visibility-polygon lighting upgrade from the backlog.

## Decisions

- **No engine schema bumps.** The codex derives from existing run records and the active run; settings are host-side device preference, never engine truth. Content stays v7, saves stay v8. Any task that finds itself needing an engine schema change reports BLOCKED rather than bumping.
- **Codex discovery derives from session data.** (Amended 2026-07-17 during planning: neither `HallRecord` nor `ActiveRun` records the content ids of monsters fought or spells seen — records carry only the killer's id, equipped-item ids, and numeric metrics — so pure record derivation cannot exist without the engine bump this spec forbids.) Discovery therefore has two host-side sources, both session-only: (1) what records and the active run genuinely carry (record killers, equipped/build item ids, identified items via `knownAppearanceIds`, the active hero's class), and (2) a **sighting cache** the session accumulates from projections it already receives — perceived actor content ids and identified item ids — stored in `sessionStorage` beside the portrait-glyph enrichment, never engine state. One pure `deriveCodexState({ records, snapshot?, sightings, pack })` combines them. A category whose discovery sources don't exist yet (spells have no cast-tracking until class abilities land) renders fully undiscovered rather than inventing a source. A first-class cross-session discovery ledger is milestone 6 profile work.
- **Full per-action key rebinding**, not preset layouts: every action listed in settings, press-to-rebind, conflict detection, reset-to-defaults, stored in `localStorage`.
- **Guest-relevant settings set**: font scale, reduced motion, key bindings, clear-guest-session. Audio (none exists), export, and account actions are out of scope until milestone 6.
- **One overlay at a time.** A single `overlay: OverlayId | null` field, not a stack. Nothing in 5D-1 needs nested overlays; the codex uses list+detail panes inside one overlay.

## Overlay architecture

- App screen state gains `overlay: OverlayId | null` with a static registry mapping each id to component, title, default open key, and scope:
  - `play` scope (needs a live run, rendered over the play surface): `inventory`, `character-sheet`, `map-journal`.
  - `global` scope (also reachable from the title screen): `codex`, `settings`, `help`.
- A shared `OverlayScaffold` component owns the conventions today's dialogs repeat by hand: `useDialogFocusTrap`, `role="dialog"`, titled frame, Esc-close with `stopPropagation` (the 5C Task 7b single-close pattern), and `useListNavigation` roving lists.
- KeyRouter's `overlayOpen` gate and PlayScreen's render both read the single overlay field. Overlay exclusivity is structural: trade and house remain projection/state-driven as shipped and continue to block the router the same way; opening a registry overlay while trading is impossible.
- TradeScreen and HouseScreen keep their wiring and adopt the scaffold only where the change is free; they are not rebuilt.

## Inventory

- Full overlay on the backpack key (default `i`), superseding the minimal 5A BackpackMenu binding. Whether BackpackMenu survives as a separate quick menu or is absorbed by the overlay is decided in the plan by what existing tests anchor to — the overlay is the canonical surface either way.
- One list of backpack stacks plus equipped items, with category filter and name sort (value/weight sorts only if the content model already carries those fields — no new content fields). Detail pane: full properties, identification state, and lore text from the content pack.
- Browsing is free. Equip, unequip, use, and drop dispatch the existing engine commands through the normal command path and consume turns exactly as those commands already define; the overlay stays open and re-renders from the projection (master design rule: browsing free, dungeon actions cost).
- Stack splitting and quick slots are explicitly out: the engine has no such commands, and 5D-1 invents no engine behavior. Noted in the backlog.

## Character sheet

Read-only overlay rendering from the projection and the same `deriveActorStats` selectors the chargen preview uses: base attributes, derived stats, active conditions with remaining durations, resistances, hunger reserve, light radius, and current-run metrics. No commands, no new projection fields unless a listed stat is genuinely absent from the projection — any projection addition follows the established hidden-state discipline and hash re-pin fingerprint (projection-only delta, inspected before re-pinning).

## Map and journal

Two tabs in one overlay:

- **Map**: the active floor's explored knowledge rendered read-only at a fixed small cell size — remembered vs visible distinction preserved, entities drawn only where currently visible, stairs and the hero marked. No camera coupling; the full floor scrolls within the overlay if larger than the pane.
- **Journal**: the objective line, the retained log history (the session already keeps it), and known landmarks derived from existing state — stairs seen in knowledge, merchants met (perceived populations), the house. No new engine state.

## Unlock codex

- Categories: classes, items, spells, monsters. Entries the session has discovered render fully; undiscovered entries render as silhouettes with hidden names (`???`), matching the locked-class convention from chargen. Undiscovered entry ids never reach the DOM (no spoilers in markup).
- Detail pane shows the content entry's lore/description and where it was first seen this session (run number) when derivable from records.
- Marked session-only for guests, same phrasing family as the Hall's unverified marker.

## Settings

- Persisted in `localStorage` under one versioned key (`woven-deep.settings.v1`); the active-run save remains in `sessionStorage`. Corrupted blob → defaults plus the 5A persistent-notice pattern, never a crash.
- **Font scale**: a bounded multiplier on the app root font size. The 5C zoom pipeline already measures real `ch`/`lh` via the probe, so the playfield, popover math, and camera follow automatically; a contract test pins that the probe re-measures on scale change.
- **Reduced motion**: defaults from `prefers-reduced-motion`, overridable in settings; applied as a root class that disables the glow pulse and transient event effects in CSS. The master design's rule (lighting transitions apply immediately in reduced motion) binds here.
- **Key bindings**: KeyRouter's static table becomes `resolveKeymap(defaults, overrides)`. Settings lists every action (movement, wait, rest, pick up, descend/ascend, backpack/inventory, house, trade, overlay keys), press-to-rebind capturing the next keydown, conflict detection against the resolved map (conflicts unrepresentable — the editor refuses and says which action holds the key), per-action and global reset. Shift-modified bindings and `<`/`>` are rebindable like everything else. Help and hint text render from the resolved map, never from literals.
- **Clear guest session**: typed confirmation ("clear"), wipes the run save, Hall records, settings, and command counter, then returns to the title screen.

## Help and controls

One overlay generated from the same action table the keymap resolves: current key per action (live after rebinding), the glyph legend from content presentation data, and short mechanics notes (hunger, light, identification, the town truce). No hand-maintained key list that can drift.

## Identify target picker (5C rider)

In TradeScreen, selecting the identify service opens a target list of the service's eligible `targetItemIds` (names and glyphs from the projection) instead of silently targeting the first. Enter dispatches the existing `trade-service` command with the chosen `targetItemId`; Esc backs out to the service list. Engine untouched.

## Error handling

- Corrupted settings storage falls back to defaults with a visible notice (5A pattern); a failed settings write warns and continues.
- Binding conflicts are unrepresentable through the editor; a stored override that conflicts after a version change resolves by dropping the override with a notice.
- Play-scoped overlays close structurally when no live run exists (run concluded while open → the overlay unmounts with the play surface; no stale-projection rendering).
- Overlays render pure from projection/content; a rendering error in one overlay must not take down the play surface (component error boundary around the overlay host, surfacing the 5B client-bug error pattern).

## Testing and exit demonstration

- Component tests per overlay against real projections (`compileContentDirectory`/`createNewRun`/`resolveCommand`/`projectGameplayState`), keyboard-only paths throughout.
- Keymap: resolution and conflict table tests; help renders from the resolved map.
- Settings: persistence round-trip, corrupted-blob fallback, font-scale probe re-measure contract, reduced-motion class contract.
- Codex: derivation property tests — a record's monster kill implies discovery; undiscovered ids absent from rendered markup; discovery monotone across records.
- E2e: mid-run keyboard-only open/close of every overlay; rebind a movement key and walk with the new key; change font scale and complete a walk (camera/probe consistency); identify a real unidentified item through the picker; clear-guest-session returns to a fresh title. Existing specs stay green (the `i` binding is the known re-anchor risk).
- Exit demonstration: `npm run guest:e2e` green including the new specs, all existing gates green.

## Out of scope for 5D-1

Contextual onboarding, the accessibility audit pass, the Living Tapestry art pass, and visibility-polygon lighting (5D-2); audio, progress export, account actions, cross-session codex/profiles (milestone 6); stack splitting, quick slots, and monster drop loot (backlog); the admin dashboard (milestone 8 per the roadmap).
