# Milestone Bosses (7B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three guaranteed milestone bosses (depths 5/10/15) — band capstones escalating toward the Heart — each in a forced boss-arena vault and each dropping a unique reward.

**Architecture:** Reuse the generic `model: 'boss'` encounter + `boss-behavior.ts` (phases + unconditional `uniqueItemId` drop) and the vault-gated population path. Two small, additive, off-milestone-no-op engine changes make the boss *guaranteed*: (a) `floor-transition.ts` discovers a `milestone-boss`-tagged vault pinned to the descent depth and forces it via the existing `requiredVaultId` primitive; (b) `placeFloorPopulations` force-places any eligible boss encounter whose non-empty required vault tags are present, before its weighted density loop. Everything else is content.

**Tech Stack:** TypeScript 5.8 (strict + exactOptionalPropertyTypes), ESM `.js` specifiers, Zod v4 STRICT content schemas, Vitest, deterministic seeded `Uint32State` RNG. npm workspaces monorepo (`@woven-deep/content`, `@woven-deep/engine`).

## Global Constraints

- **Determinism is a hard invariant.** All RNG is explicit `Uint32State` threaded per stream — never `Math.random`. Both engine changes MUST be byte-identical no-ops on every non-milestone floor (no milestone-tagged vault present → no forced vault, pre-pass places nothing and consumes no RNG).
- **STRICT content validation** (`z.strictObject`): no stray keys; `maxDepth >= minDepth`; every referenced content id resolves.
- **Caster boundary:** every monster uses `behaviorId: behavior.approach-and-attack`. Arcane identity = arcane `damage` type + `resistances` + `tags`, never literal spellcasting. Phases change combat `modifiers`/`effects`, not AI.
- **Reward power ceiling:** each milestone reward's combat-stat budget (`accuracy + defense + armor`) is strictly below the depth-20 final ring `item.heart-cinder {accuracy 1, defense 1, armor 1}` (total 3), and non-decreasing across depths 5→10→15. Each reward `price` < heart-cinder's 260.
- **Difficulty ramp:** boss `threat` strictly ascending 5 < 10 < 15, each strictly below `monster.weakened-heart` threat 20. Boss `health` is monotonic **among the three bosses** (it may exceed the Heart's raw 58 — the Heart's lethality is its full finale, not a raw number).
- **Content tags:** each arena vault is tagged `[milestone-boss, milestone-boss-<depth>]` and pinned `minDepth == maxDepth == <depth>`. Each boss encounter has `requiredVaultTags: [milestone-boss-<depth>]` and `definition.vaultTags: [milestone-boss-<depth>]`, `runAppearanceChance: 1.0`, `placement.requiresVaultSlot: true`.
- **`npm run verify`** (typecheck + lint + format:check + depcruise + knip + test) must pass at the end of every task. Run `npx prettier --write` on changed files before committing.
- **Fixture-regen recipe** (per demo, used in content tasks): build content+engine, run the demo script **without** `--verify` (it writes candidate hashes to a temp path and prints it), diff the candidate against the reviewed fixture, and — only if the diff is the intended/benign set — copy the candidate over `packages/engine/test/fixtures/<demo>-demo-hashes.json`, then re-run with `--verify` to confirm green.

---

### Task 1: Engine change (a) — milestone-boss vault discovery + `requiredVaultId` wiring

**Files:**
- Modify: `packages/engine/src/floor-transition.ts` (add exported `milestoneBossVaultId`; pass `requiredVaultId` into the normal `generateFloor` call at ~line 174)
- Test: `packages/engine/test/milestone-boss-vault.test.ts` (create)

**Interfaces:**
- Consumes: `VaultContentEntry` (already imported in `floor-transition.ts`), `generateFloor` request field `requiredVaultId?: string` (exists, `generate-floor.ts:24`).
- Produces: `export function milestoneBossVaultId(vaults: readonly VaultContentEntry[], depth: number): string | undefined` — returns the id of the single `milestone-boss`-tagged vault whose depth band contains `depth`, `undefined` if none, throws if more than one.

- [ ] **Step 1: Write the failing test**

Create `packages/engine/test/milestone-boss-vault.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { VaultContentEntry } from '@woven-deep/content';
import { milestoneBossVaultId } from '../src/index.js';

function vault(id: string, tags: string[], minDepth: number, maxDepth: number): VaultContentEntry {
  return {
    kind: 'vault',
    id,
    name: id,
    tags,
    minDepth,
    maxDepth,
    rarity: 'common',
    weight: 1,
    maxPerFloor: 1,
    margin: 0,
    transforms: { rotations: [0], reflectHorizontal: false },
    layout: ['#'],
    legend: { '#': { terrain: 'wall' } },
  } as unknown as VaultContentEntry;
}

describe('milestoneBossVaultId', () => {
  const vaults = [
    vault('vault.ashfather-arena', ['milestone-boss', 'milestone-boss-5'], 5, 5),
    vault('vault.tide-sovereign-arena', ['milestone-boss', 'milestone-boss-10'], 10, 10),
    vault('vault.lampwright-cache', [], 1, 20),
  ];

  it('returns the pinned arena id at a milestone depth', () => {
    expect(milestoneBossVaultId(vaults, 5)).toBe('vault.ashfather-arena');
    expect(milestoneBossVaultId(vaults, 10)).toBe('vault.tide-sovereign-arena');
  });

  it('returns undefined at a non-milestone depth', () => {
    expect(milestoneBossVaultId(vaults, 6)).toBeUndefined();
    expect(milestoneBossVaultId(vaults, 20)).toBeUndefined();
  });

  it('throws when two milestone-boss vaults are pinned to one depth', () => {
    const clashing = [...vaults, vault('vault.duplicate-arena', ['milestone-boss'], 5, 5)];
    expect(() => milestoneBossVaultId(clashing, 5)).toThrow(/depth 5/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --root packages/engine milestone-boss-vault`
Expected: FAIL — `milestoneBossVaultId` is not exported.

- [ ] **Step 3: Implement `milestoneBossVaultId` and export it**

In `packages/engine/src/floor-transition.ts`, add near the top (after the imports, before `nextFloorId`):

```ts
const MILESTONE_BOSS_VAULT_TAG = 'milestone-boss';

/**
 * The single `milestone-boss`-tagged vault whose depth band contains `depth`, if any. Each milestone
 * arena is depth-pinned (`minDepth == maxDepth`), so at most one matches a given depth; more than one
 * is a content authoring error. Keeps the milestone depth set {5,10,15} entirely in content — the
 * engine only knows "force the milestone-boss vault pinned here, if one exists."
 */
export function milestoneBossVaultId(
  vaults: readonly VaultContentEntry[],
  depth: number,
): string | undefined {
  const matches = vaults.filter(
    (vault) =>
      vault.tags.includes(MILESTONE_BOSS_VAULT_TAG) &&
      depth >= vault.minDepth &&
      depth <= vault.maxDepth,
  );
  if (matches.length > 1) {
    throw new Error(
      `internal invariant: ${matches.length} milestone-boss vaults pinned to depth ${depth}: ` +
        matches.map((vault) => vault.id).join(', '),
    );
  }
  return matches[0]?.id;
}
```

