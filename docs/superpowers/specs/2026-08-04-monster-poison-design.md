# Monster poison: `condition.poisoned` and on-hit condition riders

Issue #153 — "the poison families have no poison"

## Problem

Five monsters and four encounters are venom-themed (`monster.bile-tick`,
`monster.web-stalker`, `monster.venom-spinner`, `monster.shroud-widow`,
`monster.caustic-pool`; `encounter.loomspider-nest`, `encounter.venom-spinner-web`,
`encounter.caustic-pool-pit`, `encounter.shroud-widow-lair`), yet no monster in the pack
applies any condition. The conditions registry has eleven entries and every one of them is
spell- or consumable-side. A shroud widow is mechanically a slower rat with a better loot
table.

Two things are missing: a venom condition, and any path at all from a monster's attack to
`applyCondition`. This design adds both, and the second is the durable half — the conditions
registry gets its first monster-side consumer, and the seam generalises to any future
on-hit rider (a chill-touch wraith, a paralytic sting) as pure content.

## Scope

In: a poison condition, a monster-schema rider field, riders on the five poison-tagged
monsters, and the engine seam that fires them. Out: poison resistance gear, antidotes,
player-side venom weapons, poison-tagged traps. `dropChance`-style tuning of the existing
encounters is untouched.

## Design

### 1. `condition.poisoned` (content)

A new `content/conditions/poisoned.yaml`:

- `duration: { mode: timed, default: 5, maximum: 10 }`
- `stacking: { mode: refresh, maximumStacks: 1 }`
- `tickEffects`: `effect.damage`, `damageType: poison`, `1d3`, `requiresLivingTarget: true`
- no `modifiersPerStack`

**Why `refresh`/1 stack and not `intensify`.** `tickConditions` resolves a condition's
`tickEffects` once per tick and never reads `stacks`; only `modifiersPerStack` scales.
An `intensify` poison would therefore advertise stacking venom and deliver a flat 1d3 —
exactly the kind of mechanic-that-isn't-there this issue is about. `refresh` is honest: a
second bite resets the clock, and a venomous monster that keeps landing hits keeps the
target poisoned.

**Why not reuse `condition.sickened`.** `sickened` (from the potion-risk work) is ingestion:
a gut-sickness DoT carrying a `-1` melee/ranged accuracy penalty. Venom injected by a bite
is a different fiction and a different shape (longer, more damage, no accuracy penalty).
Both stay poison-tagged and both feed the same `poison` resistance channel.

Poison resistance already works end to end without further change: tick damage routes
through `resolveEffectSequence` → `resolveDamage`, which applies the bearer's `poison`
resistance. A hero in poison-resistant gear takes less venom damage today.

### 2. Monster `onHitConditions` (content schema v15 → v16)

`monsterEntry` gains:

```yaml
onHitConditions:
  - conditionId: condition.poisoned
    chance: 0.35      # probability, 0..1
    duration: 6       # optional override; null → the condition's own default
```

- Zod: `z.array(z.strictObject({ conditionId: stableIdSchema, chance: probability,
  duration: safePositive.nullable().default(null) })).default([])`
- `superRefine`: `conditionId`s must be unique and sorted ascending, matching the existing
  `traits` rule on `conditionEntry`. Sorted content means a fixed rider evaluation order,
  which means a fixed RNG draw order.
- `monsterIssues` validates each `conditionId` through the existing `referencedKindIssue`
  helper against kind `condition`, the same way `lootTableId` is checked today.

Defaulting to `[]` means every existing monster YAML stays valid as written; the schema bump
is for the new field, not for a rewrite.

### 3. Riders on the poison-tagged monsters (content)

The rule is legible from the pack itself: **a monster tagged `poison` applies poison.**
Chance and duration scale with how central venom is to the creature.

| Monster | Tags | chance | duration |
|---|---|---|---|
| `monster.bile-tick` | animal, poison, vermin | 0.25 | default (5) |
| `monster.web-stalker` | spider, poison, offense | 0.30 | default (5) |
| `monster.caustic-pool` | ooze, mindless, poison, caster | 0.40 | default (5) |
| `monster.venom-spinner` | spider, poison, ranged | 0.50 | default (5) |
| `monster.shroud-widow` | spider, poison, elite | 0.60 | 8 |

