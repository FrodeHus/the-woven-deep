import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { buildApp } from './app.js';
import { compileStartupContent } from './content-bootstrap.js';
import { ContentPackRepository } from './content-repository.js';
import { readConfig } from './config.js';
import { openDatabase } from './database.js';
import { runServerStartup } from './startup.js';
import { createAuthBundle } from './auth/bundle.js';

const config = readConfig();
await mkdir(dirname(config.databasePath), { recursive: true });
const database = openDatabase(config.databasePath);
const repository = new ContentPackRepository(database);
const auth = createAuthBundle({ db: database, config: config.auth });
await runServerStartup({
  database,
  compilePack: (signal) => compileStartupContent(config.contentDir, signal),
  persistPack: (pack) => repository.put(pack),
  buildServer: (pack) => buildApp({ pack, webDistDir: config.webDistDir, auth }),
  listenOptions: { host: config.host, port: config.port },
  signals: {
    once(signal, listener) {
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- process's signal-listener slot expects a void return; handleSignal owns its own rejection handling, and the identical reference must reach process.off for symmetric deregistration, so it is registered directly.
      process.once(signal, listener);
    },
    off(signal, listener) {
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- mirror of `once`: the same promise-returning reference must be passed through so process.off removes the exact listener process.once registered.
      process.off(signal, listener);
    },
  },
  onShutdownError(error) {
    console.error('Graceful shutdown failed', error);
    process.exitCode = 1;
  },
});
