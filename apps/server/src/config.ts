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

/**
 * Treat an empty string exactly like an unset variable. Deploy manifests declare the auth secrets
 * as overridable placeholders (`${COOKIE_SECRET:-}` in compose, blank `ENV` keys in the Dockerfile);
 * an operator who never supplies them leaves the container holding empty strings, which must behave
 * as "not configured" rather than as a zero-length secret or a Mailgun key of `''`.
 */
function readNonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value;
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

/**
 * Resolves and validates `PUBLIC_URL`, returning the raw string alongside the parsed `URL` and
 * whether the URL is "production-shaped" (non-localhost). `isProductionShaped` gates the stricter
 * validation in {@link resolveMailgunConfig} and {@link resolveCookieSecret}: a deployment can be
 * production-shaped (a real public hostname) even when `NODE_ENV` isn't `production`, and both
 * validators key off the URL's shape rather than `NODE_ENV` directly.
 *
 * Production guard: `NODE_ENV=production` (the Dockerfile sets it) with no explicit PUBLIC_URL
 * would otherwise silently fall through to the localhost default, which in turn selects the dev
 * cookie secret and the dev-echo mail transport — a deployment that looks healthy while leaking
 * magic links to an in-memory endpoint and signing sessions with a public dev secret. Require an
 * explicit, non-localhost PUBLIC_URL instead so a misconfigured prod boot fails loudly.
 */
function resolvePublicUrl(
  env: NodeJS.ProcessEnv,
): { publicUrl: string; parsedUrl: URL; isProductionShaped: boolean } {
  const isProduction = env.NODE_ENV === 'production';
  const publicUrlEnv = readNonEmpty(env.PUBLIC_URL);

  if (isProduction && publicUrlEnv === undefined) {
    throw new Error('PUBLIC_URL is required when NODE_ENV=production (set it to the public, non-localhost URL)');
  }

  const publicUrl = publicUrlEnv ?? 'http://localhost:3000';

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(publicUrl);
  } catch {
    throw new Error('PUBLIC_URL must be a valid URL');
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('PUBLIC_URL must use the http or https scheme');
  }
  if (isProduction && isLocalHost(parsedUrl.hostname)) {
    throw new Error('PUBLIC_URL must be a non-localhost URL when NODE_ENV=production');
  }

  return { publicUrl, parsedUrl, isProductionShaped: !isLocalHost(parsedUrl.hostname) };
}

/**
 * Resolves the Mailgun transport config. All three fields must be set together or not at all;
 * a production-shaped `PUBLIC_URL` requires all three so a live deployment never silently falls
 * back to the dev-echo mail transport.
 */
function resolveMailgunConfig(
  env: NodeJS.ProcessEnv,
  isProductionShaped: boolean,
): AuthConfig['mailgun'] {
  const mailgunApiKey = readNonEmpty(env.MAILGUN_API_KEY);
  const mailgunDomain = readNonEmpty(env.MAILGUN_DOMAIN);
  const mailgunSender = readNonEmpty(env.MAILGUN_SENDER);
  const mailgunFieldsPresent = [mailgunApiKey, mailgunDomain, mailgunSender].filter(
    (value) => value !== undefined,
  ).length;
  if (mailgunFieldsPresent > 0 && mailgunFieldsPresent < 3) {
    throw new Error('MAILGUN_API_KEY, MAILGUN_DOMAIN, and MAILGUN_SENDER must be set together, or not at all');
  }
  if (isProductionShaped && mailgunFieldsPresent === 0) {
    throw new Error('MAILGUN_API_KEY, MAILGUN_DOMAIN, and MAILGUN_SENDER are required for a non-localhost PUBLIC_URL');
  }

  return mailgunFieldsPresent === 3
    ? {
        apiKey: mailgunApiKey as string,
        domain: mailgunDomain as string,
        sender: mailgunSender as string,
      }
    : null;
}

/**
 * Resolves the cookie-signing secret. A production-shaped `PUBLIC_URL` requires an explicit
 * `COOKIE_SECRET` of at least {@link MIN_COOKIE_SECRET_LENGTH} characters; otherwise a fixed dev
 * secret is used so local development works without configuration.
 */
function resolveCookieSecret(env: NodeJS.ProcessEnv, isProductionShaped: boolean): string {
  const cookieSecretEnv = readNonEmpty(env.COOKIE_SECRET);
  if (cookieSecretEnv !== undefined) {
    if (cookieSecretEnv.length < MIN_COOKIE_SECRET_LENGTH) {
      throw new Error(`COOKIE_SECRET must be at least ${MIN_COOKIE_SECRET_LENGTH} characters`);
    }
    return cookieSecretEnv;
  }
  if (isProductionShaped) {
    throw new Error('COOKIE_SECRET is required for a non-localhost PUBLIC_URL');
  }
  return DEV_COOKIE_SECRET;
}

/** Resolves the login rate limits, falling back to fixed defaults when unset. */
function resolveRateLimits(env: NodeJS.ProcessEnv): AuthConfig['loginRateLimit'] {
  return {
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
  };
}

function readAuthConfig(env: NodeJS.ProcessEnv): AuthConfig {
  const { publicUrl, parsedUrl, isProductionShaped } = resolvePublicUrl(env);
  const mailgun = resolveMailgunConfig(env, isProductionShaped);
  const cookieSecret = resolveCookieSecret(env, isProductionShaped);

  return {
    publicUrl,
    cookieSecret,
    cookieSecure: parsedUrl.protocol === 'https:',
    mailgun,
    loginRateLimit: resolveRateLimits(env),
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
