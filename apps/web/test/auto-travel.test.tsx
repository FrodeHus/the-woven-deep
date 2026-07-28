import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  DEFAULT_GUEST_HERO,
  createNewRun,
  projectGameplayState,
  type GameplayProjection,
  type Point,
} from '@woven-deep/engine';
import type { GuestSession, SessionSnapshot } from '../src/session/guest-session.js';
import type { PlayerIntent } from '../src/session/intents.js';
import { PlayScreen } from '../src/ui/PlayScreen.js';
import { STEP_MS } from '../src/ui/playfield/scene-state.js';
import { fakePlayfieldRenderer, type FakePlayfieldRenderer } from './fake-playfield-renderer.js';
import { withUiProviders } from './with-ui-providers.js';

let pack: CompiledContentPack;
let baseProjection: GameplayProjection;

const SEED = [11, 22, 33, 44] as const;
const WIDTH = 40;
const HEIGHT = 20;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
  const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
  baseProjection = projectGameplayState({ state: run, content: pack });
});

interface FakeActor {
  readonly actorId: string;
  readonly x: number;
  readonly y: number;
  readonly disposition: string;
  readonly health: number;
  readonly maxHealth: number;
  readonly healthPresentation: { readonly band: string };
  readonly glyph: string;
}

interface FakeItem {
  readonly itemId: string;
  readonly x: number;
  readonly y: number;
  readonly name: string;
  readonly glyph: string;
  readonly category: string;
  readonly quantity: number;
  readonly identified: boolean;
}

function projectionOf(input: {
  hero: Point & { health?: number };
  actors?: readonly FakeActor[];
  groundItems?: readonly FakeItem[];
  walls?: readonly Point[];
}): GameplayProjection {
  const wallSet = new Set((input.walls ?? []).map((point) => `${point.x},${point.y}`));
  const cells = [];
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const wall = wallSet.has(`${x},${y}`);
      cells.push({
        index: y * WIDTH + x,
        x,
        y,
        knowledge: 'visible' as const,
        tileId: wall ? 0 : 1,
        glyph: wall ? '#' : '.',
        token: wall ? 'terrain.wall' : 'terrain.floor',
        intensity: 255,
      });
    }
  }
  return {
    ...baseProjection,
    floor: { floorId: 'floor.test', depth: 1, town: false, width: WIDTH, height: HEIGHT, cells },
    hero: {
      ...baseProjection.hero,
      x: input.hero.x,
      y: input.hero.y,
      health: input.hero.health ?? 20,
    },
    actors: input.actors ?? [],
    groundItems: input.groundItems ?? [],
    trade: undefined,
  } as unknown as GameplayProjection;
}

function snapshotOf(projection: GameplayProjection, houseOpen = false): SessionSnapshot {
  return {
    projection,
    log: [],
    lastEvents: [],
    pendingDecision: null,
    pendingFinalChamberChoice: null,
    notice: null,
    houseOpen,
    conclusion: null,
    sightings: { monsterIds: [], itemIds: [], landmarks: [] },
    heroClassTags: [],
    onboarding: { counts: {}, dismissed: [] },
  } as unknown as SessionSnapshot;
}

/**
 * A controllable session double: `dispatch` records the intent but does NOT apply it, so a test can
 * step the auto-travel loop deterministically by publishing the next projection itself (mimicking
 * the engine resolving the previous move). This is what lets the "first step then cancel" assertion
 * observe travel mid-flight -- a real session would flush the whole walk atomically inside `act`.
 */
class FakeSession {
  public readonly dispatched: PlayerIntent[] = [];
  private snapshot: SessionSnapshot;
  private readonly listeners = new Set<() => void>();

  constructor(projection: GameplayProjection) {
    this.snapshot = snapshotOf(projection);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): SessionSnapshot {
    return this.snapshot;
  }

  dispatch(intent: PlayerIntent): void {
    this.dispatched.push(intent);
  }

  publish(projection: GameplayProjection, houseOpen = false): void {
    act(() => {
      this.snapshot = snapshotOf(projection, houseOpen);
      for (const listener of this.listeners) listener();
    });
  }

  // Unused-by-click methods the key dispatcher may touch; harmless no-ops for these tests.
  setHouseOpen(): void {}
  recordOnboardingIntent(): void {}
  dismissOnboardingHint(): void {}
  answerDecision(): void {}
}

