# Monster Populations and Dungeon NPCs

**Status:** Shipped (milestones 4B1 population encounters, 4B2 dungeon NPCs)

**Package:** `packages/engine`, content in `content/encounters/`, `content/monsters/`,
`content/npcs/`, `content/npc-factions/`

Turns the single-creature demonstration policy from milestone 4A into deterministic,
YAML-authored dungeon populations: independent gates for rare content, four population
models, readable broad intent without leaking hidden state, and a neutral-NPC framework
whose first (and so far only) inhabitant is the travelling merchant.

## Run-level appearance gates

Every population — monster or NPC — has a `runAppearanceChance` evaluated **once**, at
run creation, from the dedicated `population-gates` stream, separately from per-floor
placement (`encounters` stream). A failed roll excludes that population for the entire
run; a successful roll only makes it *eligible* for its declared depth bands, weight, and
instance limits — repeated floor rolls can't make rare content inevitable just by
generating enough floors. Foundational populations use chance `1.0`; boss defaults are a
low `0.08` with `discoveryProtectionIncrement: 0.03` and `discoveryProtectionCap: 0.35`.

**Discovery protection**: if a hero reaches an eligible depth band and completes the run
without ever legitimately observing that population, its next-run chance increases by the
increment (capped). Legitimately observing it — encountering it, whether or not it's
defeated — resets the bonus to zero. This is a pure engine boundary (input: prior
bonuses; output: sorted updates); the host repository persists it (session-local for
guests, server-side for profiles — see `run-records.md`).

## The four population models

- **Individual** — spawns independently; no group communication or coordination unless an
  effect explicitly grants it.
- **Group** — members share a group ID and communicate detected-sound/last-known-hero-
  position within a configurable Chebyshev radius via a bounded relay (informed members
  relay to others in range, who can relay further in the same pass — stable breadth-first
  over sorted actor IDs). Shared information is never the hero's *current* hidden
  position, only where/when they were last legitimately seen. Groups declare a formation
  (`cluster`/`line`/`screen`/`wedge`/`surround`), a leader chance, and exactly one
  leader-death response: `weaken`, `panic`, `disband`, `surrender`, `frenzy`, or
  `collapse` (collapse requires an explicit `supernaturalBond: true` flag and destroys/
  disables linked members immediately, with no individual kill credit by default — this
  stops leader-focus-fire from accidentally multiplying loot).
- **Swarm** — a visible source (nest/queen/portal/corpse mass) owns the spawn timer;
  spawned children never own their own timer. YAML defines creature mix, interval,
  placement rules, per-source/per-encounter/floor-wide caps, and a source-destruction
  response (`stop`/`flee`/`decay`/`frenzy`). **Groups and swarms freeze completely while
  their floor is inactive** — re-entering a floor never applies missed growth. This
  supersedes an earlier design assumption of off-floor growth and makes fleeing a
  dangerous floor a real containment strategy rather than a delay.
- **Boss** — a unique individual (`maximumInstancesPerRun: 1` per boss ID, though several
  distinct bosses can appear in one run). Ordered health-percentage thresholds trigger
  irreversible phase transitions (behavior override, modifiers, new effects); a living
  boss recovers health from elapsed world time up to a configured cap on re-entry (a
  transition calculation, not off-floor turn simulation) — this prevents "retreat, heal
  off-floor for free, repeat" without fully resetting the fight. One guaranteed unique
  reward plus an enhanced loot table, both idempotent under retries/replay.

## Broad intent

Before a ready hostile actor acts, it deterministically selects and saves one broad
intent from a closed set: `approach`, `attack`, `hold`, `regroup`, `flee`, `protect`,
`spawn`, `phase-change`. Every currently visible hostile exposes this intent to the
player — exact path, target scoring, hit/damage rolls, future phase thresholds, and spawn
rolls stay hidden. If state invalidates a saved intent before it resolves, the actor
falls back to `hold` rather than executing stale authority. Pathfinding uses a project-
owned A* adapter over ROT.js (candidate path only — the normal movement validator
rechecks the chosen step when it actually resolves).

## The Deep's Champion and Echoes

