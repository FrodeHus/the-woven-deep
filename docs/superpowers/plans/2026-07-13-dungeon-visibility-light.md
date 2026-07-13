# Dungeon Generation, Visibility, and Light Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate connected classic dungeon floors with YAML-authored vaults, compute deterministic sight and colored illumination, retain remembered terrain, and expose a hidden-state-safe DOM projection.

**Architecture:** Pin ROT.js behind browser-safe adapters for room/corridor topology and precise shadowcasting. Project-owned modules handle tile rules, vault compilation and placement, seed isolation, fallback generation, knowledge packing, integer lighting, projection, and save schema `v2`. Every generated floor remains a complete immutable active-run snapshot; derived sight, illumination, projections, and generation reports are never saved.

**Tech Stack:** TypeScript 5.8+, Node.js 22.12+, ROT.js 2.2.1, Zod 4, YAML 2.8+, Vitest 3.2+, npm workspaces, Docker Compose.

**Design:** `docs/superpowers/specs/2026-07-13-dungeon-visibility-light-design.md`

## Global Constraints

- Pin `rot-js` exactly at `2.2.1`; do not use a range.
- Production engine code remains browser-safe and contains no React, Fastify, SQLite, storage, clock, Node API, or ambient-random imports.
- ROT.js state is isolated synchronously and restored in `finally`; no ROT.js object enters saved or observable state.
- Preserve tile IDs `0 = wall` and `1 = floor`; add only the published IDs from the design.
- Generation supports widths 20–160 and heights 12–100; saved legacy floors retain the existing 512-axis validation ceiling.
- Generator attempt limits are safe integers from 1 through 32; the default is 8.
- All light and color fields are integers; never serialize `NaN`, infinity, fractional intensity, or unsafe integers.
- Hidden terrain, slots, fixtures, random state, and generation diagnostics never enter observable projections.
- Vault YAML contains data only; algorithms remain registered TypeScript behavior.
- Every current-save format change is `v2` with an ordered `v0 → v1 → v2` migration; visited floors are never regenerated during load.
- Use natural, descriptive terminology throughout project content.
- Follow RED/GREEN test-driven development and end each task with a focused review gate and clean commit.

---

### Task 1: Pin ROT.js and publish terrain rules

**Files:**
- Modify: `packages/engine/package.json`
- Modify: `package-lock.json`
- Modify: `packages/engine/src/model.ts`
- Create: `packages/engine/src/terrain.ts`
- Modify: `packages/engine/src/index.ts`
- Create: `packages/engine/test/terrain.test.ts`
- Modify: `packages/engine/test/browser-boundary.test.ts`

**Interfaces:**
- Produces: `TileId = 0 | 1 | 2 | 3 | 4 | 5 | 6`
- Produces: `TileDefinition`, `TILE_DEFINITIONS`, `tileDefinition(tileId)`, `movementBlockReason(tileId)`
- Later tasks consume terrain opacity, walkability, presentation, and potential traversability.

- [ ] **Step 1: Write failing terrain and dependency tests**

Create `packages/engine/test/terrain.test.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  TILE_DEFINITIONS,
  movementBlockReason,
  tileDefinition,
  type TileId,
} from '../src/index.js';

describe('terrain registry', () => {
  it('keeps existing IDs and publishes every v2 tile exactly once', () => {
    expect(TILE_DEFINITIONS.map((entry) => [entry.id, entry.name])).toEqual([
      [0, 'wall'], [1, 'floor'], [2, 'closed-door'], [3, 'pillar'],
      [4, 'stair-up'], [5, 'stair-down'], [6, 'void'],
    ]);
    expect(new Set(TILE_DEFINITIONS.map((entry) => entry.id)).size).toBe(7);
  });

  it.each([
    [0, false, false, true, '#', 'blocked.wall'],
    [1, true, true, false, '.', undefined],
    [2, false, true, true, '+', 'blocked.door'],
    [3, false, false, true, 'O', 'blocked.pillar'],
    [4, true, true, false, '<', undefined],
    [5, true, true, false, '>', undefined],
    [6, false, false, true, ' ', 'blocked.void'],
  ] as const)('defines tile %s', (id, walkable, potentiallyTraversable, opaque, glyph, reason) => {
    expect(tileDefinition(id as TileId)).toMatchObject({ walkable, potentiallyTraversable, opaque, glyph });
    expect(movementBlockReason(id as TileId)).toBe(reason);
  });

  it('pins the reviewed ROT.js release exactly', async () => {
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(packageJson.dependencies['rot-js']).toBe('2.2.1');
    expect(packageJson.dependencies['@woven-deep/content']).toBe('0.0.0');
  });
});
```

Add a synthetic assertion in `browser-boundary.test.ts` that `import { FOV, Map, RNG } from 'rot-js'` produces no forbidden specifiers, without weakening forbidden module or ambient API detection.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npm test --workspace @woven-deep/engine -- --run test/terrain.test.ts test/browser-boundary.test.ts
```

Expected: FAIL because terrain exports and dependencies do not exist.

- [ ] **Step 3: Add exact dependencies and terrain definitions**

Set engine dependencies to:

```json
"dependencies": {
  "@woven-deep/content": "0.0.0",
  "rot-js": "2.2.1",
  "zod": "^4.0.0"
}
```

Run `npm install` from the repository root and require `package-lock.json` to resolve ROT.js 2.2.1.

Change `TileId` in `model.ts` to:

```ts
export type TileId = 0 | 1 | 2 | 3 | 4 | 5 | 6;
```

Create `terrain.ts`:

```ts
import type { InvalidActionEvent, TileId } from './model.js';

export type TerrainName = 'wall' | 'floor' | 'closed-door' | 'pillar' | 'stair-up' | 'stair-down' | 'void';
export type TerrainToken = 'terrain.wall' | 'terrain.floor' | 'terrain.door' | 'terrain.pillar' | 'terrain.stair' | 'terrain.void';

export interface TileDefinition {
  readonly id: TileId;
  readonly name: TerrainName;
  readonly glyph: string;
  readonly walkable: boolean;
  readonly potentiallyTraversable: boolean;
  readonly opaque: boolean;
  readonly token: TerrainToken;
}

export const TILE_DEFINITIONS: readonly TileDefinition[] = [
  { id: 0, name: 'wall', glyph: '#', walkable: false, potentiallyTraversable: false, opaque: true, token: 'terrain.wall' },
  { id: 1, name: 'floor', glyph: '.', walkable: true, potentiallyTraversable: true, opaque: false, token: 'terrain.floor' },
  { id: 2, name: 'closed-door', glyph: '+', walkable: false, potentiallyTraversable: true, opaque: true, token: 'terrain.door' },
  { id: 3, name: 'pillar', glyph: 'O', walkable: false, potentiallyTraversable: false, opaque: true, token: 'terrain.pillar' },
  { id: 4, name: 'stair-up', glyph: '<', walkable: true, potentiallyTraversable: true, opaque: false, token: 'terrain.stair' },
  { id: 5, name: 'stair-down', glyph: '>', walkable: true, potentiallyTraversable: true, opaque: false, token: 'terrain.stair' },
  { id: 6, name: 'void', glyph: ' ', walkable: false, potentiallyTraversable: false, opaque: true, token: 'terrain.void' },
] as const;

export function tileDefinition(tileId: TileId): TileDefinition {
  const definition = TILE_DEFINITIONS[tileId];
  if (!definition || definition.id !== tileId) throw new Error(`internal invariant: unknown tile ${tileId}`);
  return definition;
}

export function movementBlockReason(tileId: TileId): InvalidActionEvent['reason'] | undefined {
  if (tileDefinition(tileId).walkable) return undefined;
  if (tileId === 2) return 'blocked.door';
  if (tileId === 3) return 'blocked.pillar';
  if (tileId === 6) return 'blocked.void';
  return 'blocked.wall';
}
```

Extend `InvalidActionEvent['reason']` and `InvalidCommandResult['reason']` with `blocked.door`, `blocked.pillar`, and `blocked.void`. Export `terrain.ts` from `index.ts`. Save validation remains limited to tile IDs 0 and 1 until Task 7.

- [ ] **Step 4: Run GREEN and package checks**

Run:

```bash
npm test --workspace @woven-deep/engine -- --run test/terrain.test.ts test/model.test.ts test/browser-boundary.test.ts
npm run typecheck --workspace @woven-deep/engine
npm test --workspace @woven-deep/engine
git diff --check
```

Expected: exact registry tests pass; all existing engine tests remain green.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/package.json package-lock.json packages/engine/src packages/engine/test
git commit -m "feat: define dungeon terrain rules"
```

---

### Task 2: Compile strict YAML vault templates

**Files:**
- Modify: `packages/content/src/model.ts`
- Modify: `packages/content/src/compiler/schema.ts`
- Create: `packages/content/src/compiler/vault-validation.ts`
- Modify: `packages/content/src/compiler/compile-directory.ts`
- Modify: `packages/content/src/compiler/index.ts`
- Create: `content/vaults/lampwright-cache.yaml`
- Modify: `packages/content/test/model.test.ts`
- Modify: `packages/content/test/parse-file.test.ts`
- Modify: `packages/content/test/compile-directory.test.ts`
- Modify: `packages/content/test/default-content.test.ts`
- Create: `packages/content/test/vault-validation.test.ts`

