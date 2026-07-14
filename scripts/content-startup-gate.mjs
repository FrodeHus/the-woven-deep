import Database from 'better-sqlite3';
import { execFile } from 'node:child_process';
import { cp, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { verifyContentStartupGate } from './content-startup-gate-runner.mjs';
import { runSmoke } from './smoke-runner.mjs';

const execute = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function command(file, args, allowFailure = false) {
  try {
    const result = await execute(file, args, {
      cwd: repositoryRoot,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    return { exitCode: 0, output: `${result.stdout}${result.stderr}` };
  } catch (error) {
    if (!allowFailure) throw error;
    return {
      exitCode: typeof error.code === 'number' ? error.code : 1,
      output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
    };
  }
}

async function imageReference(argument) {
  if (argument) return argument;
  await command('docker', ['compose', 'build', '--quiet']);
  const result = await command('docker', ['compose', 'images', '-q', 'rogue']);
  const image = result.output.trim().split(/\s+/)[0];
  if (!image) throw new Error('content startup gate could not resolve the built rogue image');
  return image;
}

async function createDirectories(root) {
  const valid = join(root, 'valid-content');
  const invalid = join(root, 'invalid-content');
  const data = join(root, 'data');
  await cp(resolve(repositoryRoot, 'content'), valid, { recursive: true });
  await cp(valid, invalid, { recursive: true });
  await mkdir(data);
  await chmod(data, 0o777);

  const invalidBalance = join(invalid, 'balance', 'core-gameplay.yaml');
  const source = await readFile(invalidBalance, 'utf8');
  if (!source.startsWith('schemaVersion: 3')) {
    throw new Error('content startup gate expected bundled schemaVersion 3 content');
  }
  await writeFile(invalidBalance, source.replace('schemaVersion: 3', 'schemaVersion: 2'));
  return { valid, invalid, data };
}

function containerArguments(name, image, content, data, detached) {
  return [
    'run', ...(detached ? ['--detach'] : []), '--name', name,
    '--mount', `type=bind,src=${content},dst=/app/content,readonly`,
    '--mount', `type=bind,src=${data},dst=/data`,
    ...(detached ? ['--publish', '127.0.0.1::3000'] : []),
    image,
  ];
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), 'woven-content-startup-'));
  const suffix = randomUUID().slice(0, 8);
  const validName = `woven-content-valid-${suffix}`;
  const invalidName = `woven-content-invalid-${suffix}`;
  try {
    const image = await imageReference(process.argv[2]);
    const paths = await createDirectories(root);
    const runtime = {
      async startValid() {
        await command('docker', containerArguments(validName, image, paths.valid, paths.data, true));
      },
      async assertReadOnly() {
        const inspected = await command('docker', [
          'inspect', '--format',
          '{{range .Mounts}}{{if eq .Destination "/app/content"}}{{.RW}}{{end}}{{end}}',
          validName,
        ]);
        if (inspected.output.trim() !== 'false') {
          throw new Error('container content mount is not read-only');
        }
      },
      async smokeValid() {
        const port = await command('docker', ['port', validName, '3000/tcp']);
        const address = port.output.trim().split('\n')[0];
        const match = /^127\.0\.0\.1:(\d+)$/.exec(address);
        if (!match) throw new Error(`unexpected published port: ${address}`);
        const output = await runSmoke(`http://127.0.0.1:${match[1]}`, {
          attempts: 8,
          timeoutMs: 3_000,
          retryDelayMs: 250,
        });
        const health = /^ok ([a-f0-9]{64}) (\d+) entries\n$/.exec(output);
        if (!health) throw new Error(`unexpected smoke output: ${output}`);
        return { contentHash: health[1], entries: Number(health[2]) };
      },
      async stopValid() {
        await command('docker', ['rm', '--force', validName], true);
      },
      async snapshotPublications() {
        const database = new Database(join(paths.data, 'rogue.sqlite'), { readonly: true });
        try {
          return database.prepare(`
            select hash, schema_version as schemaVersion
            from content_packs
            order by hash
          `).all();
        } finally {
          database.close();
        }
      },
      async runInvalid() {
        const result = await command(
          'docker',
          containerArguments(invalidName, image, paths.invalid, paths.data, false),
          true,
        );
        await command('docker', ['rm', '--force', invalidName], true);
        return result;
      },
    };
    const result = await verifyContentStartupGate(runtime);
    process.stdout.write(
      `content startup gate passed ${result.contentHash} ${result.entries} entries, ${result.publications} immutable publication\n`,
    );
  } finally {
    await command('docker', ['rm', '--force', validName], true);
    await command('docker', ['rm', '--force', invalidName], true);
    await rm(root, { recursive: true, force: true });
  }
}

await main();
