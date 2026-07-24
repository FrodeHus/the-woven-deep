# Deep Dungeon — depths 13–19 (Milestone 7A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the depth-13–19 content void with two Heart-corrupted monster families, their encounters, a deep-antechamber vault, a second deadlier trap, deep reward relics, and deeper merchant tiers — restoring a monotonic difficulty ramp from depth 12 to the depth-20 boss.

**Architecture:** Pure content authoring. Two new monster YAMLs (`the-bound`, `echo-wrought`) mirror the existing family convention (tiered members, shared tags, a matching `loot-table.<family>`). New encounters in `content/encounters/monster-roster.yaml` are what the engine's floor-population gate actually selects, so they are the concrete fix for empty floors. A new vault + trap reuse the `lampwright-cache` legend/slot pattern. No engine, schema, or save-format change.

**Tech Stack:** TypeScript, Zod (STRICT content schemas in `packages/content/src/compiler/schema/`), Vitest, YAML content under `content/`. Engine is `@woven-deep/engine`; content is `@woven-deep/content`.

## Global Constraints

- **Content-only.** No file under `packages/*/src/` is edited. No schema, engine, or save-format change. Every deliverable is YAML under `content/` plus test files under `packages/*/test/`.
- **STRICT validation.** All content compiles under the STRICT Zod schemas: no stray keys (`z.strictObject`), `maxDepth ≥ minDepth` on every depth-ranged entry, and every referenced id (monster `lootTableId`, encounter `monsterId`/role `monsterId`/swarm `sourceMonsterId`, loot `contentId`, vault slot `contentId`/`lootTableId`, trap effect `conditionId`) resolves to an entry of the correct kind.
- **Determinism / fixture regen is the CONTROLLER's job, not the implementer's.** Adding any content changes the compiled content hash, so the eight content-hash-embed demo `--verify` scripts (dungeon, gameplay, merchant, population, run-records, magic, endgame, engine) will fail. That is EXPECTED. The implementer must NOT edit any file under `packages/engine/test/fixtures/*-demo-hashes.json`. After each content task the implementer RUNS the full engine suite and REPORTS exactly which demo-hash tests newly fail; the controller regenerates fixtures with a real-vs-benign diff-check and keeps the cross-process parity harness green. New 13–19 encounters do not appear in the shallow demos (gameplay/population run at low depth); the **endgame** demo may traverse the deep, so its diff-check matters most.
- **Caster boundary.** `MonsterContentEntry.damage` is a `DiceDefinition` (`count`/`sides`/`bonus`) with **no damage-type field** — a monster's melee damage type is not authorable. The Bound's arcane/caster identity is expressed **only** through `tags` (`arcane`, `caster`, `hexbound`) plus `resistances` (high `arcane`, negative `fire`), exactly mirroring the existing `monster.wailing-echo`. No literal spellcasting; the engine has no ranged/caster AI. Every new monster uses `behaviorId: behavior.approach-and-attack` and `behaviorParameters: {}`.

## File Structure

Created:
- `content/monsters/the-bound.yaml` — The Bound family (4 tiered members, depths 13–16). [T1]
- `content/monsters/echo-wrought.yaml` — Echo-wrought family (4 tiered members, depths 16–19). [T2]
- `content/items/deep-relics.yaml` — 2 deep reward rings. [T5]
- `content/traps/warded-glyph-trap.yaml` — the second, deadlier trap. [T4]
- `content/vaults/deep-antechamber.yaml` — Heart-themed threshold vault (minDepth 13/maxDepth 19). [T4]
- `packages/content/test/the-bound.test.ts` [T1]
- `packages/content/test/echo-wrought.test.ts` [T2]
- `packages/engine/test/deep-dungeon-encounters.test.ts` [T3]
- `packages/content/test/deep-antechamber.test.ts` [T4]
- `packages/engine/test/deep-antechamber-placement.test.ts` [T4]
- `packages/content/test/deep-rewards.test.ts` [T5]
- `packages/engine/test/deep-loot-resolve.test.ts` [T5]
- `packages/content/test/deep-dungeon-balance.test.ts` [T6]

Modified:
- `content/loot-tables/monster-families.yaml` — add `loot-table.the-bound` [T1] + `loot-table.echo-wrought` [T2]; wire reward items in [T5].
- `content/encounters/monster-roster.yaml` — 8 new encounters (two family blocks) [T3].
- `content/loot-tables/town-curios.yaml`, `content/loot-tables/town-arms.yaml`, `content/loot-tables/town-provisioner.yaml` — deep merchant tiers [T5].
- `packages/content/test/default-content.test.ts` — bump kind-count assertions [T1, T2, T3, T4, T5].

### Assigned content ids and the ramp (authoritative reference for all tasks)

Monsters (health / threat / damage / armor). All authored monotonic depth 12 → 19 → 20 and every new monster stays under the depth-20 boss `monster.weakened-heart` (health 58 / threat 20):

| id | family | depths | health | threat | damage | armor | rarity |
|----|--------|--------|--------|--------|--------|-------|--------|
| `monster.ashen-juggernaut` (existing) | ashwrought | 9–12 | 52 | 10 | 3d6+2 | 4 | legendary |
| `monster.bound-wretch` | the-bound | 13–15 | 48 | 10 | 2d8+1 | 3 | common |
| `monster.bound-shackled` | the-bound | 13–16 | 52 | 11 | 2d8+2 | 4 | common |
| `monster.bound-warden` | the-bound | 14–16 | 53 | 12 | 2d8+2 | 5 | uncommon |
| `monster.bound-hexbound` | the-bound | 15–16 | 52 | 13 | 3d6+2 | 3 | rare |
| `monster.echo-breaker` | echo-wrought | 16–18 | 54 | 14 | 2d8+3 | 5 | common |
| `monster.echo-colossus` | echo-wrought | 16–19 | 55 | 15 | 3d8+2 | 6 | uncommon |
| `monster.echo-harrower` | echo-wrought | 17–19 | 55 | 16 | 3d8+2 | 6 | rare |
| `monster.echo-sovereign` | echo-wrought | 18–19 | 57 | 18 | 3d8+3 | 7 | legendary |
| `monster.weakened-heart` (existing boss) | heart | 20 | 58 | 20 | 2d6+1 | 2 | legendary |

Curated ramp anchors (the T6 monotonic sequence — health non-decreasing 52,52,53,55,57,58; threat non-decreasing 10,11,12,15,18,20): `ashen-juggernaut` → `bound-shackled` → `bound-warden` → `echo-colossus` → `echo-sovereign` → `weakened-heart`.

Loot tables: `loot-table.the-bound` [T1], `loot-table.echo-wrought` [T2]. Reward items: `item.bound-signet` (minDepth 13), `item.echo-heartstone` (minDepth 15) [T5]. Trap: `trap.warded-glyph` [T4]. Vault: `vault.deep-antechamber` [T4]. Encounters [T3]: `encounter.bound-wretch-prowl`, `encounter.bound-procession`, `encounter.bound-swarm`, `encounter.bound-hex-rite`, `encounter.echo-breaker-stand`, `encounter.echo-vanguard`, `encounter.echo-harrower-hunt`, `encounter.echo-sovereign-march`.

Post-milestone `default-content.test.ts` counts: monster 35→43, item 43→45, trap 1→2, loot-table 17→19, vault 3→4, encounter 34→42.

---

## Task 1: The Bound monster family + kill loot

**Files:**
- Create: `content/monsters/the-bound.yaml`
- Modify: `content/loot-tables/monster-families.yaml` (append `loot-table.the-bound`)
- Modify: `packages/content/test/default-content.test.ts` (bump `monster` 35→43 is completed incrementally; in this task set `monster: 39` and `loot-table: 18` — see step 6 note)
- Test: `packages/content/test/the-bound.test.ts`

