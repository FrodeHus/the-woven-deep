import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { buildApp } from './app.js';
import { bootstrapContent } from './content-bootstrap.js';
import { ContentPackRepository } from './content-repository.js';
import { readConfig } from './config.js';
import { openDatabase } from './database.js';
import { registerShutdownHandlers } from './lifecycle.js';

const config = readConfig();
await mkdir(dirname(config.databasePath), { recursive: true });
const database = openDatabase(config.databasePath);
const pack = await bootstrapContent(config.contentDir, new ContentPackRepository(database));
const app = buildApp({ pack, webDistDir: config.webDistDir });
registerShutdownHandlers({
  server: app,
  database,
  signals: {
    once(signal, listener) {
      process.once(signal, listener);
    },
  },
  onError(error) {
    console.error('Graceful shutdown failed', error);
    process.exitCode = 1;
  },
});
await app.listen({ host: config.host, port: config.port });
