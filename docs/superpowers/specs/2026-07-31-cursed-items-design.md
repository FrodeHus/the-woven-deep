# Cursed Items — Design

**Issue:** #121. **Date:** 2026-07-31. **Status:** approved.

## Goal

Deepen the identification gamble: some equipment is cursed — a passive drawback, a triggered sting, or both — welded on when equipped unidentified, with the identify service as counter-play and remove-curse (merchant service + rare scroll) as relief. Curses are fun-first: they create decisions and stories, never gate progress ([[design-principle-no-hard-gates]] binds — curses must never touch doors, keys, stairs, or any win-path mechanic).

## Non-goals

- No cursed consumables (potions/scrolls keep their existing shuffled-pool gamble untouched).
- No cursed artifacts (artifacts have authored drawbacks already; `artifact !== null` items are never rolled).
- No curse crafting/transfer, no blessed items, no curse stacking (one curse per item).
- No new trigger beyond the closed set of three.

## Content (schema v11 → v12)

New content kind `curse` — a closed registry, authored in YAML under `content/curses/`:

```yaml
kind: curse
id: curse.hungering-edge
name: Hungering Edge
revealText: "The blade drinks deep — and will not let go."
drawbackModifiers: { maxHealth: -3 }          # optional; keys compile-validated against DERIVED_STAT_NAMES
trigger:                                       # optional; at least one of drawbackModifiers/trigger required
  on: on-kill                                  # closed vocabulary: on-kill | on-hurt-below-half | on-floor-enter
  effectId: effect.weave.drain                 # must be an existing EFFECT_IDS member
  chanceBps: 5000                              # optional, default 10000 (always)
```

Compile validation:
- `on` is exactly one of the three literals — the vocabulary is closed at the schema level; extending it is a schema bump.
- `effectId` must exist in `EFFECT_IDS`; unknown ids fail compilation.
- `drawbackModifiers` keys validated against `DERIVED_STAT_NAMES`, values negative safe integers. **The same validation is added to the artifact block's `drawbackModifiers`** (closing the existing gap).
- Each curse must declare `drawbackModifiers`, `trigger`, or both.

Eligible categories: `weapon`, `armor`, `shield`, `ring`, `light`. Base equipment items in those categories move to `identification.mode: instance` (with appearance pools where sensible) so the unidentified gamble actually exists. Items with an `artifact` block are excluded regardless of category.

Amendment (2026-08-05): items whose identity is visually unmistakable stay `identification.mode: known` even in an eligible category — a pitch torch is a stick with a burning cloth, and pretending the hero cannot tell undermines the fiction the pools exist to serve. Curse eligibility is unaffected: it keys on category, and a known-mode item's curse still hides until an equip or identify path reveals it. The lanterns stay in the pool (a caged flame could be brass or warded — that gamble is real), and torch-shaped appearances leave the pool so an unidentified light can never masquerade as an item the pool no longer contains.

Balance knobs in `content/balance/core-gameplay.yaml`:

```yaml
curses:
  chanceBps: { shallow: 1000, mid: 2000, deep: 3500 }   # per eligible generated item, by the same depth bands as encounterDensity
  enchantedMultiplierBps: 20000                          # enchanted items roll at 2x, capped at 5000 bps
  capBps: 5000
```

## Engine

### State (save v13 → v14)

`ItemInstance.curse?: { curseId: string; revealed: boolean }` — mirrored in `save-schema/item.ts` (the drift assertion forces the pair), in the fallen-champion item snapshot schema, and in heirloom metadata paths. Freeze `legacyActiveRunV13Schema`; add one ordered migration v13→v14 (field defaults to absent). No hidden-field leak: projection exposes curse name/drawbacks only when `revealed`; until then unidentified cursed items look exactly like unidentified clean ones (`unknownProperties` already covers "may have hidden properties").

### Generation

At loot/population item creation, each eligible instance rolls once from the existing loot-placement stream: banded `chanceBps`, doubled (capped `capBps`) when the item carries a positive enchantment — the devil's bargain is engineered. Curse identity is drawn uniformly from the compiled curse registry on the same stream. Zero eligible items ⇒ zero draws (stream discipline as with artifact offers).

