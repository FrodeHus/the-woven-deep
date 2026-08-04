# Champion Casting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make champions and echoes cast the signature spells their standing already records, paying weave, so a caster's haunt is a ranged threat instead of a mute spell list.

**Architecture:** Three seams. `champion.ts` gives a placed haunt a real weave pool derived from its standing's attributes (today it hardcodes `maxWeave: 0`). `behavior.ts` gains `championCastAction`, a pure decision returning the existing `CastAction` — no new action type, and `ACTION_DISPATCH.cast` already resolves it for any actor. `event-projection.ts` stops pushing `spell.cast` unconditionally: named when the caster is visible, otherwise routed through the existing `sound()` helper as `sound.heard`.

**Tech Stack:** TypeScript 5.8 ESM, Vitest 3.2, npm workspaces. All work is in `packages/engine`.

**Spec:** `docs/superpowers/specs/2026-08-04-champion-casting-design.md`

## Global Constraints

- **No save-schema bump.** Every shape used already exists and is already validated. If a change appears to need a new persisted field or event variant, stop and re-read the spec — that means the approach drifted.
- **The engine is browser-safe by enforced test** (`test/browser-boundary.test.ts`): no Node APIs, no clocks, no `Math.random`, no storage in `packages/engine/src`.
- **The decision consumes no randomness.** `championCastAction` must be a pure function of state and content. Only the spell's own effects draw, and they draw from the `effects` stream through the existing resolver.
- **Checked integer arithmetic:** explicit safe-integer guards, quotient/remainder division, no floats.
- **Comparator:** ranking spells uses highest `weaveCost` first with `compareCodeUnits(spellId)` as tie-break — the same ordering `run-finalize.ts`'s `signatureAbilityIds` and `champion.ts`'s narrowing use.
- **Supported targeting kinds:** `target.actor` and `target.self` only. `target.line`, `target.burst`, `target.cone`, and `target.cell` are ignored by the caster.
- **Build gotcha:** demo scripts and CLI tests import the compiled `packages/engine/dist`. Before running any `*-demo` / `*-cli` suite: `npm run build --workspace @woven-deep/content && npm run build --workspace @woven-deep/engine`.
- **Run engine tests directly** — `npx vitest run test/<file>` from `packages/engine`. The workspace `npm test` script runs the whole suite twice (once more for CLI) and takes minutes.
- **Conventional commits, lowercase, no scope:** `feat:`, `fix:`, `test:`, `docs:`, `chore:`.
- **Branch:** `feat/champion-casting`, already created from `main` and carrying the design commit.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `packages/engine/src/champion.ts` | Normalizes a standing into a placed haunt and its actor | Modify: derive `maxWeave`/`weave` at actor construction (currently `0`) |
| `packages/engine/src/champion-casting.ts` | The cast decision: which spell, at whom, is it worth it | **Create** — keeps `behavior.ts` from growing a second large concern |
| `packages/engine/src/behavior.ts` | Chooses a non-player actor's action each turn | Modify: call `championCastAction` after the adjacent-bump branch |
| `packages/engine/src/event-projection.ts` | Projects `DomainEvent`s into hero-visible `PublicEvent`s | Modify: perception-gate `spell.cast` |
| `packages/engine/test/champion-casting.test.ts` | Decision unit tests | **Create** |
| `packages/engine/test/champion.test.ts` | Existing champion/echo suite | Modify: weave-pool cases |
| `packages/engine/test/event-projection.test.ts` | Existing projection suite | Modify: seen/unseen cast cases |

`champion-casting.ts` is a new file rather than more lines in `behavior.ts` because the decision needs spell lookup, affordability, targeting validation, and the self-cast usefulness gate — a distinct responsibility from pathing and target selection, and `behavior.ts` is already 230 lines of dense branching.

---

### Task 1: A placed haunt gets a real weave pool

