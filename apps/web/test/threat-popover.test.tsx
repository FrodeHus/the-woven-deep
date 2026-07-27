import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { GuestSession } from '../src/session/guest-session.js';
import type { SessionStorageLike } from '../src/session/storage.js';
import { PlayScreen } from '../src/ui/PlayScreen.js';
import { ThreatPopover } from '../src/ui/ThreatPopover.js';
import { fakePlayfieldRenderer } from './fake-playfield-renderer.js';
import { withUiProviders } from './with-ui-providers.js';

let pack: CompiledContentPack;

const SEED = [11, 22, 33, 44] as const;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

function fakeStorage(): SessionStorageLike {
  const store = new Map<string, string>();
  return {
    get: (key: string) => store.get(key) ?? null,
    set: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

describe('ThreatPopover', () => {
  it("renders as a non-focusable tooltip with the actor's fields", () => {
    render(
      <ThreatPopover
        actor={{
          name: 'Cave rat',
          glyph: 'r',
          disposition: 'hostile',
          healthPresentation: { band: 'wounded' },
          intentPresentation: 'intent.approach',
        }}
        leftPx={16}
        topPx={48}
        paneWidthPx={200}
        paneHeightPx={200}
        pack={pack}
      />,
    );
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Cave rat');
    expect(tooltip).toHaveTextContent('wounded');
    expect(tooltip).toHaveTextContent('intent.approach');
    expect(tooltip).toHaveTextContent('hostile');
    expect(tooltip).not.toHaveAttribute('tabindex');
  });

  it("shows the monster's authored description when its contentId resolves in the pack", () => {
    render(
      <ThreatPopover
        actor={{
          name: 'Cave rat',
          glyph: 'r',
          disposition: 'hostile',
          healthPresentation: { band: 'wounded' },
          contentId: 'monster.cave-rat',
        }}
        leftPx={16}
        topPx={48}
        paneWidthPx={200}
        paneHeightPx={200}
        pack={pack}
      />,
    );
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent(/bold in the dark/i);
  });

  it('omits any description when the actor has no contentId', () => {
    render(
      <ThreatPopover
        actor={{
          name: 'Cave rat',
          disposition: 'hostile',
          healthPresentation: { band: 'wounded' },
        }}
        leftPx={16}
        topPx={48}
        paneWidthPx={200}
        paneHeightPx={200}
        pack={pack}
      />,
    );
    expect(document.querySelector('.threat-popover-description')).not.toBeInTheDocument();
  });

  it('positions itself in pixels from its pane-relative anchor, not a CSS custom property', () => {
    render(
      <ThreatPopover
        actor={{
          name: 'Cave rat',
          disposition: 'hostile',
          healthPresentation: { band: 'healthy' },
        }}
        leftPx={20}
        topPx={54}
        paneWidthPx={200}
        paneHeightPx={180}
        pack={pack}
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
        actor={{
          name: 'Cave rat',
          disposition: 'hostile',
          healthPresentation: { band: 'healthy' },
        }}
        leftPx={8000}
        topPx={-40}
        paneWidthPx={152}
        paneHeightPx={300}
        pack={pack}
      />,
    );
    const style = screen.getByRole('tooltip').getAttribute('style')!;
    // left clamps to the pane width (152), top clamps up to 0.
    expect(style).toContain('left: 152px');
    expect(style).toContain('top: 0px');
  });
});

describe('PlayScreen threat hover integration (compact tier)', () => {
  it('hovering an empty cell shows nothing', async () => {
    const session = new GuestSession({ pack, storage: fakeStorage(), seed: SEED });
    const fake = fakePlayfieldRenderer();
    render(
      withUiProviders(
        pack,
        <PlayScreen
          session={session}
          pack={pack}
          tier="compact"
          createRenderer={fake.createRenderer}
        />,
      ),
    );
    await screen.findByRole('img', { name: /dungeon/i });

    act(() => fake.latest().hover({ x: 0, y: 0 }, 10, 10));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('hovering a cell holding a visible actor shows the popover with its name, and unhover removes it', async () => {
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
    const fakeSession = {
      subscribe: () => () => {},
      getSnapshot: () => spliced,
    } as unknown as GuestSession;

    const fake = fakePlayfieldRenderer();
    render(
      withUiProviders(
        pack,
        <PlayScreen
          session={fakeSession}
          pack={pack}
          tier="compact"
          createRenderer={fake.createRenderer}
        />,
      ),
    );
    await screen.findByRole('img', { name: /dungeon/i });

    act(() => fake.latest().hover({ x: hero.x + 1, y: hero.y }, 40, 20));
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Cave rat'));

    act(() => fake.latest().hover(null));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
