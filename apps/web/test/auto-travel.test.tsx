import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
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

function snapshotOf(projection: GameplayProjection): SessionSnapshot {
  return {
    projection,
    log: [],
    lastEvents: [],
    pendingDecision: null,
    notice: null,
    houseOpen: false,
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

  publish(projection: GameplayProjection): void {
    act(() => {
      this.snapshot = snapshotOf(projection);
      for (const listener of this.listeners) listener();
    });
  }

  // Unused-by-click methods the key dispatcher may touch; harmless no-ops for these tests.
  setHouseOpen(): void {}
  recordOnboardingIntent(): void {}
  dismissOnboardingHint(): void {}
  answerDecision(): void {}
}

function renderPlay(session: FakeSession): void {
  render(
    withUiProviders(pack, <PlayScreen session={session as unknown as GuestSession} pack={pack} />),
  );
}

function clickCell(cell: Point): void {
  const grid = screen.getByRole('grid', { name: /dungeon/i });
  const el = grid.querySelector(`[data-cell="${cell.x},${cell.y}"]`);
  expect(el, `cell ${cell.x},${cell.y} must be within the viewport`).not.toBeNull();
  fireEvent.click(el!);
}

function moves(session: FakeSession): readonly PlayerIntent[] {
  return session.dispatched.filter((intent) => intent.type === 'move');
}

describe('PlayScreen click-to-move (auto-travel)', () => {
  it('clicking an adjacent cell dispatches exactly one move', () => {
    const session = new FakeSession(projectionOf({ hero: { x: 20, y: 10 } }));
    renderPlay(session);
    clickCell({ x: 21, y: 10 });
    expect(session.dispatched).toEqual([{ type: 'move', direction: 'east' }]);
  });

  it('clicking a distant reachable cell starts auto-travel (first step dispatched) and is cancellable by a keypress', () => {
    const session = new FakeSession(projectionOf({ hero: { x: 20, y: 10 } }));
    renderPlay(session);

    clickCell({ x: 23, y: 10 });
    // Only the FIRST step is dispatched up front; the rest await each authoritative projection.
    expect(moves(session)).toEqual([{ type: 'move', direction: 'east' }]);

    // A keypress cancels the walk.
    fireEvent.keyDown(window, { key: 'Backspace' });

    // Publishing the projection that confirms the first step must NOT resume the (cancelled) walk.
    session.publish(projectionOf({ hero: { x: 21, y: 10 } }));
    expect(moves(session)).toEqual([{ type: 'move', direction: 'east' }]);
  });

  it('auto-travels step by step and picks up a floor item on arrival', () => {
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
    renderPlay(session);

    clickCell({ x: 22, y: 10 });
    expect(moves(session)).toHaveLength(1);
    expect(session.dispatched).not.toContainEqual({ type: 'pickup' });

    session.publish(projectionOf({ hero: { x: 21, y: 10 }, groundItems: [item] }));
    expect(moves(session)).toHaveLength(2);
    expect(session.dispatched).not.toContainEqual({ type: 'pickup' });

    session.publish(projectionOf({ hero: { x: 22, y: 10 }, groundItems: [item] }));
    // Arrived on the item cell: the pickup fires, and no further move is dispatched.
    expect(session.dispatched.at(-1)).toEqual({ type: 'pickup' });
    expect(moves(session)).toHaveLength(2);
  });

  it('clicking a hostile dispatches a move toward it (which the command builder resolves to an attack)', () => {
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
    renderPlay(session);
    clickCell({ x: 21, y: 10 });
    // Adjacent hostile: a single east move, which `buildIntent` turns into an attack (see
    // travel.test.ts's grounding case).
    expect(session.dispatched).toEqual([{ type: 'move', direction: 'east' }]);
  });
});

describe('PlayScreen movement affordance cursor', () => {
  function cursor(): HTMLElement | null {
    return screen.queryByTestId('cell-cursor');
  }

  it('highlights a reachable floor cell as an inviting move target', () => {
    const session = new FakeSession(projectionOf({ hero: { x: 20, y: 10 } }));
    renderPlay(session);
    const grid = screen.getByRole('grid', { name: /dungeon/i });
    fireEvent.mouseOver(grid.querySelector('[data-cell="23,10"]')!);
    expect(cursor()).toHaveAttribute('data-reachable', 'true');
    expect(cursor()).toHaveClass('cell-cursor-reachable');
  });

  it('does not invite a move over a non-actionable cell (a wall)', () => {
    const session = new FakeSession(
      projectionOf({ hero: { x: 20, y: 10 }, walls: [{ x: 22, y: 10 }] }),
    );
    renderPlay(session);
    const grid = screen.getByRole('grid', { name: /dungeon/i });
    fireEvent.mouseOver(grid.querySelector('[data-cell="22,10"]')!);
    // The cursor still tracks the cell, but reads as blocked rather than a move invitation.
    expect(cursor()).toHaveAttribute('data-reachable', 'false');
    expect(cursor()).toHaveClass('cell-cursor-blocked');
  });
});

describe('PlayScreen hover description popover', () => {
  it('hovering a floor item shows a description popover naming it', () => {
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
    renderPlay(session);
    const grid = screen.getByRole('grid', { name: /dungeon/i });
    fireEvent.mouseOver(grid.querySelector('[data-cell="22,10"]')!);
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Iron sword');
    expect(tooltip).toHaveTextContent(/weapon/i);
  });
});