`monster.gossamer-darter` and `monster.carapace-broodmother` are untagged for poison and get
no rider — they are the spiders that were never advertising venom.

### 4. The engine seam

`combat()` in `combat-profile.ts` is the single chokepoint both monster melee and
opportunity attacks pass through, but it **cannot** host the rider: `combat-profile.ts` is
already the tail of the `conditions.ts → attributes.ts → stats.ts → combat-profile.ts`
import chain, so importing `applyCondition` there closes a cycle.

Instead:

- `CombatResolution` (in `combat.ts`) gains `readonly hit: boolean`. Riders need to know a
  hit landed, and sniffing the event array for `attack.hit` would be a worse contract.
- A new leaf module `attack-riders.ts` imports `combat` (from `combat-profile.ts`) and
  `applyCondition` (from `conditions.ts`) — legal, because nothing in either chain imports
  it back — and exports `combatWithRiders(input)`, structurally compatible with the existing
  `ReactionAttackResult`.
- `action-dispatch.ts` swaps `combat` → `combatWithRiders` at both call sites: the `attack`
  action resolver and the opportunity-attack resolver inside `move`.

Rider resolution, after `combat()` returns:

1. If the attack missed, the target died, or the attacker has no monster definition with a
   non-empty `onHitConditions`, return the combat result untouched. **No randomness is
   consumed** — every existing attack draws exactly the dice it draws today.
2. Otherwise, for each rider in content order, draw one `rollDie(combatState, 10_000)` and
   apply the condition when `value <= Math.round(chance * 10_000)`. This mirrors
   `monster-loot.ts`'s `DROP_CHANCE_RESOLUTION` pattern exactly: integer threshold, no float
   comparison, RNG state threaded forward whether or not the rider lands.
3. Applied riders go through `applyCondition` with `sourceActorId` = the attacker, so the
   existing `condition.applied` projection rule (visible only when both actors are visible)
   governs what the hero sees. No new event type, no projection change.

The rider draw uses the `combat` stream, threaded through `CombatResolution.combatState` —
it is part of resolving an attack, not a separate concern.

Riders fire from **monster** definitions only. A hero attacking with a venom-themed weapon
is out of scope; `combatWithRiders` reads `monsterDefinition(content, attacker)` and does
nothing for a player-controlled actor.

### 5. What does not change

- **No save-schema bump.** `ActorState.conditions` already carries applied conditions and
  already round-trips through `encodeActiveRun`. A poisoned hero saves and reloads today.
- No new `DomainEvent` or `PublicEvent` type.
- No behavior change: a venom-spinner still runs `behavior.approach-and-attack`. The venom
  rides its ordinary attack.

## Testing

RED-first, in this order:

1. `packages/content` — a monster with `onHitConditions` compiles; an unsorted or duplicated
   rider list fails; a `conditionId` pointing at a non-condition entry fails with a
   `referencedKindIssue`; a monster with no `onHitConditions` still compiles and defaults
   to `[]`.
2. `packages/engine/test/attack-riders.test.ts` —
   - a hit from a rider-carrying monster at chance 1.0 leaves `condition.poisoned` on the
     target and emits `condition.applied`;
   - at chance 0.0 it does not;
   - a **miss** applies nothing **and consumes no extra randomness** (assert the returned
     `combatState` equals the no-rider `combat()` result's state for the same seed);
   - a killing blow applies nothing;
   - a player-controlled attacker applies nothing;
   - re-applying refreshes `expiresAt` rather than adding a stack.
3. Determinism: a poisoned run encoded/decoded mid-poison replays byte-identical
   (`encodeActiveRun` equality), covering the save round-trip claim above.
4. Content-pack validation (`npm run content:validate`) covers the five authored riders.

**Demo hashes will drift** wherever a poison-tagged monster lands a hit in a pinned demo
transcript — the rider draw advances the combat stream. Per the repo rule, each drifted hash
gets its transcript delta inspected and the drift explained in the commit message before
re-pinning; a drift in a demo with no poison monster in it is a bug, not a re-pin.

## Docs

- `docs/server-admin/content-configuration.md`: v15 → v16 migration note covering
  `onHitConditions` (optional, defaults to `[]`, so existing packs need no edit).
