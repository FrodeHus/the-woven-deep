import { resolve } from 'node:path';
import { useState, type JSX } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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
import type { SessionSnapshot } from '../src/session/guest-session.js';
import { HeroPanel, HeroStatusAnnouncer, LogPanel, StatusBar, ThreatPanel } from '../src/ui/panels.js';
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

function snapshotOf(projection: GameplayProjection, overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    projection,
    log: [],
    lastEvents: [],
    pendingDecision: null,
    notice: null,
    houseOpen: false,
    conclusion: null,
    sightings: { monsterIds: [], itemIds: [] },
    heroClassTags: [],
    onboarding: { counts: {}, dismissed: [] },
    ...overrides,
  };
}

function fakeStorage(): SessionStorageLike {
  let value: string | null = null;
  return { get: () => value, set: (v: string) => { value = v; } };
}

describe('HeroPanel', () => {
  it('shows name, health bar text, hunger stage, equipped slots, and backpack summary', () => {
    render(<HeroPanel snapshot={snapshotOf(baseProjection)} />);
    const hero = baseProjection.hero as unknown as {
      name: string; health: number; maxHealth: number; hungerStage: string;
      equipment: Record<string, { name: string } | null>;
      backpack: readonly unknown[]; backpackCapacity: number;
    };
    expect(screen.getByText(hero.name)).toBeInTheDocument();
    expect(screen.getByText(`${hero.health}/${hero.maxHealth} HP`)).toBeInTheDocument();
    expect(screen.getByText(`Hunger: ${hero.hungerStage}`)).toBeInTheDocument();
    const mainHand = hero.equipment['main-hand'];
    expect(mainHand).not.toBeNull();
    expect(screen.getByText(`main-hand: ${mainHand!.name}`)).toBeInTheDocument();
    expect(screen.getByText(`Backpack: ${hero.backpack.length}/${hero.backpackCapacity}`)).toBeInTheDocument();
  });

  it('carries the shared .framed corner class (Task 3 ornamental framing) and keeps the panel\'s accessible name/description unchanged in the DOM -- this is a DOM-level regression guard, not a real accessibility-tree assertion: the decorative corner glyphs are painted by CSS pseudo-elements, which never appear in React\'s rendered markup at all, so no DOM node (and therefore no accessibility-tree node) can carry them', () => {
    render(<HeroPanel snapshot={snapshotOf(baseProjection)} />);
    const hero = baseProjection.hero as unknown as { name: string };

    const region = screen.getByRole('region', { name: 'Hero' });
    expect(region).toHaveClass('framed');
    // The accessible name is exactly "Hero" (from aria-label) -- proves the framing didn't leak
    // any ornamental text into the name via e.g. an aria-label change or an extra labelled child.
    expect(region).toHaveAccessibleName('Hero');

    const title = screen.getByText(hero.name);
    expect(title.tagName).toBe('H2');
    expect(title).toHaveClass('framed-title');
    // The <h2> element's only text content is the hero's name -- the `.framed-title::after`
    // ornament is pure generated CSS content (`content: "◆" / ""`), never a DOM text node, so it
    // can neither change this element's textContent nor its accessible name.
    expect(title).toHaveTextContent(hero.name);
    expect(title.textContent).toBe(hero.name);
  });
});

