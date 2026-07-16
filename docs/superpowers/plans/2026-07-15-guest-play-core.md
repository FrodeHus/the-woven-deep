# Guest Play Core (5A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Milestone 5A — a playable guest dungeon session in a desktop browser: a real engine run from a production constructor, rendered as an ASCII playfield with an animated effects layer, driven entirely by keyboard, persisted in `sessionStorage`, proven by Playwright end-to-end plus Vitest suites.

**Architecture:** Two engine entry points (`createNewRun`, `descendToNextFloor`) keep run construction and floor transition inside the engine boundary. A framework-free guest session layer in `apps/web` owns the `ActiveRun`, dispatches intents through `resolveCommand`, re-projects, and persists via the engine save codec. React binds through one hand-rolled `useSyncExternalStore` store and renders the Tactical Triptych: a DOM-cell grid layer carrying engine truth plus a decorative, `aria-hidden` effects layer for animated light and transient event effects.

**Tech Stack:** TypeScript 5.8+, Node.js 22.12+, React 19, Vite 7, Vitest 3.2, Testing Library, Playwright (`@playwright/test`, the milestone's only new dependency), Zod 4 at boundaries only.

## Global Constraints

- Follow `docs/superpowers/specs/2026-07-15-guest-play-core-design.md`; amend and reapprove the design before changing an approved rule.
- The engine stays browser-safe, deterministic, and clock-free: no React, Fastify, SQLite, browser storage, Node-only APIs, wall clocks, or ambient randomness (`browser-boundary.test.ts` enforces this — keep it green).
- The client adds no runtime dependencies. Playwright is the only new dev dependency, in `apps/web` only.
- The session core (`apps/web/src/session/`) is framework-free TypeScript: no React imports; `sessionStorage` only behind the two-method storage interface.
- Saves go through `encodeActiveRun`/`decodeActiveRun` exclusively — never a bespoke JSON shape.
- Rendering truth/decoration split: what the player can see, target, and read is decided only by the cell layer and log; the effects layer is `aria-hidden`, ignores pointer events, animates only compositor-friendly properties (transform, opacity, filter), collapses under `prefers-reduced-motion`, and caps transient nodes (oldest dropped first).
- Command envelope field is `expectedRevision` (not `revision`). Projection field names are `actions`, `trade`, `actors` (not `availableActions`/`activeTrade`/`visibleActors`); cells use `glyph`/`token`/`knowledge`/`intensity`/`tint`.
- Content schema is v5, save schema is v6 — distinct constants.
- Engine work follows RED/GREEN TDD with strictly RED-first evidence; web tasks write component/unit tests alongside each unit and the failing test first wherever the unit is pure logic.
- Every task ends with focused tests green, a focused conventional commit (`feat:`/`fix:`/`test:`/`docs:`, lowercase, no scope), and review before the next task.

## File and Responsibility Map

### Engine (`packages/engine`)

- `src/new-run.ts`: `NewRunHero`, `DEFAULT_GUEST_HERO`, `createNewRun` — production run constructor with generated floor 1.
- `src/floor-transition.ts`: `descendToNextFloor` — stair-down transition to a freshly generated next floor.
- `src/index.ts`: export both modules.
- `test/new-run.test.ts`, `test/floor-transition.test.ts`: focused suites.

### Web session layer (`apps/web/src/session/`) — framework-free

- `storage.ts`: `SessionStorageLike` two-method interface, `browserSessionStorage` adapter, storage error classification.
- `intents.ts`: the `PlayerIntent` union shared by KeyRouter, command-builder, and session.
- `command-builder.ts`: pure `(intent, projection, state-view) → BuiltCommand | IntentRejection`.
- `event-log.ts`: pure fold of `PublicEvent[]` → capped log lines.
- `guest-session.ts`: `GuestSession` — owns pack + `ActiveRun`, dispatch/subscribe/getSnapshot, persistence, descend orchestration, new-run fallback.
- `store.ts`: `useGuestSession` — the `useSyncExternalStore` binding.

### Web UI (`apps/web/src/ui/`)

- `GridRenderer.tsx`: DOM-cell playfield (tiles, items, actors, hero overlay precedence).
- `EffectsLayer.tsx` + `effects-map.ts`: glow per light source, declarative event→transient-effect table.
- `panels.tsx`: `HeroPanel`, `ThreatPanel`, `LogPanel`, `StatusBar`.
- `BackpackMenu.tsx`: focus-trapped survival item menu.
- `KeyRouter.ts`: single keydown listener, static keymap, focus rules.
- `PlayScreen.tsx`: the Tactical Triptych composition.
- `App.tsx` (modify): boot flow — fetch pack, create/restore session, error and retry screens.
- `src/api.ts` (modify): `loadContentPack` returning the validated full pack.
- `src/styles.css` (modify): triptych layout, cell classes, effect keyframes, reduced-motion rules.

### Verification and docs

- `apps/web/e2e/guest-play.spec.ts`, `apps/web/playwright.config.ts`: end-to-end proof.
- `package.json` (root): `guest:e2e` script.
- `docs/superpowers/plans/2026-07-13-implementation-roadmap.md`: record the 5A–5D decomposition.

---

### Task 1: Engine `createNewRun` and `DEFAULT_GUEST_HERO`

**Files:**
- Create: `packages/engine/src/new-run.ts`
- Create: `packages/engine/test/new-run.test.ts`
- Modify: `packages/engine/src/index.ts`

**Interfaces:**
- Consumes: `deriveRngStreams`, `allocateIdentificationMap`, `createEncounterRunDecisions`, `allocateFloorSeed`, `generateFloor`, `createClassicTheme`, `addGeneratedFloor`, `emptyRunMetrics`, `emptyEquipment`, `encodeRunSeed`, `validateActiveRun`, and the exact `ActiveRun`/`ActorState`/`ItemInstance` shapes in `model.ts`, `actor-model.ts`, `item-model.ts`.
- Produces: `NewRunHero`, `DEFAULT_GUEST_HERO`, `createNewRun(input): ActiveRun` — Task 2 and the web session layer consume these exactly as declared below.

- [ ] **Step 1: Write failing constructor tests**

```ts
// packages/engine/test/new-run.test.ts
import { describe, expect, it } from 'vitest';
import { compileContentDirectory } from '@woven-deep/content';
import {
  createNewRun, DEFAULT_GUEST_HERO, decodeActiveRun, encodeActiveRun,
  heroActor, validateActiveRun,
} from '../src/index.js';

const pack = compileContentDirectory('content'); // same bundled-pack loading the other engine suites use — copy the exact helper from test/gameplay-fixture.test.ts if it differs

const SEED = [11, 22, 33, 44] as const;

describe('createNewRun', () => {
  it('builds a valid, deterministic schema-v6 run on a generated depth-1 floor', () => {
    const first = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const second = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    expect(encodeActiveRun(first)).toBe(encodeActiveRun(second));
    expect(() => validateActiveRun(first)).not.toThrow();
    expect(first.schemaVersion).toBe(6);
    expect(first.floors).toHaveLength(1);
    expect(first.floors[0]?.depth).toBe(1);
    expect(first.activeFloorId).toBe(first.floors[0]?.floorId);
    expect(first.metrics.floorsEntered).toBe(1);
    expect(first.metrics.deepestDepth).toBe(1);
    expect(first.conclusion).toBeNull();
    expect(first.contentHash).toBe(pack.hash);
  });

  it('places and equips the default hero', () => {
    const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const hero = heroActor(run);
    expect(hero.playerControlled).toBe(true);
    expect(hero.attributes).toEqual({ might: 10, agility: 10, vitality: 10, wits: 10, resolve: 10 });
    expect(run.hero.name).toBe('Wayfarer');
    const floor = run.floors[0]!;
    expect({ x: hero.x, y: hero.y }).toEqual(floor.stairUp);
    const equippedContent = Object.values(hero.equipment)
      .filter((id): id is string => id !== null)
      .map((itemId) => run.items.find((item) => item.itemId === itemId)?.contentId)
      .sort();
    expect(equippedContent).toEqual(['item.iron-sword', 'item.leather-armor', 'item.pitch-torch']);
    const torch = run.items.find((item) => item.contentId === 'item.pitch-torch')!;
    expect(torch.enabled).toBe(true);
    expect(torch.fuel).toBe(800);
    const rations = run.items.find((item) => item.contentId === 'item.travel-ration')!;
    expect(rations.location).toEqual({ type: 'backpack', actorId: hero.actorId });
    expect(rations.quantity).toBe(3);
  });

  it('derives different runs from different seeds and round-trips the codec', () => {
    const a = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const b = createNewRun({ pack, seed: [5, 6, 7, 8], hero: DEFAULT_GUEST_HERO });
    expect(a.runId).not.toBe(b.runId);
    expect(encodeActiveRun(decodeActiveRun(encodeActiveRun(a)))).toBe(encodeActiveRun(a));
  });

  it('rejects an all-zero seed and unknown equipment content', () => {
    expect(() => createNewRun({ pack, seed: [0, 0, 0, 0], hero: DEFAULT_GUEST_HERO })).toThrow(/seed/i);
    expect(() => createNewRun({
      pack, seed: SEED,
      hero: { ...DEFAULT_GUEST_HERO, equipped: [{ contentId: 'item.no-such-thing', slot: 'main-hand' }] },
    })).toThrow(/item\.no-such-thing/);
  });
});
```

Adjust the pack-loading line to the exact pattern the existing engine tests use for the bundled `content/` directory (see `test/run-records-cli.test.ts` and neighbours) — the suite must compile the real bundled pack, not a toy fixture.

- [ ] **Step 2: Run and verify RED**

Run: `npm test --workspace @woven-deep/engine -- --run test/new-run.test.ts`

Expected: FAIL — `createNewRun` is not exported.

- [ ] **Step 3: Implement the constructor**

```ts
// packages/engine/src/new-run.ts
export interface NewRunHeroItem { readonly contentId: OpaqueId; readonly slot: EquipmentSlot; readonly enabled?: boolean }
export interface NewRunBackpackItem { readonly contentId: OpaqueId; readonly quantity?: number }
export interface NewRunHero {
  readonly name: string;
  readonly attributes: BaseAttributes;
  readonly equipped: readonly NewRunHeroItem[];
  readonly backpack: readonly NewRunBackpackItem[];
}

export const DEFAULT_GUEST_HERO: NewRunHero = {
  name: 'Wayfarer',
  attributes: { might: 10, agility: 10, vitality: 10, wits: 10, resolve: 10 },
  equipped: [
    { contentId: 'item.iron-sword', slot: 'main-hand' },
    { contentId: 'item.leather-armor', slot: 'body' },
    { contentId: 'item.pitch-torch', slot: 'off-hand', enabled: true },
  ],
  backpack: [{ contentId: 'item.travel-ration', quantity: 3 }],
};

export function createNewRun(input: Readonly<{
  pack: CompiledContentPack;
  seed: Uint32State;
  hero: NewRunHero;
}>): ActiveRun;
```

Implementation order inside `createNewRun`:

1. Guard: throw a `RangeError` unless `isNonZeroState(seed)`.
2. `const rng = deriveRngStreams(seed)`; run identity `const runId = \`run.guest.${encodeRunSeed(seed)}\``.
3. Identification and encounter gates exactly as `generated-fixture.ts:23-40` does: `allocateIdentificationMap({ content: pack, rng })`, then `createEncounterRunDecisions({ encounters, protectionBonuses: [], state: identified.rng['population-gates'] })`, folding the advanced stream states back into the rng record.
4. `const allocation = allocateFloorSeed(<current generation stream>)`; `const generated = generateFloor({ floorId: FIRST_FLOOR_ID, floorSeed: allocation.floorSeed, depth: 1, width: 80, height: 25, theme: createClassicTheme(80, 25, { ambient: { color: [19, 23, 31], strength: 7 } }), vaults })` where `FIRST_FLOOR_ID = 'floor.depth-01'` and `vaults` filters the pack's vault entries. Throw an invariant error if `generated.floor.stairUp === null`.
5. Build the hero `ActorState` at `generated.floor.stairUp` mirroring `createDemoRun`'s hero exactly (`fixture.ts:83-105`): `playerControlled: true`, `disposition: 'friendly'`, `behaviorState: { intent: 'hold', goal: null, lastKnownTargets: [], investigation: null }`, `equipment: emptyEquipment()` then filled per `hero.equipped`.
6. Instantiate items with a local `instantiateHeroItem(definition, itemId, location, overrides)` helper copying the fixture `item()` pattern (`gameplay-fixture.ts:200-219`): `condition: 100`, `identified` from `definition.identification.mode === 'known'`, `fuel` from `definition.light?.fuelCapacity ?? null`, `enabled` honouring the `NewRunHeroItem.enabled` override for lights. Item IDs are deterministic: `item.hero.<contentId-suffix>`. Throw naming the content ID when a definition is missing or has no `equipment` for an equipped entry. Equipped entries set both `location: { type: 'equipped', actorId, slot }` and the actor's `equipment[slot]`.
7. Assemble the pre-integration skeleton: every `ActiveRun` field from `model.ts:645-675`, with `floors: []`, `activeFloorId: FIRST_FLOOR_ID`, `activeFloorEnteredAt: 0`, `revision: 0`, `turn: 0`, `worldTime: 0`, `metrics: emptyRunMetrics()`, `conclusion: null`, empty arrays for actors-other-than-hero, features, relationships, recentCommands, populations, standings, decisions, reputations, `activeTrade: null`, and `hero`/`survival` defaults copied exactly from `createDemoRun` (`fixture.ts:83-140` — sight radius, backpack capacity, currency 0, hunger reserve and stage).
8. Return `addGeneratedFloor(skeleton, generated, allocation, { content: pack })` — the skeleton is deliberately in the "transitioning to inserted floor" shape (`activeFloorId` set, hero on the new floor, floor not yet in `floors`), so integration places the population, records the floor entry, and runs `validateActiveRun` on the result.

Export `NewRunHero`, `NewRunHeroItem`, `NewRunBackpackItem`, `DEFAULT_GUEST_HERO`, `createNewRun` from `index.ts`.

- [ ] **Step 4: Run and verify GREEN**

Run: `npm test --workspace @woven-deep/engine -- --run test/new-run.test.ts test/browser-boundary.test.ts && npm run typecheck --workspace @woven-deep/engine`

Expected: all pass; the browser boundary stays intact.

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat: add production guest run constructor"
```

---

### Task 2: Engine `descendToNextFloor`

**Files:**
- Create: `packages/engine/src/floor-transition.ts`
- Create: `packages/engine/test/floor-transition.test.ts`
- Modify: `packages/engine/src/index.ts`

**Interfaces:**
- Consumes: `createNewRun` (Task 1) for test setup, `allocateFloorSeed`, `generateFloor`, `createClassicTheme`, `integrateGeneratedFloor`, `heroActor`, tile IDs (stair-up 4, stair-down 5 in the floor snapshot's grid).
- Produces: `descendToNextFloor(run, context): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }>` — consumed by the guest session (Task 5).

- [ ] **Step 1: Write failing transition tests**

```ts
// packages/engine/test/floor-transition.test.ts
describe('descendToNextFloor', () => {
  it('generates and enters the next depth when the hero stands on stair-down', () => {
    const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const onStairs = teleportHeroTo(run, run.floors[0]!.stairDown!); // test helper: rewrite hero x/y (and nothing else), then validateActiveRun
    const descended = descendToNextFloor(onStairs, { content: pack });
    expect(descended.state.floors).toHaveLength(2);
    expect(descended.state.floors[1]?.depth).toBe(2);
    expect(descended.state.activeFloorId).toBe(descended.state.floors[1]?.floorId);
    const hero = heroActor(descended.state);
    expect({ x: hero.x, y: hero.y }).toEqual(descended.state.floors[1]?.stairUp);
    expect(descended.state.metrics.floorsEntered).toBe(2);
    expect(descended.state.metrics.deepestDepth).toBe(2);
  });

  it('is deterministic and byte-stable across a save/reload boundary', () => {
    const onStairs = teleportHeroTo(createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO }), STAIR_DOWN);
    const direct = descendToNextFloor(onStairs, { content: pack });
    const reloaded = descendToNextFloor(decodeActiveRun(encodeActiveRun(onStairs)), { content: pack });
    expect(encodeActiveRun(direct.state)).toBe(encodeActiveRun(reloaded.state));
  });

  it('throws when the hero is not on stair-down and when the run is concluded', () => {
    const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    expect(() => descendToNextFloor(run, { content: pack })).toThrow(/stair/i);
    // concluded-run rejection: reuse the dead-hero fixture technique from test/run-conclusion.test.ts
  });
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test --workspace @woven-deep/engine -- --run test/floor-transition.test.ts`

Expected: FAIL — `descendToNextFloor` is not exported.

- [ ] **Step 3: Implement the transition**

```ts
// packages/engine/src/floor-transition.ts
export function descendToNextFloor(
  run: ActiveRun,
  context: Readonly<{ content: CompiledContentPack }>,
): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }>;
```

Order: (1) throw if `run.conclusion !== null`; (2) resolve the active `FloorSnapshot` and throw unless the hero's `{x, y}` equals its `stairDown`; (3) `allocation = allocateFloorSeed(run.rng.generation)`; (4) next floor ID `floor.depth-<zero-padded depth+1>` (two digits, matching Task 1's `floor.depth-01`), `generateFloor` at `depth + 1` with the same width/height/theme settings as `createNewRun` (extract those into a shared module-level constant in `new-run.ts` and import it — do not duplicate the literal); throw if `stairUp` is null; (5) return a state moving the hero actor to the new floor's `stairUp`, setting hero `floorId`, `activeFloorId`, and `activeFloorEnteredAt: run.worldTime`, then `integrateGeneratedFloor(moved, generated, allocation, { content: context.content })` — its transition branch records the floor entry and validates. Return its `{ state, events }` unchanged.

- [ ] **Step 4: Run and verify GREEN**

Run: `npm test --workspace @woven-deep/engine -- --run test/floor-transition.test.ts test/new-run.test.ts test/browser-boundary.test.ts && npm run typecheck --workspace @woven-deep/engine`

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat: add engine floor descent transition"
```

