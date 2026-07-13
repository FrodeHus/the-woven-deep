import { z } from 'zod';
import { validateKnowledgePacking } from './knowledge.js';
import { tileIndex, type ActiveRun, type Direction } from './model.js';
import { SaveLoadError } from './save-error.js';
import { movementBlockReason, tileDefinition } from './terrain.js';
import { ENGINE_GAME_VERSION, RECENT_COMMAND_LIMIT, RNG_STREAM_NAMES, SAVE_SCHEMA_VERSION } from './versions.js';

const identifier = z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,127}$/);
const heroName = z.string().refine((name) => [...name].length >= 1 && [...name].length <= 40 && name.normalize('NFC') === name && !/[\p{Cc}\p{Cf}]/u.test(name));
const safeNonNegative = z.number().int().safe().nonnegative();
const uint8 = z.number().int().min(0).max(255);
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
const blockReason = z.enum(['blocked.bounds', 'blocked.wall', 'blocked.door', 'blocked.pillar', 'blocked.void']);
const invalidEvent = z.strictObject({ type: z.literal('action.invalid'), eventId: identifier, commandId: identifier, reason: blockReason });
const event = z.discriminatedUnion('type', [movedEvent, waitedEvent, invalidEvent]);
const appliedResult = z.strictObject({ status: z.literal('applied'), commandId: identifier, revision: safeNonNegative, turn: safeNonNegative });
const invalidResult = z.strictObject({ status: z.literal('invalid'), commandId: identifier, revision: safeNonNegative, turn: safeNonNegative, reason: blockReason });
const processedResult = z.discriminatedUnion('status', [appliedResult, invalidResult]);
const recorded = z.strictObject({ command, result: processedResult, events: z.array(event).readonly() });
const entity = z.strictObject({ entityId: identifier, x: safeNonNegative, y: safeNonNegative });
const color = z.tuple([uint8, uint8, uint8]);
const ambient = z.strictObject({ color, strength: uint8 });
const knowledge = z.strictObject({ exploredWords: z.array(uint32).readonly(), rememberedTerrainWords: z.array(uint32).readonly() });
const fixturePresentation = z.strictObject({
  glyph: z.string().refine((glyph) => [...glyph].length === 1, 'glyph must be one Unicode glyph'),
  token: identifier,
});
const fixedLocation = z.strictObject({ type: z.literal('fixed'), x: safeNonNegative, y: safeNonNegative });
const actorLocation = z.strictObject({ type: z.literal('actor'), actorId: identifier });
const light = z.strictObject({
  lightId: identifier,
  location: z.discriminatedUnion('type', [fixedLocation, actorLocation]),
  color,
  radius: z.number().int().safe().min(1).max(32),
  strength: z.number().int().safe().min(1).max(255),
  enabled: z.boolean(),
  falloff: z.literal('linear'),
  vaultPlacementId: identifier.nullable(),
  presentation: fixturePresentation.nullable(),
});
const vault = z.strictObject({
  placementId: identifier, vaultId: identifier, x: safeNonNegative, y: safeNonNegative,
  width: z.number().int().safe().positive(), height: z.number().int().safe().positive(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  reflected: z.boolean(), entrances: z.array(point).readonly(),
});
const slot = z.strictObject({
  slotId: identifier, vaultPlacementId: identifier,
  kind: z.enum(['monster', 'item', 'trap', 'npc', 'fixture', 'objective']),
  required: z.boolean(), tags: z.array(z.string()).readonly(), x: safeNonNegative, y: safeNonNegative,
});
const tile = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]);
const floor = z.strictObject({
  floorId: identifier, seed: uint32Tuple, generatorVersion: z.union([z.literal(1), z.literal(2)]),
  width: z.number().int().min(1).max(512), height: z.number().int().min(1).max(512),
  depth: z.number().int().min(0).max(10_000), tiles: z.array(tile).readonly(), entities: z.array(entity).readonly(),
  themeId: identifier, ambient, knowledge, lights: z.array(light).readonly(), stairUp: point.nullable(), stairDown: point.nullable(),
  vaults: z.array(vault).readonly(), placementSlots: z.array(slot).readonly(),
});
const hero = z.strictObject({ heroId: identifier, name: heroName, floorId: identifier, x: safeNonNegative, y: safeNonNegative, sightRadius: safeNonNegative });
const rngEntries = Object.fromEntries(RNG_STREAM_NAMES.map((name) => [name, uint32State]));
const directionOffsets: Readonly<Record<Direction, Readonly<{ x: number; y: number }>>> = {
  north: { x: 0, y: -1 }, south: { x: 0, y: 1 }, east: { x: 1, y: 0 }, west: { x: -1, y: 0 },
};