**Interfaces:**
- Consumes: existing items `item.ashen-potion`, `item.echo-remnant`, `item.etched-ring`, `item.ember-scroll`; existing `behavior.approach-and-attack`.
- Produces: monster ids `monster.bound-wretch`, `monster.bound-shackled`, `monster.bound-warden`, `monster.bound-hexbound` (consumed by T3 encounters and T6 balance); loot-table id `loot-table.the-bound` (consumed by these monsters' `lootTableId`, extended in T5).

- [ ] **Step 1: Write `content/monsters/the-bound.yaml`**

```yaml
schemaVersion: 7
entries:
  - kind: monster
    id: monster.bound-wretch
    name: Bound wretch
    glyph: b
    color: "#7a5fa0"
    description: A husk of someone the Heart never let finish dying, dragging its bindings toward any warmth it can still feel.
    lore: "It reaches for the living the way a sleeper gropes for a blanket pulled away in the night, and it has been groping for a very long time."
    tags: [the-bound, arcane, skirmisher]
    minDepth: 13
    maxDepth: 15
    attributes: { might: 12, agility: 9, vitality: 12, wits: 7, resolve: 11 }
    health: 48
    speed: 100
    accuracy: 5
    defense: 12
    perception: 8
    damage: { count: 2, sides: 8, bonus: 1 }
    armor: 3
    resistances: { physical: 30, fire: -25, cold: 0, lightning: 0, poison: 10, arcane: 40 }
    disposition: hostile
    behaviorId: behavior.approach-and-attack
    behaviorParameters: {}
    threat: 10
    rarity: common
    lootTableId: loot-table.the-bound
    dropChance: 0.35

  - kind: monster
    id: monster.bound-shackled
    name: Shackled remnant
    glyph: b
    color: "#6a4f92"
    description: The bindings have fused into its flesh, and it swings the trailing lengths of them like weapons it no longer remembers picking up.
    lore: "Whatever it was chained for is forgotten. The chains stayed, and it learned to hit things with them, and that was enough purpose to keep it upright."
    tags: [the-bound, arcane, brute]
    minDepth: 13
    maxDepth: 16
    attributes: { might: 14, agility: 7, vitality: 14, wits: 7, resolve: 12 }
    health: 52
    speed: 95
    accuracy: 5
    defense: 11
    perception: 7
    damage: { count: 2, sides: 8, bonus: 2 }
    armor: 4
    resistances: { physical: 35, fire: -25, cold: 0, lightning: 0, poison: 15, arcane: 45 }
    disposition: hostile
    behaviorId: behavior.approach-and-attack
    behaviorParameters: {}
    threat: 11
    rarity: common
    lootTableId: loot-table.the-bound
    dropChance: 0.4

  - kind: monster
    id: monster.bound-warden
    name: Bound warden
    glyph: B
    color: "#5a3f82"
    description: Slabs of fused binding-iron plate its shoulders and skull, a warden of nothing, guarding a threshold no one crosses anymore.
    lore: "It still keeps a post. The post is gone, the thing it guarded is gone, and the warden has forgotten both, but it will not step aside."
    tags: [the-bound, arcane, armored]
    minDepth: 14
    maxDepth: 16
    attributes: { might: 15, agility: 6, vitality: 15, wits: 8, resolve: 13 }
    health: 53
    speed: 90
    accuracy: 6
    defense: 12
    perception: 7
    damage: { count: 2, sides: 8, bonus: 2 }
    armor: 5
    resistances: { physical: 45, fire: -20, cold: 5, lightning: 0, poison: 15, arcane: 45 }
    disposition: hostile
    behaviorId: behavior.approach-and-attack
    behaviorParameters: {}
    threat: 12
    rarity: uncommon
    lootTableId: loot-table.the-bound
    dropChance: 0.4

  - kind: monster
    id: monster.bound-hexbound
    name: Hexbound
    glyph: H
    color: "#8a5fc0"
    description: The bindings have gone quiet and cold around this one, and the air near it bends the way heat-haze bends, only wrong.
    lore: "The Heart wound its threads tightest here, and something in the tangle learned to pull back. It is not free. It has only learned which way the leash runs."
    tags: [the-bound, arcane, caster, hexbound]
    minDepth: 15
    maxDepth: 16
    attributes: { might: 9, agility: 8, vitality: 12, wits: 15, resolve: 15 }
    health: 52
    speed: 105
    accuracy: 6
    defense: 14
    perception: 10
    damage: { count: 3, sides: 6, bonus: 2 }
    armor: 3
    resistances: { physical: 45, fire: -30, cold: 10, lightning: 0, poison: 20, arcane: 55 }
    disposition: hostile
    behaviorId: behavior.approach-and-attack
    behaviorParameters: {}
    threat: 13
    rarity: rare
    lootTableId: loot-table.the-bound
    dropChance: 0.45
```

- [ ] **Step 2: Append `loot-table.the-bound` to `content/loot-tables/monster-families.yaml`**

Add this entry to the `entries:` list (after `loot-table.ashwrought-brutes`). Do NOT reference reward items yet — `item.bound-signet` is authored in T5, and referencing it here would break this task's compile.

```yaml
  - kind: loot-table
    id: loot-table.the-bound
    name: Bound remnants
    tags: [arcane, deep, undead]
    rolls: 2
    choices:
      - { contentId: item.ashen-potion, lootTableId: null, weight: 4, minimumQuantity: 1, maximumQuantity: 1 }
      - { contentId: item.echo-remnant, lootTableId: null, weight: 3, minimumQuantity: 1, maximumQuantity: 2 }
      - { contentId: item.etched-ring, lootTableId: null, weight: 2, minimumQuantity: 1, maximumQuantity: 1 }
      - { contentId: item.ember-scroll, lootTableId: null, weight: 2, minimumQuantity: 1, maximumQuantity: 1 }
```

- [ ] **Step 3: Write the failing test `packages/content/test/the-bound.test.ts`**

```ts
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MonsterContentEntry } from '../src/index.js';
import { compileContentDirectory } from '../src/compiler/index.js';

describe('The Bound family', () => {
  it('compiles four tiered arcane remnants on the ramp with the family loot table', async () => {
    const pack = await compileContentDirectory({
      rootDir: resolve(import.meta.dirname, '../../../content'),
    });
    const byId = new Map(pack.entries.map((entry) => [entry.id, entry]));
    const ids = [
      'monster.bound-wretch',
      'monster.bound-shackled',
      'monster.bound-warden',
      'monster.bound-hexbound',
    ];
    for (const id of ids) {
      const monster = byId.get(id) as MonsterContentEntry | undefined;
      expect(monster, id).toBeDefined();
      expect(monster!.kind).toBe('monster');
      expect(monster!.lootTableId).toBe('loot-table.the-bound');
      expect(monster!.behaviorId).toBe('behavior.approach-and-attack');
      expect(monster!.tags).toContain('the-bound');
      // Caster boundary: arcane identity is resistances + tags, never a damage type.
      expect(monster!.resistances.arcane).toBeGreaterThanOrEqual(40);
      expect(monster!.resistances.fire).toBeLessThan(0);
      expect(monster!.threat).toBeLessThan(20);
      expect(monster!.health).toBeLessThan(58);
    }
    expect((byId.get('monster.bound-shackled') as MonsterContentEntry).health).toBe(52);
    expect((byId.get('monster.bound-hexbound') as MonsterContentEntry).threat).toBe(13);
    expect((byId.get('monster.bound-hexbound') as MonsterContentEntry).tags).toContain('caster');
    expect(byId.get('loot-table.the-bound')?.kind).toBe('loot-table');
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -w @woven-deep/content -- the-bound`
Expected: FAIL — monsters undefined (files not yet compiled) if steps 1–2 were skipped, or PASS if authored. If it fails on a Zod issue, read the compile error and fix the YAML.

- [ ] **Step 5: Run it to verify it passes**

Run: `npm test -w @woven-deep/content -- the-bound`
Expected: PASS.

- [ ] **Step 6: Bump the kind counts in `packages/content/test/default-content.test.ts`**

In the `toEqual({ ... })` block, change `monster: 35,` to `monster: 39,` and `'loot-table': 17,` to `'loot-table': 18,`. Leave all other counts unchanged (they are bumped by later tasks).

- [ ] **Step 7: Run the bundled-content test**

Run: `npm test -w @woven-deep/content -- default-content`
Expected: PASS.

- [ ] **Step 8: Report demo-hash drift (do NOT edit fixtures)**

Run: `npm test -w @woven-deep/engine` (build first: `npm run build -w @woven-deep/content`). Confirm the ONLY newly-failing engine tests are the content-hash-embed demo-hash tests (files matching `*-demo*` that assert against `packages/engine/test/fixtures/*-demo-hashes.json`). Report which demos moved. Do NOT modify any fixture JSON — the controller regenerates.

- [ ] **Step 9: Commit**

```bash
git add content/monsters/the-bound.yaml content/loot-tables/monster-families.yaml \
  packages/content/test/the-bound.test.ts packages/content/test/default-content.test.ts
git commit -m "content: add The Bound monster family and kill loot"
```

---

## Task 2: Echo-wrought monster family + kill loot

**Files:**
- Create: `content/monsters/echo-wrought.yaml`
- Modify: `content/loot-tables/monster-families.yaml` (append `loot-table.echo-wrought`)
- Modify: `packages/content/test/default-content.test.ts` (`monster: 39`→`43`, `'loot-table': 18`→`19`)
- Test: `packages/content/test/echo-wrought.test.ts`

**Interfaces:**
- Consumes: existing items `item.leather-armor`, `item.ashen-potion`, `item.echo-remnant`, `item.ember-scroll`, `item.iron-sword`; `behavior.approach-and-attack`.
- Produces: monster ids `monster.echo-breaker`, `monster.echo-colossus`, `monster.echo-harrower`, `monster.echo-sovereign` (consumed by T3 and T6); loot-table id `loot-table.echo-wrought` (extended in T5; referenced by the T4 vault item slot).

- [ ] **Step 1: Write `content/monsters/echo-wrought.yaml`**

```yaml
schemaVersion: 7
entries:
  - kind: monster
    id: monster.echo-breaker
    name: Echo-wrought breaker
    glyph: e
    color: "#9a4f6f"
    description: A brute the Heart hammered back into shape after it broke, its body a rough echo of the thing it used to be, only heavier.
    lore: "The Deep does not waste a strong back. When this one fell, the Heart's pull gathered the pieces and pressed them together again, close enough to work."
    tags: [echo-wrought, brute]
    minDepth: 16
    maxDepth: 18
    attributes: { might: 16, agility: 5, vitality: 15, wits: 5, resolve: 12 }
    health: 54
    speed: 90
    accuracy: 6
    defense: 11
    perception: 6
    damage: { count: 2, sides: 8, bonus: 3 }
    armor: 5
    resistances: { physical: 35, fire: 10, cold: -10, lightning: 0, poison: 20, arcane: 25 }
    disposition: hostile
    behaviorId: behavior.approach-and-attack
    behaviorParameters: {}
    threat: 14
    rarity: common
    lootTableId: loot-table.echo-wrought
    dropChance: 0.4

  - kind: monster
    id: monster.echo-colossus
    name: Echo-wrought colossus
    glyph: E
    color: "#8a3f5f"
    description: Layer on layer of reclaimed dead, pressed by the Heart's weight into one slab-shouldered giant that walks with the patience of stone.
    lore: "Count the seams and you count the fallen. The Heart keeps no ledger, but the colossus wears one, written in the joins where body was fitted to body."
    tags: [echo-wrought, brute, armored]
    minDepth: 16
    maxDepth: 19
    attributes: { might: 17, agility: 5, vitality: 16, wits: 6, resolve: 13 }
    health: 55
    speed: 85
    accuracy: 6
    defense: 12
    perception: 6
    damage: { count: 3, sides: 8, bonus: 2 }
    armor: 6
    resistances: { physical: 40, fire: 10, cold: -10, lightning: 0, poison: 25, arcane: 30 }
    disposition: hostile
    behaviorId: behavior.approach-and-attack
    behaviorParameters: {}
    threat: 15
    rarity: uncommon
    lootTableId: loot-table.echo-wrought
    dropChance: 0.45

  - kind: monster
    id: monster.echo-harrower
    name: Echo-wrought harrower
    glyph: e
    color: "#a44f7f"
    description: Lean where its kin are massive, quick where they are slow, its reworked limbs ending in reaching hooks that the Heart's residue keeps sharp.
    lore: "Not every echo comes back heavier. Some come back hungrier, remade lean and fast for the one task the Heart still cares about down here: bringing more back."
    tags: [echo-wrought, arcane, harrower]
    minDepth: 17
    maxDepth: 19
    attributes: { might: 15, agility: 8, vitality: 15, wits: 9, resolve: 13 }
    health: 55
    speed: 95
    accuracy: 7
    defense: 13
    perception: 9
    damage: { count: 3, sides: 8, bonus: 2 }
    armor: 6
    resistances: { physical: 35, fire: 5, cold: -10, lightning: 0, poison: 20, arcane: 40 }
    disposition: hostile
    behaviorId: behavior.approach-and-attack
    behaviorParameters: {}
    threat: 16
    rarity: rare
    lootTableId: loot-table.echo-wrought
    dropChance: 0.45

  - kind: monster
    id: monster.echo-sovereign
    name: The Echo Sovereign
    glyph: E
    color: "#c9425f"
    description: The Heart's masterwork of reclaimed dead, crowned in fused binding-iron, a preview of the shape waiting in the Final Chamber below.
    lore: "It is what the Heart makes when it is not being careless: a body worthy of the pull that raised it. Stand before it and you are looking up the last stretch of stair at the thing that owns them all."
    tags: [echo-wrought, brute, elite, legendary]
    minDepth: 18
    maxDepth: 19
    attributes: { might: 18, agility: 6, vitality: 17, wits: 10, resolve: 15 }
    health: 57
    speed: 95
    accuracy: 7
    defense: 13
    perception: 8
    damage: { count: 3, sides: 8, bonus: 3 }
    armor: 7
    resistances: { physical: 45, fire: 15, cold: -5, lightning: 0, poison: 30, arcane: 40 }
    disposition: hostile
    behaviorId: behavior.approach-and-attack
    behaviorParameters: {}
    threat: 18
    rarity: legendary
    lootTableId: loot-table.echo-wrought
    dropChance: 0.5
```

- [ ] **Step 2: Append `loot-table.echo-wrought` to `content/loot-tables/monster-families.yaml`**

Add after `loot-table.the-bound`. No reward item yet (added in T5).

```yaml
  - kind: loot-table
    id: loot-table.echo-wrought
    name: Echo-wrought salvage
    tags: [arcane, brute, deep]
    rolls: 2
    choices:
      - { contentId: item.leather-armor, lootTableId: null, weight: 3, minimumQuantity: 1, maximumQuantity: 1 }
      - { contentId: item.ashen-potion, lootTableId: null, weight: 3, minimumQuantity: 1, maximumQuantity: 1 }
      - { contentId: item.echo-remnant, lootTableId: null, weight: 3, minimumQuantity: 1, maximumQuantity: 2 }
      - { contentId: item.ember-scroll, lootTableId: null, weight: 2, minimumQuantity: 1, maximumQuantity: 1 }
      - { contentId: item.iron-sword, lootTableId: null, weight: 2, minimumQuantity: 1, maximumQuantity: 1 }
```

- [ ] **Step 3: Write the failing test `packages/content/test/echo-wrought.test.ts`**

```ts
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MonsterContentEntry } from '../src/index.js';
import { compileContentDirectory } from '../src/compiler/index.js';

describe('Echo-wrought family', () => {
  it('compiles four heavy brutes on the ramp with a legendary capstone under the boss', async () => {
    const pack = await compileContentDirectory({
      rootDir: resolve(import.meta.dirname, '../../../content'),
    });
    const byId = new Map(pack.entries.map((entry) => [entry.id, entry]));
    const ids = [
      'monster.echo-breaker',
      'monster.echo-colossus',
      'monster.echo-harrower',
      'monster.echo-sovereign',
    ];
    for (const id of ids) {
      const monster = byId.get(id) as MonsterContentEntry | undefined;
      expect(monster, id).toBeDefined();
      expect(monster!.lootTableId).toBe('loot-table.echo-wrought');
      expect(monster!.tags).toContain('echo-wrought');
      expect(monster!.armor).toBeGreaterThanOrEqual(5);
      expect(monster!.threat).toBeLessThan(20);
      expect(monster!.health).toBeLessThan(58);
    }
    const sovereign = byId.get('monster.echo-sovereign') as MonsterContentEntry;
    expect(sovereign.threat).toBe(18);
    expect(sovereign.health).toBe(57);
    expect(sovereign.rarity).toBe('legendary');
    expect(sovereign.tags).toEqual(expect.arrayContaining(['elite', 'legendary']));
    expect(byId.get('loot-table.echo-wrought')?.kind).toBe('loot-table');
  });
});
```

- [ ] **Step 4: Run the test to verify it fails, then passes after authoring**

Run: `npm test -w @woven-deep/content -- echo-wrought`
Expected: PASS once steps 1–2 are complete.

- [ ] **Step 5: Bump kind counts in `packages/content/test/default-content.test.ts`**

Change `monster: 39,` to `monster: 43,` and `'loot-table': 18,` to `'loot-table': 19,`.

- [ ] **Step 6: Run the bundled-content test**

Run: `npm test -w @woven-deep/content -- default-content`
Expected: PASS.

- [ ] **Step 7: Report demo-hash drift (do NOT edit fixtures)**

Run: `npm test -w @woven-deep/engine`. Confirm the only newly-failing tests are the content-hash-embed demo-hash tests; report which. Do NOT touch fixture JSON.

- [ ] **Step 8: Commit**

```bash
git add content/monsters/echo-wrought.yaml content/loot-tables/monster-families.yaml \
  packages/content/test/echo-wrought.test.ts packages/content/test/default-content.test.ts
git commit -m "content: add Echo-wrought monster family and kill loot"
```

---

## Task 3: Encounters for both families (the void-closing gate)

**Files:**
- Modify: `content/encounters/monster-roster.yaml` (append two `# --- <family> (depth X-Y) ---` blocks)
- Modify: `packages/content/test/default-content.test.ts` (`encounter: 34`→`42`)
- Test: `packages/engine/test/deep-dungeon-encounters.test.ts`

**Interfaces:**
- Consumes: monster ids from T1 (`monster.bound-wretch`, `monster.bound-shackled`, `monster.bound-warden`, `monster.bound-hexbound`) and T2 (`monster.echo-breaker`, `monster.echo-colossus`, `monster.echo-harrower`, `monster.echo-sovereign`); engine `placePopulation` and `createDemoRun` from `@woven-deep/engine` (`../src/index.js`).
- Produces: encounter ids `encounter.bound-wretch-prowl`, `encounter.bound-procession`, `encounter.bound-swarm`, `encounter.bound-hex-rite`, `encounter.echo-breaker-stand`, `encounter.echo-vanguard`, `encounter.echo-harrower-hunt`, `encounter.echo-sovereign-march`. These are what the engine's `candidates()` gate selects at depths 13–19.

The engine gate (`packages/engine/src/population-placement.ts`, `candidates()`) filters encounters by `floor.depth >= encounter.minDepth && floor.depth <= encounter.maxDepth` (plus per-run eligibility and vault/environment tags). With no `requiredVaultTags`/`environmentTags`, depth is the only content-authored constraint, so these entries make floors 13–19 non-empty.

- [ ] **Step 1: Append the two encounter blocks to `content/encounters/monster-roster.yaml`**

Append to the `entries:` list (after `encounter.ashwrought-warband`). Coverage: 13 → {prowl, procession}; 14 → {prowl, procession, swarm}; 15 → {prowl, procession, swarm, hex-rite}; 16 → {procession, swarm, hex-rite, breaker-stand, vanguard}; 17 → {breaker-stand, vanguard, harrower-hunt}; 18 → {breaker-stand, vanguard, harrower-hunt, sovereign-march}; 19 → {vanguard, harrower-hunt, sovereign-march}.

```yaml
  # --- The Bound (depth 13-16) ---
  - kind: encounter
    id: encounter.bound-wretch-prowl
    name: Bound wretch prowl
    tags: [arcane, the-bound, skirmisher]
    model: individual
    minDepth: 13
    maxDepth: 15
    environmentTags: []
    requiredVaultTags: []
    weight: 5
    rarity: common
    runAppearanceChance: 0.6
    discoveryProtectionIncrement: 0.06
    discoveryProtectionCap: 0.8
    maximumInstancesPerRun: 10
    placement: { minimumStairDistance: 6, minimumObjectiveDistance: 6, maximumMemberDistance: 3, allowedTerrainTags: [floor], requiresVaultSlot: false, failureMode: optional }
    intentPresentation: { visible: true }
    definition: { monsterId: monster.bound-wretch, minimumQuantity: 1, maximumQuantity: 3 }

  - kind: encounter
    id: encounter.bound-procession
    name: Bound procession
    tags: [arcane, the-bound]
    model: group
    minDepth: 13
    maxDepth: 16
    environmentTags: []
    requiredVaultTags: []
    weight: 4
    rarity: uncommon
    runAppearanceChance: 0.5
    discoveryProtectionIncrement: 0.05
    discoveryProtectionCap: 0.7
    maximumInstancesPerRun: 8
    placement: { minimumStairDistance: 6, minimumObjectiveDistance: 6, maximumMemberDistance: 5, allowedTerrainTags: [floor], requiresVaultSlot: false, failureMode: optional }
    intentPresentation: { visible: true }
    definition:
      roles:
        - { roleId: wretch, monsterId: monster.bound-wretch, minimumQuantity: 1, maximumQuantity: 3, formationPreference: front, behaviorParameters: {} }
        - { roleId: shackled, monsterId: monster.bound-shackled, minimumQuantity: 1, maximumQuantity: 2, formationPreference: front, behaviorParameters: {} }
        - { roleId: warden, monsterId: monster.bound-warden, minimumQuantity: 1, maximumQuantity: 1, formationPreference: center, behaviorParameters: {} }
      formation: line
      communicationRadius: 6
      leaderChance: 0.45
      leaderRoleId: warden
      leaderAccentColor: "#5a3f82"
      leaderAlternateGlyph: W
      coordinationModifiers: { accuracy: 1, defense: 1, damage: 0 }
      leaderDeathResponse: weaken
      responseParameters: { modifiers: { accuracy: -1, defense: -2, damage: -1 } }
      supernaturalBond: true
      collapseRewards: none

  - kind: encounter
    id: encounter.bound-swarm
    name: Bound swarm
    tags: [arcane, the-bound, swarm]
    model: swarm
    minDepth: 14
    maxDepth: 16
    environmentTags: []
    requiredVaultTags: []
    weight: 3
    rarity: rare
    runAppearanceChance: 0.3
    discoveryProtectionIncrement: 0.04
    discoveryProtectionCap: 0.55
    maximumInstancesPerRun: 5
    placement: { minimumStairDistance: 6, minimumObjectiveDistance: 6, maximumMemberDistance: 4, allowedTerrainTags: [floor], requiresVaultSlot: false, failureMode: optional }
    intentPresentation: { visible: true }
    definition:
      sourceMonsterId: monster.bound-shackled
      spawnRoles:
        - { roleId: wretch, monsterId: monster.bound-wretch, weight: 3 }
      spawnInterval: 300
      minimumSpawnQuantity: 1
      maximumSpawnQuantity: 2
      placementRadius: 3
      allowedTerrainTags: [floor]
      maximumLivingChildren: 8
      maximumLivingMembers: 9
      maximumFloorActors: 20
      sourceDestructionResponse: decay
      responseParameters: {}

  - kind: encounter
    id: encounter.bound-hex-rite
    name: Bound hex rite
    tags: [arcane, caster, the-bound]
    model: individual
    minDepth: 15
    maxDepth: 16
    environmentTags: []
    requiredVaultTags: []
    weight: 3
    rarity: rare
    runAppearanceChance: 0.3
    discoveryProtectionIncrement: 0.04
    discoveryProtectionCap: 0.55
    maximumInstancesPerRun: 5
    placement: { minimumStairDistance: 6, minimumObjectiveDistance: 6, maximumMemberDistance: 3, allowedTerrainTags: [floor], requiresVaultSlot: false, failureMode: optional }
    intentPresentation: { visible: true }
    definition: { monsterId: monster.bound-hexbound, minimumQuantity: 1, maximumQuantity: 1 }

  # --- Echo-wrought (depth 16-19) ---
  - kind: encounter
    id: encounter.echo-breaker-stand
    name: Echo-wrought breaker stand
    tags: [arcane, echo-wrought, brute]
    model: individual
    minDepth: 16
    maxDepth: 18
    environmentTags: []
    requiredVaultTags: []
    weight: 5
    rarity: common
    runAppearanceChance: 0.55
    discoveryProtectionIncrement: 0.05
    discoveryProtectionCap: 0.75
    maximumInstancesPerRun: 9
    placement: { minimumStairDistance: 7, minimumObjectiveDistance: 7, maximumMemberDistance: 3, allowedTerrainTags: [floor], requiresVaultSlot: false, failureMode: optional }
    intentPresentation: { visible: true }
    definition: { monsterId: monster.echo-breaker, minimumQuantity: 1, maximumQuantity: 2 }

  - kind: encounter
    id: encounter.echo-vanguard
    name: Echo-wrought vanguard
    tags: [arcane, echo-wrought, brute]
    model: group
    minDepth: 16
    maxDepth: 19
    environmentTags: []
    requiredVaultTags: []
    weight: 4
    rarity: uncommon
    runAppearanceChance: 0.45
    discoveryProtectionIncrement: 0.05
    discoveryProtectionCap: 0.65
    maximumInstancesPerRun: 7
    placement: { minimumStairDistance: 7, minimumObjectiveDistance: 7, maximumMemberDistance: 5, allowedTerrainTags: [floor], requiresVaultSlot: false, failureMode: optional }
    intentPresentation: { visible: true }
    definition:
      roles:
        - { roleId: breaker, monsterId: monster.echo-breaker, minimumQuantity: 1, maximumQuantity: 2, formationPreference: front, behaviorParameters: {} }
        - { roleId: colossus, monsterId: monster.echo-colossus, minimumQuantity: 1, maximumQuantity: 1, formationPreference: front, behaviorParameters: {} }
        - { roleId: harrower, monsterId: monster.echo-harrower, minimumQuantity: 1, maximumQuantity: 1, formationPreference: flank, behaviorParameters: {} }
      formation: wedge
      communicationRadius: 6
      leaderChance: 0.5
      leaderRoleId: colossus
      leaderAccentColor: "#8a3f5f"
      leaderAlternateGlyph: C
      coordinationModifiers: { accuracy: 1, defense: 1, damage: 1 }
      leaderDeathResponse: frenzy
      responseParameters: { duration: 8, modifiers: { accuracy: 1, defense: -1, damage: 2 } }
      supernaturalBond: true
      collapseRewards: none

  - kind: encounter
    id: encounter.echo-harrower-hunt
    name: Echo-wrought harrower hunt
    tags: [arcane, echo-wrought, harrower]
    model: individual
    minDepth: 17
    maxDepth: 19
    environmentTags: []
    requiredVaultTags: []
    weight: 3
    rarity: rare
    runAppearanceChance: 0.35
    discoveryProtectionIncrement: 0.04
    discoveryProtectionCap: 0.6
    maximumInstancesPerRun: 6
    placement: { minimumStairDistance: 7, minimumObjectiveDistance: 7, maximumMemberDistance: 3, allowedTerrainTags: [floor], requiresVaultSlot: false, failureMode: optional }
    intentPresentation: { visible: true }
    definition: { monsterId: monster.echo-harrower, minimumQuantity: 1, maximumQuantity: 2 }

  - kind: encounter
    id: encounter.echo-sovereign-march
    name: The Echo Sovereign's march
    tags: [arcane, echo-wrought, elite]
    model: individual
    minDepth: 18
    maxDepth: 19
    environmentTags: []
    requiredVaultTags: []
    weight: 2
    rarity: legendary
    runAppearanceChance: 0.25
    discoveryProtectionIncrement: 0.03
    discoveryProtectionCap: 0.45
    maximumInstancesPerRun: 3
    placement: { minimumStairDistance: 7, minimumObjectiveDistance: 7, maximumMemberDistance: 3, allowedTerrainTags: [floor], requiresVaultSlot: false, failureMode: optional }
    intentPresentation: { visible: true }
    definition: { monsterId: monster.echo-sovereign, minimumQuantity: 1, maximumQuantity: 1 }
```

- [ ] **Step 2: Bump the encounter count in `packages/content/test/default-content.test.ts`**

Change `encounter: 34,` to `encounter: 42,`.

- [ ] **Step 3: Write the failing engine test `packages/engine/test/deep-dungeon-encounters.test.ts`**

This calls the real `placePopulation` path and asserts the candidate encounter set is non-empty at depths 13, 15, 17, 19 (the void-closed success criterion). It also asserts that at depth 13 (a total void before this milestone) every eligible encounter belongs to The Bound.

```ts
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack, EncounterContentEntry } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createDemoRun,
  createUnknownKnowledge,
  placePopulation,
  type ActiveRun,
  type FloorSnapshot,
} from '../src/index.js';

let content: CompiledContentPack;

beforeAll(async () => {
  content = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

function encounters(): readonly EncounterContentEntry[] {
  return content.entries.filter(
    (entry): entry is EncounterContentEntry => entry.kind === 'encounter',
  );
}

// A large, fully-open floor so a legal placement always exists when a candidate is eligible.
function openFloor(depth: number): FloorSnapshot {
  const width = 24;
  const height = 16;
  const tiles = Array.from({ length: width * height }, (_, index) => {
    const x = index % width;
    const y = Math.floor(index / width);
    return x === 0 || y === 0 || x === width - 1 || y === height - 1 ? (0 as const) : (1 as const);
  });
  tiles[1 * width + 1] = 4;
  tiles[(height - 2) * width + (width - 2)] = 5;
  return {
    floorId: 'floor.deep',
    seed: [1, 2, 3, 4],
    generatorVersion: 2,
    width,
    height,
    depth,
    tiles,
    entities: [],
    themeId: 'theme.cavern',
    ambient: { color: [0, 0, 0], strength: 0 },
    knowledge: createUnknownKnowledge(tiles.length),
    lights: [],
    stairUp: { x: 1, y: 1 },
    stairDown: { x: width - 2, y: height - 2 },
    vaults: [],
    placementSlots: [],
  };
}

// Mark every encounter eligible so only the depth gate decides the candidate set.
function runWithAllEligible(): ActiveRun {
  const base = createDemoRun();
  return {
    ...base,
    rng: { ...base.rng, encounters: [1, 2, 3, 4] },
    encounterDecisions: encounters()
      .map((entry) => ({
        encounterId: entry.id,
        baseProbability: entry.runAppearanceChance,
        protectionBonus: 0,
        effectiveProbability: entry.runAppearanceChance,
        eligible: true,
        reachedEligibleDepth: false,
        encountered: false,
        instancesCreated: 0,
      }))
      .sort((left, right) => (left.encounterId < right.encounterId ? -1 : 1)),
  };
}

describe('deep-dungeon depth-band population', () => {
  it.each([13, 15, 17, 19])('has a non-empty candidate encounter set at depth %i', (depth) => {
    const result = placePopulation({
      run: runWithAllEligible(),
      floor: openFloor(depth),
      content,
    });
    // candidates() empty -> status 'skipped' with reason 'no-eligible-encounter'.
    expect(result.reason).not.toBe('no-eligible-encounter');
    expect(result.status).toBe('placed');
    expect(result.encounterId).not.toBeNull();
  });

  it('offers only Bound encounters at depth 13 (previously a total void)', () => {
    const depth = 13;
    const eligible = encounters().filter(
      (entry) => depth >= entry.minDepth && depth <= entry.maxDepth,
    );
    expect(eligible.length).toBeGreaterThan(0);
    expect(eligible.every((entry) => entry.tags.includes('the-bound'))).toBe(true);
  });

  it('covers every deep floor 13 through 19 with at least one eligible encounter', () => {
    for (let depth = 13; depth <= 19; depth += 1) {
      const eligible = encounters().filter(
        (entry) => depth >= entry.minDepth && depth <= entry.maxDepth,
      );
      expect(eligible.length, `depth ${depth}`).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 4: Run to verify it fails, then passes**

Run: `npm run build -w @woven-deep/content && npm test -w @woven-deep/engine -- deep-dungeon-encounters`
Expected: PASS after the encounters compile in. If `result.status` is not `'placed'` at some depth, widen the floor or confirm placement distances (`minimumStairDistance`/`minimumObjectiveDistance`) fit the 24×16 floor — they do (max 7 ≤ interior span).

- [ ] **Step 5: Run the bundled-content test**

Run: `npm test -w @woven-deep/content -- default-content`
Expected: PASS (encounter count now 42).

- [ ] **Step 6: Report demo-hash drift (do NOT edit fixtures)**

Run: `npm test -w @woven-deep/engine`. New encounters raise floor population at 13–19; shallow demos (gameplay/population) stay byte-identical except the embedded content hash, but the **endgame** demo may traverse the deep and its projection/event hashes may move. Report exactly which demo-hash tests fail and whether endgame's non-hash-embed fields moved. Do NOT edit fixtures.

- [ ] **Step 7: Commit**

```bash
git add content/encounters/monster-roster.yaml \
  packages/content/test/default-content.test.ts packages/engine/test/deep-dungeon-encounters.test.ts
git commit -m "content: add depth 13-19 encounters closing the population void"
```

---

## Task 4: Deep-antechamber vault + a second deadlier trap

**Files:**
- Create: `content/traps/warded-glyph-trap.yaml`
- Create: `content/vaults/deep-antechamber.yaml`
- Modify: `packages/content/test/default-content.test.ts` (`trap: 1`→`2`, `vault: 3`→`4`)
- Test: `packages/content/test/deep-antechamber.test.ts`, `packages/engine/test/deep-antechamber-placement.test.ts`

**Interfaces:**
- Consumes: existing `condition.burning`, `effect.damage`, `effect.condition.apply`; existing `fixture.lamp` presentation token; `loot-table.echo-wrought` (from T2) for the vault's item slot; engine `placeVaults` and `analyzeConnectivity` from `@woven-deep/engine`; `compileContentDirectory` from `@woven-deep/content/compiler`.
- Produces: trap id `trap.warded-glyph` (referenced by the vault's trap slot `contentId`); vault id `vault.deep-antechamber`.

The trap slot names the trap by `contentId` (the engine resolves a trap feature from `feature.contentId` via `trapDefinition()` in `packages/engine/src/features.ts`). Referencing the real id keeps runtime resolution valid; the trap is authored NOT in `lampwright-cache`, so the low-depth experience is unchanged.

- [ ] **Step 1: Write `content/traps/warded-glyph-trap.yaml`**

Deadlier than `trap.rusty-dart` (which is 1d4 physical, discovery 7 / disarm 9): arcane 2d6+2 plus a `condition.burning` application, harder to find and disarm.

```yaml
schemaVersion: 7
entries:
  - kind: trap
    id: trap.warded-glyph
    name: Warded glyph
    glyph: "^"
    color: "#8a5fc0"
    tags: [arcane, deep, offense]
    targetingId: target.actor
    discoveryDifficulty: 12
    disarmDifficulty: 14
    disarmOutcomes: { failure: trigger, criticalFailure: trigger, toolDamage: 15 }
    resetMode: once
    effects:
      - { effectId: effect.damage, parameters: { damageType: arcane, dice: { count: 2, sides: 6, bonus: 2 } }, requiresLivingTarget: true }
      - { effectId: effect.condition.apply, parameters: { conditionId: condition.burning }, requiresLivingTarget: true }
```

- [ ] **Step 2: Write `content/vaults/deep-antechamber.yaml`**

A 7×7 square (rotatable) threshold chamber: an entrance door, two pillars, a Heart-glimmer light, two monster ambush slots, an item cache (rolling `loot-table.echo-wrought`), and the new trap slot. Each legend entry declares at most one of entrance/light/slot (schema rule).

```yaml
schemaVersion: 7
entries:
  - kind: vault
    id: vault.deep-antechamber
    name: Deep antechamber
    tags: [deep, heart, threshold]
    minDepth: 13
    maxDepth: 19
    rarity: rare
    weight: 4
    maxPerFloor: 1
    margin: 1
    transforms:
      rotations: [0, 180]
      reflectHorizontal: true
    layout:
      - "#######"
      - "+..O..#"
      - "#.m.n.#"
      - "#..t..#"
      - "#O.i.O#"
      - "#..*..#"
      - "#######"
    legend:
      "#": { terrain: wall }
      ".": { terrain: floor }
      "+": { terrain: closed-door, entrance: true }
      "O": { terrain: pillar }
      "*":
        terrain: floor
        light:
          idSuffix: heart-glimmer
          glyph: "*"
          presentationToken: fixture.lamp
          color: [201, 66, 95]
          radius: 5
          strength: 140
      "m":
        terrain: floor
        slot: { id: ambush-left, kind: monster, required: false, tags: [ambush, deep] }
      "n":
        terrain: floor
        slot: { id: ambush-right, kind: monster, required: false, tags: [ambush, deep] }
      "t":
        terrain: floor
        slot: { id: warded-threshold, kind: trap, required: false, tags: [deep, hazard], contentId: trap.warded-glyph }
      "i":
        terrain: floor
        slot: { id: deep-cache, kind: item, required: true, tags: [cache, deep], lootTableId: loot-table.echo-wrought }
```

- [ ] **Step 3: Bump kind counts in `packages/content/test/default-content.test.ts`**

Change `trap: 1,` to `trap: 2,` and `vault: 3,` to `vault: 4,`.

- [ ] **Step 4: Write the failing content test `packages/content/test/deep-antechamber.test.ts`**

```ts
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TrapContentEntry, VaultContentEntry } from '../src/index.js';
import { compileContentDirectory } from '../src/compiler/index.js';

