import { z } from 'zod';
import { tileIndex, type ActiveRun, type Direction } from './model.js';
import { SaveLoadError } from './save-error.js';
import { ENGINE_GAME_VERSION, RECENT_COMMAND_LIMIT, RNG_STREAM_NAMES, SAVE_SCHEMA_VERSION } from './versions.js';

const identifier = z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,127}$/);
const heroName = z.string().refine((name) => [...name].length >= 1 && [...name].length <= 40 && name.normalize('NFC') === name && !/[\p{Cc}\p{Cf}]/u.test(name));
const safeNonNegative = z.number().int().safe().nonnegative();
const uint32 = z.number().int().min(0).max(0xffff_ffff);
const uint32Tuple = z.tuple([uint32, uint32, uint32, uint32]);
const uint32State = uint32Tuple.refine((state) => state.some((word) => word !== 0), 'state must not be all zero');
const point = z.strictObject({ x: safeNonNegative, y: safeNonNegative });
const direction = z.enum(['north', 'south', 'east', 'west']);
const moveCommand = z.strictObject({ type: z.literal('move'), commandId: identifier, expectedRevision: safeNonNegative, direction });
const waitCommand = z.strictObject({ type: z.literal('wait'), commandId: identifier, expectedRevision: safeNonNegative });
const command = z.discriminatedUnion('type', [moveCommand, waitCommand]);
const movedEvent = z.strictObject({ type: z.literal('hero.moved'), eventId: identifier, heroId: identifier, from: point, to: point });
const waitedEvent = z.strictObject({ type: z.literal('hero.waited'), eventId: identifier, heroId: identifier, x: safeNonNegative, y: safeNonNegative });
const invalidEvent = z.strictObject({ type: z.literal('action.invalid'), eventId: identifier, commandId: identifier, reason: z.enum(['blocked.bounds', 'blocked.wall']) });
const event = z.discriminatedUnion('type', [movedEvent, waitedEvent, invalidEvent]);
const appliedResult = z.strictObject({ status: z.literal('applied'), commandId: identifier, revision: safeNonNegative, turn: safeNonNegative });
const invalidResult = z.strictObject({ status: z.literal('invalid'), commandId: identifier, revision: safeNonNegative, turn: safeNonNegative, reason: z.enum(['blocked.bounds', 'blocked.wall']) });
const processedResult = z.discriminatedUnion('status', [appliedResult, invalidResult]);
const recorded = z.strictObject({ command, result: processedResult, events: z.array(event).readonly() });
const entity = z.strictObject({ entityId: identifier, x: safeNonNegative, y: safeNonNegative });
const floor = z.strictObject({
  floorId: identifier,
  seed: uint32Tuple,
  generatorVersion: z.literal(1),
  width: z.number().int().min(1).max(512),
  height: z.number().int().min(1).max(512),
  depth: z.number().int().min(0).max(10_000),
  tiles: z.array(z.union([z.literal(0), z.literal(1)])).readonly(),
  entities: z.array(entity).readonly(),
});
const hero = z.strictObject({ heroId: identifier, name: heroName, floorId: identifier, x: safeNonNegative, y: safeNonNegative });
const rngEntries = Object.fromEntries(RNG_STREAM_NAMES.map((name) => [name, uint32State]));
const directionOffsets: Readonly<Record<Direction, Readonly<{ x: number; y: number }>>> = {
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
  east: { x: 1, y: 0 },
  west: { x: -1, y: 0 },
};

const activeRunSchema = z.strictObject({
  schemaVersion: z.literal(SAVE_SCHEMA_VERSION),
  gameVersion: z.literal(ENGINE_GAME_VERSION),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  runId: identifier,
  runSeed: uint32Tuple,
  rng: z.strictObject(rngEntries as Record<(typeof RNG_STREAM_NAMES)[number], typeof uint32State>),
  revision: safeNonNegative,
  turn: safeNonNegative,
  hero,
  activeFloorId: identifier,
  floors: z.array(floor).min(1).readonly(),
  recentCommands: z.array(recorded).max(RECENT_COMMAND_LIMIT).readonly(),
});

