# Gold sinks design

Issue: #149 — "design: gold accumulates toward nothing".

## Problem

Gold income (~10–30g per floor from scatter and chest tables, plus sale proceeds) has nothing
to buy past roughly depth 6:

- The purchasable catalog tops out at the aegis tome, 90g. Every other stocked good is under 60g.
- The armorer's whole pool is starting gear: iron sword 18g, hunting bow 22g, wooden shield 14g,
  leather armor 20g. There is no mid- or late-tier weapon, armor, shield, or light **anywhere in
  the content pack**, so no restock can ever surface an upgrade.
- The 150–260g rings are all `artifact.canon: true` singletons. They circulate through vault and
  boss drops and are refused by `merchantAcceptsItem`; their `price` is vestigial. They are not a
  catalog the hero can buy into, and making them one would break singleton circulation.
- Services never re-arm. Each merchant rolls `remainingUses` once at materialization and that is
  the run's entire supply — two enchants at most, one strongbox, one remove-curse.
- Lockpicks (6g) and keys (1g) are priced as rounding errors even though deep locks
  (`chestLockDifficulty.deep: 16`) burn picks fastest.

The consequence: by mid-run the economy is solved. Gold drops — a G5 headline — stop meaning
anything.

## Approach

Four levers, all hanging off machinery that already exists. The unifying fiction: **the town
tracks how deep you have gone.** Permanent merchants already project their stock against
`run.metrics.deepestDepth` and restock at `balance.restockMilestones` (`[5, 10, 15, 20]`). That
same signal now also widens what is worth buying, re-arms services, and raises what services cost.

### Lever A — a deep gear tier

Four new items, authored as merchant-catalog goods rather than dungeon loot:

| id | category | depth band | price | profile |
| --- | --- | --- | --- | --- |
| `item.deepsteel-blade` | weapon | 10+ | 110 | 1d8+1, accuracy +1, one-handed |
| `item.warded-hauberk` | armor | 15+ | 165 | defense 1, armor 3 |
| `item.bulwark-shield` | shield | 15+ | 140 | defense 3, accuracy −1 |
| `item.warded-lantern` | light | 12+ | 95 | radius 9, 4200 fuel, lamp-oil |

Each is `rarity: rare` and `identification: { mode: instance }` against its category pool
(`weapons`, `armor`, `shields`, `light-sources`).

`mode: instance` is not optional here. The curse system's standing invariant — asserted by
`curse-eligible-items.test.ts` — is that every non-artifact `weapon`/`armor`/`shield`/`ring`/`light`
declares `mode: instance` with a pool, because a curse is revealed through identification. A
`mode: known` piece of equipment could carry a curse the hero can never learn about. Only artifacts
are exempt, and these are not artifacts.

The design reads better for it: an unappraised deep blade is a gamble, which is exactly what makes
the Curios Dealer's identify service worth its (now milestone-scaled) price. The cost is that
`allocateIdentificationMap` consumes one more `effects` roll per new pool member, so every
downstream draw shifts and demo hashes drift — see *Determinism notes*.

`rarity: rare` matters beyond flavor: `balance.enchanting.rarityMagnitudeBps` scales an
enchantment by rarity (rare = 15000bps), so a deep blade is also a better enchant target than the
iron sword. Buying gear and then paying to enchant it is the intended two-step sink.

Depth bands are pinned to restock milestones, not to arbitrary depths: an item banded at
`minDepth: 12` first becomes reachable at the milestone-15 restock, so band edges of 10 and 15 are
the ones that actually fire. The lantern's 12 is reachable from the travelling lampwright (which
projects against its own floor depth, not the milestone ladder) before the town ever stocks it.

### Lever B — service pricing pressure

Two halves, both fired by the existing restock, so no new content field and no schema bump:

1. **Services re-arm on restock.** `restockMerchant` re-rolls `remainingUses` for each of the
   population's service offers from the authored `[minimumUses, maximumUses]` band, exactly as
   materialization does. Identity, `basePrice`, `tierIds`, and reputation are untouched — only the
   use count. This is what makes a service a *repeatable* sink instead of a one-off.
