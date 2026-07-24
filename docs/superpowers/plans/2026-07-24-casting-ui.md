# Client Casting UI (Spec B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the shipped magic system usable in the web client — AoE targeting with a live footprint preview, offensive-scroll targeting, a browsable spellbook overlay, and recall/merchant/learn polish — without changing any engine behavior.

**Architecture:** Extract the engine's `burstCells`/`lineCells`/`coneCells` into a pure, dependency-injected geometry module inside `@woven-deep/engine` (callbacks `isOpaque`/`inBounds`); the engine calls it with tile-derived callbacks (behavior identical to today), the client mirror calls it with fogged-projection-derived callbacks. The algorithm is single-source; the client's fog-limited input keeps its preview advisory while the server stays authoritative. On top of that, a shared free-cursor targeting mode drives both spell casts (`cast` intent) and offensive-scroll uses (`use`+target), a `spellbook` overlay browses known spells, and small polish surfaces recall/merchant/learn.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`), ESM with `.js` import specifiers, React 19 + Base UI + Tailwind v4 (`apps/web`), vitest + @testing-library/react + jsdom (web tests), vitest (engine/session-core tests). Monorepo packages: `@woven-deep/content`, `@woven-deep/engine`, `@woven-deep/session-core`, `@woven-deep/web`.

## Global Constraints

- **Determinism boundary preserved.** The client sends only `cast` / `use`+target intents; the server re-validates aptitude, Weave, and targeting via `validateTarget`. The UI previews (advisory, fog-limited) but never enforces engine rules.
- **Advisory-preview invariant.** The client mirror (`spell-targeting.ts`) is a REIMPLEMENTATION advised by the projection, never authoritative — any drift can only make the client UI overly conservative or permissive about highlighting, never bypass the real rule.
- **Server-authoritative invariant.** No new gameplay, no server-authority changes. Spec B is UI-only in `apps/web` plus (a) the additive `CastableSpellView.aoe` projection field, (b) the optional `target` on the item-use intent/command-builder, and (c) the behavior-preserving shared-geometry extraction touching `packages/engine`'s targeting.
- **Behavior-preserving engine refactor.** The shared-geometry extraction changes NO engine behavior: `validateTarget` output identical, all 8 demos byte-identical, cross-process parity harness green.
- **Strict TypeScript:** `exactOptionalPropertyTypes` is on — an optional field is either present with a value or absent, never `undefined` in an object literal. Use conditional spreads (`...(x === undefined ? {} : { x })`) exactly as the existing code does.
- **ESM specifiers:** every intra-package import ends in `.js` (even for `.ts`/`.tsx` sources).
- **The 8 demos** (each `npm run <name>:demo`): `dungeon`, `gameplay`, `merchant`, `population`, `run-records`, `endgame`, `magic`, `engine`. All must stay byte-identical (each runs with `--verify`).
- **Naming:** follow existing names exactly — `CastableSpellView`, `TargetCandidate`, `computeValidTargets`, `useSpellTargeting`, `TargetingOverlay`, `OverlayId`, `ActionId`, `PlayerIntent`.

---

## File Structure

**Phase 1 — foundation**
- `packages/engine/src/aoe-geometry.ts` (NEW) — pure, dependency-injected `burstCells`/`lineCells`/`coneCells` + `bresenhamLine`; the single-source geometry. HOME rationale below.
- `packages/engine/src/index.ts` (MODIFY) — export the new module.
- `packages/engine/src/targeting.ts` (MODIFY) — private `line`/`burstCells`/`lineCells`/`coneCells` become thin wrappers that call the shared module with tile-derived callbacks.
- `packages/engine/test/aoe-geometry.test.ts` (NEW) — direct unit tests of the pure geometry.
- `packages/engine/src/projection.ts` (MODIFY) — add `aoe?` to `CastableSpellView`; populate in `projectHeroView`; add `returnAnchorDepth?` to `GameplayProjection`, populate in `projectGameplayState` (Phase 5 T8 also lands here).

**Shared-geometry module HOME (the key architectural decision):** `packages/engine/src/aoe-geometry.ts`, re-exported from `@woven-deep/engine`'s index. **Why this is the only cycle-free home:** `@woven-deep/session-core` and `apps/web` both already `import … from '@woven-deep/engine'`; `apps/web` imports engine types in `spell-targeting.ts` today. Putting the geometry in `session-core` would force `targeting.ts` (engine) to import `session-core`, but `session-core` imports `engine` → a runtime cycle `engine ↔ session-core`, which `.dependency-cruiser.cjs`'s `no-circular` rule forbids (it is not type-only). Putting it in `engine` keeps every edge one-directional: `engine → engine/aoe-geometry` (intra-package), `session-core → engine`, `apps/web → engine`. The `engine-not-into-web-or-server` rule only forbids the reverse (engine depending on apps), which we never do. The module imports only `Point` from `./model.js` (a type) — no engine state — so it stays pure.

**Phase 2 — AoE targeting core**
- `apps/web/src/session/spell-targeting.ts` (MODIFY) — add `affectedFootprint`; back AoE geometry with the shared module; update stale "no AoE" comments.
- `apps/web/test/spell-targeting.test.ts` (MODIFY) — AoE footprint + parity cases.
- `apps/web/src/ui/hooks/useSpellTargeting.ts` (MODIFY) — free-cursor mode.
- `apps/web/src/ui/TargetingOverlay.tsx` (MODIFY) — footprint + affected-actor highlight.
- `apps/web/src/ui/PlayScreen.tsx` (MODIFY) — wire free cursor + hover + affected actors.
- `apps/web/test/spell-targeting-play-screen.test.tsx` (MODIFY) — AoE cursor/confirm tests.

**Phase 3 — scrolls**
- `packages/session-core/src/intents.ts` (MODIFY) — optional `target` on `backpack`+`use`.
- `packages/session-core/src/command-builder.ts` (MODIFY) — thread `target` into `use-item`.
- `packages/session-core/test/command-builder.test.ts` (MODIFY) — targeted-use cases.
- `apps/web/src/ui/overlays/InventoryOverlay.tsx` (MODIFY) — route targeted scrolls into targeting mode.
- `apps/web/src/ui/hooks/useSpellTargeting.ts` (MODIFY) — generalize to dispatch `cast` OR `use`+target.
- `apps/web/src/session/scroll-targeting.ts` (NEW) — pure helper: does an item's spell need aim?

**Phase 4 — spellbook overlay**
- `apps/web/src/ui/overlays/registry.ts`, `apps/web/src/ui/KeyRouter.ts`, `apps/web/src/session/settings.ts` (MODIFY) — register `spellbook` id/action/keybind.
- `apps/web/src/ui/overlays/SpellbookOverlay.tsx` (NEW) + `.test.tsx` (NEW).
- `apps/web/src/session/spell-detail.ts` (NEW) + `.test.ts` (NEW) — derive prose/badge/effects summary from the content pack + `CastableSpellView`.
- `apps/web/src/ui/overlays/OverlayHost.tsx` (MODIFY) — render body case.

**Phase 5 — polish**
- `apps/web/src/ui/TownPanel.tsx`, `apps/web/src/ui/CommandPalette.tsx` (MODIFY) — recall return-portal relabel.
- `apps/web/src/ui/screens/TradeScreen.tsx` (MODIFY) — spell/AoE badge on tome/scroll rows.
- `apps/web/src/session/event-log.ts` (MODIFY) + `.test.ts` — `spell.learned` feedback line.

**Phase 6 — gate**
- No new files; whole-surface verification.

---

## Task 1: Extract shared AoE geometry (behavior-preserving)

**Files:**
- Create: `packages/engine/src/aoe-geometry.ts`
- Create: `packages/engine/test/aoe-geometry.test.ts`
- Modify: `packages/engine/src/index.ts` (add one export line after `export * from './targeting.js';`, line ~62)
- Modify: `packages/engine/src/targeting.ts:28-111` (private `line`/`burstCells`/`lineCells`/`coneCells`)

**Interfaces:**
- Consumes: `Point` from `./model.js`.
- Produces:
  - `interface AoeGeometryCallbacks { readonly isOpaque: (point: Point) => boolean; readonly inBounds: (point: Point) => boolean; }`
  - `function bresenhamLine(from: Point, to: Point): readonly Point[]` — EXCLUSIVE of `from`, inclusive of `to`.
  - `function burstCells(center: Point, radius: number, callbacks: Pick<AoeGeometryCallbacks, 'inBounds'>): readonly Point[]`
  - `function lineCells(origin: Point, aim: Point, radius: number, callbacks: Pick<AoeGeometryCallbacks, 'isOpaque'>): readonly Point[]`
  - `function coneCells(origin: Point, aim: Point, radius: number, callbacks: Pick<AoeGeometryCallbacks, 'inBounds'>): readonly Point[]`
  - **Callback contract (load-bearing for parity):** `isOpaque(point)` MUST return `true` for any out-of-bounds point (mirrors the engine's `isOpaqueCell`, which returns `true` when `tileIndex` is `undefined` — `lineCells` relies on this to stop at the map edge). `inBounds(point)` returns whether the point is a real tile.

**Determinism note:** every function iterates `dy` then `dx` in ascending order and returns cells row-major; `lineCells` preserves Bresenham path order. No `Set`/`Map` iteration, no `Date`/`Math.random`. This ordering is what makes `validateTarget`'s `cells` output byte-identical to today.

- [ ] **Step 1: Write the failing unit test**

Create `packages/engine/test/aoe-geometry.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import type { Point } from '../src/index.js';
import { bresenhamLine, burstCells, coneCells, lineCells } from '../src/aoe-geometry.js';

/** In-bounds for a `w x h` grid whose origin is (0,0). */
function boundsOf(w: number, h: number) {
  return (p: Point): boolean => p.x >= 0 && p.y >= 0 && p.x < w && p.y < h;
}

/** Opaque when the point is out of the `w x h` grid OR is one of `walls`. Mirrors the engine
 * contract: out-of-bounds reads as opaque so `lineCells` stops at the edge. */
function opacityOf(w: number, h: number, walls: readonly [number, number][]) {
  const wallSet = new Set(walls.map(([x, y]) => `${x},${y}`));
  return (p: Point): boolean =>
    p.x < 0 || p.y < 0 || p.x >= w || p.y >= h || wallSet.has(`${p.x},${p.y}`);
}

function keys(cells: readonly Point[]): Set<string> {
  return new Set(cells.map((c) => `${c.x},${c.y}`));
}

describe('burstCells', () => {
  it('returns every in-bounds cell within Chebyshev radius of the center', () => {
    const cells = burstCells({ x: 5, y: 5 }, 1, { inBounds: boundsOf(9, 9) });
    const set = keys(cells);
    expect(set.size).toBe(9);
    expect(set.has('4,4')).toBe(true);
    expect(set.has('6,6')).toBe(true);
    expect(set.has('3,5')).toBe(false);
  });

  it('drops out-of-bounds cells at the map edge', () => {
    const cells = burstCells({ x: 0, y: 0 }, 1, { inBounds: boundsOf(9, 9) });
    expect(keys(cells)).toEqual(new Set(['0,0', '1,0', '0,1', '1,1']));
  });
});

describe('lineCells', () => {
  it('collects cells toward the aim and stops before an opaque tile, excluding the origin', () => {
    const cells = lineCells({ x: 2, y: 2 }, { x: 8, y: 2 }, 6, {
      isOpaque: opacityOf(9, 3, [[5, 2]]),
    });
    const xs = cells
      .filter((c) => c.y === 2)
      .map((c) => c.x)
      .sort((a, b) => a - b);
    expect(xs).toEqual([3, 4]);
  });
});

describe('coneCells', () => {
  it('returns a widening wedge in the aimed direction', () => {
    const cells = coneCells({ x: 2, y: 2 }, { x: 8, y: 2 }, 3, { inBounds: boundsOf(11, 11) });
    const set = keys(cells);
    expect(set.has('3,2')).toBe(true); // one cell east
    expect(set.has('5,4')).toBe(true); // widened at depth 3
    expect(set.has('2,5')).toBe(false); // due south, not in an eastward cone
    expect(set.has('2,2')).toBe(false); // never includes the origin
  });
});

