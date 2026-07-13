import { runSmoke } from './smoke-runner.mjs';

const baseUrl = process.argv[2] ?? 'http://localhost:3000';
process.stdout.write(await runSmoke(baseUrl));
