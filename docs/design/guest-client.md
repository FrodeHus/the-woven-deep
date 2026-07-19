# Guest Client: Play, Chargen, Town, and the Full Interface

**Status:** Shipped (milestone 5, all five sub-milestones: 5A guest play core, 5B chargen
and run lifecycle, 5C town slice, 5D-1 guest interface, 5D-2 experience polish)

**Package:** `apps/web`

Milestone 5 ("guest game and complete player interface") was too large for one spec, so it
shipped as five independently reviewable sub-milestones, each with its own exit
demonstration gate (`npm run guest:e2e`, cumulatively green across all specs by the end).
This doc covers the whole arc: a player can create a hero, play a full session with no
account, prepare in town, and reach every screen entirely by keyboard. Server-authoritative
profile play is a separate, later layer — see `identity-and-persistence.md`.

## Architecture: three layers, one-way flow

```
keyboard event
  → KeyRouter            (key + focus context → intent, or ignored)
  → GuestSession.dispatch(intent)
      → command-builder  (intent + projection → engine command)
      → resolveCommand   (engine)
      → projectGameplayState → snapshot
      → encodeActiveRun  → sessionStorage
  → store notifies subscribers
  → React re-renders from the snapshot
```

The engine owns rules, the framework-free session layer (`apps/web/src/session/`) owns
orchestration, React (`apps/web/src/ui/`) owns presentation only. The session core has no
React import; `sessionStorage` is reached through a two-method storage interface so tests
inject a fake. The client deliberately stayed dependency-free through 5A–5D (revisited
only for the later UI redesign — see `ui-redesign.md`): the guest surface is a fetch-once
immutable content pack, a linear screen flow, and a handful of forms, so a hand-rolled
`useSyncExternalStore` binding plus a pure wizard reducer covered it without pulling in a
router or form library.

Two production engine entry points anchor everything: `createNewRun(input)` (derives RNG
streams from a seed, generates floor 1 — later town at depth 0 — places the hero,
resolves starting equipment, returns a valid `ActiveRun`) and `descendToNextFloor(run)` /
`ascendToPreviousFloor(run)` (floor transitions live in the engine, not the browser,
specifically so the state surgery of allocating a seed, generating a floor, and
integrating it stays inside the deterministic boundary).

## 5A — guest play core

The first playable slice: a fixed default hero (`DEFAULT_GUEST_HERO`, later replaced by
real chargen in 5B) descends into a real engine run, rendered as ASCII in a DOM grid with
an animated light layer, driven entirely by keyboard, persisted in `sessionStorage` for
the browser session's lifetime.

**Rendering: cell truth vs. decoration.** Two layers over the same grid with a strict
split. The **cell layer** carries gameplay truth: glyph, engine-computed knowledge state,
and light intensity as CSS custom properties — nothing here changes what a test can
assert on. The **effects layer** is pure decoration, `aria-hidden`, ignores pointer
events, animates only compositor-friendly properties, and is capped (oldest dropped
first) so event bursts can't accumulate unbounded DOM nodes: a radial-gradient glow per
active light source (flicker profile keyed by light-source content identity, so a torch
gutters differently than a lantern), and short-lived transient effects (hit flash, attack-
line streak, death burst) spawned from one declarative event-to-effect table that later
milestones extend rather than duplicate. Every effect corresponds to a logged, cell-
visible event — nothing is playable by effects alone, and nothing is lost with effects
reduced. `prefers-reduced-motion` makes glows static and transient effects an immediate
single-frame change.

**Layout — the Tactical Triptych**, responsive: the map pane always keeps primacy and
grows with the window (bounded by floor size); a `ResizeObserver`-driven camera shows a
scrolling viewport with a deadzone margin equal to the hero's sight radius (clamped per
axis under half the viewport), which guarantees nothing outside the rendered viewport can
ever attack the hero. Space is surrendered in a fixed order as the window shrinks — threat
panel to a hover popover / keyboard drawer first, then hero panel to a slim vitals strip,
then the log to a three-line minimum that never fully disappears (it's the textual-
equivalents channel for accessibility).