describe('bresenhamLine', () => {
  it('is exclusive of the start and inclusive of the end', () => {
    const cells = bresenhamLine({ x: 0, y: 0 }, { x: 3, y: 0 });
    expect(cells).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run build --workspace @woven-deep/engine && npx vitest run packages/engine/test/aoe-geometry.test.ts`
Expected: FAIL — `Cannot find module '../src/aoe-geometry.js'` (module not created yet).

- [ ] **Step 3: Create the pure geometry module**

Create `packages/engine/src/aoe-geometry.ts`:

```typescript
import type { Point } from './model.js';

/**
 * Callbacks that abstract the tile source for AoE shape computation. The engine passes tile-derived
 * callbacks (`targeting.ts`); the web client passes fogged-projection-derived callbacks
 * (`apps/web/src/session/spell-targeting.ts`). The ALGORITHM is single-source here; only the INPUT
 * differs, which is exactly why the client preview stays advisory while the server stays
 * authoritative. `isOpaque` MUST return `true` for out-of-bounds points (so `lineCells` stops at the
 * map edge), mirroring the engine's `isOpaqueCell`.
 */
export interface AoeGeometryCallbacks {
  readonly isOpaque: (point: Point) => boolean;
  readonly inBounds: (point: Point) => boolean;
}

function chebyshev(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Bresenham path from `from` to `to`, EXCLUSIVE of `from` and inclusive of `to`. */
export function bresenhamLine(from: Point, to: Point): readonly Point[] {
  const points: Point[] = [];
  let x = from.x;
  let y = from.y;
  const dx = Math.abs(to.x - from.x);
  const sx = from.x < to.x ? 1 : -1;
  const dy = -Math.abs(to.y - from.y);
  const sy = from.y < to.y ? 1 : -1;
  let error = dx + dy;
  while (x !== to.x || y !== to.y) {
    const twice = 2 * error;
    if (twice >= dy) {
      error += dy;
      x += sx;
    }
    if (twice <= dx) {
      error += dx;
      y += sy;
    }
    points.push({ x, y });
  }
  return points;
}

/** Filled Chebyshev disc around `center`, deterministically ordered (row-major), in-bounds only. */
export function burstCells(
  center: Point,
  radius: number,
  callbacks: Pick<AoeGeometryCallbacks, 'inBounds'>,
): readonly Point[] {
  const cells: Point[] = [];
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const cell = { x: center.x + dx, y: center.y + dy };
      if (!callbacks.inBounds(cell)) continue;
      cells.push(cell);
    }
  }
  return cells;
}

/** Bresenham path from `origin` toward `aim`, capped at `radius`, stopping at the first opaque tile. */
export function lineCells(
  origin: Point,
  aim: Point,
  radius: number,
  callbacks: Pick<AoeGeometryCallbacks, 'isOpaque'>,
): readonly Point[] {
  const cells: Point[] = [];
  for (const cell of bresenhamLine(origin, aim)) {
    if (chebyshev(origin, cell) > radius) break;
    if (callbacks.isOpaque(cell)) break;
    cells.push(cell);
  }
  return cells;
}

/**
 * Wedge of depth `radius` from `origin` toward `aim`, correct for all 8 aim directions. A cell at
 * offset (dx, dy) is in the cone iff it's within the Chebyshev extent, forward of the origin along
 * the aim direction, and within the 45-degree half-angle (forward component >= perpendicular).
 */
export function coneCells(
  origin: Point,
  aim: Point,
  radius: number,
  callbacks: Pick<AoeGeometryCallbacks, 'inBounds'>,
): readonly Point[] {
  const fx = Math.sign(aim.x - origin.x);
  const fy = Math.sign(aim.y - origin.y);
  const cells: Point[] = [];
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > radius) continue;
      const forward = dx * fx + dy * fy;
      if (forward <= 0) continue;
      const perpendicular = Math.abs(dx * -fy + dy * fx);
      if (forward < perpendicular) continue;
      const cell = { x: origin.x + dx, y: origin.y + dy };
      if (!callbacks.inBounds(cell)) continue;
      cells.push(cell);
    }
  }
  return cells;
}
```

- [ ] **Step 4: Export from the engine index**

In `packages/engine/src/index.ts`, add after line 62 (`export * from './targeting.js';`):

```typescript
export * from './aoe-geometry.js';
```

- [ ] **Step 5: Run the unit test to verify it passes**

Run: `npm run build --workspace @woven-deep/engine && npx vitest run packages/engine/test/aoe-geometry.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Refactor `targeting.ts` to call the shared module (behavior-preserving)**

In `packages/engine/src/targeting.ts`, add to the top imports:

```typescript
import {
  burstCells as sharedBurstCells,
  coneCells as sharedConeCells,
  lineCells as sharedLineCells,
} from './aoe-geometry.js';
```

Delete the private `line` function (lines 28-50) and the three private shape functions (`burstCells` 62-73, `lineCells` 75-84, `coneCells` 93-111). Keep `chebyshev` (52-54) and `isOpaqueCell` (56-60). Replace the deleted shape functions with wrappers that build callbacks from `input`:

```typescript
function inBoundsCell(input: TargetValidationInput, point: Point): boolean {
  return tileIndex(input.floor, point.x, point.y) !== undefined;
}

function burstCells(input: TargetValidationInput, center: Point, radius: number): readonly Point[] {
  return sharedBurstCells(center, radius, { inBounds: (p) => inBoundsCell(input, p) });
}

function lineCells(input: TargetValidationInput, aim: Point, radius: number): readonly Point[] {
  return sharedLineCells(input.sourceActor, aim, radius, {
    isOpaque: (p) => isOpaqueCell(input, p),
  });
}

function coneCells(input: TargetValidationInput, aim: Point, radius: number): readonly Point[] {
  return sharedConeCells(input.sourceActor, aim, radius, { inBounds: (p) => inBoundsCell(input, p) });
}
```

Note: `validatePoint` (line 152) still calls the module-private Bresenham via `line(...)`. Replace those two remaining `line(...)` call sites (`lineCells` no longer defines it) with `bresenhamLine` from the shared module — add `bresenhamLine` to the import and change `const cells = line(input.sourceActor, point);` (line 152) to `const cells = bresenhamLine(input.sourceActor, point);`. The `sourceActor` is a `Point`-compatible `ActorState` (has `x`/`y`), exactly as before.

- [ ] **Step 7: Run the engine targeting tests to verify identical behavior**

Run: `npm run build --workspace @woven-deep/engine && npx vitest run packages/engine/test/targeting.test.ts packages/engine/test/targeting-aoe.test.ts`
Expected: PASS (all existing cases green — `validateTarget` output unchanged).

- [ ] **Step 8: Run the magic demo test + full engine suite**

Run: `npx vitest run packages/engine/test/magic-demo.test.ts`
Expected: PASS.
Run: `npm run test --workspace @woven-deep/engine`
Expected: PASS (whole engine suite).

- [ ] **Step 9: Verify all 8 demos are byte-identical**

Run: `npm run engine:demo && npm run dungeon:demo && npm run gameplay:demo && npm run merchant:demo && npm run population:demo && npm run run-records:demo && npm run endgame:demo && npm run magic:demo`
Expected: each prints its demo output and exits 0 (the `--verify` flag re-checks the golden transcript). No non-zero exit, no diff.

- [ ] **Step 10: Verify cross-process parity harness**

Run: `npm run build --workspace @woven-deep/engine && npx vitest run apps/server/test/play/determinism-parity.test.ts`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/engine/src/aoe-geometry.ts packages/engine/test/aoe-geometry.test.ts packages/engine/src/index.ts packages/engine/src/targeting.ts
git commit -m "refactor(engine): extract shared AoE geometry (behavior-preserving)"
```

---

## Task 2: Add `aoe` to `CastableSpellView` and thread to the client

**Files:**
- Modify: `packages/engine/src/projection.ts:436-443` (`CastableSpellView`) and `:727-736` (`projectHeroView` mapping)
- Test: `packages/engine/test/` — add `castable-spell-aoe.test.ts` (NEW)

**Interfaces:**
- Consumes: `SpellContentEntry.aoe?: SpellAoeDescriptor` (`packages/content/src/model/spell.ts`, `{ shape: 'burst'|'line'|'cone'; radius: number }`).
- Produces: `CastableSpellView.aoe?: { readonly shape: 'burst' | 'line' | 'cone'; readonly radius: number }`. Client `HeroView.castableSpells` (re-exported from `session-core`) carries it automatically — `apps/web/src/session/projection-view.ts` is `export * from '@woven-deep/session-core'`, and `session-core`'s `projection-view.ts` re-exports `CastableSpellView` from `@woven-deep/engine`.

**Note on demo fixtures:** `castableSpells` is a hero-view-only field; the projection is not content-hashed into any demo transcript (the demos assert engine state + events, not the guest projection). This field is additive and optional, so the projection round-trip is unaffected. Step 4 confirms this by re-running the magic demo.

- [ ] **Step 1: Write the failing test**

Create `packages/engine/test/castable-spell-aoe.test.ts`:

```typescript
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import type { CompiledContentPack } from '@woven-deep/content';
import {
  DEFAULT_GUEST_HERO,
  createNewRun,
  projectGameplayState,
  type ActiveRun,
  type CastableSpellView,
} from '../src/index.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

function castableFor(spellIds: readonly string[]): readonly CastableSpellView[] {
  const run: ActiveRun = createNewRun({ pack, seed: [1, 2, 3, 4], hero: DEFAULT_GUEST_HERO });
  const withSpells: ActiveRun = { ...run, hero: { ...run.hero, knownSpellIds: [...spellIds] } };
  const projection = projectGameplayState({ state: withSpells, content: pack });
  return (projection.hero.castableSpells ?? []);
}

