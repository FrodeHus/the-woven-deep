# Deep Dungeon — depths 13–19 (Milestone 7A) — design spec

**Status:** design (brainstormed with the user 2026-07-24). First sub-project of roadmap **Milestone 7
"Town progression and full campaign content"** (`docs/superpowers/plans/2026-07-13-implementation-
roadmap.md` §7). Branch `feat/deep-dungeon` off `main`.

Fills the mid-to-late dungeon content void. The engine reaches depth 20 (the Final Chamber boss) but
authored monster/encounter/loot content stops at **depth 12** — depths 13–14 are a complete void and
15–19 have only the Ancient Tablet fragment spawns, so a descent past 12 hits empty floors and the
depth-20 boss follows a flat difficulty cliff. This sub-project authors depths 13–19 as the Heart's
corrupted deep, restoring the ramp to the finale. **Pure content authoring — no engine or schema
changes.**

## Scope of Milestone 7 (context) — what this sub-project is NOT

Milestone 7 is an umbrella already largely delivered: the Final Chamber & endings, 5 classes (3
playable + 2 unlockable), backgrounds, traits, and 4 town merchants all exist. The remaining gaps are
authoring volume, decomposed into sequenced sub-projects. **This spec (7A) is only the depth-13–19
dungeon content + depth-band population.** Later sub-projects (separate specs): **7B** milestone-boss
encounters at depths 5/10/15 + boss rewards; **7C** broader unlock rules + achievement criteria +
in-world class foreshadowing. Ranged/caster monster AI and any depth-band *registry* concept are out
of the whole milestone (see boundaries below).

## What already exists (7A reuses, does NOT rebuild)

- **Monster content** (`packages/content/src/model/monster.ts`): flat entries with `health`, `speed`,
  `accuracy`, `defense`, `damage` (dice), `armor`, `resistances` (per `DamageType`:
  physical/fire/cold/lightning/poison/arcane), `behaviorId`, `minDepth`/`maxDepth`, `threat`,
  `rarity`, `lootTableId`, `dropChance`, `tags`. Families are a **convention** (one YAML per family,
  tiered members, shared tags + a matching `loot-table.<family>`), not a schema object.
- **Encounters** (`packages/content/src/model/encounter.ts`): a discriminated union on `model:
  'individual'|'group'|'swarm'|'boss'|'merchant'`, each carrying `minDepth`/`maxDepth`, `weight`,
  `rarity`, `runAppearanceChance`, `maximumInstancesPerRun`, `placement`, and a `definition` (monster
  id + min/max quantity; `group` adds `roles`; `swarm` adds `sourceMonsterId`). **The engine gates
  floor placement on the ENCOUNTER's `minDepth`/`maxDepth`** (`population-placement.ts` `candidates`),
  so encounters are what make floors non-empty; a monster's own band is documentation.
- **Loot** (`content/loot-tables/`, `packages/content/src/model/loot-table.ts`): `choices` carry an
  optional `minDepth`/`maxDepth` band (enforced — `inventory.ts`/`merchant-stock.ts` prune by depth).
  `content/loot-tables/town-curios.yaml` already gates choices at depths 5/10/15/20 — the precedent
  for deeper merchant tiers.
- **Vaults** (`content/vaults/`, `packages/content/src/model/vault.ts`): ASCII `layout` + `legend`
  mapping glyphs to terrain + optional `slot` (kind: monster/item/trap/npc/fixture/objective/door/
  chest), gated by `minDepth`/`maxDepth`/`rarity`/`weight`/`maxPerFloor`. `lampwright-cache` (1–20)
  is the reusable pattern.
- **Traps** (`packages/content/src/model/trap.ts`): `TrapContentEntry` has **no depth field** — traps
  enter play ONLY via a vault `slot` of `kind: trap`. Only `trap.rusty-dart` exists.
- **The Tablet-fragment thread:** three legendary Ancient Tablet fragment items already spawn at
  `minDepth: 15, maxDepth: 20` via a dedicated per-floor roll; collecting all three unlocks the
  `broke-cycle` ending. The deep already narratively points at the Heart.
- **Final Chamber** is pinned at depth 20 (`vault.final-chamber` + `encounter.heart-boss`,
  `minDepth: maxDepth: 20`, boss `weakened-heart` health 58 / threat 20).

## Design

### 1. Two Heart-corrupted monster families + the difficulty ramp

Theme: depths 13–19 are the Heart's reach — its corruption warping the deep. Author two families,
each its own YAML file with ~4–5 tiered members and a matching `loot-table.<family>`, staggered so the
band has variety across 7 floors (matching the density of the 6–12 mid-game, which overlaps several
families).

- **The Bound** (`content/monsters/the-bound.yaml`, depths ~13–16): corrupted humanoid remnants,
  primarily **arcane** damage, resist **physical**, with an exploitable weakness (e.g. negative fire
  resistance). Tiers: a skirmisher (~13–15), an armored variant (~14–16), and an arcane "hexbound"
  capstone (`uncommon`/`rare`) whose identity is arcane damage + resistances (see the caster boundary
  below).
- **Echo-wrought** (`content/monsters/echo-wrought.yaml`, depths ~16–19): heavy brutes warped by the
  Heart — high armor/health, physical + some arcane damage, culminating in a **legendary named elite**
  (~threat 18, tagged `elite`/`legendary`) that previews the boss's feel.
