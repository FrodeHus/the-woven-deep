import { resolve } from 'node:path';
import { Component, type JSX, type ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { App } from '../src/App.js';
import { GuestSession } from '../src/session/guest-session.js';
import { resolveKeymap, SETTINGS_KEY, type Settings } from '../src/session/settings.js';
import type { SessionStorageLike } from '../src/session/storage.js';
import { OverlayErrorBoundary } from '../src/ui/overlays/OverlayErrorBoundary.js';
import { canOpenOverlay, OVERLAY_REGISTRY } from '../src/ui/overlays/registry.js';
import { PlayScreen } from '../src/ui/PlayScreen.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
});

afterEach(() => {
  window.history.replaceState({}, '', '/');
});

function packFetcher(): typeof fetch {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(pack))) as unknown as typeof fetch;
}

function fakeStorage(initial?: Readonly<Record<string, string>>): SessionStorageLike {
  const values = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    get: (key: string) => values.get(key) ?? null,
    set: (key: string, value: string) => { values.set(key, value); },
  };
}

/** Global overlay-open keys routed by the resolved default keymap. `i` (inventory) is excluded
 * from this table only because it's no longer a placeholder body once absorbed (Task 5) -- the
 * loop below asserts every OTHER id's placeholder status (real bodies must NOT show "Coming in a
 * later task", remaining placeholders must); inventory's own routing/rendering is covered directly
 * by `key-router.test.ts` and `inventory-overlay.test.tsx`. */
const OVERLAY_KEYS: Readonly<Record<'character-sheet' | 'map-journal' | 'codex' | 'settings' | 'help', Readonly<{ key: string; shift: boolean }>>> = {
  'character-sheet': { key: 'c', shift: false },
  'map-journal': { key: 'm', shift: false },
  codex: { key: 'x', shift: false },
  settings: { key: 'o', shift: false },
  help: { key: '?', shift: true },
};

function pressKey(chord: Readonly<{ key: string; shift: boolean }>): void {
  fireEvent.keyDown(window, { key: chord.key, shiftKey: chord.shift });
}

async function bootIntoPlay(storage: SessionStorageLike = fakeStorage()): Promise<void> {
  window.history.pushState({}, '', '/play?quickstart=1');
  render(<App fetcher={packFetcher()} storage={storage} localStorage={fakeStorage()} />);
  await screen.findByRole('grid', { name: /dungeon/i });
}

