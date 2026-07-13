import { resolve } from 'node:path';
import { compileContentDirectory } from './compiler/index.js';

const rootDir = resolve(process.argv[2] ?? 'content');
const pack = await compileContentDirectory({
  rootDir,
  registries: {
    ai: new Set(['ai.skittish']),
    effects: new Set(['effect.light-source']),
  },
});
process.stdout.write(`${pack.hash} ${pack.entries.length} entries\n`);