describe('deep antechamber vault and warded glyph trap', () => {
  it('compiles the trap with arcane damage and a burning condition', async () => {
    const pack = await compileContentDirectory({
      rootDir: resolve(import.meta.dirname, '../../../content'),
    });
    const trap = pack.entries.find((entry) => entry.id === 'trap.warded-glyph') as
      | TrapContentEntry
      | undefined;
    expect(trap).toBeDefined();
    expect(trap!.discoveryDifficulty).toBe(12);
    expect(trap!.effects).toHaveLength(2);
    expect(trap!.effects[0]!.effectId).toBe('effect.damage');
    expect(trap!.effects[1]!.parameters).toMatchObject({ conditionId: 'condition.burning' });
  });

  it('compiles the vault with a trap slot naming the new trap and a deep item cache', async () => {
    const pack = await compileContentDirectory({
      rootDir: resolve(import.meta.dirname, '../../../content'),
    });
    const vault = pack.entries.find((entry) => entry.id === 'vault.deep-antechamber') as
      | VaultContentEntry
      | undefined;
    expect(vault).toBeDefined();
    expect(vault!.minDepth).toBe(13);
    expect(vault!.maxDepth).toBe(19);
    const slots = Object.values(vault!.legend)
      .map((entry) => entry.slot)
      .filter((slot): slot is NonNullable<typeof slot> => slot !== null);
    const trapSlot = slots.find((slot) => slot.kind === 'trap');
    expect(trapSlot?.contentId).toBe('trap.warded-glyph');
    const itemSlot = slots.find((slot) => slot.kind === 'item');
    expect(itemSlot?.lootTableId).toBe('loot-table.echo-wrought');
    expect(slots.filter((slot) => slot.kind === 'monster')).toHaveLength(2);
  });
});
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -w @woven-deep/content -- deep-antechamber`
Expected: PASS. Also run `npm test -w @woven-deep/content -- default-content` → PASS (trap 2, vault 4).

- [ ] **Step 6: Write the engine placement test `packages/engine/test/deep-antechamber-placement.test.ts`**

Mirrors `packages/engine/test/vault-placement.test.ts`: builds a two-room open topology at a deep depth and asserts the vault places with its trap slot exposed.

```ts
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { VaultContentEntry } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  analyzeConnectivity,
  placeVaults,
  type TileId,
  type TopologyDraft,
  type VaultPlacementResult,
} from '../src/index.js';

