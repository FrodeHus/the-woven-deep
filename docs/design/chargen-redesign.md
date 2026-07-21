# Character genesis — UI redesign

A faithful visual/layout restyle of the existing chargen console to the "Character Genesis"
mockup (`Chargen.dc.html`), grounded in the already-implemented chargen. The current console
(`apps/web/src/ui/screens/ChargenScreen.tsx` + `screens/chargen/**`) already has the 3-column
shell, all 7 steps, both attribute methods (point-buy + roll-with-one-reroll), locked callings
with unlock hints, per-class kit choice, and the live `HeroRecord` preview. This is mostly a
restyle; the mockup's data is placeholder and must be replaced with real content.

## Layout (faithful to the mockup)

- **Left rail:** the 7-step list (Identity, Calling, Kit, Attributes, Origin, Traits, Review)
  — number, active caret, a value-summary line, and a done/not-done dot (● / ○). Add the
  mockup's static flavor footer ("Many enter. Few return. All are woven in.").
- **Center:** step header (STEP N OF 7 · serif title · subtitle), the step body, and the
  BACK / "N / 7" / NEXT (final step: WEAVE) footer.
- **Right rail:** the live hero-record preview — glyph portrait + name + calling·kit line;
  ATTRIBUTES (bars + origin +1 deltas); DERIVED; LOADOUT (kit items); MARKS (chosen traits);
  the "▸ WEAVE THE HERO" CTA.

## Grounding corrections (mockup placeholder → real)

- **Real content everywhere:** real classes (Wayfarer, Lamplighter playable; Archivist,
  Warden locked with their real unlock hints), real kits per class, real backgrounds/origins
  (Caravan guard +1 defense, Deep miner +1 search, Ratcatcher +1 meleeAccuracy), real traits.
- **Point-buy numbers from `balance.pointBuy`** — budget 30 and doubling above value 10 (NOT
  the mockup's placeholder 18 / ">12 doubles").
- **Derived preview stays content-driven** (`playerVisibleDerivedStats()`): show Max health,
  Melee accuracy, Ranged accuracy, Melee damage bonus, Defense, Search, Disarm, and **Weave
  (maxWeave)** — Weave now exists (merged), so it appears automatically once this branch
  rebases onto it. Rename the mockup's "Perception"→Search; split "Accuracy"→melee/ranged.
  Add a **Gold** line from `balance.startingCurrency` (flat, not a derived stat).
- **Keep the ⊘ (locked) vs – (at-cap) marker distinction** already established in `OptionRow`
  (do NOT adopt the mockup's ⊘-for-at-cap). Keep the existing **portrait glyph picker** in
  Identity (real; the mockup omits it but it's grounded).

## Decisions (from the user)

- **Epithets: OMIT.** The mockup's Identity epithet picker ("how the Hall remembers you") has
  no backing (no `HeroChoices` field, no content kind). Ship Identity as name + portrait.
  Epithets captured as a backlog idea (see `future.md`).
- **Trait filters: build a real tag taxonomy.** Real traits are all tagged only `chargen`, so
  the mockup's body/mind/fortune chips are ungrounded. Author meaningful tags onto the trait
  content (a small content pass — e.g. combat / survival / arcane, chosen to fit the real
  traits) and drive the Traits-step filter chips + search from the real tags.
- **Flavor UX: add both.** A Review-step "ready / threads-missing" banner (lists incomplete
  steps by name, from the existing `canWeave`/step-ok logic) and a "THE LOOM ACCEPTS"
  confirmation modal before descending.

## Constraints

Behaviour-preserving where it's a restyle (keep the chargen reducer, dispatched choices,
keyboard nav, all existing tests). The trait-tag taxonomy is the one content change → it moves
the content-hash-embed demo fixtures (regenerate intentionally). Reuse the redesign theme
tokens + shared primitives (`FacetedOptionList`/`OptionRow`/`StepMenu`/`HeroRecord`/
`AttributeStepper`/`FilterBar`), relaying-out rather than forking.

## Sequencing

Implement AFTER the endgame + UI-redesign merge sequence lands, rebasing this branch onto the
final `main` so it builds on Weave + content-descriptions + endgame + the reconciled UI, and
the content change + demo regen happen once against the final main.