2. **Service prices climb with the milestone ladder.** The quoted base price is multiplied by
   `1 + run.restockedMilestones.length`, so a service costs 1× before depth 5, 2× after, up to 5×
   once every milestone has fired. The multiplier composes with the existing re-enchant doubling
   (`scaledServiceBasePrice(basePrice, item.enchantment === null ? 1 : 2)`), so re-enchanting a
   late-run item is the catalog's most expensive act.

The multiplier is derived from `restockedMilestones`, not from `deepestDepth`, on purpose: it is
the same event that widened the stock and re-armed the uses, so all three read as one beat. It is
tunable by editing `balance.restockMilestones` alone.

`basePrice` in `MerchantPopulation.services` stays the authored value — `content-bound-validation`
pins it against the content pack. Scaling happens only at quote time, in both `planService` and
`projectGameplayState`, so the UI price and the charged price can never diverge.

### Lever C — a lampwright deep-stock tier

The travelling lampwright is non-permanent, so its stock projects against its own floor depth. Its
table gains depth bands so a late-run encounter is worth the gold:

- `item.warded-lantern` from depth 12 — the pool's first light upgrade past the brass lantern.
- `item.lockpick` (bulk, 2–4) from depth 8 — the resupply that deep lock difficulty demands.
- larger `item.lamp-oil` quantities from depth 8.

### Lever D — key and pick pricing pressure

- `item.lockpick`: 6 → 12. Deep locks are difficulty 16 and consume a pick per failure; the pick
  is the run's most-consumed purchase and should be priced like one.
- `item.iron-key`: 1 → 20. A key is the guaranteed open — the alternative to burning a fistful of
  picks on a deep chest — and had no price expressing that.
- The provisioner stocks `item.iron-key` from depth 10.

Raising `iron-key` also raises what a *found* key sells for (60% of price via
`merchantPurchaseBps`), which is intended: carrying a key past a chest you could have opened is now
a real trade, not a shrug.

## Non-goals

- **Shrine bargains (#118)** is an unbuilt feature of its own; folding it in here would smuggle a
  whole altar system into an economy fix.
- **Legendary rings as merchant stock.** They are canon artifact singletons. Stocking them would
  break `guaranteedUniqueItemIds` circulation and the provenance record.
- **Cross-run strongbox persistence.** The issue notes house capacity evaporates at death; making
  it persist is metaprogression, not a gold sink, and belongs with the metaprogression milestone.
- **New lock or light mechanics.** Lever C and D move prices and stock bands only. In particular no
  lock is made unopenable without a purchased item — the no-hard-gates principle holds.

## Incidental fix: an unvalidated curse crash

Shifting the `effects` stream made `curse.cold-tether`'s floor-enter roll hit where it previously
missed, which surfaced a latent crash: the curse applied `condition.chilled` with `duration: 300`
against that condition's authored `maximum: 6`, so `applyCondition` threw a `RangeError` mid-run.
`curse.embermarked` had the same defect (`condition.burning`, `duration: 200`, maximum 6). Both are
authored in world-time units against turn-based conditions; both are clamped to 6.

The durations were only half the problem. `effectIssues` — which already contains exactly this
check — was wired for items, spells, and traps, but **curse trigger effects were never run through
it**, which is how the values shipped. `validation/curse.ts` closes that gap, so the compiler now
rejects the original pack with `duration 300 exceeds maximum 6`.

This is outside #149's scope and would be reasonable to split into its own change; it is here
because the branch cannot go green without it.

## Determinism notes

- The four new instance-identified items add four `effects` rolls to `allocateIdentificationMap`,
  which runs at run creation. This shifts the `effects` stream for **every** run from turn zero, so
  demo hashes drift broadly rather than only past a milestone. The drift is expected and its cause
  is this one change; re-pin only after confirming the transcript delta is attributable to it.
- `restockMerchant` gains one `rollDie` per service offer on the `merchant-stock` stream, drawn
  after the stock roll. Every demo that reaches a restock milestone drifts on that stream too.
- Loot-table choice additions shift weight totals in the affected tables, so merchant stock rolls
  drift at and after the milestone that first admits a new band.
- No RNG is consumed by lever B's price multiplier: it is pure arithmetic over
  `restockedMilestones`, which is already saved state.
- No content schema bump and no save schema bump. No new fields in either.
