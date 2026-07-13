# Deterministic Engine Kernel and Save Format Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser-safe pure game-engine kernel whose fixed-floor movement commands, seeded random state, saves, migrations, and replay output remain byte-deterministic across save/reload boundaries.

**Architecture:** Add a framework-independent `@woven-deep/engine` workspace centered on `resolveCommand(state, command)`. Complete versioned snapshots carry compact floor data, named xoshiro128** stream state, revisions, and a 128-entry idempotency ring; strict stable JSON serialization and a real `v0` to `v1` migration protect the save boundary. A Node-only repository script drives the engine CLI without entering the browser package graph.

**Tech Stack:** Node.js `>=22.12.0`, TypeScript 5.8 strict ESM, Vitest 3.2, Zod 4, npm workspaces, stable JSON, xoshiro128**/SplitMix32.

## Global Constraints

- Production code in `@woven-deep/engine` imports no React, Fastify, SQLite, browser storage, Node built-ins, or ambient random/clock APIs.
- The initial game version is exactly `0.1.0`; the active-run schema version is exactly `1`.
- The engine is a pure reducer: it does not mutate input state or commands and performs no I/O.
- Opaque identifiers match `^[a-z0-9][a-z0-9._:-]{0,127}$`; content hashes are lowercase 64-character SHA-256 hex strings.
- Runtime state contains only finite safe integers; PRNG words are unsigned 32-bit integers and each four-word stream state is non-zero.
- Valid movement and waiting advance turn and revision; invalid player actions advance neither; stale/conflicting protocol rejections do not change state.
- Processed valid and invalid actions enter a 128-record ring; protocol rejections do not.
- Stable JSON sorts object keys by Unicode code unit, retains semantic array order, rejects unsupported values, and emits no insignificant whitespace or trailing newline.
- `v0` migration is real, fixture-backed, deterministic, and idempotent after reaching `v1`; unknown future versions are rejected.
- Every task follows RED → GREEN → refactor, runs `git diff --check`, and ends in a focused commit only after its independent review gate passes.
- The user requested normal branches, not worktrees. Implement on `feat/deterministic-engine-kernel`.

---

### Task 1: Establish the browser-safe engine workspace and domain model

**Files:**
- Create: `packages/engine/package.json`
- Create: `packages/engine/tsconfig.json`
- Create: `packages/engine/src/versions.ts`
- Create: `packages/engine/src/model.ts`
- Create: `packages/engine/src/index.ts`
- Test: `packages/engine/test/model.test.ts`
- Test: `packages/engine/test/browser-boundary.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `SAVE_SCHEMA_VERSION`, `ENGINE_GAME_VERSION`, `RECENT_COMMAND_LIMIT`, `RNG_STREAM_NAMES`
- Produces: `ActiveRun`, `FloorSnapshot`, `HeroState`, `GameCommand`, `DomainEvent`, `CommandResult`, `RecordedCommand`, `CommandResolution`
- Produces: `assertOpaqueId(value, label): asserts value is string`
- Produces: `tileIndex(floor, x, y): number | undefined`

- [ ] **Step 1: Create the package manifest, compiler boundary, and failing model test**

```json
// packages/engine/package.json
{
  "name": "@woven-deep/engine",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "exports": { ".": "./dist/index.js" },
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": { "zod": "^4.0.0" }
}
```

```json
// packages/engine/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "lib": ["ES2023"],
    "types": []
  },
  "include": ["src/**/*.ts"]
}
```

```ts
// packages/engine/test/model.test.ts
import { describe, expect, it } from 'vitest';
import {
  ENGINE_GAME_VERSION,
  RECENT_COMMAND_LIMIT,
  SAVE_SCHEMA_VERSION,
  assertOpaqueId,
  tileIndex,
  type FloorSnapshot,
} from '../src/index.js';

describe('engine model boundary', () => {
  it('publishes the initial compatibility constants', () => {
    expect(SAVE_SCHEMA_VERSION).toBe(1);
    expect(ENGINE_GAME_VERSION).toBe('0.1.0');
    expect(RECENT_COMMAND_LIMIT).toBe(128);
  });

  it.each(['run.demo', 'command:001', 'hero-1'])('accepts opaque identifier %s', (id) => {
    expect(() => assertOpaqueId(id, 'id')).not.toThrow();
  });

  it.each(['', 'Uppercase', 'has space', `a${'b'.repeat(128)}`])(
    'rejects opaque identifier %j',
    (id) => expect(() => assertOpaqueId(id, 'id')).toThrow(),
  );

  it('maps in-bounds coordinates to row-major tile indexes', () => {
    const floor = { width: 3, height: 2 } as FloorSnapshot;
    expect(tileIndex(floor, 2, 1)).toBe(5);
    expect(tileIndex(floor, -1, 0)).toBeUndefined();
    expect(tileIndex(floor, 3, 0)).toBeUndefined();
  });
});
```

```ts
// packages/engine/test/browser-boundary.test.ts
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sourceRoot = fileURLToPath(new URL('../src', import.meta.url));
const forbiddenImports = /(?:from\s*|import\s*)['"](?:node:|react(?:\/|['"]|$)|fastify(?:\/|['"]|$)|better-sqlite3(?:\/|['"]|$))/;
const forbiddenAmbient = /\b(?:Math\.random\s*\(|Date\.now\s*\(|new\s+Date\s*\(|performance\.now\s*\(|localStorage\b|sessionStorage\b)/;

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith('.ts') ? [path] : [];
  }));
  return nested.flat().sort();
}

describe('browser-safe production graph', () => {
  it('contains no platform framework, Node, storage, clock, or ambient-random dependency', async () => {
    const files = await sourceFiles(sourceRoot);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      expect(source, file).not.toMatch(forbiddenImports);
      expect(source, file).not.toMatch(forbiddenAmbient);
    }
  });
});
```

- [ ] **Step 2: Install the workspace and verify RED**

Run: `npm install`

Run: `npm test --workspace @woven-deep/engine`

Expected: FAIL because `packages/engine/src/index.ts` does not exist.

- [ ] **Step 3: Add exact version constants and domain types**

```ts
// packages/engine/src/versions.ts
export const SAVE_SCHEMA_VERSION = 1 as const;
export const ENGINE_GAME_VERSION = '0.1.0' as const;
export const RECENT_COMMAND_LIMIT = 128 as const;

export const RNG_STREAM_NAMES = [
  'generation',
  'encounters',
  'combat',
  'loot',
  'effects',
  'narrative',
] as const;

export type RngStreamName = (typeof RNG_STREAM_NAMES)[number];
```

```ts
// packages/engine/src/model.ts
import type { RngStreamName } from './versions.js';

export type OpaqueId = string;
export type Uint32State = readonly [number, number, number, number];
export type RngStreams = Readonly<Record<RngStreamName, Uint32State>>;
export type TileId = 0 | 1;
export type Direction = 'north' | 'south' | 'east' | 'west';

export interface FloorEntityPosition {
  readonly entityId: OpaqueId;
  readonly x: number;
  readonly y: number;
}

export interface FloorSnapshot {
  readonly floorId: OpaqueId;
  readonly seed: Uint32State;
  readonly generatorVersion: 1;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly tiles: readonly TileId[];
  readonly entities: readonly FloorEntityPosition[];
}

export interface HeroState {
  readonly heroId: OpaqueId;
  readonly name: string;
  readonly floorId: OpaqueId;
  readonly x: number;
  readonly y: number;
}

export interface CommandEnvelope {
  readonly commandId: OpaqueId;
  readonly expectedRevision: number;
}

export interface MoveCommand extends CommandEnvelope {
  readonly type: 'move';
  readonly direction: Direction;
}

export interface WaitCommand extends CommandEnvelope {
  readonly type: 'wait';
}

export type GameCommand = MoveCommand | WaitCommand;

export interface HeroMovedEvent {
  readonly type: 'hero.moved';
  readonly eventId: OpaqueId;
  readonly heroId: OpaqueId;
  readonly from: Readonly<{ x: number; y: number }>;
  readonly to: Readonly<{ x: number; y: number }>;
}

export interface HeroWaitedEvent {
  readonly type: 'hero.waited';
  readonly eventId: OpaqueId;
  readonly heroId: OpaqueId;
  readonly x: number;
  readonly y: number;
}

export interface InvalidActionEvent {
  readonly type: 'action.invalid';
  readonly eventId: OpaqueId;
  readonly commandId: OpaqueId;
  readonly reason: 'blocked.bounds' | 'blocked.wall';
}

export type DomainEvent = HeroMovedEvent | HeroWaitedEvent | InvalidActionEvent;

export interface AppliedCommandResult {
  readonly status: 'applied';
  readonly commandId: OpaqueId;
  readonly revision: number;
  readonly turn: number;
}

export interface InvalidCommandResult {
  readonly status: 'invalid';
  readonly commandId: OpaqueId;
  readonly revision: number;
  readonly turn: number;
  readonly reason: InvalidActionEvent['reason'];
}

export interface RejectedCommandResult {
  readonly status: 'rejected';
  readonly commandId: OpaqueId;
  readonly revision: number;
  readonly turn: number;
  readonly reason: 'stale_revision' | 'command_id_conflict';
}

export type ProcessedCommandResult = AppliedCommandResult | InvalidCommandResult;
export type CommandResult = ProcessedCommandResult | RejectedCommandResult;

export interface RecordedCommand {
  readonly command: GameCommand;
  readonly result: ProcessedCommandResult;
  readonly events: readonly DomainEvent[];
}

export interface ActiveRun {
  readonly schemaVersion: 1;
  readonly gameVersion: '0.1.0';
  readonly contentHash: string;
  readonly runId: OpaqueId;
  readonly runSeed: Uint32State;
  readonly rng: RngStreams;
  readonly revision: number;
  readonly turn: number;
  readonly hero: HeroState;
  readonly activeFloorId: OpaqueId;
  readonly floors: readonly FloorSnapshot[];
  readonly recentCommands: readonly RecordedCommand[];
}

export interface CommandResolution {
  readonly state: ActiveRun;
  readonly result: CommandResult;
  readonly events: readonly DomainEvent[];
}

const OPAQUE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;

export function assertOpaqueId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !OPAQUE_ID.test(value)) {
    throw new TypeError(`${label} must be a lowercase opaque identifier`);
  }
}

