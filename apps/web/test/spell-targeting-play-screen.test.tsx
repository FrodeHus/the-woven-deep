import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
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

const EMBER_BOLT_SPELL = {
  spellId: 'spell.ember-bolt',
  name: 'Ember bolt',
  weaveCost: 3,
  range: 6,
  targetingId: 'target.actor',
} as const;

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

function hostile(x: number, y: number, actorId = 'monster.rat'): FakeActor {
  return {
    actorId,
    x,
    y,
    disposition: 'hostile',
    health: 4,
    maxHealth: 4,
    healthPresentation: { band: 'healthy' },
    glyph: 'r',
  };
}

function projectionOf(input: {
  hero: Point & { health?: number; weave?: number };
  actors?: readonly FakeActor[];
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
      weave: input.hero.weave ?? 10,
      castableSpells: [EMBER_BOLT_SPELL],
    },
    actors: input.actors ?? [],
    groundItems: [],
    trade: undefined,
  } as unknown as GameplayProjection;
}

function snapshotOf(projection: GameplayProjection): SessionSnapshot {
  return {
    projection,
    log: [],
    lastEvents: [],
    pendingDecision: null,
    pendingFinalChamberChoice: null,
    notice: null,
    houseOpen: false,
    conclusion: null,
    sightings: { monsterIds: [], itemIds: [], landmarks: [] },
    heroClassTags: [],
    onboarding: { counts: {}, dismissed: [] },
  } as unknown as SessionSnapshot;
}

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

function rightClickCell(cell: Point): void {
  const grid = screen.getByRole('grid', { name: /dungeon/i });
  const el = grid.querySelector(`[data-cell="${cell.x},${cell.y}"]`);
  expect(el, `cell ${cell.x},${cell.y} must be within the viewport`).not.toBeNull();
  fireEvent.contextMenu(el!);
}

function casts(session: FakeSession): readonly PlayerIntent[] {
  return session.dispatched.filter((intent) => intent.type === 'cast');
}

function moves(session: FakeSession): readonly PlayerIntent[] {
  return session.dispatched.filter((intent) => intent.type === 'move');
}

async function beginTargeting(): Promise<void> {
  const row = screen.getByRole('button', { name: /Ember bolt/ });
  await userEvent.click(row);
}

describe('PlayScreen spell-targeting mode', () => {
  it('clicking a valid target casts the active spell at its cell and exits targeting', async () => {
    const session = new FakeSession(
      projectionOf({ hero: { x: 20, y: 10 }, actors: [hostile(23, 10)] }),
    );
    renderPlay(session);

    await beginTargeting();
    clickCell({ x: 23, y: 10 });

    expect(casts(session)).toEqual([
      { type: 'cast', spellId: 'spell.ember-bolt', target: { x: 23, y: 10 } },
    ]);
    // Targeting exited: the overlay is gone and clicking again now performs ordinary auto-travel.
    expect(screen.queryByTestId('targeting-valid')).not.toBeInTheDocument();
  });

  it('clicking an out-of-range cell does not cast, and targeting stays active', async () => {
    // range 6; the hostile sits 12 cells east, well outside it.
    const session = new FakeSession(
      projectionOf({ hero: { x: 5, y: 10 }, actors: [hostile(17, 10)] }),
    );
    renderPlay(session);

    await beginTargeting();
    clickCell({ x: 17, y: 10 });

    expect(casts(session)).toEqual([]);
    expect(moves(session)).toEqual([]);
    // Still targeting -- the Ember bolt row is still the thing that was clicked to enter, and no
    // auto-travel move fired underneath the ignored click.
    expect(screen.getByRole('button', { name: /Ember bolt/ })).toBeInTheDocument();
  });

  it('clicking a cell with no hostile on it does not cast', async () => {
    const session = new FakeSession(
      projectionOf({ hero: { x: 20, y: 10 }, actors: [hostile(23, 10)] }),
    );
    renderPlay(session);

    await beginTargeting();
    clickCell({ x: 21, y: 10 });

    expect(casts(session)).toEqual([]);
    expect(moves(session)).toEqual([]);
  });

  it('a wall blocking line of sight to an otherwise in-range hostile prevents casting on it', async () => {
    const session = new FakeSession(
      projectionOf({
        hero: { x: 20, y: 10 },
        actors: [hostile(23, 10)],
        walls: [{ x: 22, y: 10 }],
      }),
    );
    renderPlay(session);

    await beginTargeting();
    clickCell({ x: 23, y: 10 });

    expect(casts(session)).toEqual([]);
  });

  it('Escape cancels targeting without casting', async () => {
    const session = new FakeSession(
      projectionOf({ hero: { x: 20, y: 10 }, actors: [hostile(23, 10)] }),
    );
    renderPlay(session);

    await beginTargeting();
    fireEvent.keyDown(window, { key: 'Escape' });
    clickCell({ x: 23, y: 10 });

    // Escape exited targeting, so the subsequent click is ordinary auto-travel (a move), not a cast.
    expect(casts(session)).toEqual([]);
  });

  it('right-click cancels targeting without casting', async () => {
    const session = new FakeSession(
      projectionOf({ hero: { x: 20, y: 10 }, actors: [hostile(23, 10)] }),
    );
    renderPlay(session);

    await beginTargeting();
    rightClickCell({ x: 23, y: 10 });

    expect(casts(session)).toEqual([]);
    expect(screen.queryByTestId('targeting-valid')).not.toBeInTheDocument();
  });

  it('Enter casts at the keyboard reticle (defaulting to the only valid target)', async () => {
    const session = new FakeSession(
      projectionOf({ hero: { x: 20, y: 10 }, actors: [hostile(23, 10)] }),
    );
    renderPlay(session);

    await beginTargeting();
    fireEvent.keyDown(window, { key: 'Enter' });

    expect(casts(session)).toEqual([
      { type: 'cast', spellId: 'spell.ember-bolt', target: { x: 23, y: 10 } },
    ]);
  });

  it('highlights the valid target cell while targeting is active', async () => {
    const session = new FakeSession(
      projectionOf({ hero: { x: 20, y: 10 }, actors: [hostile(23, 10)] }),
    );
    renderPlay(session);

    await beginTargeting();
    // `TargetingOverlay` is a sibling of the `role="grid"` element (its own absolutely-positioned
    // overlay layer within the map pane), so it's queried from the whole layout, not the grid.
    const layout = screen.getByTestId('play-layout');
    // The lone hostile is both the only valid target AND the default reticle, so it renders with
    // BOTH classes (`data-testid` reads "targeting-reticle" once a cell is also highlighted --
    // see `TargetingOverlay`).
    const cell = layout.querySelector('[data-cell="23,10"].targeting-cell');
    expect(cell).not.toBeNull();
    expect(cell).toHaveClass('targeting-cell-valid');
  });

  it('movement keys do not move the hero while targeting is active', async () => {
    const session = new FakeSession(
      projectionOf({ hero: { x: 20, y: 10 }, actors: [hostile(23, 10)] }),
    );
    renderPlay(session);

    await beginTargeting();
    fireEvent.keyDown(window, { key: 'ArrowUp' });

    expect(moves(session)).toEqual([]);
  });
});

describe('PlayScreen click-to-move is unaffected when targeting is inactive', () => {
  it('clicking an adjacent cell still dispatches exactly one move (no regression)', () => {
    const session = new FakeSession(
      projectionOf({ hero: { x: 20, y: 10 }, actors: [hostile(23, 10)] }),
    );
    renderPlay(session);
    clickCell({ x: 21, y: 10 });
    expect(session.dispatched).toEqual([{ type: 'move', direction: 'east' }]);
  });
});