**Files:**
- Modify: `packages/engine/src/champion.ts:497-500` (the actor literal's `weave`/`maxWeave`)
- Test: `packages/engine/test/champion.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: placed champion/echo actors whose `maxWeave` is `deriveActorStats(...).maxWeave` clamped to `>= 0`, with `weave === maxWeave`. Task 2's affordability check reads `actor.weave`.

**Context an implementer needs:** `champion.ts` builds the actor literal inside `placeFallenHeroEncounters`. `normalized.attributes` is already clamped to the template's `attributeMaximum`. Use `deriveActorStats` from `./attributes.js` (NOT `deriveRunActorStats` from `./stats.js`) — the latter needs the actor to already be in `state.actors` to look up equipment modifiers, and this actor does not exist yet. A freshly placed haunt has no equipped item instances (`equipment: emptyEquipment()`) and no conditions (`conditions: []`), so both modifier arrays are empty and the derivation is exactly the formula applied to the standing's attributes.

- [ ] **Step 1: Write the failing test**

Add to `packages/engine/test/champion.test.ts`, at the end of the file:

```ts
describe('a placed haunt carries a weave pool', () => {
  it('derives the champion pool from its standing attributes and starts it full', () => {
    const run = withArena(initialized([standing(1)]), 4);
    const placed = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: pack() });
    const population = placed.populations.find((candidate) => candidate.model === 'champion')!;
    const actor = placed.actors.find((candidate) => candidate.actorId === population.actorId)!;
    // The demo pack's formula is `maxWeave: { base: 4, wits: 1 }` and `standing()` records
    // wits 10, so the pool is 14 -- derived, never the placeholder zero it used to be.
    const balance = balanceEntry(pack());
    const expected = deriveActorStats({
      attributes: actor.attributes,
      formulas: balance.formulas,
      weaveRegenAmount: balance.weaveRegenAmount,
      equipmentModifiers: [],
      conditionModifiers: [],
    }).maxWeave;
    expect(expected).toBeGreaterThan(0);
    expect(actor.maxWeave).toBe(expected);
    expect(actor.weave).toBe(expected);
  });

  it('gives an echo the same derivation as a champion', () => {
    const standings = [standing(1), standing(2)];
    const selected = initialized(standings);
    const forced = {
      ...selected,
      fallenHeroDecisions: selected.fallenHeroDecisions.map((decision) =>
        decision.rank === 2 ? { ...decision, retained: true, gateRoll: 1 } : decision,
      ),
    };
    const run = withArena(forced, 4);
    const placed = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: pack() });
    const echo = placed.populations.find((candidate) => candidate.model === 'echo')!;
    const actor = placed.actors.find((candidate) => candidate.actorId === echo.actorId)!;
    // The echo's combat boundaries are weakened; its Weave is not -- nothing in the template
    // describes an echo weave percentage, and inventing one is out of scope.
    expect(actor.maxWeave).toBeGreaterThan(0);
    expect(actor.weave).toBe(actor.maxWeave);
  });

  it('places a haunt with no attributes-driven pool without throwing', () => {
    // A standing whose attributes are all zero derives `base` only. Pinned so the clamp below
    // zero is never needed and a zero pool stays a legal, non-casting haunt.
    const zeroed = standing(1, {
      attributes: { might: 0, agility: 0, vitality: 0, wits: 0, resolve: 0 },
    });
    const run = withArena(initialized([zeroed]), 4);
    const placed = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: pack() });
    const population = placed.populations.find((candidate) => candidate.model === 'champion')!;
    const actor = placed.actors.find((candidate) => candidate.actorId === population.actorId)!;
    expect(actor.maxWeave).toBeGreaterThanOrEqual(0);
    expect(actor.weave).toBe(actor.maxWeave);
  });
});
```

Add `balanceEntry` and `deriveActorStats` to the existing `../src/index.js` import block at the top of the file. If either is not exported from `packages/engine/src/index.ts`, add the export there in Step 3 — `deriveActorStats` is already used across the engine, so check before adding.

- [ ] **Step 2: Run the test and verify it fails**

```bash
cd packages/engine && npx vitest run test/champion.test.ts -t "weave pool"
```

Expected: FAIL — `expected 0 to be 14` on the first case (the actor literal still hardcodes `maxWeave: 0`).

- [ ] **Step 3: Implement**

In `packages/engine/src/champion.ts`, add to the imports:

```ts
import { deriveActorStats } from './attributes.js';
import { balanceEntry } from './balance.js';
```

Inside `placeFallenHeroEncounters`, immediately before the `const actor: ActorState = {` literal:

```ts
    // A haunt's Weave is derived from the attributes its standing recorded, exactly as the
    // hero's own maximum is -- a placed champion used to carry a hardcoded 0 because nothing
    // could cast. `deriveActorStats` rather than `deriveRunActorStats`: this actor is not in
    // `state.actors` yet, so an equipment lookup would find nothing to look up. A fresh haunt
    // has no equipped instances and no conditions, so both modifier lists are genuinely empty
    // rather than merely convenient. The pool starts full and never refills: Weave regen is
    // hero-only (`survival.ts`), which is what makes a caster haunt a burst that fades.
    const balance = balanceEntry(input.content);
    const maxWeave = Math.max(
      0,
      deriveActorStats({
        attributes: normalized.attributes,
        formulas: balance.formulas,
        weaveRegenAmount: balance.weaveRegenAmount,
        equipmentModifiers: [],
        conditionModifiers: [],
      }).maxWeave,
    );
```

Then change the two lines in the actor literal:

```ts
      weave: maxWeave,
      maxWeave,
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
cd packages/engine && npx vitest run test/champion.test.ts
```

Expected: PASS, all cases in the file.

- [ ] **Step 5: Verify nothing else moved**

```bash
cd packages/engine && npx vitest run
```

Expected: PASS. If a save-codec or content-bound-validation test fails, stop: it means a placed actor's weave is compared somewhere the spec did not account for, and the plan needs revisiting before proceeding.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/champion.ts packages/engine/test/champion.test.ts
git commit -m "feat: give a placed haunt the weave pool its standing implies"
```

---

### Task 2: The cast decision

**Files:**
- Create: `packages/engine/src/champion-casting.ts`
- Modify: `packages/engine/src/index.ts` (export `championCastAction`)
- Test: `packages/engine/test/champion-casting.test.ts` (create)

**Interfaces:**
- Consumes: Task 1's real `actor.weave` / `actor.maxWeave`.
- Produces:
  ```ts
  export function championCastAction(
    input: Readonly<{ state: ActiveRun; actorId: OpaqueId; content: CompiledContentPack }>,
  ): CastAction | null;
  ```
  Task 3 relies on the `spell.cast` events this eventually produces; Task 4 wires it into `behavior.ts`.

**Context an implementer needs:**

- `CastAction` already exists in `packages/engine/src/action-types.ts`: `{ type: 'cast', actorId, spellId, targetActorId, weaveCost, cost, aimTarget? }`. Do not add an action type.
- Only `ChampionPopulation` and `EchoPopulation` carry `abilityIds`. Find the population by `candidate.actorId === actorId` and narrow on `model === 'champion' || model === 'echo'`.
- `validateTarget` (`./targeting.js`) plus `targetContext` (`./target-context.js`) is how the hero's own range/LOS/illumination rules are enforced. Use them so the champion is bound by the same rules; do not hand-roll a distance check for legality (distance is only used for the never-adjacent rule).
- A condition already carried is checked with `actor.conditions.some((condition) => condition.conditionId === id)` — the idiom `effects.ts` uses.
- `effect.parameters.conditionId` holds the applied condition's id on an `effect.condition.apply` effect.
- `actionCostFor(rules, ...)` is for named action costs; a spell carries its own `actionCost`, so use `spell.actionCost` directly, as the hero's cast does.

- [ ] **Step 1: Write the failing tests**

Create `packages/engine/test/champion-casting.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { CompiledContentPack, SpellContentEntry } from '@woven-deep/content';
import {
  championCastAction,
  createDemoContentPack,
  createDemoRun,
  type ActiveRun,
  type ActorState,
} from '../src/index.js';

const CHAMPION_ACTOR_ID = 'actor.population.fallen-champion.001';
const POPULATION_ID = 'population.fallen-champion.hall.hero-1';

/** A single-target attack spell: range 5, cost 4. */
const emberBolt: SpellContentEntry = {
  kind: 'spell',
  id: 'spell.ember',
  name: 'Ember',
  description: '',
  tags: [],
  targetingId: 'target.actor',
  range: 5,
  actionCost: 100,
  weaveCost: 4,
  effects: [{ effectId: 'effect.damage', parameters: { dice: { count: 1, sides: 4, bonus: 0 } } }],
};

/** Costlier than Ember and sorts LATER by id, so cost-ranking and alphabetical order disagree. */
const galeLance: SpellContentEntry = {
  ...emberBolt,
  id: 'spell.gale',
  name: 'Gale',
  weaveCost: 6,
};

/** Out of the champion's reach at the distance every case below uses. */
const shortSpark: SpellContentEntry = {
  ...emberBolt,
  id: 'spell.spark',
  name: 'Spark',
  range: 1,
  weaveCost: 1,
};

/** An unsupported targeting kind: recorded, but never cast by this version. */
const aimedBlast: SpellContentEntry = {
  ...emberBolt,
  id: 'spell.blast',
  name: 'Blast',
  targetingId: 'target.burst',
  aoe: { radius: 2 },
  weaveCost: 2,
};

const selfMend: SpellContentEntry = {
  ...emberBolt,
  id: 'spell.mend',
  name: 'Mend',
  targetingId: 'target.self',
  range: 0,
  weaveCost: 2,
  effects: [{ effectId: 'effect.heal', parameters: { dice: { count: 1, sides: 4, bonus: 0 } } }],
};

const selfWard: SpellContentEntry = {
  ...emberBolt,
  id: 'spell.ward',
  name: 'Ward',
  targetingId: 'target.self',
  range: 0,
  weaveCost: 2,
  effects: [
    {
      effectId: 'effect.condition.apply',
      parameters: { conditionId: 'condition.warded', duration: 10, stacks: 1 },
    },
  ],
};

function packWith(...spells: readonly SpellContentEntry[]): CompiledContentPack {
  const base = createDemoContentPack();
  return {
    ...base,
    entries: [
      ...base.entries,
      ...spells,
      {
        kind: 'condition' as const,
        id: 'condition.warded',
        name: 'Warded',
        description: '',
        tags: [],
        color: '#88aaff',
        stacking: 'refresh' as const,
        maximumStacks: 1,
        modifiers: { defense: 2 },
        periodicEffects: [],
      },
    ],
  };
}

/**
 * A run whose champion stands `distance` cells due east of the hero, aware and hostile, with a
 * population carrying `abilityIds`. Everything the decision reads lives here: the population, the
 * actor's Weave, and the awareness list.
 */
function runWithChampion(
  input: Readonly<{
    abilityIds: readonly string[];
    distance: number;
    weave?: number;
    health?: number;
    conditions?: ActorState['conditions'];
  }>,
): ActiveRun {
  const base = createDemoRun();
  const hero = base.actors[0]!;
  const champion: ActorState = {
    ...hero,
    actorId: CHAMPION_ACTOR_ID,
    contentId: hero.contentId,
    playerControlled: false,
    disposition: 'hostile',
    behaviorId: 'behavior.approach-and-attack',
    awareActorIds: [hero.actorId],
    populationId: POPULATION_ID,
    x: hero.x + input.distance,
    y: hero.y,
    health: input.health ?? 20,
    maxHealth: 20,
    weave: input.weave ?? 20,
    maxWeave: 20,
    conditions: input.conditions ?? [],
  };
  return {
    ...base,
    actors: [hero, champion],
    populations: [
      {
        model: 'champion' as const,
        populationId: POPULATION_ID,
        encounterId: 'encounter.fallen-champion',
        floorId: hero.floorId,
        createdAt: 0,
        livingMemberIds: [CHAMPION_ACTOR_ID],
        formerMemberIds: [],
        actorId: CHAMPION_ACTOR_ID,
        hallRecordId: 'hall.hero-1',
        rank: 1 as const,
        defeated: false,
        rewardCreated: false,
        equipmentContentIds: [],
        abilityIds: input.abilityIds,
      },
    ],
  } as ActiveRun;
}

describe('championCastAction', () => {
  it('casts at a target in range', () => {
    const state = runWithChampion({ abilityIds: ['spell.ember'], distance: 3 });
    const action = championCastAction({
      state,
      actorId: CHAMPION_ACTOR_ID,
      content: packWith(emberBolt),
    });
    expect(action).toMatchObject({
      type: 'cast',
      actorId: CHAMPION_ACTOR_ID,
      spellId: 'spell.ember',
      targetActorId: state.actors[0]!.actorId,
      weaveCost: 4,
      cost: 100,
    });
  });

  it('never casts at an adjacent target, leaving the melee branch to act', () => {
    const state = runWithChampion({ abilityIds: ['spell.ember'], distance: 1 });
    expect(
      championCastAction({ state, actorId: CHAMPION_ACTOR_ID, content: packWith(emberBolt) }),
    ).toBeNull();
  });

  it('picks the costliest affordable spell, not the alphabetically first', () => {
    const state = runWithChampion({ abilityIds: ['spell.ember', 'spell.gale'], distance: 3 });
    const action = championCastAction({
      state,
      actorId: CHAMPION_ACTOR_ID,
      content: packWith(emberBolt, galeLance),
    });
    expect(action?.spellId).toBe('spell.gale');
  });

  it('falls back to a cheaper spell when the costliest is unaffordable', () => {
    const state = runWithChampion({
      abilityIds: ['spell.ember', 'spell.gale'],
      distance: 3,
      weave: 5,
    });
    const action = championCastAction({
      state,
      actorId: CHAMPION_ACTOR_ID,
      content: packWith(emberBolt, galeLance),
    });
    expect(action?.spellId).toBe('spell.ember');
  });

  it('returns null when nothing is affordable', () => {
    const state = runWithChampion({ abilityIds: ['spell.ember'], distance: 3, weave: 0 });
    expect(
      championCastAction({ state, actorId: CHAMPION_ACTOR_ID, content: packWith(emberBolt) }),
    ).toBeNull();
  });

  it('skips a spell whose range cannot reach the target', () => {
    const state = runWithChampion({ abilityIds: ['spell.spark'], distance: 3 });
    expect(
      championCastAction({ state, actorId: CHAMPION_ACTOR_ID, content: packWith(shortSpark) }),
    ).toBeNull();
  });

  it('ignores an unsupported targeting kind', () => {
    const state = runWithChampion({ abilityIds: ['spell.blast'], distance: 3 });
    expect(
      championCastAction({ state, actorId: CHAMPION_ACTOR_ID, content: packWith(aimedBlast) }),
    ).toBeNull();
  });

  it('ignores an ability the pack no longer defines', () => {
    const state = runWithChampion({ abilityIds: ['spell.deleted'], distance: 3 });
    expect(
      championCastAction({ state, actorId: CHAMPION_ACTOR_ID, content: packWith(emberBolt) }),
    ).toBeNull();
  });

  it('returns null for an actor whose population carries no abilities', () => {
    const state = runWithChampion({ abilityIds: [], distance: 3 });
    expect(
      championCastAction({ state, actorId: CHAMPION_ACTOR_ID, content: packWith(emberBolt) }),
    ).toBeNull();
  });

  it('heals itself when wounded', () => {
    const state = runWithChampion({ abilityIds: ['spell.mend'], distance: 3, health: 5 });
    const action = championCastAction({
      state,
      actorId: CHAMPION_ACTOR_ID,
      content: packWith(selfMend),
    });
    expect(action).toMatchObject({ spellId: 'spell.mend', targetActorId: CHAMPION_ACTOR_ID });
  });

  it('does not heal itself at full health', () => {
    const state = runWithChampion({ abilityIds: ['spell.mend'], distance: 3, health: 20 });
    expect(
      championCastAction({ state, actorId: CHAMPION_ACTOR_ID, content: packWith(selfMend) }),
    ).toBeNull();
  });

  it('wards itself when the condition is absent', () => {
    const state = runWithChampion({ abilityIds: ['spell.ward'], distance: 3 });
    const action = championCastAction({
      state,
      actorId: CHAMPION_ACTOR_ID,
      content: packWith(selfWard),
    });
    expect(action?.spellId).toBe('spell.ward');
  });

  it('does not re-ward itself while already warded', () => {
    const state = runWithChampion({
      abilityIds: ['spell.ward'],
      distance: 3,
      conditions: [
        {
          conditionId: 'condition.warded',
          sourceActorId: CHAMPION_ACTOR_ID,
          appliedAt: 0,
          expiresAt: null,
          stacks: 1,
        },
      ],
    });
    expect(
      championCastAction({ state, actorId: CHAMPION_ACTOR_ID, content: packWith(selfWard) }),
    ).toBeNull();
  });

  it('prefers an attack spell over a useful self spell', () => {
    const state = runWithChampion({
      abilityIds: ['spell.ember', 'spell.mend'],
      distance: 3,
      health: 5,
    });
    const action = championCastAction({
      state,
      actorId: CHAMPION_ACTOR_ID,
      content: packWith(emberBolt, selfMend),
    });
    expect(action?.spellId).toBe('spell.ember');
  });

  it('will not cast at a target it cannot perceive', () => {
    // Legality comes from `validateTarget` against the CASTER's perception, so an unlit target
    // is no more castable for a haunt than for the hero. Killing the floor's ambient light is
    // the same lever `event-projection.test.ts`'s own hidden-actor fixture pulls.
    const lit = runWithChampion({ abilityIds: ['spell.ember'], distance: 3 });
    const dark: ActiveRun = {
      ...lit,
      floors: [{ ...lit.floors[0]!, ambient: { color: [0, 0, 0], strength: 0 } }],
    };
    expect(
      championCastAction({ state: dark, actorId: CHAMPION_ACTOR_ID, content: packWith(emberBolt) }),
    ).toBeNull();
  });

  it('consumes no randomness', () => {
    const state = runWithChampion({ abilityIds: ['spell.ember'], distance: 3 });
    const content = packWith(emberBolt);
    championCastAction({ state, actorId: CHAMPION_ACTOR_ID, content });
    expect(state.rng).toEqual(createDemoRun().rng);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

```bash
cd packages/engine && npx vitest run test/champion-casting.test.ts
```

Expected: FAIL at import — `championCastAction` is not exported.

- [ ] **Step 3: Implement**

Create `packages/engine/src/champion-casting.ts`:

```ts
import type { CompiledContentPack, SpellContentEntry } from '@woven-deep/content';
import type { CastAction } from './action-types.js';
import { type ActorState } from './actor-model.js';
import { entryById } from './content-index.js';
import type { ActiveRun, OpaqueId } from './model.js';
import { relationshipBetween } from './reactions.js';
import { compareCodeUnits } from './stable-json.js';
import { targetContext } from './target-context.js';
import { validateTarget } from './targeting.js';

/** The targeting kinds a haunt casts. The aimed and area kinds need an aim-point heuristic and
 * friendly-fire rules that this version deliberately does not have (see the design's non-goals),
 * so a recorded ability of any other kind is simply passed over. */
const SUPPORTED_TARGETING = new Set(['target.actor', 'target.self']);

function chebyshev(
  left: Readonly<{ x: number; y: number }>,
  right: Readonly<{ x: number; y: number }>,
): number {
  return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));
}

