import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const repositoryRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

function resolvePath(value: string | undefined, fallback: string): string {
  return value === undefined ? resolve(repositoryRoot, fallback) : resolve(value);
}

export interface ServerConfig {
  readonly host: string;
  readonly port: number;
  readonly databasePath: string;
  readonly contentDir: string;
  readonly webDistDir: string;
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
  };
}
