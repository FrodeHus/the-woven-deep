import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  MERCHANT_REPLAY_BOUNDARIES,
  encodeActiveRun,
  merchantDemoEquivalent,
  runMerchantDemo,
  stableJson,
} from '../packages/engine/dist/index.js';

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const reviewedHashesPath = fileURLToPath(
  new URL('../packages/engine/test/fixtures/merchant-demo-hashes.json', import.meta.url),
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
    }),
    projectionHash: hash(result.records.map((record) => record.projection)),
  };
}

async function verifyReviewedHashes(hashes) {
  const reviewed = JSON.parse(await readFile(reviewedHashesPath, 'utf8'));
  assert(stableJson(hashes) === stableJson(reviewed), 'reviewed merchant demo hashes do not match');
}

function record(result, boundary) {
  const found = result.records.find((candidate) => candidate.boundary === boundary);
  assert(found, `merchant demo is missing the ${boundary} record`);
  return found;
}

function merchants(state) {
  return state.populations.filter((population) => population.model === 'merchant');
}

/** Persisted merchant fields the printed observable data must never contain. */
const HIDDEN_MERCHANT_FIELDS = ['departureAt', 'rolledLifetime', 'initialStockItemIds',
  'emittedWarningThresholds', 'aggressionPenaltyApplied', 'deathPenaltyApplied',
  'stockLossResolved', 'commerceBonusApplied'];

function proveMilestone(result, split, content) {
  // Permanent (town) merchants are never materialized through population placement, so this
  // demo only ever forces a non-permanent, dungeon-wandering merchant encounter.
  const encounter = content.entries.find((entry) => entry.kind === 'encounter' && entry.model === 'merchant'
    && !entry.definition.permanent);
  assert(encounter, 'bundled content is missing the merchant encounter');
  const placed = merchants(result.initial);
  assert(placed.length === 2 && placed.every((population) => population.encounterId === encounter.id),
    'demo did not force two eligible Lampwright merchant placements');
  assert(new Set(placed.map((population) => population.floorId)).size === 2,
    'the two merchant placements must occupy separate floors');

  const bought = record(result, 'before-buy').authoritativeEvents.find((event) => event.type === 'trade.bought');
  const sold = record(result, 'before-sell').authoritativeEvents.find((event) => event.type === 'trade.sold');
  const identified = record(result, 'before-identify').authoritativeEvents
    .find((event) => event.type === 'trade.service-purchased');
  assert(bought && sold && identified, 'buy, sell, and identify commerce events are required');
  const closed = record(result, 'before-close').authoritativeEvents;
  assert(closed.some((event) => event.type === 'trade.closed' && event.completedCommerce)
    && closed.some((event) => event.type === 'reputation.changed' && event.reason === 'commerce'),
  'the explicit close after commerce must grant the reputation delta');

  const openProjection = record(result, 'before-open').projection;
  assert(openProjection.trade !== undefined, 'the open trade must project observable commerce data');
  const projectionsJson = stableJson(result.records.map((candidate) => candidate.projection));
  for (const field of HIDDEN_MERCHANT_FIELDS) {
    assert(!projectionsJson.includes(`"${field}"`), `projection leaked hidden merchant field ${field}`);
  }

  const warnings = result.records.flatMap((candidate) => candidate.authoritativeEvents)
    .filter((event) => event.type === 'merchant.departure-warning');
  assert(warnings.length > 0, 'departure warnings never crossed a threshold');
  assert(new Set(warnings.map((event) => event.populationId)).size === 2,
    'both merchants must cross departure warning thresholds');

  const provokeRecord = record(result, 'before-provoke');
  const provoked = provokeRecord.authoritativeEvents.find((event) => event.type === 'merchant.provoked');
  const dropped = provokeRecord.authoritativeEvents.find((event) => event.type === 'merchant.stock-dropped');
  assert(provoked?.response === 'flee' && dropped, 'the production attack must provoke a fleeing merchant');
  const stockBefore = result.initial.items
    .filter((item) => item.location.type === 'merchant-stock' && item.location.populationId === provoked.populationId)
    .reduce((total, item) => total + item.quantity, 0)
    - bought.quantity + sold.quantity;
  const expectedDrop = Math.min(stockBefore, Math.ceil(stockBefore * encounter.definition.stockDropFraction));
  assert(dropped.units === expectedDrop,
    `stock loss must equal ceil(${stockBefore} * ${encounter.definition.stockDropFraction}) = ${expectedDrop}, got ${dropped.units}`);
  assert(dropped.itemIds.every((itemId) => result.state.items.some((item) => item.itemId === itemId
    && item.location.type === 'floor')), 'dropped stock must persist on the floor');

  const death = record(result, 'before-death').authoritativeEvents;
  assert(death.some((event) => event.type === 'merchant.died')
    && death.some((event) => event.type === 'reputation.changed' && event.reason === 'death'),
  'killing the provoked merchant must apply the one-time death consequence');

  const refusal = record(result, 'before-refusal');
  assert(refusal.commandResult.status === 'invalid' && refusal.commandResult.reason === 'merchant.refuses',
    'the same-faction merchant must refuse trade after the aggression');

  const departure = record(result, 'before-departure');
  const departed = departure.authoritativeEvents.find((event) => event.type === 'merchant.departed');
  assert(departed, 'the surviving merchant never departed');
  const survivor = merchants(result.state).find((population) => population.populationId === departed.populationId);
  assert(survivor.lifecycle === 'departed' && survivor.floorId !== result.state.activeFloorId,
    'the departure must resolve on an inactive floor');
  assert(!departure.authoritativeEvents.some((event) => event.type === 'actor.turn.completed'
    && event.actorId === departed.actorId), 'the off-floor departure must not grant the merchant an actor turn');
  assert(!result.state.actors.some((actor) => actor.actorId === departed.actorId),
    'the departed merchant actor must be removed');

  const final = merchants(result.state).map((population) => population.lifecycle).sort();
  assert(stableJson(final) === stableJson(['dead', 'departed']),
    'the demo must end with one dead and one departed merchant');
  assert(merchantDemoEquivalent(result, split), 'split execution diverged');
}