/**
 * Would this self-targeted spell do anything? A haunt has one Weave pool and no way to earn it
 * back, so casting a heal at full health or re-applying a condition it already carries would
 * burn the pool for nothing and read as broken. Heals count as useful below maximum health;
 * a condition applier counts as useful while the caster lacks that condition. Anything else --
 * a self spell this rule cannot reason about -- is passed over rather than guessed at.
 */
function selfCastIsUseful(actor: ActorState, spell: SpellContentEntry): boolean {
  return spell.effects.some((effect) => {
    if (effect.effectId === 'effect.heal') return actor.health < actor.maxHealth;
    if (effect.effectId === 'effect.condition.apply') {
      const conditionId = effect.parameters.conditionId;
      return (
        typeof conditionId === 'string' &&
        !actor.conditions.some((condition) => condition.conditionId === conditionId)
      );
    }
    return false;
  });
}

/**
 * The spell a placed haunt casts this turn, or `null` to fall through to its ordinary behavior.
 *
 * Champions and Echoes are the only populations carrying `abilityIds` (the signature spells their
 * standing recorded), and this is the consumer that data was waiting for. The rules:
 *
 * - Never adjacent. Melee range belongs to the bump-attack branch, which keeps "close the
 *   distance" a real counter-play against a caster haunt.
 * - Legality comes from `validateTarget`, the hero's own targeting call, so range, line of sight,
 *   and illumination bind a haunt exactly as they bind the player.
 * - Attack spells outrank self spells; within each group the costliest goes first, ranked by the
 *   same comparator `run-finalize.ts` used to choose these spells in the first place, so "the
 *   champion's signature spells" means one thing everywhere.
 * - Affordability is the only pacing: Weave regen is hero-only, so a haunt's pool is a one-way
 *   per-encounter budget.
 *
 * Consumes no randomness: every input is state or content, and the spell's own effects do all the
 * drawing later, from the `effects` stream, through the shared cast resolver.
 */