describe('registry overlay infrastructure', () => {
  it('opens and closes every non-inventory registry overlay via its routed key, from play', async () => {
    await bootIntoPlay();

    for (const [id, chord] of Object.entries(OVERLAY_KEYS)) {
      const title = OVERLAY_REGISTRY[id as keyof typeof OVERLAY_KEYS].title;
      pressKey(chord);
      const dialog = await screen.findByRole('dialog', { name: title });
      expect(dialog).toHaveAttribute('data-testid', `overlay-${id}`);
      // Every id is real content now (see settings-overlay.test.tsx, help-overlay.test.tsx,
      // character-sheet-overlay.test.tsx, map-journal-overlay.test.tsx, and codex.test.ts/
      // codex-overlay.test.tsx for each overlay's own coverage) -- no placeholder body remains.
      expect(dialog).not.toHaveTextContent('Coming in a later task');

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('dialog', { name: title })).not.toBeInTheDocument();
    }
  });

  it('opens the global overlays (Codex / Settings / Help) directly from the title screen', async () => {
    render(<App fetcher={packFetcher()} storage={fakeStorage()} localStorage={fakeStorage()} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('option', { name: 'Settings' }));
    const dialog = await screen.findByRole('dialog', { name: 'Settings' });
    expect(dialog).toHaveAttribute('data-testid', 'overlay-settings');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();

    await user.click(await screen.findByRole('option', { name: 'Codex' }));
    expect(await screen.findByRole('dialog', { name: 'Codex' })).toBeInTheDocument();
  });

  it('does not offer the play-scope overlays (Character Sheet / Map & Journal / Inventory) from the title screen', async () => {
    render(<App fetcher={packFetcher()} storage={fakeStorage()} localStorage={fakeStorage()} />);
    await screen.findByRole('option', { name: 'Codex' });

    expect(screen.queryByRole('option', { name: 'Character Sheet' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Map & Journal' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Inventory' })).not.toBeInTheDocument();
  });

  it('play-scope overlays are blocked outside play (canOpenOverlay), global-scope overlays are always allowed', () => {
    expect(canOpenOverlay(OVERLAY_REGISTRY['character-sheet'], false)).toBe(false);
    expect(canOpenOverlay(OVERLAY_REGISTRY['character-sheet'], true)).toBe(true);
    expect(canOpenOverlay(OVERLAY_REGISTRY['map-journal'], false)).toBe(false);
    expect(canOpenOverlay(OVERLAY_REGISTRY.inventory, false)).toBe(false);

    expect(canOpenOverlay(OVERLAY_REGISTRY.codex, false)).toBe(true);
    expect(canOpenOverlay(OVERLAY_REGISTRY.settings, false)).toBe(true);
    expect(canOpenOverlay(OVERLAY_REGISTRY.help, false)).toBe(true);
  });

  it('only one overlay opens at a time: the router swallows a second overlay-open key while one is already open', async () => {
    await bootIntoPlay();

    pressKey(OVERLAY_KEYS.codex);
    await screen.findByRole('dialog', { name: 'Codex' });

    pressKey(OVERLAY_KEYS.settings);
    // The second key is swallowed (routeKey returns null for anything but Escape while an overlay
    // is open) -- Codex stays open, Settings never appears.
    expect(screen.getByRole('dialog', { name: 'Codex' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();
  });

  // Regression for the same double-dispatch shape TradeScreen/BackpackMenu already guard against
  // (5C Task 7b): `OverlayScaffold`'s own Escape handler must `stopPropagation`, or the same
  // native keydown also reaches `PlayScreen`'s window-level dispatcher and calls `onCloseOverlay`
  // a second time. Composed directly against `PlayScreen` (not the full `App`) so the close
  // callback can be a bare spy, exactly like `trade-close-escape.test.tsx`.
  describe('closing a registry overlay with Escape', () => {
    function freshSession(): GuestSession {
      const storage = fakeStorage();
      return new GuestSession({ pack, storage, seed: [3, 5, 7, 9] });
    }

    it('calls onCloseOverlay exactly once, with no leak to the window dispatcher', async () => {
      const user = userEvent.setup();
      const onCloseOverlay = vi.fn();

      render(
        <PlayScreen
          session={freshSession()}
          pack={pack}
          overlay="codex"
          onOpenOverlay={() => {}}
          onCloseOverlay={onCloseOverlay}
          keymap={resolveKeymap({})}
        />,
      );
      expect(screen.getByRole('dialog', { name: 'Codex' })).toBeInTheDocument();

      await user.keyboard('{Escape}');

      expect(onCloseOverlay).toHaveBeenCalledTimes(1);
    });
  });

  describe('OverlayErrorBoundary', () => {
    function Boom(): JSX.Element {
      throw new Error('overlay body exploded');
    }

    class Silence extends Component<{ children: ReactNode }> {
      public override componentDidCatch(): void {
        // Swallow -- OverlayErrorBoundary itself is the thing under test; this wrapper only
        // exists so React's own dev-mode console noise for the thrown error doesn't pollute test
        // output. (OverlayErrorBoundary catches first; this never actually engages.)
      }

      public override render(): ReactNode {
        return this.props.children;
      }
    }

    it('catches a throwing overlay body, shows the bug alert, and leaves a sibling "play surface" mounted', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      render(
        <Silence>
          <div data-testid="play-surface">the run is unaffected</div>
          <OverlayErrorBoundary>
            <Boom />
          </OverlayErrorBoundary>
        </Silence>,
      );

      expect(screen.getByTestId('play-surface')).toHaveTextContent('the run is unaffected');
      expect(screen.getByRole('alert')).toHaveTextContent(/hit a bug.*Esc to close.*run is unaffected/i);

      consoleError.mockRestore();
    });
  });

  describe('font-scale and reduced-motion settings applied at the app root', () => {
    it('applies fontScale as an inline calc(1rem * scale) style, and reducedMotion "on" as a motion-reduced class', async () => {
      const settings: Settings = { fontScale: 1.3, reducedMotion: 'on', theme: 'tapestry', lighting: 'smooth', bindings: {} };
      const localStorage = fakeStorage({ [SETTINGS_KEY]: JSON.stringify(settings) });

      const { container } = render(
        <App fetcher={packFetcher()} storage={fakeStorage()} localStorage={localStorage} />,
      );
      await screen.findByRole('option', { name: /enter the deep/i });

      const root = container.firstElementChild as HTMLElement;
      expect(root.className).toMatch(/\bmotion-reduced\b/);
      // jsdom's `cssstyle` simplifies `calc(1rem * 1.3)` down to `calc(1.3rem)` as soon as it's
      // set (both at the attribute and the CSSOM level) -- assert the SCALE actually reached the
      // inline style rather than pinning the pre-simplification source text.
      expect(root.style.fontSize).toBe('calc(1.3rem)');
    });

    it('applies neither motion class when reducedMotion is "system" (defers to the OS media query)', async () => {
      const settings: Settings = { fontScale: 1, reducedMotion: 'system', theme: 'tapestry', lighting: 'smooth', bindings: {} };
      const localStorage = fakeStorage({ [SETTINGS_KEY]: JSON.stringify(settings) });

      const { container } = render(
        <App fetcher={packFetcher()} storage={fakeStorage()} localStorage={localStorage} />,
      );
      await screen.findByRole('option', { name: /enter the deep/i });

      const root = container.firstElementChild as HTMLElement;
      expect(root.className).not.toMatch(/\bmotion-reduced\b/);
      expect(root.className).not.toMatch(/\bmotion-full\b/);
    });

    it('applies no theme class when theme is "tapestry" (the default palette needs no override)', async () => {
      const settings: Settings = { fontScale: 1, reducedMotion: 'system', theme: 'tapestry', lighting: 'smooth', bindings: {} };
      const localStorage = fakeStorage({ [SETTINGS_KEY]: JSON.stringify(settings) });

      const { container } = render(
        <App fetcher={packFetcher()} storage={fakeStorage()} localStorage={localStorage} />,
      );
      await screen.findByRole('option', { name: /enter the deep/i });

      const root = container.firstElementChild as HTMLElement;
      expect(root.className).not.toMatch(/\btheme-high-contrast\b/);
    });

    it('applies the theme-high-contrast class at the app root when theme is "high-contrast"', async () => {
      const settings: Settings = { fontScale: 1, reducedMotion: 'system', theme: 'high-contrast', lighting: 'smooth', bindings: {} };
      const localStorage = fakeStorage({ [SETTINGS_KEY]: JSON.stringify(settings) });

      const { container } = render(
        <App fetcher={packFetcher()} storage={fakeStorage()} localStorage={localStorage} />,
      );
      await screen.findByRole('option', { name: /enter the deep/i });

      const root = container.firstElementChild as HTMLElement;
      expect(root.className).toMatch(/\btheme-high-contrast\b/);
    });

    it('applies the motion-full class when reducedMotion is "off", so a guest can force animations back on over an OS-level reduced-motion preference', async () => {
      const settings: Settings = { fontScale: 1, reducedMotion: 'off', theme: 'tapestry', lighting: 'smooth', bindings: {} };
      const localStorage = fakeStorage({ [SETTINGS_KEY]: JSON.stringify(settings) });

      const { container } = render(
        <App fetcher={packFetcher()} storage={fakeStorage()} localStorage={localStorage} />,
      );
      await screen.findByRole('option', { name: /enter the deep/i });

      const root = container.firstElementChild as HTMLElement;
      expect(root.className).toMatch(/\bmotion-full\b/);
      expect(root.className).not.toMatch(/\bmotion-reduced\b/);
    });
  });
});