Confirm `floor-transition.ts` is re-exported from `packages/engine/src/index.ts` (it exports `depthFloorId` from there already). If `milestoneBossVaultId` is not surfaced, add `export { milestoneBossVaultId } from './floor-transition.js';` (or widen the existing `export *`) in `packages/engine/src/index.ts`.

- [ ] **Step 4: Wire `requiredVaultId` into the real per-depth generation**

In `packages/engine/src/floor-transition.ts`, the normal descent path currently reads (~line 170-186):

```ts
  const allocation = allocateFloorSeed(run.rng.generation);
  const vaults = context.content.entries.filter(
    (entry): entry is VaultContentEntry => entry.kind === 'vault',
  );
  const generated = generateFloor({
    floorId,
    floorSeed: allocation.floorSeed,
    depth: nextDepth,
    width: NEW_RUN_FLOOR_WIDTH,
    height: NEW_RUN_FLOOR_HEIGHT,
    theme: createClassicTheme(
      NEW_RUN_FLOOR_WIDTH,
      NEW_RUN_FLOOR_HEIGHT,
      NEW_RUN_FLOOR_THEME_SETTINGS,
    ),
    vaults,
  });
```

Change it to compute and conditionally spread `requiredVaultId` (exactOptionalPropertyTypes forbids passing `undefined`):

```ts
  const allocation = allocateFloorSeed(run.rng.generation);
  const vaults = context.content.entries.filter(
    (entry): entry is VaultContentEntry => entry.kind === 'vault',
  );
  const requiredVaultId = milestoneBossVaultId(vaults, nextDepth);
  const generated = generateFloor({
    floorId,
    floorSeed: allocation.floorSeed,
    depth: nextDepth,
    width: NEW_RUN_FLOOR_WIDTH,
    height: NEW_RUN_FLOOR_HEIGHT,
    theme: createClassicTheme(
      NEW_RUN_FLOOR_WIDTH,
      NEW_RUN_FLOOR_HEIGHT,
      NEW_RUN_FLOOR_THEME_SETTINGS,
    ),
    vaults,
    ...(requiredVaultId === undefined ? {} : { requiredVaultId }),
  });
```

- [ ] **Step 5: Run the new test + confirm no behavior change**

Run: `npx vitest run --root packages/engine milestone-boss-vault`
Expected: PASS (3 tests).

Run: `npm run build --workspace @woven-deep/content && npm run build --workspace @woven-deep/engine && npm run test --workspace @woven-deep/engine`
Expected: PASS. Because no `milestone-boss`-tagged vault exists in content yet, `milestoneBossVaultId` returns `undefined` at every depth and the `generateFloor` call is unchanged — all existing `*-cli.test.ts` fixture guards stay green (byte-identical).

- [ ] **Step 6: Format and commit**

```bash
npx prettier --write packages/engine/src/floor-transition.ts packages/engine/src/index.ts packages/engine/test/milestone-boss-vault.test.ts
git add packages/engine/src/floor-transition.ts packages/engine/src/index.ts packages/engine/test/milestone-boss-vault.test.ts
git commit -m "feat(engine): discover and force milestone-boss arena vault by depth"
```

---

### Task 2: Engine change (b) — guaranteed vault-gated boss pre-pass in `placeFloorPopulations`

**Files:**
- Modify: `packages/engine/src/population-placement.ts` (extract the loop-body commit into a helper `applyPopulationPlacement`; add a guaranteed-boss pre-pass before the weighted attempts loop in `placeFloorPopulations`)
- Test: `packages/engine/test/guaranteed-boss.test.ts` (create)

**Interfaces:**
- Consumes: `placePopulation` (exported), the module-local `availableVaultTags(floor, content)` (~line 210) and `requiredAnchorTags(encounter)` (~line 415), `PlacePopulationInput`, `FloorPopulationsResult`.
- Produces: no new exported symbol; `placeFloorPopulations` now force-places eligible bosses whose non-empty required vault tags are present, before the weighted loop.

- [ ] **Step 1: Write the failing test**

Create `packages/engine/test/guaranteed-boss.test.ts`. It builds a synthetic content pack (one boss encounter with a non-empty required vault tag + one empty-tag boss) on a floor whose placed vault provides the tag, and asserts the tagged boss is force-placed while the empty-tag boss is not.

```ts
import { describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import {
  createDemoRun,
  createDemoContentPack,
  placeFloorPopulations,
  type ActiveRun,
} from '../src/index.js';
import { buildGuaranteedBossFixture } from './helpers/guaranteed-boss-fixture.js';

describe('guaranteed vault-gated boss pre-pass', () => {
  it('force-places a boss whose non-empty required vault tags are present on the floor', () => {
    const { content, run, floor } = buildGuaranteedBossFixture({ arenaTagPresent: true });
    const result = placeFloorPopulations({ run, floor, content });
    const bossActors = result.state.actors.filter((actor) => actor.contentId === 'monster.arena-boss');
    expect(bossActors).toHaveLength(1);
  });

  it('does not force-place the boss when the arena tag is absent (no vault) — RNG untouched', () => {
    const withArena = buildGuaranteedBossFixture({ arenaTagPresent: true });
    const withoutArena = buildGuaranteedBossFixture({ arenaTagPresent: false });
    const result = placeFloorPopulations({
      run: withoutArena.run,
      floor: withoutArena.floor,
      content: withoutArena.content,
    });
    const bossActors = result.state.actors.filter((actor) => actor.contentId === 'monster.arena-boss');
    expect(bossActors).toHaveLength(0);
    // The encounters RNG stream is untouched when the pre-pass places nothing and no weighted
    // encounter is eligible on the bare floor.
    expect(result.state.rng.encounters).toEqual(withoutArena.run.rng.encounters);
    expect(withArena.content).toBeDefined();
  });

  it('excludes an empty-vault-tag boss from the pre-pass (weighted behavior preserved)', () => {
    const { content, run, floor } = buildGuaranteedBossFixture({
      arenaTagPresent: true,
      emptyTagBoss: true,
    });
    const result = placeFloorPopulations({ run, floor, content });
    // The empty-tag boss is never force-placed; only the tagged arena boss is guaranteed.
    const emptyTagActors = result.state.actors.filter(
      (actor) => actor.contentId === 'monster.wild-boss',
    );
    expect(emptyTagActors).toHaveLength(0);
  });
});
```

Create the fixture helper `packages/engine/test/helpers/guaranteed-boss-fixture.ts`. It assembles a minimal real `CompiledContentPack` (reusing `createDemoContentPack` as a base and appending a boss monster, a boss encounter with `requiredVaultTags: ['arena-tag']` + `requiresVaultSlot: true`, and — when `arenaTagPresent` — a placed vault on the floor whose tags include `arena-tag` plus a `monster` slot tagged `arena-tag`). Model its floor/topology on `packages/engine/test/deep-antechamber-placement.test.ts` (`deepTopology`) and its run/decision shape on the population test in `packages/engine/test/generate-floor.test.ts` (~line 150-165). The boss's `encounterDecisions` entry must be `{ encounterId: 'encounter.arena-boss', baseProbability: 1, protectionBonus: 0, effectiveProbability: 1, eligible: true, reachedEligibleDepth: false, encountered: false, instancesCreated: 0 }`. The floor must carry the placed vault in `floor.vaults` and the `monster` slot in `floor.placementSlots` with `vaultPlacementId` matching, so `availableVaultTags` and `slotProvidesTags` resolve `arena-tag`.