export function championCastAction(
  input: Readonly<{ state: ActiveRun; actorId: OpaqueId; content: CompiledContentPack }>,
): CastAction | null {
  const actor = input.state.actors.find((candidate) => candidate.actorId === input.actorId);
  if (!actor || actor.health <= 0) return null;
  const population = input.state.populations.find(
    (candidate) => candidate.populationId === actor.populationId,
  );
  if (population?.model !== 'champion' && population?.model !== 'echo') return null;
  if (population.abilityIds.length === 0) return null;

  const target = input.state.actors
    .filter(
      (candidate) =>
        candidate.actorId !== actor.actorId &&
        candidate.health > 0 &&
        candidate.floorId === actor.floorId &&
        actor.awareActorIds.includes(candidate.actorId) &&
        relationshipBetween(input.state, actor.actorId, candidate.actorId) === 'hostile',
    )
    .sort(
      (left, right) =>
        chebyshev(actor, left) - chebyshev(actor, right) ||
        compareCodeUnits(left.actorId, right.actorId),
    )[0];
  if (!target || chebyshev(actor, target) <= 1) return null;

  const spells = population.abilityIds
    .flatMap((spellId) => {
      const entry = entryById(input.content, spellId);
      return entry?.kind === 'spell' && SUPPORTED_TARGETING.has(entry.targetingId) ? [entry] : [];
    })
    .filter((spell) => spell.weaveCost <= actor.weave)
    .sort(
      (left, right) => right.weaveCost - left.weaveCost || compareCodeUnits(left.id, right.id),
    );

  const perception = targetContext(input.state, actor, input.content);
  for (const group of ['target.actor', 'target.self'] as const) {
    for (const spell of spells) {
      if (spell.targetingId !== group) continue;
      if (group === 'target.self' && !selfCastIsUseful(actor, spell)) continue;
      const targetActorId = group === 'target.self' ? actor.actorId : target.actorId;
      const validation = validateTarget({
        targetingId: spell.targetingId,
        sourceActor: actor,
        targetActorId,
        target: null,
        floor: perception.floor,
        actors: input.state.actors,
        visibilityWords: perception.visibilityWords,
        illumination: perception.illumination,
        range: spell.range,
      });
      if (!validation.ok) continue;
      return {
        type: 'cast',
        actorId: actor.actorId,
        spellId: spell.id,
        targetActorId,
        weaveCost: spell.weaveCost,
        cost: spell.actionCost,
      };
    }
  }
  return null;
}
```

Export it from `packages/engine/src/index.ts` beside the other behavior exports:

```ts
export { championCastAction } from './champion-casting.js';
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
cd packages/engine && npx vitest run test/champion-casting.test.ts
```

Expected: PASS, all 16 cases. If `validateTarget`'s `aoe` parameter is required by its input type, pass `aoe: undefined` explicitly rather than widening the call.

If the unlit case fails (a cast is still returned), the hero's own light source is reaching the target cell — the demo run equips a lit lantern. Extinguish it in the fixture (`enabled: false` on the hero's light item) rather than moving the champion, so the case keeps testing perception and not distance.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck --workspace @woven-deep/engine
```