The current profile/guest session's **highest-scoring unconquered dead hero** becomes an
optional named boss, `<Hero Name>, the Deep's Champion`, at the depth where that hero
died. It appears exactly once, outside normal boss gates and discovery protection, in an
optional side arena that can never block stairs/routes/objectives — defeating it is never
required. Recorded build data (attributes, equipped items, ability tags) determines
flavor and available normalized choices, but a strict `fallen-champion` YAML template
always controls actual current-depth-appropriate health/damage/defense/phases —
historical state can never bypass current caps or create an unbeatable boss.

The heirloom reward is selected **once**, at the original hero's death, by one weighted
roll over that hero's *equipped* item instances only (never backpack items — the design
intent is "something the fallen hero valued enough to use at death"). Weights favor
rarity/quality but every eligible instance keeps positive weight; if nothing is eligible,
a documented fallback relic is used instead. The selection is stored in the Hall record
and never rerolled. Once conquered, that Champion never reappears in that profile/session.

Ranks 2–10 by score may independently become weaker `Echo of <Hero Name>` encounters,
capped at two per run via one hidden per-Echo appearance roll at run creation (lowest
raw rolls retained, ties broken by rank then record ID — this avoids biasing by rank
order while staying deterministic). Echoes use the template's enhanced ordinary loot,
never the recorded heirloom, and grant a lower-tier first-defeat achievement separate
from the Champion's.

## Travelling merchants (dungeon NPCs)

The first (and so far only) neutral dungeon NPC type. A merchant reuses the whole
population framework — same run-gate, placement, saved intent, pathfinding — plus:

- **Finite, deterministic stock**: rolled once at creation from a dedicated
  `merchant-stock` stream (lifetime, loot-table stock/quantities, service use counts),
  materialized and saved; never rerolled by re-entry, trade, or reload. Separating this
  from the `encounters`/`combat` streams means adding a new merchant item never perturbs
  placement or AI determinism.
- **Explicit modal transactions**: `trade-open`/`trade-buy`/`trade-sell`/`trade-service`/
  `trade-close` commands. Opening requires a living, visible, adjacent, available, non-
  hostile merchant not due to depart, with no other transaction open, whose current
  reputation tier accepts trade. While open, non-trade commands are rejected — this makes
  the session an explicit authoritative state, not a UI convention. Commerce commands
  advance the revision but consume **no** actor energy, dungeon turn, hunger, fuel, or
  world time — nothing else acts between trade commands.
- **Faction reputation**: hero-scoped, per-faction, tiered (each tier: price multipliers,
  trade-acceptance, available services). A merchant population's commerce reputation
  bonus can be granted **at most once in its lifetime**, guarded by a saved one-time flag
  so replay/dedup can't double-apply it.
- **Departure on global time, not floor time**: `departureAt` is absolute world time;
  warnings fire once even for an off-floor merchant; a due merchant never departs mid-
  transaction (trade consumes no time, so a valid transaction can't newly cross the
  deadline — if one is somehow recovered already-due from a save, automatic closure
  resolves first, then departure).
- **Self-preservation**: deliberately attacking a neutral merchant atomically closes any
  open transaction (no commerce bonus), applies the aggression reputation penalty once,
  makes the relationship hostile, drops a configured fraction of remaining stock once,
  and enters the merchant's authored `flee` or `self-defense` response. Hostile creatures
  don't target merchants by default — only an explicit relationship override, faction
  rule, or direct/collateral damage makes them a valid threat.

Pricing uses basis-point multipliers with checked-integer, no-floating-point arithmetic:
purchases round up, sales round down, so the travelling merchant is consistently less
favorable than town commerce (see `guest-client.md`) by design, not by accident.

## Player projection

Visible hostiles expose name/glyph/color/health-band/disposition/broad intent and (for
group leaders) their accent distinction. The Champion and Echoes expose the original
hero's name, glyph, and normalized build presentation. A visible merchant (outside an
active transaction) exposes presentation, faction, health, broad intent, qualitative
reputation tier, and trade availability — never exact stock, exact deadline, rolled
service-use counts, future stock-drop state, or path. What the player never receives,
full stop: failed/successful unseen run-gate rolls, discovery-protection counters,
unseen encounter/actor/role/source/reward IDs, exact AI goals or path candidates, future
spawn composition or phase thresholds, or hit/loot rolls before they resolve.