### Modifiers

Curse `drawbackModifiers` apply in `equipmentModifiers` on the **enchantment-side path only** — never folded into `base`, which leaks through `publicModifiers` before identification. Equipped items only, like enchantments.

### Sticky + reveal

- Equipping a cursed item sets `revealed: true` and emits `curse.revealed` (new DomainEvent → PublicEvent carrying the authored `revealText`).
- While a revealed cursed item is equipped: `unequipItem` AND `equipmentPlan`'s displacement loop refuse with new failure reason `item.cursed` (added to the equipment failure union and `InvalidActionReason`); drop of equipped cursed items is likewise refused; merchants refuse to buy revealed cursed items (`merchantAcceptsItem`).
- Per-instance identification (identify service, or any existing identify path) sets `revealed: true` WITHOUT equipping — the counter-play. Backpack-revealed cursed items can be dropped/left freely; only equipping welds.
- A trigger firing also reveals (covers the edge where an item was equipped while a future path might allow unrevealed equipping).

### Triggers

A pure post-pass in `resolveCommand`'s reducer scans the command's emitted `DomainEvent`s once, after normal resolution:

| Trigger | Fires when |
| --- | --- |
| `on-kill` | an `actor.died` event whose killer is the hero |
| `on-hurt-below-half` | a `hero.damaged`/`actor.damaged`(hero) event where health crossed from ≥ half to < half maxHealth |
| `on-floor-enter` | the new `floor.entered` DomainEvent (emitted in all three floor-transition paths — generated, stored, Final Chamber — beside the existing per-floor recharge bookkeeping) |

For each equipped cursed item whose trigger matches: roll `chanceBps` (effects stream), then resolve `effectId` through the normal effect machinery (its own randomness stays in the effects stream). One evaluation per command; a single event can trigger multiple distinct equipped curses but each curse at most once per command. Concluded runs never trigger (post-pass runs only on accepted commands).

### Remove-curse

- `merchant-service.remove-curse` — third member of `MERCHANT_SERVICE_IDS` (both enum copies + the command schema literal becomes an enum of the three). `planService`/`resolveTradeCommand` branches: target must be a revealed cursed item owned by the hero; removal deletes `curse` entirely, keeps the item, its enchantment, and its identification state; equipped items become unequippable again. Priced above identify (authored `basePrice: 30` in town-merchants.yaml, faction tiers like identify). Trade projection gains **per-service** `targetItemIds` (fixing the current identify-only assumption).
- **Scroll of sundering** — new shuffled-pool scroll with new `effect.curse.remove`: removes the curse from one revealed cursed item (targeting mirrors existing item-targeted effects). Rare (deep-weighted loot tables).

### Heirlooms & champions

A cursed item selected as heirloom travels **cursed and revealed** — the Hall knows its history; the recovering hero sees the curse before touching it. Champion inventory snapshots preserve the curse field; materialization compatibility checks accept it.

## Client (apps/web)

- `curse.revealed` log line (authored `revealText`, distinct tone) + item sheet shows curse name and drawbacks once revealed; a subtle "cursed" marker on equipment slots.
- `item.cursed` rejection surfaces the existing invalid-action log path ("It will not come free.").
- Remove-curse appears in the trade Services tab via the per-service target list — no bespoke UI.

## Error handling

- Compile: unknown trigger literal, unknown effectId, positive/unknown drawback keys, curse with neither block — all fail `content:validate`.
- Runtime: remove-curse on a non-cursed/unrevealed target → command rejected with existing trade rejection shape; scroll on invalid target → no consumption, rejection message.
- Save: decoding a v14 blob with unknown curseId (content drift) follows the existing content-bound validation policy for stale references.

## Testing

- Content: compile validation matrix; artifact drawback-key validation now enforced.
- Engine: generation determinism + banded rates + enchanted doubling (statistical over seeds, exact per-seed pins); sticky on both unequip paths; displacement refusal; merchant sell refusal; reveal via equip/identify/trigger; each trigger's crossing semantics (esp. below-half edge: exact-half, multiple hits in one command, healing back above and crossing again); stream isolation (curse rolls from loot-placement, trigger rolls from effects — demo hashes for unrelated commands unchanged); remove-curse service + scroll end-to-end; heirloom/champion round-trip; v13→v14 migration; byte-identical save/reload replay with cursed items equipped.
- Invariant: descent-lock-free stays green (curses cannot touch traversal by construction — no curse effect may target doors/terrain; enforce by restricting curse `effectId` to a compile-time allowlist that excludes terrain-mutating effects if any exist).