**Interfaces:**
- Produces: `VaultContentEntry`, `VaultLegendEntry`, `VaultPlacementSlot`, `VaultLightFixture`
- Produces: `validateVaultEntry(entry, file): ContentCompileIssue[]`
- Later generation consumes compiled vault entries only, never YAML documents.

- [ ] **Step 1: Write failing vault shape and semantic tests**

Add a parser test using this minimum valid entry:

```yaml
schemaVersion: 1
entries:
  - kind: vault
    id: vault.test-room
    name: Test room
    tags: [test]
    minDepth: 1
    maxDepth: 5
    rarity: common
    weight: 10
    maxPerFloor: 1
    margin: 1
    transforms: { rotations: [0, 180], reflectHorizontal: true }
    layout: ["#####", "#+m.#", "#####"]
    legend:
      "#": { terrain: wall }
      ".": { terrain: floor }
      "+": { terrain: floor, entrance: true }
      "m":
        terrain: floor
        slot: { id: monster-main, kind: monster, required: true, tags: [guard] }
```

Assert defaults are materialized, rows remain unchanged, and the compiled type is `vault`.

Create `vault-validation.test.ts` with table-driven failures for:

```ts
const cases = [
  ['nonrectangular layout', ['#####', '###'], 'layout rows must have equal code-point width'],
  ['missing entrance', ['###', '#.#', '###'], 'at least one entrance'],
  ['missing legend symbol', ['#+x'], 'layout symbol x has no legend entry'],
  ['unused legend symbol', ['#+.'], 'legend symbol x is unused'],
  ['control character', ['#+\u0000'], 'control character'],
  ['tab character', ['#+\t'], 'tab character'],
  ['trailing whitespace symbol', ['#+ '], 'trailing whitespace is ambiguous'],
  ['duplicate slot ID', ['#+mm'], 'duplicate slot monster-main'],
  ['unreachable required slot', ['+##m'], 'required slot monster-main is unreachable'],
] as const;
```

Add compilation tests for multi-code-point legend keys, duplicate fixture suffixes, unsorted/duplicate rotations, invalid depth/range/rarity/weight/margin/placement values, invalid light values, declared-size overflow, vault IDs participating in global uniqueness and content hashing, and the bundled `vault.lampwright-cache` appearing in stable identifier order.

- [ ] **Step 2: Run content tests and verify RED**

Run:

```bash
npm test --workspace @woven-deep/content -- --run test/model.test.ts test/parse-file.test.ts test/vault-validation.test.ts test/compile-directory.test.ts test/default-content.test.ts
```

Expected: FAIL because `vault` is not a content kind and validation does not exist.

- [ ] **Step 3: Add browser-safe vault model types**

Add to `model.ts`:

```ts
export type VaultTerrainName = 'wall' | 'floor' | 'closed-door' | 'pillar' | 'stair-up' | 'stair-down' | 'void';
export type VaultPlacementKind = 'monster' | 'item' | 'trap' | 'npc' | 'fixture' | 'objective';
export type VaultRotation = 0 | 90 | 180 | 270;
export type VaultRarity = 'common' | 'uncommon' | 'rare' | 'legendary';

export interface VaultPlacementSlot {
  readonly id: string;
  readonly kind: VaultPlacementKind;
  readonly required: boolean;
  readonly tags: readonly string[];
}

export interface VaultLightFixture {
  readonly idSuffix: string;
  readonly glyph: string;
  readonly presentationToken: string;
  readonly color: readonly [number, number, number];
  readonly radius: number;
  readonly strength: number;
  readonly enabled: boolean;
}

export interface VaultLegendEntry {
  readonly terrain: VaultTerrainName;
  readonly entrance: boolean;
  readonly light: VaultLightFixture | null;
  readonly slot: VaultPlacementSlot | null;
}

export interface VaultContentEntry {
  readonly kind: 'vault';
  readonly id: ContentId;
  readonly name: string;
  readonly tags: readonly string[];
  readonly minDepth: number;
  readonly maxDepth: number;
  readonly rarity: VaultRarity;
  readonly weight: number;
  readonly maxPerFloor: number;
  readonly margin: number;
  readonly transforms: {
    readonly rotations: readonly VaultRotation[];
    readonly reflectHorizontal: boolean;
  };
  readonly layout: readonly string[];
  readonly legend: Readonly<Record<string, VaultLegendEntry>>;
  readonly entranceCount: number;
  readonly requiredSlotIds: readonly string[];
}
```

Change `ContentKind` and `ContentEntry` to include vault without forcing vaults to have glyph or color fields.

- [ ] **Step 4: Add strict structural and semantic compilation**

In `schema.ts`, create strict Zod schemas with:

```ts
const rgb = z.tuple([z.number().int().min(0).max(255), z.number().int().min(0).max(255), z.number().int().min(0).max(255)]);
const slot = z.strictObject({
  id: slug,
  kind: z.enum(['monster', 'item', 'trap', 'npc', 'fixture', 'objective']),
  required: z.boolean().default(false),
  tags: z.array(slug).default([]),
});
const light = z.strictObject({
  idSuffix: slug,
  glyph,
  presentationToken: stableIdSchema,
  color: rgb,
  radius: z.number().int().min(1).max(32),
  strength: z.number().int().min(1).max(255),
  enabled: z.boolean().default(true),
});
```

Each strict legend entry has `terrain`, default `entrance: false`, default `light: null`, and default `slot: null`. Add a refinement requiring at most one of entrance, light, or slot. Require unique sorted rotations and all numeric ranges from the design.

Implement `validateVaultEntry` with Unicode code-point row widths, exact legend usage, control-format rejection, duplicate slot/fixture suffix checks, and four-way BFS from all entrance cells over potentially traversable terrain names. Required slots must be reached. Return deterministic issues ordered by path and message.

Call it from `compileContentDirectory` for every vault after global duplicate checks. Add `vault` to foundational kinds so bundled/operator content must contain at least one vault after this milestone.

Extend every successful `compile-directory.test.ts` fixture with the minimum valid vault entry used in Step 1. Keep separate missing-foundational tests for monster, item, and vault so the new rule does not accidentally mask the existing two requirements.

- [ ] **Step 5: Add the demonstration vault**

Create `content/vaults/lampwright-cache.yaml` containing a rectangular room with:

- one closed-door entrance
- a central pillar
- an amber environmental light using glyph `*` and token `fixture.lamp`
- one slot of each kind: monster, item, trap, NPC, fixture, and objective
- all required slots connected to the entrance
- rotations 0 and 180 plus optional horizontal reflection

Use stable slot IDs `monster-guard`, `item-cache`, `trap-threshold`, `npc-visitor`, `fixture-focus`, and `objective-shrine`. Use tags instead of concrete later-content references.

- [ ] **Step 6: Run GREEN, validation, and hash checks**

Run:

```bash
npm test --workspace @woven-deep/content
npm run typecheck --workspace @woven-deep/content
npm run content:validate
git diff --check
```

Expected: all content tests pass; validation reports three entries and a new stable hash.

- [ ] **Step 7: Commit**

```bash
git add packages/content content/vaults
git commit -m "feat: compile authored dungeon vaults"
```

---

### Task 3: Pack explored and remembered terrain state

**Files:**
- Create: `packages/engine/src/knowledge.ts`
- Modify: `packages/engine/src/index.ts`
- Create: `packages/engine/test/knowledge.test.ts`

**Interfaces:**
- Produces: `FloorKnowledge`
- Produces: `createUnknownKnowledge`, `isExplored`, `rememberedTile`, `rememberTiles`, `validateKnowledgePacking`
- Save validation and projection consume exact word counts and padding rules.

- [ ] **Step 1: Write failing packing tests**

Create tests:

```ts
import { describe, expect, it } from 'vitest';
import {
  createUnknownKnowledge, isExplored, rememberedTile, rememberTiles,
  validateKnowledgePacking,
} from '../src/index.js';

describe('floor knowledge packing', () => {
  it('packs 35 explored bits and eight remembered nibbles per word', () => {
    const empty = createUnknownKnowledge(35);
    expect(empty.exploredWords).toEqual([0, 0]);
    expect(empty.rememberedTerrainWords).toHaveLength(5);
    expect(empty.rememberedTerrainWords[0]).toBe(0xffff_ffff);
    expect(empty.rememberedTerrainWords[4]).toBe(0x0000_0fff);
  });

  it('updates a cloned value and retains unknown cells', () => {
    const empty = createUnknownKnowledge(10);
    const next = rememberTiles(empty, 10, [{ index: 0, tile: 1 }, { index: 9, tile: 5 }]);
    expect(next).not.toBe(empty);
    expect(isExplored(next, 0)).toBe(true);
    expect(rememberedTile(next, 0)).toBe(1);
    expect(rememberedTile(next, 8)).toBeUndefined();
    expect(rememberedTile(next, 9)).toBe(5);
  });

  it('rejects wrong lengths, nonzero padding, and explored/memory disagreement', () => {
    expect(() => validateKnowledgePacking({ exploredWords: [], rememberedTerrainWords: [] }, 10)).toThrow(/length/);
    expect(() => validateKnowledgePacking({ exploredWords: [1 << 10], rememberedTerrainWords: [0xffff_ffff, 0x0000_00ff] }, 10)).toThrow(/padding/);
    expect(() => validateKnowledgePacking({ exploredWords: [1], rememberedTerrainWords: [0xffff_ffff, 0x0000_00ff] }, 10)).toThrow(/disagree/);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test --workspace @woven-deep/engine -- --run test/knowledge.test.ts`

