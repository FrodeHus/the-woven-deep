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
      process.once(signal, listener);
    },
    off(signal, listener) {
      process.off(signal, listener);
    },
  },
  onShutdownError(error) {
    console.error('Graceful shutdown failed', error);
    process.exitCode = 1;
  },
});
