# Magic System — Engine/Content/Server (Spec A) — design spec

**Status:** design (brainstormed with the user 2026-07-23). First of two sequenced specs; **Spec B
(the client casting UI) is a separate follow-up** and is out of scope here.

Delivers a full, server-authoritative magic system as **engine + content + server**, proven headless
via a deterministic demo and the cross-process parity harness. The player-facing casting UI
(spellbook panel, cursor targeting, AoE shape preview) is deliberately deferred to Spec B; this
milestone exposes everything Spec B needs through the existing cast command + projection.

Builds on merged 6C (verified Hall). Branch `feat/magic-engine` off `main`.

## What already works (do NOT rebuild)

The survey confirmed most plumbing exists and is non-stubbed:

- **Casting** is a complete feature: `CastCommand { spellId, target: Point | null }` →
  `actions.ts` cast branch (Weave gate → target resolve → dry-run `resolveEffectSequence`) →
  `action-dispatch.ts` cast handler (debits `actor.weave`, applies effects). Same validate-then-commit
  shape as `use-item`/`fire`/`throw-item`.
- **Weave** is a real actor resource: `weave` / `maxWeave` on the actor (`actor-model.ts`), set at
  run start (`new-run.ts`), spent at cast time, restored to full on completed rest (`rest.ts`
  `restoreHeroWeaveToFull`). `weaveRegen` is a derived stat (`DERIVED_STAT_NAMES`) computed from
  balance + class formula but **currently only consumed on full-rest** — there is no per-turn regen.
- **Known spells**: `knownSpellIds?: readonly OpaqueId[]` is first-class on hero state
  (`model.ts`), persisted in the save schema (`save-schema/population.ts`), and granted **once** at
  chargen from the class's `startingSpellIds` (`chargen.ts`). There is **no runtime learn mutation** —
  `knownSpellIds` is only ever set at creation.
- **Scrolls** are consumable items whose `effects[]` include `effect.item.consume`, read via the
  generic `use-item` action. `content/items/ember-scroll.yaml` currently **duplicates**
  `spell.ember-bolt`'s effects inline (no back-reference to the spell) — a content-duplication smell
  this spec resolves.
- **Timed conditions**: `condition` entries carry `duration: { mode: 'permanent'|'timed', default,
  maximum }`; `applyCondition` sets `expiresAt = worldTime + duration`; `advanceConditions({ worldTime })`
  sweeps and expires. `effect.condition.apply` already accepts a `duration` override — so a "3-turn
  slow" is authorable today with **no engine change**. Conditions currently only **expire**; they do
  not tick per-turn effects.
- **Merchant system** is fully data-driven (`npc` + `loot-table` + `encounter`); permanent town
  merchants live at depth-0 town merchant slots (`new-run.ts` `townMerchantSpecs`) and restock as the
  hero descends (`merchant-stock.ts`). Reusable for a spell vendor with **zero engine change**.
- **Floors persist** in the run: `run.floors: readonly FloorSnapshot[]` + `activeFloorId` +
  `activeFloorEnteredAt` (`model.ts`); floor transitions switch `activeFloorId` among persisted
  floors. Recall reuses this.
- **Determinism model**: all RNG is explicit `Uint32State` threaded per named stream (`rng.effects`,
  `rng.merchant-stock`, …) via `random.ts` (`rollDie`/`rollDice`/`nextUint32`); never `Math.random`.
  `resolveEffectSequence` operates on **exactly one** `targetActorId`.

## Net-new work (what this spec builds)

### 1. Items & the learn loop

- **Both scrolls and tomes reference a `spellId`** (single source of truth). Add an optional
  `spellId?: ContentId` to the relevant item model + zod schema; validate it resolves to a `spell`
  entry. Migrate `ember-scroll.yaml` to reference `spell.ember-bolt` instead of duplicating its
  effects.
