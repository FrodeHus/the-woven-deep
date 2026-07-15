import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  RUN_RECORDS_REPLAY_BOUNDARIES,
  createInMemoryRunRecordRepository,
  encodeActiveRun,
  runRecordsDemoEquivalent,
  runRunRecordsDemo,
  stableJson,
} from '../packages/engine/dist/index.js';

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const reviewedHashesPath = fileURLToPath(
  new URL('../packages/engine/test/fixtures/run-records-demo-hashes.json', import.meta.url),
);

/** Host-supplied Hall enrichment: the closed achieved-at date and portrait vocabulary only. */
const DEMO_ENRICHMENT = { achievedAt: '2026-07-15', portraitGlyph: '@' };

/** Persisted hidden state the printed observable data must never contain. */
const HIDDEN_FIELDS = ['fallenHeroDecisions', 'encounterDecisions', 'concludedAtRevision',
  'run-records', 'departureAt', 'rolledLifetime'];

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
      if (value === undefined || value.startsWith('--')) throw new Error('--content-dir requires a path');
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
  return createHash('sha256').update(typeof value === 'string' ? value : stableJson(value)).digest('hex');
}

function computeHashes(result) {
  return {
    saveHash: hash(encodeActiveRun(result.state)),
    eventHash: hash({
      authoritative: result.records.map((record) => record.authoritativeEvents),
      public: result.records.map((record) => record.publicEvents),
      finalization: result.finalization.events,
    }),
    projectionHash: hash(result.records.map((record) => record.projection)),
    recordHash: hash(result.finalization.record),
  };
}

async function verifyReviewedHashes(hashes) {
  const reviewed = JSON.parse(await readFile(reviewedHashesPath, 'utf8'));
  assert(stableJson(hashes) === stableJson(reviewed), 'reviewed run records demo hashes do not match');
}

function record(result, boundary) {
  const found = result.records.find((candidate) => candidate.boundary === boundary);
  assert(found, `run records demo is missing the ${boundary} record`);
  return found;
}

function events(result, boundary, prefix) {
  return stableJson(record(result, boundary).authoritativeEvents.filter((event) => event.type.startsWith(prefix)));
}

/** Ranks the finalized record through the in-memory repository, returning standings and lineage. */
function persist(result) {
  const repository = createInMemoryRunRecordRepository();
  repository.applyDeltas(result.finalization.deltas);
  repository.appendRecord({ ...result.finalization.record, enrichment: DEMO_ENRICHMENT });
  return {
    standings: repository.standings(10),
    heart: repository.currentHeart(),
    lifetime: repository.lifetime(),
  };
}

function proveMilestone(result, split) {
  const types = new Set(result.records.flatMap((entry) =>
    entry.authoritativeEvents.map((event) => event.type)));
  for (const type of ['group.leader-defeated', 'swarm.source-destroyed', 'boss.phase-changed',
    'trade.opened', 'merchant.provoked', 'run.concluded']) {
    assert(types.has(type), `run records demo never produced ${type}`);
  }
  for (const entry of result.records) {
    assert(entry.commandResult.status === 'applied', `${entry.boundary} did not apply`);
  }

  const conclusion = record(result, 'before-death').authoritativeEvents
    .find((event) => event.type === 'run.concluded');
  assert(conclusion && conclusion.completionType === 'died', 'the hero did not conclude with a died completion');
  assert(conclusion.cause.killerContentId !== null, 'the death was not credited to a killer');

  const finalization = result.finalization;
  assert(finalization !== null, 'the run was never finalized');
  assert(result.state.conclusion.finalized === true, 'the finalized flag was not set');
  const finalizedEvents = finalization.events.filter((event) => event.type === 'run.finalized');
  assert(finalizedEvents.length === 1, 'finalization must emit exactly one run.finalized event');
  assert(finalization.record.completionType === 'died', 'the record is not a died completion');
  assert(finalization.record.heirloom.sourceItemId === 'item.run-records-demo.sword',
    'the heirloom did not roll the equipped weapon');
  assert(finalization.record.score.total
    === finalization.record.score.lines.reduce((sum, line) => sum + line.amount, 0),
    'the score total must equal the sum of its lines');

  const { standings, heart } = persist(result);
  assert(standings.length === 1 && standings[0].hallRecordId === finalization.record.recordId,
    'the finalized record was not ranked into the standings');
  assert(heart === null, 'a died completion must never write the Heart lineage');

  // Every printed piece of observable data — never the raw persisted save — must stay hidden-safe.
  const transcript = stableJson(result.records.map((entry) => entry.projection))
    + stableJson(finalization.record) + stableJson(finalization.events)
    + stableJson(finalization.deltas.achievementGrants) + stableJson(standings) + stableJson(heart);
  for (const field of HIDDEN_FIELDS) {
    assert(!transcript.includes(`"${field}"`), `observable data leaked hidden field ${field}`);
  }
  assert(runRecordsDemoEquivalent(result, split), 'split execution diverged');
}

