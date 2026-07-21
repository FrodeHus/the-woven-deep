# Click-to-cast + the Loomcaller caster class

A client feature to select a known spell and cast it at a target via the existing engine
`cast` command (Weave-gated), shipped **live** with a new playable pure-caster class so it is
usable in normal play. The engine side of casting already exists (`CastCommand{spellId,
target: Point|null}`, Weave gate, `validateTarget` range/LoS, effect resolution). This builds:
the per-hero known-spells concept, the client spell-selection UI + targeting mode, and the
**Loomcaller** class.

## Decisions (from the user)

- **Per-hero spells, gated UI.** The spell UI (HUD panel + palette entries) appears ONLY when
  the hero has spells — non-caster classes show nothing. Sourced from the hero's class.
- **A playable pure-caster class, "Loomcaller" (Λ)** — a glass cannon: bad at melee, low
  physical defense, fragile, but a deep Weave well and a ranged bolt. Makes click-to-cast live.
- **Targeting:** highlight valid targets (in-range + visible + line-of-sight) and highlight the
  specifically-targeted cell (the creature). Structure the highlight to support an affected
  **area** for future AoE spells; single-cell today (no AoE in engine/content yet).

## The Loomcaller class (`class.loomcaller`)

Playable, `silhouetteGlyph: "Λ"`, its own `classTags`. A glass-cannon caster:

- **Melee disadvantage:** negative `meleeAccuracy` + `meleeDamageBonus` class modifiers.
- **Low physical defense:** negative `defense`.
- **Fragile:** negative `maxHealth`.
- **Weave boost:** positive `maxWeave` (the "wits/weave" edge — expressed as +maxWeave since
  class modifiers target derived stats, not the point-buy attributes).
- **Faster Weave regen:** a positive `weaveRegen` modifier (see below) — sustains casting.
- **Weave-sight:** positive `search` — senses hidden things through the Weave.
- **Casts:** `startingSpellIds: [spell.ember-bolt]`. Its range-6 bolt is the compensating
  strength — it fights at range while martial classes close in.
- **Weaveward kit** (its dedicated starting kit): a light loadout reinforcing the frailty — a
  low-armor cloth wrap (new item, armor below leather), a weave-focus trinket (flavor/equip),
  a lit pitch torch (still needs light), travel rations. Plus a second martial-lite kit is NOT
  added; the class ships with the Weaveward kit (and optionally one alt) so a Loomcaller is a
  caster by construction.

Exact modifier magnitudes are tuning values chosen in the plan (e.g. meleeAccuracy −3,
meleeDamageBonus −1, defense −2, maxHealth −6, maxWeave +4, weaveRegen +2, search +2) — the
plan pins the exact numbers; they are balance-tunable.

## New engine capabilities this requires

1. **Class-level stat modifiers.** Classes gain an optional `modifiers` field (same shape
   backgrounds use), merged into the hero's `statModifiers` in `heroFromChoices` alongside
   background/trait modifiers. **Negative values must be allowed** (the modifier schema
   currently only sees positive background/trait values — confirm/extend it to accept
   negatives; the merge + `deriveActorStats` arithmetic already handles any integer).
2. **Modifiable Weave regen.** Today `weaveRegenAmount` is a global balance constant used in
   `survival.ts`. Make it a **derived stat** `weaveRegen` (base value = the current constant,
   so non-casters are unchanged) added to `DERIVED_STAT_NAMES` and PLAYER-HIDDEN (not shown in
   the UI, like the light-out knobs); `survival.ts` regenerates by the actor's derived
   `weaveRegen`. The Loomcaller's `+weaveRegen` modifier then works through the normal modifier
   path, and future items/feats can boost it too. Base equals today's value ⇒ demo hero
   (non-caster) behavior is byte-identical.
3. **Per-hero known spells.** New **optional** `startingSpellIds` on the class entry (validated
   to resolve to `kind:'spell'`; omitted when empty). `heroFromChoices` bakes `knownSpellIds`
   onto `NewRunHero` from `classEntry.startingSpellIds`, exactly like `classTags`/
   `statModifiers`. This is the forward-compatible model the **future magic milestone** extends
   (learning from scrolls appends to `knownSpellIds`). Save-schema: `knownSpellIds` is an
   optional hero field, **omitted when empty** — non-caster saves are byte-identical; migration
   is a no-op (absent == `[]`).

## Projection

