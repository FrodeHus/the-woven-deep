# Milestone Bosses — guaranteed bosses at depths 5/10/15 (Milestone 7B) — design spec

**Status:** design (brainstormed with the user 2026-07-24). Second sub-project of roadmap **Milestone 7
"Town progression and full campaign content"** (`docs/superpowers/plans/2026-07-13-implementation-
roadmap.md` §7), after **7A** (deep dungeon 13–19, merged via #88). Branch `feat/milestone-bosses` off
`main` (da1ae35 = Merge PR #88).

Gives the descent a rhythmic "every-5-floors" boss beat that mirrors the depth-20 Final Chamber:
three **guaranteed** milestone bosses at depths 5, 10, and 15, each a band capstone that escalates
toward the Heart, each dropping a unique reward. **Mostly content authoring against existing schemas,
plus two small, additive, off-milestone-no-op engine changes**: (a) wiring the already-existing
`requiredVaultId` primitive into the real per-depth floor generation so a boss-arena vault is forced to
place on the milestone floors, and (b) a guaranteed vault-gated boss pre-pass in floor population
placement so the boss is *placed* (not merely *eligible*) once its arena is present. Both are byte-
identical no-ops on every non-milestone floor.

## Scope of Milestone 7 (context) — what this sub-project is NOT

Milestone 7 is an umbrella largely delivered: the Final Chamber & endings, classes, backgrounds,
traits, town merchants, and (via 7A) a populated ramped descent 1→20 all exist. This spec (7B) is
**only the three milestone bosses + their arena vaults + their rewards + the guarantee mechanism.** The
later sub-project **7C** (separate spec) covers broader unlock rules, achievement criteria, and in-world
class foreshadowing. Ranged/caster monster AI is out of the whole milestone (see boundaries below).

## What already exists (7B reuses, does NOT rebuild)

- **Generic boss model.** `EncounterContentEntry` with `model: 'boss'` carries a `definition` of
  `{ monsterId, phases[], recoveryPerWorldTime, recoveryCapPercent, uniqueItemId, enhancedLootTableId,
  vaultTags }`. Each phase is `{ phaseId, healthThresholdPercent, behaviorId, behaviorParameters,
  modifiers (accuracy/defense/damage), effects }`. `packages/engine/src/boss-behavior.ts` runs phases
  generically and, on boss death, drops `definition.uniqueItemId` **unconditionally** (no roll) plus a
  roll on `enhancedLootTableId`. Proven twice: `encounter.heart-boss` (depth 20, phases unbound/
  unraveling, unique `item.heart-cinder`) and `encounter.ashen-warden` (a **random** legendary
  mini-boss, depths 5–12, `runAppearanceChance: 0.08`, phases kindled/inferno). **No engine work is
  needed for boss mechanics or rewards** — they already work through the normal population pipeline.
- **Vault-gated encounter placement (the guarantee's other half).** `population-placement.ts`
  `candidates()` makes a `model: 'boss'` encounter eligible only when the floor already contains a vault
  whose tags satisfy `[...encounter.requiredVaultTags, ...encounter.definition.vaultTags]`. With
  `placement.requiresVaultSlot: true`, `selectCells()` anchors the boss to a vault **`monster` slot**
  whose tags match — so the boss spawns **inside** the arena. This is exactly how a boss binds to a
  hand-authored arena today; only the *forcing* of that arena is missing.
- **The `requiredVaultId` primitive.** `generate-floor.ts` already accepts `requiredVaultId` on
  `GenerateFloorRequest` and threads it to `placeVaults()` (`vault-placement.ts:280-283`), which forces
  that specific vault to place (reject+retry topology until it fits, or fail). It is currently passed
  **only** by demo/fixture code (`generated-fixture.ts:50`, `gameplay-fixture.ts:311`) — the real
  per-depth descent call in `floor-transition.ts:174` does **not** pass it. That one gap is the engine
  change.
- **Reward/loot content patterns.** `content/items/champion-and-boss-rewards.yaml` +
  `content/loot-tables/{ashen-warden,heart-boss}.yaml` are the thin (~3-item) precedents for a boss's
  unique reward + a small enhanced loot table. The 7A balance lesson applies: the depth-20 final reward
  ring `item.heart-cinder {STR1,WIT1,GRIT1}` is the ceiling — earlier rewards must stay under it.
- **The Final Chamber's special-casing is NOT the pattern to copy.** The depth-20 boss is placed by
  bespoke engine code (`final-chamber.ts` `generateFinalChamberFloor`, a fixture slot + `activateHeart`
  boss activation, the `nextDepth === FINAL_CHAMBER_DEPTH` branch in `floor-transition.ts:133`). 7B
  deliberately uses the **generic** vault-gated population path instead, so the milestone bosses need no
  special-case engine branch — only the `requiredVaultId` wiring.

## Design

### 1. The guarantee — force the arena vault, then force-place the boss (⚙️ two contained engine changes)

Each milestone floor gets a hand-authored **boss-arena vault** forced to place every run, and the
vault-gated boss is force-placed once its arena is present. Both engine touches are no-ops on every
non-milestone floor. A crucial subtlety this design accounts for: **`requiredVaultId` alone does NOT
guarantee the boss.** It forces only the arena *room* (and its `monster` slot). The boss itself is
placed by `placeFloorPopulations`, which weighted-selects among *all* eligible encounters (regular
encounters have `requiredVaultTags: []`, so they are always eligible and compete). So forcing the arena
makes the boss *eligible and correctly anchored*, but a second change is needed to make it *always
placed*.

- **Change (a) — force the arena via `requiredVaultId` (data-driven, no hardcoded depths/ids).** Tag
  each arena vault `milestone-boss` and pin it to its depth (`minDepth == maxDepth == 5|10|15`). In
  `floor-transition.ts`, immediately before the normal `generateFloor(...)` call (the `else` path at
  ~line 170-186, NOT the Final-Chamber branch), compute the required vault by filtering the already-
  built `vaults` array for entries tagged `milestone-boss` whose depth band contains `nextDepth`:
  - **exactly one match** → pass its `id` as `requiredVaultId` to `generateFloor` (spread it in exactly
    as `requiredVaultId` is already spread at `generate-floor.ts:213-215`);
  - **no match** → pass nothing (behavior byte-identical to today — every non-milestone depth);
  - **more than one match** → throw an internal-invariant error (a content authoring mistake; two
    milestone arenas cannot both be forced on one floor).

  This keeps the set `{5,10,15}` entirely in **content** (three vaults tagged `milestone-boss`); the
  engine only knows "if a milestone-boss vault is pinned to this depth, force it." Because each arena is
  depth-pinned (`minDepth == maxDepth`), it can only ever appear on its own milestone floor.
- **Change (b) — guaranteed vault-gated boss pre-pass in `placeFloorPopulations`.** Before the existing
  weighted density-attempt loop (`population-placement.ts` ~line 1084), force-place every eligible
  `model: 'boss'` encounter whose **non-empty** `requiredAnchorTags` (= `requiredVaultTags` +
  `definition.vaultTags`) are all present in the floor's vault tags — reusing `placePopulation` with
  `forcedEncounterId` and committing exactly as the loop body does. The **non-empty** guard is critical:
  it force-places the milestone bosses (which require a `<boss-tag>`) while excluding the existing
  random `ashen-warden` (empty vault tags), so its weighted behavior is unchanged. On any non-milestone
  floor no milestone-tagged vault is present, so the pre-pass places nothing and consumes no RNG →
  byte-identical. This is the change that turns "eligible" into "guaranteed."
- **The arena vault** (one YAML per boss, e.g. `content/vaults/ashfather-arena.yaml`, mirroring
  `final-chamber.yaml`'s layout/legend/slot shape): `tags: [milestone-boss, <boss-tag>]`,
  `minDepth: maxDepth: <5|10|15>`, `maxPerFloor: 1`, an enclosed arena room with an entrance, and a
  **`monster` slot** tagged `[<boss-tag>]` (required) where the boss spawns. Modest size so it fits the
  existing floor dimensions (reject+retry handles tight fits).
- **The boss encounter** (authored in `content/encounters/`, model `boss`): `minDepth: maxDepth:
  <5|10|15>`, `runAppearanceChance: 1.0` (always run-eligible — the per-run decision roll passes every
  run), `maximumInstancesPerRun: 1`, `requiredVaultTags: [<boss-tag>]`, `placement.requiresVaultSlot:
  true` with `allowedTerrainTags: [floor]`. Arena forced (a) → tags + anchor slot present → the pre-pass
  (b) force-places the boss in the arena's monster slot **every run**. Pinning `minDepth == maxDepth`
  guarantees it never appears on any other floor.

### 2. The three bosses — band capstones escalating toward the Heart

New dedicated monsters/encounters/arenas (the existing random `ashen-warden` mini-boss stays untouched,
so no identity collision). Each uses `behavior.approach-and-attack` + phases (generic boss model); each
has **two phases** keyed by health threshold, mirroring `ashen-warden`/`heart-boss` (a rising-intensity
capstone + a desperate final phase via `modifiers`). Themes:

- **Ashfather** (depth 5) — fire/ash guardian, capstone of the early band (fire/ash families 1–8).
  `tags: [boss, fire, guardian]`.
- **Tide-Sovereign** (depth 10) — drowned/ashwrought elite, mid-band capstone (the 6–12 drowned/
  ashwrought families). `tags: [boss, drowned]` (+ a thematic secondary).
- **Heart-Herald** (depth 15) — a Heart-corrupted, arcane herald echoing 7A's Bound/Echo-wrought deep,
  foreshadowing the Final Chamber and the broke-cycle thread. `tags: [boss, heart, arcane]`.
- **⚙️ Caster boundary (same as 7A):** no ranged/caster monster AI exists. Heart-Herald's arcane
  identity is `damage` type arcane + `resistances` + `tags`, NOT literal spellcasting. Phases change
  combat `modifiers`/`effects`, not AI. Real caster AI is a separate future combat milestone.

### 3. Difficulty — threat spikes on a monotonic ramp

Each boss is a spike above its surrounding band, escalating across the three and staying strictly under
the depth-20 Heart (`monster.weakened-heart` health 58 / threat 20). Anchors: the depth-12 elite
`ashen-juggernaut` (~health 52 / threat 10) and 7A's depth-13→19 regulars (health ~48→75 / threat
~10→18). Target (final values tuned in the plan, asserted by a balance test):

| Boss | Depth | Health (approx) | Threat (approx) |
|------|-------|-----------------|-----------------|
| Ashfather | 5 | ~44 | ~13 |
| Tide-Sovereign | 10 | ~62 | ~16 |
| Heart-Herald | 15 | ~78 | ~18 |
| (Heart — ceiling) | 20 | 58* | 20 |

*The Heart's raw health (58) is intentionally not the highest number — its lethality comes from being
the finale with full phases; the milestone ramp targets health monotonic **among the three bosses** and
each boss's **threat** strictly below the Heart's 20. A balance-sanity test asserts: boss threat is
monotonic 5<10<15<20, each milestone boss out-threats its band's regulars, and no milestone boss threat
≥ 20.

### 4. Rewards — three unique relics, depth-appropriate, under the final tier

Each boss guarantee-drops a unique reward via `definition.uniqueItemId` (unconditional on death) plus a
small `enhancedLootTableId` for a bonus roll. Author three new band-appropriate reward items
(an ash relic @5, a tide relic @10, a Heart-touched relic @15, gated by `minDepth`) mirroring
`champion-and-boss-rewards.yaml`, and three thin enhanced loot tables. **Balance (7A lesson):** each
reward is depth-appropriate (a D5 reward comparable to strong early gear, D15 to deep gear), **strictly
below the depth-20 final reward tier** (`item.heart-cinder {1,1,1}`), and monotonic across the three —
guarded by a balance-sanity test (each milestone reward's total stat budget < heart-cinder's, and
D5 ≤ D10 ≤ D15).

### 5. Determinism, testing, scope

- **Determinism is the hard invariant.** All RNG stays explicit `Uint32State`; the `requiredVaultId`
  wiring adds no new randomness (it only constrains which vault `placeVaults` selects, inside the
  existing topology reject+retry loop). The client-trust boundary is unchanged (bosses are pure
  server-side content/generation).
- **The real simulation shift (endgame-demo).** `scripts/endgame-demo.mjs` descends organically through
  real depths 5/10/15, so once these guaranteed bosses exist it **will** show a real projection/records/
  events shift (the arenas place, the bosses spawn and are fought, rewards drop, downstream RNG moves).
  This is intended. Its fixture is regenerated **accepting the projection change**, and the cross-process
  **parity harness** (`npx vitest run --root apps/server determinism-parity`) must stay green — that is
  the proof determinism held (client-core and server produce identical simulation).
- **The other demos.** Demos that use fixed/forced fixture floors and do not organically descend through
  5/10/15 see only the **benign content-hash-embed** shift (save/record/event/heart hashes move because
  the compiled content hash changed; no projection/records/events/standings simulation hash moves).
  After each content task, regenerate the content-hash-embed demo fixtures (gameplay/population/merchant/
  run-records/endgame/magic) and **diff-check**: endgame = intended sim shift + parity green; all others
  = hash-embed fields only. (Note: `npm run verify` does not run the demo `--verify` scripts; the
  `*-demo-cli.test.ts` guards — including the magic-demo guard added in 7A — compare the fixtures.)
- **Testing:**
  - Content compiles under STRICT zod (`z.strictObject`): the three bosses (monsters + boss encounters),
    three arena vaults (with a required `monster` slot), three reward items, three enhanced loot tables;
    all referenced ids resolve; `maxDepth >= minDepth`.
  - **Engine — change (a):** a unit test of the `milestoneBossVaultId(vaults, depth)` discovery helper —
    returns the pinned arena id for depths 5/10/15, `undefined` for a non-milestone depth (e.g. 6), and
    throws on two milestone vaults pinned to one depth.
  - **Engine — change (b) + end-to-end guarantee:** a test that a full floor generation + population at
    depths 5, 10, 15 (real content, real `requiredVaultId` wiring) **always** places the arena vault and
    spawns the milestone boss anchored in the arena's `monster` slot; and that a non-milestone depth
    (e.g. 6) places no milestone vault and no forced boss (pre-pass is a no-op → RNG untouched).
  - **Engine — boss lifecycle (reuse `boss-behavior`):** a milestone boss transitions phases at its
    health thresholds and drops its `uniqueItemId` on death (one boss suffices — the mechanism is
    generic and already covered for `heart-boss`/`ashen-warden`).
  - **Balance guards:** the threat ramp assertion (§3) and the reward-under-final-tier assertion (§4).
  - **Determinism:** all 8 demos regenerated and diff-checked as above; parity harness green.
- **Out of scope:** the depth-20 Final Chamber (done); ranged/caster boss AI; the champion/echo system
  (a separate history-driven mechanic — untouched); 7C's unlocks/achievements/foreshadowing (defeating a
  milestone boss is a natural future achievement hook — noted, not built here); rebalancing existing
  1–19 content beyond what the boss ramp requires.

## Scope boundary

7B delivers three guaranteed milestone bosses (5/10/15) as band capstones escalating toward the Heart,
each in a forced boss-arena vault, each dropping a unique reward — reusing the generic boss model, the
vault-gated population path, and the existing `requiredVaultId` primitive. The engine changes are two
small, additive, off-milestone-no-op touches: (a) data-driven wiring of `requiredVaultId` into the real
per-depth floor generation for depths that have a `milestone-boss`-tagged vault, and (b) a guaranteed
vault-gated boss pre-pass in `placeFloorPopulations`. Everything else is content. No new gameplay
systems, no server-authority changes, no new special-case engine branch.