Expected: FAIL because knowledge APIs are missing.

- [ ] **Step 3: Implement exact packing**

Create:

```ts
import type { TileId } from './model.js';

export interface FloorKnowledge {
  readonly exploredWords: readonly number[];
  readonly rememberedTerrainWords: readonly number[];
}

export const UNKNOWN_TERRAIN_NIBBLE = 15;
export const exploredWordCount = (cellCount: number): number => Math.ceil(cellCount / 32);
export const rememberedWordCount = (cellCount: number): number => Math.ceil(cellCount / 8);
```

`createUnknownKnowledge` fills valid nibbles with `15`, leaves padding nibbles zero, and fills explored words with zero. `rememberTiles` validates unique in-range indexes and tile IDs, clones both word arrays once, sets explored bits, and replaces four-bit terrain values. All returned words use `>>> 0`.

`validateKnowledgePacking` requires unsigned 32-bit words, exact lengths, zero padding beyond `cellCount`, and `explored === (nibble !== 15)` for every real cell.

- [ ] **Step 4: Run GREEN and engine checks**

Run:

```bash
npm test --workspace @woven-deep/engine -- --run test/knowledge.test.ts
npm run typecheck --workspace @woven-deep/engine
npm test --workspace @woven-deep/engine
git diff --check
```

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src packages/engine/test/knowledge.test.ts
git commit -m "feat: pack remembered dungeon terrain"
```

---

### Task 4: Isolate ROT.js and compute sealed-corner sight

**Files:**
- Create: `packages/engine/src/rot-adapter.ts`
- Create: `packages/engine/src/visibility.ts`
- Modify: `packages/engine/src/index.ts`
- Create: `packages/engine/test/rot-adapter.test.ts`
- Create: `packages/engine/test/visibility.test.ts`

**Interfaces:**
- Produces: `withRotSeed<T>(seed, operation): T`
- Produces: `computeFieldOfView(input): readonly number[]`
- Produces: `isVisible(words, index): boolean`
- Lighting and perception reuse the same opacity and sealed-corner behavior.

- [ ] **Step 1: Write failing ROT isolation tests**

Create tests that capture `RNG.getState()`, call `withRotSeed(123, () => [RNG.getUniform(), RNG.getUniform()])`, and assert:

- the same seed returns the same two values
- caller state is restored after success
- caller state is restored when the callback throws
- seed zero is rejected
- nested calls restore their immediate caller state

- [ ] **Step 2: Write failing sight behavior tests**

Use this concrete fixture style:

```ts
const openFloor = (width: number, height: number): TileId[] =>
  Array.from({ length: width * height }, () => 1 as TileId);
const index = (width: number, x: number, y: number): number => y * width + x;

it('shows a blocker but not the cell directly behind it', () => {
  const tiles = openFloor(7, 7);
  tiles[index(7, 3, 2)] = 0;
  const visible = computeFieldOfView({ width: 7, height: 7, tiles, origin: { x: 3, y: 3 }, radius: 4 });
  expect(isVisible(visible, index(7, 3, 2))).toBe(true);
  expect(isVisible(visible, index(7, 3, 1))).toBe(false);
});

it('blocks a diagonal between two orthogonal walls', () => {
  const tiles = openFloor(4, 4);
  tiles[index(4, 2, 1)] = 0;
  tiles[index(4, 1, 2)] = 0;
  const visible = computeFieldOfView({ width: 4, height: 4, tiles, origin: { x: 1, y: 1 }, radius: 3 });
  expect(isVisible(visible, index(4, 2, 2))).toBe(false);
});

it('allows a diagonal when only one orthogonal side is blocked', () => {
  const tiles = openFloor(4, 4);
  tiles[index(4, 2, 1)] = 0;
  const visible = computeFieldOfView({ width: 4, height: 4, tiles, origin: { x: 1, y: 1 }, radius: 3 });
  expect(isVisible(visible, index(4, 2, 2))).toBe(true);
});

it('is symmetric when endpoints are reversed', () => {
  const tiles = openFloor(7, 7);
  tiles[index(7, 3, 2)] = 0;
  const canSee = (from: Point, to: Point): boolean => isVisible(
    computeFieldOfView({ width: 7, height: 7, tiles, origin: from, radius: 7 }),
    index(7, to.x, to.y),
  );
  expect(canSee({ x: 1, y: 1 }, { x: 5, y: 4 })).toBe(canSee({ x: 5, y: 4 }, { x: 1, y: 1 }));
});

it('uses a circular radius and includes its origin', () => {
  const tiles = openFloor(7, 7);
  const visible = computeFieldOfView({ width: 7, height: 7, tiles, origin: { x: 3, y: 3 }, radius: 3 });
  expect(isVisible(visible, index(7, 3, 3))).toBe(true);
  expect(isVisible(visible, index(7, 6, 3))).toBe(true);
  expect(isVisible(visible, index(7, 6, 6))).toBe(false);
});
```

Also assert the complete visible coordinate list for the sealed-corner fixture in row-major order, not a screenshot.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
npm test --workspace @woven-deep/engine -- --run test/rot-adapter.test.ts test/visibility.test.ts
```

Expected: FAIL because adapters do not exist.

- [ ] **Step 4: Implement synchronous random-state isolation**

Create `rot-adapter.ts` using `RNG` from ROT.js:

```ts
import { RNG } from 'rot-js';

export function withRotSeed<T>(seed: number, operation: () => T): T {
  if (!Number.isInteger(seed) || seed <= 0 || seed > 0xffff_ffff) {
    throw new RangeError('ROT seed must be a nonzero unsigned 32-bit integer');
  }
  const previous = [...RNG.getState()] as ReturnType<typeof RNG.getState>;
  try {
    RNG.setSeed(seed);
    return operation();
  } finally {
    RNG.setState(previous);
  }
}
```

Do not export ROT.js itself.

- [ ] **Step 5: Implement FOV plus sealed-corner filtering**

`computeFieldOfView` validates dimensions, origin, radius, tile length, and tile IDs. Build `FOV.PreciseShadowcasting` with topology 8 and an in-bounds transparency callback based on `tileDefinition(tile).opaque`.

Collect candidate indexes from the callback, then run a symmetric supercover traversal from origin to each target. Whenever a step changes both axes, reject the target if both orthogonal side cells are opaque. Include visible blocking targets, exclude cells outside `ceil(sqrt(dx² + dy²)) <= radius`, and return a packed bitset.

Use this request shape:

```ts
export interface FieldOfViewInput {
  readonly width: number;
  readonly height: number;
  readonly tiles: readonly TileId[];
  readonly origin: Readonly<{ x: number; y: number }>;
  readonly radius: number;
}
```

- [ ] **Step 6: Run GREEN, browser boundary, and repeated cases**

Run:

```bash
npm test --workspace @woven-deep/engine -- --run test/rot-adapter.test.ts test/visibility.test.ts test/browser-boundary.test.ts
npm run typecheck --workspace @woven-deep/engine
npm test --workspace @woven-deep/engine
git diff --check
```

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src packages/engine/test
git commit -m "feat: compute occluded dungeon sight"
```

---
### Task 5: Blend ambient and multiple colored lights

**Files:**
- Create: `packages/engine/src/light-model.ts`
- Create: `packages/engine/src/lighting.ts`
- Modify: `packages/engine/src/index.ts`
- Create: `packages/engine/test/lighting.test.ts`

**Interfaces:**
- Produces: `RgbColor`, `AmbientLight`, `LightSource`, `IlluminationField`
- Produces: `computeIllumination(input): IlluminationField`
- Projection consumes row-major RGB channels and intensities.

- [ ] **Step 1: Write failing exact-value lighting tests**

Create a 7×5 open-floor fixture and use concrete assertions:

```ts
const width = 7;
const height = 5;
const tiles = Array.from({ length: width * height }, () => 1 as TileId);
const at = (x: number, y: number): number => y * width + x;
const dark = { color: [255, 255, 255] as const, strength: 0 };
const fixed = (lightId: string, x: number, y: number, color: RgbColor): LightSource => ({
  lightId, location: { type: 'fixed', x, y }, color,
  radius: 2, strength: 255, enabled: true, falloff: 'linear',
  vaultPlacementId: null, presentation: null,
});