**Persistence**: the session saves via `encodeActiveRun` after every applied command and
restores via `decodeActiveRun` — the engine's own versioned codec, never a bespoke JSON
shape. A corrupt or unsupported save falls back to a fresh run with a visible notice, never
a crash; storage-unavailable and storage-full get distinct actionable messages. Closing the
browser session discards everything, by design.

## 5B — character generation and run lifecycle

The seven-step wizard (name/portrait → attribute method → attributes → class → background/
traits → equipment → confirm, per the master design's ordering — later reordered by the UI
redesign, see `ui-redesign.md`), the title screen, run conclusion, and the guest Hall of
Records.

Classes/backgrounds/traits are mechanically real but modest: classes grant starting-kit
choices and identity tags; backgrounds grant one derived-stat modifier plus optional extra
starting items; traits grant one derived-stat modifier each, 0–2 picked. Everything routes
through the existing `deriveActorStats` modifier pipeline — no flat attribute bonuses (per
the master design) and no new combat mechanics. Two classes ship playable (Wayfarer,
Lamplighter); two more (Archivist, Warden) are authored as **locked** entries — visible as
silhouettes with names and unlock hints, unselectable — matching the master design's rule
for locked content, with the unlock gating itself still dormant pending achievement wiring.

Chargen randomness is deterministic from a chargen seed generated client-side
(`crypto.getRandomValues`, or `?seed=` in tests); 3d6 rolls draw from the engine's existing
`deriveSeed`/`rollDie` primitives on that seed, no new RNG stream, and the same seed
becomes the run seed at confirmation — so a rolled character is fully reproducible from
its seed, and the one permitted full reroll simply consumes the next draws in the same
sequence.

**Run conclusion**: when the session snapshot carries a non-null conclusion, the client
finalizes exactly once (`finalizeRun` against the repository's lifetime state, then
`appendRecord` + `applyDeltas`), then renders cause of death, a final-moments recap, the
itemized score table, notable metrics, heirloom, and achievement grants, with an explicit
"Recorded in the Hall — unverified, this session only" notice. The **guest Hall** is a
`sessionStorage`-backed `RunRecordRepository` implementation behind the same interface
`run-records.md` defines, records enriched with the portrait glyph (deliberately **not**
part of engine `NewRunHero` — host enrichment only) and a session-relative "Run #N" marker
(no wall-clock dates enter engine data at all).

## 5C — town slice

Town is floor **0**, generated once by `createNewRun` and never regenerated; depth 1 isn't
generated until the first descent. It's built from a `vault` entry tagged `town` through a
dedicated `generateTownFloor` assembly path (not vault-in-floor placement — see
`dungeon-generation-and-light.md`), fully lit, placing the dungeon entrance, house door,
and three merchant slots.

**Bidirectional traversal without return-journey pressure**: ascending re-enters the exact
stored floor snapshot all the way back to town — no regeneration, defeated enemies stay
dead, per the master design's general "visited floors are never regenerated" rule. The
reinforcement checks and artifact-driven hazards the master design originally attached to
a Heart *return* journey are deferred to the future endings milestone, where that
mechanic — if it survives the Heart-as-person redesign in `run-records.md` — would
actually apply.

**Town is safe ground, mechanically**: on depth 0 the world step advances `turn` and
`revision` but **not** `worldTime` — which is the single mechanism implementing both "town
consumes no hunger/light" and "town actions don't advance dungeon actors" (frozen
`worldTime` means hunger, fuel, condition timers, and dungeon merchant departure clocks
literally cannot move while in town, and dungeon floors are inactive while town is active
exactly like any other inactive floor). Attack/fire/cast/throw are rejected on the town
floor with the closed reason `town.truce` (no hostiles exist there, so this doesn't
conflict with the death-depth ≥ 1 invariants elsewhere); rest is rejected too, since with
frozen time there's nothing to recover. Attackable town NPCs are deliberately deferred.

