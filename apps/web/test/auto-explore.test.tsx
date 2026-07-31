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
  type PublicEvent,
} from '@woven-deep/engine';
import type { GuestSession, SessionSnapshot } from '../src/session/guest-session.js';
import type { PlayerIntent } from '../src/session/intents.js';
import { PlayScreen } from '../src/ui/PlayScreen.js';
import { EXPLORE_STEP_MS } from '../src/ui/hooks/useAutoTravel.js';
import { fakePlayfieldRenderer } from './fake-playfield-renderer.js';
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
  /** Cells the hero has never discovered -- what auto-explore's frontier search walks toward. */
  unknownCells?: readonly Point[];
  /** Cells carrying a down stair (`terrain.stair`, glyph `>`). */
  stairs?: readonly Point[];
}): GameplayProjection {
  const wallSet = new Set((input.walls ?? []).map((point) => `${point.x},${point.y}`));
  const unknownSet = new Set((input.unknownCells ?? []).map((point) => `${point.x},${point.y}`));
  const stairSet = new Set((input.stairs ?? []).map((point) => `${point.x},${point.y}`));
  const cells = [];
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      if (unknownSet.has(`${x},${y}`)) {
        cells.push({
          index: y * WIDTH + x,
          x,
          y,
          knowledge: 'unknown' as const,
          tileId: 0,
          intensity: 0,
        });
        continue;
      }
      const wall = wallSet.has(`${x},${y}`);
      const stair = stairSet.has(`${x},${y}`);
      cells.push({
        index: y * WIDTH + x,
        x,
        y,
        knowledge: 'visible' as const,
        tileId: wall ? 0 : 1,
        glyph: wall ? '#' : stair ? '>' : '.',
        token: wall ? 'terrain.wall' : stair ? 'terrain.stair' : 'terrain.floor',
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

function snapshotOf(
  projection: GameplayProjection,
  houseOpen = false,
  lastEvents: readonly PublicEvent[] = [],
): SessionSnapshot {
  return {
    projection,
    log: [],
    lastEvents,
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
 * The same controllable session double `auto-travel.test.tsx` uses, plus the `noteSystemLine` seam
 * this task adds: `notes` records the client-only log lines auto-explore writes, so a test can
 * assert on why a walk stopped without going through the engine's own log folding.
 */
class FakeSession {
  public readonly dispatched: PlayerIntent[] = [];
  public readonly notes: string[] = [];
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

  noteSystemLine(text: string): void {
    this.notes.push(text);
  }

  publish(
    projection: GameplayProjection,
    houseOpen = false,
    lastEvents: readonly PublicEvent[] = [],
  ): void {
    act(() => {
      this.snapshot = snapshotOf(projection, houseOpen, lastEvents);
      for (const listener of this.listeners) listener();
    });
  }

  setHouseOpen(): void {}
  recordOnboardingIntent(): void {}
  dismissOnboardingHint(): void {}
  answerDecision(): void {}
}

async function renderPlay(session: FakeSession): Promise<void> {
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
}

function moves(session: FakeSession): readonly PlayerIntent[] {
  return session.dispatched.filter((intent) => intent.type === 'move');
}

/**
 * A one-tile corridor along y=10 with everything east of x=24 undiscovered. On open ground the
 * frontier is a whole column of equidistant cells and the deterministic BFS picks a diagonal, which
 * says nothing about the walk itself; the corridor leaves exactly one frontier cell and one first
 * step, so every assertion below is about pacing and stopping rather than tie-breaking.
 */
function eastCorridor(): { readonly walls: Point[]; readonly unknownCells: Point[] } {
  const walls: Point[] = [];
  const unknownCells: Point[] = [];
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      if (x >= 25) unknownCells.push({ x, y });
      else if (y !== 10) walls.push({ x, y });
    }
  }
  return { walls, unknownCells };
}

describe('auto-explore', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('walks toward unexplored ground one step per projection, paced at EXPLORE_STEP_MS', async () => {
    const { walls, unknownCells } = eastCorridor();
    const session = new FakeSession(projectionOf({ hero: { x: 20, y: 10 }, walls, unknownCells }));
    await renderPlay(session);

    vi.useFakeTimers();

    fireEvent.keyDown(window, { key: 'o' });
    expect(moves(session)).toEqual([{ type: 'move', direction: 'east' }]);

    session.publish(projectionOf({ hero: { x: 21, y: 10 }, walls, unknownCells }));
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
    const { walls, unknownCells } = eastCorridor();
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
      projectionOf({ hero: { x: 20, y: 10 }, walls, unknownCells, groundItems: [gold] }),
    );
    await renderPlay(session);

    vi.useFakeTimers();
    fireEvent.keyDown(window, { key: 'o' });
    session.publish(
      projectionOf({ hero: { x: 21, y: 10 }, walls, unknownCells, groundItems: [gold] }),
    );
    act(() => {
      vi.advanceTimersByTime(EXPLORE_STEP_MS);
    });
    expect(session.dispatched.at(-1)).toEqual({ type: 'pickup' });
    expect(session.notes).toEqual([]);

    // A weapon appearing mid-walk halts the walk with a log line instead.
    const sword: FakeItem = { ...gold, itemId: 'item.sword', category: 'weapon', x: 23, y: 10 };
    session.publish(
      projectionOf({ hero: { x: 21, y: 10 }, walls, unknownCells, groundItems: [sword] }),
    );
    act(() => {
      vi.advanceTimersByTime(EXPLORE_STEP_MS);
    });
    expect(session.notes).toHaveLength(1);
    expect(session.notes[0]).toMatch(/floor/i);
  });

  it('offers a declined item once per floor, not again when a later leg re-enters its room', async () => {
    const { walls, unknownCells } = eastCorridor();
    const sword: FakeItem = {
      itemId: 'item.sword',
      x: 23,
      y: 10,
      name: 'Iron sword',
      glyph: '/',
      category: 'weapon',
      quantity: 1,
      identified: true,
    };
    const session = new FakeSession(projectionOf({ hero: { x: 20, y: 10 }, walls, unknownCells }));
    await renderPlay(session);

    vi.useFakeTimers();

    // Leg one: the sword comes into view and halts the walk.
    fireEvent.keyDown(window, { key: 'o' });
    session.publish(
      projectionOf({ hero: { x: 21, y: 10 }, walls, unknownCells, groundItems: [sword] }),
    );
    act(() => {
      vi.advanceTimersByTime(EXPLORE_STEP_MS);
    });
    expect(session.notes).toHaveLength(1);

    // The player declines it and walks on; the sword leaves the field of view, so the next leg's
    // own start snapshot cannot remember it.
    session.publish(projectionOf({ hero: { x: 21, y: 10 }, walls, unknownCells }));
    fireEvent.keyDown(window, { key: 'o' });
    expect(moves(session)).toHaveLength(2);

    // Re-entering the sword's room must NOT re-offer it -- the walk carries on.
    session.publish(
      projectionOf({ hero: { x: 22, y: 10 }, walls, unknownCells, groundItems: [sword] }),
    );
    act(() => {
      vi.advanceTimersByTime(EXPLORE_STEP_MS);
    });
    expect(session.notes).toHaveLength(1);
    expect(moves(session)).toHaveLength(3);
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