> Implementer note: if assembling a full synthetic vault-placed floor is heavier than a direct `placeVaults` call, generate the floor instead with `generateFloor` given a required arena vault (as Task 3's e2e test does) and reuse that here. Either way the assertion is the same: the tagged boss is guaranteed, the empty-tag boss is not, and a tag-absent floor leaves the encounters RNG untouched.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --root packages/engine guaranteed-boss`
Expected: FAIL — the tagged boss is not placed (pre-pass does not exist yet).

- [ ] **Step 3: Extract the placement-commit helper (behavior-preserving)**

In `packages/engine/src/population-placement.ts`, the body of the `for` loop in `placeFloorPopulations` (~lines 1094-1147) mutates `run` and pushes events on a `placed`/`skipped`/`rejected` placement. Extract that body verbatim into a module-local helper so the pre-pass and the loop share one implementation (no duplicated logic):

```ts
/**
 * Applies one population placement to the running state: threads the encounters/merchant-stock RNG,
 * commits created actors/items/features/populations on `placed`, and emits the matching domain
 * events. Returns the advanced run and whether the caller should stop (a `rejected` placement).
 * Shared by the guaranteed-boss pre-pass and the weighted density loop so both commit identically.
 */
function applyPopulationPlacement(
  run: ActiveRun,
  placement: PopulationPlacementResult,
  events: DomainEvent[],
  eventId: string,
): Readonly<{ run: ActiveRun; stop: boolean }> {
  let next: ActiveRun = {
    ...run,
    rng: {
      ...run.rng,
      encounters: placement.nextEncounterState,
      ...(placement.status === 'placed' && placement.nextMerchantStockState !== null
        ? { 'merchant-stock': placement.nextMerchantStockState }
        : {}),
    },
    encounterDecisions: placement.encounterDecisions,
  };
  if (placement.status === 'placed') {
    next = {
      ...next,
      actors: sortByActorId([...next.actors, ...placement.createdActors]),
      items:
        placement.createdItems.length === 0
          ? next.items
          : sortByItemId([...next.items, ...placement.createdItems]),
      features:
        placement.createdFeatures.length === 0
          ? next.features
          : sortByFeatureId([...next.features, ...placement.createdFeatures]),
      populations: sortByPopulationId([...next.populations, placement.population]),
    };
    events.push({
      type: 'population.created',
      eventId,
      populationId: placement.population.populationId,
      encounterId: placement.population.encounterId,
      floorId: placement.population.floorId,
      model: placement.population.model,
      actorIds: placement.population.livingMemberIds,
    });
    if (placement.population.model === 'group' && placement.population.leaderActorId !== null) {
      const leaderActorId = placement.population.leaderActorId;
      const roleId = placement.population.roleMembership.find(
        (role) => role.actorId === leaderActorId,
      )?.roleId;
      if (roleId === undefined)
        throw new Error(`internal invariant: group leader ${leaderActorId} has no role`);
      events.push({ type: 'group.leader-created', eventId, populationId: placement.population.populationId, actorId: leaderActorId, roleId });
    }
  } else if (placement.status === 'skipped') {
    for (const diagnostic of placement.diagnostics)
      events.push({ ...diagnostic, eventId, floorId: placement.population?.floorId ?? '' });
  }
  return { run: next, stop: placement.status === 'rejected' };
}
```

> Implementer note: preserve the EXACT event payloads and the `skipped` diagnostics' `floorId` currently used in the loop (the loop uses `input.floor.floorId` for skipped diagnostics). Pass `input.floor.floorId` in rather than deriving it if that is what the current code does — keep the behavior byte-identical. Verify against the existing loop body before deleting it.

Then rewrite the existing loop to call the helper:

```ts
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const placement = placePopulation({
      run,
      floor: input.floor,
      content: input.content,
      ...(input.environmentTags === undefined ? {} : { environmentTags: input.environmentTags }),
      ...(input.forcedEncounterId === undefined ? {} : { forcedEncounterId: input.forcedEncounterId }),
    });
    const applied = applyPopulationPlacement(run, placement, events, eventId);
    run = applied.run;
    if (applied.stop) break;
  }
```

- [ ] **Step 4: Add the guaranteed-boss pre-pass before the loop**

Immediately after `let run = input.run;` / `const events: DomainEvent[] = [];` and BEFORE the `for (let attempt...` loop in `placeFloorPopulations`, insert:

```ts
  // Guaranteed vault-gated bosses place before the weighted density attempts: any eligible
  // model:boss encounter whose NON-EMPTY required vault tags are all present on the floor is
  // force-placed, so a milestone boss whose arena vault is present always spawns. Empty-tag bosses
  // (e.g. the random ashen-warden) are excluded, preserving their weighted behavior. On a floor with
  // no such vault this runs zero iterations and consumes no randomness (byte-identical).
  const availableTags = availableVaultTags(input.floor, input.content);
  const bossDecisions = new Map(run.encounterDecisions.map((decision) => [decision.encounterId, decision]));
  const guaranteedBosses = maps.encounters.filter((encounter) => {
    if (encounter.model !== 'boss') return false;
    const requiredTags = requiredAnchorTags(encounter);
    if (requiredTags.length === 0) return false;
    const decision = bossDecisions.get(encounter.id);
    return (
      decision?.eligible === true &&
      decision.instancesCreated < encounter.maximumInstancesPerRun &&
      input.floor.depth >= encounter.minDepth &&
      input.floor.depth <= encounter.maxDepth &&
      requiredTags.every((tag) => availableTags.has(tag))
    );
  });
  for (const boss of guaranteedBosses) {
    const placement = placePopulation({
      run,
      floor: input.floor,
      content: input.content,
      ...(input.environmentTags === undefined ? {} : { environmentTags: input.environmentTags }),
      forcedEncounterId: boss.id,
    });
    run = applyPopulationPlacement(run, placement, events, eventId).run;
  }
```

The forced boss is committed with `maximumInstancesPerRun: 1`, so its `instancesCreated` becomes 1 and the subsequent weighted loop's `candidates()` filter excludes it (no double-spawn).

- [ ] **Step 5: Run tests**

Run: `npx vitest run --root packages/engine guaranteed-boss`
Expected: PASS.

Run: `npm run build --workspace @woven-deep/content && npm run build --workspace @woven-deep/engine && npm run test --workspace @woven-deep/engine`
Expected: PASS — no `milestone-boss`-tagged content exists yet, and no existing boss has non-empty required vault tags that appear on a normally-generated floor (`ashen-warden` tags are empty; `heart-boss` is depth-20 special-cased and never reaches `placeFloorPopulations`), so `guaranteedBosses` is empty on every existing floor → byte-identical, all `*-cli.test.ts` guards green.

- [ ] **Step 6: Format and commit**

```bash
npx prettier --write packages/engine/src/population-placement.ts packages/engine/test/guaranteed-boss.test.ts packages/engine/test/helpers/guaranteed-boss-fixture.ts
git add packages/engine/src/population-placement.ts packages/engine/test/guaranteed-boss.test.ts packages/engine/test/helpers/guaranteed-boss-fixture.ts
git commit -m "feat(engine): force-place guaranteed vault-gated bosses before weighted population"
```

---

### Task 3: Ashfather — depth-5 milestone boss (content + end-to-end guarantee)

**Files:**
- Create: `content/monsters/ashfather.yaml`, `content/encounters/ashfather.yaml`, `content/vaults/ashfather-arena.yaml`, `content/loot-tables/ashfather.yaml`
- Create: `content/items/milestone-boss-rewards.yaml` (holds all three rewards; this task adds the first)
- Test: `packages/engine/test/milestone-boss-guarantee.test.ts` (create; covers depth 5 now, extended for 10/15 in Tasks 4-5)

**Interfaces:**
- Consumes: `milestoneBossVaultId` (Task 1), the pre-pass in `placeFloorPopulations` (Task 2), `generateFloor`, `createDemoRun`, `createClassicTheme`.
- Produces: content ids `monster.ashfather`, `encounter.ashfather`, `vault.ashfather-arena`, `loot-table.ashfather`, `item.ashfather-cinder`.

- [ ] **Step 1: Author the arena vault**

Create `content/vaults/ashfather-arena.yaml`:

```yaml
schemaVersion: 7
entries:
  - kind: vault
    id: vault.ashfather-arena
    name: The Ashfather's Pyre
    tags: [milestone-boss, milestone-boss-5]
    minDepth: 5
    maxDepth: 5
    rarity: common
    weight: 1
    maxPerFloor: 1
    margin: 0
    transforms:
      rotations: [0]
      reflectHorizontal: false
    layout:
      - "#########"
      - "#.......#"
      - "+.......#"
      - "#.......#"
      - "#...B...#"
      - "#.......#"
      - "#########"
    legend:
      "#": { terrain: wall }
      ".": { terrain: floor }
      "+": { terrain: floor, entrance: true }
      "B":
        terrain: floor
        slot: { id: boss, kind: monster, required: true, tags: [milestone-boss-5] }
```

- [ ] **Step 2: Author the boss monster**

Create `content/monsters/ashfather.yaml`:

```yaml
schemaVersion: 7
entries:
  - kind: monster
    id: monster.ashfather
    name: The Ashfather
    glyph: "A"
    color: "#ff6a2a"
    description: The first fire that took, and the last to go out. It has burned in this hollow long enough to forget it was ever meant to stop.
    lore: "Every warden below it was kindled from this coal. It does not command them so much as remember them, one flame recalling all the smaller flames it once spat out."
    tags: [boss, fire, guardian]
    minDepth: 5
    maxDepth: 5
    attributes: { might: 13, agility: 7, vitality: 12, wits: 8, resolve: 13 }
    health: 44
    speed: 90
    accuracy: 6
    defense: 13
    perception: 9
    damage: { count: 2, sides: 6, bonus: 3 }
    armor: 4
    resistances: { physical: 10, fire: 80, cold: -30, lightning: 0, poison: 30, arcane: 10 }
    disposition: hostile
    behaviorId: behavior.approach-and-attack
    behaviorParameters: {}
    threat: 13
    rarity: legendary
    lootTableId: loot-table.ashfather
    dropChance: 1
```

- [ ] **Step 3: Author the reward item + loot table**

Create `content/items/milestone-boss-rewards.yaml`:

```yaml
schemaVersion: 7
entries:
  - kind: item
    id: item.ashfather-cinder
    name: The Ashfather's Cinder
    glyph: "*"
    color: "#ff6a2a"
    description: A coal that outlived the fire it came from. It sharpens the eye the way standing near a forge does — everything edged in heat-shimmer.
    lore: "Taken from the pyre while it still remembered being a whole fire. It has not gone cold, and gives every sign it never intends to."
    tags: [boss-reward, fire, offense]
    minDepth: 5
    maxDepth: 20
    category: ring
    stackLimit: 1
    price: 150
    rarity: legendary
    actionCost: 100
    equipment: { slots: [left-ring, right-ring], handedness: none, reservedSlots: [] }
    combat: { accuracy: 1, defense: 0, armor: 0, damage: null, range: 0, ammunitionTag: null }
    light: null
    identification: { mode: known, poolId: null }
    effects: []
```

Create `content/loot-tables/ashfather.yaml`:

```yaml
schemaVersion: 7
entries:
  - kind: loot-table
    id: loot-table.ashfather
    name: Ashfather spoils
    tags: [boss, reward, fire]
    rolls: 1
    choices:
      - { contentId: item.crimson-potion, lootTableId: null, weight: 3, minimumQuantity: 1, maximumQuantity: 2 }
      - { contentId: item.etched-ring, lootTableId: null, weight: 1, minimumQuantity: 1, maximumQuantity: 1 }
```

- [ ] **Step 4: Author the boss encounter**

Create `content/encounters/ashfather.yaml`:

```yaml
schemaVersion: 7
entries:
  - kind: encounter
    id: encounter.ashfather
    name: The Ashfather
    tags: [boss, fire]
    model: boss
    minDepth: 5
    maxDepth: 5
    environmentTags: []
    requiredVaultTags: [milestone-boss-5]
    weight: 1
    rarity: legendary
    runAppearanceChance: 1.0
    discoveryProtectionIncrement: 0
    discoveryProtectionCap: 1
    maximumInstancesPerRun: 1
    placement: { minimumStairDistance: 0, minimumObjectiveDistance: 0, maximumMemberDistance: 0, allowedTerrainTags: [floor], requiresVaultSlot: true, failureMode: optional }
    intentPresentation: { visible: true }
    definition:
      monsterId: monster.ashfather
      phases:
        - { phaseId: emberwake, healthThresholdPercent: 60, behaviorId: behavior.approach-and-attack, behaviorParameters: {}, modifiers: { accuracy: 1, defense: 0, damage: 1 }, effects: [] }
        - { phaseId: immolation, healthThresholdPercent: 30, behaviorId: behavior.approach-and-attack, behaviorParameters: {}, modifiers: { accuracy: 2, defense: -1, damage: 3 }, effects: [] }
      recoveryPerWorldTime: 0
      recoveryCapPercent: 0
      uniqueItemId: item.ashfather-cinder
      enhancedLootTableId: loot-table.ashfather
      vaultTags: [milestone-boss-5]
```

- [ ] **Step 5: Verify the content compiles under STRICT validation**

Run: `npm run test --workspace @woven-deep/content`
Expected: PASS — the existing compile-directory test compiles the full `content/` tree; the new files validate (no stray keys, all ids resolve: `item.crimson-potion`, `item.etched-ring`, `item.ashfather-cinder`, `monster.ashfather`, `loot-table.ashfather` all present).
If a default-content count assertion fails (e.g. `default-content.test.ts` asserting entry counts), update the expected counts to include the new entries.

- [ ] **Step 6: Write the end-to-end guarantee test (depth 5)**

Create `packages/engine/test/milestone-boss-guarantee.test.ts`:

```ts
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack, VaultContentEntry } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createClassicTheme,
  createDemoRun,
  generateFloor,
  milestoneBossVaultId,
  placeFloorPopulations,
} from '../src/index.js';

let content: CompiledContentPack;
let vaults: VaultContentEntry[];

beforeAll(async () => {
  content = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
  vaults = content.entries.filter((entry): entry is VaultContentEntry => entry.kind === 'vault');
});

const ambient = { color: [19, 23, 31] as const, strength: 7 };

function bossDecision(encounterId: string) {
  return {
    encounterId,
    baseProbability: 1,
    protectionBonus: 0,
    effectiveProbability: 1,
    eligible: true,
    reachedEligibleDepth: false,
    encountered: false,
    instancesCreated: 0,
  };
}

function generateAt(depth: number, requiredVaultId: string | undefined) {
  const width = 80;
  const height = 25;
  return generateFloor({
    floorId: `floor.depth-${depth}`,
    floorSeed: [depth, 2, 3, 4],
    depth,
    width,
    height,
    theme: createClassicTheme(width, height, { ambient }),
    vaults,
    ...(requiredVaultId === undefined ? {} : { requiredVaultId }),
  });
}

describe('milestone boss guarantee', () => {
  it('guarantees the Ashfather in its arena at depth 5', () => {
    const requiredVaultId = milestoneBossVaultId(vaults, 5);
    expect(requiredVaultId).toBe('vault.ashfather-arena');
    const generated = generateAt(5, requiredVaultId);
    expect(generated.floor.vaults.map((vault) => vault.vaultId)).toContain('vault.ashfather-arena');
    const base = createDemoRun();
    const run = { ...base, encounterDecisions: [bossDecision('encounter.ashfather')] };
    const result = placeFloorPopulations({ run, floor: generated.floor, content });
    const bosses = result.state.actors.filter((actor) => actor.contentId === 'monster.ashfather');
    expect(bosses).toHaveLength(1);
  });

  it('forces no milestone vault and no boss at a non-milestone depth (6)', () => {
    expect(milestoneBossVaultId(vaults, 6)).toBeUndefined();
    const generated = generateAt(6, undefined);
    expect(generated.floor.vaults.map((vault) => vault.vaultId)).not.toContain('vault.ashfather-arena');
    const base = createDemoRun();
    const run = { ...base, encounterDecisions: [bossDecision('encounter.ashfather')] };
    const result = placeFloorPopulations({ run, floor: generated.floor, content });
    const bosses = result.state.actors.filter((actor) => actor.contentId === 'monster.ashfather');
    expect(bosses).toHaveLength(0);
  });
});
```

Run: `npm run build --workspace @woven-deep/content && npm run build --workspace @woven-deep/engine && npx vitest run --root packages/engine milestone-boss-guarantee`
Expected: PASS (2 tests). If the boss does not place, inspect that the arena's `monster` slot tag `milestone-boss-5` and the encounter's `requiredVaultTags`/`definition.vaultTags` match, and that `createDemoRun()` provides a floor list / rng the placement can use.

- [ ] **Step 7: Regenerate the content-hash-embed demo fixtures + diff-check**

Rebuild, then for EACH of the 7 demos (`dungeon`, `gameplay`, `merchant`, `population`, `run-records`, `endgame`, `magic`) run the script without `--verify`, diff its candidate against the reviewed fixture, and copy only the intended changes. Example for endgame:

```bash
npm run build --workspace @woven-deep/content && npm run build --workspace @woven-deep/engine
node scripts/endgame-demo.mjs           # prints: candidate hashes written <tmp>/endgame-demo-hashes.json
diff packages/engine/test/fixtures/endgame-demo-hashes.json <tmp>/endgame-demo-hashes.json
```

**Diff-check discipline:**
- **`endgame`** organically descends through depth 5, so its `*-save`/`*-records`/`*-events`/`*-record`/`*-standings` hashes for scenarios that reach depth 5 WILL move — this is the intended simulation shift (the Ashfather now spawns and is encountered). Confirm the moved keys are the descent scenarios; copy the candidate over the fixture.
- **All other demos** (`dungeon`/`gameplay`/`merchant`/`population`/`run-records`/`magic`): only the content-hash-embedded fields (save/record/heart hashes) may move because the compiled content hash changed — NOT any projection/events/standings hash for a floor they don't reach. If a projection/events hash moves in a demo that should not reach depth 5, STOP and investigate before copying.

Copy each reviewed candidate over its fixture, then confirm all guards pass:

```bash
npm run test --workspace @woven-deep/engine
```
Expected: PASS (all `*-cli.test.ts` guards green against the regenerated fixtures).

- [ ] **Step 8: Verify cross-process determinism parity**

Run: `npx vitest run --root apps/server determinism-parity`
Expected: PASS — client-core and server produce byte-identical simulation (the real proof determinism held through the guaranteed boss).

- [ ] **Step 9: Full verify, format, commit**

```bash
npm run verify
npx prettier --write content/monsters/ashfather.yaml content/encounters/ashfather.yaml content/vaults/ashfather-arena.yaml content/loot-tables/ashfather.yaml content/items/milestone-boss-rewards.yaml packages/engine/test/milestone-boss-guarantee.test.ts
git add content/ packages/engine/test/milestone-boss-guarantee.test.ts packages/engine/test/fixtures/
git commit -m "feat(content): add the Ashfather, the depth-5 milestone boss"
```

---

### Task 4: Tide-Sovereign — depth-10 milestone boss

**Files:**
- Create: `content/monsters/tide-sovereign.yaml`, `content/encounters/tide-sovereign.yaml`, `content/vaults/tide-sovereign-arena.yaml`, `content/loot-tables/tide-sovereign.yaml`
- Modify: `content/items/milestone-boss-rewards.yaml` (append the second reward)
- Modify: `packages/engine/test/milestone-boss-guarantee.test.ts` (add the depth-10 case)

**Interfaces:**
- Produces: `monster.tide-sovereign`, `encounter.tide-sovereign`, `vault.tide-sovereign-arena`, `loot-table.tide-sovereign`, `item.tide-crown`.

- [ ] **Step 1: Author the arena vault**

Create `content/vaults/tide-sovereign-arena.yaml`:

```yaml
schemaVersion: 7
entries:
  - kind: vault
    id: vault.tide-sovereign-arena
    name: The Drowned Court
    tags: [milestone-boss, milestone-boss-10]
    minDepth: 10
    maxDepth: 10
    rarity: common
    weight: 1
    maxPerFloor: 1
    margin: 0
    transforms:
      rotations: [0]
      reflectHorizontal: false
    layout:
      - "#########"
      - "#.......#"
      - "+.......#"
      - "#.......#"
      - "#...B...#"
      - "#.......#"
      - "#########"
    legend:
      "#": { terrain: wall }
      ".": { terrain: floor }
      "+": { terrain: floor, entrance: true }
      "B":
        terrain: floor
        slot: { id: boss, kind: monster, required: true, tags: [milestone-boss-10] }
```

- [ ] **Step 2: Author the boss monster**

Create `content/monsters/tide-sovereign.yaml`:

```yaml
schemaVersion: 7
entries:
  - kind: monster
    id: monster.tide-sovereign
    name: The Tide-Sovereign
    glyph: "T"
    color: "#3a8fb0"
    description: A drowned thing that kept its crown when it lost its kingdom. The water below answers it the way subjects answer a ruler who no longer rules anything living.
    lore: "It reigned over a hall that flooded and never drained. The court stayed. So did the reign. Neither has anywhere else to be."
    tags: [boss, drowned]
    minDepth: 10
    maxDepth: 10
    attributes: { might: 14, agility: 9, vitality: 15, wits: 9, resolve: 14 }
    health: 62
    speed: 95
    accuracy: 7
    defense: 14
    perception: 10
    damage: { count: 2, sides: 8, bonus: 2 }
    armor: 5
    resistances: { physical: 15, fire: -20, cold: 60, lightning: -30, poison: 40, arcane: 10 }
    disposition: hostile
    behaviorId: behavior.approach-and-attack
    behaviorParameters: {}
    threat: 16
    rarity: legendary
    lootTableId: loot-table.tide-sovereign
    dropChance: 1
```

- [ ] **Step 3: Append the reward + author the loot table**

Append to `content/items/milestone-boss-rewards.yaml` (under `entries:`):

```yaml
  - kind: item
    id: item.tide-crown
    name: The Drowned Crown
    glyph: "*"
    color: "#3a8fb0"
    description: A circlet still cold from the water it was pulled from. Wearing it steadies the hand and turns aside a blow the way a current turns aside a stone.
    lore: "It ruled a court that forgot how to leave. On a living brow it is only cold — but it is the cold of something that has waited a very long time and is good at it."
    tags: [boss-reward, cold, defense]
    minDepth: 10
    maxDepth: 20
    category: ring
    stackLimit: 1
    price: 200
    rarity: legendary
    actionCost: 100
    equipment: { slots: [left-ring, right-ring], handedness: none, reservedSlots: [] }
    combat: { accuracy: 1, defense: 1, armor: 0, damage: null, range: 0, ammunitionTag: null }
    light: null
    identification: { mode: known, poolId: null }
    effects: []
```

Create `content/loot-tables/tide-sovereign.yaml`:

```yaml
schemaVersion: 7
entries:
  - kind: loot-table
    id: loot-table.tide-sovereign
    name: Tide-Sovereign spoils
    tags: [boss, reward, cold]
    rolls: 1
    choices:
      - { contentId: item.crimson-potion, lootTableId: null, weight: 3, minimumQuantity: 1, maximumQuantity: 2 }
      - { contentId: item.etched-ring, lootTableId: null, weight: 1, minimumQuantity: 1, maximumQuantity: 1 }
```

- [ ] **Step 4: Author the boss encounter**

Create `content/encounters/tide-sovereign.yaml`:

```yaml
schemaVersion: 7
entries:
  - kind: encounter
    id: encounter.tide-sovereign
    name: The Tide-Sovereign
    tags: [boss, drowned]
    model: boss
    minDepth: 10
    maxDepth: 10
    environmentTags: []
    requiredVaultTags: [milestone-boss-10]
    weight: 1
    rarity: legendary
    runAppearanceChance: 1.0
    discoveryProtectionIncrement: 0
    discoveryProtectionCap: 1
    maximumInstancesPerRun: 1
    placement: { minimumStairDistance: 0, minimumObjectiveDistance: 0, maximumMemberDistance: 0, allowedTerrainTags: [floor], requiresVaultSlot: true, failureMode: optional }
    intentPresentation: { visible: true }
    definition:
      monsterId: monster.tide-sovereign
      phases:
        - { phaseId: surging, healthThresholdPercent: 60, behaviorId: behavior.approach-and-attack, behaviorParameters: {}, modifiers: { accuracy: 1, defense: 0, damage: 1 }, effects: [] }
        - { phaseId: maelstrom, healthThresholdPercent: 30, behaviorId: behavior.approach-and-attack, behaviorParameters: {}, modifiers: { accuracy: 2, defense: -1, damage: 3 }, effects: [] }
      recoveryPerWorldTime: 0
      recoveryCapPercent: 0
      uniqueItemId: item.tide-crown
      enhancedLootTableId: loot-table.tide-sovereign
      vaultTags: [milestone-boss-10]
```

- [ ] **Step 5: Extend the guarantee test to depth 10**

In `packages/engine/test/milestone-boss-guarantee.test.ts`, add inside the `describe`:

```ts
  it('guarantees the Tide-Sovereign in its arena at depth 10', () => {
    const requiredVaultId = milestoneBossVaultId(vaults, 10);
    expect(requiredVaultId).toBe('vault.tide-sovereign-arena');
    const generated = generateAt(10, requiredVaultId);
    expect(generated.floor.vaults.map((vault) => vault.vaultId)).toContain('vault.tide-sovereign-arena');
    const base = createDemoRun();
    const run = { ...base, encounterDecisions: [bossDecision('encounter.tide-sovereign')] };
    const result = placeFloorPopulations({ run, floor: generated.floor, content });
    const bosses = result.state.actors.filter((actor) => actor.contentId === 'monster.tide-sovereign');
    expect(bosses).toHaveLength(1);
  });
```

Run: `npm run build --workspace @woven-deep/content && npm run build --workspace @woven-deep/engine && npx vitest run --root packages/engine milestone-boss-guarantee && npm run test --workspace @woven-deep/content`
Expected: PASS (content compiles; depth-10 guarantee holds).

- [ ] **Step 6: Regenerate fixtures + diff-check + parity**

Same recipe as Task 3 Step 7-8. `endgame` descends through depth 10 → its depth-10 descent scenarios' hashes move (intended); other demos = content-hash-embed only. Then:

```bash
npm run test --workspace @woven-deep/engine
npx vitest run --root apps/server determinism-parity
```
Expected: PASS.

- [ ] **Step 7: Full verify, format, commit**

```bash
npm run verify
npx prettier --write content/monsters/tide-sovereign.yaml content/encounters/tide-sovereign.yaml content/vaults/tide-sovereign-arena.yaml content/loot-tables/tide-sovereign.yaml content/items/milestone-boss-rewards.yaml packages/engine/test/milestone-boss-guarantee.test.ts
git add content/ packages/engine/test/milestone-boss-guarantee.test.ts packages/engine/test/fixtures/
git commit -m "feat(content): add the Tide-Sovereign, the depth-10 milestone boss"
```

---

### Task 5: Heart-Herald — depth-15 milestone boss

**Files:**
- Create: `content/monsters/heart-herald.yaml`, `content/encounters/heart-herald.yaml`, `content/vaults/heart-herald-arena.yaml`, `content/loot-tables/heart-herald.yaml`
- Modify: `content/items/milestone-boss-rewards.yaml` (append the third reward)
- Modify: `packages/engine/test/milestone-boss-guarantee.test.ts` (add the depth-15 case)

**Interfaces:**
- Produces: `monster.heart-herald`, `encounter.heart-herald`, `vault.heart-herald-arena`, `loot-table.heart-herald`, `item.herald-sigil`.

- [ ] **Step 1: Author the arena vault**

Create `content/vaults/heart-herald-arena.yaml`:

```yaml
schemaVersion: 7
entries:
  - kind: vault
    id: vault.heart-herald-arena
    name: The Herald's Threshold
    tags: [milestone-boss, milestone-boss-15]
    minDepth: 15
    maxDepth: 15
    rarity: common
    weight: 1
    maxPerFloor: 1
    margin: 0
    transforms:
      rotations: [0]
      reflectHorizontal: false
    layout:
      - "#########"
      - "#.......#"
      - "+.......#"
      - "#.......#"
      - "#...B...#"
      - "#.......#"
      - "#########"
    legend:
      "#": { terrain: wall }
      ".": { terrain: floor }
      "+": { terrain: floor, entrance: true }
      "B":
        terrain: floor
        slot: { id: boss, kind: monster, required: true, tags: [milestone-boss-15] }
```

- [ ] **Step 2: Author the boss monster**

Create `content/monsters/heart-herald.yaml`:

```yaml
schemaVersion: 7
entries:
  - kind: monster
    id: monster.heart-herald
    name: The Heart-Herald
    glyph: "H"
    color: "#c9425f"
    description: A shape the Heart wears to speak before it must be met. It carries the deep's corruption ahead of itself, a promise walked up to meet you early.
    lore: "It is not the Heart. It is what the Heart sends when it wants you to understand what waits, while there is still floor enough left to turn back across. There never is."
    tags: [boss, heart, arcane]
    minDepth: 15
    maxDepth: 15
    attributes: { might: 15, agility: 10, vitality: 16, wits: 13, resolve: 15 }
    health: 78
    speed: 100
    accuracy: 8
    defense: 15
    perception: 11
    damage: { count: 2, sides: 8, bonus: 3 }
    armor: 6
    resistances: { physical: 20, fire: 10, cold: 10, lightning: 10, poison: 30, arcane: 60 }
    disposition: hostile
    behaviorId: behavior.approach-and-attack
    behaviorParameters: {}
    threat: 18
    rarity: legendary
    lootTableId: loot-table.heart-herald
    dropChance: 1
```

- [ ] **Step 3: Append the reward + author the loot table**

Append to `content/items/milestone-boss-rewards.yaml`:

```yaml
  - kind: item
    id: item.herald-sigil
    name: The Herald's Sigil
    glyph: "*"
    color: "#c9425f"
    description: A token pressed from the Heart's own corruption, worn as a warning and kept as a ward. It thickens the skin against what the deep throws, at the cost of a faint, constant ache.
    lore: "The Heart marks its heralds so the deep knows them. Pried off and worn, the mark still works — the deep simply mistakes you for something it has already claimed."
    tags: [boss-reward, heart, arcane]
    minDepth: 15
    maxDepth: 20
    category: ring
    stackLimit: 1
    price: 230
    rarity: legendary
    actionCost: 100
    equipment: { slots: [left-ring, right-ring], handedness: none, reservedSlots: [] }
    combat: { accuracy: 1, defense: 0, armor: 1, damage: null, range: 0, ammunitionTag: null }
    light: null
    identification: { mode: known, poolId: null }
    effects: []
```

Create `content/loot-tables/heart-herald.yaml`:

```yaml
schemaVersion: 7
entries:
  - kind: loot-table
    id: loot-table.heart-herald
    name: Heart-Herald spoils
    tags: [boss, reward, heart]
    rolls: 1
    choices:
      - { contentId: item.crimson-potion, lootTableId: null, weight: 3, minimumQuantity: 1, maximumQuantity: 2 }
      - { contentId: item.etched-ring, lootTableId: null, weight: 1, minimumQuantity: 1, maximumQuantity: 1 }
```

- [ ] **Step 4: Author the boss encounter**

Create `content/encounters/heart-herald.yaml`:

```yaml
schemaVersion: 7
entries:
  - kind: encounter
    id: encounter.heart-herald
    name: The Heart-Herald
    tags: [boss, heart, arcane]
    model: boss
    minDepth: 15
    maxDepth: 15
    environmentTags: []
    requiredVaultTags: [milestone-boss-15]
    weight: 1
    rarity: legendary
    runAppearanceChance: 1.0
    discoveryProtectionIncrement: 0
    discoveryProtectionCap: 1
    maximumInstancesPerRun: 1
    placement: { minimumStairDistance: 0, minimumObjectiveDistance: 0, maximumMemberDistance: 0, allowedTerrainTags: [floor], requiresVaultSlot: true, failureMode: optional }
    intentPresentation: { visible: true }
    definition:
      monsterId: monster.heart-herald
      phases:
        - { phaseId: unbinding, healthThresholdPercent: 60, behaviorId: behavior.approach-and-attack, behaviorParameters: {}, modifiers: { accuracy: 1, defense: 0, damage: 1 }, effects: [] }
        - { phaseId: corruption, healthThresholdPercent: 30, behaviorId: behavior.approach-and-attack, behaviorParameters: {}, modifiers: { accuracy: 2, defense: -1, damage: 3 }, effects: [] }
      recoveryPerWorldTime: 0
      recoveryCapPercent: 0
      uniqueItemId: item.herald-sigil
      enhancedLootTableId: loot-table.heart-herald
      vaultTags: [milestone-boss-15]
```

- [ ] **Step 5: Extend the guarantee test to depth 15**

In `packages/engine/test/milestone-boss-guarantee.test.ts`, add:

```ts
  it('guarantees the Heart-Herald in its arena at depth 15', () => {
    const requiredVaultId = milestoneBossVaultId(vaults, 15);
    expect(requiredVaultId).toBe('vault.heart-herald-arena');
    const generated = generateAt(15, requiredVaultId);
    expect(generated.floor.vaults.map((vault) => vault.vaultId)).toContain('vault.heart-herald-arena');
    const base = createDemoRun();
    const run = { ...base, encounterDecisions: [bossDecision('encounter.heart-herald')] };
    const result = placeFloorPopulations({ run, floor: generated.floor, content });
    const bosses = result.state.actors.filter((actor) => actor.contentId === 'monster.heart-herald');
    expect(bosses).toHaveLength(1);
  });
```

Run: `npm run build --workspace @woven-deep/content && npm run build --workspace @woven-deep/engine && npx vitest run --root packages/engine milestone-boss-guarantee && npm run test --workspace @woven-deep/content`
Expected: PASS.

- [ ] **Step 6: Regenerate fixtures + diff-check + parity**

Same recipe. `endgame` descends through depth 15 → depth-15 descent scenarios' hashes move (intended); others = content-hash-embed only. Then:

```bash
npm run test --workspace @woven-deep/engine
npx vitest run --root apps/server determinism-parity
```
Expected: PASS.

- [ ] **Step 7: Full verify, format, commit**

```bash
npm run verify
npx prettier --write content/monsters/heart-herald.yaml content/encounters/heart-herald.yaml content/vaults/heart-herald-arena.yaml content/loot-tables/heart-herald.yaml content/items/milestone-boss-rewards.yaml packages/engine/test/milestone-boss-guarantee.test.ts
git add content/ packages/engine/test/milestone-boss-guarantee.test.ts packages/engine/test/fixtures/
git commit -m "feat(content): add the Heart-Herald, the depth-15 milestone boss"
```

---

### Task 6: Balance + structure guards

**Files:**
- Test: `packages/content/test/milestone-boss-balance.test.ts` (create)

**Interfaces:**
- Consumes: `compileContentDirectory`, `MonsterContentEntry`, `ItemContentEntry`, `EncounterContentEntry` from `@woven-deep/content`.

- [ ] **Step 1: Write the balance + structure test**

Create `packages/content/test/milestone-boss-balance.test.ts`:

```ts
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  EncounterContentEntry,
  ItemContentEntry,
  MonsterContentEntry,
} from '../src/index.js';
import { compileContentDirectory } from '../src/compiler/index.js';

const BOSSES = ['monster.ashfather', 'monster.tide-sovereign', 'monster.heart-herald'] as const;
const REWARDS = ['item.ashfather-cinder', 'item.tide-crown', 'item.herald-sigil'] as const;
const ENCOUNTERS = ['encounter.ashfather', 'encounter.tide-sovereign', 'encounter.heart-herald'] as const;

async function pack() {
  return compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
}

describe('milestone boss balance', () => {
  it('threat ascends 5 -> 10 -> 15 and stays under the depth-20 Heart', async () => {
    const byId = new Map((await pack()).entries.map((entry) => [entry.id, entry]));
    const threats = BOSSES.map((id) => (byId.get(id) as MonsterContentEntry).threat);
    const heart = (byId.get('monster.weakened-heart') as MonsterContentEntry).threat;
    expect(heart).toBe(20);
    for (let i = 1; i < threats.length; i += 1) expect(threats[i]!).toBeGreaterThan(threats[i - 1]!);
    for (const threat of threats) expect(threat).toBeLessThan(heart);
  });

  it('health is monotonic among the three bosses', async () => {
    const byId = new Map((await pack()).entries.map((entry) => [entry.id, entry]));
    const health = BOSSES.map((id) => (byId.get(id) as MonsterContentEntry).health);
    for (let i = 1; i < health.length; i += 1)
      expect(health[i]!).toBeGreaterThan(health[i - 1]!);
  });

  it('rewards stay under the heart-cinder combat budget and are non-decreasing', async () => {
    const byId = new Map((await pack()).entries.map((entry) => [entry.id, entry]));
    const budget = (id: string) => {
      const combat = (byId.get(id) as ItemContentEntry).combat!;
      return combat.accuracy + combat.defense + combat.armor;
    };
    const cinder = budget('item.heart-cinder');
    expect(cinder).toBe(3);
    const budgets = REWARDS.map(budget);
    for (const value of budgets) expect(value).toBeLessThan(cinder);
    for (let i = 1; i < budgets.length; i += 1)
      expect(budgets[i]!).toBeGreaterThanOrEqual(budgets[i - 1]!);
    for (const id of REWARDS) expect((byId.get(id) as ItemContentEntry).price).toBeLessThan(260);
  });

  it('each boss encounter has two descending-threshold phases and resolvable rewards', async () => {
    const entries = (await pack()).entries;
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    for (const id of ENCOUNTERS) {
      const encounter = byId.get(id) as EncounterContentEntry;
      expect(encounter.model).toBe('boss');
      if (encounter.model !== 'boss') continue;
      const { phases, uniqueItemId, enhancedLootTableId } = encounter.definition;
      expect(phases).toHaveLength(2);
      expect(phases[1]!.healthThresholdPercent).toBeLessThan(phases[0]!.healthThresholdPercent);
      expect(byId.get(uniqueItemId)).toBeDefined();
      expect(byId.get(enhancedLootTableId)).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run the balance test**

Run: `npm run test --workspace @woven-deep/content`
Expected: PASS (4 new assertions green — the authored values satisfy them: threats 13<16<18<20, health 44<62<78, budgets 1≤2≤2 all <3, prices 150/200/230 <260, each encounter 2 phases with 60→30 thresholds and resolvable ids).

- [ ] **Step 3: Final whole-feature verification**

Run the full suite plus every demo `--verify` and the parity harness:

```bash
npm run verify
npm run dungeon:demo && npm run gameplay:demo && npm run merchant:demo && npm run population:demo && npm run run-records:demo && npm run endgame:demo && npm run magic:demo && npm run engine:demo
npx vitest run --root apps/server determinism-parity
```
Expected: all PASS — every demo re-derives its reviewed hashes in two processes and matches, proving determinism held end to end.

- [ ] **Step 4: Format and commit**

```bash
npx prettier --write packages/content/test/milestone-boss-balance.test.ts
git add packages/content/test/milestone-boss-balance.test.ts
git commit -m "test(content): guard milestone boss threat ramp, reward ceiling, and phases"
```

---

## Self-Review

**Spec coverage:**
- Guarantee mechanism — change (a) `requiredVaultId` wiring (Task 1) + change (b) guaranteed-boss pre-pass (Task 2). ✓
- Three band-capstone bosses escalating toward the Heart with 2 phases each (Tasks 3-5). ✓
- Arena vaults tagged `milestone-boss` + `milestone-boss-<depth>`, depth-pinned, `monster` slot; boss encounters `runAppearanceChance 1.0` + `requiresVaultSlot true` + required vault tags (Tasks 3-5). ✓
- Difficulty ramp (threat 13<16<18<20; health monotonic among bosses) + reward ceiling under heart-cinder + non-decreasing (Task 6 guards; values authored in Tasks 3-5). ✓
- Rewards: unique `uniqueItemId` drop + `enhancedLootTableId` per boss (Tasks 3-5). ✓
- Caster boundary — all monsters `behavior.approach-and-attack`, arcane via damage/resistances/tags (Heart-Herald). ✓
- Determinism — engine changes no-op off-milestone (Tasks 1-2 verify byte-identical); endgame intended sim shift + parity green, others content-hash-embed only (Tasks 3-5 Step 7-8); final all-demo + parity (Task 6). ✓
- Engine tests — discovery-helper unit test (Task 1), pre-pass test (Task 2), end-to-end guarantee at 5/10/15 + non-milestone no-op (Tasks 3-5). ✓
- Out of scope (Final Chamber, caster AI, champion/echo, 7C) — untouched. ✓

**Placeholder scan:** No TBD/TODO; every content file and test is complete code; the one "implementer note" in Task 2 (fixture-assembly latitude) names a concrete fallback (reuse Task 3's `generateFloor`-with-required-vault approach), not a gap.

**Type consistency:** `milestoneBossVaultId(vaults, depth): string | undefined` defined in Task 1, consumed identically in Tasks 3-5. `applyPopulationPlacement(run, placement, events, eventId)` defined and used in Task 2. Content ids are consistent across monster/encounter/vault/loot/reward/tests (`monster.ashfather` ↔ `encounter.ashfather.definition.monsterId`, `item.ashfather-cinder` ↔ `uniqueItemId`, `milestone-boss-5` tag on vault ↔ slot ↔ encounter `requiredVaultTags`/`vaultTags`). Reward `combat` budget fields (`accuracy`/`defense`/`armor`) match the `item.heart-cinder` shape read by Task 6.