Expected: no output beyond the tsc banner.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/champion-casting.ts packages/engine/src/index.ts packages/engine/test/champion-casting.test.ts
git commit -m "feat: decide when a haunt casts one of its signature spells"
```

---

### Task 3: Wire the decision into the behavior loop

**Files:**
- Modify: `packages/engine/src/behavior.ts:163-172` (between the bump-attack branch and the swarm-spawn check)
- Test: `packages/engine/test/champion-casting.test.ts`

**Interfaces:**
- Consumes: `championCastAction` from Task 2.
- Produces: `chooseBehaviorAction` returning a `CastAction` for a haunt with a legal cast. `world-step`'s `applyAction` already routes it to `ACTION_DISPATCH.cast`; nothing else needs wiring.

**Context an implementer needs:** `chooseBehaviorAction` returns `GameAction`. The bump-attack branch fires at `distance(actor, target) === 1`; the cast check goes immediately after it (so adjacency always wins) and before `swarmSpawnAction`. `championCastAction` re-derives its own target rather than reusing the local `target` — that is deliberate duplication of a cheap, pure selection, and it keeps the decision independently testable.

- [ ] **Step 1: Write the failing test**

Append to `packages/engine/test/champion-casting.test.ts`:

```ts
describe('chooseBehaviorAction routes a haunt cast', () => {
  it('returns the cast for a haunt with a legal spell at range', () => {
    const state = runWithChampion({ abilityIds: ['spell.ember'], distance: 3 });
    const action = chooseBehaviorAction({
      state,
      actorId: CHAMPION_ACTOR_ID,
      content: packWith(emberBolt),
    });
    expect(action).toMatchObject({ type: 'cast', spellId: 'spell.ember' });
  });

  it('still bumps when adjacent', () => {
    const state = runWithChampion({ abilityIds: ['spell.ember'], distance: 1 });
    const action = chooseBehaviorAction({
      state,
      actorId: CHAMPION_ACTOR_ID,
      content: packWith(emberBolt),
    });
    expect(action.type).toBe('bump-attack');
  });

  it('walks toward the hero when it cannot pay', () => {
    const state = runWithChampion({ abilityIds: ['spell.ember'], distance: 3, weave: 0 });
    const action = chooseBehaviorAction({
      state,
      actorId: CHAMPION_ACTOR_ID,
      content: packWith(emberBolt),
    });
    expect(action.type).toBe('move');
  });
});
```

Add `chooseBehaviorAction` to the `../src/index.js` import at the top of the file.

- [ ] **Step 2: Run the test and verify it fails**

```bash
cd packages/engine && npx vitest run test/champion-casting.test.ts -t "routes a haunt cast"
```

Expected: FAIL — the first case returns `move`, not `cast`.

- [ ] **Step 3: Implement**

In `packages/engine/src/behavior.ts`, add the import:

```ts
import { championCastAction } from './champion-casting.js';
```

Then, immediately after the `if (target && distance(actor, target) === 1) { ... }` bump-attack block and before `const spawn = swarmSpawnAction(input);`:

```ts
  // A haunt that recorded spells casts them at range. Placed AFTER the adjacency branch on
  // purpose: closing the distance is the player's counter-play against a caster, so melee range
  // always means melee. Returns null for every actor that is not a Champion or Echo with an
  // affordable, legal spell, which is every other monster in the game.
  const cast = championCastAction({
    state: input.state,
    actorId: actor.actorId,
    content: input.content,
  });
  if (cast) return cast;
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
cd packages/engine && npx vitest run test/champion-casting.test.ts test/behavior.test.ts
```

Expected: PASS in both files.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/behavior.ts packages/engine/test/champion-casting.test.ts
git commit -m "feat: let a haunt cast instead of closing the distance"
```

