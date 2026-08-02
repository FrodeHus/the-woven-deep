import { resolve } from 'node:path';
import { useState, type JSX } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  DEFAULT_GUEST_HERO,
  createNewRun,
  descendToNextFloor,
  emptyEquipment,
  encodeActiveRun,
  projectGameplayState,
  type ActiveRun,
  type ActorState,
  type GameplayProjection,
} from '@woven-deep/engine';
import { GuestSession } from '../src/session/guest-session.js';
import { SAVE_KEY, type SessionStorageLike } from '../src/session/storage.js';
import { PlayScreen } from '../src/ui/PlayScreen.js';
import type { OverlayId } from '../src/ui/overlays/registry.js';
import { fakePlayfieldRenderer } from './fake-playfield-renderer.js';
import { withUiProviders } from './with-ui-providers.js';

let pack: CompiledContentPack;
let baseProjection: GameplayProjection;

const SEED = [11, 22, 33, 44] as const;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
  const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
  baseProjection = projectGameplayState({ state: run, content: pack });
});

function fakeStorage(): SessionStorageLike {
  let value: string | null = null;
  return {
    get: () => value,
    set: (v: string) => {
      value = v;
    },
  };
}

describe('PlayScreen renderer wiring', () => {
  function floorProjection(floorId: string, hero: { x: number; y: number }): GameplayProjection {
    const width = 100;
    const height = 60;
    const cells = [];
    for (let y = 0; y < height; y += 1)
      for (let x = 0; x < width; x += 1)
        cells.push({ index: y * width + x, x, y, knowledge: 'unknown' as const, intensity: 0 });
    return {
      ...baseProjection,
      floor: { floorId, width, height, cells },
      hero: { ...baseProjection.hero, x: hero.x, y: hero.y },
      actors: [],
      groundItems: [],
    } as unknown as GameplayProjection;
  }

  function fakeSession(projection: GameplayProjection): GuestSession {
    const snapshot = {
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
    };
    return { subscribe: () => () => {}, getSnapshot: () => snapshot } as unknown as GuestSession;
  }

  it('feeds the mounted renderer the current snapshot, and re-feeds it when the projection changes', async () => {
    const fake = fakePlayfieldRenderer();
    const first = floorProjection('floor.depth-001', { x: 50, y: 30 });
    const { rerender } = render(
      withUiProviders(
        pack,
        <PlayScreen
          session={fakeSession(first)}
          pack={pack}
          createRenderer={fake.createRenderer}
        />,
      ),
    );
    await screen.findByRole('img', { name: /dungeon/i });
    await waitFor(() => expect(fake.latest().snapshots.length).toBeGreaterThan(0));
    expect(fake.latest().snapshots.at(-1)!.projection.floor.floorId).toBe('floor.depth-001');

    const nextFloor = floorProjection('floor.depth-002', { x: 5, y: 5 });
    rerender(
      withUiProviders(
        pack,
        <PlayScreen
          session={fakeSession(nextFloor)}
          pack={pack}
          createRenderer={fake.createRenderer}
        />,
      ),
    );
    await waitFor(() =>
      expect(fake.latest().snapshots.at(-1)!.projection.floor.floorId).toBe('floor.depth-002'),
    );
  });
});

