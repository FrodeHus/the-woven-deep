import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  assertOpaqueId,
  createDemoContentPack,
  createDemoRun,
  decodeActiveRun,
  encodeActiveRun,
  heroActor,
  resolveCommand,
  stableJson,
} from '../packages/engine/dist/index.js';

const directions = new Set([
  'north',
  'northeast',
  'east',
  'southeast',
  'south',
  'southwest',
  'west',
  'northwest',
]);
const context = { content: createDemoContentPack() };

function lineError(lineNumber, message) {
  return new Error(`line ${lineNumber}: ${message}`);
}

function commandId(value, lineNumber) {
  try {
    assertOpaqueId(value, 'command ID');
  } catch (error) {
    throw lineError(lineNumber, error instanceof Error ? error.message : String(error));
  }
  return value;
}

function revision(value, lineNumber) {
  const parsed = Number(value);
  if (value === undefined || value === '' || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw lineError(lineNumber, 'revision must be a non-negative safe integer');
  }
  return parsed;
}

function parseCommand(fields, lineNumber) {
  const [directive, idValue, revisionValue, direction, ...extra] = fields;
  if (directive === 'move') {
    if (
      idValue === undefined ||
      revisionValue === undefined ||
      direction === undefined ||
      extra.length > 0
    ) {
      throw lineError(lineNumber, 'move requires <id> <expectedRevision> <direction>');
    }
    if (!directions.has(direction)) throw lineError(lineNumber, `invalid direction ${direction}`);
    return {
      type: 'move',
      commandId: commandId(idValue, lineNumber),
      expectedRevision: revision(revisionValue, lineNumber),
      direction,
    };
  }
  if (directive === 'wait') {
    if (
      idValue === undefined ||
      revisionValue === undefined ||
      direction !== undefined ||
      extra.length > 0
    ) {
      throw lineError(lineNumber, 'wait requires <id> <expectedRevision>');
    }
    return {
      type: 'wait',
      commandId: commandId(idValue, lineNumber),
      expectedRevision: revision(revisionValue, lineNumber),
    };
  }
  return undefined;
}

export async function runProgram(path, reloadSaves) {
  const source = await readFile(path, 'utf8');
  const commands = new Map();
  const steps = [];
  let state = createDemoRun();
  let saved;

  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (line === '') continue;
    const fields = line.split(/\s+/);
    const directive = fields[0];
    const parsed = parseCommand(fields, lineNumber);

    if (parsed) {
      commands.set(parsed.commandId, parsed);
      const resolution = resolveCommand(state, parsed, context);
      state = resolution.state;
      steps.push({ command: parsed, result: resolution.result, events: resolution.events });
      continue;
    }

    if (directive === 'save') {
      if (fields.length !== 1) throw lineError(lineNumber, 'save does not accept arguments');
      saved = encodeActiveRun(state);
      continue;
    }

    if (directive === 'reload') {
      if (fields.length !== 1) throw lineError(lineNumber, 'reload does not accept arguments');
      if (saved === undefined) throw lineError(lineNumber, 'reload requires a preceding save');
      if (reloadSaves) state = decodeActiveRun(saved);
      continue;
    }

    if (directive === 'repeat') {
      if (fields.length !== 2) throw lineError(lineNumber, 'repeat requires <id>');
      const id = commandId(fields[1], lineNumber);
      const repeated = commands.get(id);
      if (repeated === undefined) throw lineError(lineNumber, `unknown repeated command ID ${id}`);
      const resolution = resolveCommand(state, repeated, context);
      state = resolution.state;
      steps.push({ command: repeated, result: resolution.result, events: resolution.events });
      continue;
    }

    throw lineError(lineNumber, `unknown directive ${directive}`);
  }

  return { state, steps };
}

function printRun(run) {
  for (const step of run.steps) {
    const reason = step.result.status === 'applied' ? '' : ` ${step.result.reason}`;
    process.stdout.write(`${step.command.commandId} ${step.result.status}${reason}\n`);
    for (const event of step.events) {
      process.stdout.write(`event ${event.type} ${stableJson(event)}\n`);
    }
  }
  const { turn, revision: finalRevision } = run.state;
  const hero = heroActor(run.state);
  process.stdout.write(`hero (${hero.x},${hero.y}) turn ${turn} revision ${finalRevision}\n`);
  const hash = createHash('sha256').update(encodeActiveRun(run.state)).digest('hex');
  process.stdout.write(`state ${hash}\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const verify = args[0] === '--verify';
  const path = verify ? args[1] : args[0];
  if (path === undefined || (verify ? args.length < 2 || args.length > 3 : args.length !== 1)) {
    throw new Error(
      'usage: engine-demo <commands> | engine-demo --verify <split-commands> [continuous-comparison-commands]',
    );
  }

  const run = await runProgram(path, true);
  printRun(run);
  if (verify) {
    const continuous = await runProgram(args[2] ?? path, false);
    if (
      encodeActiveRun(run.state) !== encodeActiveRun(continuous.state) ||
      stableJson(run.steps) !== stableJson(continuous.steps)
    ) {
      throw new Error('deterministic replay diverged');
    }
    process.stdout.write('deterministic replay verified\n');
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`engine demo failed: ${message}\n`);
  process.exitCode = 1;
}