it('uses exact integer linear falloff', () => {
  const field = computeIllumination({ width, height, tiles, ambient: dark,
    lights: [fixed('light.red', 3, 2, [255, 0, 0])], actors: new Map() });
  expect([field.red[at(3, 2)], field.red[at(4, 2)], field.red[at(5, 2)]]).toEqual([255, 170, 85]);
});

it('supports absolute darkness and low colored ambient light', () => {
  const absolute = computeIllumination({ width, height, tiles, ambient: dark, lights: [], actors: new Map() });
  const low = computeIllumination({ width, height, tiles,
    ambient: { color: [80, 100, 120], strength: 5 }, lights: [], actors: new Map() });
  expect([absolute.red[0], absolute.green[0], absolute.blue[0]]).toEqual([0, 0, 0]);
  expect([low.red[0], low.green[0], low.blue[0]]).toEqual([1, 1, 2]);
});

it('adds differently colored sources and caps every channel', () => {
  const field = computeIllumination({ width, height, tiles, ambient: dark, actors: new Map(), lights: [
    fixed('light.blue', 3, 2, [0, 0, 255]),
    fixed('light.red-a', 3, 2, [255, 0, 0]),
    fixed('light.red-b', 3, 2, [255, 0, 0]),
  ] });
  expect([field.red[at(3, 2)], field.green[at(3, 2)], field.blue[at(3, 2)]]).toEqual([255, 0, 255]);
  expect(field.intensity[at(3, 2)]).toBe(255);
});

it('occludes light behind a wall', () => {
  const blocked = [...tiles];
  blocked[at(3, 2)] = 0;
  const field = computeIllumination({ width, height, tiles: blocked, ambient: dark,
    lights: [fixed('light.red', 3, 3, [255, 0, 0])], actors: new Map() });
  expect(field.red[at(3, 2)]).toBeGreaterThan(0);
  expect(field.red[at(3, 1)]).toBe(0);
});

it('resolves actor-attached sources', () => {
  const source: LightSource = { ...fixed('light.hero', 0, 0, [255, 255, 255]), location: { type: 'actor', actorId: 'hero.demo' } };
  const field = computeIllumination({ width, height, tiles, ambient: dark, lights: [source],
    actors: new Map([['hero.demo', { x: 3, y: 2 }]]) });
  expect(field.intensity[at(3, 2)]).toBe(255);
  expect(() => computeIllumination({ width, height, tiles, ambient: dark, lights: [source], actors: new Map() })).toThrow(/hero.demo/);
});
```

Also reject fractional/out-of-range colors, radius outside 1–32, strength outside 1–255, duplicate light IDs, fixed void positions, unsupported falloff identifiers, actor-attached fixture ownership/presentation, and vault ownership without fixed location and presentation.

- [ ] **Step 2: Run lighting tests and verify RED**

Run: `npm test --workspace @woven-deep/engine -- --run test/lighting.test.ts`

Expected: FAIL because lighting modules are absent.

- [ ] **Step 3: Define light state**

Create `light-model.ts`:

```ts
import type { OpaqueId } from './model.js';

export type RgbColor = readonly [number, number, number];
export interface AmbientLight { readonly color: RgbColor; readonly strength: number }
export type LightLocation =
  | { readonly type: 'fixed'; readonly x: number; readonly y: number }
  | { readonly type: 'actor'; readonly actorId: OpaqueId };
export interface LightSource {
  readonly lightId: OpaqueId;
  readonly location: LightLocation;
  readonly color: RgbColor;
  readonly radius: number;
  readonly strength: number;
  readonly enabled: boolean;
  readonly falloff: 'linear';
  readonly vaultPlacementId: OpaqueId | null;
  readonly presentation: Readonly<{ glyph: string; token: OpaqueId }> | null;
}
export interface IlluminationField {
  readonly red: readonly number[];
  readonly green: readonly number[];
  readonly blue: readonly number[];
  readonly intensity: readonly number[];
}
```

- [ ] **Step 4: Implement deterministic illumination**

Use:

```ts
distance = Math.ceil(Math.sqrt(dx * dx + dy * dy));
sourceScalar = Math.floor(strength * (radius + 1 - distance) / (radius + 1));
channelContribution = Math.floor(channel * sourceScalar / 255);
ambientChannel = Math.floor(ambientColorChannel * ambientStrength / 255);
```

Initialize every real cell with ambient channels. Sort sources by `lightId` before processing so input order cannot affect validation or diagnostics. Resolve actor locations through a supplied immutable `ReadonlyMap<OpaqueId, Point>`. For every enabled source, call `computeFieldOfView` from Task 4, add contributions only for visible cells in range, cap channels at 255, then set intensity to `Math.max(red, green, blue)`.

Return fresh arrays and do not change floor, sources, actors, or ambient values.

- [ ] **Step 5: Run GREEN and all sight/light tests**

Run:

```bash
npm test --workspace @woven-deep/engine -- --run test/visibility.test.ts test/lighting.test.ts test/browser-boundary.test.ts
npm run typecheck --workspace @woven-deep/engine
npm test --workspace @woven-deep/engine
git diff --check
```

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src packages/engine/test/lighting.test.ts
git commit -m "feat: blend occluded dungeon lights"
```

---

### Task 6: Refresh knowledge and build observable projections

**Files:**
- Create: `packages/engine/src/perception.ts`
- Create: `packages/engine/src/projection.ts`
- Modify: `packages/engine/src/index.ts`
- Create: `packages/engine/test/perception.test.ts`
- Create: `packages/engine/test/projection.test.ts`

**Interfaces:**
- Produces: `PerceptionFloor`, `PerceptionHero`, `refreshKnowledge(input)`
- Produces: `ObservableCell`, `ObservableFloorProjection`, `projectFloor(input)`
- Produces: `LightPreview`, calculated without changing state.

- [ ] **Step 1: Write failing perception-memory tests**

Use a 9×7 fixture containing a wall, a pillar, a closed door, a carried torch, and a fixed blue light. Cover:

```ts
it('marks only illuminated hero-FOV cells as explored');
it('shows no cells beyond sight in absolute darkness without a source');
it('reveals dim FOV cells when ambient strength is nonzero');
it('retains the last terrain after an unseen door changes');
it('moves actor-attached light when the hero position changes');
it('returns identical bytes for identical inputs and does not mutate them');
```

The unseen-door test first observes tile 2, moves the hero behind occlusion, changes authoritative terrain to tile 1, and asserts remembered terrain remains tile 2.

- [ ] **Step 2: Write failing hidden-state projection tests**

Assert explicit cells:

- unknown: coordinates and `knowledge: 'unknown'` only; no tile, glyph, token, tint, fixture, or intensity above zero
- remembered: last remembered tile presentation, dim intensity 24, no fixture or current hidden terrain
- visible: current tile, glyph/token, RGB tint, intensity, and visible light fixture presentation
- preview: emitted separately, clipped to visible or explored cells, never creating knowledge

For the visible fixture cell, assert the exact `fixture: { lightId, glyph, token }` object copied from the fixed light. Move the hero behind occlusion and assert the same cell becomes remembered with no `fixture` field.

Serialize projections with `stableJson` and prove reordering authoritative light input does not change bytes.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
npm test --workspace @woven-deep/engine -- --run test/perception.test.ts test/projection.test.ts
```

Expected: FAIL because perception and projection APIs do not exist.

- [ ] **Step 4: Implement knowledge refresh**

Use structural inputs so the functions do not depend on `ActiveRun` yet:

```ts
export interface PerceptionFloor {
  readonly floorId: OpaqueId;
  readonly width: number;
  readonly height: number;
  readonly tiles: readonly TileId[];
  readonly ambient: AmbientLight;
  readonly lights: readonly LightSource[];
  readonly knowledge: FloorKnowledge;
}

export interface PerceptionHero {
  readonly heroId: OpaqueId;
  readonly x: number;
  readonly y: number;
  readonly sightRadius: number;
}
```

`refreshKnowledge` computes illumination, then hero FOV, then remembers current tiles where FOV is set and illumination intensity is nonzero. It returns `{ knowledge, visibilityWords, illumination }`; only `knowledge` is saved later.

- [ ] **Step 5: Implement projection and previews**

Define:

```ts
export type KnowledgeState = 'unknown' | 'remembered' | 'visible';
export interface ObservableCell {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly knowledge: KnowledgeState;
  readonly tileId?: TileId;
  readonly glyph?: string;
  readonly token?: string;
  readonly intensity: number;
  readonly tint?: RgbColor;
  readonly previewIntensity?: number;
  readonly fixture?: Readonly<{
    lightId: OpaqueId;
    glyph: string;
    token: OpaqueId;
  }>;
}
export interface ObservableFloorProjection {
  readonly floorId: OpaqueId;
  readonly width: number;
  readonly height: number;
  readonly cells: readonly ObservableCell[];
}
```

Because `exactOptionalPropertyTypes` is enabled, build each union-shaped cell explicitly instead of assigning `undefined`. Include `fixture` only for a currently visible fixed light whose presentation is non-null, even when that fixture is disabled; unknown and remembered cells never expose fixture ownership or presentation. Save validation prevents two presented fixtures from occupying one cell. For preview, compute a temporary hero-fixed source through normal FOV/falloff but intersect its output with `visible ∪ explored`. Do not merge preview values into authoritative illumination.

- [ ] **Step 6: Run GREEN and byte-stability checks**

Run:

```bash
npm test --workspace @woven-deep/engine -- --run test/knowledge.test.ts test/visibility.test.ts test/lighting.test.ts test/perception.test.ts test/projection.test.ts
npm run typecheck --workspace @woven-deep/engine
npm test --workspace @woven-deep/engine
git diff --check
```

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src packages/engine/test
git commit -m "feat: project visible and remembered terrain"
```