---

### Task 3: Session intents, command builder, and event log

**Files:**
- Create: `apps/web/src/session/intents.ts`
- Create: `apps/web/src/session/command-builder.ts`
- Create: `apps/web/src/session/event-log.ts`
- Create: `apps/web/test/command-builder.test.ts`
- Create: `apps/web/test/event-log.test.ts`
- Modify: `apps/web/package.json` (add `"@woven-deep/engine": "*"` to dependencies, matching how `@woven-deep/content` is declared)

**Interfaces:**
- Consumes: `GameCommand`, `GameplayProjection`, `PublicEvent`, `Direction`, `EquipmentSlot` types from `@woven-deep/engine`.
- Produces:

```ts
// intents.ts
export type PlayerIntent =
  | { readonly type: 'move'; readonly direction: Direction }
  | { readonly type: 'wait' }
  | { readonly type: 'rest' }
  | { readonly type: 'pickup' }
  | { readonly type: 'descend' }
  | { readonly type: 'backpack'; readonly action: 'equip' | 'use' | 'drop' | 'toggle-light'; readonly itemId: OpaqueId };

// command-builder.ts
export type BuiltIntent =
  | { readonly kind: 'command'; readonly command: GameCommand }
  | { readonly kind: 'descend' }                                   // handled by the session via descendToNextFloor
  | { readonly kind: 'rejected'; readonly message: string };
export function buildIntent(input: Readonly<{
  intent: PlayerIntent;
  projection: GameplayProjection;
  commandId: OpaqueId;
  expectedRevision: number;
}>): BuiltIntent;

// event-log.ts
export interface LogLine { readonly id: number; readonly text: string; readonly tone: 'info' | 'combat' | 'warning' | 'system' }
export const LOG_CAPACITY = 200;
export function foldEventsIntoLog(log: readonly LogLine[], events: readonly PublicEvent[], nextId: number): { readonly log: readonly LogLine[]; readonly nextId: number };
```

