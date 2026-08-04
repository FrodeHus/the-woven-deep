# Consistency review honorable mentions

Issue #158. Six smaller findings from the 2026-07-31 internal consistency review, each one
verified against the code before deciding whether it needed a change. Two of the six turned out
to be wrong as written; one was accepted as intentional. Three produce changes.

## What the verification found

Every bullet below was checked against the source, not against the review's arithmetic.

### 1. Hunger's teeth are cosmetic — partly true, changing

Hunger drains exactly one point of reserve per turn (measured: one `wait` command advances
`worldTime` by 1 and `survival.hungerReserve` by -1). Against `hungerMaximum: 5000` and
`hungerThresholds: { hungry: 1500, weak: 500, starving: 0 }` that puts the stage boundaries at
3,500 / 4,500 / 5,000 turns.

The review's claim is half right. `hungerStageModifiers.hungry` is an empty block, so crossing
into hungry costs nothing on the stat sheet, and starvation at 1 damage per 500 turns cannot
plausibly kill anyone inside a run. But `recoveryByHungerStage` is already `weak: 0,
starving: 0` — all natural health and Weave recovery stops at weak. That pressure is real and
stays as it is. What changes is the two ends the review named.

### 2. Turn-efficiency budget is dead on arrival — false, but backwards, changing

`scoreRun` computes `max(0, turnEfficiencyBudget - floor(turnsElapsed / turnEfficiencyDecayInterval))`.
At a 500 budget decaying once per 200 turns, the line only reaches zero at 100,000 turns. A
14,000-turn twenty-floor run keeps **430 of 500**. The line is not unreachable; it is a nearly
flat participation bonus that barely distinguishes a fast run from a slow one.

### 3. Ration stack economics — accepted as intentional, no change

Confirmed: a run needs roughly five to eight rations at 1,800 reserve each, against
`stackLimit: 6`. That is one to two inventory slots of bread for a full descent. This is the
intended survival cost, not clutter. Recorded here so the question is not re-opened.

### 4. `ashen-warden` rolls inside the ordinary encounter budget — false, no change

The encounter is gated by `runAppearanceChance: 0.08` and `maximumInstancesPerRun: 1`, so it
appears in roughly one run in twelve at all. When it does place, `placeFloorPopulations` credits
`placement.createdActors.length` — one actor for a boss — against `placedMonsters`, and the
attempt loop keeps drawing until the floor's monster target is met or `attemptCap` is spent. A
warden costs the floor one monster of its allocation, not all of it. The claim that "a floor's
entire allocation can be one surprise boss" does not hold.

### 5. Ring prices imply a purchasability that never occurs — confirmed harmless, no change

Every ring in the 150–260g band (`warden-ember`, `thread-counts-needle`,
`last-cartographers-compass`, `marias-grace`, `bound-signet`, `echo-heartstone`, `heart-cinder`,
`ashfather-cinder`, `tide-crown`, `herald-sigil`) carries an `artifact` block.
`merchantAcceptsItem` refuses any item with `definition.artifact !== null`, and merchant stock
generation excludes artifacts by the same test. These prices are genuinely inert.

They stay. `price` is a required, positive field on every item, and the singleton rule in
`commerce.ts` — not the price — is what makes an artifact untradeable. Setting these to a
sentinel would put the guard in two places and make the second one silent. The reason is
documented instead.

### 6. Curios dealer sells the potions identification is about — partly true, changing

Merchant stock is projected through `projectItem`, so an unidentified potion on the counter shows
its shuffled appearance, not its true name. Buying does not reveal what it is; the mystery
survives the purchase. That part of the concern is already handled.

The real leak is the stock list. `loot-table.town-curios` offers exactly two potions —
`crimson-potion` and `ashen-potion` — and both are healing. With four risky potions now in the
same shuffled pool, the dealer's counter is a safe-list oracle: anything bought there is known to
be harmless before it is drunk, which is the one thing identification is supposed to withhold.

## The changes

### A. Hunger bites at `hungry`, and starvation escalates

`hungerStageModifiers.hungry` gains `{ search: -1 }`. Hunger dulls the senses before it dulls the
body, which keeps the ladder legible: hungry costs perception, weak costs the existing
accuracy/damage/defense point, starving costs two. It stacks with the half-rate recovery hungry
already carries.

Starvation stops being a flat tick. Damage on the *n*-th consecutive starvation tick becomes:

```
min(starvationDamage + (n - 1) * starvationDamageIncrement, starvationDamageMaximum)
```