---

### Task 7: Move active-run saves to schema v2

**Files:**
- Modify: `packages/engine/src/model.ts`
- Modify: `packages/engine/src/versions.ts`
- Create: `packages/engine/src/save-schema-v1.ts`
- Modify: `packages/engine/src/save-schema.ts`
- Modify: `packages/engine/src/migration.ts`
- Modify: `packages/engine/src/fixture.ts`
- Modify: `packages/engine/src/index.ts`
- Preserve: `packages/engine/test/fixtures/v0-save.json`
- Preserve: `packages/engine/test/fixtures/v1-migrated-save.json`
- Create: `packages/engine/test/fixtures/v2-migrated-save.json`
- Modify: `packages/engine/test/model.test.ts`
- Modify: `packages/engine/test/save-codec.test.ts`
- Modify: `packages/engine/test/migration.test.ts`

**Interfaces:**
- Changes: `SAVE_SCHEMA_VERSION = 2`
- Produces: v2 `ActiveRun`, expanded `FloorSnapshot`, `VaultPlacement`, `FloorPlacementSlot`
- Produces: `migrateV0ToV1`, `migrateV1ToV2`, ordered `migrateActiveRun`
- Existing `encodeActiveRun` and `decodeActiveRun` remain the public save boundary.

- [ ] **Step 1: Freeze the current v1 validator before changing models**

Move the current structural v1 schemas and semantic validator into `save-schema-v1.ts`. Its return type is a private `ActiveRunV1` interface declared in that file, with tile IDs 0/1, generator version 1, and the exact current hero/floor fields.

Export only:

```ts
export type ActiveRunV1 = z.infer<typeof activeRunV1Schema>;
export function validateActiveRunV1(input: unknown): ActiveRunV1;
```

Run existing save and migration tests before other edits and require them to remain green.

- [ ] **Step 2: Write failing v2 model and save tests**

Update model tests to expect schema version 2. Add save corruption cases for:

- tile IDs outside 0–6
- wrong knowledge word lengths and padding
- explored/memory disagreement
- invalid ambient RGB/strength
- invalid or duplicate light IDs
- malformed fixture presentation or a vault-owned light whose placement does not exist
- unresolved actor attachment
- fixed light on void/out of bounds
- invalid hero sight radius
- stair position not matching stair tile
- duplicate vault/slot/fixture IDs
- overlapping or out-of-bounds vault placements
- derived fields such as `visibilityWords`, `illumination`, `projection`, or `generationReport` present in the save

Add a round-trip with a closed door, pillar, stairs, one vault, one vault-owned fixed light with glyph/token presentation, one hero-attached light with null ownership/presentation, and nonempty remembered terrain.

- [ ] **Step 3: Write failing ordered migration tests**

Change migration tests to assert:

```ts
const v0 = JSON.parse(await readFile(fixtureUrl('v0-save.json'), 'utf8'));
const v1Expected = (await readFile(fixtureUrl('v1-migrated-save.json'), 'utf8')).trimEnd();
expect(stableJson(migrateV0ToV1(v0))).toBe(v1Expected);

const v1 = JSON.parse(v1Expected);
const v2Expected = (await readFile(fixtureUrl('v2-migrated-save.json'), 'utf8')).trimEnd();
expect(encodeActiveRun(migrateV1ToV2(v1))).toBe(v2Expected);
expect(encodeActiveRun(decodeActiveRun(JSON.stringify(v0)))).toBe(v2Expected);
```

Also assert v2 idempotence and unsupported versions `-1`, `3`, and `999`.

- [ ] **Step 4: Run save tests and verify RED**

Run:

```bash
npm test --workspace @woven-deep/engine -- --run test/model.test.ts test/save-codec.test.ts test/migration.test.ts
```

Expected: FAIL because v2 fields, migration, and fixture are missing.

- [ ] **Step 5: Publish exact v2 state types**

Change `ActiveRun.schemaVersion` to 2. Add `sightRadius` to `HeroState`. Expand `FloorSnapshot` with:

```ts
readonly themeId: OpaqueId;
readonly ambient: AmbientLight;
readonly knowledge: FloorKnowledge;
readonly lights: readonly LightSource[];
readonly stairUp: Readonly<{ x: number; y: number }> | null;
readonly stairDown: Readonly<{ x: number; y: number }> | null;
readonly vaults: readonly VaultPlacement[];
readonly placementSlots: readonly FloorPlacementSlot[];
```

Define stable transforms and bounds:

```ts
export interface VaultPlacement {
  readonly placementId: OpaqueId;
  readonly vaultId: OpaqueId;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: 0 | 90 | 180 | 270;
  readonly reflected: boolean;
  readonly entrances: readonly Readonly<{ x: number; y: number }>[];
}
export interface FloorPlacementSlot {
  readonly slotId: OpaqueId;
  readonly vaultPlacementId: OpaqueId;
  readonly kind: 'monster' | 'item' | 'trap' | 'npc' | 'fixture' | 'objective';
  readonly required: boolean;
  readonly tags: readonly string[];
  readonly x: number;
  readonly y: number;
}
```

Allow floor generator versions 1 and 2. Require arrays with stable ID order.

- [ ] **Step 6: Implement strict v2 schema and semantics**

Use `z.strictObject` throughout. Reuse `validateKnowledgePacking`, terrain definitions, light validation, and existing safe identifiers/numbers. Require:

- hero/entities/lights/slots on valid cells according to their rules
- stairs distinct when both exist and exact tile matches
- vault bounds and entrances in bounds with no placement overlap
- ordered unique light, vault, and slot IDs
- attached actor IDs resolve to the hero or a saved entity
- actor-attached lights have null vault ownership and null fixture presentation
- each non-null `vaultPlacementId` resolves to exactly one saved placement; vault-owned lights are fixed and have non-null fixture presentation
- no two fixed lights with non-null presentation occupy the same cell
- full current command-history validation with `movementBlockReason`
- all v1 invariants still applicable

Do not store any derived perception fields.

- [ ] **Step 7: Implement `v0 → v1 → v2` migration**

Retain the exact existing v0-to-v1 code in `migrateV0ToV1`. Implement `migrateV1ToV2` by:

```ts
const floor = {
  ...legacyFloor,
  themeId: 'legacy.fixed',
  ambient: { color: [255, 255, 255] as const, strength: 255 },
  knowledge: createUnknownKnowledge(legacyFloor.width * legacyFloor.height),
  lights: [], stairUp: null, stairDown: null, vaults: [], placementSlots: [],
};
const hero = { ...legacy.hero, sightRadius: 12 };
const refreshed = refreshKnowledge({ floor, hero, actors: new Map([[hero.heroId, hero]]) });
```

Save the refreshed knowledge and validate v2. Do not regenerate terrain. Wrap v1 validation and v2 semantic failures as `migration_failed` with safe paths.

Generate a candidate v2 fixture once into `/tmp`, independently inspect field preservation, knowledge word sizes, remembered cells, and stable key order, then add the single-line JSON plus one newline to `v2-migrated-save.json`. Tests read but never overwrite it.

- [ ] **Step 8: Update the fixed demo run**

`createDemoRun` returns a valid v2 run with theme `theme.demo`, neutral full ambient, sight radius 12, no vaults/slots/lights/stairs, and knowledge refreshed from the hero position. Keep its original 7×5 terrain and identifiers so reducer and CLI behavior remains comparable.

- [ ] **Step 9: Run GREEN and all compatibility suites**

Run:

```bash
npm test --workspace @woven-deep/engine -- --run test/model.test.ts test/save-codec.test.ts test/migration.test.ts test/reducer.test.ts test/replay.test.ts test/cli.test.ts
npm run typecheck --workspace @woven-deep/engine
npm test --workspace @woven-deep/engine
npm run engine:demo
git diff --check
```

Expected: both legacy fixtures remain stable; every decoded save is v2; replay remains byte-identical across reload.

- [ ] **Step 10: Commit**

```bash
git add packages/engine/src packages/engine/test
git commit -m "feat: migrate active runs to visibility saves"
```

---

### Task 8: Integrate terrain and perception into command resolution

**Files:**
- Modify: `packages/engine/src/reducer.ts`
- Modify: `packages/engine/src/save-schema.ts`
- Modify: `packages/engine/test/reducer.test.ts`
- Modify: `packages/engine/test/save-codec.test.ts`
- Modify: `packages/engine/test/replay.test.ts`