const activeRunSchema = z.strictObject({
  schemaVersion: z.literal(SAVE_SCHEMA_VERSION), gameVersion: z.literal(ENGINE_GAME_VERSION),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/), runId: identifier, runSeed: uint32Tuple,
  rng: z.strictObject(rngEntries as Record<(typeof RNG_STREAM_NAMES)[number], typeof uint32State>),
  revision: safeNonNegative, turn: safeNonNegative, hero, activeFloorId: identifier,
  floors: z.array(floor).min(1).readonly(), recentCommands: z.array(recorded).max(RECENT_COMMAND_LIMIT).readonly(),
});

function fail(path: string, reason: string): never {
  throw new SaveLoadError('invalid_save', path, `Invalid save at ${path}: ${reason}`);
}

type SavedFloor = z.infer<typeof floor>;

function cell(floorValue: SavedFloor, x: number, y: number, path: string): number {
  const index = tileIndex(floorValue, x, y);
  if (index === undefined) fail(path, 'position is outside its floor');
  return index;
}

function ensureWalkable(floorValue: SavedFloor, x: number, y: number, path: string): void {
  const index = cell(floorValue, x, y, path);
  if (!tileDefinition(floorValue.tiles[index]!).walkable) fail(path, 'position is not on walkable terrain');
}

function validateOrderedIds(values: readonly string[], path: string, noun: string, idField?: string): void {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1]! >= values[index]!) fail(`${path}.${index}${idField ? `.${idField}` : ''}`, `${noun} identifiers must be unique and strictly increasing`);
  }
}

function overlaps(left: z.infer<typeof vault>, right: z.infer<typeof vault>): boolean {
  return left.x < right.x + right.width && right.x < left.x + left.width
    && left.y < right.y + right.height && right.y < left.y + left.height;
}

interface GlobalIds {
  readonly entities: Set<string>;
  readonly lights: Set<string>;
  readonly vaultPlacements: Set<string>;
  readonly slots: Set<string>;
}