---

### Task 4: Stop `spell.cast` leaking an unseen caster

**Files:**
- Modify: `packages/engine/src/event-projection.ts:313-319` (the unconditional `spell.cast` branch)
- Test: `packages/engine/test/event-projection.test.ts`

**Interfaces:**
- Consumes: nothing structural — this task is about what the client is told.
- Produces: `spell.cast` projected only when `actorVisible(event.actorId)`; otherwise a `sound.heard` with `category: 'combat'`, or nothing when the `sound()` helper's own 12-tile cutoff drops it.

**Context an implementer needs:** `spell.cast` is currently grouped with hero-only events (`spell.learned`, `hero.tempering-banked`, `hero.tempered`, `hero.recalled`) in a branch that pushes unconditionally. That was correct while only the hero cast. `actorVisible` returns `true` for the hero always, so the hero's own casts are unaffected by the gate. `sound(event, state, hero)` returns `undefined` when the source is more than 12 tiles away or has no resolvable position — push only when it returns a value.

- [ ] **Step 1: Write the failing test**

Add to `packages/engine/test/event-projection.test.ts`. The file already has exactly the fixture this needs: `fixture()` (near the top) builds a run whose floor has `ambient: { color: [0,0,0], strength: 0 }` and places a hostile `monster.hidden` at `(3, 1)` that the hero cannot see — it is what the existing "does not expose hidden identifiers" case asserts against. Reuse it and replace its `events`:

```ts
describe('spell.cast projection', () => {
  it('names the hero own cast', () => {
    const input = fixture();
    const projected = projectDomainEvents({
      state: input.state,
      content: input.content,
      heroId: input.state.hero.actorId,
      events: [
        {
          type: 'spell.cast',
          eventId: 'command.wait',
          actorId: input.state.hero.actorId,
          spellId: 'spell.ember',
        },
      ],
    });
    expect(projected).toContainEqual(
      expect.objectContaining({ type: 'spell.cast', actorId: input.state.hero.actorId }),
    );
  });

  it('reduces an unseen caster to a sound, naming neither caster nor spell', () => {
    // Before this gate, `spell.cast` was pushed unconditionally -- harmless while only the hero
    // could cast, and a leak of an unseen actor's existence, identity, and spell list the moment
    // a haunt casts. `fixture()`'s monster is unlit and unseen, which is the whole point of it.
    const input = fixture();
    const projected = projectDomainEvents({
      state: input.state,
      content: input.content,
      heroId: input.state.hero.actorId,
      events: [
        {
          type: 'spell.cast',
          eventId: 'command.wait',
          actorId: 'monster.hidden',
          spellId: 'spell.ember',
        },
      ],
    });
    const json = stableJson(projected);
    expect(projected.some((event) => event.type === 'spell.cast')).toBe(false);
    expect(json).not.toContain('spell.ember');
    expect(json).not.toContain('monster.hidden');
    expect(projected).toContainEqual(
      expect.objectContaining({ type: 'sound.heard', category: 'combat' }),
    );
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
cd packages/engine && npx vitest run test/event-projection.test.ts -t "spell.cast projection"
```

Expected: FAIL — the unseen case finds a `spell.cast` in the output.

- [ ] **Step 3: Implement**

In `packages/engine/src/event-projection.ts`, remove `case 'spell.cast':` from the unconditional group and add its own branch:

```ts
      // Hero-visible only. The hero is always visible to itself, so its own casts project
      // exactly as they always have; an unseen caster is reduced to the same directional sound
      // any other unseen combat makes, naming neither the caster nor the spell. Grouping this
      // with `spell.learned` and the tempering events was correct while casting was hero-only,
      // and became a leak the moment a haunt could cast.
      case 'spell.cast': {
        if (actorVisible(event.actorId)) {
          output.push(event);
          break;
        }
        const heard = sound(event, input.state, hero);
        if (heard) output.push({ ...heard, eventId: event.eventId });
        break;
      }
```

Check the `sound()` return shape against the `SoundHeardPublicEvent` interface in `events-model.ts` — if it already carries `eventId`, drop the spread and push `heard` directly.

- [ ] **Step 4: Run the tests and verify they pass**

```bash
cd packages/engine && npx vitest run test/event-projection.test.ts
```