**Interfaces:**
- Changes: movement uses `movementBlockReason(tileId)`.
- Changes: applied movement refreshes active-floor saved knowledge.
- Preserves: command IDs, revisions, events, deduplication, and recent-ring limits.

- [ ] **Step 1: Write failing expanded-terrain movement tests**

Add table-driven tests for movement into wall, closed door, pillar, and void, expecting `blocked.wall`, `blocked.door`, `blocked.pillar`, and `blocked.void`. Assert floor, hero, knowledge, revision, and turn behavior for each invalid action.

Add tests proving floor, stair-up, and stair-down are walkable. Stair movement stays on the same floor.

- [ ] **Step 2: Write failing perception integration tests**

Create a dark corridor run with a hero-attached radius-2 light. Move east and assert:

- the light resolves at the new position
- newly visible cells enter knowledge
- cells left behind remain remembered
- the input run is unchanged
- a duplicate command returns the exact previously recorded result/state without refreshing again
- stale/conflicting/invalid commands do not reveal new cells

- [ ] **Step 3: Run reducer tests and verify RED**

Run: `npm test --workspace @woven-deep/engine -- --run test/reducer.test.ts test/save-codec.test.ts test/replay.test.ts`

Expected: FAIL because reducer still treats only wall as blocked and does not refresh knowledge.

- [ ] **Step 4: Use terrain registry and refresh after applied movement**

Replace the nested wall check with:

```ts
const reason = index === undefined ? 'blocked.bounds' : movementBlockReason(floor.tiles[index]!);
```

After recording an applied movement, locate the active floor, call the Task 6 refresh with the moved hero and actor map, replace only that floor's knowledge, and return floors in the same order. Do not recompute unchanged waiting, invalid, rejected, or duplicate state.

Update v2 retained-history validation to derive invalid reasons through `movementBlockReason`.

- [ ] **Step 5: Run GREEN and deterministic replay gates**

Run:

```bash
npm test --workspace @woven-deep/engine -- --run test/reducer.test.ts test/save-codec.test.ts test/replay.test.ts test/cli.test.ts
npm run typecheck --workspace @woven-deep/engine
npm test --workspace @woven-deep/engine
npm run engine:demo
git diff --check
```

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/reducer.ts packages/engine/src/save-schema.ts packages/engine/test
git commit -m "feat: refresh sight after dungeon movement"
```

---

### Task 9: Generate connected classic topology with deterministic fallback

**Files:**
- Create: `packages/engine/src/generation-model.ts`
- Create: `packages/engine/src/generation-random.ts`
- Create: `packages/engine/src/generation-mask.ts`
- Create: `packages/engine/src/connectivity.ts`
- Create: `packages/engine/src/rot-topology.ts`
- Create: `packages/engine/src/fallback-floor.ts`
- Create: `packages/engine/src/generate-topology.ts`
- Modify: `packages/engine/src/index.ts`
- Create: `packages/engine/test/fixtures/classic-topology-seed-1.json`
- Create: `packages/engine/test/generation-random.test.ts`
- Create: `packages/engine/test/generation-mask.test.ts`
- Create: `packages/engine/test/connectivity.test.ts`
- Create: `packages/engine/test/generate-topology.test.ts`

**Interfaces:**
- Produces: `FloorSeedAllocation`, `allocateFloorSeed`, `deriveAttemptSeed`
- Produces: `GenerationTheme`, `CLASSIC_THEME_ID`, `createClassicTheme`, `GenerateTopologyRequest`, `TopologyDraft`, `GenerationReport`
- Produces: `GenerationRejectionCode`, `GenerationError`
- Produces: `generateTopologyAttempt(request, attempt): TopologyAttemptResult`
- Produces: `generateTopology(request): TopologyDraft`
- Task 10 consumes rooms, corridors, the post-topology vault state, tiles, stairs, and rejection report.

- [ ] **Step 1: Write failing floor-seed and attempt derivation tests**

Add tests proving:

- four xoshiro steps allocate one nonzero floor seed and return the fourth next state
- only a supplied generation state changes; named run streams passed by the caller remain untouched
- the same floor seed and attempt number derive the same state
- attempts 0–7 derive eight distinct nonzero states
- invalid all-zero states and unsafe attempt numbers are rejected

Lock the seed-1 allocation and attempt-0 vectors as explicit four-word arrays calculated by a one-off reference implementation that copies the formulas without importing engine production code.

- [ ] **Step 2: Write failing mask and connectivity tests**

Test classic and irregular masks:

```ts
it('creates a classic mask with an excluded outer border');
it('accepts one connected irregular interior component');
it('rejects wrong word counts, border cells, disconnected regions, and too few cells');
```

Connectivity fixtures assert north/east/south/west traversal, row-major tie-breaking, all potentially traversable tiles in one component, closed doors counted as potential paths, and diagonal-only contact rejected.

- [ ] **Step 3: Write failing topology properties**

For fixed seed `[1,2,3,4]`, 80×25 classic theme, assert:

- at least six rooms and one corridor
- distinct stair tiles 4 and 5
- stair route distance at least 20
- all potentially traversable cells connected
- tiles are row-major, in range 0–6, and never walkable outside the mask
- exact same `stableJson` on two calls
- caller ROT.js state, request, mask, and seed are unchanged

Read `classic-topology-seed-1.json` and require `stableJson(generateTopology(request))` to equal its single stable-JSON line after `trimEnd()`.

Loop across 200 deterministic seeds at 40×20 and assert successful normal or fallback output. Force fallback with `attemptLimit: 1` and an injected topology factory that returns the safe rejection code `topology.empty`; assert the fallback is connected, deterministic, and contains no vaults.

Mock `Date.now()` to very different values around two generation calls and assert identical output, proving ROT.js timeout cannot choose topology.

- [ ] **Step 4: Run generation tests and verify RED**

Run:

```bash
npm test --workspace @woven-deep/engine -- --run test/generation-random.test.ts test/generation-mask.test.ts test/connectivity.test.ts test/generate-topology.test.ts
```

Expected: FAIL because generation modules are absent.

- [ ] **Step 5: Define generation models**

Create:

```ts
export interface FloorSeedAllocation {
  readonly floorSeed: Uint32State;
  readonly nextGenerationState: Uint32State;
}
export interface GenerationTheme {
  readonly themeId: OpaqueId;
  readonly maskWords: readonly number[];
  readonly ambient: AmbientLight;
  readonly minimumRooms: number;
  readonly minimumStairDistance: number;
}
export const CLASSIC_THEME_ID = 'theme.classic';
export interface ClassicThemeSettings {
  readonly ambient: AmbientLight;
  readonly minimumRooms?: number;
  readonly minimumStairDistance?: number;
}
export type GenerationRejectionCode =
  | 'topology.empty'
  | 'topology.outside-mask'
  | 'topology.room-budget'
  | 'topology.invalid-geometry'
  | 'vault.required-unavailable'
  | 'vault.no-valid-placement'
  | 'stairs.no-valid-pair'
  | 'connectivity.disconnected';
export class GenerationError extends Error {
  readonly code: 'generation.invalid-request' | 'generation.invalid-theme' | 'generation.fallback-invariant';
  constructor(code: GenerationError['code'], message: string) {
    super(message);
    this.name = 'GenerationError';
    this.code = code;
  }
}
export interface RoomBounds {
  readonly roomId: OpaqueId;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}