function validateFloor(floorValue: SavedFloor, floorIndex: number, globalIds: GlobalIds): void {
  const base = `floors.${floorIndex}`;
  const cellCount = floorValue.width * floorValue.height;
  if (floorValue.tiles.length !== cellCount) fail(`${base}.tiles`, 'tile length does not match dimensions');
  try { validateKnowledgePacking(floorValue.knowledge, cellCount); }
  catch (cause) { fail(`${base}.knowledge`, cause instanceof Error ? cause.message : 'invalid knowledge packing'); }

  validateOrderedIds(floorValue.entities.map((entry) => entry.entityId), `${base}.entities`, 'entity', 'entityId');
  for (const [entityIndex, entityValue] of floorValue.entities.entries()) {
    if (globalIds.entities.has(entityValue.entityId)) fail(`${base}.entities.${entityIndex}.entityId`, 'entity identifier is duplicated');
    globalIds.entities.add(entityValue.entityId);
    ensureWalkable(floorValue, entityValue.x, entityValue.y, `${base}.entities.${entityIndex}`);
  }

  const stairs = [[floorValue.stairUp, 4, 'stairUp'], [floorValue.stairDown, 5, 'stairDown']] as const;
  for (const [position, expectedTile, name] of stairs) {
    const matchingTiles = floorValue.tiles.reduce<number[]>((indexes, tileValue, index) => {
      if (tileValue === expectedTile) indexes.push(index);
      return indexes;
    }, []);
    if (position === null) {
      if (matchingTiles.length !== 0) fail(`${base}.${name}`, `${name} metadata is required for its terrain tile`);
      continue;
    }
    if (floorValue.tiles[cell(floorValue, position.x, position.y, `${base}.${name}`)] !== expectedTile) {
      fail(`${base}.${name}`, `${name} must match its terrain tile`);
    }
    if (matchingTiles.length !== 1) fail(`${base}.${name}`, `${name} must identify the only matching terrain tile`);
  }
  if (floorValue.stairUp && floorValue.stairDown && floorValue.stairUp.x === floorValue.stairDown.x && floorValue.stairUp.y === floorValue.stairDown.y) {
    fail(`${base}.stairDown`, 'stair positions must be distinct');
  }

  validateOrderedIds(floorValue.vaults.map((entry) => entry.placementId), `${base}.vaults`, 'vault placement', 'placementId');
  const placements = new Map(floorValue.vaults.map((entry) => [entry.placementId, entry]));
  for (const [vaultIndex, placement] of floorValue.vaults.entries()) {
    const path = `${base}.vaults.${vaultIndex}`;
    if (globalIds.vaultPlacements.has(placement.placementId)) fail(`${path}.placementId`, 'vault placement identifier is duplicated');
    globalIds.vaultPlacements.add(placement.placementId);
    if (placement.x + placement.width > floorValue.width || placement.y + placement.height > floorValue.height) fail(path, 'vault placement is outside its floor');
    for (let otherIndex = 0; otherIndex < vaultIndex; otherIndex += 1) {
      if (overlaps(floorValue.vaults[otherIndex]!, placement)) fail(path, 'vault placements overlap');
    }
    const entranceCells = new Set<number>();
    for (const [entranceIndex, entrance] of placement.entrances.entries()) {
      const entrancePath = `${path}.entrances.${entranceIndex}`;
      if (entrance.x < placement.x || entrance.x >= placement.x + placement.width || entrance.y < placement.y || entrance.y >= placement.y + placement.height) fail(entrancePath, 'entrance is outside its vault placement');
      const index = cell(floorValue, entrance.x, entrance.y, entrancePath);
      if (!tileDefinition(floorValue.tiles[index]!).potentiallyTraversable) fail(entrancePath, 'entrance is not on traversable terrain');
      if (entranceCells.has(index)) fail(entrancePath, 'entrance position is duplicated');
      entranceCells.add(index);
    }
  }

  validateOrderedIds(floorValue.placementSlots.map((entry) => entry.slotId), `${base}.placementSlots`, 'slot', 'slotId');
  for (const [slotIndex, placementSlot] of floorValue.placementSlots.entries()) {
    const path = `${base}.placementSlots.${slotIndex}`;
    if (globalIds.slots.has(placementSlot.slotId)) fail(`${path}.slotId`, 'slot identifier is duplicated');
    globalIds.slots.add(placementSlot.slotId);
    const owner = placements.get(placementSlot.vaultPlacementId);
    if (!owner) fail(`${path}.vaultPlacementId`, 'slot owner does not exist');
    if (placementSlot.x < owner.x || placementSlot.x >= owner.x + owner.width || placementSlot.y < owner.y || placementSlot.y >= owner.y + owner.height) fail(path, 'slot is outside its vault placement');
    const index = cell(floorValue, placementSlot.x, placementSlot.y, path);
    if (floorValue.tiles[index] === 6) fail(path, 'slot cannot occupy void terrain');
  }

  validateOrderedIds(floorValue.lights.map((entry) => entry.lightId), `${base}.lights`, 'light', 'lightId');
  const presentedCells = new Set<number>();
  for (const [lightIndex, source] of floorValue.lights.entries()) {
    const path = `${base}.lights.${lightIndex}`;
    if (globalIds.lights.has(source.lightId)) fail(`${path}.lightId`, 'light identifier is duplicated');
    globalIds.lights.add(source.lightId);
    if (source.location.type === 'actor') {
      if (source.vaultPlacementId !== null || source.presentation !== null) fail(path, 'actor-attached lights cannot have vault ownership or fixture presentation');
      continue;
    }
    const index = cell(floorValue, source.location.x, source.location.y, `${path}.location`);
    if (floorValue.tiles[index] === 6) fail(`${path}.location`, 'fixed light cannot occupy void terrain');
    if (source.vaultPlacementId !== null) {
      const owner = placements.get(source.vaultPlacementId);
      if (!owner) fail(`${path}.vaultPlacementId`, 'light owner does not exist');
      if (source.presentation === null) fail(`${path}.presentation`, 'vault-owned light requires fixture presentation');
      if (source.location.x < owner.x || source.location.x >= owner.x + owner.width
        || source.location.y < owner.y || source.location.y >= owner.y + owner.height) {
        fail(`${path}.location`, 'vault-owned light is outside its vault placement');
      }
    }
    if (source.presentation !== null) {
      if (presentedCells.has(index)) fail(`${path}.location`, 'presented fixed lights cannot share a cell');
      presentedCells.add(index);
    }
  }
}

