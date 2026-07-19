import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSettingsRoaming } from '../src/ui/hooks/useSettingsRoaming.js';
import type { AccountState } from '../src/session/account.js';
import { DEFAULT_SETTINGS, SETTINGS_KEY, type Settings } from '../src/session/settings.js';
import type { SessionStorageLike } from '../src/session/storage.js';

const GUEST: AccountState = { status: 'guest', email: null, csrfToken: null };
const SIGNED_IN: AccountState = { status: 'signed-in', email: 'player@example.com', csrfToken: 'tok' };

afterEach(() => {
  vi.useRealTimers();
});

function fakeLocalStorage(): SessionStorageLike & { peek(): string | null } {
  const values = new Map<string, string>();
  return {
    get: (key: string) => values.get(key) ?? null,
    set: (key: string, value: string) => { values.set(key, value); },
    peek: () => values.get(SETTINGS_KEY) ?? null,
  };
}

/** Route by URL: `/api/profile/settings` GET returns `profileGet`, and every PUT to it is
 * recorded into `puts` and answered with `{ ok: true }`. Mirrors `settings-roaming.test.tsx`'s
 * `routedFetcher`, scoped to just this endpoint since these tests never touch the content pack. */
function routedFetcher(
  profileGet: { settings: string | null; settingsVersion: number },
  puts: Array<{ body: unknown; csrfToken: string | null }>,
): typeof fetch {
  return vi.fn((_url: unknown, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      const headers = init.headers as Record<string, string> | undefined;
      puts.push({ body: JSON.parse(init.body as string), csrfToken: headers?.['x-csrf-token'] ?? null });
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify(profileGet), { status: 200 }));
  }) as unknown as typeof fetch;
}

