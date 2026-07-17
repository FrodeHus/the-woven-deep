import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readConfig } from '../src/config.js';

describe('readConfig', () => {
  it('resolves local defaults independently of the process working directory', () => {
    const originalCwd = process.cwd();
    const repositoryRoot = resolve(import.meta.dirname, '../../..');

    try {
      process.chdir(import.meta.dirname);
      const fromServerTestDirectory = readConfig({});
      process.chdir(repositoryRoot);
      const fromRepositoryRoot = readConfig({});

      expect(fromServerTestDirectory).toEqual(fromRepositoryRoot);
      expect(fromRepositoryRoot.databasePath).toBe(resolve(repositoryRoot, 'data/rogue.sqlite'));
      expect(fromRepositoryRoot.contentDir).toBe(resolve(repositoryRoot, 'content'));
      expect(fromRepositoryRoot.webDistDir).toBe(resolve(repositoryRoot, 'apps/web/dist'));
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('resolves explicit production path overrides unchanged', () => {
    expect(readConfig({
      DATABASE_PATH: '/data/rogue.sqlite',
      CONTENT_DIR: '/app/content',
      WEB_DIST_DIR: '/app/apps/web/dist',
    })).toMatchObject({
      databasePath: '/data/rogue.sqlite',
      contentDir: '/app/content',
      webDistDir: '/app/apps/web/dist',
    });
  });

  it('rejects invalid ports', () => {
    expect(() => readConfig({ PORT: '0' })).toThrow('PORT must be an integer from 1 to 65535');
    expect(() => readConfig({ PORT: '65536' })).toThrow('PORT must be an integer from 1 to 65535');
    expect(() => readConfig({ PORT: '3.14' })).toThrow('PORT must be an integer from 1 to 65535');
  });
});

describe('readConfig auth', () => {
  it('defaults to a localhost public URL with a dev cookie secret, no mailgun, and insecure cookies', () => {
    const config = readConfig({});

    expect(config.auth.publicUrl).toBe('http://localhost:3000');
    expect(config.auth.cookieSecret.length).toBeGreaterThanOrEqual(32);
    expect(config.auth.cookieSecure).toBe(false);
    expect(config.auth.mailgun).toBeNull();
    expect(config.auth.loginRateLimit).toEqual({ perEmailPerHour: 5, perSourcePerHour: 20 });
  });

  it('accepts a 127.0.0.1 public URL with no cookie secret configured', () => {
    const config = readConfig({ PUBLIC_URL: 'http://127.0.0.1:3000' });

    expect(config.auth.cookieSecret.length).toBeGreaterThanOrEqual(32);
    expect(config.auth.mailgun).toBeNull();
  });

  it('derives cookieSecure from the public URL scheme', () => {
    const config = readConfig({
      PUBLIC_URL: 'https://localhost:3000',
    });

    expect(config.auth.cookieSecure).toBe(true);
  });

  it('rejects a public URL that does not parse as an http(s) URL', () => {
    expect(() => readConfig({ PUBLIC_URL: 'not-a-url' })).toThrow();
    expect(() => readConfig({ PUBLIC_URL: 'ftp://example.com' })).toThrow();
  });

  const fullMailgun = {
    MAILGUN_API_KEY: 'key-123',
    MAILGUN_DOMAIN: 'mail.example.com',
    MAILGUN_SENDER: 'noreply@example.com',
  };

  it('requires a cookie secret for a production-shaped public URL', () => {
    expect(() => readConfig({ PUBLIC_URL: 'https://example.com', ...fullMailgun })).toThrow(/COOKIE_SECRET/);
  });

  it('rejects a short cookie secret for a production-shaped public URL', () => {
    expect(() =>
      readConfig({
        PUBLIC_URL: 'https://example.com',
        COOKIE_SECRET: 'too-short',
        ...fullMailgun,
      }),
    ).toThrow(/COOKIE_SECRET/);
  });

  it('requires full mailgun configuration for a production-shaped public URL', () => {
    expect(() =>
      readConfig({
        PUBLIC_URL: 'https://example.com',
        COOKIE_SECRET: 'a'.repeat(32),
      }),
    ).toThrow(/MAILGUN/);
  });

  it('accepts a sufficiently long cookie secret and full mailgun config for a production-shaped public URL', () => {
    const cookieSecret = 'a'.repeat(32);
    const config = readConfig({
      PUBLIC_URL: 'https://example.com',
      COOKIE_SECRET: cookieSecret,
      ...fullMailgun,
    });

    expect(config.auth.cookieSecret).toBe(cookieSecret);
    expect(config.auth.cookieSecure).toBe(true);
    expect(config.auth.mailgun).toEqual({
      apiKey: fullMailgun.MAILGUN_API_KEY,
      domain: fullMailgun.MAILGUN_DOMAIN,
      sender: fullMailgun.MAILGUN_SENDER,
    });
  });

  it('throws on partial mailgun configuration regardless of host', () => {
    expect(() =>
      readConfig({
        MAILGUN_DOMAIN: 'mail.example.com',
      }),
    ).toThrow(/MAILGUN/);

    expect(() =>
      readConfig({
        PUBLIC_URL: 'https://example.com',
        COOKIE_SECRET: 'a'.repeat(32),
        MAILGUN_API_KEY: 'key-123',
        MAILGUN_SENDER: 'noreply@example.com',
      }),
    ).toThrow(/MAILGUN/);
  });

  it('populates mailgun when all three fields are present', () => {
    const config = readConfig({
      PUBLIC_URL: 'https://example.com',
      COOKIE_SECRET: 'a'.repeat(32),
      MAILGUN_API_KEY: 'key-123',
      MAILGUN_DOMAIN: 'mail.example.com',
      MAILGUN_SENDER: 'noreply@example.com',
    });

    expect(config.auth.mailgun).toEqual({
      apiKey: 'key-123',
      domain: 'mail.example.com',
      sender: 'noreply@example.com',
    });
  });

  it('applies login rate-limit defaults and honors overrides', () => {
    const defaults = readConfig({});
    expect(defaults.auth.loginRateLimit).toEqual({ perEmailPerHour: 5, perSourcePerHour: 20 });

    const overridden = readConfig({
      LOGIN_RATE_LIMIT_PER_EMAIL_PER_HOUR: '3',
      LOGIN_RATE_LIMIT_PER_SOURCE_PER_HOUR: '10',
    });
    expect(overridden.auth.loginRateLimit).toEqual({ perEmailPerHour: 3, perSourcePerHour: 10 });
  });
});