function printTranscript(result) {
  const finalization = result.finalization;
  const { standings, heart } = persist(result);
  console.log('leader group felled by a production attack');
  console.log(events(result, 'before-group-fight', 'group.'));
  console.log('swarm contained by destroying its source');
  console.log(events(result, 'before-swarm', 'swarm.'));
  console.log('rare boss encountered and phase-changed');
  console.log(events(result, 'before-boss', 'boss.'));
  console.log('travelling merchant trade session');
  console.log(stableJson(record(result, 'before-trade').projection.trade));
  console.log('merchant provoked by a production attack');
  console.log(events(result, 'before-merchant-attack', 'merchant.'));
  console.log('hero dies with a credited killer and the run concludes');
  console.log(events(result, 'before-death', 'run.'));
  console.log('finalized exactly once');
  console.log(stableJson(finalization.events));
  console.log('itemized score breakdown and total');
  console.log(stableJson(finalization.record.score));
  console.log('metrics snapshot');
  console.log(stableJson(finalization.record.metrics));
  console.log('heirloom snapshot');
  console.log(stableJson(finalization.record.heirloom));
  console.log('granted achievements');
  console.log(stableJson(finalization.deltas.achievementGrants));
  console.log('hall record id');
  console.log(finalization.record.recordId);
  console.log('ranked standings');
  console.log(stableJson(standings));
  console.log('heart lineage');
  console.log(stableJson(heart));
  console.log('split execution equivalent');
  console.log('true');
}

function runScenario(contentDirectory) {
  return compileContentDirectory({ rootDir: contentDirectory }).then((content) => {
    const continuous = runRunRecordsDemo(content);
    const split = runRunRecordsDemo(content, new Set(RUN_RECORDS_REPLAY_BOUNDARIES.map((_, index) => index)));
    proveMilestone(continuous, split);
    return { content, continuous, split };
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
  const { continuous } = await runScenario(options.contentDirectory);
  const hashes = computeHashes(continuous);
  if (options.hashesOnly) {
    printHashes(hashes);
    return;
  }
  printTranscript(continuous);
  console.log('first process hashes');
  printHashes(hashes);

  const second = spawnSync(process.execPath, [
    scriptPath, '--hashes-only', '--content-dir', options.contentDirectory,
  ], { encoding: 'utf8' });
  assert(second.status === 0, `second process failed: ${second.stderr}`);
  const expected = Object.entries(hashes).map(([label, value]) => `${label} ${value}`).join('\n');
  assert(second.stdout.trim() === expected, 'second process hashes diverged');
  console.log('second process hashes');
  process.stdout.write(second.stdout);

  if (options.verify) {
    await verifyReviewedHashes(hashes);
    console.log('run records milestone verified');
  } else {
    const candidateHashesPath = join(await mkdtemp(join(tmpdir(), 'run-records-demo-')), 'run-records-demo-hashes.json');
    await writeFile(candidateHashesPath, `${JSON.stringify(hashes, null, 2)}\n`, 'utf8');
    console.log(`candidate hashes written ${candidateHashesPath}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'unknown failure';
  console.error(`run records demo failed: ${message.replace(/\s+/g, ' ').trim()}`);
  process.exitCode = 1;
});