describe('ThreatPanel', () => {
  it('lists visible hostile actors with intent and health band, and ground items', () => {
    const projection: GameplayProjection = {
      ...baseProjection,
      actors: [
        {
          actorId: 'actor.rat', name: 'Cave rat', glyph: 'r', disposition: 'hostile',
          healthPresentation: { band: 'wounded' }, intentPresentation: 'intent.approach',
        },
      ],
      groundItems: [{ itemId: 'item.floor-sword', name: 'Iron sword' }],
    } as unknown as GameplayProjection;

    render(<ThreatPanel snapshot={snapshotOf(projection)} />);
    expect(screen.getByText(/Cave rat/)).toBeInTheDocument();
    expect(screen.getByText(/wounded/)).toBeInTheDocument();
    expect(screen.getByText(/intent\.approach/)).toBeInTheDocument();
    expect(screen.getByText('Iron sword')).toBeInTheDocument();
    expect(screen.getByText('On the ground nearby')).toBeInTheDocument();
  });

  it('renders a "nothing nearby" placeholder on an empty-threat snapshot', () => {
    const projection: GameplayProjection = { ...baseProjection, actors: [], groundItems: [] };
    render(<ThreatPanel snapshot={snapshotOf(projection)} />);
    expect(screen.getByText(/nothing nearby/i)).toBeInTheDocument();
  });

  it('ignores non-hostile visible actors', () => {
    const projection: GameplayProjection = {
      ...baseProjection,
      actors: [{
        actorId: 'actor.merchant', name: 'Merchant', glyph: 'm', disposition: 'friendly',
        healthPresentation: { band: 'healthy' },
      }],
      groundItems: [],
    } as unknown as GameplayProjection;
    render(<ThreatPanel snapshot={snapshotOf(projection)} />);
    expect(screen.queryByText(/Merchant/)).not.toBeInTheDocument();
    expect(screen.getByText(/nothing nearby/i)).toBeInTheDocument();
  });
});

describe('LogPanel', () => {
  it('renders the newest lines last inside a polite live region with tone classes', () => {
    const log = [
      { id: 1, text: 'You enter the room.', tone: 'info' as const },
      { id: 2, text: 'A rat bites you.', tone: 'combat' as const },
      { id: 3, text: 'Your light is running low.', tone: 'warning' as const },
    ];
    render(<LogPanel snapshot={snapshotOf(baseProjection, { log })} />);
    const region = screen.getByRole('log');
    expect(region).toHaveAttribute('aria-live', 'polite');
    const lines = within(region).getAllByText(/./);
    expect(lines[lines.length - 1]).toHaveTextContent('Your light is running low.');
    expect(screen.getByText('A rat bites you.')).toHaveClass('log-line--combat');
    expect(screen.getByText('Your light is running low.')).toHaveClass('log-line--warning');
  });

  it('never unmounts the log region even when empty', () => {
    render(<LogPanel snapshot={snapshotOf(baseProjection, { log: [] })} />);
    expect(screen.getByRole('log')).toBeInTheDocument();
  });
});

describe('StatusBar', () => {
  it('shows the active floor\'s depth (not the deepest-depth metric), turn count, and hero identity', () => {
    const projection: GameplayProjection = {
      ...baseProjection,
      floor: { ...baseProjection.floor, depth: 2, town: false },
      metrics: { ...baseProjection.metrics, turnsElapsed: 7, deepestDepth: 5 },
    };
    render(<StatusBar snapshot={snapshotOf(projection)} />);
    const hero = projection.hero as unknown as { name: string };
    expect(screen.getByTestId('turn-count')).toHaveTextContent('Turn 7');
    expect(screen.getByText(/Depth 2/)).toBeInTheDocument();
    expect(screen.queryByText(/Depth 5/)).not.toBeInTheDocument();
    expect(screen.getByText(hero.name)).toBeInTheDocument();
  });

  it('shows "Town" instead of a depth number when the active floor is the town', () => {
    const projection: GameplayProjection = {
      ...baseProjection,
      floor: { ...baseProjection.floor, depth: 0, town: true },
    };
    render(<StatusBar snapshot={snapshotOf(projection)} />);
    expect(screen.getByText('Town')).toBeInTheDocument();
    expect(screen.queryByText(/Depth/)).not.toBeInTheDocument();
  });

  it('renders no condition badge when the hero has no active conditions', () => {
    render(<StatusBar snapshot={snapshotOf(baseProjection)} />);
    expect(document.querySelector('.condition-badge')).toBeNull();
  });

  it('renders a glyph-plus-name condition badge (not color-only) tinted from the condition\'s projected color', () => {
    const heroData = baseProjection.hero as unknown as Record<string, unknown>;
    const projection: GameplayProjection = {
      ...baseProjection,
      hero: {
        ...heroData,
        conditions: [{ conditionId: 'condition.poisoned', name: 'Poisoned', color: '#7ac86a', stacks: 1, remaining: 50 }],
      },
    } as unknown as GameplayProjection;
    render(<StatusBar snapshot={snapshotOf(projection)} />);
    const badge = document.querySelector('.condition-badge')!;
    expect(badge).not.toBeNull();
    expect(badge.textContent).toMatch(/Poisoned/);
    expect(badge.getAttribute('style')).toContain('--condition-color: #7ac86a');
  });

  it('picks the highest-stacks condition for the badge when several are active', () => {
    const heroData = baseProjection.hero as unknown as Record<string, unknown>;
    const projection: GameplayProjection = {
      ...baseProjection,
      hero: {
        ...heroData,
        conditions: [
          { conditionId: 'condition.poisoned', name: 'Poisoned', color: '#7ac86a', stacks: 1, remaining: 50 },
          { conditionId: 'condition.bleeding', name: 'Bleeding', color: '#c85a5a', stacks: 3, remaining: 20 },
        ],
      },
    } as unknown as GameplayProjection;
    render(<StatusBar snapshot={snapshotOf(projection)} />);
    expect(document.querySelector('.condition-badge')!.textContent).toMatch(/Bleeding/);
  });
});

