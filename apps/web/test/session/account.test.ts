import { describe, expect, it, vi } from 'vitest';
import {
  requestLogin,
  fetchSession,
  logout,
  fetchProfileSettings,
  putProfileSettings,
} from '../../src/api.js';
import { GUEST_ACCOUNT, loadAccount } from '../../src/session/account.js';

describe('requestLogin', () => {
  it('posts the email to /api/auth/login and resolves on 200', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await expect(
      requestLogin('player@example.com', fetcher as unknown as typeof fetch),
    ).resolves.toBeUndefined();

    expect(fetcher).toHaveBeenCalledWith(
      '/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'player@example.com' }),
      }),
    );
  });
});

describe('fetchSession', () => {
  it('maps a 401 to authenticated:false', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ authenticated: false }), { status: 401 }),
      );

    const info = await fetchSession(fetcher as unknown as typeof fetch);

    expect(info).toEqual({ authenticated: false });
    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(init?.credentials).toBe('same-origin');
  });

  it('maps a 200 to authenticated:true with email and csrfToken', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ authenticated: true, email: 'player@example.com', csrfToken: 'tok' }),
          { status: 200 },
        ),
      );

    const info = await fetchSession(fetcher as unknown as typeof fetch);

    expect(info).toEqual({ authenticated: true, email: 'player@example.com', csrfToken: 'tok' });
  });
});

describe('logout', () => {
  it('sends the x-csrf-token header and same-origin credentials', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await logout('csrf-tok', fetcher as unknown as typeof fetch);

    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/auth/logout');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['x-csrf-token']).toBe('csrf-tok');
    expect(init?.credentials).toBe('same-origin');
  });
});

describe('fetchProfileSettings', () => {
  it('maps {settings, settingsVersion} to {settingsJson, settingsVersion}', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ settings: '{"a":1}', settingsVersion: 3 }), { status: 200 }),
      );

    const result = await fetchProfileSettings(fetcher as unknown as typeof fetch);

    expect(result).toEqual({ settingsJson: '{"a":1}', settingsVersion: 3 });
    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(init?.credentials).toBe('same-origin');
  });

  it('returns the empty marker on a non-200 without parsing the body', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('unauthorized', { status: 401 }));

    const result = await fetchProfileSettings(fetcher as unknown as typeof fetch);

    expect(result).toEqual({ settingsJson: null, settingsVersion: 0 });
  });
});

describe('putProfileSettings', () => {
  it('sends the header and body and maps a 200 to ok:true', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const result = await putProfileSettings(
      { settingsJson: '{"a":1}', settingsVersion: 3, csrfToken: 'csrf-tok' },
      fetcher as unknown as typeof fetch,
    );

    expect(result).toEqual({ ok: true });
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/profile/settings');
    expect(init?.method).toBe('PUT');
    expect(init?.body).toBe(JSON.stringify({ settingsJson: '{"a":1}', settingsVersion: 3 }));
    expect((init?.headers as Record<string, string>)['x-csrf-token']).toBe('csrf-tok');
    expect(init?.credentials).toBe('same-origin');
  });

  it('maps a non-200 response to ok:false', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'stale' }), { status: 400 }));

    const result = await putProfileSettings(
      { settingsJson: '{"a":1}', settingsVersion: 3, csrfToken: 'csrf-tok' },
      fetcher as unknown as typeof fetch,
    );

    expect(result).toEqual({ ok: false });
  });
});

describe('loadAccount', () => {
  it('returns GUEST_ACCOUNT on a 401', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ authenticated: false }), { status: 401 }),
      );

    const account = await loadAccount(fetcher as unknown as typeof fetch);

    expect(account).toEqual(GUEST_ACCOUNT);
  });

  it('returns a signed-in state on a 200, defaulting unlockedClassIds to [] when absent', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ authenticated: true, email: 'player@example.com', csrfToken: 'tok' }),
          { status: 200 },
        ),
      );

    const account = await loadAccount(fetcher as unknown as typeof fetch);

    expect(account).toEqual({
      status: 'signed-in',
      email: 'player@example.com',
      csrfToken: 'tok',
      unlockedClassIds: [],
    });
  });

  it('maps unlockedClassIds from the session payload when present', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          authenticated: true,
          email: 'player@example.com',
          csrfToken: 'tok',
          unlockedClassIds: ['class.warden'],
        }),
        { status: 200 },
      ),
    );

    const account = await loadAccount(fetcher as unknown as typeof fetch);

    expect(account.unlockedClassIds).toEqual(['class.warden']);
  });
});
