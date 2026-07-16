import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { DEFAULT_GUEST_HERO, createNewRun, projectGameplayState, type GameplayProjection } from '@woven-deep/engine';
import { GuestSession } from '../src/session/guest-session.js';
import type { SessionStorageLike } from '../src/session/storage.js';
import type { SessionSnapshot } from '../src/session/guest-session.js';
import { HeroPanel, LogPanel, StatusBar, ThreatPanel } from '../src/ui/panels.js';
import { PlayScreen } from '../src/ui/PlayScreen.js';

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
    backpackOpen: false,
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
  it('shows depth, turn count, and hero identity', () => {
    const projection: GameplayProjection = {
      ...baseProjection,
      metrics: { ...baseProjection.metrics, turnsElapsed: 7, deepestDepth: 2 },
    };
    render(<StatusBar snapshot={snapshotOf(projection)} />);
    const hero = projection.hero as unknown as { name: string };
    expect(screen.getByTestId('turn-count')).toHaveTextContent('Turn 7');
    expect(screen.getByText(/Depth 2/)).toBeInTheDocument();
    expect(screen.getByText(hero.name)).toBeInTheDocument();
  });
});

describe('PlayScreen tier behavior', () => {
  function session(): GuestSession {
    return new GuestSession({ pack, storage: fakeStorage(), seed: SEED });
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
