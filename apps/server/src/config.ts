import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const repositoryRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

function resolvePath(value: string | undefined, fallback: string): string {
  return value === undefined ? resolve(repositoryRoot, fallback) : resolve(value);
}

export interface AuthConfig {
  readonly publicUrl: string;
  readonly cookieSecret: string;
  readonly cookieSecure: boolean;
  readonly mailgun: Readonly<{ apiKey: string; domain: string; sender: string }> | null;
  readonly loginRateLimit: Readonly<{ perEmailPerHour: number; perSourcePerHour: number }>;
}

export interface ServerConfig {
  readonly host: string;
  readonly port: number;
  readonly databasePath: string;
  readonly contentDir: string;
  readonly webDistDir: string;
  readonly auth: AuthConfig;
}

const DEV_COOKIE_SECRET = 'dev-only-cookie-secret-do-not-use-in-prod!!';
const MIN_COOKIE_SECRET_LENGTH = 32;
const DEFAULT_LOGIN_RATE_LIMIT_PER_EMAIL_PER_HOUR = 5;
const DEFAULT_LOGIN_RATE_LIMIT_PER_SOURCE_PER_HOUR = 20;

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

function parsePositiveInt(value: string | undefined, fallback: number, label: string): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function readAuthConfig(env: NodeJS.ProcessEnv): AuthConfig {
  const publicUrl = env.PUBLIC_URL ?? 'http://localhost:3000';

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(publicUrl);
  } catch {
    throw new Error('PUBLIC_URL must be a valid URL');
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('PUBLIC_URL must use the http or https scheme');
  }

  const isProductionShaped = !isLocalHost(parsedUrl.hostname);

  const mailgunFieldsPresent = [env.MAILGUN_API_KEY, env.MAILGUN_DOMAIN, env.MAILGUN_SENDER].filter(
    (value) => value !== undefined,
  ).length;
  if (mailgunFieldsPresent > 0 && mailgunFieldsPresent < 3) {
    throw new Error('MAILGUN_API_KEY, MAILGUN_DOMAIN, and MAILGUN_SENDER must be set together, or not at all');
  }
  if (isProductionShaped && mailgunFieldsPresent === 0) {
    throw new Error('MAILGUN_API_KEY, MAILGUN_DOMAIN, and MAILGUN_SENDER are required for a non-localhost PUBLIC_URL');
  }

  const mailgun =
    mailgunFieldsPresent === 3
      ? {
          apiKey: env.MAILGUN_API_KEY as string,
          domain: env.MAILGUN_DOMAIN as string,
          sender: env.MAILGUN_SENDER as string,
        }
      : null;

  let cookieSecret: string;
  if (env.COOKIE_SECRET !== undefined) {
    if (env.COOKIE_SECRET.length < MIN_COOKIE_SECRET_LENGTH) {
      throw new Error(`COOKIE_SECRET must be at least ${MIN_COOKIE_SECRET_LENGTH} characters`);
    }
    cookieSecret = env.COOKIE_SECRET;
  } else if (isProductionShaped) {
    throw new Error('COOKIE_SECRET is required for a non-localhost PUBLIC_URL');
  } else {
    cookieSecret = DEV_COOKIE_SECRET;
  }

  return {
    publicUrl,
    cookieSecret,
    cookieSecure: parsedUrl.protocol === 'https:',
    mailgun,
    loginRateLimit: {
      perEmailPerHour: parsePositiveInt(
        env.LOGIN_RATE_LIMIT_PER_EMAIL_PER_HOUR,
        DEFAULT_LOGIN_RATE_LIMIT_PER_EMAIL_PER_HOUR,
        'LOGIN_RATE_LIMIT_PER_EMAIL_PER_HOUR',
      ),
      perSourcePerHour: parsePositiveInt(
        env.LOGIN_RATE_LIMIT_PER_SOURCE_PER_HOUR,
        DEFAULT_LOGIN_RATE_LIMIT_PER_SOURCE_PER_HOUR,
        'LOGIN_RATE_LIMIT_PER_SOURCE_PER_HOUR',
      ),
    },
  };
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer from 1 to 65535');
  }

  return {
    host: env.HOST ?? '0.0.0.0',
    port,
    databasePath: resolvePath(env.DATABASE_PATH, 'data/rogue.sqlite'),
    contentDir: resolvePath(env.CONTENT_DIR, 'content'),
    webDistDir: resolvePath(env.WEB_DIST_DIR, 'apps/web/dist'),
    auth: readAuthConfig(env),
  };
}