describe('CastableSpellView.aoe', () => {
  it('populates aoe for a burst spell', () => {
    const fireball = castableFor(['spell.fireball']).find((s) => s.spellId === 'spell.fireball');
    expect(fireball?.aoe).toEqual({ shape: 'burst', radius: 2 });
  });

  it('omits aoe for a single-target spell', () => {
    const ember = castableFor(['spell.ember-bolt']).find((s) => s.spellId === 'spell.ember-bolt');
    expect(ember).toBeDefined();
    expect(ember && 'aoe' in ember).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run build --workspace @woven-deep/engine && npx vitest run packages/engine/test/castable-spell-aoe.test.ts`
Expected: FAIL — `fireball?.aoe` is `undefined` (field not yet added / populated).

- [ ] **Step 3: Add the field to `CastableSpellView`**

In `packages/engine/src/projection.ts`, extend the interface (currently lines 437-443):

```typescript
export interface CastableSpellView {
  readonly spellId: OpaqueId;
  readonly name: string;
  readonly weaveCost: number;
  readonly range: number;
  readonly targetingId: string;
  readonly aoe?: Readonly<{ shape: 'burst' | 'line' | 'cone'; radius: number }>;
}
```

- [ ] **Step 4: Populate it in `projectHeroView`**

In `projectHeroView` (lines 730-736), change the `.map((entry) => ({ … }))` to spread `aoe` conditionally (keeps `exactOptionalPropertyTypes` happy — absent, not `undefined`):

```typescript
    .map((entry) => ({
      spellId: entry.id,
      name: entry.name,
      weaveCost: entry.weaveCost,
      range: entry.range,
      targetingId: entry.targetingId,
      ...(entry.aoe === undefined
        ? {}
        : { aoe: { shape: entry.aoe.shape, radius: entry.aoe.radius } }),
    }));
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run build --workspace @woven-deep/engine && npx vitest run packages/engine/test/castable-spell-aoe.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Confirm demos + magic demo unaffected**

Run: `npm run magic:demo && npx vitest run packages/engine/test/magic-demo.test.ts`
Expected: both exit 0 / PASS (projection field is additive; no transcript change).

- [ ] **Step 7: Rebuild session-core so the client sees the field**

Run: `npm run build --workspace @woven-deep/session-core`
Expected: exit 0 (`CastableSpellView` re-export now carries `aoe`).

- [ ] **Step 8: Commit**

```bash
git add packages/engine/src/projection.ts packages/engine/test/castable-spell-aoe.test.ts
git commit -m "feat(engine): expose spell aoe descriptor on CastableSpellView"
```

---

## Task 3: Client mirror computes real AoE footprints via shared geometry

**Files:**
- Modify: `apps/web/src/session/spell-targeting.ts` (add `affectedFootprint`; update stale comments at lines 24-27, 115-122, 143)
- Test: `apps/web/test/spell-targeting.test.ts` (add AoE + parity cases)

**Interfaces:**
- Consumes: `burstCells`/`lineCells`/`coneCells` from `@woven-deep/engine`; `CastableSpellView` (now with `aoe`); `ObservableFloorProjection`, `Point`, `tileDefinition` from `@woven-deep/engine`.
- Produces:
  - `function affectedFootprint(input: Readonly<{ spell: Pick<CastableSpellView, 'range' | 'targetingId' | 'aoe'>; floor: ObservableFloorProjection; hero: Pick<HeroView, 'x' | 'y'>; aim: Point }>): readonly Point[]` — the cells a cast at `aim` would affect right now (advisory). Returns `[]` when the aim is out of range or not visible; returns `[aim]` for single-target `target.self`/`target.actor`/`target.cell`; returns the shared-geometry cell set for `target.burst`/`target.line`/`target.cone` when `spell.aoe` is present.
  - `function aimInRange(hero: Pick<HeroView, 'x' | 'y'>, aim: Point, range: number): boolean` — Chebyshev range check, exported for the free-cursor mode (T4).

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/test/spell-targeting.test.ts` (the `floorFixture`/`HERO` helpers already exist; add a bigger open-grid helper and new describes):

```typescript
import { affectedFootprint, aimInRange } from '../src/session/spell-targeting.js';

/** A `w x h` all-floor, all-visible projection with optional walls (tileId 0), origin (0,0). */
function openProjection(
  w: number,
  h: number,
  walls: readonly [number, number][] = [],
): ObservableFloorProjection {
  const wallSet = new Set(walls.map(([x, y]) => `${x},${y}`));
  const cells: ObservableFloorProjection['cells'][number][] = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const isWall = wallSet.has(`${x},${y}`);
      cells.push({
        index: y * w + x,
        x,
        y,
        knowledge: 'visible',
        tileId: isWall ? 0 : 1,
        token: isWall ? 'terrain.wall' : 'terrain.floor',
        intensity: 255,
      });
    }
  }
  return { floorId: 'floor.test', depth: 1, town: false, width: w, height: h, cells };
}

function footprintKeys(cells: readonly Point[]): Set<string> {
  return new Set(cells.map((c) => `${c.x},${c.y}`));
}

describe('affectedFootprint', () => {
  it('burst returns the Chebyshev disc around a visible, in-range aim', () => {
    const cells = affectedFootprint({
      spell: { range: 6, targetingId: 'target.burst', aoe: { shape: 'burst', radius: 1 } },
      floor: openProjection(9, 9),
      hero: { x: 2, y: 2 },
      aim: { x: 5, y: 5 },
    });
    expect(footprintKeys(cells)).toEqual(
      new Set(['4,4', '5,4', '6,4', '4,5', '5,5', '6,5', '4,6', '5,6', '6,6']),
    );
  });

  it('returns [] when the aim is out of range', () => {
    const cells = affectedFootprint({
      spell: { range: 2, targetingId: 'target.burst', aoe: { shape: 'burst', radius: 1 } },
      floor: openProjection(9, 9),
      hero: { x: 0, y: 0 },
      aim: { x: 8, y: 8 },
    });
    expect(cells).toEqual([]);
  });

  it('single-target self yields just the aim cell', () => {
    const cells = affectedFootprint({
      spell: { range: 0, targetingId: 'target.self' },
      floor: openProjection(5, 5),
      hero: { x: 2, y: 2 },
      aim: { x: 2, y: 2 },
    });
    expect(cells).toEqual([{ x: 2, y: 2 }]);
  });
});

describe('geometry parity: engine tiles vs full-visibility projection', () => {
  it('burst/line/cone match validateTarget cells on the same map', async () => {
    const { validateTarget, createDemoRun } = await import('@woven-deep/engine');
    const width = 11;
    const height = 5;
    const walls: [number, number][] = [[6, 2]];
    // Engine input: raw tiles (1 floor, 0 wall).
    const run = createDemoRun();
    const tiles = Array(width * height).fill(1);
    for (const [x, y] of walls) tiles[y * width + x] = 0;
    const floor = { ...run.floors[0]!, width, height, tiles };
    const source = { ...run.actors[0]!, x: 2, y: 2, floorId: floor.floorId };
    const engineInput = {
      sourceActor: source,
      targetActorId: null,
      floor,
      actors: [source],
      visibilityWords: Array(Math.ceil((width * height) / 32)).fill(0xffffffff),
      illumination: { intensity: Array(width * height).fill(255) },
      range: 6,
    } as const;
    const projection = openProjection(width, height, walls);

    for (const shape of ['burst', 'line', 'cone'] as const) {
      const targetingId = `target.${shape}` as const;
      const aoe = { shape, radius: 3 } as const;
      const aim = { x: 8, y: 2 };
      const engine = validateTarget({ ...engineInput, targetingId, target: aim, aoe });
      expect(engine.ok).toBe(true);
      const client = affectedFootprint({
        spell: { range: 6, targetingId, aoe },
        floor: projection,
        hero: { x: 2, y: 2 },
        aim,
      });
      if (!engine.ok) return;
      expect(footprintKeys(client)).toEqual(footprintKeys(engine.cells));
    }
  });
});

describe('aimInRange', () => {
  it('is Chebyshev range from the hero', () => {
    expect(aimInRange({ x: 0, y: 0 }, { x: 3, y: 2 }, 3)).toBe(true);
    expect(aimInRange({ x: 0, y: 0 }, { x: 4, y: 0 }, 3)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run build --workspace @woven-deep/engine && npm run build --workspace @woven-deep/session-core && npx vitest run apps/web/test/spell-targeting.test.ts`
Expected: FAIL — `affectedFootprint`/`aimInRange` are not exported.

- [ ] **Step 3: Implement `affectedFootprint` + `aimInRange`**

In `apps/web/src/session/spell-targeting.ts`, extend the top import to add the shared geometry:

```typescript
import {
  burstCells,
  coneCells,
  lineCells,
  tileDefinition,
  type ObservableFloorProjection,
  type OpaqueId,
  type Point,
} from '@woven-deep/engine';
```

Update the stale doc comment on `TargetCandidate.affected` (lines 24-27) to:

```typescript
/** One valid cast target: the cell to pass as `CastCommand.target`, the actor occupying it (when
 * the spell is `target.actor`), and the cells the cast would actually affect. For an AoE spell
 * (`target.burst`/`line`/`cone`) `affected` is the shared-geometry footprint at that aim cell (fed
 * fogged-projection callbacks); for a single-target spell it is just `[cell]`. */
```

Then add these exports (after the existing `hasLineOfSight`/`inRangeVisibleAndClear` helpers, before `computeValidTargets`):

```typescript
/** Whether `aim` is within Chebyshev `range` of the hero. The free-cursor targeting mode clamps to
 * this; the shared geometry itself does not range-check the aim cell (burst is anchored AT the aim). */
export function aimInRange(hero: Pick<Point, 'x' | 'y'>, aim: Point, range: number): boolean {
  return chebyshev(aim, hero) <= range;
}

/** Opacity for the client's fogged projection, matching the engine callback contract: an
 * out-of-bounds or never-observed (`tileId` undefined) cell reads as OPAQUE, so `lineCells` stops
 * conservatively at the fog edge (advisory: it can only under-reach, never over-reach). */
function projectionIsOpaque(floor: ObservableFloorProjection, point: Point): boolean {
  const cell = cellAt(floor, point.x, point.y);
  if (cell === undefined || cell.tileId === undefined) return true;
  return tileDefinition(cell.tileId).opaque;
}

function projectionInBounds(floor: ObservableFloorProjection, point: Point): boolean {
  return cellAt(floor, point.x, point.y) !== undefined;
}

/**
 * The cells a cast of `spell` aimed at `aim` would affect right now, from what the projection
 * exposes. Advisory only (the engine re-validates on dispatch). Single-target ids return `[aim]`
 * when the aim is a legal single-target cell (in range, visible, clear LoS), else `[]`. AoE ids
 * return the shared-geometry footprint when the aim is in range + visible, else `[]`.
 */
export function affectedFootprint(
  input: Readonly<{
    spell: Pick<CastableSpellView, 'range' | 'targetingId' | 'aoe'>;
    floor: ObservableFloorProjection;
    hero: Pick<HeroView, 'x' | 'y'>;
    aim: Point;
  }>,
): readonly Point[] {
  const { spell, floor, hero, aim } = input;
  const origin: Point = { x: hero.x, y: hero.y };

  if (spell.targetingId === 'target.self') {
    return [{ x: origin.x, y: origin.y }];
  }

  if (
    spell.aoe !== undefined &&
    (spell.targetingId === 'target.burst' ||
      spell.targetingId === 'target.line' ||
      spell.targetingId === 'target.cone')
  ) {
    if (!aimInRange(origin, aim, spell.range)) return [];
    if (!cellIsVisible(floor, aim)) return [];
    if (spell.targetingId === 'target.burst') {
      return burstCells(aim, spell.aoe.radius, { inBounds: (p) => projectionInBounds(floor, p) });
    }
    if (spell.targetingId === 'target.line') {
      return lineCells(origin, aim, spell.aoe.radius, {
        isOpaque: (p) => projectionIsOpaque(floor, p),
      });
    }
    return coneCells(origin, aim, spell.aoe.radius, {
      inBounds: (p) => projectionInBounds(floor, p),
    });
  }

  // Single-target actor/cell: the aim itself is the footprint, when it's a legal target cell.
  return inRangeVisibleAndClear({ floor, hero: origin, range: spell.range, point: aim })
    ? [{ x: aim.x, y: aim.y }]
    : [];
}
```

Also update the `computeValidTargets` doc comment (lines 115-122) and the trailing `return { candidates: [] };` comment (line 143) to note that AoE spells are now aimed via the free cursor (`affectedFootprint`) rather than enumerated candidates — `computeValidTargets` stays the single-target candidate source used for actor-snapping:

```typescript
  // Burst/line/cone are aimed with the free cursor via `affectedFootprint`, not enumerated here:
  // there is no finite candidate set to cycle for an area spell. `useSpellTargeting` drives the
  // reticle directly for those.
  return { candidates: [] };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run build --workspace @woven-deep/engine && npm run build --workspace @woven-deep/session-core && npx vitest run apps/web/test/spell-targeting.test.ts`
Expected: PASS (all existing single-target cases + new burst/line/cone footprint + parity cases).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/session/spell-targeting.ts apps/web/test/spell-targeting.test.ts
git commit -m "feat(web): compute real AoE footprints via shared geometry"
```

---

## Task 4: Free-cursor targeting mode with live footprint

**Files:**
- Modify: `apps/web/src/ui/hooks/useSpellTargeting.ts` (add free reticle, footprint, affected actors)
- Modify: `apps/web/src/ui/TargetingOverlay.tsx` (render footprint + affected-actor highlight)
- Modify: `apps/web/src/ui/PlayScreen.tsx` (feed hover/affected actors; unchanged click/context-menu wiring)
- Test: `apps/web/test/spell-targeting-play-screen.test.tsx` (AoE cursor + confirm)

**Interfaces:**
- Consumes: `affectedFootprint`, `aimInRange`, `computeValidTargets`, `TargetCandidate` (`spell-targeting.ts`); `actorsOf`, `heroOf` (`projection-view.ts`).
- Produces (new/changed `UseSpellTargetingResult` members):
  - `readonly reticle: Point | null` — now free-movable for AoE, candidate-snapped for single-target.
  - `readonly affectedCells: ReadonlySet<string>` — footprint `"x,y"` keys at the reticle (drives the overlay's valid highlight).
  - `readonly affectedActorIds: ReadonlySet<string>` — actor ids standing on footprint cells.
  - `readonly canConfirm: boolean` — reticle in range and non-empty footprint OR (for AoE) in range (empty-ground AoE is confirmable).
  - `readonly moveReticleBy: (dx: number, dy: number) => void` — free move, clamped to range + floor bounds.
  - `readonly setReticle: (point: Point) => void` — mouse hover sets the reticle (clamped to range).
  - unchanged: `activeSpellId`, `begin`, `cancel`, `confirmAt`, `confirmReticle`, `validCells` (now = `affectedCells`).
  - The `moveReticle(step)` candidate-cycling stays but only applies when the active spell is single-target.

**Design:** the hook holds a `reticle` state (a `Point | null`). On `begin`, the reticle initializes to the hero cell for AoE, or the first candidate for single-target. For single-target spells, arrows cycle candidates (existing behavior) and confirm snaps to actors. For AoE spells, arrows move the reticle freely (clamped), mouse hover sets it, and confirm dispatches at the reticle when `aimInRange`.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/test/spell-targeting-play-screen.test.tsx` a new describe. The file already builds a `PlayScreen` with a projection carrying a caster hero; add a burst spell and drive the keyboard reticle. (Mirror the existing helpers `hostile`, projection cloning, and the `withUiProviders` harness already imported at top; reuse the file's existing `renderPlay(projection)` helper — read the file for its exact name and signature before editing, and match it.)

```typescript
const FIREBALL_SPELL = {
  spellId: 'spell.fireball',
  name: 'Fireball',
  weaveCost: 6,
  range: 6,
  targetingId: 'target.burst',
  aoe: { shape: 'burst', radius: 2 },
} as const;

describe('AoE free-cursor targeting', () => {
  it('renders a live footprint under the reticle and confirms a cast at the reticle cell', async () => {
    const dispatched: PlayerIntent[] = [];
    // Build a projection whose hero knows Fireball and has enough Weave (read the file's existing
    // projection-builder helper; set hero.castableSpells = [FIREBALL_SPELL], hero.weave = 20).
    const projection = withCastableSpells(baseProjection, [FIREBALL_SPELL], 20);
    const session = fakeSession(projection, (intent) => dispatched.push(intent));
    render(withUiProviders(<PlayScreen session={session} pack={pack} />));

    // Enter targeting via the Spells panel button.
    await userEvent.click(screen.getByRole('button', { name: /Fireball/ }));

    // A footprint (targeting-cell-valid) is present around the reticle.
    expect(screen.getAllByTestId('targeting-valid').length).toBeGreaterThan(0);

    // Move the reticle east twice, then confirm with Enter.
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'Enter' });

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({ type: 'cast', spellId: 'spell.fireball' });
    const target = (dispatched[0] as { target: Point }).target;
    expect(target.x).toBe(projectionHeroX + 2); // moved two cells east of the hero
  });

  it('cannot confirm past range', async () => {
    const dispatched: PlayerIntent[] = [];
    const projection = withCastableSpells(baseProjection, [FIREBALL_SPELL], 20);
    const session = fakeSession(projection, (intent) => dispatched.push(intent));
    render(withUiProviders(<PlayScreen session={session} pack={pack} />));
    await userEvent.click(screen.getByRole('button', { name: /Fireball/ }));
    // Hammer the reticle far past range (range is 6); confirm.
    for (let i = 0; i < 20; i += 1) fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(dispatched).toHaveLength(0); // clamped to range, but the test drove it to the clamp edge
  });
});
```

Note: `withCastableSpells`, `fakeSession`, `projectionHeroX`, and `baseProjection` — reuse or add small local helpers modeled on the file's existing setup (read the current file top for `baseProjection` and the session fake it already uses; the second test asserts range-clamping keeps the reticle confirmable, so it does dispatch — adjust the assertion to `toHaveLength(1)` with `target` at the clamped range edge if the file's helper always keeps a valid in-range reticle. The load-bearing behavior is: the reticle never leaves range.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run build --workspace @woven-deep/engine && npm run build --workspace @woven-deep/session-core && npx vitest run apps/web/test/spell-targeting-play-screen.test.tsx`
Expected: FAIL — no footprint cells render for AoE (the hook still returns `[]` candidates for burst and the overlay has no footprint), so `getAllByTestId('targeting-valid')` throws.

- [ ] **Step 3: Rewrite `useSpellTargeting` for both modes**

Replace `apps/web/src/ui/hooks/useSpellTargeting.ts` body. Key changes (full file):

```typescript
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Point } from '@woven-deep/engine';
import type { SessionSnapshot } from '../../session/guest-session.js';
import { actorsOf, chebyshev, heroOf } from '../../session/projection-view.js';
import type { RunSession } from '../../session/run-session.js';
import {
  affectedFootprint,
  aimInRange,
  computeValidTargets,
  type TargetCandidate,
} from '../../session/spell-targeting.js';

function cellKey(point: Point): string {
  return `${point.x},${point.y}`;
}

export interface UseSpellTargetingResult {
  readonly activeSpellId: string | null;
  readonly candidates: readonly TargetCandidate[];
  readonly validCells: ReadonlySet<string>;
  readonly affectedActorIds: ReadonlySet<string>;
  readonly reticle: Point | null;
  readonly canConfirm: boolean;
  readonly begin: (spellId: string) => void;
  readonly cancel: () => void;
  readonly confirmAt: (point: Point) => boolean;
  readonly confirmReticle: () => boolean;
  readonly moveReticle: (step: 1 | -1) => void;
  readonly moveReticleBy: (dx: number, dy: number) => void;
  readonly setReticle: (point: Point) => void;
}

export function useSpellTargeting(
  session: RunSession,
  snapshot: SessionSnapshot,
): UseSpellTargetingResult {
  const { projection } = snapshot;
  const [activeSpellId, setActiveSpellId] = useState<string | null>(null);
  const [reticleIndex, setReticleIndex] = useState(0);
  const [freeReticle, setFreeReticle] = useState<Point | null>(null);

  const hero = heroOf(projection);
  const spell = activeSpellId
    ? (hero.castableSpells ?? []).find((candidate) => candidate.spellId === activeSpellId)
    : undefined;
  const isAoe =
    spell !== undefined &&
    (spell.targetingId === 'target.burst' ||
      spell.targetingId === 'target.line' ||
      spell.targetingId === 'target.cone');

  const candidates = useMemo<readonly TargetCandidate[]>(() => {
    if (!spell || isAoe) return [];
    return computeValidTargets({
      spell,
      floor: projection.floor,
      hero,
      actors: actorsOf(projection),
    }).candidates;
  }, [spell, isAoe, projection, hero]);

  // Single-target reticle: the arrow-cycled candidate. AoE reticle: the free cell (clamped).
  const reticle: Point | null = isAoe
    ? freeReticle
    : candidates.length === 0
      ? null
      : candidates[((reticleIndex % candidates.length) + candidates.length) % candidates.length]!
          .cell;

  const affected = useMemo<readonly Point[]>(() => {
    if (!spell || reticle === null) return [];
    return affectedFootprint({ spell, floor: projection.floor, hero, aim: reticle });
  }, [spell, projection.floor, hero, reticle]);

  const validCells = useMemo(() => new Set(affected.map(cellKey)), [affected]);

  const affectedActorIds = useMemo(() => {
    const ids = new Set<string>();
    for (const actor of actorsOf(projection)) {
      if (validCells.has(cellKey(actor))) ids.add(actor.actorId);
    }
    return ids;
  }, [projection, validCells]);

  const canConfirm =
    reticle !== null && (isAoe ? aimInRange(hero, reticle, spell?.range ?? 0) : validCells.size > 0);

  const begin = useCallback(
    (spellId: string): void => {
      setActiveSpellId(spellId);
      setReticleIndex(0);
      const next = (hero.castableSpells ?? []).find((c) => c.spellId === spellId);
      const nextIsAoe =
        next !== undefined &&
        (next.targetingId === 'target.burst' ||
          next.targetingId === 'target.line' ||
          next.targetingId === 'target.cone');
      setFreeReticle(nextIsAoe ? { x: hero.x, y: hero.y } : null);
    },
    [hero],
  );

  const cancel = useCallback((): void => {
    setActiveSpellId(null);
    setFreeReticle(null);
  }, []);

  const dispatchCast = useCallback(
    (point: Point): void => {
      if (!activeSpellId) return;
      session.dispatch({ type: 'cast', spellId: activeSpellId, target: point });
      setActiveSpellId(null);
      setFreeReticle(null);
    },
    [activeSpellId, session],
  );

  const confirmAt = useCallback(
    (point: Point): boolean => {
      if (!activeSpellId) return false;
      if (isAoe) {
        if (!aimInRange(hero, point, spell?.range ?? 0)) return false;
        dispatchCast(point);
        return true;
      }
      if (!validCells.has(cellKey(point))) return false;
      dispatchCast(point);
      return true;
    },
    [activeSpellId, isAoe, hero, spell, dispatchCast, validCells],
  );

  const confirmReticle = useCallback((): boolean => {
    if (!activeSpellId || reticle === null || !canConfirm) return false;
    dispatchCast(reticle);
    return true;
  }, [activeSpellId, reticle, canConfirm, dispatchCast]);

  const moveReticle = useCallback((step: 1 | -1): void => {
    setReticleIndex((index) => index + step);
  }, []);

  const moveReticleBy = useCallback(
    (dx: number, dy: number): void => {
      setFreeReticle((current) => {
        const base = current ?? { x: hero.x, y: hero.y };
        const next = { x: base.x + dx, y: base.y + dy };
        const range = spell?.range ?? 0;
        // Clamp to Chebyshev range and to floor bounds.
        if (chebyshev(next, hero) > range) return current;
        if (
          next.x < 0 ||
          next.y < 0 ||
          next.x >= projection.floor.width ||
          next.y >= projection.floor.height
        )
          return current;
        return next;
      });
    },
    [hero, spell, projection.floor.width, projection.floor.height],
  );

  const setReticle = useCallback(
    (point: Point): void => {
      if (!isAoe) return;
      if (chebyshev(point, hero) > (spell?.range ?? 0)) return;
      setFreeReticle(point);
    },
    [isAoe, hero, spell],
  );

  useEffect(() => {
    if (!activeSpellId) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      switch (event.key) {
        case 'Escape':
          cancel();
          return;
        case 'Enter':
          confirmReticle();
          return;
        case 'ArrowRight':
          isAoe ? moveReticleBy(1, 0) : moveReticle(1);
          return;
        case 'ArrowLeft':
          isAoe ? moveReticleBy(-1, 0) : moveReticle(-1);
          return;
        case 'ArrowDown':
          isAoe ? moveReticleBy(0, 1) : moveReticle(1);
          return;
        case 'ArrowUp':
          isAoe ? moveReticleBy(0, -1) : moveReticle(-1);
          return;
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeSpellId, isAoe, cancel, confirmReticle, moveReticle, moveReticleBy]);

  return {
    activeSpellId,
    candidates,
    validCells,
    affectedActorIds,
    reticle,
    canConfirm,
    begin,
    cancel,
    confirmAt,
    confirmReticle,
    moveReticle,
    moveReticleBy,
    setReticle,
  };
}
```

- [ ] **Step 4: Render the affected-actor highlight in `TargetingOverlay`**

In `apps/web/src/ui/TargetingOverlay.tsx`, add an `affectedActorPositions` prop and a distinct class on those cells. Add to `TargetingOverlayProps`:

```typescript
  /** `"x,y"` keys of cells where an affected actor stands — highlighted distinctly so the player
   * sees who gets hit. */
  readonly affectedActorCells: ReadonlySet<string>;
```

In the valid/highlighted branch (lines 74-89), extend the className array to add `targeting-cell-affected-actor` when `affectedActorCells.has(key)`:

```typescript
          className={[
            'targeting-cell',
            valid ? 'targeting-cell-valid' : '',
            isHighlighted ? 'targeting-cell-reticle' : '',
            affectedActorCells.has(key) ? 'targeting-cell-affected-actor' : '',
          ]
            .filter(Boolean)
            .join(' ')}
```

Add a `.targeting-cell-affected-actor` rule to `apps/web/src/styles.css` (near the existing `.targeting-cell-valid` rule — grep `targeting-cell-valid` to find it) giving it a distinct outline/tint, e.g.:

```css
.targeting-cell-affected-actor {
  box-shadow: inset 0 0 0 2px var(--color-danger, #e05a5a);
}
```

- [ ] **Step 5: Wire the new props through `PlayScreen`**

In `apps/web/src/ui/PlayScreen.tsx`, compute the affected-actor cells from `targeting.affectedActorIds` + the projection actors, and pass `affectedActorCells` to `TargetingOverlay` (lines 262-270). Also feed mouse hover into the free reticle. Add near the `targetingHighlight` computation (lines 184-190):

```typescript
  const affectedActorCells = useMemo(() => {
    const keys = new Set<string>();
    for (const actor of actorsOf(projection)) {
      if (targeting.affectedActorIds.has(actor.actorId)) keys.add(`${actor.x},${actor.y}`);
    }
    return keys;
  }, [projection, targeting.affectedActorIds]);
```

(Add `useMemo` to the React import and `actorsOf` to the `projection-view` import.) In the cursor-hover effect, when targeting is active call `targeting.setReticle({ x: cursor.x, y: cursor.y })` so hover drives the AoE reticle — add to the existing hover handling: where `cursor` is derived (line 173), add an effect:

```typescript
  useEffect(() => {
    if (targeting.activeSpellId && cursor) targeting.setReticle({ x: cursor.x, y: cursor.y });
  }, [targeting, cursor]);
```

Pass the prop to the overlay:

```typescript
            {targeting.activeSpellId ? (
              <TargetingOverlay
                floor={projection.floor}
                camera={camera}
                viewport={viewport}
                cellPx={cellSize}
                validCells={targeting.validCells}
                highlighted={targetingHighlight}
                affectedActorCells={affectedActorCells}
              />
            ) : (
```

The existing `handleMapClick`/`handleMapContextMenu` already route to `targeting.confirmAt`/`targeting.cancel` unchanged — `confirmAt` now range-checks AoE aims internally.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run build --workspace @woven-deep/engine && npm run build --workspace @woven-deep/session-core && npx vitest run apps/web/test/spell-targeting-play-screen.test.tsx apps/web/src/ui/panels/SpellsPanel.test.tsx`
Expected: PASS (new AoE cursor tests + unchanged single-target tests).

- [ ] **Step 7: Typecheck the web app**

Run: `npm run build --workspace @woven-deep/web`
Expected: exit 0 (strict TS clean — no `undefined` in optional literals; `useMemo`/`actorsOf`/`useEffect` imported).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/ui/hooks/useSpellTargeting.ts apps/web/src/ui/TargetingOverlay.tsx apps/web/src/ui/PlayScreen.tsx apps/web/src/styles.css apps/web/test/spell-targeting-play-screen.test.tsx
git commit -m "feat(web): free-cursor AoE targeting with live footprint"
```

---

## Task 5: Optional target on the item-use intent + command builder

**Files:**
- Modify: `packages/session-core/src/intents.ts:31-35` (`backpack` intent)
- Modify: `packages/session-core/src/command-builder.ts:216-243` (`buildBackpackIntent`) and its caller `:464-471`
- Test: `packages/session-core/test/command-builder.test.ts` (targeted-use cases; read the file first for its existing harness — it builds a projection and asserts the built command)

**Interfaces:**
- Consumes: existing `UseItemCommand { type: 'use-item'; itemId; target: Point | null }` (`packages/engine/src/commands-model.ts:39-43`).
- Produces:
  - `PlayerIntent` `backpack` variant gains `readonly target?: { readonly x: number; readonly y: number }`.
  - `buildBackpackIntent` accepts an optional `target?: Point | undefined` and threads it into the `use-item` command's existing `target` field (defaulting to `null` when absent — non-targeted uses unchanged).

- [ ] **Step 1: Write the failing test**

Add to `packages/session-core/test/command-builder.test.ts` (match the file's existing setup — read it for the `buildCommand`/projection helper names; the sketch below assumes a `build(intent, projection)` helper returning the `BuiltIntent`):

```typescript
describe('backpack use with target', () => {
  it('threads the target into the use-item command', () => {
    const projection = projectionWithBackpackItem('item.ember-scroll'); // existing helper style
    const built = buildCommand(
      { type: 'backpack', action: 'use', itemId: 'item.ember-scroll.1', target: { x: 4, y: 2 } },
      projection,
    );
    expect(built.kind).toBe('command');
    if (built.kind !== 'command') return;
    expect(built.command).toMatchObject({
      type: 'use-item',
      itemId: 'item.ember-scroll.1',
      target: { x: 4, y: 2 },
    });
  });

  it('defaults target to null when omitted', () => {
    const projection = projectionWithBackpackItem('item.travel-ration');
    const built = buildCommand(
      { type: 'backpack', action: 'use', itemId: 'item.travel-ration.1' },
      projection,
    );
    if (built.kind !== 'command') throw new Error('expected command');
    expect(built.command).toMatchObject({ type: 'use-item', target: null });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run build --workspace @woven-deep/engine && npx vitest run packages/session-core/test/command-builder.test.ts -t "use with target"`
Expected: FAIL — the built command's `target` is always `null` (intent carries no target; TS also errors on the unknown `target` key in the intent literal).

- [ ] **Step 3: Add the optional target to the intent**

In `packages/session-core/src/intents.ts`, extend the `backpack` variant (lines 31-35):

```typescript
  | {
      readonly type: 'backpack';
      readonly action: 'equip' | 'unequip' | 'use' | 'drop' | 'toggle-light';
      readonly itemId: OpaqueId;
      // Only meaningful for `action: 'use'` on an item whose spell is targeted (actor/burst/line/
      // cone) — the aim cell chosen in targeting mode. Absent for non-targeted uses; the command
      // builder passes `null` to the engine's `use-item` command then. Import `Point` for this.
      readonly target?: { readonly x: number; readonly y: number };
    }
```

Add `Point` to the import at the top if not already present (the file imports `Direction, OpaqueId` from `@woven-deep/engine`; add `Point`). Use the inline object type as shown to keep parity with the `cast` intent's inline `{ x; y }`.

- [ ] **Step 4: Thread it through `buildBackpackIntent`**

In `packages/session-core/src/command-builder.ts`, add `target` to the input and use it in the `use` branch (lines 216-243):

```typescript
function buildBackpackIntent(
  input: Readonly<{
    projection: GameplayProjection;
    commandId: OpaqueId;
    expectedRevision: number;
    action: 'equip' | 'unequip' | 'use' | 'drop' | 'toggle-light';
    itemId: OpaqueId;
    target?: Point | undefined;
    pack?: CompiledContentPack | undefined;
  }>,
): BuiltIntent {
  const { projection, commandId, expectedRevision, action, itemId, target, pack } = input;
  // …unchanged up to the `use` branch…
  if (action === 'use') {
    return {
      kind: 'command',
      command: { type: 'use-item', itemId, target: target ?? null, commandId, expectedRevision },
    };
  }
```

Add `Point` to the file's `@woven-deep/engine` import if not already imported. Update the caller (lines 464-471) to pass `target` conditionally (keep `exactOptionalPropertyTypes` — spread only when present):

```typescript
  return buildBackpackIntent({
    projection,
    commandId,
    expectedRevision,
    action: intent.action,
    itemId: intent.itemId,
    ...(intent.target === undefined ? {} : { target: intent.target }),
    pack,
  });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run build --workspace @woven-deep/engine && npx vitest run packages/session-core/test/command-builder.test.ts`
Expected: PASS.

- [ ] **Step 6: Rebuild session-core (so the web app sees the widened intent)**

Run: `npm run build --workspace @woven-deep/session-core`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/session-core/src/intents.ts packages/session-core/src/command-builder.ts packages/session-core/test/command-builder.test.ts
git commit -m "feat(session-core): optional aim target on item-use intent"
```

---

## Task 6: Route targeted scrolls through the shared targeting mode

**Files:**
- Create: `apps/web/src/session/scroll-targeting.ts` (+ `apps/web/test/scroll-targeting.test.ts`)
- Modify: `apps/web/src/ui/hooks/useSpellTargeting.ts` (generalize dispatch to `cast` OR `use`+target)
- Modify: `apps/web/src/ui/overlays/InventoryOverlay.tsx` (launch targeting for a targeted scroll)
- Test: `apps/web/src/ui/overlays/InventoryOverlay.test.tsx` (targeted-vs-fire-and-forget)

**Interfaces:**
- Consumes: `CompiledContentPack`, `itemById`/`spellEntries` (`@woven-deep/session-core` pack-queries — verify export names), `OwnedItemView`.
- Produces:
  - `function scrollAimSpell(pack: CompiledContentPack, contentId: string | undefined): Pick<CastableSpellView, 'spellId' | 'name' | 'range' | 'targetingId' | 'aoe'> | null` — given an item's `contentId`, returns the aim-requiring spell descriptor when the item has a `spellId` whose spell targeting is `target.actor`/`target.burst`/`target.line`/`target.cone`; `null` for self-target scrolls, tomes (learn effect, no aim), and non-spell items.
  - `useSpellTargeting` `begin` is generalized to `begin(request: { kind: 'spell'; spellId: string } | { kind: 'scroll'; itemId: string; spell: … })` — OR, to minimize churn, add a second entry `beginScroll(itemId, spell)` and an internal `pending` discriminated union deciding the dispatch. This plan uses **`beginScroll`** to keep the existing `begin(spellId)` callers (SpellsPanel, CommandPalette) untouched.

- [ ] **Step 1: Write the failing helper test**

Create `apps/web/test/scroll-targeting.test.ts`:

```typescript
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import type { CompiledContentPack } from '@woven-deep/content';
import { scrollAimSpell } from '../src/session/scroll-targeting.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

describe('scrollAimSpell', () => {
  it('returns the aimed spell for an offensive scroll (ember bolt = target.actor)', () => {
    const spell = scrollAimSpell(pack, 'item.ember-scroll');
    expect(spell?.spellId).toBe('spell.ember-bolt');
    expect(spell?.targetingId).toBe('target.actor');
  });

  it('returns the AoE spell for a burst scroll (cinder breath / arc lance)', () => {
    const spell = scrollAimSpell(pack, 'item.cinder-breath-scroll');
    expect(spell?.targetingId).toMatch(/^target\.(burst|line|cone)$/);
    expect(spell?.aoe).toBeDefined();
  });

  it('returns null for a tome (learn, no aim)', () => {
    expect(scrollAimSpell(pack, 'item.fireball-tome')).toBeNull();
  });

  it('returns null for a non-spell item', () => {
    expect(scrollAimSpell(pack, 'item.travel-ration')).toBeNull();
  });

  it('returns null for undefined content id (unidentified item)', () => {
    expect(scrollAimSpell(pack, undefined)).toBeNull();
  });
});
```

Before implementing, confirm the exact content ids (`item.cinder-breath-scroll` etc.) and that a tome's item entry has NO `spellId` field that maps to an aimed spell (tomes carry `effect.spell.learn`, not a directly-cast `spellId`) — read `content/items/*-scroll.yaml` vs `content/items/*-tome.yaml`. `item.ember-scroll.yaml` confirms `spellId: spell.ember-bolt` on a scroll. Adjust ids in the test if a name differs.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run apps/web/test/scroll-targeting.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `scroll-targeting.ts`**

Create `apps/web/src/session/scroll-targeting.ts`:

```typescript
import type { CompiledContentPack } from '@woven-deep/content';
import { itemById, spellEntries } from '@woven-deep/session-core';
import type { CastableSpellView } from './projection-view.js';

const AIMED_TARGETING = new Set([
  'target.actor',
  'target.burst',
  'target.line',
  'target.cone',
]);

/**
 * The aim-requiring spell an item casts when used, or `null` when using it needs no aim step.
 * A scroll carries a `spellId`; if that spell targets an actor or an area, using the scroll opens
 * the same free-cursor targeting mode as casting. Self-target scrolls, potions, food, and tomes
 * (which LEARN a spell rather than cast it) return `null` and stay fire-and-forget.
 */
export function scrollAimSpell(
  pack: CompiledContentPack,
  contentId: string | undefined,
): Pick<CastableSpellView, 'spellId' | 'name' | 'range' | 'targetingId' | 'aoe'> | null {
  if (contentId === undefined) return null;
  const item = itemById(pack, contentId);
  const spellId = item?.spellId;
  if (typeof spellId !== 'string') return null;
  const spell = spellEntries(pack).find((entry) => entry.id === spellId);
  if (!spell || !AIMED_TARGETING.has(spell.targetingId)) return null;
  return {
    spellId: spell.id,
    name: spell.name,
    range: spell.range,
    targetingId: spell.targetingId,
    ...(spell.aoe === undefined
      ? {}
      : { aoe: { shape: spell.aoe.shape, radius: spell.aoe.radius } }),
  };
}
```

Pack-query names confirmed from the real code: `itemById(pack, id)` exists (`packages/session-core/src/pack-queries.ts:76`, returns `ItemContentEntry | undefined`); there is NO `spellById` — resolve via `spellEntries(pack).find((entry) => entry.id === spellId)` (`pack-queries.ts:95`). The compiled item entry surfaces `spellId?: ContentId` (`packages/content/src/model/item.ts:57`), and `content/items/ember-scroll.yaml` sets `spellId: spell.ember-bolt`, so the field is present on scroll items.

- [ ] **Step 4: Run the helper test to verify it passes**

Run: `npm run build --workspace @woven-deep/session-core && npx vitest run apps/web/test/scroll-targeting.test.ts`
Expected: PASS (5 cases).

- [ ] **Step 5: Generalize `useSpellTargeting` to dispatch `cast` OR `use`+target**

In `apps/web/src/ui/hooks/useSpellTargeting.ts`, replace the single `activeSpellId` string state with a `pending` discriminated union while keeping the public `activeSpellId` getter (so `PlayScreen`'s `targeting.activeSpellId !== null` checks stay valid). Add:

```typescript
type TargetingPending =
  | { readonly kind: 'spell'; readonly spellId: string }
  | {
      readonly kind: 'scroll';
      readonly itemId: string;
      readonly spell: Pick<CastableSpellView, 'spellId' | 'name' | 'range' | 'targetingId' | 'aoe'>;
    };
```

- Store `pending: TargetingPending | null` instead of `activeSpellId: string | null`.
- `activeSpellId` in the result becomes `pending === null ? null : pending.kind === 'spell' ? pending.spellId : pending.spell.spellId`.
- The `spell` descriptor is `pending?.kind === 'spell'` → look up in `hero.castableSpells`; `pending?.kind === 'scroll'` → `pending.spell` directly.
- Add `readonly beginScroll: (itemId: string, spell: Pick<CastableSpellView, 'spellId' | 'name' | 'range' | 'targetingId' | 'aoe'>) => void` to the result; it sets `pending = { kind: 'scroll', … }` and initializes the reticle exactly like `begin` (AoE → hero cell, else first candidate / null).
- Rename `dispatchCast(point)` to `dispatchConfirm(point)`: when `pending.kind === 'spell'` dispatch `{ type: 'cast', spellId, target: point }`; when `pending.kind === 'scroll'` dispatch `{ type: 'backpack', action: 'use', itemId: pending.itemId, target: point }`. `confirmAt`/`confirmReticle` call `dispatchConfirm`.

Import `CastableSpellView` type at the top: add `import type { CastableSpellView } from '../../session/projection-view.js';`. Keep `begin(spellId)` intact for the spell path.

- [ ] **Step 6: Launch targeting for a targeted scroll from the inventory**

In `apps/web/src/ui/overlays/InventoryOverlay.tsx`, the `dispatchAction('use')` path (line 110) must, for a scroll whose spell needs aim, instead: close the overlay and enter targeting. Since `InventoryOverlay` reads `useSessionCtx()` and has no overlay-close/targeting handle today, thread two callbacks from `OverlayHost`/`PlayScreen`. Minimal wiring:

- Add optional props to `InventoryOverlay`: `readonly onBeginScrollTargeting?: (itemId: string, spell: …) => void;` and reuse the existing overlay close (the Sheet's `onOpenChange`). Because `InventoryOverlay` currently takes no props, add them and have `OverlayHost.renderBody`'s `inventory` case pass them through — which means `OverlayHost` needs `onBeginScrollTargeting` + `onClose` handles. `onClose` already exists on `OverlayHost`. Add `onBeginScrollTargeting` to `OverlayHostProps` and forward from `PlayScreen` (which owns `targeting.beginScroll` and `onCloseOverlay`).
- In `dispatchAction`, special-case use:

```typescript
  function useItem(entry: MenuEntry): void {
    if (!sessionCtx) return;
    const aimed = scrollAimSpell(pack, entry.item.contentId);
    if (aimed && onBeginScrollTargeting) {
      onCloseOverlay?.();
      onBeginScrollTargeting(entry.item.itemId, aimed);
      return;
    }
    sessionCtx.session.dispatch({ type: 'backpack', action: 'use', itemId: entry.item.itemId });
  }
```

Wire the `u` action key and the detail-pane `onUse` to `useItem(selected)`. Import `scrollAimSpell` and `usePack` (already imported as `pack`).

In `PlayScreen.tsx`, pass to `OverlayHost`:

```typescript
        <OverlayHost
          overlay={overlay}
          onClose={onCloseOverlay}
          onBeginScrollTargeting={(itemId, spell) => targeting.beginScroll(itemId, spell)}
          isPlayActive
          …
```

and thread `onBeginScrollTargeting` through `OverlayHostProps` → `renderBody` → `<InventoryOverlay onBeginScrollTargeting={…} onCloseOverlay={onClose} />`.

- [ ] **Step 7: Write the inventory targeting test**

Add to `apps/web/src/ui/overlays/InventoryOverlay.test.tsx` (match its existing render harness; read the file for how it provides a session with a backpack item):

```typescript
it('using a targeted scroll enters targeting instead of dispatching use immediately', async () => {
  const dispatched: PlayerIntent[] = [];
  const beginScroll = vi.fn();
  // Render with a backpack containing item.ember-scroll and onBeginScrollTargeting=beginScroll.
  renderInventory({ backpack: ['item.ember-scroll'], onBeginScrollTargeting: beginScroll, dispatched });
  await selectItem('Scroll of ember bolt');
  fireEvent.keyDown(getInventoryContainer(), { key: 'u' });
  expect(beginScroll).toHaveBeenCalledWith('item.ember-scroll.1', expect.objectContaining({
    spellId: 'spell.ember-bolt',
  }));
  expect(dispatched.filter((i) => i.type === 'backpack')).toHaveLength(0);
});

it('using a plain consumable dispatches use immediately (fire-and-forget)', async () => {
  const dispatched: PlayerIntent[] = [];
  renderInventory({ backpack: ['item.travel-ration'], dispatched });
  await selectItem('Travel ration');
  fireEvent.keyDown(getInventoryContainer(), { key: 'u' });
  expect(dispatched).toContainEqual(
    expect.objectContaining({ type: 'backpack', action: 'use' }),
  );
});
```

The helper names (`renderInventory`, `selectItem`, `getInventoryContainer`) mirror the file's existing patterns — read the current test for the real setup and adapt.

- [ ] **Step 8: Run the tests**

Run: `npm run build --workspace @woven-deep/session-core && npx vitest run apps/web/test/scroll-targeting.test.ts apps/web/src/ui/overlays/InventoryOverlay.test.tsx`
Expected: PASS.

- [ ] **Step 9: Typecheck the web app**

Run: `npm run build --workspace @woven-deep/web`
Expected: exit 0.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/session/scroll-targeting.ts apps/web/test/scroll-targeting.test.ts apps/web/src/ui/hooks/useSpellTargeting.ts apps/web/src/ui/overlays/InventoryOverlay.tsx apps/web/src/ui/overlays/InventoryOverlay.test.tsx apps/web/src/ui/overlays/OverlayHost.tsx apps/web/src/ui/PlayScreen.tsx
git commit -m "feat(web): aim targeted scrolls through the shared targeting mode"
```

---

## Task 7: Spellbook overlay

**Files:**
- Create: `apps/web/src/session/spell-detail.ts` (+ `apps/web/test/spell-detail.test.ts`)
- Create: `apps/web/src/ui/overlays/SpellbookOverlay.tsx` (+ `apps/web/src/ui/overlays/SpellbookOverlay.test.tsx`)
- Modify: `apps/web/src/ui/overlays/registry.ts` (add `'spellbook'` to `OverlayId` + registry row)
- Modify: `apps/web/src/ui/KeyRouter.ts` (add `'spellbook'` to `OverlayActionId` + `outcomeForAction` case)
- Modify: `apps/web/src/session/settings.ts` (add `'spellbook'` to `ActionId`, `ACTION_IDS`, `ACTION_LABELS`, `DEFAULT_BINDINGS`)
- Modify: `apps/web/src/ui/overlays/OverlayHost.tsx` (render body case; it's a Dialog overlay, global-ish but play-scope)

**Interfaces:**
- Consumes: `CastableSpellView` (with `aoe`), `spellById`/`spellEntries` (pack-queries), `ListDetail`/`ListDetailItem`, `heroOf`, `useSessionCtx`, `usePack`, `useSpellTargeting.begin` (via a callback prop).
- Produces:
  - `function describeSpell(input: Readonly<{ spell: CastableSpellView; pack: CompiledContentPack }>): Readonly<{ aoeBadge: string | null; rangeLabel: string; effects: readonly string[]; targetingLabel: string }>` — derived display metadata. Since spells carry NO `description` prose in the content model (`SpellContentEntry extends BaseContentEntry`, no `description`), the detail pane's "prose" is this derived effects/targeting/AoE summary read from the pack's `SpellContentEntry.effects` + `tags`, plus the runtime `CastableSpellView` state.
  - `SpellbookOverlay` component props: `readonly onCast?: (spellId: string) => void;` (enters targeting via `targeting.begin`).

**AoE badge mapping:** `aoe.shape === 'burst'` → `"burst r{radius}"`; `'line'` → `"line"`; `'cone'` → `"cone"`; no `aoe` → `null`.

- [ ] **Step 1: Write the failing `describeSpell` test**

Create `apps/web/test/spell-detail.test.ts`:

```typescript
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import type { CompiledContentPack } from '@woven-deep/content';
import { describeSpell, aoeBadge } from '../src/session/spell-detail.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

describe('aoeBadge', () => {
  it('formats a burst radius', () => {
    expect(aoeBadge({ shape: 'burst', radius: 2 })).toBe('burst r2');
  });
  it('formats line/cone without radius', () => {
    expect(aoeBadge({ shape: 'line', radius: 4 })).toBe('line');
    expect(aoeBadge({ shape: 'cone', radius: 3 })).toBe('cone');
  });
  it('returns null when absent', () => {
    expect(aoeBadge(undefined)).toBeNull();
  });
});

describe('describeSpell', () => {
  it('summarizes a burst spell from the pack + runtime view', () => {
    const spell = {
      spellId: 'spell.fireball',
      name: 'Fireball',
      weaveCost: 6,
      range: 6,
      targetingId: 'target.burst',
      aoe: { shape: 'burst', radius: 2 },
    } as const;
    const detail = describeSpell({ spell, pack });
    expect(detail.aoeBadge).toBe('burst r2');
    expect(detail.rangeLabel).toBe('Range 6');
    expect(detail.targetingLabel).toMatch(/burst/i);
    expect(detail.effects.length).toBeGreaterThan(0); // from SpellContentEntry.effects
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run apps/web/test/spell-detail.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `spell-detail.ts`**

Create `apps/web/src/session/spell-detail.ts`:

```typescript
import type { CompiledContentPack } from '@woven-deep/content';
import { spellEntries } from '@woven-deep/session-core';
import type { CastableSpellView } from './projection-view.js';

type Aoe = CastableSpellView['aoe'];

/** The list-row badge for a spell's area shape, or `null` for a single-target spell. */
export function aoeBadge(aoe: Aoe): string | null {
  if (aoe === undefined) return null;
  return aoe.shape === 'burst' ? `burst r${aoe.radius}` : aoe.shape;
}

const TARGETING_LABEL: Readonly<Record<string, string>> = {
  'target.self': 'Self',
  'target.actor': 'Single target',
  'target.burst': 'Burst (area)',
  'target.line': 'Line (area)',
  'target.cone': 'Cone (area)',
  'target.cell': 'Ground',
};

/** Derived display metadata for a spell. Spells have no authored prose (the content model has no
 * `description` on a spell), so the "detail" is this effects/targeting/AoE summary read from the
 * pack's `SpellContentEntry.effects`, plus the runtime `CastableSpellView` numbers. */
export function describeSpell(
  input: Readonly<{ spell: CastableSpellView; pack: CompiledContentPack }>,
): Readonly<{
  aoeBadge: string | null;
  rangeLabel: string;
  targetingLabel: string;
  effects: readonly string[];
}> {
  const { spell, pack } = input;
  const entry = spellEntries(pack).find((candidate) => candidate.id === spell.spellId);
  const effects = (entry?.effects ?? []).map((effect) => effect.effectId.replace(/^effect\./, ''));
  return {
    aoeBadge: aoeBadge(spell.aoe),
    rangeLabel: `Range ${spell.range}`,
    targetingLabel: TARGETING_LABEL[spell.targetingId] ?? spell.targetingId,
    effects,
  };
}
```

(`session-core` exports `spellEntries`, not a `spellById` — the `.find` above is the confirmed lookup.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run build --workspace @woven-deep/session-core && npx vitest run apps/web/test/spell-detail.test.ts`
Expected: PASS.

- [ ] **Step 5: Register the `spellbook` overlay id/action/keybind**

In `apps/web/src/ui/overlays/registry.ts`:
- Add `'spellbook'` to the `OverlayId` union (line 8-9).
- Add a registry row: `spellbook: { id: 'spellbook', title: 'Spellbook', scope: 'play', action: 'spellbook' },`.

In `apps/web/src/session/settings.ts`:
- Add `| 'spellbook'` to `ActionId` (before `'dismiss-hint'`).
- Add `'spellbook'` to `ACTION_IDS` (after `'help'`).
- Add `spellbook: 'Spellbook',` to `ACTION_LABELS`.
- Add `spellbook: chord('z'),` to `DEFAULT_BINDINGS` (`z` is unused by any existing default and is not a hardwired arrow/numpad key — verified against `DEFAULT_BINDINGS`/`HARDWIRED_KEYS`).

In `apps/web/src/ui/KeyRouter.ts`:
- Add `'spellbook'` to the `OverlayActionId` union (line 10-11).
- Add `'spellbook'` to the overlay-open `case` list in `outcomeForAction` (lines 101-107).

- [ ] **Step 6: Write the overlay render test**

Create `apps/web/src/ui/overlays/SpellbookOverlay.test.tsx` (mirror `SpellsPanel.test.tsx`'s pack/projection harness — read it for `snapshotOf` and provider wrapper):

```typescript
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import type { CompiledContentPack } from '@woven-deep/content';
import type { CastableSpellView } from '../../session/projection-view.js';
import { SpellbookOverlay } from './SpellbookOverlay.js';
// … build a session context whose hero.castableSpells has fireball + ember bolt, weave = 20.

let pack: CompiledContentPack;
beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../../../content') });
});

const FIREBALL: CastableSpellView = {
  spellId: 'spell.fireball', name: 'Fireball', weaveCost: 6, range: 6,
  targetingId: 'target.burst', aoe: { shape: 'burst', radius: 2 },
};

describe('SpellbookOverlay', () => {
  it('lists known spells with weave cost, range, and an AoE badge', () => {
    renderSpellbook({ spells: [FIREBALL], weave: 20 });
    expect(screen.getByText('Fireball')).toBeInTheDocument();
    expect(screen.getByText(/burst r2/)).toBeInTheDocument();
    expect(screen.getByText(/6 Weave/)).toBeInTheDocument();
  });

  it('dims an unaffordable spell', () => {
    renderSpellbook({ spells: [FIREBALL], weave: 1 });
    // The row/button is disabled or carries the unaffordable class.
    expect(screen.getByRole('option', { name: /Fireball/ })).toHaveAttribute('aria-disabled', 'true');
  });

  it('Cast enters targeting via onCast', async () => {
    const onCast = vi.fn();
    renderSpellbook({ spells: [FIREBALL], weave: 20, onCast });
    await userEvent.click(screen.getByRole('button', { name: /Cast/ }));
    expect(onCast).toHaveBeenCalledWith('spell.fireball');
  });

  it('renders an empty state for a hero who knows no spells', () => {
    renderSpellbook({ spells: [], weave: 20 });
    expect(screen.getByText(/no spells/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Implement `SpellbookOverlay.tsx`**

Create `apps/web/src/ui/overlays/SpellbookOverlay.tsx` built on `ListDetail` (model on `InventoryOverlay`). Reads `heroOf(sessionCtx.snapshot.projection).castableSpells`, `usePack()`; each row is `{ id: spell.spellId, label: spell.name, badge: aoeBadge(spell.aoe) ?? undefined }`; the detail pane shows `describeSpell(...)` output + a **Cast** button calling `props.onCast?.(spell.spellId)`. Affordability: `heroData.weave >= spell.weaveCost` — dim the row and disable Cast when unaffordable. Sketch:

```typescript
import { useState, type JSX } from 'react';
import { heroOf } from '../../session/projection-view.js';
import { usePack, useSessionCtx } from '../providers.js';
import { ListDetail, type ListDetailItem } from '../components/ListDetail.js';
import { aoeBadge, describeSpell } from '../../session/spell-detail.js';

export interface SpellbookOverlayProps {
  readonly onCast?: (spellId: string) => void;
}

export function SpellbookOverlay({ onCast }: SpellbookOverlayProps): JSX.Element | null {
  const sessionCtx = useSessionCtx();
  const pack = usePack();
  const [selectedIndex, setSelectedIndex] = useState(0);
  if (!sessionCtx) return null;
  const hero = heroOf(sessionCtx.snapshot.projection);
  const spells = hero.castableSpells ?? [];
  if (spells.length === 0) return <p className="text-muted">You know no spells.</p>;

  const items: ListDetailItem[] = spells.map((spell) => ({
    id: spell.spellId,
    label: spell.name,
    ...(aoeBadge(spell.aoe) ? { badge: aoeBadge(spell.aoe)! } : {}),
  }));

  return (
    <ListDetail
      listLabel="Known spells"
      items={items}
      selectedIndex={selectedIndex}
      onSelect={setSelectedIndex}
      renderDetail={(item) => {
        const spell = spells.find((s) => s.spellId === item?.id);
        if (!spell) return null;
        const detail = describeSpell({ spell, pack });
        const affordable = hero.weave >= spell.weaveCost;
        return (
          <div className="flex flex-col gap-2">
            <h3 className="font-semibold">{spell.name}</h3>
            <p className="text-xs text-muted">{`${spell.weaveCost} Weave · ${detail.rangeLabel} · ${detail.targetingLabel}`}</p>
            {detail.aoeBadge && <p className="text-xs">{`Area: ${detail.aoeBadge}`}</p>}
            <ul className="text-xs text-muted">
              {detail.effects.map((effect) => (
                <li key={effect}>{effect}</li>
              ))}
            </ul>
            <button
              type="button"
              disabled={!affordable}
              onClick={() => onCast?.(spell.spellId)}
              className="mt-1 rounded-sm border border-accent px-2 py-1 text-sm disabled:opacity-50"
            >
              Cast
            </button>
          </div>
        );
      }}
    />
  );
}
```

Match the `6 Weave` / `burst r2` text so the tests find it (the panel already uses `${spell.weaveCost} Weave`). For the `aria-disabled` unaffordable-row assertion, add `aria-disabled` to unaffordable rows — since `ListDetail` renders rows itself, either (a) add a per-row `disabled` field to `ListDetailItem` + `aria-disabled` in `ListDetail` (small, reusable extension), or (b) assert on the Cast button's `disabled` state instead. This plan chooses **(b)** to avoid widening the shared `ListDetail`: change the unaffordable test to `expect(screen.getByRole('button', { name: /Cast/ })).toBeDisabled();` after selecting the spell.

- [ ] **Step 8: Render the body in `OverlayHost` and pass `onCast` from `PlayScreen`**

In `apps/web/src/ui/overlays/OverlayHost.tsx`:
- Import `SpellbookOverlay`.
- Add `'spellbook'` — it is a Dialog overlay (NOT in `SHEET_OVERLAYS`), so it renders through the Dialog branch automatically.
- Add a `case 'spellbook':` in `renderBody`: `if (!ctx.snapshot) return <p>Your spellbook is unavailable right now.</p>; return <SpellbookOverlay onCast={ctx.onCastSpell} />;`
- Add `onCastSpell?: (spellId: string) => void` to `RenderBodyContext` and `OverlayHostProps`, forwarded from `PlayScreen`.

In `PlayScreen.tsx`, pass `onCastSpell={(spellId) => { onCloseOverlay(); targeting.begin(spellId); }}` to `<OverlayHost>` (close the overlay first so targeting owns the map). The `spellbook` action reaches `onOpenOverlay` through the existing `KeyRouter`/`usePlayKeyDispatcher` path — confirm `usePlayKeyDispatcher` forwards `open-overlay` outcomes generically (it calls `onOpenOverlay(outcome.overlay)`), so no dispatcher change is needed; `App`'s scope gate accepts a `play`-scope id during a live run.

- [ ] **Step 9: Run the overlay + settings/router tests**

Run: `npm run build --workspace @woven-deep/session-core && npx vitest run apps/web/src/ui/overlays/SpellbookOverlay.test.tsx apps/web/test/spell-detail.test.ts`
Expected: PASS.
Run (guard the keymap/registry additions): `npx vitest run apps/web/src/ui/overlays/OverlayHost.test.tsx`
Expected: PASS.

- [ ] **Step 10: Typecheck the web app**

Run: `npm run build --workspace @woven-deep/web`
Expected: exit 0 (the `OverlayId`/`ActionId`/`OverlayActionId` additions are consistent across `registry.ts`/`settings.ts`/`KeyRouter.ts`; any exhaustive `switch` on these unions now handles `spellbook`).

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/session/spell-detail.ts apps/web/test/spell-detail.test.ts apps/web/src/ui/overlays/SpellbookOverlay.tsx apps/web/src/ui/overlays/SpellbookOverlay.test.tsx apps/web/src/ui/overlays/registry.ts apps/web/src/ui/overlays/OverlayHost.tsx apps/web/src/ui/KeyRouter.ts apps/web/src/session/settings.ts apps/web/src/ui/PlayScreen.tsx
git commit -m "feat(web): browsable spellbook overlay"
```

---

## Task 8: Recall return-portal relabel

**Files:**
- Modify: `packages/engine/src/projection.ts` (`GameplayProjection` + `projectGameplayState`) — add `returnAnchorDepth?`
- Modify: `apps/web/src/ui/TownPanel.tsx` (return-portal hint)
- Modify: `apps/web/src/ui/CommandPalette.tsx` (relabel the descend command when anchored)
- Test: `packages/engine/test/return-anchor-projection.test.ts` (NEW), `apps/web/src/ui/TownPanel.test.tsx` (NEW or existing)

**Interfaces:**
- Consumes: `ActiveRun.returnAnchorFloorId?: OpaqueId` (`packages/engine/src/model.ts:171`), `run.floors[].depth`.
- Produces: `GameplayProjection.returnAnchorDepth?: number` — the depth of the anchored floor the town stair will recall the hero back to, present only when `returnAnchorFloorId` is set. Client helper `returnAnchorDepthOf(projection): number | undefined` on `projection-view.ts` (re-exported to web) — OR read `projection.returnAnchorDepth` directly.

**Why depth, not floorId:** the client needs "Return to depth N"; the run stores a `floorId`. The engine resolves the depth (it has `run.floors`), so the client gets a display-ready number and never has to look up a floor.

- [ ] **Step 1: Write the failing projection test**

Create `packages/engine/test/return-anchor-projection.test.ts`:

```typescript
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import type { CompiledContentPack } from '@woven-deep/content';
import { DEFAULT_GUEST_HERO, createNewRun, projectGameplayState, type ActiveRun } from '../src/index.js';

let pack: CompiledContentPack;
beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
});

describe('returnAnchorDepth projection', () => {
  it('is absent when no recall anchor is set', () => {
    const run = createNewRun({ pack, seed: [1, 2, 3, 4], hero: DEFAULT_GUEST_HERO });
    const projection = projectGameplayState({ state: run, content: pack });
    expect('returnAnchorDepth' in projection).toBe(false);
  });

  it('resolves the anchored floor depth when set', () => {
    const run = createNewRun({ pack, seed: [1, 2, 3, 4], hero: DEFAULT_GUEST_HERO });
    const anchor = run.floors[0]!;
    const anchored: ActiveRun = { ...run, returnAnchorFloorId: anchor.floorId };
    const projection = projectGameplayState({ state: anchored, content: pack });
    expect(projection.returnAnchorDepth).toBe(anchor.depth);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run build --workspace @woven-deep/engine && npx vitest run packages/engine/test/return-anchor-projection.test.ts`
Expected: FAIL — `returnAnchorDepth` is not on the projection.

- [ ] **Step 3: Add the field + populate it**

In `packages/engine/src/projection.ts`, add to `GameplayProjection` (near `house`/`slots`, lines 477-478):

```typescript
  /** The depth of the floor a pending recall will return the hero to from the town stair — present
   * only when `run.returnAnchorFloorId` is set. The client relabels the descend affordance to
   * "Return to depth N" when this is present. */
  readonly returnAnchorDepth?: number;
```

In `projectGameplayState`'s returned object (around line 991-1013), add a conditional spread:

```typescript
  const anchorFloor =
    input.state.returnAnchorFloorId === undefined
      ? undefined
      : input.state.floors.find((floor) => floor.floorId === input.state.returnAnchorFloorId);
  return {
    ...(trade === undefined ? {} : { trade }),
    ...(anchorFloor === undefined ? {} : { returnAnchorDepth: anchorFloor.depth }),
    // …rest unchanged…
```

- [ ] **Step 4: Run the projection test + demos**

Run: `npm run build --workspace @woven-deep/engine && npx vitest run packages/engine/test/return-anchor-projection.test.ts`
Expected: PASS.
Run: `npm run magic:demo`
Expected: exit 0 (additive optional field; no transcript change).

- [ ] **Step 5: Write the client relabel test**

Add `apps/web/src/ui/TownPanel.test.tsx` (or extend it if present):

```typescript
it('shows a return-to-depth hint when a recall anchor is set', () => {
  const projection = townProjection({ returnAnchorDepth: 4 }); // helper clones a town projection
  render(<TownPanel snapshot={snapshotOf(projection)} keymap={keymap} />);
  expect(screen.getByText(/Return to depth 4/)).toBeInTheDocument();
});

it('omits the return hint with no anchor', () => {
  const projection = townProjection({});
  render(<TownPanel snapshot={snapshotOf(projection)} keymap={keymap} />);
  expect(screen.queryByText(/Return to depth/)).not.toBeInTheDocument();
});
```

- [ ] **Step 6: Add the hint to `TownPanel` and relabel the palette command**

In `apps/web/src/ui/TownPanel.tsx`, read `projection.returnAnchorDepth` and render a hint line when set (near the house hint, lines 58-60):

```typescript
  const returnDepth = projection.returnAnchorDepth;
  // …in JSX, before the house hint:
  {returnDepth !== undefined && (
    <p className="town-return-hint">{`Return to depth ${returnDepth} — press ${chordKey(keymap.byAction.descend)} at the stair.`}</p>
  )}
```

In `apps/web/src/ui/CommandPalette.tsx`, when `projection.returnAnchorDepth !== undefined` label the `descend` command "Return to depth N" instead of "Descend" (read the file's command-label table around lines 33-102 and make the `descend` label conditional on the projection). Keep the intent `{ type: 'descend' }` unchanged — the server's `dispatch.ts` already reroutes it to `recallReturn`.

- [ ] **Step 7: Run the client tests + typecheck**

Run: `npm run build --workspace @woven-deep/engine && npm run build --workspace @woven-deep/session-core && npx vitest run apps/web/src/ui/TownPanel.test.tsx apps/web/src/ui/CommandPalette.test.tsx`
Expected: PASS.
Run: `npm run build --workspace @woven-deep/web`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/engine/src/projection.ts packages/engine/test/return-anchor-projection.test.ts apps/web/src/ui/TownPanel.tsx apps/web/src/ui/TownPanel.test.tsx apps/web/src/ui/CommandPalette.tsx
git commit -m "feat: relabel town stair as recall return portal when anchored"
```

---

## Task 9: Spell-merchant badge + learn-from-tome feedback

**Files:**
- Modify: `apps/web/src/ui/screens/TradeScreen.tsx` (spell/AoE badge on tome/scroll rows)
- Modify: `apps/web/src/session/event-log.ts` (`spell.learned` line)
- Test: `apps/web/src/session/event-log.test.ts` (learn line), `apps/web/src/ui/screens/TradeScreen.test.tsx` (badge — read for existing harness)

**Interfaces:**
- Consumes: `PublicEvent` (`SpellLearnedEvent { type: 'spell.learned'; spellId }`), the trade stock rows (`session.stock`), `scrollAimSpell`/item `spellId` for the badge, `usePack`.
- Produces: a `spell.learned` case in `renderEvent` returning `{ text: 'You learn a new spell.', tone: 'info' }`; a spell/AoE badge string on trade rows whose item content carries a `spellId`.

**Note on the learned spell name:** `renderEvent(event: PublicEvent)` has no content pack (its signature is `PublicEvent` only, called from `foldEventsIntoLog(log, events, nextId)` in `guest-session.ts`/`profile-session.ts`). Threading the pack through the whole log pipeline is out of proportion for one line, so the log renders a generic "You learn a new spell." and the concrete spell surfaces immediately in `SpellsPanel`/`SpellbookOverlay` on the next snapshot (the newly-known spell flows through `castableSpells`) — which is the "the spell appears" half of the spec's feedback requirement. Verified in Step 5.

- [ ] **Step 1: Write the failing event-log test**

Add to `apps/web/src/session/event-log.test.ts`:

```typescript
it('renders a learned-spell line', () => {
  const { log } = foldEventsIntoLog([], [
    { type: 'spell.learned', eventId: 'e1', actorId: 'hero.demo', spellId: 'spell.fireball' },
  ], 0);
  expect(log.map((line) => line.text)).toContain('You learn a new spell.');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run apps/web/src/session/event-log.test.ts -t "learned-spell"`
Expected: FAIL — no `spell.learned` case; `renderEvent` returns `null` so nothing folds.

- [ ] **Step 3: Add the `spell.learned` case**

In `apps/web/src/session/event-log.ts` `renderEvent`, add before `case 'run.concluded':`:

```typescript
    case 'spell.learned':
      return { text: 'You learn a new spell.', tone: 'info' };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run apps/web/src/session/event-log.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the trade-badge test + implement it**

Read `apps/web/src/ui/screens/TradeScreen.tsx` (buy rows built at lines 149-155). A trade stock entry exposes `entry.item` (an `ItemView` with `contentId` when identified). Add a spell/AoE badge to a row when `scrollAimSpell(pack, entry.item.contentId)` is non-null OR the item's content has a `spellId`/learn effect. Simplest honest signal reusing existing code: badge the row when `itemById(pack, contentId)?.spellId` is set (scroll/spell item) — label it with the spell's AoE badge if the spell is AoE, else "spell". Add to the buy-row mapping:

```typescript
buy: session.stock.map((entry) => {
  const spellId = entry.item.contentId ? itemById(pack, entry.item.contentId)?.spellId : undefined;
  const spell =
    typeof spellId === 'string' ? spellEntries(pack).find((s) => s.id === spellId) : undefined;
  const spellBadge = spell ? (aoeBadge(spell.aoe) ?? 'spell') : undefined;
  return {
    // …existing fields…
    ...(spellBadge ? { badge: spellBadge } : {}),
  };
}),
```

Render the `badge` in the row markup (match how the ledger row renders name/price). Add a test asserting a fireball-tome/ember-scroll row shows a badge:

```typescript
it('badges a spell item in the buy list', () => {
  renderTrade({ stock: ['item.ember-scroll'] });
  expect(screen.getByText('Scroll of ember bolt').closest('[data-row]')).toHaveTextContent(/spell|burst|line|cone/);
});
```

Note: a tome's item entry may not carry a directly-castable `spellId` (it learns via `effect.spell.learn`). If `itemById(pack, contentId)?.spellId` is undefined for tomes, extend the badge signal to also detect a learn effect (`item.effects?.some((e) => e.effectId === 'effect.spell.learn')`) → badge `"learn"`. Confirm by reading `content/items/fireball-tome.yaml` before finalizing the predicate.

- [ ] **Step 6: Run the trade + event-log tests + typecheck**

Run: `npm run build --workspace @woven-deep/session-core && npx vitest run apps/web/src/ui/screens/TradeScreen.test.tsx apps/web/src/session/event-log.test.ts`
Expected: PASS.
Run: `npm run build --workspace @woven-deep/web`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/session/event-log.ts apps/web/src/session/event-log.test.ts apps/web/src/ui/screens/TradeScreen.tsx apps/web/src/ui/screens/TradeScreen.test.tsx
git commit -m "feat(web): spell-merchant badges and learn-from-tome feedback"
```

---

## Task 10: Whole-surface verification gate

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Full build (rebuild every dist so typecheck sees fresh types)**

Run: `npm run build`
Expected: exit 0 across content → engine → session-core → web → server (per `build-verification` memory: vitest does not typecheck, so this ordered rebuild is the real type gate).

- [ ] **Step 2: All 8 demos byte-identical**

Run: `npm run engine:demo && npm run dungeon:demo && npm run gameplay:demo && npm run merchant:demo && npm run population:demo && npm run run-records:demo && npm run endgame:demo && npm run magic:demo`
Expected: each exits 0 (`--verify` re-checks the golden transcript). Any non-zero exit means the T1 refactor was not behavior-preserving — bisect T1's `targeting.ts` wrappers against the original private functions.

- [ ] **Step 3: Cross-process parity harness**

Run: `npx vitest run apps/server/test/play/determinism-parity.test.ts`
Expected: PASS.

- [ ] **Step 4: Full web test suite**

Run: `npx vitest run --project @woven-deep/web` (or `npm run test --workspace @woven-deep/web`)
Expected: PASS. If `overlay-infrastructure.test.tsx` or `settings-roaming.test.tsx` fail, re-run each in isolation to confirm they are the KNOWN intermittent parallel-load flakes, not regressions:
Run: `npx vitest run apps/web/test/overlay-infrastructure.test.tsx` then `npx vitest run apps/web/src/ui/hooks/useSettingsRoaming.test.ts` (adjust to the real path).
Expected: PASS in isolation.

- [ ] **Step 5: Whole-repo verify**

Run: `npm run verify`
Expected: exit 0 (typecheck + lint + format:check + depcruise + knip + test). depcruise must show no new cycle from the shared-geometry module (it lives in `engine`, imported by `web` via `@woven-deep/engine` — one-directional). knip must not flag `aoe-geometry.ts`/`scroll-targeting.ts`/`spell-detail.ts` as unused (each is imported by a sibling task's code).

- [ ] **Step 6: Final commit (if verify produced any lint/format autofixes)**

```bash
git add -A
git commit -m "chore: casting-ui verification gate green"
```

---

## Self-Review

**1. Spec coverage** — every spec section maps to a task:
- Design §1 (shared geometry + `CastableSpellView.aoe`) → **T1, T2**.
- Design §2 (free cursor + live footprint + affected-actor highlight + confirm/cancel + out-of-range/empty-ground rules) → **T3 (footprint), T4 (cursor/overlay/confirm)**.
- Design §3 (optional-target item-use intent + command-builder; targeted scroll → shared aim; tomes/self stay fire-and-forget; one aim flow, two dispatch targets) → **T5 (intent), T6 (routing + generalized dispatch)**.
- Design §4 (spellbook overlay: id/action/keybind/body, `ListDetail`, AoE badge, affordability, Cast → targeting, prose from pack; HUD panel stays) → **T7**.
- Design §5 (recall relabel via `returnAnchorFloorId` surfaced to client; merchant badge; learn feedback + spell appears) → **T8 (recall), T9 (merchant badge + learn)**.
- Design §6 (determinism preserved; geometry parity test; targeting-mode tests; scroll tests; spellbook tests; recall/merchant/learn tests; flake-aware web tests) → embedded across **T1 (parity/demos/harness), T3 (parity), T4/T6/T7/T8/T9 (feature tests), T10 (gate + flake isolation)**.
- Scope boundary (UI-only + 3 named engine/session-core touch-points) → honored: engine changes are exactly the geometry extraction (T1), `CastableSpellView.aoe` (T2), `returnAnchorDepth` projection (T8, a minimal read the spec explicitly permits — "confirm it reaches the projection; if not, add it"); session-core change is exactly the optional item-use target (T5).

**2. Placeholder scan** — no "TBD"/"add error handling"/"similar to Task N" left; every code step shows real TS/TSX. Where a test reuses an existing file's harness (T4/T6/T9), the plan names the exact helpers to read and match rather than inventing an unseen API — this is a deliberate instruction, not a placeholder, because those harnesses already exist in the repo and must be matched, not reinvented.

**3. Type consistency** — `CastableSpellView.aoe` shape (`{ shape: 'burst'|'line'|'cone'; radius: number }`) is identical in T2 (definition), T3 (`affectedFootprint` input `Pick<…, 'range'|'targetingId'|'aoe'>`), T4 (hook), T6 (`scrollAimSpell` return), T7 (`describeSpell`/`aoeBadge`). `affectedFootprint`/`aimInRange` signatures match between T3 (definition) and T4 (consumer). `backpack` intent `target?: { x; y }` matches between T5 (intent) and T6 (dispatch). `OverlayId`/`ActionId`/`OverlayActionId` gain `'spellbook'` in all three of `registry.ts`/`settings.ts`/`KeyRouter.ts` (T7). `returnAnchorDepth` matches between T8 engine field and T8 client reads. The shared geometry callback contract (`isOpaque` returns true OOB) is stated in T1 and relied on identically in T3's `projectionIsOpaque`.