describe('PlayScreen tier behavior', () => {
  // These tiers are about layout composition around whichever panel occupies the threat-slot --
  // ThreatPanel on a dungeon floor -- not about the town/TownPanel swap covered elsewhere, so this
  // boots straight into a real depth-1 floor (mirroring guest-session.test.ts's `depth1Run`)
  // rather than the fresh session's town start.
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

  it('full tier: renders hero panel, map grid, an always-visible threat panel, and a 6-line log', () => {
    render(<PlayScreen session={session()} pack={pack} tier="full" />);
    expect(screen.getByRole('grid', { name: /dungeon/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument(); // HeroPanel <h2>{name}</h2>
    expect(screen.getByRole('region', { name: /threats/i })).toBeInTheDocument();
    expect(screen.queryByText('Threats')).not.toBeInTheDocument(); // no drawer <summary> at full tier
    const logSlot = document.querySelector('.log-slot')!;
    expect(logSlot.getAttribute('style')).toContain('--log-lines: 6');
  });

  it('compact tier: replaces the threat panel with a keyboard-openable drawer containing the same content', () => {
    render(<PlayScreen session={session()} pack={pack} tier="compact" />);
    const drawer = document.querySelector('details.threat-drawer');
    expect(drawer).toBeInTheDocument();
    expect(within(drawer as HTMLElement).getByText('Threats')).toBeInTheDocument();
    expect(within(drawer as HTMLElement).getByRole('region', { name: /threats/i })).toBeInTheDocument();
  });

  it('minimal tier: collapses the hero panel into a drawer, shows a vitals strip, and shrinks the log to 3 lines', () => {
    render(<PlayScreen session={session()} pack={pack} tier="minimal" />);
    const heroDrawer = document.querySelector('details.hero-drawer');
    expect(heroDrawer).toBeInTheDocument();
    expect(screen.getByLabelText('Vitals')).toBeInTheDocument();
    const logSlot = document.querySelector('.log-slot')!;
    expect(logSlot.getAttribute('style')).toContain('--log-lines: 3');
  });
});

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
    const snapshot = snapshotOf(projection);
    return { subscribe: () => () => {}, getSnapshot: () => snapshot } as unknown as GuestSession;
  }

  function topLeftDataCell(): string {
    const grid = screen.getByRole('grid', { name: /dungeon/i });
    return grid.querySelector('[data-cell]')!.getAttribute('data-cell')!;
  }

  it('keeps the same camera origin across a small in-floor hero move (deadzone holds)', () => {
    const first = floorProjection('floor.depth-001', { x: 50, y: 30 });
    const { rerender } = render(<PlayScreen session={fakeSession(first)} pack={pack} tier="full" />);
    const originAfterFirst = topLeftDataCell();

    const movedSlightly = floorProjection('floor.depth-001', { x: 51, y: 30 });
    rerender(<PlayScreen session={fakeSession(movedSlightly)} pack={pack} tier="full" />);
    expect(topLeftDataCell()).toBe(originAfterFirst);
  });

  it('recenters on the new hero position when the floorId changes (a descend)', () => {
    const first = floorProjection('floor.depth-001', { x: 50, y: 30 });
    const { rerender } = render(<PlayScreen session={fakeSession(first)} pack={pack} tier="full" />);
    const originOnFirstFloor = topLeftDataCell();

    const nextFloor = floorProjection('floor.depth-002', { x: 5, y: 5 });
    rerender(<PlayScreen session={fakeSession(nextFloor)} pack={pack} tier="full" />);
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
          tier="full"
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
    render(<PlayScreen session={session} pack={pack} tier="full" />);

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
    render(<PlayScreen session={session} pack={pack} tier="full" />);

    await user.keyboard('l');
    await screen.findByRole('dialog', { name: /confirm attack/i });

    await user.keyboard('n');
    await waitFor(() => expect(session.getSnapshot().pendingDecision).toBeNull());
    expect(session.getSnapshot().log.at(-1)?.tone).toBe('system');
  });
});