## Amendments (2026-07-31, during implementation)

Recorded where the implementation legitimately diverged from the text above. Each was either owner-ruled or settled in per-task review; the sections above stand as written except where these amend them.

1. **Trigger wiring.** The spec describes triggers as a single evaluation point. In practice there are two, because floor transitions bypass `resolveCommand` entirely. `on-kill` and `on-hurt-below-half` ride a post-pass over the reducer's accepted-command result; `on-floor-enter` fires from engine-internal resolver calls made by all **six** floor-transition paths, not the three the Triggers section names. The once-per-curse-per-command rule is unchanged for both halves.

2. **Uniform recall rule.** `recallToTown` and `recallReturn` both emit `floor.entered` and both fire `on-floor-enter`. Treating a recall as a non-entry would have made the town the one floor a curse could not follow the hero onto; the uniform rule is simpler to reason about and closes that seam.

3. **Guarded shove.** A curse-driven `effect.force-move` is dropped when the destination is out of bounds, unwalkable (a closed door included), or occupied by a living actor. The `chanceBps` roll is spent either way, so the stream position does not depend on the hero's surroundings. The Content section's allowlist sentence is amended to state the guard rather than implying force-move always lands.

4. **`maxHealth` forbidden as a curse `drawbackModifiers` key.** Derived `maxHealth` is never written back to the actor, so such a drawback is inert. The compiler now rejects it (curse-only — artifacts keep the full `DerivedStatName` registry). `curse.hungering-edge`, authored in the spec with `maxHealth: -3`, was re-authored to `meleeAccuracy: -2`. The example in `docs/server-admin/content-configuration.md` was corrected to match.

5. **Curse anatomy roster.** The authored roster covers all three legal shapes. `curse.embermarked` was added as the trigger-only case, so drawbacks-only, trigger-only, and both are each exercised by real content rather than only by test fixtures.

6. **Identification pools.** `poolId: null` is impossible for a non-`known` item — an item in `identification.mode: instance` always resolves to a pool. Four pools are authored to cover the swept categories: weapons, armor, shields, and light sources.

7. **Stat-total tell.** Equipping an unidentified cursed item **does** move the hero's visible derived stats. This is the classic roguelike tell, not a projection leak: the hero sees that something is wrong without learning which curse it is or that the cause is a curse at all. No curse identity crosses the projection boundary before reveal.

8. **Killed by your own curse.** A hero killed by a curse trigger concludes the run with `killerContentId: null`, recording as an environmental death. There is no actor to attribute it to, and inventing one would corrupt the Hall's killer statistics.

9. **`revision` on floor transitions.** `revision` now increments on floor transitions as well as on commands. Transitions previously left it untouched, which left a stale-command replay hole (a command accepted against a pre-transition revision). Keying `floor.entered`'s `eventId` on `revision` also gives repeat entries to the same floor distinct event IDs.

10. **Merchant stock is never curse-rolled.** Merchants materialize stock through their own path, which does not call `applyCurseRolls`; nothing you buy is ever cursed at the point of sale. Merchants refuse to buy **revealed** cursed items only — an unrevealed cursed item sells normally, so the gamble cuts both ways.

11. **`HALL_STORE_VERSION` bumped to 3.** Stored guest Hall heirlooms gain `curse: null`, which is a stored-shape change and therefore a store-version bump.

12. **Scroll of sundering is not shuffled-pool.** The Content section calls it a "new shuffled-pool scroll", but `content/items/sundering-scroll.yaml` ships `identification: { mode: known, poolId: null }`. An unidentifiable curse-remover would stack a gamble on top of a gamble — the hero could not tell a working scroll of sundering from a dud without already having read it. `identification.ts` also filters `mode: known` items out of pool allocation entirely, so shuffling it would have been dead weight even if authored: there is no shuffle drift to reconcile.