export function tileIndex(
  floor: Pick<FloorSnapshot, 'width' | 'height'>,
  x: number,
  y: number,
): number | undefined {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= floor.width || y >= floor.height) {
    return undefined;
  }
  return y * floor.width + x;
}
```

```ts
// packages/engine/src/index.ts
export * from './model.js';
export * from './versions.js';
```

- [ ] **Step 4: Put engine before consumers in root verification scripts**

Update root `package.json` scripts exactly:

```json
{
  "scripts": {
    "build": "npm run build --workspace @woven-deep/content && npm run build --workspace @woven-deep/engine && npm run build --workspace @woven-deep/web && npm run build --workspace @woven-deep/server",
    "test": "npm run build --workspace @woven-deep/content && npm run build --workspace @woven-deep/engine && npm run test --workspaces --if-present",
    "typecheck": "npm run build --workspace @woven-deep/content && npm run build --workspace @woven-deep/engine && npm run typecheck --workspaces --if-present"
  }
}
```

Run: `npm test --workspace @woven-deep/engine && npm run typecheck --workspace @woven-deep/engine && npm run build --workspace @woven-deep/engine`

Expected: 9 generated model cases and the browser-boundary guard pass; the engine package type-checks and emits `dist/index.js` without Node types.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json packages/engine
git commit -m "build: establish deterministic engine package"
```

---

### Task 2: Implement stable named random streams

**Files:**
- Create: `packages/engine/src/random.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/random.test.ts`

**Interfaces:**
- Consumes: `Uint32State`, `RngStreams`, `RNG_STREAM_NAMES`
- Produces: `nextUint32(state): RandomStep`
- Produces: `expandLegacySeed(seed): Uint32State`
- Produces: `deriveRngStreams(runSeed): RngStreams`
- Produces: `isNonZeroState(state): boolean`

- [ ] **Step 1: Write failing algorithm-vector and stream-isolation tests**

```ts
// packages/engine/test/random.test.ts
import { describe, expect, it } from 'vitest';
import {
  deriveRngStreams,
  expandLegacySeed,
  nextUint32,
  type Uint32State,
} from '../src/index.js';

describe('xoshiro128**', () => {
  it('matches the published project vector without mutating input', () => {
    const initial = [1, 2, 3, 4] as const;
    const first = nextUint32(initial);
    const second = nextUint32(first.state);
    expect(first.value).toBe(11_520);
    expect(first.state).toEqual([7, 0, 1026, 12_288]);
    expect(second.value).toBe(0);
    expect(initial).toEqual([1, 2, 3, 4]);
  });

  it('expands the same legacy seed identically', () => {
    expect(expandLegacySeed(0x12345678)).toEqual([2986037511, 744488920, 2204577711, 2810942300]);
  });

  it('derives isolated named streams', () => {
    const seed = [1, 2, 3, 4] as Uint32State;
    const left = deriveRngStreams(seed);
    const right = deriveRngStreams(seed);
    expect(left).toEqual(right);
    expect(new Set(Object.values(left).map((state) => state.join(','))).size).toBe(6);
    const advancedCombat = nextUint32(left.combat).state;
    expect(advancedCombat).not.toEqual(left.combat);
    expect(left.generation).toEqual(right.generation);
  });

  it('never emits the forbidden all-zero derived state across representative seeds', () => {
    for (let seed = 0; seed < 1_000; seed += 1) {
      for (const state of Object.values(deriveRngStreams(expandLegacySeed(seed)))) {
        expect(state.some((word) => word !== 0)).toBe(true);
      }
    }
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test --workspace @woven-deep/engine -- --run test/random.test.ts`

Expected: FAIL because `random.ts` exports do not exist.

- [ ] **Step 3: Implement explicit unsigned arithmetic and derivation**

```ts
// packages/engine/src/random.ts
import type { RngStreams, Uint32State } from './model.js';
import { RNG_STREAM_NAMES, type RngStreamName } from './versions.js';

const GOLDEN_GAMMA = 0x9e3779b9;
const NON_ZERO_FALLBACK = 0x6d2b79f5;

const STREAM_DISCRIMINATORS: Readonly<Record<RngStreamName, number>> = {
  generation: 1,
  encounters: 2,
  combat: 3,
  loot: 4,
  effects: 5,
  narrative: 6,
};

function rotateLeft(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

function splitMixWord(value: number): number {
  let mixed = value >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x21f0aaad) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x735a2d97) >>> 0;
  return (mixed ^ (mixed >>> 15)) >>> 0;
}

export interface RandomStep {
  readonly value: number;
  readonly state: Uint32State;
}

export function isNonZeroState(state: Uint32State): boolean {
  return state.some((word) => word !== 0);
}

export function nextUint32(state: Uint32State): RandomStep {
  const [initial0, initial1, initial2, initial3] = state;
  const value = Math.imul(rotateLeft(Math.imul(initial1, 5) >>> 0, 7), 9) >>> 0;
  const shifted = (initial1 << 9) >>> 0;
  let s2 = (initial2 ^ initial0) >>> 0;
  let s3 = (initial3 ^ initial1) >>> 0;
  let s1 = (initial1 ^ s2) >>> 0;
  let s0 = (initial0 ^ s3) >>> 0;
  s2 = (s2 ^ shifted) >>> 0;
  s3 = rotateLeft(s3, 11);
  return { value, state: [s0, s1, s2, s3] };
}

export function expandLegacySeed(seed: number): Uint32State {
  let cursor = seed >>> 0;
  const words: number[] = [];
  for (let index = 0; index < 4; index += 1) {
    cursor = (cursor + GOLDEN_GAMMA) >>> 0;
    words.push(splitMixWord(cursor));
  }
  const state = words as unknown as Uint32State;
  return isNonZeroState(state) ? state : [0, 0, 0, NON_ZERO_FALLBACK];
}

function deriveStream(runSeed: Uint32State, discriminator: number): Uint32State {
  let cursor = discriminator >>> 0;
  for (let index = 0; index < runSeed.length; index += 1) {
    cursor = splitMixWord((cursor ^ runSeed[index]! ^ Math.imul(index + 1, GOLDEN_GAMMA)) >>> 0);
  }
  const state = expandLegacySeed(cursor);
  return isNonZeroState(state) ? state : [0, 0, 0, NON_ZERO_FALLBACK];
}

export function deriveRngStreams(runSeed: Uint32State): RngStreams {
  return Object.fromEntries(
    RNG_STREAM_NAMES.map((name) => [name, deriveStream(runSeed, STREAM_DISCRIMINATORS[name])]),
  ) as unknown as RngStreams;
}
```

Export from `packages/engine/src/index.ts`:

```ts
export * from './random.js';
```

- [ ] **Step 4: Verify vectors independently and run GREEN**

Before accepting the hard-coded vector, run a one-off reference script copied from the design algorithm rather than importing `random.ts`. Correct the two expected legacy-seed lines in the test if the independent script proves the plan's numeric transcription wrong; record the independent values in the task report.

