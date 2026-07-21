# Click-to-cast + Loomcaller — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship a live click-to-cast feature — a client spell-selection UI + targeting mode that casts via the existing engine `cast` command — plus the first playable caster class, the Loomcaller.

**Architecture:** The engine `cast` path already exists (Weave-gated, `validateTarget` range/LoS, effect resolution). This adds: per-hero known spells (baked from class), class-level stat modifiers, a modifiable Weave-regen, a `castableSpells` projection, the client spell UI + targeting state machine, and the Loomcaller content. See `docs/design/click-to-cast.md`.

**Tech Stack:** TS strict; content YAML→Zod (`packages/content`); engine (deterministic, save-schema drift guards); React 19 / Tailwind v4 (`apps/web`); Vitest.

## Global Constraints

- **Determinism-neutral for the demo hero.** The demo/default hero is the non-caster Wayfarer. All engine additions must leave its behavior byte-identical: `weaveRegen` base = the current `weaveRegenAmount` (2); `knownSpellIds`/`castableSpells` empty for non-casters; class `modifiers` absent for existing classes; `startingSpellIds` absent for existing classes. The ONLY expected demo-hash movement is content-hash-embed propagation from adding the Loomcaller/Weaveward/cloth-wrap content (Task 6) — the same benign class as the trait taxonomy (contentHash-derived save/events/record fields only; NO event/projection *behavior* hash may move). A behavior-hash move is a red flag to investigate.
- **`knownSpellIds` is optional in the save-schema, omitted when empty** — non-caster saves serialize byte-identically; migration is a no-op (absent == `[]`).
- **`weaveRegen` is a PLAYER-HIDDEN derived stat** (not shown in the chargen/character UI), like the light-out knobs.
- **Negative modifiers:** `safeNonZeroInteger` already permits negatives; class modifiers use the same `derivedStatModifiers` shape as backgrounds. Confirm (don't re-restrict).
- **Reuse theme tokens; preserve all existing tests, roles/aria/testids, and determinism (drift guards).** DRY/YAGNI/TDD, frequent commits.

## File Structure

- Content schema: `packages/content/src/compiler/schema/character.ts` (class `modifiers` + `startingSpellIds`), `packages/content/src/model/common.ts` (`DERIVED_STAT_NAMES` + `weaveRegen`), class model type.
- Engine: `packages/engine/src/attributes.ts`/derive (weaveRegen), `survival.ts` (use derived regen), `chargen.ts` (`heroFromChoices` bakes knownSpellIds + merges class modifiers), `new-run.ts` (`NewRunHero.knownSpellIds`), `save-schema/*` (optional knownSpellIds + drift guard), gameplay projector (`castableSpells` on HeroView).
- Content: `content/classes/loomcaller.yaml`, `content/items/cloth-wrap.yaml`, `content/items/weave-focus.yaml`; fixture regen under `packages/engine/test/fixtures/`.
- Client: `apps/web/src/session/projection-view.ts` (castableSpells), a new Spells panel, `CommandPalette.tsx`, `session/intents.ts` + `command-builder.ts` (cast intent), a targeting-mode hook/component + `PlayScreen.tsx` wiring, `HeroRecord.tsx` (negative-delta tone).

---

## Task 1: `weaveRegen` as a modifiable derived stat

**Files:** `packages/content/src/model/common.ts` (add to `DERIVED_STAT_NAMES` + hidden set if one exists there), engine derive (`packages/engine/src/attributes.ts` or wherever `deriveActorStats` builds derived stats + reads balance formulas), `packages/engine/src/survival.ts:289`, `content/balance/core-gameplay.yaml` + `packages/engine/src/fixture.ts` (balance), and any DERIVED_STAT drift/label maps. Tests: engine derive + survival tests.

**Interfaces:** Produces a derived `weaveRegen` on the actor's derived stats; `survival.ts` consumes `derived.weaveRegen` instead of `balance.weaveRegenAmount`.

- [ ] Add `weaveRegen` to `DERIVED_STAT_NAMES`. Mark it player-hidden wherever the light-out knobs (`lightOutRevealRadius` etc.) are excluded from player-visible stats (client `PLAYER_HIDDEN_DERIVED_STATS` in `apps/web/src/ui/derived-stats-display.ts` — add it there too so it never shows in chargen/sheet).
- [ ] Give it a base value from balance: reuse `weaveRegenAmount` (2) as the base — `deriveActorStats` sets `weaveRegen` base = `balance.weaveRegenAmount`, plus any `weaveRegen` modifiers. (Follow how `maxWeave`/`maxHealth` read their balance formula + apply modifiers.)
- [ ] `survival.ts:289`: replace `balance.weaveRegenAmount * intervals` with the actor's derived `weaveRegen * intervals` (keep the `safeInteger('weave regen', …)` guard).
- [ ] Tests: a default hero's derived `weaveRegen` == 2 and regen is unchanged (byte-identical to before); an actor with a `+2 weaveRegen` modifier regenerates by 4/interval; clamp to `maxWeave` preserved.
- [ ] Commit.

## Task 2: Class schema — `modifiers` + `startingSpellIds`

**Files:** `packages/content/src/compiler/schema/character.ts` (class entry schema), the class model type (`packages/content/src/model/*` class type), content validation (spell-id resolution). Test: `packages/content/test/`.

- [ ] Add optional `modifiers: derivedStatModifiers` to the class entry schema (same shape backgrounds use; NOT the trait's exactly-one constraint — a class may set several). Confirm `safeNonZeroInteger` permits negatives (it does).
- [ ] Add optional `startingSpellIds: readonly OpaqueId[]` to the class entry schema (default absent). Add a cross-registry validation that each id resolves to a `kind:'spell'` entry (mirror how kit/loot ids are validated).
- [ ] Surface both on the class model type; `modifiers`/`startingSpellIds` are `undefined` when absent (so existing classes are unchanged and don't serialize the fields).
- [ ] Tests: a class with `modifiers` (incl. a negative) + `startingSpellIds` compiles; an unknown spell id fails validation with a clear message; existing classes (no fields) compile unchanged.
- [ ] Commit.

## Task 3: `knownSpellIds` on the hero + save-schema

**Files:** `packages/engine/src/new-run.ts` (`NewRunHero`), `packages/engine/src/chargen.ts` (`heroFromChoices`), `packages/engine/src/save-schema/*` (hero schema + drift guard + version bump if the schema drift guard requires it), migration. Tests: `packages/engine/test/chargen.test.ts` + a save round-trip test.

- [ ] Add `knownSpellIds?: readonly OpaqueId[]` to `NewRunHero` (optional; omitted when empty).
- [ ] `heroFromChoices`: set `knownSpellIds` from `classEntry.startingSpellIds` — omit the field when the class has none (so non-caster heroes carry no field).
- [ ] Save-schema: represent `knownSpellIds` as an OPTIONAL hero field, omitted from serialization when empty/absent; add its drift guard (`_XDrift = Expect<SchemaMatches<…>>`). Migration: a no-op (absent == `[]`); bump the save version only if the schema-match guard forces it, and add the trivial migrator.
- [ ] Tests: `heroFromChoices` bakes `[ember-bolt]` for a caster test-class and omits the field for a non-caster; encode→decode omits `knownSpellIds` when empty (byte-identical save) and round-trips `[spell.x]` when present; a pre-existing (v9) save decodes with `knownSpellIds` treated as empty.
- [ ] Commit.

## Task 4: Merge class `modifiers` in `heroFromChoices`

**Files:** `packages/engine/src/chargen.ts` (`heroFromChoices` `mergeModifiers` call). Test: `chargen.test.ts`.

- [ ] Include `classEntry.modifiers` (when present) in the `mergeModifiers([...])` list alongside background + trait modifiers, so the hero's `statModifiers` reflects the class.
- [ ] Tests: a caster test-class with `{ meleeAccuracy: -3, defense: -2, maxHealth: -6, maxWeave: +4, weaveRegen: +2, search: +2 }` yields those deltas in the hero's `statModifiers`; `deriveActorStats` applies them (reduced melee/defense/health, boosted weave/search/regen); a class with no modifiers is unchanged.
- [ ] Commit.

## Task 5: `castableSpells` on the HeroView projection (engine)

**Files:** the engine gameplay projector (where `HeroView`/`GameplayProjection` is built — find via `HeroView` producer), a `CastableSpellView` type. Tests: projector test.

**Interfaces:** Produces `HeroView.castableSpells: readonly CastableSpellView[]` where `CastableSpellView = { spellId, name, weaveCost, range, targetingId }`.

- [ ] Resolve the hero's `knownSpellIds` against the content spell registry; map each to `{ spellId, name, weaveCost, range, targetingId }`. Empty (or omitted → empty) when the hero has none.
- [ ] Tests: a non-caster projects `castableSpells: []`; a caster (knownSpellIds `[spell.ember-bolt]`) projects one entry with the ember-bolt metadata (name, weaveCost 3, range 6, `targetingId: target.actor`). Confirm this does NOT change any existing projection field.
- [ ] Commit.

## Task 6: Loomcaller class + Weaveward kit + items (content) + fixture regen

**Files:** `content/classes/loomcaller.yaml`, `content/items/cloth-wrap.yaml`, `content/items/weave-focus.yaml`; regen `packages/engine/test/fixtures/{gameplay,merchant,population,run-records,endgame}-demo-hashes.json`.

- [ ] Author `class.loomcaller`: playable, `silhouetteGlyph: "Λ"`, `classTags` including a `loomcaller` tag, `modifiers: { meleeAccuracy: -3, meleeDamageBonus: -1, defense: -2, maxHealth: -6, maxWeave: 4, weaveRegen: 2, search: 2 }` (tunable), `startingSpellIds: [spell.ember-bolt]`, and a `weaveward` kit (equipped: cloth-wrap body + lit pitch-torch; backpack: weave-focus + travel-ration ×2). Provide a short authored `description`/`unlockHint`-free playable entry consistent with the other classes' shape.
- [ ] Author `item.cloth-wrap` (body armor, armor value below leather-armor, cheap) and `item.weave-focus` (an equippable trinket — minimal/no combat stats; flavor + optional tiny `maxWeave`; keep it simple and grounded). Follow the existing item YAML shape.
- [ ] Build content + run the full engine suite; regenerate the content-hash-embed fixtures (the demo generators' existing regenerate mechanism). Confirm ONLY contentHash-derived save-class fields moved (no event/projection behavior hash); engine/dungeon demos unchanged. Eyeball the diff.
- [ ] Tests: the Loomcaller compiles as a playable class with the expected modifiers/kit/spell; `heroFromChoices` for a Loomcaller bakes `knownSpellIds: [spell.ember-bolt]` and the reduced/boosted stats; all 7 demos VERIFY OK.
- [ ] Commit (content + fixtures together).

## Task 7: Client `castableSpells` + HUD Spells panel (gated)

**Files:** `apps/web/src/session/projection-view.ts` (`HeroView.castableSpells`), a new `apps/web/src/ui/panels/SpellsPanel.tsx`, `PlayScreen.tsx` (mount it), panels index. Test: a spells-panel test.

- [ ] Thread `castableSpells` into the client `HeroView` type + mapping.
- [ ] `SpellsPanel`: renders one row per castable spell (name · `{weaveCost} Weave` · `rng {range}`), each disabled when `hero.weave < weaveCost`; clicking an affordable row invokes an `onCast(spellId)` callback (wired to targeting in Task 10). The panel renders NOTHING (returns null) when `castableSpells` is empty. Theme tokens; accessible (buttons with names).
- [ ] Tests: empty `castableSpells` → panel absent from the DOM; a caster fixture → one enabled row when `weave ≥ cost`, disabled when `weave < cost`.
- [ ] Commit.

## Task 8: Command-palette "Cast: {name}" entries (gated)

**Files:** `apps/web/src/ui/CommandPalette.tsx`. Test: command-palette test.

- [ ] Add, for each `castableSpells` entry, a palette action `Cast: {name}` (weave-gated — disabled/hidden when unaffordable) that invokes the same `onCast(spellId)` targeting entry. No entries when `castableSpells` is empty.
- [ ] Tests: no cast entries for a spell-less hero; one `Cast: Ember Bolt` entry for a caster; gated by Weave.
- [ ] Commit.

## Task 9: `cast` intent + command-builder

**Files:** `apps/web/src/session/intents.ts` (`PlayerIntent` union), `apps/web/src/session/command-builder.ts` (`buildIntent`). Test: `apps/web/test/command-builder.test.ts`.

- [ ] Add a `cast` variant to `PlayerIntent`: `{ kind: 'cast'; spellId: string; target: { x: number; y: number } }`.
- [ ] `buildIntent`: map it to the engine `CastCommand` `{ type: 'cast', commandId, expectedRevision, spellId, target }` (cell-based target — matches the engine).
- [ ] Tests: a `cast` intent builds the correct `cast` command with the spellId + target cell.
- [ ] Commit.

## Task 10: Targeting mode (state machine + highlight + input)

**Files:** a new `apps/web/src/ui/hooks/useSpellTargeting.ts` (targeting state + valid-cell computation), a client range/LoS helper mirroring engine `validateTarget` (Chebyshev range + visibility/illumination + Bresenham LoS, reading the projection), a targeting overlay/cursor in the map pane, and `PlayScreen.tsx` wiring (enter on `onCast`, click/keyboard/cancel). Tests: `apps/web/test/` targeting tests.

- [ ] `useSpellTargeting`: holds `{ activeSpellId | null }`; `begin(spellId)` enters targeting; `cancel()` (Escape / right-click) exits; on a valid target confirm, dispatches the `cast` intent (Task 9) then exits.
- [ ] Valid-target computation: given the active spell's `range` + `targetingId` and the projection (visible cells, illumination, tiles for opacity, actors), compute the set of valid target cells (in-range + visible + LoS to a hostile actor for `target.actor`; the caster's cell for `target.self`). Keep this in a pure, tested helper mirroring `packages/engine/test/targeting.test.ts` cases. Structure the return so an affected-area set can be added later (single cell now).
- [ ] Highlighting: in targeting mode, render valid target cells highlighted (▓ tone) and dim invalid in-view cells (░); highlight the currently-hovered/reticled target cell distinctly. Reuse the existing cell-cursor/overlay layer where possible.
- [ ] Input: clicking a valid target casts (route the map-pane click through targeting mode when active, BEFORE the auto-travel handler); a keyboard reticle (arrows move among valid targets, Enter casts); Escape / right-click cancels. When NOT in targeting mode, click behaves exactly as today (auto-travel).
- [ ] Tests: begin→valid-cell set matches engine rules on representative layouts (in-range/out-of-range/blocked/not-visible); clicking a valid target dispatches a `cast` intent for the right spell+cell; clicking an invalid cell does not cast; Escape and right-click cancel without casting; auto-travel is unaffected when targeting is inactive.
- [ ] Commit.

## Task 11: Chargen negative-delta display tone

**Files:** `apps/web/src/ui/screens/chargen/HeroRecord.tsx` (the derived-delta rendering). Test: `HeroRecord.test.tsx`.

- [ ] Where derived-stat deltas render (`heroModifierDeltas`), show negative deltas in a warn/danger tone (and the `-N` sign) rather than the positive "good" green; positives stay green. This makes the Loomcaller's negative class modifiers read correctly in the preview.
- [ ] Tests: a modifier set with a negative delta renders `-N` in the warn/danger class; a positive renders `+N` in good.
- [ ] Commit.

## Task 12: Whole-surface verification

- [ ] `npm run verify` exit 0 (typecheck, lint, format:check, depcruise, knip, all suites).
- [ ] All 7 demo replays VERIFY OK; confirm only contentHash-derived fixture fields moved (Task 6) — no behavior-hash movement.
- [ ] Format fixups if any; commit.

## Self-review

- Coverage: known-spells plumbing (T1–T5), Loomcaller content (T6), client spell UI (T7–T8), cast intent (T9), targeting (T10), chargen polish (T11), gate (T12). Matches the design + the user's decisions (Loomcaller live, all three extras, valid+targeted highlight, gated UI).
- Determinism: only Task 6 moves hashes (content-hash-embed); every engine change is behavior-neutral for the demo hero — verify explicitly in T6/T12.
- Type consistency: `CastableSpellView` (T5) is consumed identically in the client (T7/T8); the `cast` `PlayerIntent`/`CastCommand` shapes (T9) match the engine's existing `CastCommand`.
