# Champion casting — Design (haunts that use what they recorded)

**Issue:** #192 (runtime champion/echo casting). **Date:** 2026-08-04. **Status:** approved.

## Goal

Make a caster's haunt cast. The hero power curve records `signatureAbilityIds` on every fallen-hero standing, validates them, and projects them onto the placed champion — but `behavior.ts` never reads `abilityIds`, so a haunt advertises a spell list it cannot use. This closes that gap for the two populations that carry the data.

The recorded spells become a weave-budgeted ranged threat: a champion that opens dangerous at distance and burns down as its pool drains, with closing the gap as the player's readable counter-play.

## Non-goals

- **No new persisted shape, and therefore no save-schema bump.** Every piece this needs already exists and is already validated: `CastAction`, the `spell.cast` event, `sound.heard`, and `weave`/`maxWeave` on every actor.
- **No aimed or area spells.** `target.line`, `target.burst`, `target.cone`, and `target.cell` need aim-point selection and friendly-fire rules; a recorded ability of those kinds is ignored by the caster. They are a follow-up once the basic loop is proven in play.
- **No casting for ordinary monsters.** Only `ChampionPopulation` and `EchoPopulation` carry `abilityIds`; nothing in this design gives any other monster a spell.
- **No cooldowns.** Weave alone paces the caster (see "The weave pool").
- **No new RNG.** The decision is a pure function of state; the only randomness is what the spell's own effects already draw from the `effects` stream.

## Scope

Champions and echoes cast spells whose `targetingId` is `target.actor` or `target.self`, paying the spell's `weaveCost` from their own pool and its `actionCost` in energy.

## The weave pool

`champion.ts` currently spawns champion and echo actors with `maxWeave: 0` — a placeholder from before anything could cast. It becomes a real derivation: `deriveActorStats` over the standing's already-clamped attributes — not `deriveRunActorStats`, because the placed actor is not yet in `state.actors` at construction time, so an equipment-modifier lookup by actor id would find nothing to look up — with `weave` starting full.

This derivation runs for every placed champion and echo, not only ones carrying spells: `maxWeave` is a property of the haunt's attributes, unconditional on `abilityIds`. A spell-less haunt (either haunt in the population demo, for instance) ends up with a real Weave pool it simply never spends.

Weave regeneration is hero-only: `survival.ts` restores weave to the hero actor and `rest.ts` refills only the hero. A champion's pool is therefore a one-way per-encounter budget — it opens dangerous and fades — with no new mechanism needed to enforce that shape.

**Legacy consequence:** a champion already placed in an existing save keeps `maxWeave: 0` and will never cast. This is deliberate and needs no migration; the next placement derives correctly. `validateContentBoundRun` compares a placed population's `abilityIds` and `equipmentContentIds` against the normalization, not the actor's weave, so an old actor stays valid.

## The decision — `behavior.ts`

A new `championCastAction({ state, actorId, content })` returns `CastAction | null`, mirroring `swarmSpawnAction`'s shape and placement. It is called inside `chooseBehaviorAction` **after** the adjacent bump-attack branch — so adjacency still means melee — and before the swarm-spawn check.

It returns `null` unless all of:

- the actor's population is a champion or echo with a non-empty `abilityIds`
- a hostile, aware target exists (the same target the melee branch resolves, so goal-locking behaves identically)
- the target is at distance > 1

Candidates are `abilityIds` resolved to spell entries in the pack, then filtered by kind:

- **`target.actor`** — affordable (`weaveCost <= actor.weave`), target within `spell.range`, and legal per the existing `validateTarget` call, so line of sight and illumination bind the champion exactly as they bind the hero.
- **`target.self`** — affordable, and *useful*: the spell has a heal effect and the champion is below `maxHealth`, or it applies a condition the champion is not already carrying. A self spell that would do nothing is skipped, so a champion cannot burn its pool re-buffing itself every turn. The gate reads existing condition state; it adds no bookkeeping.

Attack candidates outrank self candidates. Within each group, ranking is highest `weaveCost` first with `compareCodeUnits(spellId)` as tie-break — the same comparator `run-finalize`'s `signatureAbilityIds` and `champion.ts`'s narrowing use, so "the champion's signature spells" means one thing everywhere in the codebase.

The returned action carries `cost: spell.actionCost` and `weaveCost: spell.weaveCost`. The whole decision is a pure function of state and **consumes no randomness**.

## Resolution — nothing new

`ACTION_DISPATCH.cast` in `action-dispatch.ts` is already caster-agnostic: it derives `spellPowerFor` from the acting actor, deducts `weaveCost` from that actor before effects resolve, emits `spell.cast`, and resolves the spell through `resolveEffectSequence` against the `effects` stream. `applyAction` already routes any actor's action through that table from `world-step`, and `chooseBehaviorAction`'s result flows straight into it.

A monster cast therefore reuses the hero's resolver verbatim. This is what makes power-curve amendment 9's monster/champion parity claim true in fact rather than in principle: parity holds because `spellPowerFor` derives from whatever actor is casting, and there is exactly one cast resolver.

## What the hero sees — and the leak this exposes

`event-projection.ts` currently pushes `spell.cast` **unconditionally**, grouped with hero-only events like `spell.learned` and `hero.tempered`. That is harmless while only the hero casts, and becomes a leak the instant a champion does: the client would learn of an unseen caster's existence, identity, and spell.

`spell.cast` moves into a perception-gated branch:

- **Seen** (`actorVisible(event.actorId)`) — projected as today, naming caster and spell. The hero's own casts are unaffected, since the hero is always visible to itself.
- **Unseen** — projected through the existing `sound()` helper as `sound.heard` with `category: 'combat'`: direction and distance band only, no caster, no spell name, and already subject to the helper's own 12-tile cutoff. This is the codebase's established "something is out there" channel, so the hint costs no new event variant.

The hero still feels an unseen champion's spell, because the effect events (`actor.damaged`, `condition.applied`) project on their own existing terms.

## Testing

Engine:

- the pool is derived at spawn, and a legacy actor with `maxWeave: 0` never casts
- casts at range; never casts when adjacent (bumps instead)
- skips an unaffordable spell, one out of range, one blocked by line of sight, and one whose targeting kind is unsupported
- picks the costliest affordable attack spell; ties break by id
- the self-cast usefulness gate both ways: cast when wounded / condition absent, skipped when at full health / condition already carried
- attack outranks self when both are legal
- weave decrements by `weaveCost` and the champion stops casting when the pool cannot pay
- the decision consumes no randomness: RNG streams are byte-identical across a `chooseBehaviorAction` call that returns a cast
- `encodeActiveRun` round-trips a run in which a champion has cast

Projection:

- a seen cast names caster and spell; an unseen cast yields `sound.heard` and never the caster's id or the spell id
- the hero's own casts project exactly as before

Determinism gate: the hash-pinned demos are expected not to drift, since a champion only carries abilities when seeded from a hall record of a spell-knowing hero. That is verified against the transcripts, not assumed — and any drift is explained before anything is re-pinned.

## Amendments this closes

- **Power curve amendment 12** — "Champions/Echoes cast them through the existing ability machinery" assumed casting machinery that did not exist. This design builds the consumer the recorded data was waiting for.
- **Power curve amendment 13** — the echo's prefix slice kept the alphabetically-first spell rather than the costliest. Already fixed ahead of this spec (PR #218): both narrowing sites re-rank by cost and re-sort by id.
