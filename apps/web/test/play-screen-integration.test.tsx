import { resolve } from 'node:path';
import { useState, type JSX } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  DEFAULT_GUEST_HERO, createNewRun, descendToNextFloor, emptyEquipment, encodeActiveRun, projectGameplayState,
  type ActiveRun, type ActorState, type GameplayProjection,
} from '@woven-deep/engine';
import { GuestSession } from '../src/session/guest-session.js';
import { SAVE_KEY, type SessionStorageLike } from '../src/session/storage.js';
import { PlayScreen } from '../src/ui/PlayScreen.js';
import type { OverlayId } from '../src/ui/overlays/registry.js';

let pack: CompiledContentPack;
let baseProjection: GameplayProjection;

const SEED = [11, 22, 33, 44] as const;

beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
  const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
  baseProjection = projectGameplayState({ state: run, content: pack });
});

function fakeStorage(): SessionStorageLike {
  let value: string | null = null;
  return { get: () => value, set: (v: string) => { value = v; } };
}

describe('PlayScreen camera wiring', () => {
  // jsdom's zero-size measurements clamp the viewport to MIN_VIEWPORT (30x12, see layout.ts), so
  // this floor is generously larger than that on both axes — see camera.ts's `scrolledAxis` for
  // how the projected hero's `sightRadius` (now read straight off the projection) sizes the
  // deadzone margin.
  function unknownCell(index: number, x: number, y: number): GameplayProjection['floor']['cells'][number] {
    return { index, x, y, knowledge: 'unknown', intensity: 0 };
  }

  function floorProjection(floorId: string, hero: { x: number; y: number }): GameplayProjection {
    const width = 100; const height = 60;
    const cells = [];
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) cells.push(unknownCell(y * width + x, x, y));
    return {
      ...baseProjection,
      floor: { floorId, width, height, cells },
      hero: { ...baseProjection.hero, x: hero.x, y: hero.y },
      actors: [], groundItems: [],
    } as unknown as GameplayProjection;
  }

  function fakeSession(projection: GameplayProjection): GuestSession {
    const snapshot = {
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
    };
    return { subscribe: () => () => {}, getSnapshot: () => snapshot } as unknown as GuestSession;
  }

  function topLeftDataCell(): string {
    const grid = screen.getByRole('grid', { name: /dungeon/i });
    return grid.querySelector('[data-cell]')!.getAttribute('data-cell')!;
  }

  it('keeps the same camera origin across a small in-floor hero move (deadzone holds)', () => {
    const first = floorProjection('floor.depth-001', { x: 50, y: 30 });
    const { rerender } = render(<PlayScreen session={fakeSession(first)} pack={pack} />);
    const originAfterFirst = topLeftDataCell();

    const movedSlightly = floorProjection('floor.depth-001', { x: 51, y: 30 });
    rerender(<PlayScreen session={fakeSession(movedSlightly)} pack={pack} />);
    expect(topLeftDataCell()).toBe(originAfterFirst);
  });

  it('recenters on the new hero position when the floorId changes (a descend)', () => {
    const first = floorProjection('floor.depth-001', { x: 50, y: 30 });
    const { rerender } = render(<PlayScreen session={fakeSession(first)} pack={pack} />);
    const originOnFirstFloor = topLeftDataCell();

    const nextFloor = floorProjection('floor.depth-002', { x: 5, y: 5 });
    rerender(<PlayScreen session={fakeSession(nextFloor)} pack={pack} />);
    expect(topLeftDataCell()).not.toBe(originOnFirstFloor);
    // Centered afresh on the new hero position (5,5) inside a 100x60 floor with a >=30x12
    // viewport clamps to the top-left floor corner, same as computeCamera's own corner-clamp test.
    expect(topLeftDataCell()).toBe('0,0');
  });
});

