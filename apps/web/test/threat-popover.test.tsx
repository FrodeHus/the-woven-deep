import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { DEFAULT_GUEST_HERO, createNewRun, projectGameplayState, type GameplayProjection } from '@woven-deep/engine';
import { GuestSession } from '../src/session/guest-session.js';
import type { SessionStorageLike } from '../src/session/storage.js';
import { PlayScreen } from '../src/ui/PlayScreen.js';
import { ThreatPopover } from '../src/ui/ThreatPopover.js';
import { withUiProviders } from './with-ui-providers.js';

let pack: CompiledContentPack;
let baseProjection: GameplayProjection;

const SEED = [11, 22, 33, 44] as const;

beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
  const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
  baseProjection = projectGameplayState({ state: run, content: pack });
});

function fakeStorage(): SessionStorageLike {
  const store = new Map<string, string>();
  return {
    get: (key: string) => store.get(key) ?? null,
    set: (key: string, value: string) => { store.set(key, value); },
  };
}

describe('ThreatPopover', () => {
  it('renders as a non-focusable tooltip with the actor\'s fields', () => {
    render(
      <ThreatPopover
        actor={{
          name: 'Cave rat', glyph: 'r', disposition: 'hostile',
          healthPresentation: { band: 'wounded' }, intentPresentation: 'intent.approach',
        }}
        col={2} row={3} paneCols={20} paneRows={10} cellPx={{ width: 8, height: 16 }}
      />,
    );
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Cave rat');
    expect(tooltip).toHaveTextContent('wounded');
    expect(tooltip).toHaveTextContent('intent.approach');
    expect(tooltip).toHaveTextContent('hostile');
    expect(tooltip).not.toHaveAttribute('tabindex');
  });

  it('positions itself in pixels derived from the measured cell size, not a CSS custom property', () => {
    render(
      <ThreatPopover
        actor={{ name: 'Cave rat', disposition: 'hostile', healthPresentation: { band: 'healthy' } }}
        col={2} row={3} paneCols={20} paneRows={10} cellPx={{ width: 10, height: 18 }}
      />,
    );
    const style = screen.getByRole('tooltip').getAttribute('style')!;
    expect(style).toContain('left: 20px');
    expect(style).toContain('top: 54px');
    expect(style).not.toContain('--x');
    expect(style).not.toContain('--y');
  });

  it('clamps its position so it never renders past the pane bounds', () => {
    render(
      <ThreatPopover
        actor={{ name: 'Cave rat', disposition: 'hostile', healthPresentation: { band: 'healthy' } }}
        col={999} row={-5} paneCols={20} paneRows={10} cellPx={{ width: 8, height: 16 }}
      />,
    );
    const style = screen.getByRole('tooltip').getAttribute('style')!;
    // clamped col 19 (paneCols - 1) * width 8, clamped row 0 * height 16.
    expect(style).toContain('left: 152px');
    expect(style).toContain('top: 0px');
  });
});

describe('PlayScreen threat hover integration (compact tier)', () => {
  it('hovering an empty grid cell shows nothing', () => {
    const session = new GuestSession({ pack, storage: fakeStorage(), seed: SEED });
    render(withUiProviders(pack, <PlayScreen session={session} pack={pack} tier="compact" />));
    const grid = screen.getByRole('grid', { name: /dungeon/i });
    const emptyCell = grid.querySelector('[data-cell]')!;
    fireEvent.mouseOver(emptyCell);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('hovering a cell holding a visible actor shows the popover with its name, and unhover removes it', () => {
    const session = new GuestSession({ pack, storage: fakeStorage(), seed: SEED });
    const snapshot = session.getSnapshot();
    const hero = snapshot.projection.hero as unknown as { x: number; y: number };
    // `PlayScreen` reads live actors straight off the session's own projection, so a synthetic
    // hostile neighbour requires a minimal fake session rather than a real `GuestSession`.
    // `useSyncExternalStore` also requires `getSnapshot()` to return a referentially stable
    // value between notifications, so this is computed once rather than freshly on every call.
    const spliced = {
      ...snapshot,
      projection: {
        ...snapshot.projection,
        actors: [{
          actorId: 'actor.rat', name: 'Cave rat', glyph: 'r', disposition: 'hostile',
          healthPresentation: { band: 'wounded' }, x: hero.x + 1, y: hero.y,
        }],
      },
    };
    const fakeSession = {
      subscribe: () => () => {},
      getSnapshot: () => spliced,
    } as unknown as GuestSession;

    render(withUiProviders(pack, <PlayScreen session={fakeSession} pack={pack} tier="compact" />));
    const grid = screen.getByRole('grid', { name: /dungeon/i });
    const actorCell = grid.querySelector(`[data-cell="${hero.x + 1},${hero.y}"]`)!;

    fireEvent.mouseOver(actorCell);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Cave rat');

    fireEvent.mouseLeave(grid.closest('.map-pane')!);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
