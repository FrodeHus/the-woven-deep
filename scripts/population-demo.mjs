import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  encodeActiveRun,
  createEncounterRunDecisions,
  populationDemoEquivalent,
  preservesRequiredRoutes,
  runPopulationDemo,
  stableJson,
} from '../packages/engine/dist/index.js';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const reviewedHashesPath = fileURLToPath(
  new URL('../packages/engine/test/fixtures/population-demo-hashes.json', import.meta.url),
);
const candidateHashesPath = '/tmp/population-demo-hashes.json';

function parseArguments(arguments_) {
  let verify = false;
  let contentDirectory = resolve(repositoryRoot, 'content');
  let sawContentDirectory = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--verify') {
      if (verify) throw new Error('--verify may only be supplied once');
      verify = true;
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
  return { verify, contentDirectory };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hash(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

async function verifyReviewedHashes(hashes) {
  const reviewed = JSON.parse(await readFile(reviewedHashesPath, 'utf8'));
  assert(stableJson(hashes) === stableJson(reviewed), 'reviewed population demo hashes do not match');
}

function eventTypes(result) {
  return result.records.flatMap((record) => record.authoritativeEvents.map((event) => event.type));
}

function proveMilestone(result, split, content) {
  const types = eventTypes(result);
  const has = (type) => assert(types.includes(type), `population demo did not produce ${type}`);
  for (const type of [
    'group.awareness-shared', 'group.leader-defeated', 'group.outcome-applied',
    'swarm.members-created', 'swarm.cap-reached', 'swarm.source-destroyed',
    'boss.phase-changed', 'boss.recovered', 'boss.reward-created',
    'champion.defeated', 'champion.heirloom-created', 'echo.defeated', 'echo.loot-created',
  ]) has(type);

  const group = result.state.populations.find((population) => population.model === 'group');
  const swarm = result.state.populations.find((population) => population.model === 'swarm');
  const boss = result.state.populations.find((population) => population.model === 'boss');
  const champion = result.state.populations.find((population) => population.model === 'champion');
  const echo = result.state.populations.find((population) => population.model === 'echo');
  assert(group?.leaderResponseApplied === true, 'leader outcome was not persisted');
  assert(group.sharedKnowledge.length > 0, 'leader group did not relay knowledge');
  const relays = result.records.flatMap((record) => record.authoritativeEvents)
    .filter((event) => event.type === 'group.awareness-shared');
  assert(relays.length > 0 && relays.length < group.roleMembership.length,
    'group relay was not limited by communication reach');
  const swarmDefinition = content.entries.find((entry) => entry.id === swarm?.encounterId);
  assert(swarmDefinition?.kind === 'encounter' && swarmDefinition.model === 'swarm', 'swarm content missing');
  assert(swarm.livingMemberIds.length <= swarmDefinition.definition.maximumLivingMembers, 'swarm exceeded member cap');
  assert(swarm.shutdownState === swarmDefinition.definition.sourceDestructionResponse,
    'swarm did not persist its configured containment response');
  assert(result.records[0].projection.actors.some((actor) => actor.actorId === swarm.sourceActorId),
    'swarm source was not visibly projected');
  assert(boss?.crossedPhaseIds.length > 1 && boss.rewardCreated, 'boss phase or reward demonstration missing');
  assert(champion?.rewardCreated && echo?.lootCreated, 'fallen hero rewards missing');
  const championActor = result.initial.actors.find((actor) => actor.actorId === champion.actorId);
  const echoActor = result.initial.actors.find((actor) => actor.actorId === echo.actorId);
  const championSlot = result.initial.floors.flatMap((floor) => floor.placementSlots)
    .find((slot) => slot.slotId === 'slot.champion');
  assert(championActor?.populationPresentation?.name.endsWith(", the Deep's Champion") === true
    && championSlot?.required === false,
    'named Champion is not in an optional bypassable arena slot');
  assert(echoActor?.populationPresentation?.name === 'Echo of Bryn'
    && echoActor.maxHealth < championActor.maxHealth, 'Echo was not named and weaker than the Champion');
  const arenaFloor = result.initial.floors.find((floor) => floor.floorId === championActor.floorId);
  const arenaEntrance = arenaFloor.vaults.flatMap((vault) => vault.entrances)[0];
  assert(preservesRequiredRoutes({ width: arenaFloor.width, height: arenaFloor.height, tiles: arenaFloor.tiles,
    requiredPoints: [{ x: 1, y: 1 }, arenaEntrance], blockedPoints: [championActor, echoActor] }),
  'optional Champion arena blocked the required route');
  const encounters = content.entries.filter((entry) => entry.kind === 'encounter');
  const bossEncounter = encounters.find((entry) => entry.model === 'boss');
  let rejectedByNormalGate = false;
  for (let seed = 1; seed < 10_000 && !rejectedByNormalGate; seed += 1) {
    const decisions = createEncounterRunDecisions({ encounters, state: [seed >>> 0, (seed ^ 0x9e3779b9) >>> 0,
      Math.imul(seed, 0x85ebca6b) >>> 0, Math.imul(seed ^ 0xc2b2ae35, 0x27d4eb2f) >>> 0] }).decisions;
    rejectedByNormalGate = decisions.find((decision) => decision.encounterId === bossEncounter.id)?.eligible === false;
  }
  assert(rejectedByNormalGate && result.initial.populations.some((population) => population.model === 'boss'),
    'forced fixture did not override a normally rejected production encounter gate');
  const heirlooms = result.state.items.filter((item) => item.heirloom !== undefined);
  assert(heirlooms.length === 1 && heirlooms[0].heirloom.displayName === "Ada's Iron Sword",
    'exact Champion heirloom was not preserved');
  assert(result.state.items.some((item) => item.itemId.includes(`echo-loot.${echo.populationId}`)
    && item.heirloom === undefined), 'Echo ordinary loot missing');
  assert(populationDemoEquivalent(result, split), 'split execution diverged');
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const content = await compileContentDirectory({ rootDir: options.contentDirectory });
  const continuous = runPopulationDemo(content);
  const split = runPopulationDemo(content, new Set([0, 1, 2, 3, 4, 5, 6]));
  proveMilestone(continuous, split, content);

  const authoritativeEvents = continuous.records.flatMap((record) => record.authoritativeEvents);
  const publicEvents = continuous.records.flatMap((record) => record.publicEvents);
  const projections = continuous.records.map((record) => record.projection);
  const hashes = {
    'final-save': hash(encodeActiveRun(continuous.state)),
    'replay-records': hash(continuous.records),
    'authoritative-events': hash(authoritativeEvents),
    'public-events': hash(publicEvents),
    'public-projections': hash(projections),
  };
  await writeFile(candidateHashesPath, `${JSON.stringify(hashes, null, 2)}\n`, 'utf8');
  if (options.verify) await verifyReviewedHashes(hashes);

  const echoActor = continuous.initial.actors.find((actor) => actor.populationId
    === continuous.initial.populations.find((population) => population.model === 'echo')?.populationId);
  console.log('relay-limited leader group');
  console.log(stableJson(authoritativeEvents.filter((event) => event.type === 'group.awareness-shared')));
  console.log('leader outcome');
  console.log(stableJson(authoritativeEvents.filter((event) => event.type.startsWith('group.'))));
  console.log('capped visible swarm source');
  console.log(stableJson(authoritativeEvents.filter((event) => event.type.startsWith('swarm.'))));
  console.log('phased boss and unique reward');
  console.log(stableJson(authoritativeEvents.filter((event) => event.type.startsWith('boss.'))));
  console.log("Deep's Champion and exact heirloom");
  console.log(stableJson(authoritativeEvents.filter((event) => event.type.startsWith('champion.'))));
  console.log('normal production gate rejected; forced optional arena placed; required route remains passable');
  console.log(`${echoActor?.populationPresentation?.displayName ?? 'Echo of Bryn'} and ordinary loot`);
  console.log(stableJson(authoritativeEvents.filter((event) => event.type.startsWith('echo.'))));
  console.log('split execution equivalent');
  console.log(`${encodeActiveRun(split.state) === encodeActiveRun(continuous.state)}`);
  console.log('stable hashes');
  for (const [label, value] of Object.entries(hashes)) console.log(`${label} ${value}`);
  if (options.verify) console.log('population encounter milestone verified');
  else console.log(`candidate hashes written ${candidateHashesPath}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'unknown failure';
  console.error(`population demo failed: ${message.replace(/\s+/g, ' ').trim()}`);
  process.exitCode = 1;
});