async function renderPlay(session: FakeSession): Promise<FakePlayfieldRenderer> {
  const fake = fakePlayfieldRenderer();
  render(
    withUiProviders(
      pack,
      <PlayScreen
        session={session as unknown as GuestSession}
        pack={pack}
        createRenderer={fake.createRenderer}
      />,
    ),
  );
  await screen.findByRole('img', { name: /dungeon/i });
  return fake;
}

function clickCell(fake: FakePlayfieldRenderer, cell: Point): void {
  act(() => fake.latest().click(cell, 'primary'));
}

function moves(session: FakeSession): readonly PlayerIntent[] {
  return session.dispatched.filter((intent) => intent.type === 'move');
}

describe('PlayScreen click-to-move (auto-travel)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('clicking an adjacent cell dispatches exactly one move', async () => {
    const session = new FakeSession(projectionOf({ hero: { x: 20, y: 10 } }));
    const fake = await renderPlay(session);
    clickCell(fake, { x: 21, y: 10 });
    expect(session.dispatched).toEqual([{ type: 'move', direction: 'east' }]);
  });

  it('clicking a distant reachable cell starts auto-travel (first step dispatched) and is cancellable by a keypress', async () => {
    const session = new FakeSession(projectionOf({ hero: { x: 20, y: 10 } }));
    const fake = await renderPlay(session);

    clickCell(fake, { x: 23, y: 10 });
    // Only the FIRST step is dispatched up front; the rest await each authoritative projection.
    expect(moves(session)).toEqual([{ type: 'move', direction: 'east' }]);

    // A keypress cancels the walk.
    fireEvent.keyDown(window, { key: 'Backspace' });

    // Publishing the projection that confirms the first step must NOT resume the (cancelled) walk.
    session.publish(projectionOf({ hero: { x: 21, y: 10 } }));
    expect(moves(session)).toEqual([{ type: 'move', direction: 'east' }]);
  });

  it('a keypress during the paced wait for the next step cancels the walk before the timer fires', async () => {
    const session = new FakeSession(projectionOf({ hero: { x: 20, y: 10 } }));
    const fake = await renderPlay(session);

    vi.useFakeTimers();

    clickCell(fake, { x: 23, y: 10 });
    expect(moves(session)).toEqual([{ type: 'move', direction: 'east' }]);

    // The projection confirming step one arrives while the second step is still paced behind the
    // STEP_MS timer.
    session.publish(projectionOf({ hero: { x: 21, y: 10 } }));
    expect(moves(session)).toHaveLength(1);

    // Cancel while that timer is still pending -- it must never fire.
    fireEvent.keyDown(window, { key: 'Backspace' });
    // The pending-step timer must actually be torn down, not merely masked by the `travelRef`
    // null-guard in the timeout callback -- otherwise this assertion would pass even if
    // `clearTimeout` were never called.
    expect(vi.getTimerCount()).toBe(0);
    act(() => {
      vi.advanceTimersByTime(STEP_MS);
    });
    expect(moves(session)).toEqual([{ type: 'move', direction: 'east' }]);
  });

  it('disabling input mid-wait (e.g. a modal opening via a mouse-only path) cancels the pending step and clears the walk', async () => {
    const session = new FakeSession(projectionOf({ hero: { x: 20, y: 10 } }));
    const fake = await renderPlay(session);

    vi.useFakeTimers();

    clickCell(fake, { x: 23, y: 10 });
    expect(moves(session)).toEqual([{ type: 'move', direction: 'east' }]);

    // The projection confirming step one arrives while the second step is still paced behind the
    // STEP_MS timer -- same window the review found: a modal can open here via a mouse-only path
    // (e.g. clicking a CommandPalette item), with no keydown to cancel the walk.
    session.publish(projectionOf({ hero: { x: 21, y: 10 } }));
    expect(moves(session)).toHaveLength(1);
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    // Flip `disabled` on -- modelled here as `snapshot.houseOpen` becoming true, one of the
    // conditions `PlayScreen` folds into `isModalActive` (mirroring a modal opened by a
    // mouse-only path with no keydown) -- while the timer is still pending.
    session.publish(projectionOf({ hero: { x: 21, y: 10 } }), true);

    // The pending step timer must be torn down immediately (not merely left to no-op when it
    // fires): `useAutoTravel`'s own `clearPendingStep` must have run. `HouseScreen`'s dialog
    // mounting schedules unrelated timers of its own, so a raw `vi.getTimerCount()` delta would be
    // contaminated by those -- spying on `clearTimeout` isolates the assertion to cancellation
    // actually having happened.
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();

    act(() => {
      vi.advanceTimersByTime(STEP_MS);
    });
    // No further move was dispatched while disabled.
    expect(moves(session)).toHaveLength(1);

    // Re-enable and click again: the walk must start fresh rather than resuming the cleared plan.
    session.publish(projectionOf({ hero: { x: 21, y: 10 } }));
    clickCell(fake, { x: 22, y: 10 });
    expect(moves(session)).toEqual([
      { type: 'move', direction: 'east' },
      { type: 'move', direction: 'east' },
    ]);
  });

  it('auto-travels step by step and picks up a floor item on arrival', async () => {
    const item: FakeItem = {
      itemId: 'item.sword',
      x: 22,
      y: 10,
      name: 'Iron sword',
      glyph: '/',
      category: 'weapon',
      quantity: 1,
      identified: true,
    };
    const session = new FakeSession(projectionOf({ hero: { x: 20, y: 10 }, groundItems: [item] }));
    const fake = await renderPlay(session);

    vi.useFakeTimers();

    clickCell(fake, { x: 22, y: 10 });
    // The first step fires immediately, with no timer wait -- no added click latency.
    expect(moves(session)).toHaveLength(1);
    expect(session.dispatched).not.toContainEqual({ type: 'pickup' });

    session.publish(projectionOf({ hero: { x: 21, y: 10 }, groundItems: [item] }));
    // The projection confirming the first step lands well inside STEP_MS of the first dispatch,
    // so the second step is paced behind a timer and must NOT fire yet -- this is exactly the
    // "snap forward" scenario the pacing fix guards against.
    expect(moves(session)).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(STEP_MS);
    });
    expect(moves(session)).toHaveLength(2);
    expect(session.dispatched).not.toContainEqual({ type: 'pickup' });

    session.publish(projectionOf({ hero: { x: 22, y: 10 }, groundItems: [item] }));
    // Arrival is paced the same way: nothing fires until STEP_MS has elapsed since the last step.
    expect(session.dispatched.at(-1)).not.toEqual({ type: 'pickup' });

    act(() => {
      vi.advanceTimersByTime(STEP_MS);
    });
    // Arrived on the item cell: the pickup fires, and no further move is dispatched.
    expect(session.dispatched.at(-1)).toEqual({ type: 'pickup' });
    expect(moves(session)).toHaveLength(2);
  });

  it('clicking a hostile dispatches a move toward it (which the command builder resolves to an attack)', async () => {
    const hostile: FakeActor = {
      actorId: 'monster.rat',
      x: 21,
      y: 10,
      disposition: 'hostile',
      health: 4,
      maxHealth: 4,
      healthPresentation: { band: 'healthy' },
      glyph: 'r',
    };
    const session = new FakeSession(projectionOf({ hero: { x: 20, y: 10 }, actors: [hostile] }));
    const fake = await renderPlay(session);
    clickCell(fake, { x: 21, y: 10 });
    // Adjacent hostile: a single east move, which `buildIntent` turns into an attack (see
    // travel.test.ts's grounding case).
    expect(session.dispatched).toEqual([{ type: 'move', direction: 'east' }]);
  });
});

describe('PlayScreen hover description popover', () => {
  it('hovering a floor item shows a description popover naming it', async () => {
    const item: FakeItem = {
      itemId: 'item.sword',
      x: 22,
      y: 10,
      name: 'Iron sword',
      glyph: '/',
      category: 'weapon',
      quantity: 1,
      identified: true,
    };
    const session = new FakeSession(projectionOf({ hero: { x: 20, y: 10 }, groundItems: [item] }));
    const fake = await renderPlay(session);
    act(() => fake.latest().hover({ x: 22, y: 10 }, 30, 30));
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('Iron sword');
    expect(tooltip).toHaveTextContent(/weapon/i);
  });
});