describe('PlayScreen keyboard routing', () => {
  function fakeStorage(): SessionStorageLike {
    const values = new Map<string, string>();
    return {
      get: (key: string) => values.get(key) ?? null,
      set: (key: string, value: string) => {
        values.set(key, value);
      },
    };
  }

  function decisionSession(): GuestSession {
    // The fresh guest run boots into town, whose fixed layout is always fully (and permanently)
    // lit -- so dousing the torch never hides a neighbor there. This descends to the depth-1
    // floor first (same trick as guest-session.test.ts's `depth1Run`): douse the torch and place
    // a neutral actor next door, in the dark, so the hero's own projection never sees it — a
    // plain `move` therefore resolves against the *actual* (neutral) occupant server-side, which
    // raises `decision_required`.
    const fresh = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const freshHero = fresh.actors.find((actor) => actor.playerControlled)!;
    const town = fresh.floors.find((floor) => floor.floorId === freshHero.floorId)!;
    const atStairDown: ActiveRun = {
      ...fresh,
      actors: fresh.actors.map((actor) =>
        actor.actorId === freshHero.actorId
          ? { ...actor, x: town.stairDown!.x, y: town.stairDown!.y }
          : actor,
      ),
    };
    const run = descendToNextFloor(atStairDown, { content: pack }).state;
    const heroActor = run.actors.find((actor) => actor.playerControlled)!;
    const doused = run.items.map((item) =>
      item.location.type === 'equipped' && item.location.slot === 'off-hand'
        ? { ...item, enabled: false }
        : item,
    );
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
      actors: [...run.actors, hiddenNeighbor].sort((left, right) =>
        left.actorId < right.actorId ? -1 : 1,
      ),
    };
    const storage = fakeStorage();
    storage.set(SAVE_KEY, encodeActiveRun(withHiddenNeighbor));
    return new GuestSession({ pack, storage });
  }

  it('opens the backpack on "i", moves the game keys through a focus trap, and closes on Escape', async () => {
    const user = userEvent.setup();
    const session = new GuestSession({ pack, storage: fakeStorage(), seed: SEED });
    // `inventory` is a registry overlay, so -- exactly like every other registry overlay --
    // `PlayScreen` does not own whether it's open; that state lives in the parent (`App`, normally).
    // This tiny stateful wrapper stands in for `App` so the test can drive `i`/Escape the same way a
    // real guest would.
    function Harness(): JSX.Element {
      const [overlay, setOverlay] = useState<OverlayId | null>(null);
      return withUiProviders(
        pack,
        <PlayScreen
          session={session}
          pack={pack}
          overlay={overlay}
          onOpenOverlay={setOverlay}
          onCloseOverlay={() => setOverlay(null)}
        />,
      );
    }
    render(<Harness />);

    expect(screen.queryByRole('dialog', { name: /pack & gear/i })).not.toBeInTheDocument();
    await user.keyboard('i');
    expect(await screen.findByRole('dialog', { name: /pack & gear/i })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: /pack & gear/i })).not.toBeInTheDocument();
  });

  it('answers a pending confirm-aggression decision with y/n via the decision prompt', async () => {
    const user = userEvent.setup();
    const session = decisionSession();
    render(withUiProviders(pack, <PlayScreen session={session} pack={pack} />));

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
    render(withUiProviders(pack, <PlayScreen session={session} pack={pack} />));

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
    render(withUiProviders(pack, <PlayScreen session={session} pack={pack} />));

    expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByTestId('command-palette')).toBeInTheDocument();
  });

  it('does not open the command palette while an overlay is already open', async () => {
    const user = userEvent.setup();
    const session = new GuestSession({ pack, storage: fakeStorage(), seed: SEED });
    function Harness(): JSX.Element {
      const [overlay, setOverlay] = useState<OverlayId | null>(null);
      return withUiProviders(
        pack,
        <PlayScreen
          session={session}
          pack={pack}
          overlay={overlay}
          onOpenOverlay={setOverlay}
          onCloseOverlay={() => setOverlay(null)}
        />,
      );
    }
    render(<Harness />);

    await user.keyboard('i');
    expect(await screen.findByRole('dialog', { name: /pack & gear/i })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument();
  });
});