Add `castableSpells: readonly CastableSpellView[]` to `HeroView`, where `CastableSpellView =
{ spellId, name, weaveCost, range, targetingId }`, resolved from `knownSpellIds` ∩ the content
spell registry. Empty for non-casters; `[ember-bolt]` for a Loomcaller. Rules stay engine-side;
the client only renders this.

## Client UI

- **Spell selection — panel + palette, gated on non-empty `castableSpells`:**
  - A **HUD Spells panel** listing each castable spell (name · `{weaveCost} Weave` · `rng
    {range}`), each entry disabled when `hero.weave < weaveCost`. Clicking an affordable entry
    enters targeting mode. Absent when `castableSpells` is empty.
  - **Command-palette "Cast: {name}" entries** (also weave-gated) that enter targeting mode.
    Absent when empty.
- **Targeting mode** (client-only state machine, no engine change): on entry for spell S,
  - Compute valid target cells by mirroring engine `validateTarget` against the projection:
    Chebyshev distance ≤ `S.range`, cell visible (visibility bitfield + illumination > 0),
    Bresenham line-of-sight unobstructed. Highlight valid enemy cells (▓); dim out-of-range /
    no-LoS cells (░).
  - Highlight the currently-targeted cell (creature under the mouse/reticle) distinctly.
  - **Input:** click a valid target to cast (primary — click-to-cast); also a keyboard reticle
    (arrows move among valid targets, Enter casts) for keyboard-first consistency. **Escape or
    right-click cancels** without spending anything.
  - On confirm, a new `cast` `PlayerIntent` → `command-builder` builds `{type:'cast', spellId:
    S.spellId, target:{x,y}}`. The engine does the authoritative validation; the client preview
    is advisory — an invalid click surfaces the engine's rejection reason in the log.
  - AoE forward-compat: valid/affected cells come from one small function keyed on the spell's
    targeting; single-cell today, extensible to an area set later.
- Cast affordances read the existing `weave`/`maxWeave` (HeroPanel WEAVE meter) to gate.
- **Chargen:** the Loomcaller appears automatically (it's content). Its class modifiers are
  negative, so the chargen preview's derived deltas can be negative — render negative deltas in
  a warn/danger tone rather than the positive "good" green (small display tweak).

## Determinism

Adding the Loomcaller class + Weaveward kit + the cloth-wrap/focus items is a **content
change** → the content-pack hash moves → the content-hash-embed demo fixtures (gameplay /
merchant / population / run-records + endgame) regenerate by their contentHash-derived
save-class fields only (the same benign class as the trait taxonomy). The engine changes are
**behavior-neutral for the demo hero** (default non-caster Wayfarer): `weaveRegen` base equals
today's constant, `knownSpellIds`/`castableSpells` are empty/omitted for non-casters, class
`modifiers` are absent for existing classes. So no event/projection *behavior* hash should move
beyond the contentHash propagation — verify this (a behavior-hash move would be a red flag).

## Testing

- **Content:** the class schema accepts `startingSpellIds` + `modifiers` (incl. negatives) and
  validates spell ids; the Loomcaller compiles with the right modifiers/kit/spell.
- **Engine:** `heroFromChoices` bakes `knownSpellIds` from `class.startingSpellIds` (empty when
  absent; `[ember-bolt]` for Loomcaller) and merges class `modifiers` (a Loomcaller has the
  reduced melee/defense/health + boosted weave/search); `weaveRegen` derives from base + class
  modifier and `survival.ts` regenerates by it (non-caster == old constant; Loomcaller faster);
  save round-trip omits `knownSpellIds` when empty, round-trips it when present; the projector's
  `castableSpells` resolves metadata and is empty for non-casters. Existing `cast`/`targeting`/
  `weave` tests stay green.
- **Client:** valid-target computation matches engine rules on representative layouts (mirror
  `targeting.test.ts`); targeting enter/confirm/cancel (Esc + right-click); `cast` intent →
  command mapping; Spells panel + palette ABSENT for a spell-less hero and PRESENT + weave-gated
  for a caster fixture.
- **Determinism:** all demos VERIFY OK; only contentHash-derived fixture fields moved (no
  behavior-hash movement).

## Out of scope (future magic milestone)

Learning spells from scrolls/tomes, the spell-teaching town merchant, AoE targeting/effects,
spell duration/over-time effects, more spells, and additional caster content. This feature
builds the cast-from-known-spells UI + the `knownSpellIds`/`startingSpellIds`/`castableSpells`/
class-`modifiers`/`weaveRegen` plumbing those extend, plus the first caster class. See the
magic-system idea in the backlog.