function fail(path: string, reason: string): never {
  throw new SaveLoadError('invalid_save', path, `Invalid save at ${path}: ${reason}`);
}

function ensurePosition(floorValue: z.infer<typeof floor>, x: number, y: number, path: string): void {
  if (x >= floorValue.width || y >= floorValue.height) fail(path, 'position is outside its floor');
  if (floorValue.tiles[y * floorValue.width + x] !== 1) fail(path, 'position is not on walkable terrain');
}

function validateSemantics(run: z.infer<typeof activeRunSchema>): ActiveRun {
  const floorIds = new Set<string>();
  const entityIds = new Set<string>();
  for (const [floorIndex, floorValue] of run.floors.entries()) {
    const previousFloor = run.floors[floorIndex - 1];
    if (previousFloor && previousFloor.floorId >= floorValue.floorId) fail(`floors.${floorIndex}.floorId`, 'floor identifiers must be strictly increasing');
    if (floorIds.has(floorValue.floorId)) fail(`floors.${floorIndex}.floorId`, 'floor identifier is duplicated');
    floorIds.add(floorValue.floorId);
    if (floorValue.tiles.length !== floorValue.width * floorValue.height) fail(`floors.${floorIndex}.tiles`, 'tile length does not match dimensions');
    for (const [entityIndex, entityValue] of floorValue.entities.entries()) {
      if (entityIds.has(entityValue.entityId)) fail(`floors.${floorIndex}.entities.${entityIndex}.entityId`, 'entity identifier is duplicated');
      entityIds.add(entityValue.entityId);
      ensurePosition(floorValue, entityValue.x, entityValue.y, `floors.${floorIndex}.entities.${entityIndex}`);
    }
  }
  const activeFloor = run.floors.find((candidate) => candidate.floorId === run.activeFloorId);
  if (!activeFloor) fail('activeFloorId', 'active floor does not exist');
  if (run.hero.floorId !== run.activeFloorId) fail('hero.floorId', 'hero must occupy the active floor');
  ensurePosition(activeFloor, run.hero.x, run.hero.y, 'hero');
  if (run.turn !== run.revision) fail('turn', 'turn and revision must match in schema v1');

  const commandIds = new Set<string>();
  let previousRevision = 0;
  for (const [index, recordValue] of run.recentCommands.entries()) {
    const path = `recentCommands.${index}`;
    if (commandIds.has(recordValue.command.commandId)) fail(`${path}.command.commandId`, 'command identifier is duplicated');
    commandIds.add(recordValue.command.commandId);
    if (recordValue.command.commandId !== recordValue.result.commandId) fail(`${path}.result.commandId`, 'result does not match command');
    if (recordValue.events.length !== 1) fail(`${path}.events`, 'processed commands require exactly one event');
    if (recordValue.events.some((entry) => entry.eventId !== recordValue.command.commandId)) fail(`${path}.events`, 'event identifier does not match command');
    const eventValue = recordValue.events[0]!;
    if (recordValue.result.status === 'invalid') {
      if (eventValue.type !== 'action.invalid' || eventValue.commandId !== recordValue.command.commandId || eventValue.reason !== recordValue.result.reason) {
        fail(`${path}.events.0`, 'invalid result and event are inconsistent');
      }
    } else if (recordValue.command.type === 'wait') {
      if (eventValue.type !== 'hero.waited' || eventValue.heroId !== run.hero.heroId) fail(`${path}.events.0`, 'wait result and event are inconsistent');
      ensurePosition(activeFloor, eventValue.x, eventValue.y, `${path}.events.0`);
    } else if (eventValue.type !== 'hero.moved' || eventValue.heroId !== run.hero.heroId) {
      fail(`${path}.events.0`, 'move result and event are inconsistent');
    } else {
      ensurePosition(activeFloor, eventValue.from.x, eventValue.from.y, `${path}.events.0.from`);
      ensurePosition(activeFloor, eventValue.to.x, eventValue.to.y, `${path}.events.0.to`);
    }
    if (recordValue.result.revision < previousRevision || recordValue.result.revision > run.revision) fail(`${path}.result.revision`, 'record revisions are not monotonic');
    if (recordValue.result.turn > run.turn) fail(`${path}.result.turn`, 'record turn exceeds current turn');
    if (recordValue.result.turn !== recordValue.result.revision) fail(`${path}.result.turn`, 'result turn and revision must match in schema v1');
    if (recordValue.result.status === 'applied' && recordValue.result.revision !== recordValue.command.expectedRevision + 1) fail(`${path}.result.revision`, 'applied revision is inconsistent');
    if (recordValue.result.status === 'invalid' && recordValue.result.revision !== recordValue.command.expectedRevision) fail(`${path}.result.revision`, 'invalid revision is inconsistent');
    const previousRecord = run.recentCommands[index - 1];
    if (previousRecord && recordValue.command.expectedRevision !== previousRecord.result.revision) {
      fail(`${path}.command.expectedRevision`, 'command revision does not follow the preceding result');
    }
    previousRevision = recordValue.result.revision;
  }

  const finalRecord = run.recentCommands.at(-1);
  if (finalRecord) {
    const finalIndex = run.recentCommands.length - 1;
    if (finalRecord.result.revision !== run.revision) fail(`recentCommands.${finalIndex}.result.revision`, 'final result does not match current revision');
    if (finalRecord.result.turn !== run.turn) fail(`recentCommands.${finalIndex}.result.turn`, 'final result does not match current turn');
  }

  let knownPosition = { x: run.hero.x, y: run.hero.y };
  for (let index = run.recentCommands.length - 1; index >= 0; index -= 1) {
    const recordValue = run.recentCommands[index]!;
    const eventValue = recordValue.events[0]!;
    const path = `recentCommands.${index}`;
    if (recordValue.result.status === 'invalid') {
      if (recordValue.command.type !== 'move') fail(`${path}.command.type`, 'only movement can produce an invalid result');
      const offset = directionOffsets[recordValue.command.direction];
      const attempted = { x: knownPosition.x + offset.x, y: knownPosition.y + offset.y };
      const attemptedIndex = tileIndex(activeFloor, attempted.x, attempted.y);
      const actualReason = attemptedIndex === undefined ? 'blocked.bounds' : activeFloor.tiles[attemptedIndex] === 0 ? 'blocked.wall' : undefined;
      if (recordValue.result.reason !== actualReason) fail(`${path}.result.reason`, 'invalid reason does not match the active floor');
      continue;
    }
    if (recordValue.command.type === 'wait') {
      if (eventValue.type !== 'hero.waited' || eventValue.x !== knownPosition.x || eventValue.y !== knownPosition.y) {
        fail(`${path}.events.0`, 'wait position does not match the retained position chain');
      }
      continue;
    }
    if (eventValue.type !== 'hero.moved') fail(`${path}.events.0`, 'move result and event are inconsistent');
    if (eventValue.to.x !== knownPosition.x || eventValue.to.y !== knownPosition.y) {
      fail(`${path}.events.0.to`, 'move destination does not match the retained position chain');
    }
    const offset = directionOffsets[recordValue.command.direction];
    if (eventValue.to.x !== eventValue.from.x + offset.x || eventValue.to.y !== eventValue.from.y + offset.y) {
      fail(`${path}.events.0.to`, 'move does not match its command direction');
    }
    knownPosition = eventValue.from;
  }
  return run as ActiveRun;
}

export function validateActiveRun(input: unknown): ActiveRun {
  const parsed = activeRunSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const path = issue.path.join('.') || '$';
    throw new SaveLoadError('invalid_save', path, `Invalid save at ${path}: ${issue.message}`);
  }
  return validateSemantics(parsed.data);
}
