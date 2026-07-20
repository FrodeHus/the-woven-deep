# Light-out feats

Three chargen-selectable feats that modify the light-out (carried-light-extinguished)
survival mechanic. Two are pure content plugging into knobs that already exist; the third
needs one new knob and a small engine change.

## Background: the light-out mechanic (already shipped)

When the hero's own cell has illumination ≤ 0 ("actually dark"), the projection reveals
only a Chebyshev bubble of radius `lightOutRevealRadius` (default **1**) around the hero,
terrain only, with actors/features/items suppressed. If `lightOutMemoryPersists` (default
**0**, read as boolean via `> 0`) is false, the remembered/explored map outside the bubble
is hidden. Both are derived stats (`DERIVED_STAT_NAMES`) aggregated through
`deriveActorStats`, so any modifier source can move them.

The **knowledge-commit** path (`refreshKnowledge` → `rememberTiles`, run each turn from
`world-step`) commits a cell to the saved `FloorKnowledge` only when it is genuinely
perceived (visible AND real illumination > 0). So terrain the hero only "sees" inside the
dark presentation bubble is **not** committed — dark fumbling is deliberately never
remembered (survival tension; blocks snuff-to-explore). This is the rule Dungeon sense
overrides.

## Feats

Feats are authored as the existing **`trait`** content kind (`content/traits/…`), picked at
chargen (max 2), merged into `hero.statModifiers` → `heroModifiers` in `deriveActorStats`.
No new content kind, grant, or unlock system — and no chargen/UI changes (the traits UI is
already generic over `trait` content and its `modifiers`).

- **Born in the dark** — darkvision. `modifiers: { lightOutRevealRadius: 3 }` → total reveal
  radius 4. Author-only; every read site already consumes the knob.
- **Living compass** — `modifiers: { lightOutMemoryPersists: 1 }` → the remembered map stays
  visible while dark. Read-only presentation; it does NOT commit newly dark-fumbled terrain
  (it only un-hides what was committed under light). Author-only.
- **Dungeon sense** — commits newly-discovered terrain to memory even while dark, the one
  feat that overrides the no-dark-commit rule. Needs a **new knob** + engine wiring (below),
  then `modifiers: { lightOutCommitsMemory: 1 }`.

A hero may take both Born in the dark and Dungeon sense (commits a radius-4 dark bubble);
compositions fall out of the shared aggregation automatically.

## Dungeon sense: the one build

1. **New derived stat** `lightOutCommitsMemory` (default 0, boolean via `> 0`): add to
   `DERIVED_STAT_NAMES` (`packages/content/src/model/common.ts`) and a `{ base: 0 }` default
   formula in both `content/balance/core-gameplay.yaml` and the demo fixture
   (`packages/engine/src/fixture.ts`), matching how `lightOutRevealRadius`/`…MemoryPersists`
   are defaulted.
2. **Engine wiring:** the knowledge-commit path (`refreshKnowledge` in `perception.ts`, its
   callers `run-perception.ts` `heroFloorPerception`, and `world-step.ts`
   `refreshHeroKnowledge`) takes no hero-derived-stat input today. Thread a hero-derived
   signal in: when the hero is in the dark AND `lightOutCommitsMemory > 0`, force-commit the
   hero's light-out bubble cells (the same Chebyshev radius `lightOutRevealRadius` the
   projection reveals, terrain only) into `FloorKnowledge` via `rememberTiles`, in addition
   to the normal illumination-gated commit. Derive the stats via the same
   `deriveRunActorStats` the rest of world-step uses; do not add an RNG draw.
3. Author the `trait.dungeon-sense` entry.

## Determinism

- No RNG anywhere in these feats — they are knowledge/presentation-layer.
- Adding trait entries and the new derived stat changes the **compiled content-pack hash**,
  which is embedded into demo saved state, so the content-hash-embed demo fixtures
  (`gameplay`/`merchant`/`population`/`run-records` saveHash-class fields) move. This is a
  pure content-hash embed, NOT a behavioural change (no demo drives the hero into the dark),
  so regenerate those fixtures and eyeball each diff to confirm only content-hash-derived
  fields moved.
- The Dungeon sense commit changes saved `FloorKnowledge` **only when the knob is active and
  the hero is dark** — no existing demo hero has the trait, so no behavioural hash moves.

## Testing

- Content: the three traits compile and are enumerable as chargen traits.
- Engine: with `lightOutCommitsMemory > 0`, a hero in the dark commits its bubble terrain to
  `FloorKnowledge` (and that terrain survives into the remembered map after light returns);
  with the knob 0 (default), dark fumbling commits nothing — the existing behaviour is
  unchanged. Assert via `refreshKnowledge`/world-step + a save round-trip.

## Out of scope

- Class- or item-granted feats (no path exists; chargen trait selection is the only granting
  mechanism today).
- Any change to the 2-trait chargen cap.