Eating resets the ladder to zero along with the starving state — the same moment
`nextStarvationAt` is cleared. A hero who keeps finding food never sees the steep end.

Tuned to `starvationInterval: 250`, `starvationDamage: 1`, `starvationDamageIncrement: 1`,
`starvationDamageMaximum: 6`. Ticks deal 1, 2, 3, 4, 5, 6, 6, … so a 30-health hero has taken 21
damage after six ticks (1,500 turns past starving) and dies on the eighth (2,000 turns past).
Ignoring food entirely kills at roughly turn 7,000 — half a full run — rather than never.

This is a content schema change (three balance fields, one of them new-valued) and a save schema
change (the tick counter has to survive a reload, or a save/resume would silently reset the
ladder).

### B. Turn efficiency shapes play

`turnEfficiencyDecayInterval` drops from 200 to 50. Nothing else changes; this is a single number
in `content/balance/core-gameplay.yaml` and no code moves.

At 50, a 14,000-turn run keeps 220 of 500, a brisk 8,000-turn run keeps 340, and a 25,000-turn
grind keeps nothing. Against a good run's other lines — 2,000 from depth, 250 per boss, 400–1,500
for the ending — that is a spread worth playing for without letting the clock dominate the board.

### C. The curios counter is a gamble again

`loot-table.town-curios` gains `item.bitter-potion` at weight 2, in the base band with no
`minDepth`, alongside `crimson-potion` at weight 3. Bitter is the common poison-and-sickened
draught, so the dealer's potion shelf is roughly two-thirds helpful and one-third not, from the
first visit. Since stock renders appearance-only, the player cannot tell which flask is which
before paying — which is the point.

The `merchant-service.identify` service the curios faction already offers at neutral and trusted
remains the way to buy certainty, and now it has something to be certain about.

## Schema impact

**Content schema v15 → v16.** Three fields on the balance entry:

- `starvationDamageIncrement` — non-negative safe integer, added per successive starvation tick.
- `starvationDamageMaximum` — positive safe integer, the per-tick cap. Refined to be greater than
  or equal to `starvationDamage`, so a pack cannot declare a cap below its own floor.
- `starvationDamage` keeps its meaning as the first tick's damage.

Setting `starvationDamageIncrement: 0` reproduces the old flat behavior exactly, so the fields are
a strict generalization. Migration notes go in `docs/server-admin/content-configuration.md`.

**Save schema v17 → v18.** `SurvivalState` gains `starvationTicks: number` — a non-negative safe
integer counting consecutive starvation ticks since the hero last stopped starving. The v17 schema
is preserved as `legacyActiveRunV17Schema` and one ordered migration defaults the field to 0,
which is correct for any save: a restored run that is still starving simply restarts its ladder,
which is a mercy, not a corruption.

## Determinism and hashes

None of these changes draw randomness. The starvation ladder is arithmetic over existing state,
the score line is arithmetic over existing metrics, and the stat modifier is a table lookup.

The curios stock change *does* move the merchant RNG stream: adding a weighted choice changes what
`loot-table.town-curios` draws for the same state. The merchant demo hash will drift, and any demo
that walks far enough to starve or that scores a run will drift from the balance changes. Each
drift gets its transcript delta inspected and explained in the commit before the hash is re-pinned —
never a blind re-pin.

## Testing

RED-first for each behavior:

- Starvation ladder: a hero held at starving takes 1, then 2, then 3 damage on successive ticks,
  and caps at `starvationDamageMaximum`.
- Ladder reset: eating mid-starvation returns the next tick's damage to `starvationDamage`.
- Backwards compatibility: `starvationDamageIncrement: 0` reproduces a flat tick.
- Save round-trip: a run mid-ladder encodes and decodes with its tick count intact, and a v17 save
  migrates with `starvationTicks: 0`.
- Hungry modifier: a hero at the hungry stage derives `search` one lower than at sated.
- Score: the turn-efficiency line against representative turn counts, including the zero floor.
- Curios stock: the compiled table offers a risky potion in the base band.

The engine's browser-boundary and content-validation gates run unchanged.

## Out of scope

The three findings recorded above as "no change" (ration stack weight, `ashen-warden` budgeting,
artifact ring prices) are closed by this document, not by code. Anything that would rebalance
hunger *pacing* — reserve size, ration restore amount, thresholds — is deliberately untouched:
the review asked whether hunger has teeth, not whether it arrives at the right time.