let vault: VaultContentEntry;

beforeAll(async () => {
  const pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
  vault = pack.entries.find(
    (entry): entry is VaultContentEntry =>
      entry.kind === 'vault' && entry.id === 'vault.deep-antechamber',
  )!;
});

function deepTopology(depth: number): TopologyDraft {
  const width = 30;
  const height = 15;
  const tiles = Array<TileId>(width * height).fill(0);
  const carve = (l: number, t: number, r: number, b: number): void => {
    for (let y = t; y <= b; y += 1) for (let x = l; x <= r; x += 1) tiles[y * width + x] = 1;
  };
  carve(1, 2, 13, 12);
  carve(16, 2, 28, 12);
  carve(13, 7, 16, 7);
  const stairUp = { x: 1, y: 2 };
  const stairDown = { x: 28, y: 2 };
  tiles[stairUp.y * width + stairUp.x] = 4;
  tiles[stairDown.y * width + stairDown.x] = 5;
  const connectivity = analyzeConnectivity({ width, height, tiles, start: stairUp, target: stairDown });
  return {
    floorId: 'floor.deep-vault',
    floorSeed: [4, 3, 2, 1],
    depth,
    themeId: 'theme.test',
    width,
    height,
    tiles,
    rooms: [
      { roomId: 'room.0', left: 1, top: 2, right: 13, bottom: 12 },
      { roomId: 'room.1', left: 16, top: 2, right: 28, bottom: 12 },
    ],
    corridors: [{ corridorId: 'corridor.0', start: { x: 13, y: 7 }, end: { x: 16, y: 7 } }],
    stairUp,
    stairDown,
    vaultState: [1, 2, 3, 4],
    report: {
      generatorVersion: 2,
      attempt: 0,
      fallback: false,
      roomCount: 2,
      corridorCount: 1,
      vaults: [],
      stairUp,
      stairDown,
      stairDistance: connectivity.distance!,
      traversableCellCount: connectivity.traversableCellCount,
      connected: true,
      rejectionCounts: {},
    },
  };
}

