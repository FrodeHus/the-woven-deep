# Auto-Explore + Smarter Travel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An auto-explore key that walks the hero to unexplored ground until something interesting happens, travel-to-stairs keys, minimap click-to-travel, and auto-pickup for gold and (optionally) consumables — all client-side, replaying the existing `move`/`pickup` intents one per projection.

**Architecture:** The existing three layers in `apps/web` are generalized, not replaced. (1) Pure planners: `session/travel.ts`'s `computeTravelPath` plus a new frontier BFS in `session/explore.ts`. (2) A pure stepper: `advanceTravel` grows a `mode`, an injected `stopWhen` predicate, an injected `replan` callback (explore re-plans every step), an injected auto-pickup policy, and a `pendingPickup` cursor state so a pickup turn does not desync the cursor. (3) The pacing hook `ui/hooks/useAutoTravel.ts` gains `startExplore`/`travelToStairs` and paces explore at `EXPLORE_STEP_MS`. Keys reach the hook through two new `RouterOutcome` variants handled exactly like `use-belt-slot`.

**Tech Stack:** TypeScript 5.8 ESM, React 19, Vitest 3.2 + @testing-library/react, Tailwind/shadcn UI primitives.

**Spec:** `docs/superpowers/specs/2026-07-31-auto-explore-design.md` — read before starting any task.

## Global Constraints

- **`apps/web` only.** Zero source changes in `packages/engine`, `packages/content`, `packages/session-core`, `apps/server`. Adding an exported helper to `session-core` is NOT allowed — every new helper lives under `apps/web/src`.
- **Intents only.** Nothing here invents a command: every dispatch is `{ type: 'move', direction }` or `{ type: 'pickup' }` (plus the pre-existing `descend`/`ascend` on the stair-overload path). No engine changes, no new commands, no determinism concern.
- **No pathing through unknown cells, locked doors, or perceived actors** — `cellNavigability` stays the single source of truth for both travel and explore.
- **TDD RED-first:** write the failing test, run it, watch it fail, then implement.
- **Commits:** conventional, lowercase, no scope (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).
- **Build gotcha:** web tests import the compiled engine dist. If it is stale, rebuild first: `npm run build --workspace @woven-deep/content && npm run build --workspace @woven-deep/engine`.
- **Typecheck:** `npm run typecheck --workspace @woven-deep/web` (vitest does NOT typecheck).
- **Per-file test run:** `npm run test --workspace @woven-deep/web -- --run <file>`.
- Branch: `feat/auto-explore`. Do not push until Task 9.

## Spec deviations recorded here (amend-before-deviating; Task 9 writes them into the spec)

1. **`ActionId` naming and the `o` collision.** The spec asks for an `autoExplore` action defaulting to `o`, but `o` is already `settings`' default chord and every other multi-word `ActionId` in `settings.ts` is kebab-case. Resolution: the new id is `'auto-explore'` bound to `o`, and `settings` moves to `Shift+O`.
2. **No new stairs `ActionId`s.** The spec asks for `travelDownStairs`/`travelUpStairs` defaulting to `>`/`<`, but `descend`/`ascend` already own those chords and `resolveKeymap`'s `byChord` map admits exactly one action per chord. Resolution: the existing `descend`/`ascend` actions are overloaded — `routeKey` returns `{ type: 'travel-to-stairs', direction }` for them and the handler picks descend-vs-travel from the live projection. One binding, one row in Help/Settings, the spec's overload rule preserved exactly.
3. **Frontier excludes the hero's own cell.** A zero-length path cannot be walked and would spin the pacing loop, so `computeExplorePath` never targets the origin.
4. **The new-item stop excludes auto-pickable items.** The spec says "excluding items auto-picked this run of explore"; implemented as "the item-spotted stop fires only for items the auto-pickup policy declines", which is the same rule stated causally instead of historically.
5. **Auto-pickup runs in `explore` and `stairs` modes only.** Click-travel keeps today's behavior verbatim (minimal stop set, explicit on-arrival pickup) per the locked decision.
6. **The modal stop condition needs no predicate.** `PlayScreen` already composes `isModalActive` and passes it as `useAutoTravel`'s `disabled`, which clears the walk — the spec's modal row is satisfied by existing code.

## File Map

| Unit | Files | Responsibility |
| --- | --- | --- |
| Frontier planner | `apps/web/src/session/explore.ts` (NEW) | `computeExplorePath` BFS (Task 1) |
| Auto-pickup policy | `apps/web/src/session/auto-pickup.ts` (NEW) | category/artifact/backpack rules, `groundItemUnderHero` (Task 2) |
| Stepper | `apps/web/src/session/travel.ts` | `StopReason`, stop predicates, `AdvanceOutcome`, `pendingPickup`, `replan` (Task 3) |
| Settings | `apps/web/src/session/settings.ts`, `apps/web/src/ui/overlays/SettingsOverlay.tsx` | `autoPickupConsumables` (Task 4) |
| Stairs + keys | `apps/web/src/session/stairs.ts` (NEW), `settings.ts`, `apps/web/src/ui/KeyRouter.ts` | stair lookup, `auto-explore` action, two new outcomes (Task 5) |
| Log seam + hook | `apps/web/src/session/{run-session,guest-session,profile-session}.ts`, `apps/web/src/ui/hooks/useAutoTravel.ts` | `noteSystemLine`, `startExplore`, `travelToStairs`, `EXPLORE_STEP_MS` (Task 6) |
| Wiring | `apps/web/src/ui/PlayScreen.tsx`, `apps/web/src/ui/hooks/usePlayKeyDispatcher.ts`, `apps/web/src/ui/CommandPalette.tsx` | keys → hook, palette entry (Task 7) |
| Minimap | `apps/web/src/ui/panels/MinimapPanel.tsx` | per-cell click → `travelTo` (Task 8) |

---

### Task 1: Frontier planner — `session/explore.ts`

**Files:**
- Create: `apps/web/src/session/explore.ts`
- Test: `apps/web/test/explore.test.ts` (new)

**Interfaces:**
- Consumes: `cellNavigability(projection, cell): 'unknown' | 'navigable' | 'blocked'` and `heroOf`/`actorsOf` (already exported from `session/travel.ts` and `session/projection-view.ts`).
- Produces: `export function computeExplorePath(projection: GameplayProjection): readonly Point[] | null` — the path from the hero to the nearest frontier cell, origin excluded (same shape as `computeTravelPath`), or `null` when no frontier is reachable.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/test/explore.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { GameplayProjection, Point } from '@woven-deep/engine';
import { computeExplorePath } from '../src/session/explore.js';

const WIDTH = 12;
const HEIGHT = 8;

interface Actor {
  readonly actorId: string;
  readonly x: number;
  readonly y: number;
  readonly disposition: string;
  readonly health: number;
}

/** A grid of visible floor with optional walls, locked doors, actors and never-discovered cells. */
function makeProjection(input: {
  hero: Point;
  walls?: readonly Point[];
  unknownCells?: readonly Point[];
  lockedDoors?: readonly Point[];
  actors?: readonly Actor[];
}): GameplayProjection {
  const wallSet = new Set((input.walls ?? []).map((p) => `${p.x},${p.y}`));
  const unknownSet = new Set((input.unknownCells ?? []).map((p) => `${p.x},${p.y}`));
  const doorSet = new Set((input.lockedDoors ?? []).map((p) => `${p.x},${p.y}`));
  const cells = [];
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const wall = wallSet.has(`${x},${y}`);
      const door = doorSet.has(`${x},${y}`);
      cells.push({
        index: y * WIDTH + x,
        x,
        y,
        knowledge: unknownSet.has(`${x},${y}`) ? ('unknown' as const) : ('visible' as const),
        tileId: wall ? 0 : 1,
        glyph: wall ? '#' : door ? '+' : '.',
        token: wall ? 'terrain.wall' : door ? 'terrain.door' : 'terrain.floor',
        intensity: 255,
      });
    }
  }
  return {
    floor: { floorId: 'floor.test', depth: 1, town: false, width: WIDTH, height: HEIGHT, cells },
    hero: { x: input.hero.x, y: input.hero.y, health: 20, backpack: [], backpackCapacity: 10 },
    actors: input.actors ?? [],
    groundItems: [],
    features: (input.lockedDoors ?? []).map((p, index) => ({
      featureId: `feature.door.${index}`,
      type: 'door',
      state: 'locked',
      x: p.x,
      y: p.y,
    })),
  } as unknown as GameplayProjection;
}

/** Every cell unknown except a corridor of known floor, so the frontier is unambiguous. */
function corridorProjection(hero: Point, knownCells: readonly Point[]): GameplayProjection {
  const known = new Set(knownCells.map((p) => `${p.x},${p.y}`));
  const unknown: Point[] = [];
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      if (!known.has(`${x},${y}`)) unknown.push({ x, y });
    }
  }
  return makeProjection({ hero, unknownCells: unknown });
}

