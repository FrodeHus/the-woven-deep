# Potion risk — design

Issue: #145 (design: identification is a pillar with no risk and almost no content).
Content-prereq companion to #121 (cursed items, shipped in PR #182).

## Problem

Identification is advertised as a pillar — the shuffled-name machinery, the merchant identify
service, and README's "Drinking the crimson one is one way to find out" all lean on it — but the
potion pool held exactly two entries (`item.crimson-potion`, `item.ashen-potion`) and **both were
`effect.heal`**. The worst outcome of drinking an unknown draught was a smaller heal. A gamble that
cannot lose is not a gamble: the identify service was priced against a risk that did not exist, and
the shuffled appearance carried no information worth paying to learn.

#121 supplied the risk half for *equipment* (curses). Potions were left as the one consumable
category where the fiction promised a bet and the rules refused to take it.

## Design rules

1. **A blind draught can lose.** At least a third of the potion pool must be able to leave the hero
   worse off than before drinking — damage, a debuff, or both.
2. **Losing is a setback, not usually a death.** Harm is scaled against the same band the heals
   occupy (hero `maxHealth` is `10 + vitality`, heals are 1d4+1 / 1d6+2). A harmful potion drunk at
   full health never kills; drunk at 3 HP it can. That asymmetry is the decision the pillar exists
   to create — the gamble is safest exactly when you least need to take it.
3. **Not every unknown is good-or-bad.** One outcome is neither: a utility potion. This is what
   makes an *identified* appearance worth more than one bit — the pool answers "which of six", not
   "heal or poison".
4. **Price must not identify.** Every potion is priced inside the pre-existing `{10, 12}` band, so
   a sell quote or shop tag reveals only "this is a potion". Price-ID is not a shortcut here.
5. **The Curios dealer vouches for their stock.** The new potions are found in the Deep, never sold
   in town. A shopper can therefore prove two of the six appearances safe by buying them — real,
   bounded information that costs gold and covers a third of the pool. The other four appearances
   stay a bet.
6. **Drink-to-identify already works and is not changed.** `use-item` reveals a `shuffled`
   appearance on use (`action-dispatch.ts`), so drinking a harmful potion both hurts and teaches.
   The engine's existing hero-death conclusion path covers a lethal draught; no engine change is
   required by this design.

## The pool after this change

Six potions, one shuffled appearance each (the pool's 8 verbs x 8 nouns = 64 names, ample):

| Item | Class | Effect |
| --- | --- | --- |
| `item.crimson-potion` (existing) | good | heal 1d6+2 |
| `item.ashen-potion` (existing) | good | heal 1d4+1 |
| `item.numbing-potion` (new) | mixed | heal 2d4+2, then `condition.chilled` (-2 accuracy, 3 turns) |
| `item.clouded-potion` (new) | utility | clears `condition.burning` and `condition.sickened`, restores 2200 hunger |
| `item.bitter-potion` (new) | harmful | poison 1d4, then `condition.sickened` |
| `item.searing-potion` (new) | harmful | fire 1d3, then `condition.burning` (1d2 fire/turn, 3 turns) |

Blind odds: 2/6 plainly good, 1/6 good with a cost, 1/6 neither, 2/6 harmful.

The utility slot went through two rejected shapes before landing, and both rejections are rules the
next potion author needs:

- **A mapping draught (`effect.reveal`) is not authorable.** `effect.reveal` is absent from the
  engine's `DIRECT_EFFECT_IDS`, and `use-item` supplies an empty `operations` seam, so such a potion
  compiles and validates cleanly and then throws `effect operation ... is unavailable` the moment a
  player drinks it. Only `DIRECT_EFFECT_IDS` may appear on a potion.
- **A curse-lifting draught (`effect.curse.remove`) leaks its own identity.** `actions.ts` rejects
  any use of an item carrying `effect.curse.remove` with `target.invalid` when the hero has no
  revealed curse. That gate is right for the remove-curse *scroll* (a known item that should not be
  wasted), but on an *unidentified* potion it is a free oracle: a drink attempt that costs nothing
  and bounces uniquely fingerprints that appearance, which breaks rule 4. **No shuffled item may
  carry an effect that `actions.ts` gates on hero state.**

What landed instead is the pool's own antidote: the clouded draught clears exactly the two
conditions the harmful potions inflict, and feeds you. Nothing gates it, so it always drinks; it is
merely wasted when you are neither burning, sickened, nor hungry — a disappointment rather than a
tell.

`condition.sickened` is new content (no schema change): poison damage on tick plus an accuracy
penalty, the lingering half of a bad draught. It reuses the existing condition machinery exactly as
`condition.burning` does.

`item.numbing-potion` is the strongest heal in the pack and the reason the gamble stays worth
taking: a hero who identifies it has found something the merchant does not sell.

## Distribution

New potions enter the Deep's scatter, chest, and monster-drop tables at weights below the heals, so
an unknown potion pulled off the floor is still more often a heal than not — the pool is a risk, not
a tax. Town tables (`town-curios`, `town-provisioner`, `early-provisions`) are untouched, per rule 5.

## Consequences

- Loot-table weights shift, so the hash-pinned demo transcripts drift. The drift is expected and is
  re-pinned with the delta explained, per the determinism convention.
- README's identification line becomes true as written rather than aspirational.