export interface CorridorRecord {
  readonly corridorId: OpaqueId;
  readonly start: Readonly<{ x: number; y: number }>;
  readonly end: Readonly<{ x: number; y: number }>;
}
export interface GenerationReport {
  readonly generatorVersion: 2;
  readonly attempt: number | null;
  readonly fallback: boolean;
  readonly roomCount: number;
  readonly corridorCount: number;
  readonly vaults: readonly Readonly<{ vaultId: OpaqueId; rotation: 0 | 90 | 180 | 270; reflected: boolean }>[];
  readonly stairUp: Readonly<{ x: number; y: number }>;
  readonly stairDown: Readonly<{ x: number; y: number }>;
  readonly stairDistance: number;
  readonly traversableCellCount: number;
  readonly connected: true;
  readonly rejectionCounts: Readonly<Partial<Record<GenerationRejectionCode, number>>>;
}
export interface TopologyDraft {
  readonly floorId: OpaqueId;
  readonly floorSeed: Uint32State;
  readonly depth: number;
  readonly themeId: OpaqueId;
  readonly width: number;
  readonly height: number;
  readonly tiles: readonly TileId[];
  readonly rooms: readonly RoomBounds[];
  readonly corridors: readonly CorridorRecord[];
  readonly stairUp: Readonly<{ x: number; y: number }>;
  readonly stairDown: Readonly<{ x: number; y: number }>;
  readonly vaultState: Uint32State;
  readonly report: GenerationReport;
}
```

`createClassicTheme(width, height, settings)` publishes `theme.classic`, the classic mask, ambient values, room budget, and stair distance through one registered TypeScript path. Tests may construct a `GenerationTheme` with an irregular validated mask and a test-only theme ID.

`GenerateTopologyRequest` carries floor ID/seed, depth, width, height, theme, attempt limit default 8, and an optional injected topology factory used only by tests. Validate all ranges before using ROT.js and throw `GenerationError` with a safe code for invalid requests/themes or an impossible fallback. `TopologyAttemptResult` is a discriminated union of `{ ok: true, draft }` and `{ ok: false, code: GenerationRejectionCode }`; rejected attempts never expose partial tiles.

- [ ] **Step 6: Implement seeds, masks, and connectivity**

`allocateFloorSeed` runs `nextUint32` four times, uses the four output values as the floor seed, and returns the fourth step state. Apply the existing nonzero fallback if needed. `deriveAttemptSeed` mixes every floor-seed word with attempt+1 through the existing SplitMix32 formula exposed as a new tested `deriveSeed` helper in `random.ts`.

Represent masks as packed bitsets with exact zero padding. `classicMask(width,height)` sets every nonborder cell. `validateThemeMask` performs a four-way flood over set cells and applies size/fallback preconditions. Implement `createClassicTheme(width, height, settings): GenerationTheme` with defaults of six rooms and stair distance 20; it validates dimensions and settings before returning the registered classic theme.

`analyzeConnectivity` returns visited words, component size, and deterministic shortest route. Neighbor order is north, east, south, west.

- [ ] **Step 7: Adapt ROT.js Digger without time-dependent output**

Inside `withRotSeed(foldSeed(attemptState), ...)`, construct:

```ts
new Map.Digger(width, height, {
  dugPercentage: 0.28,
  roomWidth: [4, 12],
  roomHeight: [3, 8],
  corridorLength: [2, 12],
  timeLimit: Number.MAX_SAFE_INTEGER,
});
```

The effectively unreachable timeout ensures `Date.now()` cannot select the result. Copy callback cells to a fresh row-major array. Copy `getRooms()` and `getCorridors()` through documented getters into stable `room.*` and `corridor.*` records. Never return ROT.js feature objects.

Reject attempts that carve outside the mask, miss the room budget, have invalid geometry, cannot place sufficiently distant stairs, or fail connectivity. Select stair rooms and farthest valid cells with attempt-local xoshiro choices plus row-major tie-breaking. Store the resulting next xoshiro state as `vaultState`; Task 10 must continue from it and must not restart the attempt seed.

Put one attempt in `generateTopologyAttempt`. `generateTopology` is a topology-only coordinator used by Task 9 tests: it calls the attempt primitive through the configured limit, counts rejection codes, and then uses the fallback. Task 10 reuses the attempt primitive so vault rejection can reject the same whole attempt before final floor publication.

- [ ] **Step 8: Implement the deterministic fallback**

Use the validated mask component. Choose a row-major stable cell, BFS to a farthest endpoint, BFS again to the second endpoint, reconstruct the shortest path, carve it, and expand clipped three-by-three rooms at both endpoints and the midpoint. Place stair-up/down at endpoints, omit vaults, then run normal final validation.

Return safe rejection counts from failed normal attempts. Throw only if the already-validated mask cannot create the fallback.

- [ ] **Step 9: Run GREEN and stress checks**

Before GREEN, emit one candidate fixed-seed topology to `/tmp`, inspect its dimensions, masks, room/corridor bounds, stair tiles, route distance, connectivity, and stable ordering with an independent test-only BFS, then add it as the checked-in single-line `classic-topology-seed-1.json`. The asserting test must never update this file.

Run:

```bash
npm test --workspace @woven-deep/engine -- --run test/generation-random.test.ts test/generation-mask.test.ts test/connectivity.test.ts test/generate-topology.test.ts test/rot-adapter.test.ts
npm run typecheck --workspace @woven-deep/engine
npm test --workspace @woven-deep/engine
git diff --check
```

- [ ] **Step 10: Commit**

```bash
git add packages/engine/src packages/engine/test
git commit -m "feat: generate connected classic dungeons"
```

---

### Task 10: Transform and place authored vaults

**Files:**
- Create: `packages/engine/src/vault-transform.ts`
- Create: `packages/engine/src/vault-placement.ts`
- Create: `packages/engine/src/generate-floor.ts`
- Modify: `packages/engine/src/index.ts`
- Create: `packages/engine/test/fixtures/generated-floor-seed-1.json`
- Create: `packages/engine/test/vault-transform.test.ts`
- Create: `packages/engine/test/vault-placement.test.ts`
- Create: `packages/engine/test/generate-floor.test.ts`

**Interfaces:**
- Produces: `transformVault(template, rotation, reflected): TransformedVault`
- Produces: `placeVaults(topology, vaults): VaultPlacementResult`
- Produces: `GeneratedFloor`, `generateFloor(request): GeneratedFloor`
- Task 11 inserts `GeneratedFloor.floor` into an active run and discards its report from saves.

- [ ] **Step 1: Write failing transform-coordinate tests**

Use a non-square labeled 3×2 template:

```text
abc
def
```

Assert exact row output and marker coordinates for 0°, 90°, 180°, and 270°, both reflected and unreflected. Assert transforms never mutate compiled content and transform ordering is numeric rotation then unreflected/reflected.

- [ ] **Step 2: Write failing placement tests**

Use handcrafted topology rooms and the bundled vault. Assert:

- depth and tag filtering
- positive weighted choice from stable vault-ID order
- candidate order by vault ID, room ID, transform, then row-major origin
- margin, mask, stair, and existing-vault exclusions
- every entrance reconnects to generated floor
- required slots remain reachable
- main stair route remains connected
- `placementId`, light IDs, and slot IDs are unique and stable
- all six slot kinds survive with transformed global coordinates
- maximum placements per floor is honored when one template has multiple compatible rooms
- no placement returns the untouched topology rather than a partial vault

- [ ] **Step 3: Write failing full-floor tests**

Compile bundled content, select vault entries, generate `[1,2,3,4]` twice, and compare exact stable floor and report bytes. Require at least one vault for the demonstration request by passing `requiredVaultId: 'vault.lampwright-cache'`; normal production requests leave this field absent and use weights.

Read `generated-floor-seed-1.json` and require `stableJson(generated.floor)` to equal its single stable-JSON line after `trimEnd()`.

Assert the floor has:

- generator version 2
- ambient copied from the theme
- empty unknown knowledge
- two stair records matching tile IDs
- stable environmental light records
- stable vault placement and slot ordering
- no report fields inside `floor`

Force all normal attempts to reject vault placement and assert deterministic fallback omits optional vaults.

- [ ] **Step 4: Run tests and verify RED**

Run:

```bash
npm test --workspace @woven-deep/engine -- --run test/vault-transform.test.ts test/vault-placement.test.ts test/generate-floor.test.ts
```

Expected: FAIL because vault generation APIs are missing.

- [ ] **Step 5: Implement transforms**

Convert each Unicode code point to a cell record before transforms. Use exact coordinate mappings for source width `w`, height `h`:

```text
0:   (x, y)
90:  (h - 1 - y, x)
180: (w - 1 - x, h - 1 - y)
270: (y, w - 1 - x)
```

Horizontal reflection runs in transformed space as `x = transformedWidth - 1 - x`. Sort transformed entrances, fixtures, and slots by row-major local index.

- [ ] **Step 6: Implement stable candidates and weighted selection**

Map compiled terrain names to Tile IDs. Build candidate placements only inside compatible `RoomBounds`, respecting margin/mask/stairs/occupied cells. Use a local xoshiro cursor initialized from `topology.vaultState`; sort eligible vaults and candidates before any random draw.

Create IDs:

```text
vault-placement.<floor-suffix>.<zero-based-ordinal>
light.<floor-suffix>.<zero-based-placement-ordinal>.<fixture-suffix>
slot.<floor-suffix>.<zero-based-placement-ordinal>.<source-slot-id>
```

Validate them through `assertOpaqueId`. Slot records refer to `vaultPlacementId`, not only the source template ID.

Convert each transformed environmental fixture into a fixed `LightSource`. Copy its glyph and semantic token into `presentation`, set its `vaultPlacementId` to the generated placement ID, and preserve the compiled color, radius, strength, and enabled state. Hero-attached and other non-fixture sources use null ownership and presentation.

After every tentative placement, run full potentially-traversable connectivity and required-slot reachability. Roll back the local draft on failure; never expose it.

- [ ] **Step 7: Implement `generateFloor`**

`generateFloor` owns the final retry loop so topology and vault rejection share one attempt. It calls `generateTopologyAttempt` directly for each attempt number, applies vaults, validates the complete result, and accumulates both topology and vault rejection codes. It does not call the topology-only `generateTopology` coordinator. On success, return:

```ts
export interface GeneratedFloor {
  readonly floor: FloorSnapshot;
  readonly report: GenerationReport;
}
```

Build `FloorSnapshot` with unknown knowledge, stable lights/vaults/slots, no entities, and theme ambient. On exhausted attempts, call the Task 9 fallback and return no vaults or slots.

- [ ] **Step 8: Run GREEN, content integration, and stress cases**

Before GREEN, emit the fixed generated floor to `/tmp`, inspect every vault cell/transform, fixture presentation, slot coordinate and kind, stairs, knowledge packing, ambient values, and stable ordering, then add it as `generated-floor-seed-1.json`. The test only reads the fixture.

Run:

```bash
npm run build --workspace @woven-deep/content
npm test --workspace @woven-deep/engine -- --run test/vault-transform.test.ts test/vault-placement.test.ts test/generate-floor.test.ts test/generate-topology.test.ts
npm run typecheck --workspace @woven-deep/engine
npm test --workspace @woven-deep/engine
git diff --check
```

- [ ] **Step 9: Commit**

```bash
git add packages/engine/src packages/engine/test
git commit -m "feat: place authored dungeon vaults"
```

---

### Task 11: Insert generated floors and prove save/replay continuity

**Files:**
- Create: `packages/engine/src/floor-integration.ts`
- Create: `packages/engine/src/generated-fixture.ts`
- Modify: `packages/engine/src/index.ts`
- Create: `packages/engine/test/floor-integration.test.ts`
- Create: `packages/engine/test/generated-replay.test.ts`

**Interfaces:**
- Produces: `addGeneratedFloor(run, generated, allocation): ActiveRun`
- Produces: `createGeneratedDemoRun(pack): { run, generated, allocation }`
- CLI consumes the generated demo fixture through public exports.

- [ ] **Step 1: Write failing insertion tests**

Assert `addGeneratedFloor`:

- requires `generated.floor.seed` to equal `allocation.floorSeed`
- requires nonzero `allocation.nextGenerationState`
- replaces only `rng.generation`
- rejects duplicate and out-of-order floor IDs
- inserts a complete floor in strict ID order
- does not persist `generated.report`
- refreshes knowledge only when the inserted floor is active
- does not mutate run, generated result, or allocation

- [ ] **Step 2: Write failing generated save/replay tests**

Build a generated run whose hero begins on stair-up with a carried amber light. Use connectivity path output to choose four valid movement commands plus a wait, one duplicate, and one stale command. Compare:

- continuous execution
- execution split by `encodeActiveRun`/`decodeActiveRun`
- exact final save bytes
- exact `stableJson` command steps
- exact knowledge bytes and observable projection bytes

Also assert encoding the generated run excludes report/rejection/room/corridor fields.

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
npm test --workspace @woven-deep/engine -- --run test/floor-integration.test.ts test/generated-replay.test.ts
```

