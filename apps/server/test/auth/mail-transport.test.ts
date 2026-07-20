import { describe, expect, it, vi } from 'vitest';
import { createMailTransport } from '../../src/auth/mail-transport.js';
import type { AuthConfig } from '../../src/config.js';

function authConfig(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    publicUrl: 'http://localhost:3000',
    cookieSecret: 'a'.repeat(32),
    cookieSecure: false,
    mailgun: null,
    loginRateLimit: { perEmailPerHour: 5, perSourcePerHour: 20 },
    ...overrides,
  };
}

describe('createMailTransport dev transport', () => {
  it('returns the dev transport when mailgun is null', () => {
    const transport = createMailTransport(authConfig({ mailgun: null }));

    expect(typeof transport.lastLinkFor).toBe('function');
  });

  it('stores and returns the last link per email, and a second link overwrites the first', async () => {
    const transport = createMailTransport(authConfig({ mailgun: null }));

    await transport.sendLoginLink({
      email: 'Player@Example.com',
      link: 'http://localhost:3000/verify?token=one',
    });
    expect(transport.lastLinkFor?.('Player@Example.com')).toBe(
      'http://localhost:3000/verify?token=one',
    );
    expect(transport.lastLinkFor?.('player@example.com')).toBe(
      'http://localhost:3000/verify?token=one',
    );

    await transport.sendLoginLink({
      email: 'player@example.com',
      link: 'http://localhost:3000/verify?token=two',
    });
    expect(transport.lastLinkFor?.('Player@Example.com')).toBe(
      'http://localhost:3000/verify?token=two',
    );
  });

  it('returns undefined for an email with no stored link', () => {
    const transport = createMailTransport(authConfig({ mailgun: null }));

    expect(transport.lastLinkFor?.('nobody@example.com')).toBeUndefined();
  });

  it('resolves immediately without a fetch implementation', async () => {
    const transport = createMailTransport(authConfig({ mailgun: null }));

    await expect(
      transport.sendLoginLink({
        email: 'a@example.com',
        link: 'http://localhost:3000/verify?token=x',
      }),
    ).resolves.toBeUndefined();
  });
});

describe('createMailTransport mailgun transport', () => {
  const mailgunConfig = authConfig({
    mailgun: {
      apiKey: 'key-123',
      domain: 'mail.example.com',
      sender: 'Woven Deep <noreply@mail.example.com>',
    },
  });

  it('does not expose lastLinkFor', () => {
    const transport = createMailTransport(mailgunConfig, vi.fn());

    expect(transport.lastLinkFor).toBeUndefined();
  });

  it('issues one POST to the domain messages endpoint with Basic auth and form fields', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    const transport = createMailTransport(mailgunConfig, fetchImpl as unknown as typeof fetch);

    await transport.sendLoginLink({
      email: 'player@example.com',
      link: 'http://localhost:3000/verify?token=abc',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.mailgun.net/v3/mail.example.com/messages');
    expect(init.method).toBe('POST');

    const headers = init.headers as Record<string, string>;
    const expectedAuth = `Basic ${Buffer.from('api:key-123').toString('base64')}`;
    expect(headers['Authorization']).toBe(expectedAuth);
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');

    const body = new URLSearchParams(init.body as string);
    expect(body.get('from')).toBe('Woven Deep <noreply@mail.example.com>');
    expect(body.get('to')).toBe('player@example.com');
    expect(body.get('subject')).toBeTruthy();
    expect(body.get('text')).toContain('http://localhost:3000/verify?token=abc');
  });

  it('throws on a non-2xx response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    } as Response);
    const transport = createMailTransport(mailgunConfig, fetchImpl as unknown as typeof fetch);

    await expect(
      transport.sendLoginLink({
        email: 'player@example.com',
        link: 'http://localhost:3000/verify?token=abc',
      }),
    ).rejects.toThrow();
  });
});