function validateSemantics(run: z.infer<typeof activeRunSchema>): ActiveRun {
  const floorIds = new Set<string>();
  const globalIds: GlobalIds = {
    entities: new Set<string>(), lights: new Set<string>(), vaultPlacements: new Set<string>(), slots: new Set<string>(),
  };
  for (const [floorIndex, floorValue] of run.floors.entries()) {
    const previousFloor = run.floors[floorIndex - 1];
    if (previousFloor && previousFloor.floorId >= floorValue.floorId) fail(`floors.${floorIndex}.floorId`, 'floor identifiers must be strictly increasing');
    if (floorIds.has(floorValue.floorId)) fail(`floors.${floorIndex}.floorId`, 'floor identifier is duplicated');
    floorIds.add(floorValue.floorId);
    validateFloor(floorValue, floorIndex, globalIds);
  }
  const activeFloor = run.floors.find((candidate) => candidate.floorId === run.activeFloorId);
  if (!activeFloor) fail('activeFloorId', 'active floor does not exist');
  if (run.hero.floorId !== run.activeFloorId) fail('hero.floorId', 'hero must occupy the active floor');
  ensureWalkable(activeFloor, run.hero.x, run.hero.y, 'hero');
  if (globalIds.entities.has(run.hero.heroId)) fail('hero.heroId', 'hero identifier conflicts with a saved entity');
  for (const [floorIndex, floorValue] of run.floors.entries()) {
    for (const [lightIndex, source] of floorValue.lights.entries()) {
      if (source.location.type === 'actor' && source.location.actorId === run.hero.heroId && floorValue.floorId === run.hero.floorId) continue;
      const actorId = source.location.type === 'actor' ? source.location.actorId : undefined;
      if (actorId !== undefined && !floorValue.entities.some((entry) => entry.entityId === actorId)) {
        fail(`floors.${floorIndex}.lights.${lightIndex}.location.actorId`, 'attached actor does not exist on this floor');
      }
    }
  }
  if (run.turn !== run.revision) fail('turn', 'turn and revision must match in schema v2');

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
      if (eventValue.type !== 'action.invalid' || eventValue.commandId !== recordValue.command.commandId || eventValue.reason !== recordValue.result.reason) fail(`${path}.events.0`, 'invalid result and event are inconsistent');
    } else if (recordValue.command.type === 'wait') {
      if (eventValue.type !== 'hero.waited' || eventValue.heroId !== run.hero.heroId) fail(`${path}.events.0`, 'wait result and event are inconsistent');
      ensureWalkable(activeFloor, eventValue.x, eventValue.y, `${path}.events.0`);
    } else if (eventValue.type !== 'hero.moved' || eventValue.heroId !== run.hero.heroId) fail(`${path}.events.0`, 'move result and event are inconsistent');
    else {
      ensureWalkable(activeFloor, eventValue.from.x, eventValue.from.y, `${path}.events.0.from`);
      ensureWalkable(activeFloor, eventValue.to.x, eventValue.to.y, `${path}.events.0.to`);
    }
    if (recordValue.result.revision < previousRevision || recordValue.result.revision > run.revision) fail(`${path}.result.revision`, 'record revisions are not monotonic');
    if (recordValue.result.turn > run.turn) fail(`${path}.result.turn`, 'record turn exceeds current turn');
    if (recordValue.result.turn !== recordValue.result.revision) fail(`${path}.result.turn`, 'result turn and revision must match in schema v2');
    if (recordValue.result.status === 'applied' && recordValue.result.revision !== recordValue.command.expectedRevision + 1) fail(`${path}.result.revision`, 'applied revision is inconsistent');
    if (recordValue.result.status === 'invalid' && recordValue.result.revision !== recordValue.command.expectedRevision) fail(`${path}.result.revision`, 'invalid revision is inconsistent');
    const previousRecord = run.recentCommands[index - 1];
    if (previousRecord && recordValue.command.expectedRevision !== previousRecord.result.revision) fail(`${path}.command.expectedRevision`, 'command revision does not follow the preceding result');
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
      const actualReason = attemptedIndex === undefined ? 'blocked.bounds' : movementBlockReason(activeFloor.tiles[attemptedIndex]!);
      if (recordValue.result.reason !== actualReason) fail(`${path}.result.reason`, 'invalid reason does not match the active floor');
      continue;
    }
    if (recordValue.command.type === 'wait') {
      if (eventValue.type !== 'hero.waited' || eventValue.x !== knownPosition.x || eventValue.y !== knownPosition.y) fail(`${path}.events.0`, 'wait position does not match the retained position chain');
      continue;
    }
    if (eventValue.type !== 'hero.moved') fail(`${path}.events.0`, 'move result and event are inconsistent');
    if (eventValue.to.x !== knownPosition.x || eventValue.to.y !== knownPosition.y) fail(`${path}.events.0.to`, 'move destination does not match the retained position chain');
    const offset = directionOffsets[recordValue.command.direction];
    if (eventValue.to.x !== eventValue.from.x + offset.x || eventValue.to.y !== eventValue.from.y + offset.y) fail(`${path}.events.0.to`, 'move does not match its command direction');
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
