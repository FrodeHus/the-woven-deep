import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createGameplayDemoRun,
  decodeActiveRun,
  encodeActiveRun,
  projectGameplayState,
  resolveCommand,
  stableJson,
} from '../packages/engine/dist/index.js';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const reviewedHashesPath = fileURLToPath(
  new URL('../packages/engine/test/fixtures/gameplay-demo-hashes.json', import.meta.url),
);
const candidateHashesPath = '/tmp/gameplay-demo-hashes.json';

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

function directionTo(from, to) {
  const directions = {
    '0:-1': 'north', '1:-1': 'northeast', '1:0': 'east', '1:1': 'southeast',
    '0:1': 'south', '-1:1': 'southwest', '-1:0': 'west', '-1:-1': 'northwest',
  };
  const direction = directions[`${Math.sign(to.x - from.x)}:${Math.sign(to.y - from.y)}`];
  if (direction === undefined) throw new Error('scenario target is not adjacent to the hero');
  return direction;
}

function commandFactories(ids) {
  return [
    () => ({ type: 'open-door', featureId: ids.door }),
    (state) => {
      const hero = state.actors.find((actor) => actor.actorId === ids.hero);
      const door = state.features.find((feature) => feature.featureId === ids.door);
      return { type: 'move', direction: directionTo(hero, door) };
    },
    () => ({ type: 'search' }),
    () => ({ type: 'disarm', featureId: ids.trap }),
    () => ({ type: 'equip', itemId: ids.armor, slot: 'body' }),
    () => ({ type: 'attack', targetActorId: ids.rat }),
    () => ({ type: 'equip', itemId: ids.bow, slot: 'main-hand' }),
    (state) => {
      const beetle = state.actors.find((actor) => actor.actorId === ids.beetle);
      return { type: 'fire', itemId: ids.bow, target: { x: beetle.x, y: beetle.y } };
    },
    () => ({ type: 'equip', itemId: ids.sword, slot: 'main-hand' }),
    () => ({ type: 'equip', itemId: ids.lantern, slot: 'off-hand' }),
    () => ({ type: 'use-item', itemId: ids.crimsonPotion, target: null }),
    () => ({ type: 'rest', until: 'interrupted', maximumDuration: 12 }),
  ];
}

function execute(initial, content, commands, reloadAfter) {
  let state = initial;
  const records = [];
  for (const [index, command] of commands.entries()) {
    const resolution = resolveCommand(state, command, { content });
    assert(resolution.result.status === 'applied',
      `${command.commandId} was ${resolution.result.status}: ${stableJson(resolution.events)}`);
    state = resolution.state;
    const recorded = state.recentCommands.find((entry) => entry.command.commandId === command.commandId);
    assert(recorded !== undefined, `${command.commandId} was not recorded`);
    records.push({
      command,
      result: resolution.result,
      authoritativeEvents: recorded.events,
      publicEvents: resolution.events,
      projection: projectGameplayState({ state, content }),
    });
    if (reloadAfter.has(index + 1)) state = decodeActiveRun(encodeActiveRun(state));
  }
  return { state, records };
}

function materialize(initial, content, ids) {
  let state = initial;
  const commands = [];
  for (const [index, factory] of commandFactories(ids).entries()) {
    const command = {
      ...factory(state),
      commandId: `command.gameplay-${String(index + 1).padStart(2, '0')}`,
      expectedRevision: state.revision,
    };
    const resolution = resolveCommand(state, command, { content });
    assert(resolution.result.status === 'applied',
      `${command.commandId} was ${resolution.result.status}: ${stableJson(resolution.events)}`);
    commands.push(command);
    state = resolution.state;
  }
  return commands;
}

function eventLines(records, accepted) {
  return records.flatMap((record) => record.authoritativeEvents)
    .filter((event) => accepted.has(event.type))
    .map((event) => stableJson(event));
}

async function verifyReviewedHashes(hashes) {
  const reviewed = JSON.parse(await readFile(reviewedHashesPath, 'utf8'));
  assert(stableJson(hashes) === stableJson(reviewed), 'reviewed gameplay demo hashes do not match');
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const content = await compileContentDirectory({ rootDir: options.contentDirectory });
  const fixture = createGameplayDemoRun(content);
  const commands = materialize(fixture.run, content, fixture.ids);
  const continuous = execute(fixture.run, content, commands, new Set());
  const split = execute(fixture.run, content, commands, new Set([2, 5, 8]));
  assert(encodeActiveRun(split.state) === encodeActiveRun(continuous.state), 'split final save bytes diverged');
  assert(stableJson(split.records) === stableJson(continuous.records), 'split replay records diverged');

  const authoritativeEvents = continuous.records.flatMap((record) => record.authoritativeEvents);
  const publicEvents = continuous.records.flatMap((record) => record.publicEvents);
  const finalProjection = projectGameplayState({ state: continuous.state, content });
  const hashes = {
    'final-save': hash(continuous.state),
    'replay-records': hash(continuous.records),
    'authoritative-events': hash(authoritativeEvents),
    'public-events': hash(publicEvents),
    'public-projection': hash(finalProjection),
  };
  await writeFile(candidateHashesPath, `${JSON.stringify(hashes, null, 2)}\n`, 'utf8');
  if (options.verify) await verifyReviewedHashes(hashes);

  console.log('movement and reactions');
  for (const line of eventLines(continuous.records,
    new Set(['hero.moved', 'actor.moved', 'reaction.triggered']))) console.log(line);
  console.log('combat');
  for (const line of eventLines(continuous.records,
    new Set(['attack.hit', 'attack.missed', 'actor.damaged', 'actor.died', 'hero.damaged']))) console.log(line);
  console.log('items and identity');
  for (const line of eventLines(continuous.records,
    new Set(['item.equipped', 'item.unequipped', 'item.used', 'item.consumed',
      'identification.appearance-revealed', 'item.identified']))) console.log(line);
  console.log('survival and features');
  for (const line of eventLines(continuous.records,
    new Set(['hunger.stage-changed', 'hunger.restored', 'fuel.warning', 'item.light-extinguished',
      'door.opened', 'door.closed', 'feature.revealed', 'feature.searched', 'trap.disarmed',
      'trap.triggered', 'trap.disarm-failed', 'rest.completed']))) console.log(line);
  const hero = continuous.state.actors.find((actor) => actor.actorId === fixture.ids.hero);
  const lantern = continuous.state.items.find((item) => item.itemId === fixture.ids.lantern);
  console.log(stableJson({ worldTime: continuous.state.worldTime, hunger: continuous.state.survival,
    hero: { health: hero.health, maxHealth: hero.maxHealth, equipment: hero.equipment },
    lantern: { fuel: lantern.fuel, enabled: lantern.enabled } }));
  console.log('public projection');
  console.log(stableJson({ hero: finalProjection.hero, actors: finalProjection.actors,
    features: finalProjection.features, groundItems: finalProjection.groundItems }));
  console.log('stable hashes');
  for (const [label, value] of Object.entries(hashes)) console.log(`${label} ${value}`);
  if (options.verify) console.log('deterministic core gameplay replay verified');
  else console.log(`candidate hashes written ${candidateHashesPath}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'unknown failure';
  console.error(`gameplay demo failed: ${message.replace(/\s+/g, ' ').trim()}`);
  process.exitCode = 1;
});
