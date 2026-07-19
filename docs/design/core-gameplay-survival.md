# Core Gameplay and Survival

**Status:** Shipped (milestone 4A)

**Package:** `packages/engine`

This is the tactical survival loop layered on top of the deterministic engine core and
the dungeon/light systems: eight-direction movement, combat, inventory and equipment,
identification, hunger and fuel, doors/traps/secrets, and rest. It's deliberately scoped
to a single actor/action/effect/scheduling foundation that milestone 4B (populations,
NPCs, run records — see `populations-and-npcs.md` and `run-records.md`) builds on without
changing.

## Attributes

Five base attributes: Might, Agility, Vitality, Wits, Resolve. Balance YAML defines
bounded formulas and coefficients for derived stats (max health, melee/ranged accuracy,
damage, defense, reaction reach, search/disarm, condition resistance). Derived values are
always calculated by pure functions from base attributes, equipped content, conditions,
and run effects — saves store inputs and current resources, never duplicated derived
totals, so a formula change can't desync from a stale saved number.

## Integer-energy scheduling

The world clock (`worldTime`) and per-actor integer `energy`/`speed` replace a naive
turn-by-turn loop. Normal readiness threshold and normal action cost are both `100`.
Selection rule, in order: pick the ready actor with greatest current energy, then
player-controlled priority, then stable actor ID. If the hero is selected, control
returns to the player. Otherwise the selected non-player actor's action resolves and its
cost is subtracted. When nobody is ready, `worldTime` advances by the smallest integer
step that makes someone ready, and every actor's energy increases by `speed × elapsed`.

This is what makes speed differences mean something concrete: a faster actor can act more
than once before an equal- or lower-speed hero gets another turn, purely from
accumulated energy, with no special-cased "extra turn" logic. Every time-based system
(hunger, fuel, conditions, recovery, mutable features) applies exactly at the clock
advances that cause it — not on a fixed per-command cadence — so nothing can be starved
or double-applied by how many actions happen to occur between world-time steps.

Town (added milestone 5C) deliberately does **not** advance `worldTime` even though `turn`
and `revision` still advance — see `guest-client.md`'s town section for why this is the
mechanism behind "town costs no hunger or fuel."

## Movement

Eight directions (orthogonal + diagonal) at equal cost. A diagonal step is illegal when
*both* orthogonally adjacent side cells block movement — this prevents squeezing through
a sealed corner while still permitting movement past one blocked side (the same rule the
light/sight system uses for corner-peeking, applied to physical movement). Moving into a
hostile actor becomes a melee attack; moving into a neutral or friendly actor is blocked
outright — bumping a neutral actor never attacks it implicitly.

## Combat

Attack resolution consumes only the `combat` stream: roll d20 (natural 1 always misses,
natural 20 always hits and crits unless declared immune); otherwise `roll + accuracy`
must meet or beat target defense; on hit, roll structured damage dice plus modifiers
(doubled dice, flat modifiers once, on a crit); apply armor and typed resistance/
vulnerability/immunity with checked arithmetic. A successful damaging hit deals at least
one effective point unless immunity explicitly zeroes it. Damage types: physical, fire,
cold, poison, arcane.

Ranged attacks require a legal target, configured range, and unobstructed trajectory
through an owned line adapter that respects the same projection hidden-state rules as
everything else (no target cell or actor absent from the player's own projection is ever
exposed). Spells, scrolls, potions, thrown items, traps, and weapon abilities all share
one registered targeting/effect pipeline — previews can show known range/cost/modifiers
but never consume randomness or reveal a future result.

### Opportunity attacks

When an actor moves from a hostile actor's reach to outside that reach, every currently
eligible hostile reaction is captured *before* movement resolves, then each eligible
attacker (alive, hostile, aware, `reactionReady`) consumes its reaction and attacks in
stable actor-ID order; a reaction is regained only after completing its own next normal
turn. The rule is symmetric for heroes and NPCs — there's no separate "hero gets
attacked of opportunity" vs "hero triggers one" code path. If the mover dies, remaining
reactions stop; if a reaction roots/stuns the mover, movement is cancelled but other
already-triggered reactions can still resolve.

## Relationships and hostility

Disposition (friendly/neutral/hostile) is saved state, not inferred purely from monster
vs. NPC content kind — this is what lets a neutral merchant become hostile after
provocation (see `populations-and-npcs.md`) without a parallel relationship model. Only
currently hostile and aware actors participate in opportunity attacks; explicitly
attacking a neutral target requires confirmation (`confirm-aggression`) and establishes
hostility before the attack resolves, and that hostility survives save/load.

## Inventory and equipment

Backpack capacity is a **count of occupied stack slots**, not weight. Items merge only
when content ID and every stack-relevant property agree (identity knowledge, charges,
fuel, enchantment, condition). Equipment slots: main hand, off hand, body, head, hands,
feet, neck, left ring, right ring. One-handed weapons, shields, and carried lights all
compete for hands; two-handed gear reserves both — this is the deliberate offense/
defense/visibility trade-off a carried light source creates. Equip/unequip is atomic:
if a displaced item can't fit back in the backpack, the whole command is invalid and
consumes no time. The engine never silently drops gear.

## Identification

At run creation, the `effects` stream deterministically assigns each unidentified potion/
scroll definition a shuffled verb-noun appearance name from its content-defined
identification pool — the mapping is saved once in hidden run state and never
regenerated. Using an unidentified item applies its effect *and* identifies that
appearance for the current hero; identifying one appearance reveals all current and
future matching instances in that run. Enchanted equipment carries hidden per-instance
properties revealed only through an explicit examination/use/spell/service effect —
identifying one instance never auto-identifies others. All identification knowledge is
scoped to the hero and ends with the run; a later profile/session codex can remember
*that content exists* but never a future run's shuffled mapping (see `guest-client.md`'s
codex section).

## Hunger and fuel

Both advance from elapsed dungeon time, not command count — this is why town (frozen
`worldTime`) doesn't drain either. Hunger is a bounded reserve with `sated`/`hungry`/
`weak`/`starving` thresholds; no threshold transition is instant death, but starvation
applies recurring damage. Fuel belongs to the light item instance; enabled lights consume
exact integer units as time advances, emit warnings at configured thresholds, and go dark
at zero (which immediately refreshes perception). Refueling transfers exact units between
compatible items with no duplication or loss.

## Doors, traps, secrets, search

Doors are mutable features (closed/open/locked/registered-special); closing fails without
consuming time if the doorway is occupied. Hidden traps and secrets carry a deterministic
discovery difficulty and never appear in projections until discovered or triggered.
Entering or newly illuminating a feature's search area grants exactly one passive
discovery contribution (based on Wits, illumination, modifiers) — the saved feature state
records that the passive check already happened, so reload/re-projection can't grant a
free extra roll. Explicit **Search** is a time-consuming action with reduced-but-nonzero
effectiveness on repetition without changing position/light/tools/conditions, so eventual
discovery is guaranteed at a resource-and-danger cost rather than through reloadable
lucky rolls. Disarm uses the `effects` stream and a registered skill check with authored
success/safe-failure/tool-damage/trigger outcomes.

## Rest

Rest is a bounded repeated-wait through the same scheduler/world-time machinery as
ordinary play — never a direct health assignment or actor skip. It stops on: full
recovery, a configured max duration, a visible danger or aware hostile, damage or forced
movement, a meaningful sound event, a hunger/fuel threshold, a condition change, a
decision request, or hero death. Hunger, fuel, creatures, traps, conditions, and recovery
all continue normally during every internal rest step — resting is not a time-skip that
bypasses the simulation.