- [ ] **Step 1: Write failing command-builder tests**

Table-driven over a projection fixture built from a real `createNewRun` projection (`projectGameplayState`) plus hand-adjusted actor/item placements:

```ts
// apps/web/test/command-builder.test.ts — representative cases, cover all listed
it('builds a move command for an empty walkable target', () => {
  const built = buildIntent({ intent: { type: 'move', direction: 'east' }, projection, commandId: 'command.guest-000001', expectedRevision: 0 });
  expect(built).toEqual({ kind: 'command', command: { type: 'move', direction: 'east', commandId: 'command.guest-000001', expectedRevision: 0 } });
});
it('builds an attack when a hostile actor occupies the target cell', () => { /* expect { type: 'attack', targetActorId } */ });
it('builds open-door when a visible closed door occupies the target cell', () => { /* expect { type: 'open-door', featureId } */ });
it('builds pickup for the top ground item under the hero with its full quantity', () => { /* expect { type: 'pickup', itemId, quantity } */ });
it('rejects pickup with a message when nothing lies under the hero', () => { /* kind: 'rejected', message matching /nothing here/i */ });
it('builds rest until healed with the survival cap', () => { /* { type: 'rest', until: 'healed', maximumDuration: 500 } */ });
it('returns descend marker only when the hero stands on the stair-down cell, else rejects', () => { /* kind: 'descend' vs 'rejected' */ });
it('builds equip with the definition slot, use-item with null target, drop quantity 1, toggle-light flipping enabled', () => { /* backpack actions; equip of a two-handed item still targets main-hand */ });
it('rejects equip of a non-equipment item with the item name in the message', () => { /* kind: 'rejected' */ });
```