function printTranscript(result, content) {
  const events = (boundary, prefix) => stableJson(record(result, boundary).authoritativeEvents
    .filter((event) => event.type.startsWith(prefix)));
  const balance = content.entries.find((entry) => entry.kind === 'balance');
  console.log(`two forced eligible Lampwright merchant placements; hero starts with the authored starting currency ${balance.startingCurrency}`);
  console.log('observable trade session');
  console.log(stableJson(record(result, 'before-open').projection.trade));
  console.log('buy, sell, and identify at quoted prices');
  console.log(events('before-buy', 'trade.'));
  console.log(events('before-sell', 'trade.'));
  console.log(events('before-identify', 'trade.'));
  console.log('explicit close grants the one-time commerce delta');
  console.log(events('before-close', 'trade.') + events('before-close', 'reputation.'));
  console.log('departure warnings crossed');
  console.log(stableJson(result.records.flatMap((candidate) => candidate.authoritativeEvents)
    .filter((event) => event.type === 'merchant.departure-warning')));
  console.log('production attack provokes, drops exact ceil-fraction stock, and the merchant flees');
  console.log(events('before-provoke', 'merchant.'));
  console.log('killing the provoked merchant destroys held stock and applies the death delta once');
  console.log(events('before-death', 'merchant.') + events('before-death', 'reputation.'));
  console.log('same-faction merchant refuses trade');
  console.log(stableJson(record(result, 'before-refusal').commandResult));
  console.log('off-floor departure without actor turns');
  console.log(events('before-departure', 'merchant.'));
  console.log('split execution equivalent');
  console.log('true');
}

function runScenario(contentDirectory) {
  return compileContentDirectory({ rootDir: contentDirectory }).then((content) => {
    const continuous = runMerchantDemo(content);
    const split = runMerchantDemo(content, new Set(MERCHANT_REPLAY_BOUNDARIES.map((_, index) => index)));
    proveMilestone(continuous, split, content);
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
  const { content, continuous } = await runScenario(options.contentDirectory);
  const hashes = computeHashes(continuous);
  if (options.hashesOnly) {
    printHashes(hashes);
    return;
  }
  printTranscript(continuous, content);
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
    console.log('travelling merchant milestone verified');
  } else {
    const candidateHashesPath = join(await mkdtemp(join(tmpdir(), 'merchant-demo-')), 'merchant-demo-hashes.json');
    await writeFile(candidateHashesPath, `${JSON.stringify(hashes, null, 2)}\n`, 'utf8');
    console.log(`candidate hashes written ${candidateHashesPath}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'unknown failure';
  console.error(`merchant demo failed: ${message.replace(/\s+/g, ' ').trim()}`);
  process.exitCode = 1;
});