Expected: PASS across the file.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/event-projection.ts packages/engine/test/event-projection.test.ts
git commit -m "fix: an unseen caster is a sound, not a named spell"
```

---

### Task 5: End-to-end, determinism, and the demo gate

**Files:**
- Test: `packages/engine/test/champion-casting.test.ts`

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: nothing new — this task proves the assembled behavior and clears the determinism gate.

**Context an implementer needs:** `resolveCommand(state, command, { content })` is the pure boundary; a monster's turn happens inside the world step a hero command triggers. `encodeActiveRun`/`decodeActiveRun` round-tripping to an identical blob is the save invariant. The demos pin sha-256 hashes in `packages/engine/test/fixtures/*-demo-hashes.json`; the spec expects **no drift**, because a champion only carries abilities when seeded from a hall record of a spell-knowing hero. If a hash does move, do not re-pin — inspect the transcript delta and explain it first.

- [ ] **Step 1: Write the failing test**

Append to `packages/engine/test/champion-casting.test.ts`:

```ts
describe('a haunt cast resolves through the shared resolver', () => {
  it('spends weave, damages the hero, and survives a save round-trip', () => {
    const content = packWith(emberBolt);
    const state = runWithChampion({ abilityIds: ['spell.ember'], distance: 3 });
    const hero = state.actors[0]!;
    const action = championCastAction({ state, actorId: CHAMPION_ACTOR_ID, content })!;
    const applied = applyAction({ state, action, content, eventId: 'event.cast' });

    const caster = applied.state.actors.find(
      (candidate) => candidate.actorId === CHAMPION_ACTOR_ID,
    )!;
    expect(caster.weave).toBe(20 - 4);
    expect(applied.events).toContainEqual(
      expect.objectContaining({ type: 'spell.cast', actorId: CHAMPION_ACTOR_ID }),
    );
    const struck = applied.state.actors.find((candidate) => candidate.actorId === hero.actorId)!;
    expect(struck.health).toBeLessThan(hero.health);

    const encoded = encodeActiveRun(applied.state);
    expect(encodeActiveRun(decodeActiveRun(encoded, content))).toBe(encoded);
  });

  it('stops casting once the pool cannot pay', () => {
    const content = packWith(emberBolt);
    let state = runWithChampion({ abilityIds: ['spell.ember'], distance: 3, weave: 9 });
    let casts = 0;
    for (let turn = 0; turn < 5; turn += 1) {
      const action = championCastAction({ state, actorId: CHAMPION_ACTOR_ID, content });
      if (!action) break;
      casts += 1;
      state = applyAction({ state, action, content, eventId: `event.cast-${turn}` }).state;
    }
    // 9 Weave pays for two casts at 4 and leaves 1 -- not a third.
    expect(casts).toBe(2);
    const caster = state.actors.find((candidate) => candidate.actorId === CHAMPION_ACTOR_ID)!;
    expect(caster.weave).toBe(1);
  });
});
```

Add `applyAction`, `encodeActiveRun`, and `decodeActiveRun` to the `../src/index.js` import at the top of the file.

- [ ] **Step 2: Run the test**

```bash
cd packages/engine && npx vitest run test/champion-casting.test.ts
```

Expected: PASS. If the save round-trip throws, stop and read the error: it means a placed-haunt shape is being persisted in a way the spec's no-schema-bump claim did not anticipate, and that needs resolving before the feature ships.

- [ ] **Step 3: Run the whole engine suite**

```bash
cd packages/engine && npx vitest run
```

Expected: PASS.

- [ ] **Step 4: Rebuild and clear the determinism gate**

```bash
cd /Users/frode.hus/src/github.com/frodehus/rogue
npm run build --workspace @woven-deep/content && npm run build --workspace @woven-deep/engine
npm run gameplay:demo && npm run merchant:demo && npm run population:demo && npm run dungeon:demo && npm run run-records:demo && npm run magic:demo && npm run endgame:demo
```

Expected: every demo verifies against its pinned hash. **If a hash drifts, do not re-pin.** Inspect the transcript delta, work out which command changed and why, and report it — an unexplained drift is a defect in this feature, not a fixture that needs updating.

- [ ] **Step 5: Full gate**

```bash
npm test && npm run typecheck && npm run lint && npm run format:check
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/test/champion-casting.test.ts
git commit -m "test: pin a haunt cast end to end"
```

---

### Task 6: Close the spec amendment and open the PR

**Files:**
- Modify: `docs/superpowers/specs/2026-08-02-hero-power-curve-design.md` (amendment 12)

- [ ] **Step 1: Mark amendment 12 as delivered**

In amendment 12, replace the sentence that reads `**Designed in \`2026-08-04-champion-casting-design.md\`** — the consumer is a weave-budgeted ranged cast for \`target.actor\`/\`target.self\` spells, reusing the existing caster-agnostic \`cast\` resolver.` with:

```markdown
**Delivered:** the consumer is `championCastAction` (`champion-casting.ts`), a weave-budgeted ranged cast for `target.actor`/`target.self` spells resolving through the existing caster-agnostic `cast` resolver — designed in `2026-08-04-champion-casting-design.md`. The aimed and area targeting kinds remain out of scope.
```

- [ ] **Step 2: Commit and push**

```bash
git add docs/superpowers/specs/2026-08-02-hero-power-curve-design.md
git commit -m "docs: mark runtime champion casting delivered"
git push -u origin feat/champion-casting
```

- [ ] **Step 3: Open the PR**

Title: `feat: haunts cast the spells they recorded`

The body should state what shipped, that it needed no save-schema bump and why, the `spell.cast` leak this closed, that the aimed/area targeting kinds are deliberately deferred, and the verification actually run (engine suite, every demo hash, full root gate). Reference #192 and the design doc.

---

## Notes for the implementer

**If the demo hashes drift.** The most likely cause is Task 1: a placed haunt now carries a non-zero `maxWeave`, and if any demo transcript includes a champion placement, its encoded actor changes. That is a legitimate, explainable delta — but it must be explained in the commit and the PR body, not silently re-pinned, and the transcript should show the weave values and nothing else moving.

**If `validateTarget` rejects a case you expected to pass.** It gates on the *caster's* perception (`targetContext(state, actor, content)`), including illumination. A champion cannot cast at a hero standing in an unlit cell it cannot see. That is intended and matches the hero's own constraint; do not loosen it to make a test pass — fix the test's fixture lighting instead.

**Do not reuse `behavior.ts`'s local `target`.** `championCastAction` re-derives its own. The duplication is deliberate: it keeps the decision a pure function testable without constructing a whole behavior turn, and both selections use the same comparator so they cannot disagree.