`buildIntent` decides from the projection only: hero position from `projection.hero.x/y`, target cell occupancy from `projection.actors` (attack only when `disposition === 'hostile'`), closed doors from `projection.features`, ground items from `projection.groundItems`, stair-down from the hero's cell `tileId === 5`, backpack items and slots from `projection.hero.backpack`/`equipment` plus the item's definition via the pack (pass the pack in if the projected item lacks the slot — check `projectItem`'s output first and prefer projection data).

- [ ] **Step 2: Write failing event-log tests**

```ts
// apps/web/test/event-log.test.ts
it('renders combat, item, light, and survival events as readable lines', () => {
  const folded = foldEventsIntoLog([], [
    { type: 'actor.damaged', /* fixture fields */ },
    { type: 'item.picked-up', /* ... */ },
    { type: 'fuel.warning', /* ... */ },
    { type: 'hunger.stage-changed', /* ... */ },
  ], 1);
  expect(folded.log.map((line) => line.tone)).toEqual(['combat', 'info', 'warning', 'warning']);
  expect(folded.log[0]?.text).toMatch(/damage/i);
});
it('caps the log at LOG_CAPACITY dropping oldest first and keeps ids monotonic', () => { /* fold 250 waits */ });
it('maps unknown event types to nothing rather than throwing', () => { /* forward-compat guard */ });
```

Cover at minimum: `actor.damaged`, `actor.died`, `hero.damaged`, `combat.observed`, `item.picked-up`, `item.equipped`, `item.consumed`, `item.light-extinguished`, `fuel.warning`, `hunger.stage-changed`, `rest.completed` (with `stopReason` in the text), `feature.revealed`, `door.opened`, `trap.triggered`, `sound.heard`, `action.invalid` (reason in text, tone `system`), `run.concluded` (tone `system`). Event fixture objects: copy real shapes from engine event tests (`packages/engine/test/event-projection.test.ts`) rather than inventing fields.

- [ ] **Step 3: Run and verify RED**

Run: `npm run test --workspace @woven-deep/web -- --run test/command-builder.test.ts test/event-log.test.ts`

Expected: FAIL — modules do not exist.

- [ ] **Step 4: Implement the three modules**

`intents.ts` is types only. `command-builder.ts` is one exported function plus small private cell/actor/feature lookup helpers; direction deltas map the eight `Direction` values to `{dx, dy}`. `event-log.ts` is a switch over `event.type` returning `{ text, tone } | null`, folded with the cap. No React, no engine calls, no randomness — pure data in, data out.

- [ ] **Step 5: Run and verify GREEN, then commit**

Run: `npm run test --workspace @woven-deep/web -- --run test/command-builder.test.ts test/event-log.test.ts && npm run typecheck --workspace @woven-deep/web`

```bash
git add apps/web
git commit -m "feat: add guest intent builder and event log"
```

---

### Task 4: Guest session core and React store binding

**Files:**
- Create: `apps/web/src/session/storage.ts`
- Create: `apps/web/src/session/guest-session.ts`
- Create: `apps/web/src/session/store.ts`
- Create: `apps/web/test/guest-session.test.ts`
- Modify: `apps/web/src/api.ts` (add `loadContentPack`)
- Modify: `apps/web/test/api.test.ts`

**Interfaces:**
- Consumes: Task 3's `buildIntent`/`foldEventsIntoLog`/`PlayerIntent`; engine `createNewRun`, `DEFAULT_GUEST_HERO`, `descendToNextFloor`, `resolveCommand`, `projectGameplayState`, `projectDecision`, `encodeActiveRun`, `decodeActiveRun`, `SaveLoadError`.
- Produces:

```ts
// storage.ts
export interface SessionStorageLike { get(): string | null; set(value: string): void }
export const SAVE_KEY = 'woven-deep.guest-run';
export function browserSessionStorage(): SessionStorageLike;   // wraps window.sessionStorage; distinguishes unavailable vs quota errors
export type StorageFailure = 'unavailable' | 'full';

// guest-session.ts
export type SessionNotice =
  | { readonly kind: 'restored' } | { readonly kind: 'fresh' }
  | { readonly kind: 'save-discarded'; readonly reason: string }
  | { readonly kind: 'storage'; readonly failure: StorageFailure };
export interface SessionSnapshot {
  readonly projection: GameplayProjection;
  readonly log: readonly LogLine[];
  readonly lastEvents: readonly PublicEvent[];     // feeds the effects layer, cleared on next dispatch
  readonly pendingDecision: PublicDecision | null; // confirm-aggression prompts
  readonly notice: SessionNotice | null;
  readonly backpackOpen: boolean;
}
export class GuestSession {
  constructor(input: Readonly<{ pack: CompiledContentPack; storage: SessionStorageLike; seed?: Uint32State }>);
  dispatch(intent: PlayerIntent): void;
  answerDecision(confirmed: boolean): void;
  setBackpackOpen(open: boolean): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): SessionSnapshot;
}

// store.ts
export function useGuestSession(session: GuestSession): SessionSnapshot; // useSyncExternalStore(session.subscribe, session.getSnapshot)
```

- [ ] **Step 1: Write failing session tests**

Against the real engine and real codec with a fake in-memory storage:

```ts
// apps/web/test/guest-session.test.ts — representative, cover all
const fakeStorage = () => { let value: string | null = null; return { get: () => value, set: (v: string) => { value = v; }, peek: () => value }; };

it('starts a fresh seeded run when storage is empty and persists after each applied command', () => {
  const storage = fakeStorage();
  const session = new GuestSession({ pack, storage, seed: [11, 22, 33, 44] });
  expect(session.getSnapshot().notice).toEqual({ kind: 'fresh' });
  const before = storage.peek();
  session.dispatch({ type: 'wait' });
  expect(storage.peek()).not.toBe(before);
  expect(session.getSnapshot().projection.metrics.turnsElapsed).toBe(1);
});

it('restores a stored run byte-for-byte', () => {
  const storage = fakeStorage();
  const first = new GuestSession({ pack, storage, seed: [11, 22, 33, 44] });
  first.dispatch({ type: 'wait' });
  const saved = storage.peek();
  const second = new GuestSession({ pack, storage });
  expect(second.getSnapshot().notice).toEqual({ kind: 'restored' });
  second.dispatch({ type: 'wait' });   // dispatch works from the restored state
  expect(saved).not.toBeNull();
});

it('falls back to a fresh run with a save-discarded notice on corrupt saves', () => {
  const storage = fakeStorage(); storage.set('{"not": "a save"}');
  const session = new GuestSession({ pack, storage, seed: [11, 22, 33, 44] });
  expect(session.getSnapshot().notice?.kind).toBe('save-discarded');
});

it('surfaces intent rejections and invalid results as log lines without touching the run', () => { /* dispatch descend away from stairs; revision unchanged; log gains a system line */ });
it('routes descend through the engine transition and persists the new floor', () => { /* teleport-on-stairs setup via a seeded walk or a test seam; floors length 2 */ });
it('exposes lastEvents for one snapshot generation and pendingDecision for decision_required results', () => { /* trade/aggression fixture */ });
it('reports storage-full failures as a storage notice while play continues', () => { /* storage.set throws QuotaExceededError-like */ });
```

For the descend test, add a test-only exported seam `GuestSession.loadForTest(run: ActiveRun)`? No — keep the class sealed: instead pick a seed whose depth-1 floor has a reachable stair-down and script the walk in the test (find one once with a small loop over candidate seeds inside the test file, then hard-code the seed and path with a comment naming how it was derived).

- [ ] **Step 2: Run and verify RED**

Run: `npm run test --workspace @woven-deep/web -- --run test/guest-session.test.ts`

Expected: FAIL — modules do not exist.

- [ ] **Step 3: Implement storage, session, and store**

Dispatch pipeline inside `GuestSession.dispatch`:

1. Command IDs must be unique across ALL recorded commands and deterministic across reload. (Amended after the final review: deriving from `revision + 1` alone is WRONG — the engine records `invalid` results into `recentCommands` WITHOUT advancing revision, so the next distinct command reuses the same id and is rejected as `command_id_conflict` forever, a persisted soft-lock. Derive from a counter that also advances on invalid results and is re-seedable from the restored save, e.g. `command.guest-<revision+1>-<recentCommands.length>`.)
2. `buildIntent(...)`: `rejected` → append a system log line, notify; `descend` → `descendToNextFloor(run, { content })`, fold its events through `projectDomainEvents`-provided public events (the returned `events` are authoritative `DomainEvent[]`; project them with `projectDomainEvents({ state, content, heroId, events })` before logging); `command` → `resolveCommand(run, command, { content })`.
3. On any new state: re-project (`projectGameplayState`), fold `resolution.events` (already public) into the log, stash them as `lastEvents`, persist `encodeActiveRun(state)` through the storage interface (catching and classifying failures as notices), bump the snapshot object identity, notify subscribers.
4. `decision_required` results set `pendingDecision` (via `projectDecision` if extra presentation data is needed); `answerDecision(true)` re-dispatches the confirm per the engine's decision contract (copy the exact confirmation flow from `packages/engine/test/reducer.test.ts`'s confirm-aggression cases); `answerDecision(false)` clears the decision with a log line.
5. Boot: try `storage.get()` → `decodeActiveRun`; on `SaveLoadError` (any kind) discard with a `save-discarded` notice naming `error.kind`; on absence build `createNewRun({ pack, seed: seed ?? randomSeed(), hero: DEFAULT_GUEST_HERO })` where `randomSeed()` uses `crypto.getRandomValues` (client code may use ambient randomness; the engine may not). Verify `pack.hash` matches a restored run's `contentHash` — mismatch discards with a notice.

