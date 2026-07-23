import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  MAGIC_DEMO_BOUNDARIES,
  encodeActiveRun,
  runMagicDemo,
  stableJson,
} from '../packages/engine/dist/index.js';

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const reviewedHashesPath = fileURLToPath(
  new URL('../packages/engine/test/fixtures/magic-demo-hashes.json', import.meta.url),
);

function parseArguments(arguments_) {
  let verify = false;
  let hashesOnly = false;
  let contentDirectory = resolve(repositoryRoot, 'content');
  let sawContentDirectory = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--verify') {
      if (verify) throw new Error('--verify may only be supplied once');
      verify = true;
      continue;
    }
    if (argument === '--hashes-only') {
      if (hashesOnly) throw new Error('--hashes-only may only be supplied once');
      hashesOnly = true;
      continue;
    }
    if (argument === '--content-dir') {
      if (sawContentDirectory) throw new Error('--content-dir may only be supplied once');
      const value = arguments_[index + 1];
      if (value === undefined || value.startsWith('--'))
        throw new Error('--content-dir requires a path');
      contentDirectory = resolve(value);
      sawContentDirectory = true;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument ${argument}`);
  }
  return { verify, hashesOnly, contentDirectory };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hash(value) {
  return createHash('sha256')
    .update(typeof value === 'string' ? value : stableJson(value))
    .digest('hex');
}

function computeHashes(result) {
  return {
    saveHash: hash(encodeActiveRun(result.state)),
    eventHash: hash({
      authoritative: result.records.map((record) => record.authoritativeEvents),
      public: result.records.map((record) => record.publicEvents),
    }),
    projectionHash: hash(result.records.map((record) => record.projection)),
  };
}

async function verifyReviewedHashes(hashes) {
  const reviewed = JSON.parse(await readFile(reviewedHashesPath, 'utf8'));
  assert(stableJson(hashes) === stableJson(reviewed), 'reviewed magic demo hashes do not match');
}

function record(result, boundary) {
  const found = result.records.find((candidate) => candidate.boundary === boundary);
  assert(found, `magic demo is missing the ${boundary} record`);
  return found;
}

function events(result, boundary, prefix) {
  return stableJson(
    record(result, boundary).authoritativeEvents.filter((event) => event.type.startsWith(prefix)),
  );
}

function proveMilestone(result) {
  assert(
    stableJson(result.records.map((entry) => entry.boundary)) === stableJson(MAGIC_DEMO_BOUNDARIES),
    'magic demo boundaries drifted from MAGIC_DEMO_BOUNDARIES',
  );
  for (const entry of result.records) {
    if (entry.command === null) continue; // after-return: a pure recall-return transition.
    assert(
      entry.commandResult && entry.commandResult.status === 'applied',
      `${entry.boundary} did not apply`,
    );
  }

  const types = new Set(
    result.records.flatMap((entry) => entry.authoritativeEvents.map((event) => event.type)),
  );
  for (const type of [
    'spell.learned',
    'spell.cast',
    'attack.hit',
    'actor.damaged',
    'condition.applied',
    'hero.recalled',
  ]) {
    assert(types.has(type), `magic demo never produced ${type}`);
  }

  const learn = record(result, 'after-learn');
  assert(
    learn.authoritativeEvents.some(
      (event) => event.type === 'spell.learned' && event.spellId === 'spell.frost-shard',
    ),
    'the tome did not teach spell.frost-shard',
  );

  const recall = record(result, 'after-recall');
  assert(
    recall.authoritativeEvents.some((event) => event.type === 'hero.recalled'),
    'the recall cast never emitted hero.recalled',
  );

  const beforeRecallFloorId = record(result, 'after-cone').projection.floor.floorId;
  assert(
    recall.projection.floor.floorId !== beforeRecallFloorId,
    'recall never moved the hero off the dungeon floor',
  );
  const back = record(result, 'after-return');
  assert(
    back.projection.floor.floorId === beforeRecallFloorId,
    'the return portal did not reach the anchored dungeon floor',
  );

  // A second, wholly independent run must be byte-identical (RNG/state determinism).
  const replay = runMagicDemo(result.pack);
  assert(
    encodeActiveRun(result.state) === encodeActiveRun(replay.state),
    'a second in-process run diverged in final state',
  );
  assert(
    stableJson(result.records.map((entry) => entry.projection)) ===
      stableJson(replay.records.map((entry) => entry.projection)),
    'a second in-process run diverged in its projections',
  );
}

function printTranscript(result) {
  console.log('tome read, teaching spell.frost-shard');
  console.log(events(result, 'after-learn', 'spell.'));
  console.log('single-target cast (spell.ember-bolt)');
  console.log(events(result, 'after-single', ''));
  console.log('self-buff cast (spell.weave-shield)');
  console.log(events(result, 'after-shield', ''));
  console.log('burst cast (spell.fireball) over a clustered pair');
  console.log(events(result, 'after-burst', ''));
  console.log('line cast (spell.arc-lance) over a clustered pair');
  console.log(events(result, 'after-line', ''));
  console.log('cone cast (spell.cinder-breath) over a clustered pair');
  console.log(events(result, 'after-cone', ''));
  console.log('burn DoT ticked after a wait');
  console.log(events(result, 'after-burn-tick', ''));
  console.log('recall anchors the dungeon floor and moves to town');
  console.log(events(result, 'after-recall', ''));
  console.log('return portal reaches the anchored dungeon floor');
  console.log(stableJson(record(result, 'after-return').projection.floor.floorId));
}

function runScenario(contentDirectory) {
  return compileContentDirectory({ rootDir: contentDirectory }).then((content) => {
    const result = runMagicDemo(content);
    proveMilestone({ ...result, pack: content });
    return { content, result };
  });
}

function printHashes(hashes) {
  for (const [label, value] of Object.entries(hashes)) {
    assert(/^[a-f0-9]{64}$/.test(value), `${label} must be a nonempty sha-256 hex digest`);
    console.log(`${label} ${value}`);
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const { result } = await runScenario(options.contentDirectory);
  const hashes = computeHashes(result);
  if (options.hashesOnly) {
    printHashes(hashes);
    return;
  }
  printTranscript(result);
  console.log('first process hashes');
  printHashes(hashes);

  const second = spawnSync(
    process.execPath,
    [scriptPath, '--hashes-only', '--content-dir', options.contentDirectory],
    { encoding: 'utf8' },
  );
  assert(second.status === 0, `second process failed: ${second.stderr}`);
  const expected = Object.entries(hashes)
    .map(([label, value]) => `${label} ${value}`)
    .join('\n');
  assert(second.stdout.trim() === expected, 'second process hashes diverged');
  console.log('second process hashes');
  process.stdout.write(second.stdout);

  if (options.verify) {
    await verifyReviewedHashes(hashes);
    console.log('magic milestone verified');
  } else {
    const candidateHashesPath = join(
      await mkdtemp(join(tmpdir(), 'magic-demo-')),
      'magic-demo-hashes.json',
    );
    await writeFile(candidateHashesPath, `${JSON.stringify(hashes, null, 2)}\n`, 'utf8');
    console.log(`candidate hashes written ${candidateHashesPath}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'unknown failure';
  console.error(`magic demo failed: ${message.replace(/\s+/g, ' ').trim()}`);
  process.exitCode = 1;
});