function success(result: VaultPlacementResult): Extract<VaultPlacementResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.code);
  return result;
}

describe('deep antechamber placement', () => {
  it('places at depth 15 and exposes its trap and item slots', () => {
    const placed = success(
      placeVaults(deepTopology(15), [vault], { requiredVaultId: vault.id }),
    );
    expect(placed.vaults).toHaveLength(1);
    const kinds = placed.placementSlots.map((slot) => slot.kind).sort();
    expect(kinds).toContain('trap');
    expect(kinds).toContain('item');
    expect(placed.placementSlots.filter((slot) => slot.kind === 'monster')).toHaveLength(2);
  });

  it('is rejected outside its depth band', () => {
    const result = placeVaults(deepTopology(3), [vault], { requiredVaultId: vault.id });
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 7: Run the engine placement test**

Run: `npm run build -w @woven-deep/content && npm test -w @woven-deep/engine -- deep-antechamber-placement`
Expected: PASS. (If `placeVaults`'s failure shape for a too-shallow depth differs, assert `result.ok === false` only — that is the stable contract, matching the `tooDeep` case in `vault-placement.test.ts`.)

- [ ] **Step 8: Report demo-hash drift (do NOT edit fixtures)**

Run: `npm test -w @woven-deep/engine`. Confirm only content-hash-embed demo-hash tests newly fail; report which. Do NOT edit fixtures.

- [ ] **Step 9: Commit**

```bash
git add content/traps/warded-glyph-trap.yaml content/vaults/deep-antechamber.yaml \
  packages/content/test/deep-antechamber.test.ts packages/content/test/default-content.test.ts \
  packages/engine/test/deep-antechamber-placement.test.ts
git commit -m "content: add deep-antechamber vault and warded-glyph trap"
```

---

## Task 5: Deep reward relics + deeper merchant tiers

**Files:**
- Create: `content/items/deep-relics.yaml`
- Modify: `content/loot-tables/monster-families.yaml` (add reward choices to `loot-table.the-bound` and `loot-table.echo-wrought`)
- Modify: `content/loot-tables/town-curios.yaml`, `content/loot-tables/town-arms.yaml`, `content/loot-tables/town-provisioner.yaml`
- Modify: `packages/content/test/default-content.test.ts` (`item: 43`→`45`)
- Test: `packages/content/test/deep-rewards.test.ts`, `packages/engine/test/deep-loot-resolve.test.ts`

**Interfaces:**
- Consumes: loot-table ids `loot-table.the-bound`, `loot-table.echo-wrought` (T1/T2); existing `item.ashen-potion`; engine `createFloorLootFromTable` (re-exported from `@woven-deep/engine` via `inventory.js`).
- Produces: item ids `item.bound-signet` (minDepth 13), `item.echo-heartstone` (minDepth 15), wired into family kill-loot and town restocks.

Merchant-tier placement (mirrors the `town-curios.yaml` minDepth-gated `choices` precedent at 5/10/15/20, all three town tables covered): `town-curios` gains `item.echo-heartstone` at minDepth 15; `town-arms` gains the defensive `item.bound-signet` at minDepth 13; `town-provisioner` gains `item.ashen-potion` at minDepth 15. Both new relics have positive price and no reserved tags (heirloom/quest/objective/nontransferable), so they pass merchant-stock validation.

- [ ] **Step 1: Write `content/items/deep-relics.yaml`**

Rings mirror `item.warden-ember`/`item.etched-ring` exactly (category `ring`, both ring slots, `identification.mode: known`).

```yaml
schemaVersion: 7
entries:
  - kind: item
    id: item.bound-signet
    name: Bound signet
    glyph: "="
    color: "#6a4f92"
    description: A ring of fused binding-iron, cold to the touch, that seems to shoulder a portion of every blow aimed at its wearer.
    lore: "It was cut from a warden that had forgotten what it guarded. Worn now, it guards again, indiscriminately, out of a habit that outlived its reasons."
    tags: [deep-reward, arcane, defense]
    minDepth: 13
    maxDepth: 20
    category: ring
    stackLimit: 1
    price: 220
    rarity: rare
    actionCost: 100
    equipment: { slots: [left-ring, right-ring], handedness: none, reservedSlots: [] }
    combat: { accuracy: 1, defense: 2, armor: 1, damage: null, range: 0, ammunitionTag: null }
    light: null
    identification: { mode: known, poolId: null }
    effects: []

  - kind: item
    id: item.echo-heartstone
    name: Echo heartstone
    glyph: "="
    color: "#c9425f"
    description: A shard of the Heart's own residue set in a band, warm and faintly beating, lending its wearer a sliver of the pull that raises the dead.
    lore: "The Heart sheds pieces of itself into everything it remakes. This one was prised from an Echo Sovereign's brow. It still remembers being part of something larger, and it wants to go home."
    tags: [deep-reward, arcane, offense]
    minDepth: 15
    maxDepth: 20
    category: ring
    stackLimit: 1
    price: 320
    rarity: legendary
    actionCost: 100
    equipment: { slots: [left-ring, right-ring], handedness: none, reservedSlots: [] }
    combat: { accuracy: 2, defense: 2, armor: 1, damage: null, range: 0, ammunitionTag: null }
    light: null
    identification: { mode: known, poolId: null }
    effects: []
```

- [ ] **Step 2: Wire the reward relics into the family kill-loot in `content/loot-tables/monster-families.yaml`**

Add a depth-gated choice to `loot-table.the-bound` (append to its `choices`):

```yaml
      - { contentId: item.bound-signet, lootTableId: null, weight: 1, minimumQuantity: 1, maximumQuantity: 1, minDepth: 13 }
```

Add a depth-gated choice to `loot-table.echo-wrought` (append to its `choices`):

```yaml
      - { contentId: item.echo-heartstone, lootTableId: null, weight: 1, minimumQuantity: 1, maximumQuantity: 1, minDepth: 15 }
```

- [ ] **Step 3: Add deep tiers to the three town loot tables**

`content/loot-tables/town-curios.yaml` — append to `choices` (a deep relic joins the depth-15 restock):

```yaml
      - { contentId: item.echo-heartstone, lootTableId: null, weight: 1, minimumQuantity: 1, maximumQuantity: 1, minDepth: 15 }
```

`content/loot-tables/town-arms.yaml` — append to `choices` (a defensive relic at the deep restock):

```yaml
      - { contentId: item.bound-signet, lootTableId: null, weight: 1, minimumQuantity: 1, maximumQuantity: 1, minDepth: 13 }
```

`content/loot-tables/town-provisioner.yaml` — append to `choices` (a stronger healing potion from depth 15 onward):

```yaml
      - { contentId: item.ashen-potion, lootTableId: null, weight: 2, minimumQuantity: 1, maximumQuantity: 1, minDepth: 15 }
```

- [ ] **Step 4: Bump the item count in `packages/content/test/default-content.test.ts`**

Change `item: 43,` to `item: 45,`.

- [ ] **Step 5: Write the failing content test `packages/content/test/deep-rewards.test.ts`**

```ts
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ItemContentEntry, LootTableContentEntry } from '../src/index.js';
import { compileContentDirectory } from '../src/compiler/index.js';

describe('deep reward relics and merchant tiers', () => {
  it('compiles two deep reward rings gated by depth', async () => {
    const pack = await compileContentDirectory({
      rootDir: resolve(import.meta.dirname, '../../../content'),
    });
    const byId = new Map(pack.entries.map((entry) => [entry.id, entry]));
    const signet = byId.get('item.bound-signet') as ItemContentEntry;
    const heartstone = byId.get('item.echo-heartstone') as ItemContentEntry;
    expect(signet.category).toBe('ring');
    expect(signet.minDepth).toBe(13);
    expect(signet.price).toBeGreaterThan(0);
    expect(heartstone.minDepth).toBe(15);
    expect(heartstone.rarity).toBe('legendary');
    // Reward relics must be sellable without tripping reserved-tag merchant rules.
    for (const item of [signet, heartstone]) {
      for (const reserved of ['heirloom', 'quest', 'objective', 'nontransferable']) {
        expect(item.tags).not.toContain(reserved);
      }
    }
  });

  it('wires the relics into family kill-loot and the town restocks at the right depths', async () => {
    const pack = await compileContentDirectory({
      rootDir: resolve(import.meta.dirname, '../../../content'),
    });
    const table = (id: string): LootTableContentEntry =>
      pack.entries.find(
        (entry): entry is LootTableContentEntry => entry.kind === 'loot-table' && entry.id === id,
      )!;
    const choice = (id: string, contentId: string) =>
      table(id).choices.find((entry) => entry.contentId === contentId);
    expect(choice('loot-table.the-bound', 'item.bound-signet')).toMatchObject({ minDepth: 13 });
    expect(choice('loot-table.echo-wrought', 'item.echo-heartstone')).toMatchObject({ minDepth: 15 });
    expect(choice('loot-table.town-curios', 'item.echo-heartstone')).toMatchObject({ minDepth: 15 });
    expect(choice('loot-table.town-arms', 'item.bound-signet')).toMatchObject({ minDepth: 13 });
    expect(choice('loot-table.town-provisioner', 'item.ashen-potion')).toMatchObject({ minDepth: 15 });
  });
});
```

- [ ] **Step 6: Run to verify it passes**

Run: `npm test -w @woven-deep/content -- deep-rewards`
Expected: PASS. Also `npm test -w @woven-deep/content -- default-content` → PASS (item 45).

- [ ] **Step 7: Write the engine loot-resolve test `packages/engine/test/deep-loot-resolve.test.ts`**

Exercises real resolution: `createFloorLootFromTable` on `loot-table.the-bound` yields item instances whose `contentId`s are all valid choices from the table.

```ts
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack, LootTableContentEntry } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { createFloorLootFromTable } from '../src/index.js';

let content: CompiledContentPack;

beforeAll(async () => {
  content = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

function allowedContentIds(tableId: string): ReadonlySet<string> {
  const table = content.entries.find(
    (entry): entry is LootTableContentEntry =>
      entry.kind === 'loot-table' && entry.id === tableId,
  )!;
  return new Set(
    table.choices
      .map((choice) => choice.contentId)
      .filter((id): id is string => id !== null),
  );
}

describe('deep family loot resolves', () => {
  it.each(['loot-table.the-bound', 'loot-table.echo-wrought'])(
    'resolves %s to items drawn only from its choices',
    (tableId) => {
      const allowed = allowedContentIds(tableId);
      const result = createFloorLootFromTable({
        content,
        tableId,
        state: [7, 11, 13, 17],
        itemIdPrefix: `item.test.${tableId}`,
        floorId: 'floor.test',
        x: 3,
        y: 4,
      });
      expect(result.items.length).toBeGreaterThan(0);
      for (const item of result.items) {
        expect(allowed.has(item.contentId)).toBe(true);
      }
    },
  );
});
```

- [ ] **Step 8: Run the loot-resolve test**

Run: `npm run build -w @woven-deep/content && npm test -w @woven-deep/engine -- deep-loot-resolve`
Expected: PASS. (If `createFloorLootFromTable`'s argument names differ from `{ content, tableId, state, itemIdPrefix, floorId, x, y }`, read its signature in `packages/engine/src/inventory.ts` and adjust the call — do NOT change the source.)

- [ ] **Step 9: Report demo-hash drift; then commit**

Run: `npm test -w @woven-deep/engine`; report which demo-hash tests fail (do NOT edit fixtures). New town-restock choices are depth-gated at 13/15, so town-merchant demos at shallow depth stay byte-identical except the content hash — flag if the **merchant** demo's non-hash fields move (they should not).

```bash
git add content/items/deep-relics.yaml content/loot-tables/monster-families.yaml \
  content/loot-tables/town-curios.yaml content/loot-tables/town-arms.yaml \
  content/loot-tables/town-provisioner.yaml packages/content/test/deep-rewards.test.ts \
  packages/content/test/default-content.test.ts packages/engine/test/deep-loot-resolve.test.ts
git commit -m "content: add deep reward relics and deeper merchant tiers"
```

---

## Task 6: Balance-sanity assertion + whole-surface gate

**Files:**
- Test: `packages/content/test/deep-dungeon-balance.test.ts`
- No content change. This task confirms the ramp and drives the final gate after the controller's fixture regens.

**Interfaces:**
- Consumes: all monster ids from T1/T2 and the existing `monster.ashen-juggernaut`, `monster.weakened-heart`.
- Produces: nothing (verification only).

- [ ] **Step 1: Write the failing balance test `packages/content/test/deep-dungeon-balance.test.ts`**

```ts
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MonsterContentEntry } from '../src/index.js';
import { compileContentDirectory } from '../src/compiler/index.js';

// The spec's designated depth-12 anchor is the ashwrought elite (NOT monster.ashen-warden,
// which is a lower-threat depth-5-12 guardian). Curated representative ramp, one step per
// difficulty tier from depth 12 to the depth-20 boss.
const RAMP_ANCHORS = [
  'monster.ashen-juggernaut',
  'monster.bound-shackled',
  'monster.bound-warden',
  'monster.echo-colossus',
  'monster.echo-sovereign',
  'monster.weakened-heart',
] as const;

const NEW_MONSTERS = [
  'monster.bound-wretch',
  'monster.bound-shackled',
  'monster.bound-warden',
  'monster.bound-hexbound',
  'monster.echo-breaker',
  'monster.echo-colossus',
  'monster.echo-harrower',
  'monster.echo-sovereign',
] as const;

describe('deep-dungeon difficulty ramp', () => {
  it('is monotonic in health and threat across the ramp anchors 12 -> 20', async () => {
    const pack = await compileContentDirectory({
      rootDir: resolve(import.meta.dirname, '../../../content'),
    });
    const byId = new Map(pack.entries.map((entry) => [entry.id, entry]));
    const anchors = RAMP_ANCHORS.map((id) => byId.get(id) as MonsterContentEntry);
    anchors.forEach((monster, index) => expect(monster, RAMP_ANCHORS[index]).toBeDefined());
    for (let index = 1; index < anchors.length; index += 1) {
      expect(anchors[index]!.health).toBeGreaterThanOrEqual(anchors[index - 1]!.health);
      expect(anchors[index]!.threat).toBeGreaterThanOrEqual(anchors[index - 1]!.threat);
    }
  });

  it('keeps every new non-boss monster under the depth-20 weakened heart', async () => {
    const pack = await compileContentDirectory({
      rootDir: resolve(import.meta.dirname, '../../../content'),
    });
    const byId = new Map(pack.entries.map((entry) => [entry.id, entry]));
    const boss = byId.get('monster.weakened-heart') as MonsterContentEntry;
    expect(boss.health).toBe(58);
    expect(boss.threat).toBe(20);
    for (const id of NEW_MONSTERS) {
      const monster = byId.get(id) as MonsterContentEntry;
      expect(monster, id).toBeDefined();
      expect(monster.health, id).toBeLessThan(boss.health);
      expect(monster.threat, id).toBeLessThan(boss.threat);
    }
  });
});
```

- [ ] **Step 2: Run to verify it passes**

Run: `npm test -w @woven-deep/content -- deep-dungeon-balance`
Expected: PASS (anchor health 52,52,53,55,57,58; threat 10,11,12,15,18,20 — both non-decreasing; all new monsters < 58 health, < 20 threat).

- [ ] **Step 3: Commit the balance test**

```bash
git add packages/content/test/deep-dungeon-balance.test.ts
git commit -m "test: assert deep-dungeon ramp is monotonic and under the boss"
```

- [ ] **Step 4: CONTROLLER checkpoint — regenerate demo fixtures**

STOP. This step is the controller's, not the implementer's. The controller regenerates every content-hash-embed demo fixture and runs the real-vs-benign diff-check for each:

```bash
npm run dungeon:demo && npm run gameplay:demo && npm run merchant:demo && \
npm run population:demo && npm run run-records:demo && npm run magic:demo && \
npm run endgame:demo && npm run engine:demo
```

Each `*:demo --verify` script rewrites its `packages/engine/test/fixtures/*-demo-hashes.json`. The controller confirms that for shallow demos only the embedded content-hash field moved (benign) and that any projection/event-hash movement (expected in **endgame** if it traverses 13–19) is an intended content change, not a determinism regression.

- [ ] **Step 5: Whole-surface gate**

Run the full verification surface (worktrees need `npm install` first if not yet done):

```bash
npm run verify
```

Expected: PASS — typecheck, lint, format:check, depcruise, knip, and all workspace tests green, including the eight regenerated demo `--verify` scripts and the cross-process parity harness (client-core and server produce identical simulation). Confirm all eight demos are byte-identical to their regenerated fixtures.

- [ ] **Step 6: Final commit (if fixtures were regenerated on this branch)**

```bash
git add packages/engine/test/fixtures/*-demo-hashes.json
git commit -m "chore: regenerate demo fixtures for deep-dungeon content hash"
```

---

## Self-Review

**1. Spec coverage.** Every design section maps to a task:
- §1 two families + ramp → T1 (The Bound: arcane, resist physical, negative fire weakness, hexbound capstone), T2 (Echo-wrought: heavy brutes, physical+arcane, legendary named elite threat 18), T6 (monotonic ramp + under-boss gate). Caster boundary honored (tags+resistances, no damage type; `behavior.approach-and-attack`).
- §2 encounters (individual/group/swarm, staggered 13–19) → T3, with the real `population-placement.ts` `candidates` path exercised for the non-empty-at-13/15/17/19 success criterion.
- §3 deep-antechamber vault + second deadlier trap (not in `lampwright-cache`) → T4.
- §4 kill loot (`loot-table.the-bound`/`echo-wrought`), deep reward relics gated 13/15, deeper merchant tiers (all three town tables), tablet-fragment narrative coherence (flavor only, no mechanic) → T1/T2/T5.
- §5 determinism/testing/scope → Global Constraints + the per-task demo-drift report steps + T6 gate; content-only, STRICT validation, no engine/schema change throughout.

**2. Placeholder scan.** No "TBD"/"similar to"/"add appropriate…". Every YAML block is complete with real field values; every test has full code and exact `npm test -w … -- <file>` commands with expected results.

**3. Consistency.** Monster ids (`bound-*`, `echo-*`) referenced identically in T1/T2 (definition), T3 (encounter `monsterId`/roles/swarm source), T5 (unchanged), and T6 (anchors). Loot ids `loot-table.the-bound`/`loot-table.echo-wrought` created T1/T2, extended T5, referenced by the T4 vault item slot. Reward ids `item.bound-signet`/`item.echo-heartstone` created T5 and forward-references avoided (family tables reference them only in T5, after the items exist). Trap id `trap.warded-glyph` created and referenced by the vault slot within T4. Ramp values verified monotonic: health 52,52,53,55,57,58; threat 10,11,12,15,18,20; all new monsters < 58/20. Kind-count bumps chain correctly to the final monster 43 / item 45 / trap 2 / loot-table 19 / vault 4 / encounter 42.

---

**Plan complete and saved to `docs/superpowers/plans/2026-07-24-deep-dungeon.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — a fresh subagent per task with review between tasks; fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