- **Curve (restore the ramp):** today there is a flat cliff — depth-12 elite `ashen-juggernaut`
  (health ~52 / threat 10) then nothing until the depth-20 boss (health 58 / threat 20). Target the
  new regulars scaling roughly **health ~48→75, threat ~10→18, damage ~2d8+2→3d8+3, armor ~4→7**
  across depths 13→19, so depth-19's toughest non-boss *approaches but stays under* the Heart's stats.
  Values are authored to be monotonic depth 12 → 19 → 20 (a balance-sanity assertion, not a schema
  rule).
- **CASTER BOUNDARY (⚙️):** every monster today uses `behavior.approach-and-attack`; the engine has
  **no ranged/caster AI** (existing "caster" monsters are arcane-tagged melee). The Bound's arcane/
  caster identity is therefore expressed through **`damage` type = arcane + `resistances` + `tags`**,
  NOT literal spellcasting. Real ranged/caster monster AI is a separate future combat-AI milestone
  (it would affect all depths); 7A stays content-only.

### 2. Encounters (the depth gate the engine enforces)

Author encounters for both families in `content/encounters/monster-roster.yaml` (following its
`# --- <family> (depth X-Y) ---` block convention): per family, an `individual`, a `group` (with
`roles`), and one `swarm` where thematically apt, each with its own `minDepth`/`maxDepth`, `weight`,
`rarity`, `runAppearanceChance`, `maximumInstancesPerRun`, and `placement`. Stagger the bands so **13
and 14 (a total void today) and 15–19 all have eligible encounters**. These entries are what the
engine's floor population selects from, so they are the concrete fix for the empty floors.

### 3. Deep-antechamber vault + a second, deadlier trap

- **`content/vaults/deep-antechamber.yaml`** (`minDepth: 13, maxDepth: 19`): a Heart-themed set-piece
  reusing the `lampwright-cache` legend/slot pattern — a threshold chamber before the Final Chamber
  (e.g. an item/chest slot for a deep reward, a couple monster slots for a mini-ambush, and a `trap`
  slot). Modest `weight`/`maxPerFloor` so it appears occasionally across the band.
- **A new trap** (`content/traps/<deep-trap>.yaml`) — deadlier than `rusty-dart` (higher damage /
  a condition), placed via the deep-antechamber's `trap` slot (NOT added to `lampwright-cache`, so
  the low-depth experience is unchanged). No engine change — traps are vault-slot-gated.

### 4. Loot, rewards, and the tablet-fragment thread

- **Kill loot:** `content/loot-tables/the-bound.yaml` / `echo-wrought.yaml` (family-loot style),
  referenced by each family's `lootTableId`/`dropChance`. Include one or two **deep reward items**
  (a ring/relic gated `minDepth: 13`/`15`, mirroring `champion-and-boss-rewards.yaml`).
- **Deeper merchant tiers:** add `minDepth: 13`/`minDepth: 15` `choices` to the existing town loot
  tables (`town-curios`/`town-arms`/`town-provisioner`) so a restock at the depth-15 milestone offers
  deep-appropriate stock — reusing the exact precedent already in `town-curios.yaml`.
- **Narrative coherence:** the Bound/Echo-wrought lore + the deep-antechamber reinforce that the
  Heart's influence corrupts the deep — cohering with the existing 15–20 Ancient Tablet fragment
  spawns (which unlock `broke-cycle`). No new mechanic, just flavor around the existing thread.

### 5. Determinism, testing, scope boundary

- **Content-only, no engine/schema change.** All content compiles under STRICT zod validation (no
  stray keys; `maxDepth ≥ minDepth`; every referenced id resolves).
- **Determinism / fixture regen:** adding content changes the compiled **content hash**, which the
  content-hash-embed demo fixtures (gameplay/population/merchant/run-records/endgame) embed → they
  will move and must be regenerated. **Critically:** unlike a purely additive schema field, new
  monsters/encounters at depths the demos actually traverse *could* change simulation (a demo that
  descends into 13–19, or whose population rolls now include a new encounter) — so regeneration must
  **diff-check** whether a demo's *projection/event* hashes moved (a real, intended content change) vs
  only the content-hash-embed save/record fields (benign). Verify which demos descend past 12 / roll
  the new encounters, regenerate deliberately, and confirm the cross-process **parity harness** stays
  green (client-core and server produce identical simulation). The magic/engine/dungeon demos that
  don't traverse the deep should stay byte-identical except any embedded content hash.
- **Testing:** content-package compile test (the new monsters/encounters/vault/trap/loot validate
  under STRICT); an engine test asserting the **candidate encounter set is non-empty at depths 13, 15,
  17, 19** (closes the void — the concrete success criterion); the deep-antechamber vault + new trap
  place validly; the new loot tables resolve; a balance-sanity assertion that the ramp stats are
  monotonic across 12 → 19 (and stay under the depth-20 boss).
- **Out of scope:** milestone bosses at 5/10/15 + their rewards (7B); ranged/caster monster AI;
  broader unlocks/achievements/foreshadowing (7C); a depth-band registry (bands remain implicit via
  per-entry `minDepth`/`maxDepth`, matching the codebase); rebalancing the existing 1–12 content
  beyond what continuity requires.

## Scope boundary

7A delivers a populated, ramped descent from depth 1 → 20: the previously-empty depths 13–19 gain two
Heart-corrupted monster families, their encounters/loot, a deep-antechamber vault, a second trap, and
deeper merchant tiers — all reusing existing schemas and mechanisms, with the difficulty curve
restored so the Final Chamber feels earned. No new gameplay systems; no server-authority changes.