describe('useSettingsRoaming', () => {
  it('pushSettings is a no-op (no timer, no PUT) while the account is a guest', async () => {
    const puts: Array<{ body: unknown; csrfToken: string | null }> = [];
    const fetcher = routedFetcher({ settings: null, settingsVersion: 0 }, puts);
    const localStorage = fakeLocalStorage();
    const setSettings = vi.fn();

    const { result } = renderHook(() => useSettingsRoaming(GUEST, fetcher, DEFAULT_SETTINGS, localStorage, setSettings));

    vi.useFakeTimers();
    result.current.pushSettings({ ...DEFAULT_SETTINGS, theme: 'high-contrast' });
    await vi.advanceTimersByTimeAsync(1000);

    expect(puts).toHaveLength(0);
  });

  it('pushSettings debounces trailing-edge: rapid-fire calls collapse into exactly one PUT, 500ms after the LAST call', async () => {
    const puts: Array<{ body: unknown; csrfToken: string | null }> = [];
    // A non-empty server profile: the roam-on-sign-in effect adopts it (no PUT of its own), so
    // every PUT captured below comes from `pushSettings` alone.
    const fetcher = routedFetcher({ settings: JSON.stringify(DEFAULT_SETTINGS), settingsVersion: 1 }, puts);
    const localStorage = fakeLocalStorage();
    const setSettings = vi.fn();

    const { result } = renderHook(() => useSettingsRoaming(SIGNED_IN, fetcher, DEFAULT_SETTINGS, localStorage, setSettings));
    await waitFor(() => expect(setSettings).toHaveBeenCalled());

    vi.useFakeTimers();
    result.current.pushSettings({ ...DEFAULT_SETTINGS, fontScale: 1.15 });
    await vi.advanceTimersByTimeAsync(300);
    result.current.pushSettings({ ...DEFAULT_SETTINGS, fontScale: 1.3 });
    await vi.advanceTimersByTimeAsync(300);
    // 600ms elapsed since the first call, but only 300ms since the second (resetting) call --
    // the timer must not have fired yet.
    expect(puts).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(200);
    expect(puts).toHaveLength(1);
    const put = puts[0]!;
    expect(JSON.parse((put.body as { settingsJson: string }).settingsJson)).toEqual(
      expect.objectContaining({ fontScale: 1.3 }),
    );
    expect(put.csrfToken).toBe('tok');
    // Roam adopted the server's version (1) first; this push is the next count up.
    expect((put.body as { settingsVersion: number }).settingsVersion).toBe(2);
  });

  it('pushSettings version counter is monotonic across successive debounced pushes, seeded from the roamed server version', async () => {
    const puts: Array<{ body: unknown; csrfToken: string | null }> = [];
    // Non-empty server profile at version 10: roam adopts it (no PUT), seeding
    // `settingsVersionRef` to 10 -- the next two pushes must count up from there (11, 12).
    const fetcher = routedFetcher({ settings: JSON.stringify(DEFAULT_SETTINGS), settingsVersion: 10 }, puts);
    const localStorage = fakeLocalStorage();
    const setSettings = vi.fn();

    const { result } = renderHook(() => useSettingsRoaming(SIGNED_IN, fetcher, DEFAULT_SETTINGS, localStorage, setSettings));
    await waitFor(() => expect(setSettings).toHaveBeenCalled());

    vi.useFakeTimers();
    result.current.pushSettings(DEFAULT_SETTINGS);
    await vi.advanceTimersByTimeAsync(500);
    result.current.pushSettings({ ...DEFAULT_SETTINGS, fontScale: 1.5 });
    await vi.advanceTimersByTimeAsync(500);

    expect(puts).toHaveLength(2);
    expect((puts[0]!.body as { settingsVersion: number }).settingsVersion).toBe(11);
    expect((puts[1]!.body as { settingsVersion: number }).settingsVersion).toBe(12);
  });

  it('roam-on-sign-in: a non-empty server profile is adopted (server-wins) and written to localStorage, without triggering a PUT', async () => {
    const puts: Array<{ body: unknown; csrfToken: string | null }> = [];
    const fetcher = routedFetcher({ settings: JSON.stringify({ theme: 'high-contrast' }), settingsVersion: 5 }, puts);
    const localStorage = fakeLocalStorage();
    const setSettings = vi.fn();

    renderHook(() => useSettingsRoaming(SIGNED_IN, fetcher, DEFAULT_SETTINGS, localStorage, setSettings));

    await waitFor(() => expect(setSettings).toHaveBeenCalled());
    expect(setSettings).toHaveBeenCalledWith(expect.objectContaining({ theme: 'high-contrast' }));
    await waitFor(() => expect(localStorage.peek()).not.toBeNull());
    expect(JSON.parse(localStorage.peek()!)).toEqual(expect.objectContaining({ theme: 'high-contrast' }));
    expect(puts).toHaveLength(0);
  });

  it('roam-on-sign-in: an empty server profile seeds the server with the current local settings (one PUT)', async () => {
    const puts: Array<{ body: unknown; csrfToken: string | null }> = [];
    const fetcher = routedFetcher({ settings: null, settingsVersion: 0 }, puts);
    const localStorage = fakeLocalStorage();
    const setSettings = vi.fn();
    const settings: Settings = { ...DEFAULT_SETTINGS, fontScale: 1.3 };

    renderHook(() => useSettingsRoaming(SIGNED_IN, fetcher, settings, localStorage, setSettings));

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(JSON.parse((puts[0]!.body as { settingsJson: string }).settingsJson)).toEqual(settings);
    expect(setSettings).not.toHaveBeenCalled();
  });

  it('roam-on-sign-in fires exactly once per sign-in: rerendering with the same signed-in account does not re-seed', async () => {
    const puts: Array<{ body: unknown; csrfToken: string | null }> = [];
    const fetcher = routedFetcher({ settings: null, settingsVersion: 0 }, puts);
    const localStorage = fakeLocalStorage();
    const setSettings = vi.fn();

    const { rerender } = renderHook(
      ({ account }: { account: AccountState }) => useSettingsRoaming(account, fetcher, DEFAULT_SETTINGS, localStorage, setSettings),
      { initialProps: { account: SIGNED_IN } },
    );

    await waitFor(() => expect(puts).toHaveLength(1));
    rerender({ account: SIGNED_IN });
    rerender({ account: { ...SIGNED_IN } });

    // Give any accidental re-fire a chance to land before asserting it never happened.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(puts).toHaveLength(1);
  });

  it('roam-on-sign-in re-fires on a later sign-in after a drop to guest (the once-guard resets)', async () => {
    const puts: Array<{ body: unknown; csrfToken: string | null }> = [];
    const fetcher = routedFetcher({ settings: null, settingsVersion: 0 }, puts);
    const localStorage = fakeLocalStorage();
    const setSettings = vi.fn();

    const { rerender } = renderHook(
      ({ account }: { account: AccountState }) => useSettingsRoaming(account, fetcher, DEFAULT_SETTINGS, localStorage, setSettings),
      { initialProps: { account: SIGNED_IN } },
    );
    await waitFor(() => expect(puts).toHaveLength(1));

    rerender({ account: GUEST });
    rerender({ account: SIGNED_IN });

    await waitFor(() => expect(puts).toHaveLength(2));
  });

  it('a corrupt server settings blob falls back to defaults via settingsFromJson rather than crashing', async () => {
    const puts: Array<{ body: unknown; csrfToken: string | null }> = [];
    const fetcher = routedFetcher({ settings: 'not json{{{', settingsVersion: 9 }, puts);
    const localStorage = fakeLocalStorage();
    const setSettings = vi.fn();

    renderHook(() => useSettingsRoaming(SIGNED_IN, fetcher, DEFAULT_SETTINGS, localStorage, setSettings));

    await waitFor(() => expect(setSettings).toHaveBeenCalled());
    expect(setSettings).toHaveBeenCalledWith(DEFAULT_SETTINGS);
  });

  it('a roam-fetch network failure is swallowed: no throw, and settings/PUTs are left untouched', async () => {
    const fetcher = vi.fn(() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    const localStorage = fakeLocalStorage();
    const setSettings = vi.fn();

    expect(() => {
      renderHook(() => useSettingsRoaming(SIGNED_IN, fetcher, DEFAULT_SETTINGS, localStorage, setSettings));
    }).not.toThrow();

    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    // Give the rejected promise's catch a tick to run.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(setSettings).not.toHaveBeenCalled();
    expect(localStorage.peek()).toBeNull();
  });
});