`store.ts` is the ~10-line `useSyncExternalStore` wrapper. `getSnapshot` must return a stable reference between notifications.

- [ ] **Step 4: Run and verify GREEN, then commit**

Run: `npm run test --workspace @woven-deep/web -- --run test/guest-session.test.ts test/api.test.ts && npm run typecheck --workspace @woven-deep/web`

```bash
git add apps/web
git commit -m "feat: add guest session core with persistence"
```

Also in this task: `loadContentPack(fetcher = fetch): Promise<CompiledContentPack>` in `api.ts` — fetch `/api/content/guest`, `validateCompiledContentPack`, return the pack (reuse the existing `loadContentSummary` fetch/validation internals; extract the shared part rather than duplicating). Extend `test/api.test.ts` with a success case and a validation-failure case.

---

### Task 5: Grid renderer and effects layer

**Files:**
- Create: `apps/web/src/ui/camera.ts`
- Create: `apps/web/src/ui/GridRenderer.tsx`
- Create: `apps/web/src/ui/effects-map.ts`
- Create: `apps/web/src/ui/EffectsLayer.tsx`
- Create: `apps/web/test/camera.test.ts`
- Create: `apps/web/test/grid-renderer.test.tsx`
- Create: `apps/web/test/effects-map.test.ts`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: `GameplayProjection` (`floor.cells` with `glyph/token/knowledge/intensity/tint`, `actors`, `groundItems`, `hero`), `PublicEvent`, the pack (light definitions for glow radius/color via the hero's enabled equipped light).
- Produces: `<GridRenderer projection={...} camera={...} />`, `<EffectsLayer projection={...} pack={...} lastEvents={...} camera={...} />`, and:

```ts
// camera.ts — pure deadzone camera so floors larger than the pane render as a scrolling viewport
export interface CameraViewport { readonly width: number; readonly height: number }   // in cells
export interface CameraOrigin { readonly x: number; readonly y: number }              // world coordinate of the viewport's top-left cell
// Margin rule: the deadzone margin equals the hero's sight radius, clamped per axis to
// floor((viewportAxis - 1) / 2) so it always leaves a deadzone. Sight-radius margin guarantees
// every engine-visible actor is inside the viewport (nothing attacks from off-screen); on axes
// where sight diameter approaches viewport size this degrades toward center-lock, which is fine.
export function cameraMargin(sightRadius: number, viewport: CameraViewport): Readonly<{ x: number; y: number }>;
export function computeCamera(input: Readonly<{
  hero: Readonly<{ x: number; y: number }>;
  sightRadius: number;             // from projection.hero
  floor: Readonly<{ width: number; height: number }>;
  viewport: CameraViewport;
  previous: CameraOrigin | null;   // null on first render or floor change → center on hero
}>): CameraOrigin;

// effects-map.ts
export interface TransientEffect { readonly key: string; readonly kind: 'hit-flash' | 'attack-streak' | 'death-burst'; readonly x: number; readonly y: number; readonly toX?: number; readonly toY?: number }
export const MAX_TRANSIENT_EFFECTS = 12;
export function effectsForEvents(events: readonly PublicEvent[], heroId: OpaqueId): readonly TransientEffect[];
```

Camera rules (all in `computeCamera`, unit-tested in `camera.test.ts`): with `previous: null`, center the viewport on the hero, clamped to floor bounds. With a previous origin, keep it unchanged while the hero remains at least `cameraMargin(sightRadius, viewport)` cells from every viewport edge (per-axis margins); when the hero crosses a margin on an axis, scroll that axis by exactly the amount that restores the margin. Always clamp so the viewport never shows cells outside the floor; when the floor is smaller than the viewport on an axis, center the floor on that axis (origin may be negative in that case — the renderer pads with empty cells). Camera state lives in the `PlayScreen` component (a ref/previous-origin pair keyed by `floorId` so a descend recenters); `computeCamera` itself is stateless.

Camera test cases for `camera.test.ts`: `cameraMargin` — equals sight radius when it fits, clamps to `floor((axis - 1) / 2)` when it doesn't (assert both axes of a 60×20 viewport with sight radius 8: x margin 8, y margin 8 → clamped to 9? no — floor((20-1)/2) = 9, so 8 fits and stays 8; use sight radius 12 to exercise the clamp); the visibility guarantee — for any hero position and any camera the rules produce, every cell within `sightRadius` (Chebyshev) of the hero lies inside the viewport (a small brute-force sweep over hero positions on an 80×25 floor); initial centering and clamping at each corner; no scroll while moving inside the deadzone; exact scroll amount when crossing each of the four margins; clamping at every floor edge; small-floor centering on one and both axes; the null-previous branch centers.

- [ ] **Step 1: Write failing renderer and mapping tests**

```tsx
// apps/web/test/grid-renderer.test.tsx — assert on the cell layer only
it('renders exactly the viewport window of cells, keyed by world coordinates', () => {
  const camera = { x: 10, y: 3 };
  render(<GridRenderer projection={projection} camera={camera} viewport={{ width: 40, height: 15 }} />);
  const grid = screen.getByRole('grid', { name: /dungeon/i });
  const cells = grid.querySelectorAll('[data-cell]');
  expect(cells).toHaveLength(40 * 15);
  expect(grid.querySelector('[data-cell="10,3"]')).not.toBeNull();   // top-left of the window, world coords
  expect(grid.querySelector('[data-cell="9,3"]')).toBeNull();        // outside the window
  const visible = grid.querySelector('[data-cell="12,5"]')!;
  expect(visible).toHaveClass('cell-visible');
  expect(visible.getAttribute('style')).toContain('--light');
});
it('renders unknown cells empty, remembered cells dim, and overlays hero > actor > item > tile glyphs', () => { /* precedence table */ });
it('marks the hero cell with the hero glyph @ and an accessible label', () => { /* aria-label on hero cell */ });
it('pads with empty out-of-floor cells when the floor is smaller than the viewport', () => { /* negative-origin centering case */ });
```

Camera unit tests (`camera.test.ts`) come first in this task's RED step — the case list is in the Interfaces section above.

```ts
// apps/web/test/effects-map.test.ts
it('maps damage to hit-flash at the target cell, ranged/spell to attack-streak with endpoints, death to death-burst', () => { /* actor.damaged, combat.observed, item.thrown / cast-shaped events, actor.died */ });
it('returns nothing for unmapped events and caps at MAX_TRANSIENT_EFFECTS dropping oldest', () => {});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm run test --workspace @woven-deep/web -- --run test/grid-renderer.test.tsx test/effects-map.test.ts`

Expected: FAIL — components do not exist.

- [ ] **Step 3: Implement renderer, mapping, and effects layer**

`camera.ts`: implement `computeCamera` exactly per the Interfaces section — pure, stateless, deadzone margin `CAMERA_MARGIN = 4`, axis-independent scrolling, floor-bounds clamping, small-floor centering.

`GridRenderer`: a `role="grid"` container with `display: grid; grid-template-columns: repeat(viewport.width, 1ch)`. It receives `camera: CameraOrigin` and `viewport: CameraViewport` and renders only the world cells inside `[camera.x, camera.x + viewport.width) × [camera.y, camera.y + viewport.height)`, indexing into `projection.floor.cells` by `y * floor.width + x`; world coordinates outside the floor render as empty padding cells (`data-cell` omitted). One `<span data-cell="x,y">` per in-floor cell using WORLD coordinates: class `cell-unknown|cell-remembered|cell-visible`, inline custom properties `--light: intensity/255` and `--fg: rgb(tint)` when present, text content by precedence hero `@` > actor glyph > ground-item glyph > `cell.fixture?.glyph` > `cell.glyph ?? ''`. Remembered cells always render the remembered tile glyph dim/desaturated via CSS, never actors or items. The grid is one tab stop; cells are not individually focusable.

`EffectsLayer`: `aria-hidden`, `pointer-events: none`, absolutely positioned over the grid; it receives the same `camera` and stores live transient effects in WORLD coordinates, deriving each effect's screen position `(worldX - camera.x, worldY - camera.y)` from the CURRENT camera on every render — so a scroll mid-animation moves the effect with the world instead of stranding it at a stale viewport position. Effects whose world position falls outside the viewport are not rendered (but stay in the list until their animation lifetime ends). The live-effects list is cleared when `projection.floor.floorId` changes, so a burst from the previous floor never renders onto the new one. Screen positions use `calc(var(--cell-w) * x)` custom properties set by the shared playfield wrapper.

React keying: cells are keyed by VIEWPORT SLOT index (row-major slot number), not world coordinates — a camera scroll then updates existing DOM nodes' content and variables instead of remounting all ~1,200 spans. The `data-cell` attribute still carries world coordinates for tests and debugging. Renders (a) one `.glow` div at the hero's cell while the hero has an enabled equipped light — radius/color read from the pack's light definition for that item's `contentId`, flicker profile selected by a `data-source` attribute (`pitch-torch` gutter vs `brass-lantern` steady), base intensity scaled by remaining fuel fraction; (b) transient effect divs from `effectsForEvents(lastEvents, heroId)`, removed on `animationend`. CSS keyframes in `styles.css`: `glow-drift` (2.6s ease-in-out infinite alternate scale/opacity), `glow-gutter` (irregular steps flicker), `hit-flash` (120ms), `attack-streak` (160ms translate along the line), `death-burst` (240ms expanding fade). All under `@media (prefers-reduced-motion: reduce) { animation: none; }` with the glow rendered static.

- [ ] **Step 4: Run and verify GREEN, then commit**

Run: `npm run test --workspace @woven-deep/web -- --run test/grid-renderer.test.tsx test/effects-map.test.ts && npm run typecheck --workspace @woven-deep/web`

```bash
git add apps/web
git commit -m "feat: render playfield cells with effects layer"
```

---

### Task 6: Triptych panels and play screen composition

**Files:**
- Create: `apps/web/src/ui/panels.tsx`
- Create: `apps/web/src/ui/ThreatPopover.tsx`
- Create: `apps/web/src/ui/layout.ts`
- Create: `apps/web/src/ui/PlayScreen.tsx`
- Create: `apps/web/test/panels.test.tsx`
- Create: `apps/web/test/layout.test.ts`
- Create: `apps/web/test/threat-popover.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: `SessionSnapshot` (Task 4), `GridRenderer`/`EffectsLayer` (Task 5).
- Produces: `HeroPanel`, `ThreatPanel`, `LogPanel`, `StatusBar` (each `(props: { snapshot: SessionSnapshot }) => JSX`), and `<PlayScreen session={GuestSession} pack={...} />` composing the Triptych.

- [ ] **Step 1: Write failing panel tests**

```tsx
// apps/web/test/panels.test.tsx — from fixture snapshots built with the real engine
it('HeroPanel shows name, health bar text, hunger stage, equipped slots, and backpack summary', () => { /* getByText patterns */ });
it('ThreatPanel lists visible hostile actors with intent and health band, and ground items underfoot', () => {});
it('LogPanel renders the newest lines last inside a polite live region with tone classes', () => { /* role="log", aria-live="polite" */ });
it('StatusBar shows depth, turn count, and hero identity', () => {});
it('panels render sensibly on an empty-threat snapshot', () => { /* "nothing nearby" placeholders */ });
```

- [ ] **Step 2: Run and verify RED**

Run: `npm run test --workspace @woven-deep/web -- --run test/panels.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implement panels and layout**

All four panels are pure functions of the snapshot — no session access, no effects.

`layout.ts` is a pure module owning the responsive decisions so they are unit-testable without DOM measurement:

```ts
export type LayoutTier = 'full' | 'compact' | 'minimal';   // full triptych | threats collapsed | both collapsed
export function layoutTier(containerWidthPx: number): LayoutTier;   // full ≥ 1100, compact ≥ 760, else minimal
// Amended after e2e review: the tier MUST derive from a tier-independent measurement — the
// triptych container (or window) width — never the map pane. The tier changes the pane's grid
// column, so pane-derived tiers feed back into themselves and oscillate at mid-band widths.
export const MIN_VIEWPORT: CameraViewport = { width: 30, height: 12 };
export function viewportForPane(input: Readonly<{ panePx: { width: number; height: number }; cellPx: { width: number; height: number }; floor: { width: number; height: number } }>): CameraViewport;
// floor(pane / cell) per axis, clamped to at least MIN_VIEWPORT and at most the floor size
```

`layout.test.ts` covers: tier thresholds at, above, and below each boundary; viewport arithmetic (exact floor division, MIN_VIEWPORT clamp, floor-size clamp on each axis independently).

`PlayScreen` owns the camera and layout state: a `ResizeObserver` on the map pane (plus one measured cell's `getBoundingClientRect` for `cellPx`) feeds `viewportForPane`; the window resize also drives `layoutTier` off the pane width. Camera state is a previous-`CameraOrigin` ref keyed by `floorId` (null on first render or floor change, so a descend recenters); each render calls `computeCamera` with the hero position, the hero's sight radius from the projection, and the dynamic viewport, handing `camera`/`viewport` to `GridRenderer` and `EffectsLayer`. In tests, mock `ResizeObserver` (jsdom lacks it — a three-line stub in `test/setup.ts`) and assert the plumbing, not pixel math (that's `layout.test.ts`'s job).

Tier behavior (assert in `panels.test.tsx` by rendering `PlayScreen` at forced tiers via a `tier` override prop used only in tests):
- `full`: hero panel, map, threat panel, log at 6 visible lines.
- `compact`: threat panel replaced by (a) `ThreatPopover` on actor-cell hover and (b) a keyboard-openable `<details>` drawer containing the full `ThreatPanel` content — the same information, never hover-only.
- `minimal`: hero panel additionally collapses to an always-visible vitals strip (health, hunger stage, light state as text) with the full `HeroPanel` in its own drawer; log shrinks to 3 visible lines but never unmounts.

`ThreatPopover`: `role="tooltip"`, non-focusable, rendered on `mouseenter` over a grid cell whose world coordinate holds a visible actor, dismissed on `mouseleave`/scroll/dispatch; shows the actor's name, glyph, health band, intent, and disposition — the same fields `ThreatPanel` lists. Positioned near the cell from the shared `--cell-w`/`--cell-h` custom properties; clamped to the pane. `threat-popover.test.tsx`: hover shows the card with the actor's name, unhover removes it, hovering an empty cell shows nothing.

`PlayScreen` composes the Triptych with CSS grid areas:

```css
.triptych { display: grid; grid-template: "status status status" auto "hero map threat" 1fr "log log log" minmax(6rem, 20vh) / minmax(14rem, 1fr) minmax(0, 4fr) minmax(14rem, 1fr); }
.triptych[data-tier='compact'] { grid-template-columns: minmax(14rem, 1fr) minmax(0, 5fr) 0; }
.triptych[data-tier='minimal'] { grid-template-columns: 0 1fr 0; }
```

The drawer is a `<details>` element per collapsed panel (native keyboard toggle) — no new dependency, focus behaviour comes free; the vitals strip overlays the map's top edge in `minimal` without stealing map rows. Health is text plus a bar; the accessibility rule is text-first (no color-only meaning). LogPanel is `role="log"` `aria-live="polite"` and auto-scrolls to the newest line. StatusBar renders the turn counter as `<span data-testid="turn-count">Turn {n}</span>` and the depth as text containing `Depth {n}` — Task 8's end-to-end spec asserts on both.

- [ ] **Step 4: Run and verify GREEN, then commit**

Run: `npm run test --workspace @woven-deep/web -- --run test/panels.test.tsx && npm run typecheck --workspace @woven-deep/web`

```bash
git add apps/web
git commit -m "feat: compose tactical triptych panels"
```

---

### Task 7: Keyboard routing, backpack menu, and app boot

**Files:**
- Create: `apps/web/src/ui/KeyRouter.ts`
- Create: `apps/web/src/ui/BackpackMenu.tsx`
- Create: `apps/web/test/key-router.test.ts`
- Create: `apps/web/test/backpack-menu.test.tsx`
- Create: `apps/web/test/app-boot.test.tsx`
- Modify: `apps/web/src/ui/PlayScreen.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/main.tsx` (only if App's props change)

**Interfaces:**
- Consumes: `PlayerIntent` (Task 3), `GuestSession`/`useGuestSession` (Task 4), `loadContentPack` (Task 4), `PlayScreen` (Task 6).
- Produces:

```ts
// KeyRouter.ts
export const KEYMAP: Readonly<Record<string, PlayerIntent>>; // arrows + numpad + hjklyubn diagonals + '.' wait, 'R' rest, 'g' pickup, '>' descend
export function routeKey(input: Readonly<{ event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'target'>; overlayOpen: boolean }>): PlayerIntent | { readonly type: 'open-backpack' } | { readonly type: 'close-overlay' } | null;
```

- [ ] **Step 1: Write failing router, menu, and boot tests**

```ts
// key-router.test.ts
it('maps arrows, numpad, and vi keys to the eight directions', () => { /* full table */ });
it('maps . R g > i and Escape', () => {});
it('returns null for any movement or action key while an overlay is open (except Escape)', () => {});
it('returns null when the event target is an input, textarea, or select', () => {});
```

```tsx
// backpack-menu.test.tsx
it('lists backpack items, traps focus, dispatches equip/use/drop/toggle-light intents, and closes on Escape', () => { /* userEvent.keyboard walkthrough */ });
```

```tsx
// app-boot.test.tsx (injectable fetcher + storage as App props, following the existing App fetcher-prop pattern)
it('shows a loading state, then the play screen when the pack loads', () => {});
it('shows a retry screen naming the failure when the pack fetch fails, and retries on Enter', () => {});
it('shows the save-discarded notice from the session as a dismissible banner', () => {});
it('reads a test-only seed from the query string (?seed=11.22.33.44) and passes it to the session', () => {});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm run test --workspace @woven-deep/web -- --run test/key-router.test.ts test/backpack-menu.test.tsx test/app-boot.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implement router, menu, and boot flow**

`KeyRouter` is pure: the component layer (`PlayScreen`) owns the single `keydown` listener on `window`, calls `routeKey`, and forwards intents to `session.dispatch`, `open-backpack` to `session.setBackpackOpen(true)`, `close-overlay` to close menu/decision prompts. Input-flood guard (amended after review — the original in-flight-boolean premise was wrong: browser keydown dispatch is synchronous and non-reentrant, so a reentrancy guard can never fire under real auto-repeat): each dispatched command synchronously resolves, re-projects, and serializes the full run, so OS key auto-repeat (~30/sec) must not outpace what the player can perceive — the listener drops `event.repeat === true` keydowns that arrive within `REPEAT_INTERVAL_MS = 80` of the last accepted dispatch (first press always passes; a fake-timers test proves a rapid repeat burst dispatches at most one intent per interval while discrete presses all pass). `BackpackMenu` renders when `snapshot.backpackOpen`: a `role="dialog"` with a focus trap (focus the list on open, wrap Tab at the edges, restore focus to the grid on close — hand-rolled, ~20 lines), items as a keyboard list (up/down + `e`/`u`/`d`/`l` action keys shown as hints). The pending-decision prompt (confirm-aggression) reuses the same dialog primitives with `y`/`n` handling. `App.tsx` boots: `loadContentPack` → construct `GuestSession` with `browserSessionStorage()` and the optional `?seed=` (dot-separated four numbers, test-only, documented in the file) → render `PlayScreen`; distinct error screens for fetch failure (retry button) and storage unavailability (play-unsaved warning per the design).

- [ ] **Step 4: Run and verify GREEN, then commit**

Run: `npm run test --workspace @woven-deep/web -- --run --dir test && npm run typecheck --workspace @woven-deep/web`

Expected: the full web suite passes.

```bash
git add apps/web
git commit -m "feat: wire keyboard play into the guest app"
```

---

### Task 8: Playwright end-to-end proof, scripts, and roadmap

**Files:**
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/e2e/guest-play.spec.ts`
- Modify: `apps/web/package.json` (add `@playwright/test` dev dependency and `e2e` script)
- Modify: `package.json` (root: add `guest:e2e` script)
- Modify: `apps/web/vite.config.ts` (exclude `e2e/` from vitest)
- Modify: `docs/superpowers/plans/2026-07-13-implementation-roadmap.md`

**Interfaces:**
- Consumes: the complete 5A vertical slice; the server's `buildApp` static serving; the `?seed=` test seam from Task 7.
- Produces: `npm run guest:e2e` — the 5A exit demonstration.

- [ ] **Step 1: Configure Playwright**

`playwright.config.ts`: single chromium project, `webServer` block that runs the built server (`command: 'node ../server/dist/main.js'` with `PORT=4173` and the web dist path, `reuseExistingServer: false`) — check `apps/server/src/main.ts`/`config.ts` for the exact env names it reads and use those. `use: { baseURL: 'http://localhost:4173', viewport: { width: 1440, height: 900 } }` — the browser viewport is pinned because the cell window is now responsive; 1440×900 lands in the `full` layout tier, and the scripted walk's camera positions depend on it. One additional e2e case: resize the page to a `compact`-tier width mid-run and assert the threat panel is replaced by its drawer while the grid remains, then hover an actor cell and assert the popover card appears. The root `guest:e2e` script builds first: `npm run build && npm run e2e --workspace @woven-deep/web`. Install browsers in the script via `npx playwright install --with-deps chromium` only in CI docs — locally document `npx playwright install chromium` once in the README of the e2e directory (a three-line `apps/web/e2e/README.md`).

- [ ] **Step 2: Write the end-to-end spec**

```ts
// apps/web/e2e/guest-play.spec.ts — the exit demonstration
test('a guest plays, persists, and descends by keyboard alone', async ({ page }) => {
  await page.goto('/?seed=11.22.33.44');
  await expect(page.getByRole('grid', { name: /dungeon/i })).toBeVisible();
  // Scripted walk for this seed: derive it once by running the session headlessly
  // (small node script inline in the test file's comment) and hard-code the key
  // sequence, like the engine demos pin hashes. The sequence must include:
  //  - moving until a monster is adjacent, bump-attacking it until its death
  //    appears in the log (assert /dies|slain|defeated/i log line),
  //  - walking onto an item and pressing g (assert picked-up log line),
  //  - opening the backpack with i, consuming a travel ration (assert log),
  //  - pressing R to rest (assert rest completion or interruption line),
  //  - walking to the stair-down and pressing > (assert depth 2 in the status bar).
  await expect(page.getByText(/depth 2/i)).toBeVisible();
});

test('a mid-run reload restores the run and a cleared session starts fresh', async ({ page }) => {
  await page.goto('/?seed=11.22.33.44');
  await page.keyboard.press('.');                        // one turn
  const turnBefore = await page.getByTestId('turn-count').textContent();
  await page.reload();
  await expect(page.getByTestId('turn-count')).toHaveText(turnBefore!);   // restored, not reset
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expect(page.getByTestId('turn-count')).toHaveText(/turn 0/i);     // fresh
});

test('every interactive surface is reachable by keyboard', async ({ page }) => {
  // Tab order: grid -> drawers -> log; i opens the focus-trapped menu; Escape closes and restores focus.
});
```

- [ ] **Step 3: Run and verify**

Run: `npm run guest:e2e`

Expected: build green, server boots, all three specs pass headlessly. Iterate on the scripted walk until stable; the seed and key script are pinned test data, reviewed like demo hashes.

- [ ] **Step 4: Update the roadmap**

In `docs/superpowers/plans/2026-07-13-implementation-roadmap.md`, under milestone 5, record the decomposition: 5A guest play core (link this plan and `docs/superpowers/specs/2026-07-15-guest-play-core-design.md`, mark complete when merged), 5B character generation and run lifecycle, 5C town slice, 5D full interface — one line each with their exit demonstrations from the spec's decomposition section.

- [ ] **Step 5: Run full verification**

```bash
npm test
npm run typecheck
npm run build
npm run guest:e2e
npm run run-records:demo
npm run smoke
git status --short
```

Expected: everything green; no unintended files.

- [ ] **Step 6: Commit**

```bash
git add apps/web package.json package-lock.json docs
git commit -m "feat: prove guest play core end to end"
```

- [ ] **Step 7: Request final review**

Run the `superpowers:requesting-code-review` workflow against the branch diff from its merge base; resolve confirmed issues with failing regression tests first, then rerun the affected suites and the full verification block before reporting 5A complete.

---

### Task 9: Marketing landing page from the design handoff

*(Added 2026-07-16 by direction: deferred low-priority work, executed last. A high-fidelity design handoff exists — recreate it in the app, but rework the copy to sound human while keeping the epic register.)*

**Files:**
- Read first: `docs/design/landing-handoff/README.md` (the complete design spec: tokens, sections, interactions, ember particle system) and open `docs/design/landing-handoff/The Woven Deep.dc.html` in a browser for the living reference; screenshots in `docs/design/landing-handoff/screenshots/`.
- Create: `apps/web/src/landing/LandingPage.tsx` (sections may be split into sibling files if it grows past ~300 lines — follow the handoff's section list)
- Create: `apps/web/src/landing/EmberCanvas.tsx` (the particle system — component-local state, rAF, cleanup on unmount)
- Create: `apps/web/src/landing/landing.css`
- Create: `apps/web/test/landing.test.tsx`
- Modify: `apps/web/src/main.tsx` or `App.tsx` (route: landing at `/`, the game behind the "Descend Now"/"Enter as guest" CTAs — a simple path check, no router dependency)
- Modify: `apps/web/e2e/guest-play.spec.ts` (entry now flows through the landing CTA; keep the seeded-run entry working)

**Interfaces:**
- Consumes: the handoff's design tokens, section structure, and interaction specs verbatim (colors, type scale, spacing, reveal/parallax/accordion behavior, ember system); `images/woven-deep-cover.png` from the repo root (serve via the web app's asset pipeline).
- Produces: the landing page at `/`, with CTAs routed to the guest game.

**Constraints:**
- Follow the handoff's fidelity note: recreate faithfully in React/Vite with plain CSS (this repo's convention — no Tailwind/styled-components), EXCEPT the copy. **The copy gets a humanizing pass:** keep the epic, mythic register, but strip AI-typical patterns — no "It's not just X, it's Y" constructions, no rule-of-three padding, no em dashes, no "stands as a testament" inflation, no generic upbeat closers. Short declarative lines carry the tone ("Many enter. Few return. All are woven in." is the register to match). Rewrite each section's copy in that voice; the structure, headings hierarchy, and CTA texts stay per the design unless they read as AI-typical.
- All animation honors `prefers-reduced-motion` (the handoff specifies this; the repo's styles-contract test pattern from Task 5 can guard it).
- FAQ toggles are real `<button>`s with `aria-expanded`, per the handoff's accessibility notes.
- The "Be Woven In" registered-account card describes milestone-6 features that do not exist yet — keep the card (it sells the vision) but its CTA points to a "coming soon" anchor, not a dead registration route; note this in the code.
- Fonts: self-host or system-fallback only if Google Fonts is unacceptable to the reviewer; otherwise load Marcellus + EB Garamond as the handoff specifies with the web-safe chains as fallback.
- No new runtime dependencies.

- [ ] **Step 1: Tests for structure and behavior** — render the landing page: nav, hero H1, all six section landmarks present; FAQ accordion single-open behavior (click toggles, opening one closes another, `aria-expanded` flips); CTAs link to the play route/anchors; reduced-motion contract test extended to the landing CSS.
- [ ] **Step 2: Implement the page per the handoff** — sections, tokens, reveal/parallax/keyframes, ember canvas (sparks + motes, heat ramp, vertical falloff, streaks, resize re-seed, unmount cleanup).
- [ ] **Step 3: Humanize the copy** — rewrite all section copy per the constraint above; read it aloud; no AI-isms.
- [ ] **Step 4: Wire routing** — landing at `/`, game at the CTA target; the e2e's seeded entry updated; full web suite + typecheck + `npm run guest:e2e` green.
- [ ] **Step 5: Commit** — `feat: add landing page from design handoff`

---