**Town merchants extend the existing merchant machinery rather than forking it**: three
real `MerchantPopulation`s (provisioner, arms dealer, curios dealer) at fixed authored
positions, using a new content-level `permanent: true` flag that skips the whole
departure lifecycle, plus a new `restockMerchant` operation that re-rolls stock from the
loot table (preserving reputation, services, identity) whenever `metrics.deepestDepth`
first crosses a content-defined milestone (bundled: 5, 10, 15, 20 — the same milestone
floors the master design calls out). The entire `trade.ts` command set, pricing, and
reputation model from `populations-and-npcs.md` apply unchanged; town prices are simply
the favorable reference tier travelling merchants price against.

**The house**: fixed content-defined capacity (bundled 6 stacks) plus exactly one
purchasable capacity upgrade (+4, bundled, sold as a provisioner service) — one concrete
exercise of the master design's "capacity can grow through purchases" rule. All house
contents and upgrades disappear on death or victory, same as everything else run-scoped.

## 5D-1 — the full overlay interface

Inventory, character sheet, map/journal, unlock codex, settings, help, all as full-screen
overlays managed by a single `overlay: OverlayId | null` field (no stack — nothing in this
milestone needs nested overlays). **No engine schema bump anywhere in this slice** — a
deliberate constraint: codex discovery, for instance, can't be pure record derivation
because neither `HallRecord` nor `ActiveRun` records which monsters were fought or spells
seen (only killer IDs, equipped-item IDs, and numeric metrics), so discovery instead
combines what records/the active run genuinely carry with a host-side, session-only
**sighting cache** the session already accumulates from projections it receives (perceived
actor IDs, identified item IDs) — one pure `deriveCodexState` function, never an engine
addition. A category with no discovery source yet (spells, pending cast-tracking) renders
fully undiscovered rather than inventing one.

Settings cover font scale, reduced motion, full per-action key rebinding (press-to-rebind,
conflict detection, reset-to-defaults, `localStorage`), and clear-guest-session. Inventory
browsing is free; equip/unequip/use/drop dispatch the same engine commands and cost turns
exactly as those commands already define — the overlay never invents new engine behavior
(stack splitting and quick slots are explicitly out, noted in `future.md`).

## 5D-2 — experience polish

The polish layer, entirely presentation-side: **no engine schema bumps, no engine
behavior changes** anywhere in this slice. World colorization lands the master design's
palette (mineral blues for structure, gold for the hero, muted red for danger) on terrain
via a static per-tile material map, composed with the existing light pipeline; a
promoted-from-backlog visibility-polygon canvas renders smooth per-source lighting behind
the glyph layer (a `lighting: 'smooth' | 'classic'` setting, `classic` kept complete as
the automatic fallback when canvas is unavailable) while the engine's per-cell intensity
still decides what's lit for actual gameplay and perception — the canvas is a pure
function of projection data, so determinism is untouched. Ornamental panel framing, short
fade-through-dark transitions (fully suppressed under reduced motion), a declarative
framework-free onboarding hint engine (action-counted mastery, `localStorage`-persistent,
disable-all in settings and pre-chargen per the master design's rule for experienced
players), and a three-part accessibility pass (audit-and-fix sweep, a WCAG AA high-
contrast theme, colorblind-safe reinforcement of every color-only meaning with a glyph or
pattern) round out the milestone.

## Testing discipline across all five slices

Every slice landed behind its own Playwright e2e spec (`guest-play`, `run-lifecycle`,
`town-loop`, `interface`, `polish`), and each new spec was required to keep every prior
spec green and unmodified except for structural re-basing (e.g. town-loop required
prepending a descend step to the 5A pinned walk once runs started in town). The full
`npm run guest:e2e` gate — all specs, run green twice consecutively — plus root tests,
typecheck, build, content validation, all deterministic demos, and Docker smoke, is the
standing bar for every guest-client change.