Run: `npm test --workspace @woven-deep/engine -- --run test/random.test.ts && npm run typecheck --workspace @woven-deep/engine`

Expected: 4 random tests pass and TypeScript reports no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src packages/engine/test/random.test.ts
git commit -m "feat: add stable random streams"
```

---

### Task 3: Resolve movement commands and recent-command idempotency

**Files:**
- Create: `packages/engine/src/fixture.ts`
- Create: `packages/engine/src/reducer.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/reducer.test.ts`

**Interfaces:**
- Consumes: domain types, version constants, `deriveRngStreams`, `tileIndex`
- Produces: `createDemoRun(): ActiveRun`
- Produces: `resolveCommand(state, command): CommandResolution`

- [ ] **Step 1: Write failing pure-transition tests**

```ts
// packages/engine/test/reducer.test.ts
import { describe, expect, it } from 'vitest';
import { createDemoRun, resolveCommand, type GameCommand } from '../src/index.js';

const move = (commandId: string, expectedRevision: number, direction: 'north' | 'south' | 'east' | 'west'): GameCommand => ({
  type: 'move', commandId, expectedRevision, direction,
});

describe('resolveCommand', () => {
  it('moves without mutating input and advances turn/revision', () => {
    const initial = createDemoRun();
    const resolution = resolveCommand(initial, move('command.1', 0, 'east'));
    expect(resolution.result).toMatchObject({ status: 'applied', revision: 1, turn: 1 });
    expect(resolution.state.hero).toMatchObject({ x: 2, y: 1 });
    expect(resolution.events).toEqual([{ type: 'hero.moved', eventId: 'command.1', heroId: 'hero.demo', from: { x: 1, y: 1 }, to: { x: 2, y: 1 } }]);
    expect(initial.hero).toMatchObject({ x: 1, y: 1 });
    expect(initial.recentCommands).toHaveLength(0);
  });

  it('records wall collisions without advancing time', () => {
    const initial = createDemoRun();
    const resolution = resolveCommand(initial, move('command.wall', 0, 'north'));
    expect(resolution.result).toMatchObject({ status: 'invalid', reason: 'blocked.wall', revision: 0, turn: 0 });
    expect(resolution.state.hero).toEqual(initial.hero);
    expect(resolution.state.recentCommands).toHaveLength(1);
  });

  it('rejects bounds and stale revisions without advancing', () => {
    const demo = createDemoRun();
    const floor = demo.floors[0]!;
    const initial = {
      ...demo,
      hero: { ...demo.hero, x: 0, y: 0 },
      floors: [{ ...floor, tiles: floor.tiles.map((tile, index) => index === 0 ? 1 : tile) }],
    };
    expect(resolveCommand(initial, move('command.bounds', 0, 'west')).result).toMatchObject({ status: 'invalid', reason: 'blocked.bounds' });
    expect(resolveCommand(createDemoRun(), move('command.stale', 9, 'east')).result).toMatchObject({ status: 'rejected', reason: 'stale_revision' });
  });

  it('applies wait without changing position', () => {
    const initial = createDemoRun();
    const resolution = resolveCommand(initial, { type: 'wait', commandId: 'command.wait', expectedRevision: 0 });
    expect(resolution.state.hero).toEqual(initial.hero);
    expect(resolution.result).toMatchObject({ status: 'applied', revision: 1, turn: 1 });
    expect(resolution.events[0]?.type).toBe('hero.waited');
  });

  it('replays identical IDs and rejects conflicting reuse', () => {
    const command = move('command.repeat', 0, 'east');
    const first = resolveCommand(createDemoRun(), command);
    const duplicate = resolveCommand(first.state, command);
    expect(duplicate.state).toBe(first.state);
    expect(duplicate.result).toEqual(first.result);
    expect(duplicate.events).toEqual(first.events);
    const conflict = resolveCommand(first.state, { ...command, direction: 'south' });
    expect(conflict.result).toMatchObject({ status: 'rejected', reason: 'command_id_conflict' });
  });

  it('evicts only the oldest processed result after 128 records', () => {
    let state = createDemoRun();
    for (let index = 0; index < 129; index += 1) {
      state = resolveCommand(state, { type: 'wait', commandId: `command.${index}`, expectedRevision: index }).state;
    }
    expect(state.recentCommands).toHaveLength(128);
    expect(state.recentCommands[0]?.command.commandId).toBe('command.1');
    expect(state.recentCommands.at(-1)?.command.commandId).toBe('command.128');
  });
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test --workspace @woven-deep/engine -- --run test/reducer.test.ts`

Expected: FAIL because `createDemoRun` and `resolveCommand` are missing.

- [ ] **Step 3: Add the fixed authored floor fixture**

```ts
// packages/engine/src/fixture.ts
import type { ActiveRun, TileId } from './model.js';
import { deriveRngStreams } from './random.js';
import { ENGINE_GAME_VERSION, SAVE_SCHEMA_VERSION } from './versions.js';

const FLOOR_LINES = [
  '#######',
  '#.....#',
  '#..#..#',
  '#.....#',
  '#######',
] as const;

const tiles = FLOOR_LINES.flatMap((line) => [...line].map<TileId>((glyph) => glyph === '#' ? 0 : 1));
const seed = [1, 2, 3, 4] as const;

export function createDemoRun(): ActiveRun {
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    gameVersion: ENGINE_GAME_VERSION,
    contentHash: 'a'.repeat(64),
    runId: 'run.demo',
    runSeed: seed,
    rng: deriveRngStreams(seed),
    revision: 0,
    turn: 0,
    hero: { heroId: 'hero.demo', name: 'Ada', floorId: 'floor.demo', x: 1, y: 1 },
    activeFloorId: 'floor.demo',
    floors: [{
      floorId: 'floor.demo', seed, generatorVersion: 1, width: 7, height: 5, depth: 1, tiles, entities: [],
    }],
    recentCommands: [],
  };
}
```

- [ ] **Step 4: Implement the pure reducer and exact ring semantics**

```ts
// packages/engine/src/reducer.ts
import type {
  ActiveRun, CommandResolution, Direction, DomainEvent, GameCommand,
  ProcessedCommandResult, RecordedCommand,
} from './model.js';
import { tileIndex } from './model.js';
import { RECENT_COMMAND_LIMIT } from './versions.js';

const DELTAS: Readonly<Record<Direction, Readonly<{ x: number; y: number }>>> = {
  north: { x: 0, y: -1 }, south: { x: 0, y: 1 }, east: { x: 1, y: 0 }, west: { x: -1, y: 0 },
};

function sameCommand(left: GameCommand, right: GameCommand): boolean {
  return left.type === right.type
    && left.commandId === right.commandId
    && left.expectedRevision === right.expectedRevision
    && (left.type !== 'move' || (right.type === 'move' && left.direction === right.direction));
}

function rejected(state: ActiveRun, command: GameCommand, reason: 'stale_revision' | 'command_id_conflict'): CommandResolution {
  return { state, result: { status: 'rejected', commandId: command.commandId, revision: state.revision, turn: state.turn, reason }, events: [] };
}

function record(state: ActiveRun, command: GameCommand, result: ProcessedCommandResult, events: readonly DomainEvent[], hero = state.hero): ActiveRun {
  const next: RecordedCommand = { command, result, events };
  return { ...state, hero, revision: result.revision, turn: result.turn, recentCommands: [...state.recentCommands, next].slice(-RECENT_COMMAND_LIMIT) };
}

export function resolveCommand(state: ActiveRun, command: GameCommand): CommandResolution {
  const previous = state.recentCommands.find((entry) => entry.command.commandId === command.commandId);
  if (previous) {
    return sameCommand(previous.command, command)
      ? { state, result: previous.result, events: previous.events }
      : rejected(state, command, 'command_id_conflict');
  }
  if (command.expectedRevision !== state.revision) return rejected(state, command, 'stale_revision');

  if (command.type === 'wait') {
    const result = { status: 'applied', commandId: command.commandId, revision: state.revision + 1, turn: state.turn + 1 } as const;
    const events = [{ type: 'hero.waited', eventId: command.commandId, heroId: state.hero.heroId, x: state.hero.x, y: state.hero.y }] as const;
    return { state: record(state, command, result, events), result, events };
  }

  const floor = state.floors.find((candidate) => candidate.floorId === state.hero.floorId);
  if (!floor) throw new Error(`active floor ${state.hero.floorId} is missing`);
  const delta = DELTAS[command.direction];
  const target = { x: state.hero.x + delta.x, y: state.hero.y + delta.y };
  const index = tileIndex(floor, target.x, target.y);
  const reason = index === undefined ? 'blocked.bounds' : floor.tiles[index] === 0 ? 'blocked.wall' : undefined;
  if (reason) {
    const result = { status: 'invalid', commandId: command.commandId, revision: state.revision, turn: state.turn, reason } as const;
    const events = [{ type: 'action.invalid', eventId: command.commandId, commandId: command.commandId, reason }] as const;
    return { state: record(state, command, result, events), result, events };
  }

  const result = { status: 'applied', commandId: command.commandId, revision: state.revision + 1, turn: state.turn + 1 } as const;
  const events = [{ type: 'hero.moved', eventId: command.commandId, heroId: state.hero.heroId, from: { x: state.hero.x, y: state.hero.y }, to: target }] as const;
  return { state: record(state, command, result, events, { ...state.hero, ...target }), result, events };
}
```

Export both modules from `src/index.ts`.

- [ ] **Step 5: Run GREEN and mutation checks**

Run: `npm test --workspace @woven-deep/engine -- --run test/reducer.test.ts && npm run typecheck --workspace @woven-deep/engine`

Expected: 6 reducer tests pass; TypeScript reports no errors.

Run: `git diff --check`

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src packages/engine/test/reducer.test.ts
git commit -m "feat: resolve deterministic movement commands"
```

---

### Task 4: Encode strict stable JSON output

**Files:**
- Create: `packages/engine/src/stable-json.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/stable-json.test.ts`

**Interfaces:**
- Produces: `stableJson(value: unknown): string`
- Produces: `compareCodeUnits(left, right): number`

- [ ] **Step 1: Write failing stable serialization tests**

```ts
// packages/engine/test/stable-json.test.ts
import { describe, expect, it } from 'vitest';
import { stableJson } from '../src/index.js';

describe('stableJson', () => {
  it('sorts object keys recursively and retains array order', () => {
    expect(stableJson({ z: 1, a: { beta: 2, alpha: 1 }, list: [3, 2, 1] }))
      .toBe('{"a":{"alpha":1,"beta":2},"list":[3,2,1],"z":1}');
  });

  it.each([NaN, Infinity, -Infinity, -0, 1.5, Number.MAX_SAFE_INTEGER + 1, undefined, new Map()])(
    'rejects unsupported value %s',
    (value) => expect(() => stableJson({ value })).toThrow(),
  );

  it('rejects sparse arrays, cycles, non-plain objects, and undefined children', () => {
    const sparse = Array(2); sparse[1] = 1;
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    expect(() => stableJson(sparse)).toThrow(/sparse/);
    expect(() => stableJson(cyclic)).toThrow(/cycle/);
    expect(() => stableJson(new (class Value {})())).toThrow(/plain/);
    expect(() => stableJson({ missing: undefined })).toThrow(/unsupported/);
  });

  it('rejects symbol keys and accessor properties instead of silently dropping or invoking them', () => {
    expect(() => stableJson({ [Symbol('hidden')]: 1 })).toThrow(/symbol/);
    const accessed = Object.defineProperty({}, 'value', { enumerable: true, get: () => 1 });
    expect(() => stableJson(accessed)).toThrow(/data properties/);
  });

  it('emits byte-stable compact text without a trailing newline', () => {
    const first = stableJson({ b: 2, a: 1 });
    expect(stableJson(JSON.parse(first))).toBe(first);
    expect(first.endsWith('\n')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test --workspace @woven-deep/engine -- --run test/stable-json.test.ts`

Expected: FAIL because `stableJson` is missing.

- [ ] **Step 3: Implement strict normalization without Node APIs**

```ts
// packages/engine/src/stable-json.ts
export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalize(value: unknown, ancestors: Set<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new TypeError('stable JSON numbers must be unambiguous finite safe integers');
    return value;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new TypeError('stable JSON cannot contain a cycle');
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) throw new TypeError('stable JSON cannot contain a sparse array');
    }
    const nested = new Set(ancestors).add(value);
    return value.map((entry) => normalize(entry, nested));
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('stable JSON objects must be plain');
    if (ancestors.has(value)) throw new TypeError('stable JSON cannot contain a cycle');
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key === 'symbol')) throw new TypeError('stable JSON cannot contain symbol keys');
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!descriptor.enumerable || !('value' in descriptor)) throw new TypeError('stable JSON objects require enumerable data properties');
    }
    const nested = new Set(ancestors).add(value);
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareCodeUnits(left, right))
        .map(([key, child]) => [key, normalize(child, nested)]),
    );
  }
  throw new TypeError(`unsupported stable JSON value: ${typeof value}`);
}

export function stableJson(value: unknown): string {
  return JSON.stringify(normalize(value, new Set()));
}
```

Export it from `src/index.ts`.

- [ ] **Step 4: Run GREEN and full engine tests**

Run: `npm test --workspace @woven-deep/engine && npm run typecheck --workspace @woven-deep/engine`

Expected: all model, random, reducer, and stable serialization tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src packages/engine/test/stable-json.test.ts
git commit -m "feat: encode strict stable engine JSON"
```

---

### Task 5: Validate and encode current active-run saves

**Files:**
- Create: `packages/engine/src/save-error.ts`
- Create: `packages/engine/src/save-schema.ts`
- Create: `packages/engine/src/save-codec.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/save-codec.test.ts`

**Interfaces:**
- Consumes: `ActiveRun`, `stableJson`, version constants
- Produces: `SaveLoadError` with `kind`, `path`, and safe message
- Produces: `validateActiveRun(input): ActiveRun`
- Produces: `encodeActiveRun(state): string`
- Produces initially: `decodeActiveRun(json): ActiveRun` for `v1` only; Task 6 extends it through migration

- [ ] **Step 1: Write failing current-save round-trip and corruption tests**

```ts
// packages/engine/test/save-codec.test.ts
import { describe, expect, it } from 'vitest';
import { createDemoRun, decodeActiveRun, encodeActiveRun, resolveCommand, SaveLoadError } from '../src/index.js';

describe('active-run save codec', () => {
  it('round-trips current state to identical stable bytes', () => {
    const state = createDemoRun();
    const encoded = encodeActiveRun(state);
    expect(encodeActiveRun(decodeActiveRun(encoded))).toBe(encoded);
    expect(encoded.startsWith('{"activeFloorId"')).toBe(true);
  });

  it.each([
    ['contentHash', 'bad'],
    ['activeFloorId', 'floor.missing'],
    ['hero.x', 99],
    ['floors.0.tiles', [1]],
    ['floors.0.tiles.8', 9],
    ['rng.combat', [0, 0, 0, 0]],
  ] as const)('rejects corrupt %s with a safe path', (path, replacement) => {
    const input = structuredClone(createDemoRun()) as Record<string, unknown>;
    const segments = path.split('.');
    let target: Record<string, unknown> | unknown[] = input;
    for (const segment of segments.slice(0, -1)) target = target[Number.isNaN(Number(segment)) ? segment : Number(segment)] as typeof target;
    target[Number.isNaN(Number(segments.at(-1))) ? segments.at(-1)! : Number(segments.at(-1))] = replacement;
    expect(() => decodeActiveRun(JSON.stringify(input))).toThrow(SaveLoadError);
    try { decodeActiveRun(JSON.stringify(input)); } catch (error) {
      expect((error as SaveLoadError).path).toContain(path.split('.')[0]);
      expect((error as Error).message).not.toContain(JSON.stringify(input));
    }
  });

  it('rejects malformed JSON and unknown object keys', () => {
    expect(() => decodeActiveRun('{')).toThrow(/JSON/);
    expect(() => decodeActiveRun(JSON.stringify({ ...createDemoRun(), surprise: true }))).toThrow(/surprise/);
  });

  it('rejects duplicate floor, entity, and recent-command identifiers', () => {
    const state = createDemoRun();
    expect(() => encodeActiveRun({ ...state, floors: [...state.floors, state.floors[0]!] })).toThrow(/floorId/);
    const floor = state.floors[0]!;
    const entity = { entityId: 'entity.1', x: 2, y: 1 };
    expect(() => encodeActiveRun({ ...state, floors: [{ ...floor, entities: [entity, entity] }] })).toThrow(/entityId/);
    const processed = resolveCommand(state, { type: 'wait', commandId: 'command.saved', expectedRevision: 0 }).state;
    const record = processed.recentCommands[0]!;
    expect(() => encodeActiveRun({ ...processed, recentCommands: [record, record] })).toThrow(/command identifier/);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test --workspace @woven-deep/engine -- --run test/save-codec.test.ts`

Expected: FAIL because the codec and error types are missing.

- [ ] **Step 3: Add typed safe load errors**

```ts
// packages/engine/src/save-error.ts
export type SaveLoadErrorKind = 'malformed_json' | 'invalid_save' | 'unsupported_version' | 'migration_failed';

export class SaveLoadError extends Error {
  constructor(
    readonly kind: SaveLoadErrorKind,
    readonly path: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'SaveLoadError';
  }
}
```

- [ ] **Step 4: Define strict structural schemas**

Implement `save-schema.ts` with `z.strictObject` throughout; do not use coercion or passthrough schemas. Use these exact reusable primitives and unions:

```ts
// packages/engine/src/save-schema.ts
import { z } from 'zod';
import type { ActiveRun } from './model.js';
import { ENGINE_GAME_VERSION, RECENT_COMMAND_LIMIT, RNG_STREAM_NAMES, SAVE_SCHEMA_VERSION } from './versions.js';
import { SaveLoadError } from './save-error.js';

const identifier = z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,127}$/);
const heroName = z.string().refine((name) => [...name].length >= 1 && [...name].length <= 40 && name.normalize('NFC') === name && !/[\p{Cc}\p{Cf}]/u.test(name));
const safeNonNegative = z.number().int().safe().nonnegative();
const uint32 = z.number().int().min(0).max(0xffff_ffff);
const uint32Tuple = z.tuple([uint32, uint32, uint32, uint32]);
const uint32State = uint32Tuple.refine((state) => state.some((word) => word !== 0), 'state must not be all zero');
const point = z.strictObject({ x: safeNonNegative, y: safeNonNegative });
const direction = z.enum(['north', 'south', 'east', 'west']);
const moveCommand = z.strictObject({ type: z.literal('move'), commandId: identifier, expectedRevision: safeNonNegative, direction });
const waitCommand = z.strictObject({ type: z.literal('wait'), commandId: identifier, expectedRevision: safeNonNegative });
const command = z.discriminatedUnion('type', [moveCommand, waitCommand]);
const movedEvent = z.strictObject({ type: z.literal('hero.moved'), eventId: identifier, heroId: identifier, from: point, to: point });
const waitedEvent = z.strictObject({ type: z.literal('hero.waited'), eventId: identifier, heroId: identifier, x: safeNonNegative, y: safeNonNegative });
const invalidEvent = z.strictObject({ type: z.literal('action.invalid'), eventId: identifier, commandId: identifier, reason: z.enum(['blocked.bounds', 'blocked.wall']) });
const event = z.discriminatedUnion('type', [movedEvent, waitedEvent, invalidEvent]);
const appliedResult = z.strictObject({ status: z.literal('applied'), commandId: identifier, revision: safeNonNegative, turn: safeNonNegative });
const invalidResult = z.strictObject({ status: z.literal('invalid'), commandId: identifier, revision: safeNonNegative, turn: safeNonNegative, reason: z.enum(['blocked.bounds', 'blocked.wall']) });
const processedResult = z.discriminatedUnion('status', [appliedResult, invalidResult]);
const recorded = z.strictObject({ command, result: processedResult, events: z.array(event).readonly() });
const entity = z.strictObject({ entityId: identifier, x: safeNonNegative, y: safeNonNegative });
const floor = z.strictObject({
  floorId: identifier,
  seed: uint32Tuple,
  generatorVersion: z.literal(1),
  width: z.number().int().min(1).max(512),
  height: z.number().int().min(1).max(512),
  depth: z.number().int().min(0).max(10_000),
  tiles: z.array(z.union([z.literal(0), z.literal(1)])).readonly(),
  entities: z.array(entity).readonly(),
});
const hero = z.strictObject({ heroId: identifier, name: heroName, floorId: identifier, x: safeNonNegative, y: safeNonNegative });
const rngEntries = Object.fromEntries(RNG_STREAM_NAMES.map((name) => [name, uint32State]));

const activeRunSchema = z.strictObject({
  schemaVersion: z.literal(SAVE_SCHEMA_VERSION),
  gameVersion: z.literal(ENGINE_GAME_VERSION),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  runId: identifier,
  runSeed: uint32Tuple,
  rng: z.strictObject(rngEntries as Record<(typeof RNG_STREAM_NAMES)[number], typeof uint32State>),
  revision: safeNonNegative,
  turn: safeNonNegative,
  hero,
  activeFloorId: identifier,
  floors: z.array(floor).min(1).readonly(),
  recentCommands: z.array(recorded).max(RECENT_COMMAND_LIMIT).readonly(),
});
```

Add semantic checks in a dedicated function rather than a monolithic Zod callback, so paths remain explicit:

```ts
function fail(path: string, reason: string): never {
  throw new SaveLoadError('invalid_save', path, `Invalid save at ${path}: ${reason}`);
}

function ensurePosition(floorValue: z.infer<typeof floor>, x: number, y: number, path: string): void {
  if (x >= floorValue.width || y >= floorValue.height) fail(path, 'position is outside its floor');
  if (floorValue.tiles[y * floorValue.width + x] !== 1) fail(path, 'position is not on walkable terrain');
}

function validateSemantics(run: z.infer<typeof activeRunSchema>): ActiveRun {
  const floorIds = new Set<string>();
  const entityIds = new Set<string>();
  for (const [floorIndex, floorValue] of run.floors.entries()) {
    if (floorIds.has(floorValue.floorId)) fail(`floors.${floorIndex}.floorId`, 'floor identifier is duplicated');
    floorIds.add(floorValue.floorId);
    if (floorValue.tiles.length !== floorValue.width * floorValue.height) fail(`floors.${floorIndex}.tiles`, 'tile length does not match dimensions');
    for (const [entityIndex, entityValue] of floorValue.entities.entries()) {
      if (entityIds.has(entityValue.entityId)) fail(`floors.${floorIndex}.entities.${entityIndex}.entityId`, 'entity identifier is duplicated');
      entityIds.add(entityValue.entityId);
      ensurePosition(floorValue, entityValue.x, entityValue.y, `floors.${floorIndex}.entities.${entityIndex}`);
    }
  }
  const activeFloor = run.floors.find((candidate) => candidate.floorId === run.activeFloorId);
  if (!activeFloor) fail('activeFloorId', 'active floor does not exist');
  if (run.hero.floorId !== run.activeFloorId) fail('hero.floorId', 'hero must occupy the active floor');
  ensurePosition(activeFloor, run.hero.x, run.hero.y, 'hero');
  if (run.turn !== run.revision) fail('turn', 'turn and revision must match in schema v1');

  const commandIds = new Set<string>();
  let previousRevision = 0;
  for (const [index, recordValue] of run.recentCommands.entries()) {
    const path = `recentCommands.${index}`;
    if (commandIds.has(recordValue.command.commandId)) fail(`${path}.command.commandId`, 'command identifier is duplicated');
    commandIds.add(recordValue.command.commandId);
    if (recordValue.command.commandId !== recordValue.result.commandId) fail(`${path}.result.commandId`, 'result does not match command');
    if (recordValue.events.length !== 1) fail(`${path}.events`, 'processed commands require exactly one event');
    if (recordValue.events.some((entry) => entry.eventId !== recordValue.command.commandId)) fail(`${path}.events`, 'event identifier does not match command');
    const eventValue = recordValue.events[0]!;
    if (recordValue.result.status === 'invalid') {
      if (eventValue.type !== 'action.invalid' || eventValue.commandId !== recordValue.command.commandId || eventValue.reason !== recordValue.result.reason) {
        fail(`${path}.events.0`, 'invalid result and event are inconsistent');
      }
    } else if (recordValue.command.type === 'wait') {
      if (eventValue.type !== 'hero.waited' || eventValue.heroId !== run.hero.heroId) fail(`${path}.events.0`, 'wait result and event are inconsistent');
      ensurePosition(activeFloor, eventValue.x, eventValue.y, `${path}.events.0`);
    } else if (eventValue.type !== 'hero.moved' || eventValue.heroId !== run.hero.heroId) {
      fail(`${path}.events.0`, 'move result and event are inconsistent');
    } else {
      ensurePosition(activeFloor, eventValue.from.x, eventValue.from.y, `${path}.events.0.from`);
      ensurePosition(activeFloor, eventValue.to.x, eventValue.to.y, `${path}.events.0.to`);
    }
    if (recordValue.result.revision < previousRevision || recordValue.result.revision > run.revision) fail(`${path}.result.revision`, 'record revisions are not monotonic');
    if (recordValue.result.turn > run.turn) fail(`${path}.result.turn`, 'record turn exceeds current turn');
    if (recordValue.result.turn !== recordValue.result.revision) fail(`${path}.result.turn`, 'result turn and revision must match in schema v1');
    if (recordValue.result.status === 'applied' && recordValue.result.revision !== recordValue.command.expectedRevision + 1) fail(`${path}.result.revision`, 'applied revision is inconsistent');
    if (recordValue.result.status === 'invalid' && recordValue.result.revision !== recordValue.command.expectedRevision) fail(`${path}.result.revision`, 'invalid revision is inconsistent');
    previousRevision = recordValue.result.revision;
  }
  return run as ActiveRun;
}

export function validateActiveRun(input: unknown): ActiveRun {
  const parsed = activeRunSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const path = issue.path.join('.') || '$';
    throw new SaveLoadError('invalid_save', path, `Invalid save at ${path}: ${issue.message}`);
  }
  return validateSemantics(parsed.data);
}
```

- [ ] **Step 5: Implement the current-version codec**

```ts
// packages/engine/src/save-codec.ts
import type { ActiveRun } from './model.js';
import { stableJson } from './stable-json.js';
import { SaveLoadError } from './save-error.js';
import { validateActiveRun } from './save-schema.js';

export function encodeActiveRun(state: ActiveRun): string {
  return stableJson(validateActiveRun(state));
}

export function decodeActiveRun(json: string): ActiveRun {
  let input: unknown;
  try { input = JSON.parse(json); }
  catch (cause) { throw new SaveLoadError('malformed_json', '$', 'Save is not valid JSON', { cause }); }
  return validateActiveRun(input);
}
```

Export `save-error.ts`, `save-schema.ts`, and `save-codec.ts` from `src/index.ts`.

- [ ] **Step 6: Run GREEN and complete current-version edge coverage**

Run: `npm test --workspace @woven-deep/engine -- --run test/save-codec.test.ts`

Expected: all round-trip, strict-structure, corruption, and semantic-reference cases pass.

Add focused assertions for a hero on a wall, a non-NFC/control-character hero name, a recent-command result whose command ID differs, a non-monotonic record ring, and a stream word above `0xffff_ffff`; run again and require all cases to pass.

```ts
it('rejects remaining semantic and numeric corruption boundaries', () => {
  const state = createDemoRun();
  expect(() => encodeActiveRun({ ...state, hero: { ...state.hero, x: 0, y: 0 } })).toThrow(/walkable/);
  expect(() => encodeActiveRun({ ...state, hero: { ...state.hero, name: 'e\u0301' } })).toThrow(/hero.name|Invalid save/);
  expect(() => encodeActiveRun({ ...state, hero: { ...state.hero, name: 'Ada\u0000' } })).toThrow(/hero.name|Invalid save/);
  expect(() => encodeActiveRun({ ...state, rng: { ...state.rng, combat: [0x1_0000_0000, 1, 2, 3] } })).toThrow(/rng.combat/);

  const first = resolveCommand(state, { type: 'wait', commandId: 'command.first', expectedRevision: 0 }).state;
  const second = resolveCommand(first, { type: 'wait', commandId: 'command.second', expectedRevision: 1 }).state;
  const [firstRecord, secondRecord] = second.recentCommands;
  expect(() => encodeActiveRun({ ...second, recentCommands: [secondRecord!, firstRecord!] })).toThrow(/monotonic/);
  expect(() => encodeActiveRun({
    ...first,
    recentCommands: [{
      ...first.recentCommands[0]!,
      result: { ...first.recentCommands[0]!.result, commandId: 'command.different' },
    }],
  })).toThrow(/result does not match command/);
});
```

Run: `npm run typecheck --workspace @woven-deep/engine && git diff --check`

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src packages/engine/test/save-codec.test.ts
git commit -m "feat: validate byte-stable active-run saves"
```

---

### Task 6: Migrate a real legacy save fixture

**Files:**
- Create: `packages/engine/src/migration.ts`
- Create: `packages/engine/test/fixtures/v0-save.json`
- Create: `packages/engine/test/fixtures/v1-migrated-save.json`
- Modify: `packages/engine/src/save-codec.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/migration.test.ts`

**Interfaces:**
- Consumes: `expandLegacySeed`, `deriveRngStreams`, `validateActiveRun`, `stableJson`
- Produces: `migrateActiveRun(input): ActiveRun`
- Changes: `decodeActiveRun` migrates parsed input before current validation

- [ ] **Step 1: Add a checked-in legacy fixture and failing migration assertions**

Use this exact compact fixture, formatted with two-space indentation only for source readability:

```json
// packages/engine/test/fixtures/v0-save.json
{
  "schemaVersion": 0,
  "gameVersion": "0.1.0",
  "contentHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "runId": "run.legacy",
  "seed": 305419896,
  "revision": 2,
  "turn": 2,
  "hero": { "heroId": "hero.legacy", "name": "Ada", "floorId": "floor.legacy", "x": 2, "y": 1 },
  "floor": {
    "floorId": "floor.legacy",
    "seed": 305419896,
    "generatorVersion": 1,
    "width": 5,
    "height": 4,
    "depth": 1,
    "tiles": [0,0,0,0,0,0,1,1,1,0,0,1,1,1,0,0,0,0,0,0],
    "entities": []
  }
}
```

```ts
// packages/engine/test/migration.test.ts
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeActiveRun, encodeActiveRun, migrateActiveRun, SaveLoadError } from '../src/index.js';

const fixture = (name: string) => readFile(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');

describe('active-run migrations', () => {
  it('migrates the real v0 fixture to exact checked-in v1 bytes', async () => {
    const legacy = await fixture('v0-save.json');
    const expected = (await fixture('v1-migrated-save.json')).trimEnd();
    expect(encodeActiveRun(decodeActiveRun(legacy))).toBe(expected);
  });

  it('is idempotent for current documents', () => {
    const current = decodeActiveRun(encodeActiveRun(migrateActiveRun({
      schemaVersion: 0,
      gameVersion: '0.1.0',
      contentHash: 'a'.repeat(64),
      runId: 'run.inline',
      seed: 1,
      revision: 0,
      turn: 0,
      hero: { heroId: 'hero.inline', name: 'Ada', floorId: 'floor.inline', x: 1, y: 1 },
      floor: { floorId: 'floor.inline', seed: 1, generatorVersion: 1, width: 3, height: 3, depth: 1, tiles: [0,0,0,0,1,0,0,0,0], entities: [] },
    })));
    expect(migrateActiveRun(current)).toEqual(current);
  });

  it.each([-1, 2, 999])('rejects unsupported schema version %s', (schemaVersion) => {
    expect(() => migrateActiveRun({ schemaVersion })).toThrow(SaveLoadError);
    try { migrateActiveRun({ schemaVersion }); } catch (error) { expect((error as SaveLoadError).kind).toBe('unsupported_version'); }
  });

  it('rejects incomplete legacy data instead of guessing content binding', () => {
    expect(() => migrateActiveRun({ schemaVersion: 0, seed: 1 })).toThrow(/contentHash|Invalid legacy/);
  });
});
```

Create `v1-migrated-save.json` as this independently calculated stable JSON line:

```json
{"activeFloorId":"floor.legacy","contentHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","floors":[{"depth":1,"entities":[],"floorId":"floor.legacy","generatorVersion":1,"height":4,"seed":[2986037511,744488920,2204577711,2810942300],"tiles":[0,0,0,0,0,0,1,1,1,0,0,1,1,1,0,0,0,0,0,0],"width":5}],"gameVersion":"0.1.0","hero":{"floorId":"floor.legacy","heroId":"hero.legacy","name":"Ada","x":2,"y":1},"recentCommands":[],"revision":2,"rng":{"combat":[4182890240,742980537,371130335,2272854415],"effects":[394922053,782429746,791961853,2027658551],"encounters":[2875054216,1500702155,3695425183,1362299020],"generation":[1772974510,3623323994,1180398686,4289890046],"loot":[3083088985,2714152083,3489508821,2100808531],"narrative":[2974878737,3168120939,2699360125,2544098397]},"runId":"run.legacy","runSeed":[2986037511,744488920,2204577711,2810942300],"schemaVersion":1,"turn":2}
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test --workspace @woven-deep/engine -- --run test/migration.test.ts`

Expected: FAIL because `migrateActiveRun` does not exist.

- [ ] **Step 3: Implement strict `v0` parsing and deterministic migration**

```ts
// packages/engine/src/migration.ts
import { z } from 'zod';
import type { ActiveRun, FloorSnapshot } from './model.js';
import { deriveRngStreams, expandLegacySeed } from './random.js';
import { SaveLoadError } from './save-error.js';
import { validateActiveRun } from './save-schema.js';
import { ENGINE_GAME_VERSION, SAVE_SCHEMA_VERSION } from './versions.js';

const identifier = z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,127}$/);
const nonNegative = z.number().int().safe().nonnegative();
const legacyFloor = z.strictObject({
  floorId: identifier,
  seed: z.number().int().min(0).max(0xffff_ffff),
  generatorVersion: z.literal(1),
  width: z.number().int().min(1).max(512),
  height: z.number().int().min(1).max(512),
  depth: z.number().int().min(0).max(10_000),
  tiles: z.array(z.union([z.literal(0), z.literal(1)])),
  entities: z.array(z.strictObject({ entityId: identifier, x: nonNegative, y: nonNegative })),
});
const legacySave = z.strictObject({
  schemaVersion: z.literal(0),
  gameVersion: z.literal(ENGINE_GAME_VERSION),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  runId: identifier,
  seed: z.number().int().min(0).max(0xffff_ffff),
  revision: nonNegative,
  turn: nonNegative,
  hero: z.strictObject({ heroId: identifier, name: z.string(), floorId: identifier, x: nonNegative, y: nonNegative }),
  floor: legacyFloor,
});

export function migrateActiveRun(input: unknown): ActiveRun {
  if (!input || typeof input !== 'object' || !('schemaVersion' in input)) {
    throw new SaveLoadError('unsupported_version', 'schemaVersion', 'Save schema version is missing');
  }
  const version = (input as { schemaVersion?: unknown }).schemaVersion;
  if (version === SAVE_SCHEMA_VERSION) return validateActiveRun(input);
  if (version !== 0) throw new SaveLoadError('unsupported_version', 'schemaVersion', `Save schema version ${String(version)} is not supported`);
  const parsed = legacySave.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const path = issue.path.join('.') || '$';
    throw new SaveLoadError('migration_failed', path, `Invalid legacy save at ${path}: ${issue.message}`);
  }
  const runSeed = expandLegacySeed(parsed.data.seed);
  const floor: FloorSnapshot = { ...parsed.data.floor, seed: expandLegacySeed(parsed.data.floor.seed) };
  try {
    return validateActiveRun({
      schemaVersion: SAVE_SCHEMA_VERSION,
      gameVersion: ENGINE_GAME_VERSION,
      contentHash: parsed.data.contentHash,
      runId: parsed.data.runId,
      runSeed,
      rng: deriveRngStreams(runSeed),
      revision: parsed.data.revision,
      turn: parsed.data.turn,
      hero: parsed.data.hero,
      activeFloorId: parsed.data.hero.floorId,
      floors: [floor],
      recentCommands: [],
    });
  } catch (cause) {
    if (cause instanceof SaveLoadError) {
      throw new SaveLoadError('migration_failed', cause.path, `Legacy save cannot be migrated at ${cause.path}`, { cause });
    }
    throw cause;
  }
}
```

Update `decodeActiveRun`:

```ts
import { migrateActiveRun } from './migration.js';

return migrateActiveRun(input);
```

Export migration from `src/index.ts`.

- [ ] **Step 4: Independently verify the expected byte-stable v1 fixture**

Run a one-off Node reference command that copies the design's SplitMix32 formulas without importing engine production code. Require it to reproduce the checked-in run/floor seed `[2986037511,744488920,2204577711,2810942300]` and all six checked-in RNG states. Manually verify the active floor, one floor, empty recent ring, and preserved identifiers and coordinates. Do not make the test generate or overwrite its own expected fixture.

The committed `v1-migrated-save.json` must contain the single-line stable JSON plus one source-file newline; the test's `trimEnd()` removes only that source newline.

- [ ] **Step 5: Run migration GREEN and all save tests**

Run: `npm test --workspace @woven-deep/engine -- --run test/migration.test.ts test/save-codec.test.ts`

Expected: migration fixtures match exactly; current saves remain idempotent; unsupported and incomplete legacy saves fail safely.

Run: `npm run typecheck --workspace @woven-deep/engine && git diff --check`

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src packages/engine/test/migration.test.ts packages/engine/test/fixtures
git commit -m "feat: migrate legacy active-run saves"
```

---

### Task 7: Verify deterministic replay across save boundaries

**Files:**
- Create: `packages/engine/src/replay.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/replay.test.ts`

**Interfaces:**
- Consumes: `ActiveRun`, `GameCommand`, `resolveCommand`, `encodeActiveRun`, `decodeActiveRun`, `stableJson`
- Produces: `ReplayStep`, `ReplayResult`
- Produces: `replayCommands(initial, commands): ReplayResult`

- [ ] **Step 1: Write failing continuous-versus-reloaded replay tests**

```ts
// packages/engine/test/replay.test.ts
import { describe, expect, it } from 'vitest';
import {
  stableJson, createDemoRun, decodeActiveRun, encodeActiveRun, replayCommands, resolveCommand,
  type GameCommand,
} from '../src/index.js';

const commands: readonly GameCommand[] = [
  { type: 'move', commandId: 'command.1', expectedRevision: 0, direction: 'east' },
  { type: 'move', commandId: 'command.2', expectedRevision: 1, direction: 'east' },
  { type: 'move', commandId: 'command.3', expectedRevision: 2, direction: 'south' },
  { type: 'wait', commandId: 'command.4', expectedRevision: 2 },
  { type: 'move', commandId: 'command.5', expectedRevision: 3, direction: 'west' },
  { type: 'wait', commandId: 'command.4', expectedRevision: 2 },
  { type: 'move', commandId: 'command.6', expectedRevision: 0, direction: 'east' },
];

describe('replayCommands', () => {
  it('produces byte-identical final state and transcript after save/reload', () => {
    const continuous = replayCommands(createDemoRun(), commands);
    const before = replayCommands(createDemoRun(), commands.slice(0, 4));
    const reloaded = decodeActiveRun(encodeActiveRun(before.state));
    const after = replayCommands(reloaded, commands.slice(4));
    expect(encodeActiveRun(after.state)).toBe(encodeActiveRun(continuous.state));
    expect(stableJson([...before.steps, ...after.steps])).toBe(stableJson(continuous.steps));
  });

  it('does not mutate the initial state or command sequence', () => {
    const initial = createDemoRun();
    const snapshot = structuredClone(initial);
    const commandSnapshot = structuredClone(commands);
    replayCommands(initial, commands);
    expect(initial).toEqual(snapshot);
    expect(commands).toEqual(commandSnapshot);
  });

  it('preserves replay properties for 100 generated command sequences', () => {
    const directions = ['north', 'east', 'south', 'west'] as const;
    for (let seed = 0; seed < 100; seed += 1) {
      let state = createDemoRun();
      const generated: GameCommand[] = [];
      for (let index = 0; index < 24; index += 1) {
        const command: GameCommand = {
          type: 'move',
          commandId: `property.${seed}.${index}`,
          expectedRevision: state.revision,
          direction: directions[(seed * 17 + index * 31) % directions.length]!,
        };
        generated.push(command);
        state = resolveCommand(state, command).state;
      }
      const continuous = replayCommands(createDemoRun(), generated);
      const before = replayCommands(createDemoRun(), generated.slice(0, 12));
      const after = replayCommands(decodeActiveRun(encodeActiveRun(before.state)), generated.slice(12));
      expect(encodeActiveRun(after.state)).toBe(encodeActiveRun(continuous.state));
      expect(stableJson([...before.steps, ...after.steps])).toBe(stableJson(continuous.steps));
    }
  });
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test --workspace @woven-deep/engine -- --run test/replay.test.ts`

Expected: FAIL because `replayCommands` is missing.

- [ ] **Step 3: Implement replay as a thin pure coordinator**

```ts
// packages/engine/src/replay.ts
import type { ActiveRun, CommandResult, DomainEvent, GameCommand } from './model.js';
import { resolveCommand } from './reducer.js';

export interface ReplayStep {
  readonly command: GameCommand;
  readonly result: CommandResult;
  readonly events: readonly DomainEvent[];
}

export interface ReplayResult {
  readonly state: ActiveRun;
  readonly steps: readonly ReplayStep[];
}

export function replayCommands(initial: ActiveRun, commands: readonly GameCommand[]): ReplayResult {
  let state = initial;
  const steps: ReplayStep[] = [];
  for (const command of commands) {
    const resolution = resolveCommand(state, command);
    state = resolution.state;
    steps.push({ command, result: resolution.result, events: resolution.events });
  }
  return { state, steps };
}
```

Export it from `src/index.ts`.

- [ ] **Step 4: Run GREEN and deterministic repeated-seed cases**

Run: `npm test --workspace @woven-deep/engine -- --run test/replay.test.ts`

Expected: all 3 replay tests pass, including 100 deterministic generated sequences across a save split.

Run: `npm test --workspace @woven-deep/engine && npm run typecheck --workspace @woven-deep/engine`

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src packages/engine/test/replay.test.ts
git commit -m "feat: replay deterministic command sequences"
```

---

### Task 8: Add the CLI exit demonstration and full milestone verification

**Files:**
- Create: `scripts/engine-demo.mjs`
- Create: `packages/engine/fixtures/demo.commands`
- Test: `packages/engine/test/cli.test.ts`
- Modify: `package.json`
- Modify: `Dockerfile`

**Interfaces:**
- Consumes: built `@woven-deep/engine` root export
- Produces: `npm run engine:demo`
- Produces: CLI output with position, turn, revision, events, SHA-256 final-state hash, and `deterministic replay verified`

- [ ] **Step 1: Add the authored command script and failing CLI integration test**

```text
# packages/engine/fixtures/demo.commands
move command.1 0 east
move command.2 1 east
move command.3 2 south
wait command.4 2
save
reload
move command.5 3 west
repeat command.4
move command.6 0 east
```

```ts
// packages/engine/test/cli.test.ts
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const script = fileURLToPath(new URL('../../../scripts/engine-demo.mjs', import.meta.url));
const commands = fileURLToPath(new URL('../fixtures/demo.commands', import.meta.url));

describe('engine demonstration CLI', () => {
  it('verifies deterministic state and events across reload', () => {
    const result = spawnSync(process.execPath, [script, '--verify', commands], { cwd: root, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/hero \(2,1\) turn 4 revision 4/);
    expect(result.stdout).toMatch(/state [a-f0-9]{64}/);
    expect(result.stdout).toContain('invalid blocked.wall');
    expect(result.stdout).toContain('rejected stale_revision');
    expect(result.stdout).toContain('event hero.moved');
    expect(result.stdout).toContain('event action.invalid');
    expect(result.stdout).toContain('event hero.waited');
    expect(result.stdout).toContain('deterministic replay verified');
  });

  it('fails safely for malformed scripts', () => {
    const result = spawnSync(process.execPath, [script, '--verify', new URL('missing.commands', import.meta.url).pathname], { cwd: root, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('engine demo failed');
  });
});
```

- [ ] **Step 2: Build engine and verify CLI RED**

Run: `npm run build --workspace @woven-deep/engine && npm test --workspace @woven-deep/engine -- --run test/cli.test.ts`

Expected: FAIL because `scripts/engine-demo.mjs` is missing.

- [ ] **Step 3: Implement the Node-only CLI coordinator**

`scripts/engine-demo.mjs` must import only Node APIs plus `../packages/engine/dist/index.js`. Implement these exact DSL semantics:

- Ignore blank lines.
- `move <id> <expectedRevision> <direction>` creates a move command.
- `wait <id> <expectedRevision>` creates a wait command.
- `save` records the split point and current byte-stable save.
- `reload` replaces current state with `decodeActiveRun(saved)`; fail if no preceding save exists.
- `repeat <id>` reuses the exact previously parsed command; fail if unknown.
- Unknown directives, extra/missing fields, unsafe revisions, and invalid directions fail with a line number.

Use this coordinator shape:

```js
// scripts/engine-demo.mjs
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  assertOpaqueId, stableJson, createDemoRun, decodeActiveRun, encodeActiveRun, resolveCommand,
} from '../packages/engine/dist/index.js';

function stateHash(state) {
  return createHash('sha256').update(encodeActiveRun(state)).digest('hex');
}

function parseCommand(parts, lineNumber) {
  const [verb, commandId, revisionText, direction, ...extra] = parts;
  const expectedRevision = Number(revisionText);
  if (!commandId || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || extra.length) throw new Error(`line ${lineNumber}: invalid command`);
  assertOpaqueId(commandId, `line ${lineNumber} commandId`);
  if (verb === 'wait' && direction === undefined) return { type: 'wait', commandId, expectedRevision };
  if (verb === 'move' && ['north', 'south', 'east', 'west'].includes(direction)) return { type: 'move', commandId, expectedRevision, direction };
  throw new Error(`line ${lineNumber}: invalid command`);
}

async function runProgram(path, reloadSaves) {
  const lines = (await readFile(path, 'utf8')).split(/\r?\n/);
  let state = createDemoRun();
  let saved;
  const parsed = new Map();
  const steps = [];
  for (const [index, raw] of lines.entries()) {
    const text = raw.trim();
    if (!text) continue;
    const parts = text.split(/\s+/);
    if (parts[0] === 'save') { if (parts.length !== 1) throw new Error(`line ${index + 1}: save takes no arguments`); saved = encodeActiveRun(state); continue; }
    if (parts[0] === 'reload') { if (parts.length !== 1 || saved === undefined) throw new Error(`line ${index + 1}: reload requires a save`); if (reloadSaves) state = decodeActiveRun(saved); continue; }
    let command;
    if (parts[0] === 'repeat') {
      if (parts.length !== 2 || !parsed.has(parts[1])) throw new Error(`line ${index + 1}: repeat requires a known command`);
      command = parsed.get(parts[1]);
    } else {
      command = parseCommand(parts, index + 1);
      parsed.set(command.commandId, command);
    }
    const resolution = resolveCommand(state, command);
    state = resolution.state;
    steps.push({ command, result: resolution.result, events: resolution.events });
  }
  return { state, steps };
}

try {
  const verify = process.argv[2] === '--verify';
  const path = verify ? process.argv[3] : process.argv[2];
  if (!path) throw new Error('usage: engine-demo [--verify] <commands>');
  const split = await runProgram(path, true);
  const hero = split.state.hero;
  for (const step of split.steps) {
    const detail = step.result.status === 'invalid' || step.result.status === 'rejected' ? ` ${step.result.reason}` : '';
    process.stdout.write(`${step.result.status}${detail}\n`);
    for (const event of step.events) process.stdout.write(`event ${event.type} ${stableJson(event)}\n`);
  }
  process.stdout.write(`hero (${hero.x},${hero.y}) turn ${split.state.turn} revision ${split.state.revision}\n`);
  process.stdout.write(`state ${stateHash(split.state)}\n`);
  if (verify) {
    const continuous = await runProgram(path, false);
    if (encodeActiveRun(continuous.state) !== encodeActiveRun(split.state) || stableJson(continuous.steps) !== stableJson(split.steps)) {
      throw new Error('continuous and save/reload execution diverged');
    }
    process.stdout.write('deterministic replay verified\n');
  }
} catch (error) {
  process.stderr.write(`engine demo failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
```

- [ ] **Step 4: Wire the root command and ensure Docker can verify it**

Add to root `package.json`:

```json
"engine:demo": "npm run build --workspace @woven-deep/engine && node scripts/engine-demo.mjs --verify packages/engine/fixtures/demo.commands"
```

The existing Docker build already copies `packages/` and `scripts/`. Update its build verification line from:

```dockerfile
RUN npm test && npm run typecheck && npm run build
```

to:

```dockerfile
RUN npm test && npm run typecheck && npm run build && npm run engine:demo
```

Keep the pruned workspace graph complete in the runtime stage by adding these copies beside the existing content-package copies:

```dockerfile
COPY --from=build /app/packages/engine/package.json ./packages/engine/package.json
COPY --from=build /app/packages/engine/dist ./packages/engine/dist
```

- [ ] **Step 5: Run CLI GREEN and milestone verification**

Run: `npm run engine:demo`

Expected output includes:

```text
invalid blocked.wall
rejected stale_revision
hero (2,1) turn 4 revision 4
state <64 lowercase hex characters>
deterministic replay verified
```

Run all milestone gates from the repository root:

```bash
npm ci
npm run content:validate
npm test
npm run typecheck
npm run build
npm run engine:demo
docker compose build
git diff --check
git status --short
```

Expected:

- Content validation still reports the foundation hash and two entries.
- All engine, content, server, and web tests pass.
- Every workspace type-checks and builds.
- The CLI reports byte-equivalent state and events across save/reload.
- The production image runs the engine demonstration during its build and finishes successfully.
- Before the final commit, `git status --short` lists only the intended Task 8 files.

- [ ] **Step 6: Commit**

```bash
git add scripts/engine-demo.mjs packages/engine/fixtures packages/engine/test/cli.test.ts package.json Dockerfile
git commit -m "feat: demonstrate deterministic engine replay"
```

---

## Milestone completion review

After Task 8 passes its task review:

1. Generate a whole-branch review package from the merge commit `70a2ad8` to the final head.
2. Request an independent whole-branch review against this plan and `docs/superpowers/specs/2026-07-13-deterministic-engine-kernel-design.md`.
3. Fix every Critical and Important finding with one focused fix agent; re-review until clean.
4. Run fresh `npm ci`, `npm test`, `npm run typecheck`, `npm run build`, `npm run engine:demo`, and `docker compose build` evidence.
5. Use the finishing-development-branch workflow to offer merge, draft PR, keep, or discard choices. Do not call the full game complete; report milestone 2 only.
