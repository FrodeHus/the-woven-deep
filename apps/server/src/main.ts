import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { buildApp } from './app.js';
import { bootstrapContent } from './content-bootstrap.js';
import { ContentPackRepository } from './content-repository.js';
import { readConfig } from './config.js';
import { openDatabase } from './database.js';

const config = readConfig();
await mkdir(dirname(config.databasePath), { recursive: true });
const database = openDatabase(config.databasePath);
const pack = await bootstrapContent(config.contentDir, new ContentPackRepository(database));
const app = buildApp({ pack, webDistDir: config.webDistDir });
await app.listen({ host: config.host, port: config.port });