Expected: FAIL because insertion and generated fixture APIs are missing.

- [ ] **Step 4: Implement insertion and generated fixture**

Create:

```ts
export function addGeneratedFloor(
  run: ActiveRun,
  generated: GeneratedFloor,
  allocation: FloorSeedAllocation,
): ActiveRun;
```

Validate seed equality by all four words, next state, floor ordering, uniqueness, and full v2 run validity before returning. Use `validateActiveRun` after insertion.

`createGeneratedDemoRun` takes a compiled content pack, filters vaults, allocates from `createDemoRun().rng.generation`, generates `floor.generated-01`, builds a fresh run with the hero at stair-up, attaches `light.hero-demo` with null vault ownership/presentation, refreshes knowledge, and returns diagnostics separately.

- [ ] **Step 5: Run GREEN and full engine continuity gates**

Run:

```bash
npm test --workspace @woven-deep/engine -- --run test/floor-integration.test.ts test/generated-replay.test.ts test/save-codec.test.ts test/migration.test.ts test/replay.test.ts
npm run typecheck --workspace @woven-deep/engine
npm test --workspace @woven-deep/engine
npm run engine:demo
git diff --check
```

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src packages/engine/test
git commit -m "feat: persist generated dungeon floors"
```

---

### Task 12: Demonstrate generated darkness, light, and memory

**Files:**
- Create: `scripts/dungeon-demo.mjs`
- Create: `packages/engine/test/dungeon-cli.test.ts`
- Create: `packages/engine/test/fixtures/dungeon-demo-hashes.json`
- Modify: `package.json`
- Modify: `Dockerfile`

**Interfaces:**
- Produces: `npm run dungeon:demo`
- Produces: terminal maps and SHA-256 hashes for floor and projections
- Docker build runs the new demonstration after the existing engine demo.

- [ ] **Step 1: Write the failing CLI integration test**

Spawn `scripts/dungeon-demo.mjs --verify` from the repository root. Assert status 0 and output matching:

```text
floor floor.generated-01 80x25 generator 2
seed <four 8-digit lowercase hex words> attempt <nonnegative integer or fallback>
rooms <positive> corridors <positive> vault vault.lampwright-cache
stairs <x,y> -> <x,y> distance <at-least-20>
view absolute-darkness
view low-ambient
preview torch radius 3
preview torch radius 7
view overlapping-color
view sealed-corner
view remembered
floor-state <64 lowercase hex>
projection absolute-darkness <64 lowercase hex>
projection low-ambient <64 lowercase hex>
projection overlapping-color <64 lowercase hex>
projection sealed-corner <64 lowercase hex>
projection remembered <64 lowercase hex>
deterministic dungeon, visibility, and light verified
```

Assert the rendered maps contain `#`, `.`, `<`, `>`, `+` or `O`, remembered dim glyphs, and no hidden slot IDs. Add safe failure tests for extra arguments and a missing content directory through `--content-dir`.

Read `dungeon-demo-hashes.json` and require every printed floor/projection hash to equal the reviewed checked-in value, not only a hexadecimal pattern.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm run build --workspace @woven-deep/content
npm run build --workspace @woven-deep/engine
npm test --workspace @woven-deep/engine -- --run test/dungeon-cli.test.ts
```

Expected: FAIL because the script is missing.

- [ ] **Step 3: Implement the Node-only demonstration**

The script imports Node `crypto`, path/url APIs, `@woven-deep/content/compiler`, and built engine exports. It must:

1. compile the configured content directory
2. create the generated demo twice and compare exact stable floor/report bytes
3. render the complete diagnostic terrain
4. project absolute darkness with ambient strength 0 and no enabled source
5. project low ambient strength 3
6. render clipped radius-3 and radius-7 carried-light previews
7. add one red fixed light and one blue hero-attached light with overlap and render their projection
8. render a fixed 5×5 sealed-diagonal-corner fixture through the same visibility and lighting APIs, proving two orthogonal blockers stop sight and light while one does not
9. move the hero along a valid path and render remembered terrain
10. print SHA-256 hashes of `stableJson` floor/projections, including the sealed-corner fixture
11. decode/encode the run and compare projection bytes again
12. print the exact verification success line

Use semantic ANSI-free ASCII so snapshot output is stable. Unknown cells render spaces, remembered cells use lower-intensity terrain glyphs, and visible cells use current glyphs. Do not print vault slot records or random states.

After the first successful run, capture candidate hashes to `/tmp`, independently recompute them from the checked-in generated-floor fixture and projection inputs, inspect the corresponding map sections, then add the exact hash object to `dungeon-demo-hashes.json`. The CLI test only reads this fixture.

Catch failures as `dungeon demo failed: <safe message>` and set exit code 1 without a stack trace.

- [ ] **Step 4: Wire root and Docker commands**

Add:

```json
"dungeon:demo": "npm run build --workspace @woven-deep/content && npm run build --workspace @woven-deep/engine && node scripts/dungeon-demo.mjs --verify"
```

Change the Docker verification line to:

```dockerfile
RUN npm test && npm run typecheck && npm run build && npm run engine:demo && npm run dungeon:demo
```

The runtime stage already copies content and both package builds; verify no additional production files are needed.

- [ ] **Step 5: Run focused GREEN**

Run:

```bash
npm run dungeon:demo
npm test --workspace @woven-deep/engine -- --run test/dungeon-cli.test.ts
```

Require stable hashes across two separate CLI processes.

- [ ] **Step 6: Run all milestone gates**

Run from repository root:

```bash
npm ci
npm run content:validate
npm test
npm run typecheck
npm run build
npm run engine:demo
npm run dungeon:demo
docker compose build
git diff --check
git status --short
```

Expected:

- content validation reports three entries and the reviewed content hash
- all engine/content/server/web tests pass
- every workspace type-checks and builds
- both deterministic demonstrations pass
- Docker runs both demonstrations during build
- only Task 12 files are staged before commit

- [ ] **Step 7: Commit**

```bash
git add scripts/dungeon-demo.mjs packages/engine/test/dungeon-cli.test.ts packages/engine/test/fixtures/dungeon-demo-hashes.json package.json Dockerfile
git commit -m "feat: demonstrate dungeon visibility and light"
```

---

## Milestone completion review

After Task 12 passes its task review:

1. Generate a whole-branch review package from merge commit `252c737` to final head.
2. Request an independent whole-branch review against this plan and `docs/superpowers/specs/2026-07-13-dungeon-visibility-light-design.md`.
3. Fix every Critical and Important finding with one focused fix pass; re-review until clean.
4. Run fresh `npm ci`, `npm run content:validate`, `npm test`, `npm run typecheck`, `npm run build`, `npm run engine:demo`, `npm run dungeon:demo`, and `docker compose build` evidence.
5. Use the finishing-development-branch workflow. Report Milestone 3 only; do not describe the full game as complete.
