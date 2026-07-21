# Weave — magic resource

Adds a spendable magic resource ("the Weave") that spellcasting consumes. Today casting is
free — spells have `targetingId/range/actionCost/effects` and no cost. The Weave gives magic
a cost/regen economy and a HUD meter, mirroring how HP works. Thematically the Weave is the
fabric that binds the Deep (ties to `endgame-final-chamber.md`).

## Decisions (from the user)

- **`maxWeave` = base + Wits.** A new derived stat, formula authored in balance content
  exactly like `maxHealth: { base, vitality }` → `maxWeave: { base, wits }`. Aggregates
  through `deriveActorStats` like every derived stat.
- **Regen: slow per-turn + full on rest.** Weave trickles back a small amount each turn the
  hero acts (mirroring the HP `recoveryAmount` path in `survival.ts`), and rest restores it
  to full (mirroring `rest.ts`'s heal-to-full).
- Heroes start at full Weave. Per-spell costs are authored content (sensible defaults).

## Model

- **Current value:** add `readonly weave: number` to the hero actor state (sibling to
  `health` in `actor-model.ts`), clamped to `[0, maxWeave]`. Save-schema: add `weave` to the
  actor schema + its drift guard; migrate old saves (default to `maxWeave` = full).
- **Derived stat:** `maxWeave` added to `DERIVED_STAT_NAMES` (single-sourced `as const`);
  `{ base: N, wits: M }` formula in `content/balance/core-gameplay.yaml` and the demo
  `fixture.ts`. Sensible starting values (e.g. base 4, wits 1 → ~13 for a wits-10 hero);
  tunable.
- **Spell cost:** add `readonly weaveCost: number` to `SpellContentEntry` + its Zod schema;
  author a cost on each existing spell (e.g. `spell.ember-bolt`: 3). Content bump.

## Behaviour

- **Cast gating + consume:** the `cast` command requires the hero's current `weave >=
  spell.weaveCost`; if insufficient, reject with a new closed reason (e.g.
  `'cast.insufficient-weave'`) — the "The Weave slips through your fingers" case — consuming
  no randomness and advancing nothing. On a successful cast, subtract `weaveCost` from
  `weave` (before/alongside the existing effect resolution; order fixed and documented).
- **Per-turn regen:** in the same world-step survival path that regenerates HP
  (`survival.ts`), regenerate Weave by a small per-turn amount (a `weaveRegenAmount` balance
  value), clamped to `maxWeave`. Deterministic (no RNG).
- **Rest:** rest restores `weave` to `maxWeave` alongside the HP heal (`rest.ts`).

## Determinism

Consume-on-cast and per-turn regen happen inside the deterministic world-step, so this
**changes behaviour** — the demo-hash fixtures move for real (a demo that casts/rests now
also moves Weave). Regenerate the affected `*-demo-hashes.json` intentionally and eyeball the
diffs (a legitimate behaviour change, distinct from the content-hash-embed class). No new RNG
stream; no `Math.random`/`Date.now`.

## Client

The Play-view hero panel gains a **WEAVE** meter (value/max + bar) beside VITALITY/LIGHT/
HUNGER, reading a projected `weave`/`maxWeave`. The "not enough Weave" rejection surfaces in
the log like other closed reasons. (The faithful UI redesign's WEAVE bar becomes grounded
once this ships.)

## Testing

- Engine: `maxWeave` derives from base+Wits; cast consumes `weaveCost` and is rejected below
  cost (`cast.insufficient-weave`) with no state advance; per-turn regen trickles + clamps to
  max; rest restores to full; save round-trip of the new `weave` field + migration of a
  pre-Weave save (defaults to full).
- Content: spells carry a valid `weaveCost`; `maxWeave` formula compiles.
- Web: the WEAVE meter renders value/max from the projection.
- Determinism: the intentionally-regenerated demo hashes verify; the diff is the Weave
  consume/regen behaviour, nothing unexplained.

## Out of scope

- Weave-cost scaling/discounts, Weave-related feats/items (they'd plug into the derived stat
  later, like the light-out feats do), and any UI beyond the HUD meter.