describe('computeExplorePath', () => {
  it('walks to the nearest cell that touches unexplored ground', () => {
    // Known: a straight run from (2,4) east to (6,4). Everything else is unknown, so (2,4) and
    // (6,4) are both frontier cells -- but the hero stands on (2,4), which is never a target.
    const known: Point[] = [
      { x: 2, y: 4 },
      { x: 3, y: 4 },
      { x: 4, y: 4 },
      { x: 5, y: 4 },
      { x: 6, y: 4 },
    ];
    const path = computeExplorePath(corridorProjection({ x: 4, y: 4 }, known));
    expect(path).not.toBeNull();
    // (3,4) and (5,4) both touch unknown ground and are both one step away; either is correct,
    // but the path must be exactly one step and must not stay put.
    expect(path).toHaveLength(1);
    expect(Math.abs(path![0]!.x - 4)).toBe(1);
    expect(path![0]!.y).toBe(4);
  });

  it('returns null on a fully explored floor', () => {
    expect(computeExplorePath(makeProjection({ hero: { x: 5, y: 5 } }))).toBeNull();
  });

  it('returns null when every frontier is walled off from the hero', () => {
    // A full-height wall at x=3 seals the hero (x=1) away from the unknown region at x>=6.
    const walls: Point[] = [];
    for (let y = 0; y < HEIGHT; y += 1) walls.push({ x: 3, y });
    const unknownCells: Point[] = [];
    for (let y = 0; y < HEIGHT; y += 1) {
      for (let x = 6; x < WIDTH; x += 1) unknownCells.push({ x, y });
    }
    expect(computeExplorePath(makeProjection({ hero: { x: 1, y: 4 }, walls, unknownCells }))).toBeNull();
  });

  it('refuses to route through a locked door', () => {
    // A wall at x=3 with a single LOCKED door at (3,4): the only opening is not navigable.
    const walls: Point[] = [];
    for (let y = 0; y < HEIGHT; y += 1) {
      if (y !== 4) walls.push({ x: 3, y });
    }
    const unknownCells: Point[] = [];
    for (let y = 0; y < HEIGHT; y += 1) {
      for (let x = 6; x < WIDTH; x += 1) unknownCells.push({ x, y });
    }
    const projection = makeProjection({
      hero: { x: 1, y: 4 },
      walls,
      unknownCells,
      lockedDoors: [{ x: 3, y: 4 }],
    });
    expect(computeExplorePath(projection)).toBeNull();
  });

  it('refuses to route through a perceived actor', () => {
    // Same sealed wall, but the single opening at (3,4) is occupied by a bystander.
    const walls: Point[] = [];
    for (let y = 0; y < HEIGHT; y += 1) {
      if (y !== 4) walls.push({ x: 3, y });
    }
    const unknownCells: Point[] = [];
    for (let y = 0; y < HEIGHT; y += 1) {
      for (let x = 6; x < WIDTH; x += 1) unknownCells.push({ x, y });
    }
    const projection = makeProjection({
      hero: { x: 1, y: 4 },
      walls,
      unknownCells,
      actors: [{ actorId: 'a', x: 3, y: 4, disposition: 'neutral', health: 5 }],
    });
    expect(computeExplorePath(projection)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm run test --workspace @woven-deep/web -- --run test/explore.test.ts`
Expected: FAIL — cannot resolve `../src/session/explore.js`.

- [ ] **Step 3: Implement the planner**

Create `apps/web/src/session/explore.ts`:

```ts
import type { GameplayProjection, Point } from '@woven-deep/engine';
import { actorsOf, heroOf } from './projection-view.js';
import { cellNavigability } from './travel.js';

/**
 * Client-side auto-explore planning: a breadth-first search from the hero to the nearest FRONTIER
 * cell -- a navigable cell with at least one 8-neighbour the hero has never discovered. Walking
 * there is what actually grows the map, so "explore" is just repeated travel to the closest edge of
 * the known world. The stepper re-plans this every step (knowledge expands as the hero walks, so a
 * cached path is wrong more often than it is right); an 8 000-cell BFS per turn is negligible.
 */

const NEIGHBOUR_OFFSETS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

/** Does `(x, y)` touch a never-discovered cell? Off-grid neighbours are the map edge, not unknown
 * ground, so they never make a cell a frontier. */
function touchesUnknown(projection: GameplayProjection, x: number, y: number): boolean {
  const { floor } = projection;
  for (const [dx, dy] of NEIGHBOUR_OFFSETS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= floor.width || ny >= floor.height) continue;
    if (floor.cells[ny * floor.width + nx]!.knowledge === 'unknown') return true;
  }
  return false;
}

/**
 * The path (origin excluded, exactly like `computeTravelPath`) from the hero to the nearest
 * reachable frontier cell, or `null` when the floor holds no frontier the hero can walk to -- which
 * the caller reports as "You have explored this floor."
 *
 * Navigability is `cellNavigability`, verbatim: known terrain, passable token, no engaged lock. A
 * cell occupied by a perceived actor is impassable (auto-explore never blunders into anyone), and
 * the hero's own cell is never a target -- a zero-length path cannot be walked.
 */
export function computeExplorePath(projection: GameplayProjection): readonly Point[] | null {
  const { floor } = projection;
  const hero = heroOf(projection);
  const occupied = new Set(actorsOf(projection).map((actor) => `${actor.x},${actor.y}`));
  const size = floor.width * floor.height;
  const origin = hero.y * floor.width + hero.x;

  const previous = new Int32Array(size).fill(-1);
  const seen = new Uint8Array(size);
  seen[origin] = 1;

  // Layer-by-layer BFS: the first frontier reached is the nearest by step count, and neighbour
  // order is fixed, so the choice among equidistant frontiers is deterministic.
  let frontierQueue: number[] = [origin];
  while (frontierQueue.length > 0) {
    const next: number[] = [];
    for (const index of frontierQueue) {
      const x = index % floor.width;
      const y = (index - x) / floor.width;
      if (index !== origin && touchesUnknown(projection, x, y)) {
        const path: Point[] = [];
        let cursor = index;
        while (cursor !== origin) {
          const cx = cursor % floor.width;
          path.push({ x: cx, y: (cursor - cx) / floor.width });
          cursor = previous[cursor]!;
        }
        return path.reverse();
      }
      for (const [dx, dy] of NEIGHBOUR_OFFSETS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= floor.width || ny >= floor.height) continue;
        const neighbour = ny * floor.width + nx;
        if (seen[neighbour] === 1) continue;
        if (cellNavigability(projection, { x: nx, y: ny }) !== 'navigable') continue;
        if (occupied.has(`${nx},${ny}`)) continue;
        seen[neighbour] = 1;
        previous[neighbour] = index;
        next.push(neighbour);
      }
    }
    frontierQueue = next;
  }
  return null;
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npm run test --workspace @woven-deep/web -- --run test/explore.test.ts`
Expected: PASS (5 tests).
Run: `npm run typecheck --workspace @woven-deep/web`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
npx prettier --write apps/web/src/session/explore.ts apps/web/test/explore.test.ts
git add apps/web/src/session/explore.ts apps/web/test/explore.test.ts
git commit -m "feat: add the auto-explore frontier planner"
```

---

### Task 2: Auto-pickup policy — `session/auto-pickup.ts`

**Files:**
- Create: `apps/web/src/session/auto-pickup.ts`
- Test: `apps/web/test/auto-pickup.test.ts` (new)

**Interfaces:**
- Consumes: `GroundItemView` / `heroOf` / `groundItemsOf` from `session/projection-view.ts`; `itemById` from `session/pack-queries.ts` (a re-export of `@woven-deep/session-core`); `ItemContentEntry.artifact` (already `ArtifactDefinition | null` in content).
- Produces:

```ts
export type AutoPickupPolicy = (projection: GameplayProjection, item: GroundItemView) => boolean;
export const AUTO_PICKUP_CONSUMABLE_CATEGORIES: ReadonlySet<string>;
export function createAutoPickupPolicy(
  input: Readonly<{ pack: CompiledContentPack; allowConsumables: boolean }>,
): AutoPickupPolicy;
export function groundItemUnderHero(projection: GameplayProjection): GroundItemView | undefined;
```

- [ ] **Step 1: Write the failing tests**

Create `apps/web/test/auto-pickup.test.ts`:

```ts
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import type { GameplayProjection } from '@woven-deep/engine';
import { itemEntries } from '../src/session/pack-queries.js';
import {
  createAutoPickupPolicy,
  groundItemUnderHero,
} from '../src/session/auto-pickup.js';
import type { GroundItemView } from '../src/session/projection-view.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

function item(overrides: Partial<GroundItemView>): GroundItemView {
  return {
    itemId: 'item.instance.1',
    name: 'Something',
    category: 'misc',
    quantity: 1,
    identified: true,
    x: 5,
    y: 5,
    ...overrides,
  } as GroundItemView;
}

function projectionWith(input: {
  backpack: number;
  capacity: number;
  groundItems?: readonly GroundItemView[];
}): GameplayProjection {
  return {
    hero: {
      x: 5,
      y: 5,
      backpack: Array.from({ length: input.backpack }, (_, index) => ({
        itemId: `item.owned.${index}`,
      })),
      backpackCapacity: input.capacity,
    },
    groundItems: input.groundItems ?? [],
  } as unknown as GameplayProjection;
}

describe('createAutoPickupPolicy', () => {
  it('always takes currency, even with consumables off and a full backpack', () => {
    const policy = createAutoPickupPolicy({ pack, allowConsumables: false });
    const projection = projectionWith({ backpack: 10, capacity: 10 });
    expect(policy(projection, item({ category: 'currency' }))).toBe(true);
  });

  it('takes the five consumable categories when the setting is on and the backpack has room', () => {
    const policy = createAutoPickupPolicy({ pack, allowConsumables: true });
    const projection = projectionWith({ backpack: 3, capacity: 10 });
    for (const category of ['food', 'potion', 'scroll', 'ammunition', 'fuel']) {
      expect(policy(projection, item({ category: category as GroundItemView['category'] }))).toBe(
        true,
      );
    }
  });

  it('declines consumables when the setting is off, and when the backpack is full', () => {
    const off = createAutoPickupPolicy({ pack, allowConsumables: false });
    const on = createAutoPickupPolicy({ pack, allowConsumables: true });
    expect(off(projectionWith({ backpack: 0, capacity: 10 }), item({ category: 'potion' }))).toBe(
      false,
    );
    expect(on(projectionWith({ backpack: 10, capacity: 10 }), item({ category: 'potion' }))).toBe(
      false,
    );
  });

  it('never takes equipment or misc, whatever the setting says', () => {
    const policy = createAutoPickupPolicy({ pack, allowConsumables: true });
    const projection = projectionWith({ backpack: 0, capacity: 10 });
    for (const category of ['weapon', 'armor', 'shield', 'light', 'ring', 'misc']) {
      expect(policy(projection, item({ category: category as GroundItemView['category'] }))).toBe(
        false,
      );
    }
  });

  it('never takes an artifact, whatever its category', () => {
    const artifact = itemEntries(pack).find((entry) => entry.artifact !== null);
    expect(artifact).toBeDefined();
    const policy = createAutoPickupPolicy({ pack, allowConsumables: true });
    const projection = projectionWith({ backpack: 0, capacity: 10 });
    expect(
      policy(
        projection,
        item({ category: 'currency', contentId: artifact!.id as GroundItemView['contentId'] }),
      ),
    ).toBe(false);
  });
});

describe('groundItemUnderHero', () => {
  it('finds the item on the hero cell and nothing otherwise', () => {
    const here = item({ itemId: 'item.here', x: 5, y: 5 });
    const there = item({ itemId: 'item.there', x: 6, y: 5 });
    expect(
      groundItemUnderHero(projectionWith({ backpack: 0, capacity: 10, groundItems: [there, here] })),
    ).toEqual(here);
    expect(
      groundItemUnderHero(projectionWith({ backpack: 0, capacity: 10, groundItems: [there] })),
    ).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm run test --workspace @woven-deep/web -- --run test/auto-pickup.test.ts`
Expected: FAIL — cannot resolve `../src/session/auto-pickup.js`.

If `itemEntries(pack).find((entry) => entry.artifact !== null)` comes back undefined, the content pack has no artifact items yet — in that case build the entry inline instead: drop the `itemEntries` lookup and assert with `contentId` set to any item id whose `artifact` block is non-null, taken from `content/items/artifacts.yaml`.

- [ ] **Step 3: Implement the policy**

Create `apps/web/src/session/auto-pickup.ts`:

```ts
import type { CompiledContentPack } from '@woven-deep/content';
import type { GameplayProjection } from '@woven-deep/engine';
import { itemById } from './pack-queries.js';
import { groundItemsOf, heroOf, type GroundItemView } from './projection-view.js';

/**
 * Which ground items auto-explore may sweep up without asking. Gold is pure upside (it credits
 * `hero.currency` and costs no backpack slot), and the five consumable categories are the ones a
 * player would take every time -- everything else (weapons, armor, rings, artifacts, anything
 * unidentified enough to be interesting) is left alone, and the stepper's new-item stop rule halts
 * the walk so the player decides in person.
 */

/** Exactly the spec's consumable set, drawn from content's `ITEM_CATEGORIES`. */
export const AUTO_PICKUP_CONSUMABLE_CATEGORIES: ReadonlySet<string> = new Set([
  'food',
  'potion',
  'scroll',
  'ammunition',
  'fuel',
]);

/** Would auto-travel take `item` if the hero stood on it right now? Pure: the projection supplies
 * backpack occupancy, the closure supplies the pack and the player's setting. */
export type AutoPickupPolicy = (projection: GameplayProjection, item: GroundItemView) => boolean;

/** A named artifact is never swept up automatically -- a singleton with provenance is exactly the
 * kind of find the player should be standing still for. An unidentified item carries no
 * `contentId`, so it can never be resolved to an artifact; it is also never in an auto-picked
 * category unless it is plain currency, which is never an artifact in practice. */
function isArtifact(pack: CompiledContentPack, item: GroundItemView): boolean {
  if (item.contentId === undefined) return false;
  return itemById(pack, item.contentId)?.artifact != null;
}

export function createAutoPickupPolicy(
  input: Readonly<{ pack: CompiledContentPack; allowConsumables: boolean }>,
): AutoPickupPolicy {
  const { pack, allowConsumables } = input;
  return (projection, item) => {
    if (isArtifact(pack, item)) return false;
    if (item.category === 'currency') return true;
    if (!allowConsumables) return false;
    if (!AUTO_PICKUP_CONSUMABLE_CATEGORIES.has(item.category)) return false;
    const hero = heroOf(projection);
    return hero.backpack.length < hero.backpackCapacity;
  };
}

/** The ground item the hero is standing on, if any -- the one cell auto-pickup ever considers. */
export function groundItemUnderHero(projection: GameplayProjection): GroundItemView | undefined {
  const hero = heroOf(projection);
  return groundItemsOf(projection).find((item) => item.x === hero.x && item.y === hero.y);
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npm run test --workspace @woven-deep/web -- --run test/auto-pickup.test.ts`
Expected: PASS (6 tests).
Run: `npm run typecheck --workspace @woven-deep/web`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
npx prettier --write apps/web/src/session/auto-pickup.ts apps/web/test/auto-pickup.test.ts
git add apps/web/src/session/auto-pickup.ts apps/web/test/auto-pickup.test.ts
git commit -m "feat: add the auto-pickup policy"
```

---

### Task 3: Stop predicates and the generalized stepper — `session/travel.ts`

**Files:**
- Modify: `apps/web/src/session/travel.ts:168-236` (`ActiveTravel`, `beginTravel`, `advanceTravel`)
- Modify: `apps/web/test/travel.test.ts:273-380` (the `advanceTravel` describe block — four `toBeNull()` assertions become `status` assertions)
- Test: `apps/web/test/travel-stepper.test.ts` (new — the stop predicates, pickup cursor, and re-planning)

**Interfaces:**
- Consumes: `AutoPickupPolicy`, `groundItemUnderHero` (Task 2); `computeExplorePath` is NOT imported here (it is injected as `replan`, keeping `travel.ts` free of a cycle with `explore.ts`).
- Produces:

```ts
export type TravelMode = 'travel' | 'explore' | 'stairs';
export type StopReason =
  | 'hero-damaged'
  | 'hostile-appeared'
  | 'item-spotted'
  | 'stair-found'
  | 'feature-revealed'
  | 'hunger'
  | 'light'
  | 'sound'
  | 'action-invalid';
export type StopPredicate = (
  input: Readonly<{ projection: GameplayProjection; lastEvents: readonly PublicEvent[] }>,
) => StopReason | null;
export function baseStopPredicate(start: GameplayProjection): StopPredicate;
export function classicStopPredicate(
  input: Readonly<{ start: GameplayProjection; autoPickup: AutoPickupPolicy }>,
): StopPredicate;
export type AdvanceOutcome =
  | Readonly<{ status: 'stepping'; travel: ActiveTravel }>
  | Readonly<{ status: 'stopped'; reason: StopReason | 'blocked' }>
  | Readonly<{ status: 'arrived' }>;
export interface BeginTravelOptions {
  readonly mode?: TravelMode;
  readonly stopWhen?: StopPredicate;
  readonly autoPickup?: AutoPickupPolicy;
  readonly replan?: (projection: GameplayProjection) => readonly Point[] | null;
}
export function beginTravel(
  projection: GameplayProjection,
  plan: TravelPlan,
  options?: BeginTravelOptions,
): ActiveTravel;
export function advanceTravel(
  input: Readonly<{
    projection: GameplayProjection;
    travel: ActiveTravel;
    dispatch: (intent: PlayerIntent) => void;
    lastEvents?: readonly PublicEvent[];
  }>,
): AdvanceOutcome;
```

`ActiveTravel` becomes `{ steps, cursor, awaiting, onArrive, mode, stopWhen, replan, autoPickup, pendingPickup }`; the old `startHealth`/`startHostileIds` fields are gone — those baselines now live inside `baseStopPredicate`'s closure.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/test/travel-stepper.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { GameplayProjection, Point, PublicEvent } from '@woven-deep/engine';
import type { PlayerIntent } from '../src/session/intents.js';
import type { GroundItemView } from '../src/session/projection-view.js';
import {
  advanceTravel,
  baseStopPredicate,
  beginTravel,
  classicStopPredicate,
} from '../src/session/travel.js';
import type { AutoPickupPolicy } from '../src/session/auto-pickup.js';

const WIDTH = 12;
const HEIGHT = 8;

interface Actor {
  readonly actorId: string;
  readonly x: number;
  readonly y: number;
  readonly disposition: string;
  readonly health: number;
}

function makeProjection(input: {
  hero: Point & { health?: number };
  actors?: readonly Actor[];
  groundItems?: readonly Partial<GroundItemView>[];
  stairs?: readonly Point[];
  unknownCells?: readonly Point[];
}): GameplayProjection {
  const stairSet = new Set((input.stairs ?? []).map((p) => `${p.x},${p.y}`));
  const unknownSet = new Set((input.unknownCells ?? []).map((p) => `${p.x},${p.y}`));
  const cells = [];
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const stair = stairSet.has(`${x},${y}`);
      cells.push({
        index: y * WIDTH + x,
        x,
        y,
        knowledge: unknownSet.has(`${x},${y}`) ? ('unknown' as const) : ('visible' as const),
        tileId: 1,
        glyph: stair ? '>' : '.',
        token: stair ? 'terrain.stair' : 'terrain.floor',
        intensity: 255,
      });
    }
  }
  return {
    floor: { floorId: 'floor.test', depth: 1, town: false, width: WIDTH, height: HEIGHT, cells },
    hero: {
      x: input.hero.x,
      y: input.hero.y,
      health: input.hero.health ?? 20,
      backpack: [],
      backpackCapacity: 10,
    },
    actors: input.actors ?? [],
    groundItems: (input.groundItems ?? []).map((item) => ({
      itemId: 'item.a',
      name: 'Thing',
      category: 'misc',
      quantity: 1,
      identified: true,
      x: 0,
      y: 0,
      ...item,
    })),
    features: [],
  } as unknown as GameplayProjection;
}

const takeNothing: AutoPickupPolicy = () => false;
const takeEverything: AutoPickupPolicy = () => true;

function stopWith(
  start: GameplayProjection,
  projection: GameplayProjection,
  lastEvents: readonly PublicEvent[] = [],
  autoPickup: AutoPickupPolicy = takeNothing,
): ReturnType<ReturnType<typeof classicStopPredicate>> {
  return classicStopPredicate({ start, autoPickup })({ projection, lastEvents });
}

describe('baseStopPredicate', () => {
  it('stops on lost health and on a hostile that was not already visible', () => {
    const start = makeProjection({ hero: { x: 5, y: 5 } });
    const predicate = baseStopPredicate(start);
    expect(predicate({ projection: start, lastEvents: [] })).toBeNull();
    expect(
      predicate({ projection: makeProjection({ hero: { x: 5, y: 5, health: 19 } }), lastEvents: [] }),
    ).toBe('hero-damaged');
    expect(
      predicate({
        projection: makeProjection({
          hero: { x: 5, y: 5 },
          actors: [{ actorId: 'rat', x: 7, y: 5, disposition: 'hostile', health: 4 }],
        }),
        lastEvents: [],
      }),
    ).toBe('hostile-appeared');
  });
});

describe('classicStopPredicate', () => {
  it('stops when a ground item the policy declines comes into view', () => {
    const start = makeProjection({ hero: { x: 5, y: 5 } });
    const spotted = makeProjection({
      hero: { x: 5, y: 5 },
      groundItems: [{ itemId: 'item.sword', category: 'weapon', x: 7, y: 5 }],
    });
    expect(stopWith(start, spotted)).toBe('item-spotted');
  });

  it('does NOT stop for an item the auto-pickup policy would take', () => {
    const start = makeProjection({ hero: { x: 5, y: 5 } });
    const spotted = makeProjection({
      hero: { x: 5, y: 5 },
      groundItems: [{ itemId: 'item.gold', category: 'currency', x: 7, y: 5 }],
    });
    expect(stopWith(start, spotted, [], takeEverything)).toBeNull();
  });

  it('stops when a stair leaves the unknown', () => {
    const start = makeProjection({
      hero: { x: 5, y: 5 },
      stairs: [{ x: 9, y: 5 }],
      unknownCells: [{ x: 9, y: 5 }],
    });
    const revealed = makeProjection({ hero: { x: 5, y: 5 }, stairs: [{ x: 9, y: 5 }] });
    expect(stopWith(start, revealed)).toBe('stair-found');
  });

  it('maps each interrupting event to its reason', () => {
    const start = makeProjection({ hero: { x: 5, y: 5 } });
    const cases: readonly (readonly [PublicEvent, string])[] = [
      [{ type: 'feature.revealed' } as PublicEvent, 'feature-revealed'],
      [{ type: 'hunger.stage-changed', stage: 'hungry' } as unknown as PublicEvent, 'hunger'],
      [{ type: 'fuel.warning', fuel: 5 } as unknown as PublicEvent, 'light'],
      [{ type: 'item.light-extinguished' } as PublicEvent, 'light'],
      [
        { type: 'sound.heard', category: 'combat', direction: 'north' } as unknown as PublicEvent,
        'sound',
      ],
      [{ type: 'action.invalid', reason: 'blocked.door' } as unknown as PublicEvent, 'action-invalid'],
    ];
    for (const [event, reason] of cases) {
      expect(stopWith(start, start, [event])).toBe(reason);
    }
  });
});

describe('advanceTravel with the generalized stepper', () => {
  it('holds the cursor across an auto-pickup turn and then resumes the walk', () => {
    const dispatch = vi.fn<(intent: PlayerIntent) => void>();
    const gold: Partial<GroundItemView> = { itemId: 'item.gold', category: 'currency', x: 6, y: 5 };
    const start = makeProjection({ hero: { x: 5, y: 5 }, groundItems: [gold] });
    const travel = beginTravel(
      start,
      { steps: [{ x: 6, y: 5 }, { x: 7, y: 5 }], onArrive: null },
      { mode: 'stairs', autoPickup: takeEverything, stopWhen: () => null },
    );

    // Step one: an ordinary move east onto the gold.
    const first = advanceTravel({ projection: start, travel, dispatch });
    expect(first.status).toBe('stepping');
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'move', direction: 'east' });

    // Arrived on the gold: the next turn is a pickup, and the cursor must NOT advance for it.
    const onGold = makeProjection({ hero: { x: 6, y: 5 }, groundItems: [gold] });
    const second = advanceTravel({
      projection: onGold,
      travel: (first as { travel: ReturnType<typeof beginTravel> }).travel,
      dispatch,
    });
    expect(second.status).toBe('stepping');
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'pickup' });

    // The gold is gone and the hero has not moved: the walk resumes with the SECOND step.
    const afterPickup = makeProjection({ hero: { x: 6, y: 5 } });
    const third = advanceTravel({
      projection: afterPickup,
      travel: (second as { travel: ReturnType<typeof beginTravel> }).travel,
      dispatch,
    });
    expect(third.status).toBe('stepping');
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'move', direction: 'east' });
    expect(dispatch).toHaveBeenCalledTimes(3);
  });

  it('stops rather than looping when the pickup it dispatched left the item on the floor', () => {
    const dispatch = vi.fn<(intent: PlayerIntent) => void>();
    const potion: Partial<GroundItemView> = { itemId: 'item.potion', category: 'potion', x: 5, y: 5 };
    const projection = makeProjection({ hero: { x: 5, y: 5 }, groundItems: [potion] });
    const travel = beginTravel(
      projection,
      { steps: [{ x: 6, y: 5 }], onArrive: null },
      { mode: 'stairs', autoPickup: takeEverything, stopWhen: () => null },
    );
    const first = advanceTravel({ projection, travel, dispatch });
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'pickup' });
    const second = advanceTravel({
      projection,
      travel: (first as { travel: ReturnType<typeof beginTravel> }).travel,
      dispatch,
    });
    expect(second).toEqual({ status: 'stopped', reason: 'blocked' });
  });

  it('re-plans every step in explore mode and reports arrival when the planner runs dry', () => {
    const dispatch = vi.fn<(intent: PlayerIntent) => void>();
    const projection = makeProjection({ hero: { x: 5, y: 5 } });
    const replan = vi
      .fn<(input: GameplayProjection) => readonly Point[] | null>()
      .mockReturnValueOnce([{ x: 6, y: 5 }])
      .mockReturnValueOnce(null);
    const travel = beginTravel(
      projection,
      { steps: [], onArrive: null },
      { mode: 'explore', replan, stopWhen: () => null },
    );
    const first = advanceTravel({ projection, travel, dispatch });
    expect(first.status).toBe('stepping');
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'move', direction: 'east' });

    const moved = makeProjection({ hero: { x: 6, y: 5 } });
    const second = advanceTravel({
      projection: moved,
      travel: (first as { travel: ReturnType<typeof beginTravel> }).travel,
      dispatch,
    });
    expect(second).toEqual({ status: 'arrived' });
    expect(replan).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm run test --workspace @woven-deep/web -- --run test/travel-stepper.test.ts`
Expected: FAIL — `baseStopPredicate`/`classicStopPredicate` are not exported.

- [ ] **Step 3: Implement the stepper**

In `apps/web/src/session/travel.ts`, add the imports:

```ts
import type { GameplayProjection, Point, PublicEvent } from '@woven-deep/engine';
import { groundItemUnderHero, type AutoPickupPolicy } from './auto-pickup.js';
```

(`Direction` and `findPath` stay as they are.) Then replace the `ActiveTravel`/`beginTravel`/`advanceTravel` block (currently `travel.ts:165-236`) with:

```ts
/** Which walk is in flight. `travel` is the click-to-travel walk (minimal interruptions, unchanged
 * behavior); `explore` re-plans a frontier path every step; `stairs` walks a fixed path to a
 * discovered stair. Explore and stairs share the classic stop set and auto-pickup. */
export type TravelMode = 'travel' | 'explore' | 'stairs';

/** Why an auto-walk stopped, in the player's terms -- the caller turns this into a log line. */
export type StopReason =
  | 'hero-damaged'
  | 'hostile-appeared'
  | 'item-spotted'
  | 'stair-found'
  | 'feature-revealed'
  | 'hunger'
  | 'light'
  | 'sound'
  | 'action-invalid';

/** A pure interruption rule, evaluated against the latest authoritative projection and the events
 * the most recent dispatch produced, BEFORE each step is taken. */
export type StopPredicate = (
  input: Readonly<{ projection: GameplayProjection; lastEvents: readonly PublicEvent[] }>,
) => StopReason | null;

function hostileActorIds(projection: GameplayProjection): ReadonlySet<string> {
  return new Set(
    actorsOf(projection)
      .filter((actor) => actor.disposition === 'hostile')
      .map((actor) => actor.actorId),
  );
}

/**
 * The two interruptions EVERY mode honors, baselined against the projection the walk began from:
 * the hero lost health this turn, or a hostile that was not already visible has appeared. This is
 * click-to-travel's complete stop set -- unchanged from the behavior that shipped.
 */
export function baseStopPredicate(start: GameplayProjection): StopPredicate {
  const startHealth = heroOf(start).health;
  const startHostileIds = hostileActorIds(start);
  return ({ projection }) => {
    if (heroOf(projection).health < startHealth) return 'hero-damaged';
    for (const id of hostileActorIds(projection)) {
      if (!startHostileIds.has(id)) return 'hostile-appeared';
    }
    return null;
  };
}

function discoveredStairKeys(projection: GameplayProjection): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const cell of projection.floor.cells) {
    if (cell.knowledge !== 'unknown' && cell.token === 'terrain.stair') keys.add(`${cell.x},${cell.y}`);
  }
  return keys;
}

function reasonForEvent(event: PublicEvent): StopReason | null {
  switch (event.type) {
    case 'feature.revealed':
      return 'feature-revealed';
    case 'hunger.stage-changed':
      return 'hunger';
    case 'fuel.warning':
    case 'item.light-extinguished':
      return 'light';
    case 'sound.heard':
      return 'sound';
    case 'action.invalid':
      return 'action-invalid';
    default:
      return null;
  }
}

/**
 * The classic roguelike stop set for auto-explore and stairs-travel: the base rules plus anything
 * that changes what the player would want to do next -- a new item worth deciding about, a stair
 * leaving the unknown, a revealed feature, worsening hunger, a failing light, a sound, or a
 * rejected action. Items the `autoPickup` policy would sweep up never count as "new" (the walk
 * takes them and carries on), which is what keeps gold from halting every explore.
 *
 * The modal condition from the design (`pendingDecision`/`trade`/`conclusion`/`houseOpen`) needs no
 * rule here: `PlayScreen` already composes `isModalActive` and passes it as `useAutoTravel`'s
 * `disabled`, which clears the walk outright.
 */
export function classicStopPredicate(
  input: Readonly<{ start: GameplayProjection; autoPickup: AutoPickupPolicy }>,
): StopPredicate {
  const { start, autoPickup } = input;
  const base = baseStopPredicate(start);
  const startItemIds = new Set(groundItemsOf(start).map((item) => item.itemId));
  const startStairKeys = discoveredStairKeys(start);
  return ({ projection, lastEvents }) => {
    const baseReason = base({ projection, lastEvents });
    if (baseReason !== null) return baseReason;
    for (const item of groundItemsOf(projection)) {
      if (startItemIds.has(item.itemId)) continue;
      if (autoPickup(projection, item)) continue;
      return 'item-spotted';
    }
    for (const key of discoveredStairKeys(projection)) {
      if (!startStairKeys.has(key)) return 'stair-found';
    }
    for (const event of lastEvents) {
      const reason = reasonForEvent(event);
      if (reason !== null) return reason;
    }
    return null;
  };
}

/** A travel in flight: the plan plus the cursor into `steps`, the cell the last dispatched move is
 * expected to land the hero on (`awaiting`), the interruption rule, the optional per-step re-planner
 * (explore), the optional auto-pickup policy, and `pendingPickup` -- the itemId of a pickup
 * dispatched last turn, which tells the stepper the hero is NOT expected to have moved. */
export interface ActiveTravel {
  readonly steps: readonly Point[];
  readonly cursor: number;
  readonly awaiting: Point | null;
  readonly onArrive: 'pickup' | null;
  readonly mode: TravelMode;
  readonly stopWhen: StopPredicate;
  readonly replan: ((projection: GameplayProjection) => readonly Point[] | null) | null;
  readonly autoPickup: AutoPickupPolicy | null;
  readonly pendingPickup: string | null;
}

export interface BeginTravelOptions {
  readonly mode?: TravelMode;
  readonly stopWhen?: StopPredicate;
  readonly autoPickup?: AutoPickupPolicy;
  /** Explore's frontier planner, injected rather than imported so `travel.ts` never depends on
   * `explore.ts` (which depends on `cellNavigability` here). */
  readonly replan?: (projection: GameplayProjection) => readonly Point[] | null;
}

export function beginTravel(
  projection: GameplayProjection,
  plan: TravelPlan,
  options: BeginTravelOptions = {},
): ActiveTravel {
  return {
    steps: plan.steps,
    cursor: 0,
    awaiting: null,
    onArrive: plan.onArrive,
    mode: options.mode ?? 'travel',
    stopWhen: options.stopWhen ?? baseStopPredicate(projection),
    replan: options.replan ?? null,
    autoPickup: options.autoPickup ?? null,
    pendingPickup: null,
  };
}

/** What one call to `advanceTravel` did: dispatched an intent and handed back the next travel
 * state; stopped for a reportable reason (or `'blocked'`, which is the silent "the projection did
 * not confirm the step" case); or finished. */
export type AdvanceOutcome =
  | Readonly<{ status: 'stepping'; travel: ActiveTravel }>
  | Readonly<{ status: 'stopped'; reason: StopReason | 'blocked' }>
  | Readonly<{ status: 'arrived' }>;

/**
 * Advances an in-flight travel by exactly one step against the latest authoritative `projection`,
 * dispatching at most one intent. It stays in sync with the engine by only ever advancing the
 * cursor once the projection confirms the previous move landed the hero on `awaiting` -- except
 * after a pickup turn, where the hero is not expected to have moved at all and the cursor holds.
 * If the pickup did not actually clear the item, the walk stops rather than dispatching it forever.
 */
export function advanceTravel(
  input: Readonly<{
    projection: GameplayProjection;
    travel: ActiveTravel;
    dispatch: (intent: PlayerIntent) => void;
    lastEvents?: readonly PublicEvent[];
  }>,
): AdvanceOutcome {
  const { projection, travel, dispatch, lastEvents = [] } = input;
  const hero = heroOf(projection);

  let cursor = travel.cursor;
  if (travel.pendingPickup !== null) {
    const still = groundItemUnderHero(projection);
    if (still?.itemId === travel.pendingPickup) return { status: 'stopped', reason: 'blocked' };
  } else if (travel.awaiting !== null) {
    if (hero.x === travel.awaiting.x && hero.y === travel.awaiting.y) cursor += 1;
    else return { status: 'stopped', reason: 'blocked' };
  }

  const stop = travel.stopWhen({ projection, lastEvents });
  if (stop !== null) return { status: 'stopped', reason: stop };

  if (travel.autoPickup !== null) {
    const item = groundItemUnderHero(projection);
    if (item && travel.autoPickup(projection, item)) {
      dispatch({ type: 'pickup' });
      return {
        status: 'stepping',
        travel: { ...travel, cursor, awaiting: null, pendingPickup: item.itemId },
      };
    }
  }

  let steps = travel.steps;
  if (travel.replan !== null) {
    const replanned = travel.replan(projection);
    if (replanned === null || replanned.length === 0) return { status: 'arrived' };
    steps = replanned;
    cursor = 0;
  }

  if (cursor >= steps.length) {
    if (travel.onArrive === 'pickup') dispatch({ type: 'pickup' });
    return { status: 'arrived' };
  }

  const next = steps[cursor]!;
  const direction = directionBetween(hero, next);
  if (direction === null) return { status: 'stopped', reason: 'blocked' };
  dispatch({ type: 'move', direction });
  return {
    status: 'stepping',
    travel: { ...travel, steps, cursor, awaiting: next, pendingPickup: null },
  };
}
```

- [ ] **Step 4: Update the existing stepper assertions**

In `apps/web/test/travel.test.ts`'s `describe('advanceTravel')` block, `advanceTravel` now returns an `AdvanceOutcome` instead of `ActiveTravel | null`. Make exactly these edits:

- Every `const next = advanceTravel({...})` / `const afterFirst = advanceTravel({...})` that is fed back into a later call becomes the `travel` of the outcome. Add this helper at the top of the describe block and use it everywhere a follow-up call needs the state:

```ts
function stepping(outcome: ReturnType<typeof advanceTravel>): ActiveTravel {
  expect(outcome.status).toBe('stepping');
  return (outcome as { readonly travel: ActiveTravel }).travel;
}
```

(import `type ActiveTravel` alongside the existing imports).
- `expect(advanceTravel({ projection: stuck, travel: afterFirst, dispatch })).toBeNull()` (the "did not confirm the step" case) becomes `.toEqual({ status: 'stopped', reason: 'blocked' })`.
- The health-drop case becomes `.toEqual({ status: 'stopped', reason: 'hero-damaged' })`.
- The new-hostile case becomes `.toEqual({ status: 'stopped', reason: 'hostile-appeared' })`.
- The arrival case (`projection: arrived`) becomes `.toEqual({ status: 'arrived' })`.

- [ ] **Step 5: Run both suites and the typecheck**

Run: `npm run test --workspace @woven-deep/web -- --run test/travel-stepper.test.ts`
Expected: PASS.
Run: `npm run test --workspace @woven-deep/web -- --run test/travel.test.ts`
Expected: PASS.
Run: `npm run typecheck --workspace @woven-deep/web`
Expected: two errors in `ui/hooks/useAutoTravel.ts` (it still assigns `advanceTravel`'s result straight into `travelRef`). Fix them minimally so the tree compiles — Task 6 rewrites this hook properly:

```ts
    const outcome = advanceTravel({ projection, travel: travelRef.current, dispatch });
    travelRef.current = outcome.status === 'stepping' ? outcome.travel : null;
```

(apply the same two-line shape at both call sites, then re-run the typecheck until clean).

- [ ] **Step 6: Run the full web suite and commit**

Run: `npm run test --workspace @woven-deep/web -- --run`
Expected: PASS (`auto-travel.test.tsx` still green — the hook behaves identically).

```bash
npx prettier --write apps/web/src/session/travel.ts apps/web/src/ui/hooks/useAutoTravel.ts apps/web/test/travel.test.ts apps/web/test/travel-stepper.test.ts
git add apps/web/src/session/travel.ts apps/web/src/ui/hooks/useAutoTravel.ts apps/web/test/travel.test.ts apps/web/test/travel-stepper.test.ts
git commit -m "feat: generalize the travel stepper with stop predicates and a pickup cursor"
```

---

### Task 4: The `autoPickupConsumables` setting

**Files:**
- Modify: `apps/web/src/session/settings.ts:41-58` (`Settings`), `:62-68` (`DEFAULT_SETTINGS`), `:293-333` (`parseSettingsJson`)
- Modify: `apps/web/src/ui/overlays/SettingsOverlay.tsx` (a switch row beside the "Onboarding hints" section)
- Test: `apps/web/test/settings.test.ts`, `apps/web/test/settings-overlay.test.tsx`

**Interfaces:**
- Produces: `Settings.autoPickupConsumables: boolean` (default `true`), read by Task 6's hook to build the auto-pickup policy. Roaming needs no work — `useSettingsRoaming` PUTs the whole blob and `settingsFromJson` runs the same parse.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/test/settings.test.ts`:

```ts
describe('autoPickupConsumables', () => {
  it('defaults to on when the stored blob predates the field', () => {
    const storage = memoryStorage();
    storage.set(SETTINGS_KEY, JSON.stringify({ fontScale: 1, bindings: {} }));
    expect(loadSettings(storage).settings.autoPickupConsumables).toBe(true);
    expect(loadSettings(storage).corrupted).toBe(false);
  });

  it('round-trips an explicit off, and ignores a non-boolean', () => {
    const storage = memoryStorage();
    saveSettings(storage, { ...DEFAULT_SETTINGS, autoPickupConsumables: false });
    expect(loadSettings(storage).settings.autoPickupConsumables).toBe(false);
    storage.set(SETTINGS_KEY, JSON.stringify({ autoPickupConsumables: 'yes' }));
    expect(loadSettings(storage).settings.autoPickupConsumables).toBe(true);
  });
});
```

Use whatever storage double and imports the file already has (`memoryStorage`/`SETTINGS_KEY`/`loadSettings`/`saveSettings`/`DEFAULT_SETTINGS` — add any missing name to the existing import list at the top of the file rather than creating a second import statement).

Append to `apps/web/test/settings-overlay.test.tsx` (follow the file's existing render helper):

```ts
  it('toggles auto-pickup for consumables', () => {
    const onChange = vi.fn();
    renderOverlay({ settings: { ...DEFAULT_SETTINGS }, onChange });
    fireEvent.click(screen.getByLabelText(/pick up food, potions/i));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ autoPickupConsumables: false }),
    );
  });
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm run test --workspace @woven-deep/web -- --run test/settings.test.ts test/settings-overlay.test.tsx`
Expected: FAIL — `autoPickupConsumables` is not a property of `Settings`; no matching label in the overlay.

- [ ] **Step 3: Implement**

In `apps/web/src/session/settings.ts`, add to the `Settings` interface (above `bindings`):

```ts
  /** Whether auto-explore and stairs-travel sweep up food, potions, scrolls, ammunition and fuel
   * along the way -- `true` by default. Gold is always collected regardless of this setting, and
   * artifacts never are (see `session/auto-pickup.ts`). */
  readonly autoPickupConsumables: boolean;
```

Add to `DEFAULT_SETTINGS`: `autoPickupConsumables: true,`.

In `parseSettingsJson`, after the `onboarding` branch:

```ts
  const autoPickupConsumables =
    typeof record.autoPickupConsumables === 'boolean'
      ? record.autoPickupConsumables
      : DEFAULT_SETTINGS.autoPickupConsumables;
```

and extend the returned object:

```ts
  const settings: Settings = {
    fontScale,
    reducedMotion,
    theme,
    onboarding,
    autoPickupConsumables,
    bindings: accepted,
  };
```

In `apps/web/src/ui/overlays/SettingsOverlay.tsx`, add a section immediately after the "Onboarding hints" section:

```tsx
      <section aria-labelledby="settings-auto-pickup-heading" className="flex flex-col gap-2">
        <h3 id="settings-auto-pickup-heading" className="text-sm font-semibold text-fg-strong">
          Auto-pickup
        </h3>
        <div className="flex items-center gap-2">
          <Label htmlFor="settings-auto-pickup">
            Pick up food, potions, scrolls, ammunition and fuel while exploring
          </Label>
          <Switch
            id="settings-auto-pickup"
            checked={settings.autoPickupConsumables}
            onCheckedChange={(checked) => onChange({ ...settings, autoPickupConsumables: checked })}
          />
        </div>
      </section>
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npm run test --workspace @woven-deep/web -- --run test/settings.test.ts test/settings-overlay.test.tsx`
Expected: PASS.
Run: `npm run typecheck --workspace @woven-deep/web`
Expected: clean. If any test fixture builds a `Settings` object literal without the new field, add `autoPickupConsumables: true` to it (grep: `rg "reducedMotion: '" apps/web/test apps/web/src`).

- [ ] **Step 5: Commit**

```bash
npx prettier --write apps/web/src/session/settings.ts apps/web/src/ui/overlays/SettingsOverlay.tsx apps/web/test/settings.test.ts apps/web/test/settings-overlay.test.tsx
git add -A apps/web
git commit -m "feat: add the auto-pickup consumables setting"
```

---

### Task 5: Stair lookup, the `auto-explore` action, and the two new router outcomes

**Files:**
- Create: `apps/web/src/session/stairs.ts`
- Modify: `apps/web/src/session/settings.ts` (`ActionId`, `ACTION_IDS`, `ACTION_LABELS`, `DEFAULT_BINDINGS`)
- Modify: `apps/web/src/ui/KeyRouter.ts:22-31` (`RouterOutcome`), `:100-144` (`outcomeForAction`), `:195-204` (`KeyDispatchHandlers`), `:236-261` (`createKeyDispatcher`)
- Test: `apps/web/test/stairs.test.ts` (new), `apps/web/test/key-router.test.ts`
- Also update (the `settings` chord moves from `o` to `Shift+O`): `apps/web/test/key-router.test.ts:216,229`, `apps/web/test/overlay-infrastructure.test.tsx:58`, `apps/web/test/settings-overlay.test.tsx:90,261`, `apps/web/test/settings-roaming.test.tsx:144,181`, `apps/web/test/app-boot.test.tsx:428,899,985`

**Interfaces:**
- Produces:

```ts
// session/stairs.ts
export type StairDirection = 'down' | 'up';
export function stairUnderHero(projection: GameplayProjection, direction: StairDirection): boolean;
export function findDiscoveredStair(
  projection: GameplayProjection,
  direction: StairDirection,
): Point | null;
// KeyRouter.ts
export type RouterOutcome = /* ...existing... */
  | { readonly type: 'start-explore' }
  | { readonly type: 'travel-to-stairs'; readonly direction: StairDirection };
export interface KeyDispatchHandlers {
  /* ...existing... */
  readonly startExplore: () => void;
  readonly travelToStairs: (direction: StairDirection) => void;
}
```

- [ ] **Step 1: Write the failing tests**

Create `apps/web/test/stairs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { GameplayProjection, Point } from '@woven-deep/engine';
import { findDiscoveredStair, stairUnderHero } from '../src/session/stairs.js';

const WIDTH = 10;
const HEIGHT = 6;

function makeProjection(input: {
  hero: Point;
  stairs?: readonly (Point & { glyph: '>' | '<'; known?: boolean })[];
}): GameplayProjection {
  const byKey = new Map(
    (input.stairs ?? []).map((stair) => [`${stair.x},${stair.y}`, stair] as const),
  );
  const cells = [];
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const stair = byKey.get(`${x},${y}`);
      cells.push({
        index: y * WIDTH + x,
        x,
        y,
        knowledge: stair && stair.known === false ? ('unknown' as const) : ('visible' as const),
        tileId: 1,
        glyph: stair ? stair.glyph : '.',
        token: stair ? 'terrain.stair' : 'terrain.floor',
        intensity: 255,
      });
    }
  }
  return {
    floor: { floorId: 'f', depth: 1, town: false, width: WIDTH, height: HEIGHT, cells },
    hero: { x: input.hero.x, y: input.hero.y, health: 20, backpack: [], backpackCapacity: 10 },
    actors: [],
    groundItems: [],
    features: [],
  } as unknown as GameplayProjection;
}

describe('stairUnderHero', () => {
  it('is true only for a stair of the matching direction under the hero', () => {
    const down = makeProjection({ hero: { x: 3, y: 3 }, stairs: [{ x: 3, y: 3, glyph: '>' }] });
    expect(stairUnderHero(down, 'down')).toBe(true);
    expect(stairUnderHero(down, 'up')).toBe(false);
    const away = makeProjection({ hero: { x: 4, y: 3 }, stairs: [{ x: 3, y: 3, glyph: '>' }] });
    expect(stairUnderHero(away, 'down')).toBe(false);
  });
});

describe('findDiscoveredStair', () => {
  it('finds the nearest discovered stair of the matching direction', () => {
    const projection = makeProjection({
      hero: { x: 1, y: 1 },
      stairs: [
        { x: 8, y: 4, glyph: '>' },
        { x: 3, y: 1, glyph: '>' },
        { x: 5, y: 5, glyph: '<' },
      ],
    });
    expect(findDiscoveredStair(projection, 'down')).toEqual({ x: 3, y: 1 });
    expect(findDiscoveredStair(projection, 'up')).toEqual({ x: 5, y: 5 });
  });

  it('ignores an undiscovered stair and returns null when none is known', () => {
    const projection = makeProjection({
      hero: { x: 1, y: 1 },
      stairs: [{ x: 8, y: 4, glyph: '>', known: false }],
    });
    expect(findDiscoveredStair(projection, 'down')).toBeNull();
  });
});
```

Append to `apps/web/test/key-router.test.ts`:

```ts
describe('auto-explore and stairs travel', () => {
  it('maps o to start-explore', () => {
    expect(routeKey({ event: keyEvent('o'), overlayOpen: false, keymap: defaultKeymap })).toEqual({
      type: 'start-explore',
    });
  });

  it('maps > and < to travel-to-stairs rather than raw descend/ascend intents', () => {
    expect(routeKey({ event: keyEvent('>'), overlayOpen: false, keymap: defaultKeymap })).toEqual({
      type: 'travel-to-stairs',
      direction: 'down',
    });
    expect(routeKey({ event: keyEvent('<'), overlayOpen: false, keymap: defaultKeymap })).toEqual({
      type: 'travel-to-stairs',
      direction: 'up',
    });
  });

  it('routes a rebound auto-explore key and forwards both outcomes to their handlers', () => {
    const handlers = {
      dispatch: vi.fn(),
      openOverlay: vi.fn(),
      closeOverlay: vi.fn(),
      dismissHint: vi.fn(),
      useBeltSlot: vi.fn(),
      startExplore: vi.fn(),
      travelToStairs: vi.fn(),
    };
    const keymap = resolveKeymap({ 'auto-explore': { key: 'e', shift: false } });
    const dispatcher = createKeyDispatcher(handlers, () => false, () => keymap);
    dispatcher(keyEvent('e'));
    expect(handlers.startExplore).toHaveBeenCalledTimes(1);
    dispatcher(keyEvent('>'));
    expect(handlers.travelToStairs).toHaveBeenCalledWith('down');
    expect(handlers.dispatch).not.toHaveBeenCalled();
  });
});
```

Use the file's own `keyEvent` helper and its existing `defaultKeymap`/`resolveKeymap` imports; add `resolveKeymap` to the import list if it is not already there. `keyEvent` must supply `repeat: false`, matching how the file already builds events for `createKeyDispatcher`.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm run test --workspace @woven-deep/web -- --run test/stairs.test.ts test/key-router.test.ts`
Expected: FAIL — `session/stairs.js` does not exist; `o` still resolves to `open-overlay: settings`; `>` still resolves to `descend`.

- [ ] **Step 3: Implement**

Create `apps/web/src/session/stairs.ts`:

```ts
import type { GameplayProjection, Point } from '@woven-deep/engine';
import { heroOf } from './projection-view.js';

/**
 * Finding the stairs the hero has actually seen. Both stair tiles share the `terrain.stair` token,
 * so the glyph is what separates down (`>`) from up (`<`) -- the same rule the minimap's stair
 * markers and the playfield's stair glow already use.
 */

export type StairDirection = 'down' | 'up';

function glyphFor(direction: StairDirection): '>' | '<' {
  return direction === 'down' ? '>' : '<';
}

/** Is the hero standing on a stair leading `direction`? When true, the `>`/`<` key means today's
 * ordinary `descend`/`ascend` intent, not travel. */
export function stairUnderHero(projection: GameplayProjection, direction: StairDirection): boolean {
  const hero = heroOf(projection);
  const { floor } = projection;
  const cell = floor.cells[hero.y * floor.width + hero.x];
  if (!cell || cell.knowledge === 'unknown' || cell.token !== 'terrain.stair') return false;
  return cell.glyph === glyphFor(direction);
}

/** The discovered stair of that direction nearest the hero (Chebyshev distance, ties broken by
 * row-major cell order so the choice is deterministic), or `null` when none has been found. */
export function findDiscoveredStair(
  projection: GameplayProjection,
  direction: StairDirection,
): Point | null {
  const hero = heroOf(projection);
  const glyph = glyphFor(direction);
  let best: Point | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const cell of projection.floor.cells) {
    if (cell.knowledge === 'unknown' || cell.token !== 'terrain.stair' || cell.glyph !== glyph)
      continue;
    const distance = Math.max(Math.abs(cell.x - hero.x), Math.abs(cell.y - hero.y));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { x: cell.x, y: cell.y };
    }
  }
  return best;
}
```

In `apps/web/src/session/settings.ts`:
- add `| 'auto-explore'` to the `ActionId` union, right after `'pickup'`, with the comment:
  ```ts
  // Walks the hero toward unexplored ground until something interesting happens -- a client-side
  // convenience that replays ordinary `move`/`pickup` intents, never an engine command.
  | 'auto-explore'
  ```
- add `'auto-explore',` to `ACTION_IDS` right after `'pickup',`
- add `'auto-explore': 'Auto-explore',` to `ACTION_LABELS`
- in `DEFAULT_BINDINGS`, add `'auto-explore': chord('o'),` and change `settings: chord('o')` to `settings: chord('O', true)`
- update the `DEFAULT_BINDINGS` doc comment's key list from ``(`c`/`m`/`v`/`x`/`o`/`Shift+?`)`` to ``(`c`/`m`/`v`/`x`/`Shift+O`/`Shift+?`)``
- update the `descend`/`ascend` labels to `'Descend / go to down stairs'` and `'Ascend / go to up stairs'`

In `apps/web/src/ui/KeyRouter.ts`:
- import the direction type: `import type { StairDirection } from '../session/stairs.js';`
- extend `RouterOutcome`:
  ```ts
    // Starts auto-explore. Like `use-belt-slot`, this is a session-level action rather than a raw
    // intent: `routeKey` has no projection access, and the walk is driven by `useAutoTravel`.
    | { readonly type: 'start-explore' }
    // `>`/`<`. The handler decides between today's `descend`/`ascend` intent (hero already on the
    // matching stair) and starting a walk to a discovered one -- both need the live projection.
    | { readonly type: 'travel-to-stairs'; readonly direction: StairDirection }
  ```
- in `outcomeForAction`, replace the `descend`/`ascend` cases and add the new one:
  ```ts
    case 'descend':
      return { type: 'travel-to-stairs', direction: 'down' };
    case 'ascend':
      return { type: 'travel-to-stairs', direction: 'up' };
    case 'auto-explore':
      return { type: 'start-explore' };
  ```
- extend `KeyDispatchHandlers`:
  ```ts
    /** Starts auto-explore against the live projection -- a no-op with a modal open. */
    readonly startExplore: () => void;
    /** Descends/ascends when the hero already stands on the matching stair, otherwise walks to a
     * discovered one (or reports that none has been found). */
    readonly travelToStairs: (direction: StairDirection) => void;
  ```
- in `createKeyDispatcher`, add two branches beside the `use-belt-slot` one:
  ```ts
    if (outcome.type === 'start-explore') {
      handlers.startExplore();
      return;
    }
    if (outcome.type === 'travel-to-stairs') {
      handlers.travelToStairs(outcome.direction);
      return;
    }
  ```

- [ ] **Step 4: Move the `settings` chord in the existing tests**

Change each of these to press `Shift+O` instead of `o`:
- `apps/web/test/key-router.test.ts:216` → `keyEvent('O', { shiftKey: true })` (match the file's `keyEvent` signature); `:229` → the `['c','m','x','o']` loop becomes `['c','m','x']` plus a separate `Shift+O` assertion for `settings`
- `apps/web/test/overlay-infrastructure.test.tsx:58` → `settings: { key: 'O', shift: true },`
- `apps/web/test/settings-overlay.test.tsx:90` → `expect(bindingRow('Settings')).toHaveTextContent('Shift+O')`; `:261` → `fireEvent.keyDown(window, { key: 'O', shiftKey: true })`
- `apps/web/test/settings-roaming.test.tsx:144,181` and `apps/web/test/app-boot.test.tsx:428,899,985` → `fireEvent.keyDown(window, { key: 'O', shiftKey: true })`

Any test that constructs a bare `KeyDispatchHandlers` object also needs the two new members (`startExplore: vi.fn(), travelToStairs: vi.fn()`); the typecheck in the next step finds them all.

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npm run test --workspace @woven-deep/web -- --run test/stairs.test.ts test/key-router.test.ts`
Expected: PASS.
Run: `npm run typecheck --workspace @woven-deep/web`
Expected: errors only in `ui/hooks/usePlayKeyDispatcher.ts` (missing `startExplore`/`travelToStairs`). Stub them there so the tree compiles — Task 7 wires them for real:

```ts
        startExplore: () => {},
        travelToStairs: () => {},
```

Re-run the typecheck until clean.

- [ ] **Step 6: Run the full web suite and commit**

Run: `npm run test --workspace @woven-deep/web -- --run`
Expected: PASS.

```bash
npx prettier --write apps/web/src/session/stairs.ts apps/web/src/session/settings.ts apps/web/src/ui/KeyRouter.ts apps/web/src/ui/hooks/usePlayKeyDispatcher.ts apps/web/test
git add -A apps/web
git commit -m "feat: bind auto-explore and overload the stair keys with travel"
```

---

### Task 6: The session log seam and the auto-explore pacing hook

**Files:**
- Modify: `apps/web/src/session/run-session.ts` (interface), `apps/web/src/session/guest-session.ts` (public `noteSystemLine`), `apps/web/src/session/profile-session.ts` (same)
- Modify: `apps/web/src/ui/hooks/useAutoTravel.ts` (whole hook)
- Test: `apps/web/test/auto-explore.test.tsx` (new)

**Interfaces:**
- Consumes: `computeExplorePath` (Task 1), `createAutoPickupPolicy` (Task 2), `classicStopPredicate`/`beginTravel`/`advanceTravel`/`AdvanceOutcome`/`TravelMode` (Task 3), `Settings.autoPickupConsumables` (Task 4), `stairUnderHero`/`findDiscoveredStair`/`StairDirection` (Task 5).
- Produces:

```ts
export const EXPLORE_STEP_MS = 90;
export interface AutoTravelHandlers {
  readonly travelTo: (cell: Point) => void;
  readonly startExplore: () => void;
  readonly travelToStairs: (direction: StairDirection) => void;
}
export interface UseAutoTravelParams {
  readonly session: RunSession;
  readonly snapshot: SessionSnapshot;
  readonly pack: CompiledContentPack;
  readonly autoPickupConsumables: boolean;
  readonly disabled?: boolean;
}
// RunSession
noteSystemLine(text: string): void;
```

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/auto-explore.test.tsx`. Copy the harness from `apps/web/test/auto-travel.test.tsx` verbatim (the `beforeAll` pack compile, `projectionOf`, `snapshotOf`, `FakeSession`, `renderPlay`, `moves`) with three changes: `projectionOf` takes an `unknownCells?: readonly Point[]` option that marks those cells `knowledge: 'unknown'` (and gives them no `token`/`glyph`); `FakeSession` gains `readonly notes: string[] = []` and `noteSystemLine(text: string): void { this.notes.push(text); }`; and `snapshotOf` accepts `lastEvents: readonly PublicEvent[] = []`. Then:

```tsx
import { EXPLORE_STEP_MS } from '../src/ui/hooks/useAutoTravel.js';

describe('auto-explore', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('walks toward unexplored ground one step per projection, paced at EXPLORE_STEP_MS', async () => {
    // Everything east of x=25 is undiscovered, so the frontier lies east of the hero.
    const unknownCells: Point[] = [];
    for (let y = 0; y < HEIGHT; y += 1) {
      for (let x = 25; x < WIDTH; x += 1) unknownCells.push({ x, y });
    }
    const session = new FakeSession(projectionOf({ hero: { x: 20, y: 10 }, unknownCells }));
    await renderPlay(session);

    vi.useFakeTimers();

    fireEvent.keyDown(window, { key: 'o' });
    expect(moves(session)).toEqual([{ type: 'move', direction: 'east' }]);

    session.publish(projectionOf({ hero: { x: 21, y: 10 }, unknownCells }));
    expect(moves(session)).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(EXPLORE_STEP_MS);
    });
    expect(moves(session)).toHaveLength(2);
  });

  it('reports a fully explored floor and dispatches nothing', async () => {
    const session = new FakeSession(projectionOf({ hero: { x: 20, y: 10 } }));
    await renderPlay(session);
    fireEvent.keyDown(window, { key: 'o' });
    expect(session.dispatched).toEqual([]);
    expect(session.notes).toEqual(['You have explored this floor.']);
  });

  it('sweeps up gold on the way without stopping, and stops for a weapon', async () => {
    const unknownCells: Point[] = [];
    for (let y = 0; y < HEIGHT; y += 1) {
      for (let x = 25; x < WIDTH; x += 1) unknownCells.push({ x, y });
    }
    const gold: FakeItem = {
      itemId: 'item.gold',
      x: 21,
      y: 10,
      name: 'Gold',
      glyph: '$',
      category: 'currency',
      quantity: 7,
      identified: true,
    };
    const session = new FakeSession(
      projectionOf({ hero: { x: 20, y: 10 }, unknownCells, groundItems: [gold] }),
    );
    await renderPlay(session);

    vi.useFakeTimers();
    fireEvent.keyDown(window, { key: 'o' });
    session.publish(projectionOf({ hero: { x: 21, y: 10 }, unknownCells, groundItems: [gold] }));
    act(() => {
      vi.advanceTimersByTime(EXPLORE_STEP_MS);
    });
    expect(session.dispatched.at(-1)).toEqual({ type: 'pickup' });
    expect(session.notes).toEqual([]);

    // A weapon appearing mid-walk halts the walk with a log line instead.
    const sword: FakeItem = { ...gold, itemId: 'item.sword', category: 'weapon', x: 23, y: 10 };
    session.publish(projectionOf({ hero: { x: 21, y: 10 }, unknownCells, groundItems: [sword] }));
    act(() => {
      vi.advanceTimersByTime(EXPLORE_STEP_MS);
    });
    expect(session.notes).toHaveLength(1);
    expect(session.notes[0]).toMatch(/floor/i);
  });

  it('descends when the hero stands on the down stair and reports undiscovered stairs otherwise', async () => {
    const session = new FakeSession(projectionOf({ hero: { x: 20, y: 10 } }));
    await renderPlay(session);
    fireEvent.keyDown(window, { key: '>' });
    expect(session.dispatched).toEqual([]);
    expect(session.notes).toEqual(["You haven't found those stairs yet."]);

    session.publish(projectionOf({ hero: { x: 20, y: 10 }, stairs: [{ x: 20, y: 10 }] }));
    fireEvent.keyDown(window, { key: '>' });
    expect(session.dispatched).toEqual([{ type: 'descend' }]);
  });
});
```

`projectionOf` also needs a `stairs?: readonly Point[]` option marking those cells `token: 'terrain.stair'`, `glyph: '>'`.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm run test --workspace @woven-deep/web -- --run test/auto-explore.test.tsx`
Expected: FAIL — `EXPLORE_STEP_MS` is not exported and `o`/`>` do nothing.

- [ ] **Step 3: Add the log seam**

In `apps/web/src/session/run-session.ts`, add to the `RunSession` interface:

```ts
  /** Appends a client-only system line to the same message log the engine's events fold into --
   * how auto-explore reports why it stopped, or that there is nothing left to explore. Never a
   * dispatch: no turn passes, no randomness is consumed. */
  noteSystemLine(text: string): void;
```

In `apps/web/src/session/guest-session.ts`, beside `revealLore`:

```ts
  noteSystemLine(text: string): void {
    this.appendSystemLine(text);
    this.publish();
  }
```

Add the identical method to `apps/web/src/session/profile-session.ts` (it has its own private `appendSystemLine` at `:435` and the same `publish()` posture — mirror whatever `revealLore` there does to notify subscribers).

- [ ] **Step 4: Rewrite the hook**

Replace `apps/web/src/ui/hooks/useAutoTravel.ts`'s body (keeping its existing doc comments, extended) with:

```ts
import { useCallback, useEffect, useRef } from 'react';
import type { CompiledContentPack } from '@woven-deep/content';
import type { Point } from '@woven-deep/engine';
import { createAutoPickupPolicy } from '../../session/auto-pickup.js';
import { computeExplorePath } from '../../session/explore.js';
import type { SessionSnapshot } from '../../session/guest-session.js';
import type { PlayerIntent } from '../../session/intents.js';
import type { RunSession } from '../../session/run-session.js';
import {
  findDiscoveredStair,
  stairUnderHero,
  type StairDirection,
} from '../../session/stairs.js';
import {
  advanceTravel,
  beginTravel,
  classicStopPredicate,
  computeTravelPath,
  resolveClick,
  type ActiveTravel,
  type AdvanceOutcome,
  type StopReason,
  type TravelMode,
  type TravelPlan,
} from '../../session/travel.js';
import { STEP_MS } from '../playfield/scene-state.js';

/** Auto-explore's per-step pace: twice click-travel's, because an explore is a long walk the player
 * is watching rather than a short one they aimed. Interrupts still land on the next projection
 * regardless of pace. */
export const EXPLORE_STEP_MS = 90;

/** What each classic stop reason reads as in the message log. */
const STOP_MESSAGES: Readonly<Record<StopReason, string>> = {
  'hero-damaged': 'You stop — you are being hurt.',
  'hostile-appeared': 'You stop — something is moving nearby.',
  'item-spotted': 'You stop — there is something on the floor.',
  'stair-found': 'You stop — you have found a stair.',
  'feature-revealed': 'You stop — you spot something hidden.',
  hunger: 'You stop — your hunger is growing.',
  light: 'You stop — your light is failing.',
  sound: 'You stop — you hear something.',
  'action-invalid': 'You stop — the way is blocked.',
};

export interface AutoTravelHandlers {
  readonly travelTo: (cell: Point) => void;
  /** Starts auto-explore: walk toward the nearest unexplored ground, re-planned every step. */
  readonly startExplore: () => void;
  /** `>`/`<`: descend/ascend when already on the matching stair, otherwise walk to a discovered
   * one, otherwise say so. */
  readonly travelToStairs: (direction: StairDirection) => void;
}

export interface UseAutoTravelParams {
  readonly session: RunSession;
  readonly snapshot: SessionSnapshot;
  /** Resolves a ground item's content entry so an artifact is never auto-picked. */
  readonly pack: CompiledContentPack;
  readonly autoPickupConsumables: boolean;
  readonly disabled?: boolean;
}

export function useAutoTravel({
  session,
  snapshot,
  pack,
  autoPickupConsumables,
  disabled = false,
}: UseAutoTravelParams): AutoTravelHandlers {
  const { projection, lastEvents } = snapshot;
  const travelRef = useRef<ActiveTravel | null>(null);
  const lastDispatchAtRef = useRef(0);
  const pendingStepRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disabledRef = useRef(disabled);
  const dispatch = useCallback((intent: PlayerIntent) => session.dispatch(intent), [session]);

  const clearPendingStep = useCallback(() => {
    if (pendingStepRef.current !== null) {
      clearTimeout(pendingStepRef.current);
      pendingStepRef.current = null;
    }
  }, []);

  useEffect(() => {
    disabledRef.current = disabled;
    if (disabled) {
      travelRef.current = null;
      clearPendingStep();
    }
  }, [disabled, clearPendingStep]);

  useEffect(() => {
    const cancel = (): void => {
      travelRef.current = null;
      clearPendingStep();
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, [clearPendingStep]);

  useEffect(() => clearPendingStep, [clearPendingStep]);

  /** Applies one stepper outcome: keep walking, or end the walk with the mode's own reporting.
   * Click-travel stays silent (its stop set is the two base rules and always was); explore and
   * stairs-travel say why they stopped. `'blocked'` is the "the projection did not confirm the
   * step" case, which the engine has already explained in the log. */
  const applyOutcome = useCallback(
    (outcome: AdvanceOutcome, mode: TravelMode): void => {
      if (outcome.status === 'stepping') {
        travelRef.current = outcome.travel;
        lastDispatchAtRef.current = Date.now();
        return;
      }
      travelRef.current = null;
      if (mode === 'travel') return;
      if (outcome.status === 'arrived') {
        if (mode === 'explore') session.noteSystemLine('You have explored this floor.');
        return;
      }
      if (outcome.reason === 'blocked') return;
      session.noteSystemLine(STOP_MESSAGES[outcome.reason]);
    },
    [session],
  );

  useEffect(() => {
    const travel = travelRef.current;
    if (travel === null) return;
    clearPendingStep();
    const stepMs = travel.mode === 'explore' ? EXPLORE_STEP_MS : STEP_MS;
    const delay = Math.max(0, stepMs - (Date.now() - lastDispatchAtRef.current));
    pendingStepRef.current = setTimeout(() => {
      pendingStepRef.current = null;
      const current = travelRef.current;
      if (current === null || disabledRef.current) return;
      applyOutcome(
        advanceTravel({ projection, travel: current, dispatch, lastEvents }),
        current.mode,
      );
    }, delay);
  }, [projection, lastEvents, dispatch, clearPendingStep, applyOutcome]);

  /** Begins a classic-stop-set walk (explore or stairs) and fires its first step synchronously. */
  const startClassicWalk = (plan: TravelPlan, mode: TravelMode): void => {
    const autoPickup = createAutoPickupPolicy({ pack, allowConsumables: autoPickupConsumables });
    const travel = beginTravel(projection, plan, {
      mode,
      autoPickup,
      stopWhen: classicStopPredicate({ start: projection, autoPickup }),
      ...(mode === 'explore' ? { replan: computeExplorePath } : {}),
    });
    applyOutcome(advanceTravel({ projection, travel, dispatch, lastEvents: [] }), mode);
  };

  const travelTo = (cell: Point): void => {
    clearPendingStep();
    if (disabled) {
      travelRef.current = null;
      return;
    }
    const plan = resolveClick(projection, cell);
    if (plan === null) {
      travelRef.current = null;
      return;
    }
    applyOutcome(
      advanceTravel({ projection, travel: beginTravel(projection, plan), dispatch }),
      'travel',
    );
  };

  const startExplore = (): void => {
    clearPendingStep();
    travelRef.current = null;
    if (disabled) return;
    const path = computeExplorePath(projection);
    if (path === null || path.length === 0) {
      session.noteSystemLine('You have explored this floor.');
      return;
    }
    startClassicWalk({ steps: path, onArrive: null }, 'explore');
  };

  const travelToStairs = (direction: StairDirection): void => {
    clearPendingStep();
    travelRef.current = null;
    if (disabled) return;
    if (stairUnderHero(projection, direction)) {
      dispatch(direction === 'down' ? { type: 'descend' } : { type: 'ascend' });
      return;
    }
    const target = findDiscoveredStair(projection, direction);
    if (target === null) {
      session.noteSystemLine("You haven't found those stairs yet.");
      return;
    }
    const path = computeTravelPath({ projection, destination: target });
    if (path === null || path.length === 0) {
      session.noteSystemLine('You cannot reach those stairs from here.');
      return;
    }
    startClassicWalk({ steps: path, onArrive: null }, 'stairs');
  };

  return { travelTo, startExplore, travelToStairs };
}
```

- [ ] **Step 5: Run the test**

The new test drives the keys through `PlayScreen`, which does not wire them until Task 7 — so at this point run only what this task can verify on its own:

Run: `npm run typecheck --workspace @woven-deep/web`
Expected: errors only where `PlayScreen` calls `useAutoTravel` without the two new params. Add them now (`pack` is already a `PlayScreen` prop; `autoPickupConsumables` comes from `useSettingsCtx()`'s `settings`):

```ts
  const autoTravel = useAutoTravel({
    session,
    snapshot,
    pack,
    autoPickupConsumables: settings.autoPickupConsumables,
    disabled: isModalActive,
  });
```

Re-run the typecheck until clean.
Run: `npm run test --workspace @woven-deep/web -- --run test/auto-travel.test.tsx`
Expected: PASS — click-travel is unchanged. If `FakeSession` there lacks `noteSystemLine`, add a no-op `noteSystemLine(): void {}` beside its other no-ops.

- [ ] **Step 6: Commit**

```bash
npx prettier --write apps/web/src/session/run-session.ts apps/web/src/session/guest-session.ts apps/web/src/session/profile-session.ts apps/web/src/ui/hooks/useAutoTravel.ts apps/web/src/ui/PlayScreen.tsx apps/web/test/auto-travel.test.tsx apps/web/test/auto-explore.test.tsx
git add -A apps/web
git commit -m "feat: drive auto-explore and stairs travel from the pacing hook"
```

---

### Task 7: Wire the keys and the command palette

**Files:**
- Modify: `apps/web/src/ui/hooks/usePlayKeyDispatcher.ts` (two new params, two real handlers)
- Modify: `apps/web/src/ui/PlayScreen.tsx` (hook order, dispatcher params, palette prop)
- Modify: `apps/web/src/ui/CommandPalette.tsx` (an "Auto-explore" entry)
- Test: `apps/web/test/auto-explore.test.tsx` (from Task 6 — now expected to pass), `apps/web/src/ui/CommandPalette.test.tsx` (co-located, not under `test/`)

**Interfaces:**
- Consumes: `AutoTravelHandlers.startExplore`/`travelToStairs` (Task 6), `KeyDispatchHandlers.startExplore`/`travelToStairs` (Task 5).
- Produces: `PlayKeyDispatcherParams` gains `onStartExplore: () => void` and `onTravelToStairs: (direction: StairDirection) => void`; `CommandPaletteProps` gains `onStartExplore: () => void`.

- [ ] **Step 1: Write the failing palette test**

In `apps/web/src/ui/CommandPalette.test.tsx`, extend the `harness` helper with the new prop (add `onStartExplore?: () => void;` to its overrides type, `const onStartExplore = overrides.onStartExplore ?? vi.fn();`, `onStartExplore={onStartExplore}` on the rendered element, and `onStartExplore` in the returned object), then append inside `describe('CommandPalette')`:

```tsx
  it('typing "explore" and Enter starts auto-explore and closes the palette', async () => {
    const user = userEvent.setup();
    const { onStartExplore, onOpenChange, dispatch } = harness();

    await user.type(screen.getByRole('combobox'), 'explore');
    await user.keyboard('{Enter}');

    expect(onStartExplore).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    // A discovery surface, not a parallel command path: no intent is dispatched for this entry.
    expect(dispatch).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run both tests and confirm they fail**

Run: `npm run test --workspace @woven-deep/web -- --run src/ui/CommandPalette.test.tsx test/auto-explore.test.tsx`
Expected: FAIL — no "Auto-explore" entry; the `o`/`>` keys still reach the stubbed no-op handlers from Task 5.

- [ ] **Step 3: Implement the wiring**

In `apps/web/src/ui/hooks/usePlayKeyDispatcher.ts`, add to `PlayKeyDispatcherParams`:

```ts
  /** Starts auto-explore -- `useAutoTravel`'s own handler, forwarded by `PlayScreen`. Not an
   * intent, so it never goes through `session.dispatch` from here. */
  readonly onStartExplore: () => void;
  /** `>`/`<`: descend/ascend on the stair, otherwise walk to a discovered one. */
  readonly onTravelToStairs: (direction: StairDirection) => void;
```

(import `type StairDirection` from `../../session/stairs.js`), destructure both in the parameter list, replace the Task 5 stubs with

```ts
        startExplore: () => onStartExplore(),
        travelToStairs: (direction) => onTravelToStairs(direction),
```

and add `onStartExplore, onTravelToStairs` to the effect's dependency array.

In `apps/web/src/ui/PlayScreen.tsx`:
- move the `usePlayKeyDispatcher({...})` call to AFTER `const autoTravel = useAutoTravel({...})` (which itself must come after `isModalActive` is computed) — the dispatcher now needs the hook's handlers, and nothing above it depends on the dispatcher's return value (it returns `void`).
- add to the dispatcher's params: `onStartExplore: autoTravel.startExplore,` and `onTravelToStairs: autoTravel.travelToStairs,`
- add `onStartExplore={autoTravel.startExplore}` to the `<CommandPalette .../>` element.

In `apps/web/src/ui/CommandPalette.tsx`:
- add to `CommandPaletteProps`:
  ```ts
    /** Starts auto-explore -- the same `useAutoTravel` handler the `o` key reaches, so the palette
     * stays a discovery surface over existing commands rather than a parallel path. */
    readonly onStartExplore: () => void;
  ```
- destructure `onStartExplore` in the component signature
- add beside `runIntent`:
  ```ts
    const runExplore = (): void => {
      onStartExplore();
      onOpenChange(false);
    };
  ```
- render it as the first entry of the "Actions" group, immediately before `{intentActions.map(...)}`:
  ```tsx
              <CommandItem
                value={ACTION_LABELS['auto-explore']}
                onSelect={runExplore}
              >
                <span>{ACTION_LABELS['auto-explore']}</span>
                {hint('auto-explore') && (
                  <CommandShortcut>{hint('auto-explore')}</CommandShortcut>
                )}
              </CommandItem>
  ```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npm run test --workspace @woven-deep/web -- --run src/ui/CommandPalette.test.tsx test/auto-explore.test.tsx`
Expected: PASS.
Run: `npm run typecheck --workspace @woven-deep/web`
Expected: clean (any other `PlayScreen`/`CommandPalette` test that constructs props needs `onStartExplore`; the typecheck lists them).

- [ ] **Step 5: Commit**

```bash
npx prettier --write apps/web/src/ui/hooks/usePlayKeyDispatcher.ts apps/web/src/ui/PlayScreen.tsx apps/web/src/ui/CommandPalette.tsx apps/web/test
git add -A apps/web
git commit -m "feat: route the explore and stair keys to auto-travel"
```

---

### Task 8: Minimap click-to-travel

**Files:**
- Modify: `apps/web/src/ui/panels/MinimapPanel.tsx:27-54` (`MinimapCell`), `:71-120` (`MinimapPanel`)
- Modify: `apps/web/src/ui/PlayScreen.tsx:291` (`<MinimapPanel .../>`)
- Create: `apps/web/test/minimap.test.tsx` (there is no dedicated minimap suite today — `play-screen-integration.test.tsx:408-423` only asserts the panel renders)

**Interfaces:**
- Consumes: `AutoTravelHandlers.travelTo` (unchanged from before this plan).
- Produces: `MinimapPanel` accepts an optional `onTravelTo?: (cell: Point) => void`; known cells carry `data-cell="x,y"` and call it on click, unknown cells render inert.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/minimap.test.tsx` with the imports and a projection factory copied from `apps/web/test/explore.test.ts`'s `makeProjection` (plus `import { render, fireEvent } from '@testing-library/react'`, `import '@testing-library/jest-dom/vitest'`, and `import { MinimapPanel } from '../src/ui/panels/MinimapPanel.js'`). Add a helper that wraps a projection as a snapshot with a lit hero, so the panel does not take its no-light branch:

```tsx
function snapshotWithUnknownAt(cell: Point): SessionSnapshot {
  const projection = makeProjection({ hero: { x: 5, y: 4 }, unknownCells: [cell] });
  // `heroLightIsOut` blanks the minimap outside town unless some equipment slot is `enabled`.
  const lit = {
    ...projection,
    hero: { ...projection.hero, equipment: { offHand: { itemId: 'item.torch', enabled: true } } },
  };
  return { projection: lit } as unknown as SessionSnapshot;
}
```

Then the test itself:

```tsx
describe('MinimapPanel click-to-travel', () => {
  it('clicking a known cell asks auto-travel to walk there; unknown cells are inert', () => {
    const onTravelTo = vi.fn();
    const { container } = render(
      <MinimapPanel snapshot={snapshotWithUnknownAt({ x: 3, y: 2 })} onTravelTo={onTravelTo} />,
    );
    const known = container.querySelector('[data-cell="5,4"]');
    expect(known).not.toBeNull();
    fireEvent.click(known!);
    expect(onTravelTo).toHaveBeenCalledWith({ x: 5, y: 4 });

    expect(container.querySelector('[data-cell="3,2"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm run test --workspace @woven-deep/web -- --run test/minimap.test.tsx`
Expected: FAIL — `MinimapPanel` takes no `onTravelTo`, and no cell carries `data-cell`.

- [ ] **Step 3: Implement**

In `apps/web/src/ui/panels/MinimapPanel.tsx`:

```tsx
function MinimapCell({
  cell,
  isHero,
  onTravelTo,
}: Readonly<{
  cell: ObservableCell;
  isHero: boolean;
  onTravelTo?: (cell: Point) => void;
}>): JSX.Element {
  // A never-discovered cell renders nothing and takes no click: the minimap must never let a
  // player travel somewhere the hero has not seen (the same rule `cellNavigability` enforces).
  if (cell.knowledge === 'unknown') return <span className="block bg-transparent" />;

  // Every discovered cell is clickable and routes through the SAME `autoTravel.travelTo` the iso
  // canvas uses, so an unreachable cell is refused by `resolveClick` rather than by a second,
  // divergent rule here.
  const clickable = {
    'data-cell': `${cell.x},${cell.y}`,
    onClick: () => onTravelTo?.({ x: cell.x, y: cell.y }),
    style: { cursor: onTravelTo ? 'pointer' : undefined },
  } as const;

  if (isHero) return <span {...clickable} className="block bg-accent" />;
  /* ...the existing stair-marker and tint branches, each spreading {...clickable} and merging
     `style` with the branch's own `backgroundColor`... */
}
```

Apply `{...clickable}` to the stair-marker span and the final `bg-muted` span too, merging the `cursor` into each branch's existing `style` object. Then extend the panel:

```tsx
export function MinimapPanel({
  snapshot,
  onTravelTo,
}: PanelProps & Readonly<{ onTravelTo?: (cell: Point) => void }>): JSX.Element {
```

and forward it in the grid: `<MinimapCell key={cell.index} cell={cell} isHero={...} onTravelTo={onTravelTo} />` (add `import type { ObservableCell, Point } from '@woven-deep/engine';`).

In `apps/web/src/ui/PlayScreen.tsx`, change the panel to `<MinimapPanel snapshot={snapshot} onTravelTo={autoTravel.travelTo} />`.

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npm run test --workspace @woven-deep/web -- --run test/minimap.test.tsx`
Expected: PASS.
Run: `npm run typecheck --workspace @woven-deep/web`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
npx prettier --write apps/web/src/ui/panels/MinimapPanel.tsx apps/web/src/ui/PlayScreen.tsx apps/web/test/minimap.test.tsx
git add -A apps/web
git commit -m "feat: travel to a clicked minimap cell"
```

---

### Task 9: Full gate, spec amendment, PR

**Files:**
- Modify: `docs/superpowers/specs/2026-07-31-auto-explore-design.md` (record the six deviations)
- No source changes.

- [ ] **Step 1: Run the root gate**

```bash
npm run build --workspace @woven-deep/content && npm run build --workspace @woven-deep/engine
npm test
```
Expected: every workspace green. If a demo hash drifted, something in this plan touched engine behavior — that is a bug in the change, not a re-pin: find it and fix it (this plan changes no engine, content, or session-core source).

- [ ] **Step 2: Typecheck every workspace**

```bash
npm run typecheck
```
Expected: clean.

- [ ] **Step 3: Amend the spec**

Add a `## Amendments (2026-07-31, during implementation)` section to `docs/superpowers/specs/2026-07-31-auto-explore-design.md` recording the six items from this plan's "Spec deviations" section verbatim: the `'auto-explore'` id and `settings` moving to `Shift+O`; `descend`/`ascend` overloaded instead of two new `ActionId`s; the frontier never targeting the hero's own cell; the item stop excluding auto-pickable items; auto-pickup running in explore/stairs modes only; and the modal stop condition being satisfied by the existing `disabled` path.

- [ ] **Step 4: Commit and open the PR**

```bash
git add docs/superpowers/specs/2026-07-31-auto-explore-design.md
git commit -m "docs: record the auto-explore spec amendments"
git push -u origin feat/auto-explore
gh pr create --title "feat: auto-explore, stairs travel, minimap click-travel and auto-pickup" --body "$(cat <<'EOF'
Implements docs/superpowers/specs/2026-07-31-auto-explore-design.md (issue #161).

- `o` auto-explores: frontier BFS re-planned every step, classic stop set, `EXPLORE_STEP_MS` pacing.
- `>`/`<` descend/ascend on the stair, otherwise walk to a discovered one.
- Minimap cells are click-to-travel.
- Gold is always swept up; food/potions/scrolls/ammunition/fuel follow the new `autoPickupConsumables` setting; artifacts never.

`apps/web` only — no engine, content, or session-core source changes; every step is an ordinary `move`/`pickup` intent.
EOF
)"
```

---

## Self-Review

**Spec coverage.** §1 frontier planner → Task 1. §2 stepper (`mode`, `stopWhen`, `pendingPickup`, classic stop table) → Task 3 (modal row per deviation 6; item row per deviation 4). §3 auto-pickup (currency always, five consumables gated on setting + backpack room, artifacts never, pickup consumes a turn via the cursor) → Tasks 2 and 3. §4 keybindings (new action, `>`/`<` overload, two `RouterOutcome` variants handled like `use-belt-slot`, palette entry) → Tasks 5 and 7, with deviations 1 and 2. §5 minimap → Task 8. §6 pacing (`EXPLORE_STEP_MS = 90`, `STEP_MS` elsewhere) → Task 6. §7 settings (field, default, parse branch, overlay row, roaming) → Task 4. Error handling (no frontier, undiscovered stairs, `action.invalid`, rejection stops rather than retries) → Tasks 3 and 6. Testing section: planner, stepper, auto-pickup, router, minimap, settings — each has a named test in Tasks 1-8.

**Placeholders.** None: every code step carries real TypeScript, every test step a real test body, every run step an exact command and expectation. The two "stub it so the tree compiles" steps (Tasks 3 and 5) name the exact replacement lines and the task that finishes them.

**Type consistency.** `AutoPickupPolicy`, `groundItemUnderHero` (Task 2) are consumed with those exact names in Task 3 and Task 6. `AdvanceOutcome`/`StopReason`/`TravelMode`/`BeginTravelOptions` (Task 3) match Task 6's imports. `StairDirection`/`stairUnderHero`/`findDiscoveredStair` (Task 5) match Tasks 6 and 7. `Settings.autoPickupConsumables` (Task 4) matches Task 6's `UseAutoTravelParams`. `noteSystemLine` (Task 6) matches the fakes in Tasks 6-7. `computeExplorePath` (Task 1) is injected as `replan` — never imported by `travel.ts`, so there is no import cycle.
