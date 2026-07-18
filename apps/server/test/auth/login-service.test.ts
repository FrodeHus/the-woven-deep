import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/database.js';
import { LoginTokenRepository } from '../../src/db/login-token-repository.js';
import { createLoginService } from '../../src/auth/login-service.js';
import { createMailTransport } from '../../src/auth/mail-transport.js';
import { generateToken, hashToken } from '../../src/auth/tokens.js';
import { normalizeEmail } from '../../src/auth/email.js';
import type { Clock } from '../../src/auth/rate-limiter.js';
import type { AuthConfig } from '../../src/config.js';

class FakeClock implements Clock {
  private current: Date;

  constructor(start: string) {
    this.current = new Date(start);
  }

  now(): Date {
    return this.current;
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

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

function freshDatabase(): Database.Database {
  const database = new Database(':memory:');
  runMigrations(database);
  return database;
}

function extractToken(link: string): string {
  const url = new URL(link);
  const token = url.searchParams.get('token');
  if (token === null) {
    throw new Error('link had no token parameter');
  }
  return token;
}

describe('createLoginService.request', () => {
  let database: Database.Database;
  let tokens: LoginTokenRepository;

  beforeEach(() => {
    database = freshDatabase();
    tokens = new LoginTokenRepository(database);
  });

  it('inserts exactly one token row whose hash matches the sent link token, not the plaintext, with a 15-minute expiry', async () => {
    const clock = new FakeClock('2026-07-17T00:00:00.000Z');
    const config = authConfig();
    const transport = createMailTransport(config);
    const service = createLoginService({
      clock,
      tokens,
      transport,
      config,
      generateToken,
      hashToken,
    });

    await service.request({ email: 'Player@Example.com', sourceAddress: '203.0.113.1' });

    const link = transport.lastLinkFor?.('Player@Example.com');
    expect(link).toBeDefined();
    const sentToken = extractToken(link as string);

    const row = database.prepare('select * from login_tokens').all() as Array<{
      token_hash: string;
      normalized_email: string;
      expires_at: string;
      created_at: string;
    }>;
    expect(row).toHaveLength(1);
    expect(row[0].token_hash).toBe(hashToken(sentToken));
    expect(row[0].token_hash).not.toBe(sentToken);
    expect(row[0].normalized_email).toBe('player@example.com');
    expect(row[0].created_at).toBe('2026-07-17T00:00:00.000Z');
    expect(row[0].expires_at).toBe('2026-07-17T00:15:00.000Z');
  });

  it('resolves uniformly and inserts no row and sends no link once the per-email rate limit is exceeded', async () => {
    const clock = new FakeClock('2026-07-17T00:00:00.000Z');
    const config = authConfig({ loginRateLimit: { perEmailPerHour: 1, perSourcePerHour: 20 } });
    const transport = createMailTransport(config);
    const service = createLoginService({
      clock,
      tokens,
      transport,
      config,
      generateToken,
      hashToken,
    });

    await service.request({ email: 'a@example.com', sourceAddress: '203.0.113.1' });
    await expect(
      service.request({ email: 'a@example.com', sourceAddress: '203.0.113.2' }),
    ).resolves.toBeUndefined();

    const rows = database.prepare('select * from login_tokens').all();
    expect(rows).toHaveLength(1);
    expect(transport.lastLinkFor?.('a@example.com')).toBeDefined();

    // second request should not have replaced the first link (no new send occurred)
    const firstLink = transport.lastLinkFor?.('a@example.com');
    await service.request({ email: 'a@example.com', sourceAddress: '203.0.113.3' });
    expect(transport.lastLinkFor?.('a@example.com')).toBe(firstLink);
  });

  it('resolves uniformly and inserts no row once the per-source rate limit is exceeded', async () => {
    const clock = new FakeClock('2026-07-17T00:00:00.000Z');
    const config = authConfig({ loginRateLimit: { perEmailPerHour: 20, perSourcePerHour: 1 } });
    const transport = createMailTransport(config);
    const service = createLoginService({
      clock,
      tokens,
      transport,
      config,
      generateToken,
      hashToken,
    });

    await service.request({ email: 'b@example.com', sourceAddress: '203.0.113.9' });
    await expect(
      service.request({ email: 'c@example.com', sourceAddress: '203.0.113.9' }),
    ).resolves.toBeUndefined();

    const rows = database.prepare('select * from login_tokens').all();
    expect(rows).toHaveLength(1);
    expect(transport.lastLinkFor?.('c@example.com')).toBeUndefined();
  });

  it('still resolves uniformly when the transport rejects', async () => {
    const clock = new FakeClock('2026-07-17T00:00:00.000Z');
    const config = authConfig();
    const failingTransport = {
      async sendLoginLink(): Promise<void> {
        throw new Error('smtp exploded');
      },
    };
    const service = createLoginService({
      clock,
      tokens,
      transport: failingTransport,
      config,
      generateToken,
      hashToken,
    });

    await expect(
      service.request({ email: 'd@example.com', sourceAddress: '203.0.113.10' }),
    ).resolves.toBeUndefined();

    const rows = database.prepare('select * from login_tokens').all();
    expect(rows).toHaveLength(1);
  });
});

describe('normalizeEmail', () => {
  it('trims surrounding whitespace and lowercases', () => {
    expect(normalizeEmail('  Player@Example.com  ')).toBe('player@example.com');
  });

  it('folds distinct-but-canonically-equivalent Unicode compositions to the same value', () => {
    const decomposed = 'a\u0308@example.com'; // 'a' + combining diaeresis (NFD)
    const precomposed = '\u00e4@example.com'; // precomposed (NFC)

    expect(decomposed).not.toBe(precomposed);
    expect(normalizeEmail(decomposed)).toBe(normalizeEmail(precomposed));
  });
});
