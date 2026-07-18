import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { App } from '../src/App.js';
import type { AccountState } from '../src/session/account.js';
import { DEFAULT_SETTINGS, SETTINGS_KEY } from '../src/session/settings.js';
import type { SessionStorageLike } from '../src/session/storage.js';

let pack: CompiledContentPack;

const SIGNED_IN_ACCOUNT: AccountState = { status: 'signed-in', email: 'player@example.com', csrfToken: 'tok' };

beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
});

afterEach(() => {
  window.history.replaceState({}, '', '/');
  vi.useRealTimers();
});

function fakeStorage(initial?: Readonly<Record<string, string>>): SessionStorageLike & { peek(key: string): string | null } {
  const values = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    get: (key: string) => values.get(key) ?? null,
    set: (key: string, value: string) => { values.set(key, value); },
    peek: (key: string) => values.get(key) ?? null,
  };
}

/** Route by URL: pack/health hit the real content endpoints, `/api/profile/settings` GET returns
 * `profileGet`, and every PUT to it is recorded into `puts` and answered with `{ ok: true }`. */
function routedFetcher(
  profileGet: { settings: string | null; settingsVersion: number },
  puts: Array<{ body: unknown; csrfToken: string | null }>,
): typeof fetch {
  return vi.fn((url: unknown, init?: RequestInit) => {
    const path = typeof url === 'string' ? url : (url as Request).url;
    if (path.includes('/api/profile/settings')) {
      if (init?.method === 'PUT') {
        const headers = init.headers as Record<string, string> | undefined;
        puts.push({ body: JSON.parse(init.body as string), csrfToken: headers?.['x-csrf-token'] ?? null });
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify(profileGet), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify(pack), { status: 200 }));
  }) as unknown as typeof fetch;
}

describe('settings roaming (Task 12)', () => {
  it('signing in when the server holds {"theme":"high-contrast"} adopts it into live settings and the localStorage cache (server-wins)', async () => {
    const localStorage = fakeStorage();
    const puts: Array<{ body: unknown; csrfToken: string | null }> = [];
    const fetcher = routedFetcher(
      { settings: JSON.stringify({ theme: 'high-contrast' }), settingsVersion: 5 },
      puts,
    );

    const { container } = render(
      <App fetcher={fetcher} storage={fakeStorage()} localStorage={localStorage} accountOverride={SIGNED_IN_ACCOUNT} />,
    );
    await screen.findByText(/signed in as/i);

    await waitFor(() => {
      const root = container.firstElementChild as HTMLElement;
      expect(root.className).toMatch(/\btheme-high-contrast\b/);
    });

    const cached = JSON.parse(localStorage.peek(SETTINGS_KEY)!) as { theme: string };
    expect(cached.theme).toBe('high-contrast');
    // Adopting is one-way from the server -- it must never itself trigger a PUT back.
    expect(puts).toHaveLength(0);
  });

  it('signing in when the server is empty pushes the current local settings up (one putProfileSettings with the local blob)', async () => {
    const localStorage = fakeStorage();
    const puts: Array<{ body: unknown; csrfToken: string | null }> = [];
    const fetcher = routedFetcher({ settings: null, settingsVersion: 0 }, puts);

    render(
      <App fetcher={fetcher} storage={fakeStorage()} localStorage={localStorage} accountOverride={SIGNED_IN_ACCOUNT} />,
    );
    await screen.findByText(/signed in as/i);

    await waitFor(() => expect(puts).toHaveLength(1));
    const seedPut = puts[0]!;
    expect(JSON.parse((seedPut.body as { settingsJson: string }).settingsJson)).toEqual(DEFAULT_SETTINGS);
    expect(seedPut.csrfToken).toBe('tok');
  });

  it('a settings change while signed in triggers exactly one debounced putProfileSettings carrying the new blob + csrf, plus a localStorage write', async () => {
    window.history.pushState({}, '', '/play?quickstart=1');
    const localStorage = fakeStorage();
    const puts: Array<{ body: unknown; csrfToken: string | null }> = [];
    // Empty server: the roam effect will seed it once at boot; that seed PUT is asserted away from
    // the change-triggered PUT below by index.
    const fetcher = routedFetcher({ settings: null, settingsVersion: 0 }, puts);

    render(
      <App fetcher={fetcher} storage={fakeStorage()} localStorage={localStorage} accountOverride={SIGNED_IN_ACCOUNT} />,
    );
    await screen.findByRole('grid', { name: /dungeon/i });
    // Let the boot-time roam-seed PUT land before exercising the change-driven debounce below.
    await waitFor(() => expect(puts).toHaveLength(1));

    const { fireEvent } = await import('@testing-library/react');
    fireEvent.keyDown(window, { key: 'o' });
    await screen.findByRole('dialog', { name: 'Settings' });

    // Fake timers only from here on -- opening the dialog above needed real timers/microtasks.
    // `shouldAdvanceTime: true` lets the fake clock auto-track real elapsed time for the Select's
    // own internal (near-zero) timeouts, while `vi.advanceTimersByTimeAsync` below still drives
    // the debounce timer deterministically.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole('combobox', { name: /theme/i }));
    await user.click(await screen.findByRole('option', { name: /high contrast/i }));

    // Not yet -- the debounce hasn't elapsed.
    expect(puts).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(500);

    expect(puts).toHaveLength(2);
    const changePut = puts[1]!;
    expect(JSON.parse((changePut.body as { settingsJson: string }).settingsJson)).toEqual(
      expect.objectContaining({ theme: 'high-contrast' }),
    );
    expect(changePut.csrfToken).toBe('tok');
    const cached = JSON.parse(localStorage.peek(SETTINGS_KEY)!) as { theme: string };
    expect(cached.theme).toBe('high-contrast');
  });

  it('a settings change while guest does not call the server', async () => {
    window.history.pushState({}, '', '/play?quickstart=1');
    const localStorage = fakeStorage();
    const puts: Array<{ body: unknown; csrfToken: string | null }> = [];
    const fetcher = routedFetcher({ settings: null, settingsVersion: 0 }, puts);

    render(<App fetcher={fetcher} storage={fakeStorage()} localStorage={localStorage} />);
    await screen.findByRole('grid', { name: /dungeon/i });

    const { fireEvent } = await import('@testing-library/react');
    fireEvent.keyDown(window, { key: 'o' });
    await screen.findByRole('dialog', { name: 'Settings' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: /theme/i }));
    await user.click(await screen.findByRole('option', { name: /high contrast/i }));

    await new Promise((r) => setTimeout(r, 600));
    expect(puts).toHaveLength(0);
    const cached = JSON.parse(localStorage.peek(SETTINGS_KEY)!) as { theme: string };
    expect(cached.theme).toBe('high-contrast');
  });

  it('a corrupt server blob falls back to defaults via the existing loader path without crashing', async () => {
    const localStorage = fakeStorage();
    const puts: Array<{ body: unknown; csrfToken: string | null }> = [];
    const fetcher = routedFetcher({ settings: 'not json{{{', settingsVersion: 9 }, puts);

    render(
      <App fetcher={fetcher} storage={fakeStorage()} localStorage={localStorage} accountOverride={SIGNED_IN_ACCOUNT} />,
    );

    expect(await screen.findByRole('option', { name: /enter the deep/i })).toBeInTheDocument();
    await waitFor(() => {
      const cached = localStorage.peek(SETTINGS_KEY);
      expect(cached).not.toBeNull();
    });
    const cached = JSON.parse(localStorage.peek(SETTINGS_KEY)!);
    expect(cached).toEqual(DEFAULT_SETTINGS);
  });
});