describe('StatusBar live-region demotion (Task 9)', () => {
  it('is a labeled group, not a live region, so the per-turn turn counter never spams a screen reader', () => {
    render(<StatusBar snapshot={snapshotOf(baseProjection)} />);
    const bar = document.querySelector('.status-bar')!;
    expect(bar.getAttribute('role')).toBe('group');
    expect(bar.getAttribute('aria-live')).toBeNull();
  });
});

describe('HeroStatusAnnouncer (Task 9)', () => {
  function heroWith(overrides: Record<string, unknown>): GameplayProjection {
    const heroData = baseProjection.hero as unknown as Record<string, unknown>;
    return { ...baseProjection, hero: { ...heroData, ...overrides } } as unknown as GameplayProjection;
  }

  it('renders a visually-hidden polite status region that is silent on first mount', () => {
    render(<HeroStatusAnnouncer snapshot={snapshotOf(heroWith({ health: 100, maxHealth: 100 }))} />);
    const region = screen.getByRole('status');
    expect(region).toHaveClass('sr-only');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region.textContent).toBe('');
  });

  it('announces a health band crossing when the hero worsens', () => {
    const { rerender } = render(
      <HeroStatusAnnouncer snapshot={snapshotOf(heroWith({ health: 100, maxHealth: 100 }))} />,
    );
    const region = screen.getByRole('status');
    rerender(<HeroStatusAnnouncer snapshot={snapshotOf(heroWith({ health: 40, maxHealth: 100 }))} />);
    expect(region.textContent).toContain('Health low.');
  });

  it('stays silent on a health drop that does not cross a band (no spam)', () => {
    const { rerender } = render(
      <HeroStatusAnnouncer snapshot={snapshotOf(heroWith({ health: 100, maxHealth: 100 }))} />,
    );
    const region = screen.getByRole('status');
    rerender(<HeroStatusAnnouncer snapshot={snapshotOf(heroWith({ health: 60, maxHealth: 100 }))} />);
    expect(region.textContent).toBe('');
  });

  it('announces a newly gained condition by name', () => {
    const { rerender } = render(
      <HeroStatusAnnouncer snapshot={snapshotOf(heroWith({ conditions: [] }))} />,
    );
    const region = screen.getByRole('status');
    rerender(<HeroStatusAnnouncer snapshot={snapshotOf(heroWith({
      conditions: [{ conditionId: 'condition.poisoned', name: 'Poisoned', color: '#7ac86a', stacks: 1, remaining: 50 }],
    }))} />);
    expect(region.textContent).toContain('Afflicted: Poisoned.');
  });
});