- **Scroll = cast-once**: reading a scroll resolves the referenced spell's effect(s) at the chosen
  target using the spell's targeting/range, then self-consumes (`effect.item.consume`). **No Weave
  cost, no caster aptitude required, no learning.** Usable by any class. (An AoE scroll uses the
  spell's AoE — same sweep as a cast; see §3.)
- **Tome = learn-forever**: a new `effect.spell.learn` (parameters: `{ spellId }`) appends `spellId`
  to the hero's `knownSpellIds` (the first runtime mutation of that array), then the tome
  self-consumes.
  - Reading a tome **requires caster aptitude** (see §2). A non-caster reading a tome gets a typed
    rejection (`learn.no-aptitude`) and the tome is **NOT consumed**.
  - **Re-learning a known spell** is a no-op rejection (`learn.already-known`); the tome is **NOT
    consumed** (no wasted item).
- **Scrolls are identified/named in v1** — no unidentified-scroll gamble. The identification-pool
  layer for scrolls is explicitly deferred (future work).

### 2. Spells & schema

- `SpellContentEntry` gains an optional AoE descriptor:
  `aoe?: { shape: 'burst' | 'line' | 'cone'; radius: number }`. Absent ⇒ single-target (today's
  behavior, unchanged). Mirror in the zod schema (`radius` positive integer; `shape` enum).
- Add targeting ids `target.burst` and `target.cone` to `TARGETING_IDS` (joining existing
  `target.line`). A spell's `targetingId` + `aoe` together describe how the client aims and how the
  engine resolves cells.
- **Class caster aptitude**: add `casterAptitude: boolean` (default `false`) to the class model + zod
  schema. `content/classes/loomcaller.yaml` sets `casterAptitude: true`. This gates tome-learning and
  **casting from memory** (a class without aptitude cannot cast a `knownSpellId`, even if one were
  somehow present). Scrolls ignore it.
- Elements reuse the existing damage-type + resistance/immune system in `combat.ts` (fire / frost /
  storm). "School" grouping stays freeform `tags`. No new element enum.

### 3. AoE targeting + deterministic multi-actor sweep (the core engine work)

- **Targeting** (`targeting.ts` / `validateTarget`): return a populated `cells: readonly Point[]` for
  each shape, honoring line-of-sight / opacity:
  - `burst`: all cells within Chebyshev distance `radius` of the aim cell (aim cell must be within the
    spell's `range` of the caster and in LoS).
  - `line`: bresenham path from caster toward the aim cell up to `range`, stopping at opaque tiles
    (reuses existing line path code, now used to collect **all** cells, not just an LoS check).
  - `cone`: a wedge of `radius` depth from the caster in the aimed direction (new geometry helper,
    deterministic, pure).
  Single-target spells (no `aoe`) keep returning a single resolved actor/cell exactly as today.
- **Sweep** (`effects.ts`): add a function alongside `resolveEffectSequence` that, given the resolved
  `cells`, applies the spell's `effects[]` to **every actor occupying those cells except the caster**
  (a spell may opt in to include the caster via a flag on the effect/spell, e.g. a self-buff burst;
  default excludes caster). Requirements:
  - **Stable deterministic order**: collect affected actors, sort by `actorId` (a stable content/opaque
    id), then fold the `effectsState: Uint32State` RNG thread **forward actor-by-actor** — actor N+1
    rolls from the state actor N returned. Re-simulating the cast is bit-identical regardless of actor
    array iteration order. Single-target casts consume RNG identically to today (one actor).
  - Preserve the **dry-run-then-commit** shape: `actions.ts` validates (Weave gate before any RNG,
    then a speculative sweep to catch invariant violations) and `action-dispatch.ts` commits. An
    invalid cast mutates neither state nor RNG.
  - Emit the same per-actor domain events (`attack.hit`, `actor.damaged`, `actor.died`, condition
    events) for each affected actor, in the stable order.
- No new command shape: an AoE cast is still `CastCommand { spellId, target: Point }`; the dispatcher
  gathers the multiple candidates from `cells` instead of one `candidate`.

### 4. Durations — buffs, wards, debuffs (reuse conditions)

- **Shield** (temporary armor/absorb) and **Ward** (element resistance) = `effect.condition.apply`
  targeting a `timed` condition whose `modifiersPerStack` add armor / resistance. **No new engine
  code** — condition modifiers already feed the stat/mitigation pipeline.
- **Slow / Weaken** debuffs = `timed` conditions with negative modifiers (reduced speed / reduced
  damage). **No new engine code.**
- **One damage-over-time "burn"** needs a minimal addition: extend the condition sweep so a condition
  may carry `tickEffects` (a small `EffectDefinition[]` applied to the bearer each world-step tick,
  e.g. 1 fire damage). Implement in `advanceConditions` (or a sibling `tickConditions`) — RNG-threaded
  via the effects state, applied in a stable per-condition order, deterministic. Keep it minimal:
  fixed or dice tick damage, honoring resistance/immune via the same `resolveDamage`. (If deferred, all
  debuffs would be modifier-only; the user approved including the burn tick hook.)

### 5. Recall — town portal, return to same depth

- **`effect.recall`**: sets the run's `activeFloorId` to the town floor (`TOWN_FLOOR_ID`) and records
  a `returnAnchorFloorId` on the run (the floor the hero left). Reuses the existing floor-transition
  path; the anchored floor stays resident in `run.floors` (floors persist), so its layout, entities,
  and knowledge are preserved. Add `returnAnchorFloorId?: OpaqueId` to the run model + save schema.
- **Return portal**: town gains a return-portal feature that, when used, transitions the hero back to
  `returnAnchorFloorId` (a normal floor transition to a persisted floor) and clears the anchor.
- Only **one anchor** at a time: recasting recall overwrites `returnAnchorFloorId`; using the portal
  clears it. Recall cast while already in town is a no-op rejection (`recall.already-town`).
- Recall places the returning hero on the town floor's hero-entry slot; the return portal places the
  hero on the anchored floor's stored hero position (or its down-stair slot if the stored position is
  unavailable).

### 6. Spell merchant, caster gating, per-turn Weave regen

- **Spell vendor (content-only)**: a new permanent town merchant — `npc.town-spellvendor`
  (`behaviorId: npc-behavior.travelling-merchant`, `permanent`), `encounter.town-spellvendor`,
  `population.town-spellvendor`, a new town merchant slot in `townMerchantSpecs` (or reuse an existing
  slot pattern), and a `loot-table.town-spellvendor-stock` whose `choices` reference the new **tome**
  and **scroll** item ids. Reuses `merchant-stock.ts` restock-by-depth. **Zero engine change** beyond
  registering the town merchant spec.
- **Per-turn Weave regen (enabled)**: consume the existing `weaveRegen` derived stat in the per-turn
  world-step actor tick (where survival/hunger ticks happen), clamping `weave` to `maxWeave`. Casters
  recover Weave gradually in the dungeon, not only on full-rest. Deterministic (no RNG; pure integer
  add + clamp). Rest-to-full behavior stays.

### 7. Content — the ~14-spell spellbook

Author ~14 spells across fire / frost / storm / ward, each with its tome (learn) and, where sensible,
a scroll (cast-once). Every mechanic below MUST be exercised by at least one shipped spell:
single-target, burst, line, cone, instant damage, DoT (burn), shield, ward/resist, slow/weaken, and
recall. Indicative set (final names/values tuned during the plan against `content/balance`):

- **Fire**: Ember Bolt (single, instant) · Fireball (burst, instant + burn DoT) · Cinder Breath (cone,
  instant)
- **Frost**: Frost Shard (single, instant) · Frost Nova (burst, instant + slow) · Rime Ward (self,
  frost resistance, duration)
- **Storm**: Arc Lance (line, instant) · Chain Spark (single, instant) · Static Field (burst, weaken,
  duration)
- **Ward/utility**: Weave Shield (self, armor, duration) · Aegis (self, all-element resistance,
  duration — a fixed effect, no per-cast element selection) · Enervate (single/burst, weaken over
  time) · Mend (self heal, instant) · **Recall** (self, town portal)

Note: no spell requires selecting a parameter beyond the target `Point` — every effect is fixed by the
spell entry, so the cast command shape (`spellId` + `target`) is sufficient and Spec B's UI needs no
per-cast option picker.

Balance is authored in existing `content/balance` + per-spell `weaveCost` / `actionCost` / `range`
scaled so a Loomcaller's Weave pool + regen supports a sustainable but finite casting cadence.

## Determinism & gates

- No `Math.random`; every new roll (AoE per-actor damage, burn tick, any chance) threads and returns
  `Uint32State`, applied in a **stable content-defined order** (sorted by actorId / condition id).
- Two-phase validate/commit preserved for casts, scroll-reads, and tome-learns — invalid actions
  mutate neither state nor RNG.
- A new **`magic:demo`** deterministic replay script + fixture proves the full arc: learn a spell from
  a tome → cast single-target → cast each AoE shape (burst/line/cone) over multiple actors → apply a
  duration buff and a burn DoT and tick them → recall to town and return to the anchored depth —
  asserting a byte-identical projection/state hash (`--verify` mode, like the other demos). The
  existing 7 demos + the cross-process parity harness stay green.
- Server-authoritative: casting, scroll-reads, tome-learns, and recall all run in the engine the
  server owns; **nothing new crosses the client-trust boundary** (the client still sends only the cast/
  use-item intent + a target Point; the server validates aptitude, Weave, and targeting).
- Save-schema additions (`knownSpellIds` already present; new `returnAnchorFloorId`; any new
  condition `tickEffects`) are additive and guarded by the existing save-drift tests.

## Testing

- **Content**: the new spell/scroll/tome/class-aptitude/spell-vendor entries compile under STRICT
  validation; `spellId` references resolve to spells; `casterAptitude` parses; AoE schema validates
  shape+radius.
- **Engine**: AoE cell computation per shape (burst radius, line pierce + opacity stop, cone wedge);
  the multi-actor sweep hits exactly the right actors, excludes the caster (unless opted in), and folds
  RNG deterministically (a test asserting the same multi-actor cast from two different actor-array
  orderings yields identical results/state); `effect.spell.learn` appends once, rejects non-caster
  (tome preserved) and already-known (tome preserved); scroll cast-once by a non-caster works and
  consumes; burn DoT ticks and expires; shield/ward/slow/weaken modifiers apply and expire; `effect.recall`
  sets active floor + anchor, the return portal restores the anchored floor and clears the anchor,
  recall-in-town rejected; per-turn Weave regen ticks and clamps to max; casting a `knownSpellId`
  without aptitude rejected; insufficient-Weave rejected (existing).
- **Determinism**: the `magic:demo` `--verify` fixture is byte-identical; the 7 existing demos + parity
  harness stay green.

## Scope boundary

- **In**: the magic engine (AoE sweep, learn effect, recall, per-turn regen, condition tick hook),
  spell/scroll/tome/class-aptitude schema, the ~14-spell spellbook + spell vendor, server correctness,
  the `magic:demo`.
- **Out (→ Spec B)**: the entire client casting UI — spellbook panel, cursor/keyboard targeting, live
  burst/line/cone shape preview, learn/merchant screens. This spec only ensures the engine exposes what
  that UI will consume (the cast command, `castableSpells` projection, and AoE preview-able targeting
  data).
- **Out (future)**: unidentified-scroll identification pools, spell leveling/upgrading, cooldowns,
  multi-target manual pick, summons/allies.