describe('PlayScreen threat hover scroll-dismiss', () => {
  // Mirrors `threat-popover.test.tsx`'s own "hovering a cell holding a visible actor" harness (a
  // synthetic hostile neighbour spliced onto a real guest session's own snapshot, since `PlayScreen`
  // reads live actors straight off the session), extended with the one behavior that file doesn't
  // cover yet: a real `scroll` event (the listener `PlayScreen` attaches at L321-325) dismissing an
  // already-open popover.
  it('hovering an actor cell opens the popover, and a scroll event dismisses it', async () => {
    const session = new GuestSession({ pack, storage: fakeStorage(), seed: SEED });
    const snapshot = session.getSnapshot();
    const hero = snapshot.projection.hero as unknown as { x: number; y: number };
    const spliced = {
      ...snapshot,
      projection: {
        ...snapshot.projection,
        actors: [
          {
            actorId: 'actor.rat',
            name: 'Cave rat',
            glyph: 'r',
            disposition: 'hostile',
            healthPresentation: { band: 'wounded' },
            x: hero.x + 1,
            y: hero.y,
          },
        ],
      },
    };
    const fakeHoverSession = {
      subscribe: () => () => {},
      getSnapshot: () => spliced,
    } as unknown as GuestSession;

    const fake = fakePlayfieldRenderer();
    render(
      withUiProviders(
        pack,
        <PlayScreen session={fakeHoverSession} pack={pack} createRenderer={fake.createRenderer} />,
      ),
    );
    await screen.findByRole('img', { name: /dungeon/i });
    await fake.ready();

    act(() => fake.latest().hover({ x: hero.x + 1, y: hero.y }, 30, 30));
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Cave rat'));

    fireEvent.scroll(window);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});

describe('PlayScreen hover cursor', () => {
  interface HoverCell {
    readonly x: number;
    readonly y: number;
    readonly knowledge: string;
    readonly token?: string;
  }

  const PASSABLE = new Set(['terrain.floor', 'terrain.stair', 'terrain.door']);

  it('pushes a navigable/blocked cursor per hovered cell and clears it on pointer leave', async () => {
    const session = new GuestSession({ pack, storage: fakeStorage(), seed: SEED });
    const cells = session.getSnapshot().projection.floor.cells as readonly HoverCell[];
    const navigable = cells.find(
      (cell) =>
        cell.knowledge !== 'unknown' && cell.token !== undefined && PASSABLE.has(cell.token),
    );
    const blocked = cells.find(
      (cell) =>
        cell.knowledge !== 'unknown' && cell.token !== undefined && !PASSABLE.has(cell.token),
    );
    const unknown = cells.find((cell) => cell.knowledge === 'unknown');
    expect(navigable).toBeDefined();
    expect(blocked).toBeDefined();

    const fake = fakePlayfieldRenderer();
    render(
      withUiProviders(
        pack,
        <PlayScreen session={session} pack={pack} createRenderer={fake.createRenderer} />,
      ),
    );
    await screen.findByRole('img', { name: /dungeon/i });
    await fake.ready();

    act(() => fake.latest().hover({ x: navigable!.x, y: navigable!.y }, 10, 10));
    await waitFor(() =>
      expect(fake.latest().lastHoverCursor()).toEqual({
        cell: { x: navigable!.x, y: navigable!.y },
        navigable: true,
      }),
    );

    act(() => fake.latest().hover({ x: blocked!.x, y: blocked!.y }, 10, 10));
    await waitFor(() =>
      expect(fake.latest().lastHoverCursor()).toEqual({
        cell: { x: blocked!.x, y: blocked!.y },
        navigable: false,
      }),
    );

    // An undiscovered cell draws nothing at all -- the cursor must never hint at unseen terrain.
    if (unknown !== undefined) {
      act(() => fake.latest().hover({ x: unknown.x, y: unknown.y }, 10, 10));
      await waitFor(() => expect(fake.latest().lastHoverCursor()).toBeNull());
    }

    act(() => fake.latest().hover(null));
    await waitFor(() => expect(fake.latest().lastHoverCursor()).toBeNull());
  });
});

describe('PlayScreen Layout A composition', () => {
  function session(): GuestSession {
    const fresh = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const heroActor = fresh.actors.find((actor) => actor.playerControlled)!;
    const town = fresh.floors.find((floor) => floor.floorId === heroActor.floorId)!;
    const atStairDown: ActiveRun = {
      ...fresh,
      actors: fresh.actors.map((actor) =>
        actor.actorId === heroActor.actorId
          ? { ...actor, x: town.stairDown!.x, y: town.stairDown!.y }
          : actor,
      ),
    };
    const depth1 = descendToNextFloor(atStairDown, { content: pack }).state;
    const storage = new Map<string, string>();
    const keyedStorage: SessionStorageLike = {
      get: (key) => storage.get(key) ?? null,
      set: (key, value) => {
        storage.set(key, value);
      },
    };
    keyedStorage.set(SAVE_KEY, encodeActiveRun(depth1));
    return new GuestSession({ pack, storage: keyedStorage });
  }

  it('renders the full-bleed HUD -- top bar, floating minimap, and the playfield -- with no drawers on a dungeon floor', async () => {
    render(withUiProviders(pack, <PlayScreen session={session()} pack={pack} />));
    expect(await screen.findByRole('img', { name: /dungeon/i })).toBeInTheDocument();
    expect(screen.getByText('THE WOVEN DEEP')).toBeInTheDocument();
    expect(screen.getByTestId('minimap')).toBeInTheDocument();
    // The dungeon floor is not town, so no town panel floats over the HUD.
    expect(screen.queryByRole('region', { name: /town/i })).not.toBeInTheDocument();
    expect(document.querySelector('details.threat-drawer')).toBeNull();
    expect(document.querySelector('details.hero-drawer')).toBeNull();
  });

  it('floats the town panel over the HUD while in town', () => {
    const guestSession = new GuestSession({ pack, storage: fakeStorage(), seed: SEED });
    render(withUiProviders(pack, <PlayScreen session={guestSession} pack={pack} />));
    expect(screen.getByRole('region', { name: /town/i })).toBeInTheDocument();
    expect(screen.getByTestId('minimap')).toBeInTheDocument();
  });
});