describe('PlayScreen keyboard routing', () => {
  function fakeStorage(): SessionStorageLike {
    const values = new Map<string, string>();
    return {
      get: (key: string) => values.get(key) ?? null,
      set: (key: string, value: string) => { values.set(key, value); },
    };
  }

  function decisionSession(): GuestSession {
    // The fresh guest run boots into town, whose fixed layout is always fully (and permanently)
    // lit -- douse-the-torch no longer hides a neighbor there. So this descends to the depth-1
    // floor first (same trick as guest-session.test.ts's `depth1Run`): douse the torch and place
    // a neutral actor next door, in the dark, so the hero's own projection never sees it — a
    // plain `move` therefore resolves against the *actual* (neutral) occupant server-side, which
    // raises `decision_required`.
    const fresh = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const freshHero = fresh.actors.find((actor) => actor.playerControlled)!;
    const town = fresh.floors.find((floor) => floor.floorId === freshHero.floorId)!;
    const atStairDown: ActiveRun = {
      ...fresh,
      actors: fresh.actors.map((actor) => actor.actorId === freshHero.actorId
        ? { ...actor, x: town.stairDown!.x, y: town.stairDown!.y } : actor),
    };
    const run = descendToNextFloor(atStairDown, { content: pack }).state;
    const heroActor = run.actors.find((actor) => actor.playerControlled)!;
    const doused = run.items.map((item) => item.location.type === 'equipped' && item.location.slot === 'off-hand'
      ? { ...item, enabled: false } : item);
    const hiddenNeighbor: ActorState = {
      ...heroActor,
      actorId: 'npc.hidden-bystander',
      contentId: 'monster.cave-rat',
      playerControlled: false,
      x: heroActor.x + 1,
      y: heroActor.y,
      disposition: 'neutral',
      energy: 0,
      equipment: emptyEquipment(),
      behaviorId: null,
    };
    const withHiddenNeighbor: ActiveRun = {
      ...run,
      items: doused,
      actors: [...run.actors, hiddenNeighbor].sort((left, right) => (left.actorId < right.actorId ? -1 : 1)),
    };
    const storage = fakeStorage();
    storage.set(SAVE_KEY, encodeActiveRun(withHiddenNeighbor));
    return new GuestSession({ pack, storage });
  }

  it('opens the backpack on "i", moves the game keys through a focus trap, and closes on Escape', async () => {
    const user = userEvent.setup();
    const session = new GuestSession({ pack, storage: fakeStorage(), seed: SEED });
    // `inventory` is a registry overlay now (Task 5 absorbed the old standalone `BackpackMenu`),
    // so -- exactly like every other registry overlay -- `PlayScreen` no longer owns whether it's
    // open; that lives in the parent (`App`, normally). This tiny stateful wrapper stands in for
    // `App` so the test can drive `i`/Escape the same way a real guest would.
    function Harness(): JSX.Element {
      const [overlay, setOverlay] = useState<OverlayId | null>(null);
      return (
        <PlayScreen
          session={session}
          pack={pack}
          overlay={overlay}
          onOpenOverlay={setOverlay}
          onCloseOverlay={() => setOverlay(null)}
        />
      );
    }
    render(<Harness />);

    expect(screen.queryByRole('dialog', { name: /backpack/i })).not.toBeInTheDocument();
    await user.keyboard('i');
    expect(await screen.findByRole('dialog', { name: /backpack/i })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: /backpack/i })).not.toBeInTheDocument();
  });

  it('answers a pending confirm-aggression decision with y/n via the decision prompt', async () => {
    const user = userEvent.setup();
    const session = decisionSession();
    render(<PlayScreen session={session} pack={pack} />);

    // A plain "move" into the hidden neighbor's cell (east) raises the decision.
    await user.keyboard('l');
    expect(await screen.findByRole('dialog', { name: /confirm attack/i })).toBeInTheDocument();
    expect(session.getSnapshot().pendingDecision).not.toBeNull();

    await user.keyboard('y');
    await waitFor(() => expect(session.getSnapshot().pendingDecision).toBeNull());
    expect(screen.queryByRole('dialog', { name: /confirm attack/i })).not.toBeInTheDocument();
  });

  it('declines a pending decision on "n"', async () => {
    const user = userEvent.setup();
    const session = decisionSession();
    render(<PlayScreen session={session} pack={pack} />);

    await user.keyboard('l');
    await screen.findByRole('dialog', { name: /confirm attack/i });

    await user.keyboard('n');
    await waitFor(() => expect(session.getSnapshot().pendingDecision).toBeNull());
    expect(session.getSnapshot().log.at(-1)?.tone).toBe('system');
  });
});

describe('PlayScreen command palette shortcut', () => {
  it('opens the command palette on Ctrl/Cmd+K', () => {
    const session = new GuestSession({ pack, storage: fakeStorage(), seed: SEED });
    render(<PlayScreen session={session} pack={pack} />);

    expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByTestId('command-palette')).toBeInTheDocument();
  });

  it('does not open the command palette while an overlay is already open', async () => {
    const user = userEvent.setup();
    const session = new GuestSession({ pack, storage: fakeStorage(), seed: SEED });
    function Harness(): JSX.Element {
      const [overlay, setOverlay] = useState<OverlayId | null>(null);
      return (
        <PlayScreen
          session={session}
          pack={pack}
          overlay={overlay}
          onOpenOverlay={setOverlay}
          onCloseOverlay={() => setOverlay(null)}
        />
      );
    }
    render(<Harness />);

    await user.keyboard('i');
    expect(await screen.findByRole('dialog', { name: /backpack/i })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument();
  });
});

describe('PlayScreen Layout A composition', () => {
  function session(): GuestSession {
    const fresh = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const heroActor = fresh.actors.find((actor) => actor.playerControlled)!;
    const town = fresh.floors.find((floor) => floor.floorId === heroActor.floorId)!;
    const atStairDown: ActiveRun = {
      ...fresh,
      actors: fresh.actors.map((actor) => actor.actorId === heroActor.actorId
        ? { ...actor, x: town.stairDown!.x, y: town.stairDown!.y } : actor),
    };
    const depth1 = descendToNextFloor(atStairDown, { content: pack }).state;
    const storage = new Map<string, string>();
    const keyedStorage: SessionStorageLike = {
      get: (key) => storage.get(key) ?? null,
      set: (key, value) => { storage.set(key, value); },
    };
    keyedStorage.set(SAVE_KEY, encodeActiveRun(depth1));
    return new GuestSession({ pack, storage: keyedStorage });
  }

  it('always renders the hero panel, minimap, map grid, and an always-visible threat panel -- Layout A never collapses into drawers', () => {
    render(<PlayScreen session={session()} pack={pack} />);
    expect(screen.getByRole('grid', { name: /dungeon/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Hero' })).toBeInTheDocument();
    expect(screen.getByTestId('minimap')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /threats/i })).toBeInTheDocument();
    expect(document.querySelector('details.threat-drawer')).toBeNull();
    expect(document.querySelector('details.hero-drawer')).toBeNull();
  });

  it('renders the town panel instead of the threat panel while in town, still without collapsing', () => {
    const guestSession = new GuestSession({ pack, storage: fakeStorage(), seed: SEED });
    render(<PlayScreen session={guestSession} pack={pack} />);
    expect(screen.getByRole('region', { name: /town/i })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /threats/i })).not.toBeInTheDocument();
  });
});
