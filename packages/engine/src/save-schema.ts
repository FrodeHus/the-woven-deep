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
const direction = z.enum(['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest']);
const equipmentSlot = z.enum(['main-hand', 'off-hand', 'body', 'head', 'hands', 'feet', 'neck', 'left-ring', 'right-ring']);
const positiveQuantity = z.number().int().safe().positive();
const moveCommand = z.strictObject({ type: z.literal('move'), commandId: identifier, expectedRevision: safeNonNegative, direction });
const waitCommand = z.strictObject({ type: z.literal('wait'), commandId: identifier, expectedRevision: safeNonNegative });
const commandBase = { commandId: identifier, expectedRevision: safeNonNegative } as const;
const command = z.discriminatedUnion('type', [
  moveCommand, waitCommand,
  z.strictObject({ ...commandBase, type: z.literal('attack'), targetActorId: identifier }),
  z.strictObject({ ...commandBase, type: z.literal('fire'), itemId: identifier, target: point }),
  z.strictObject({ ...commandBase, type: z.literal('cast'), spellId: identifier, target: point.nullable() }),
  z.strictObject({ ...commandBase, type: z.literal('throw-item'), itemId: identifier, target: point }),
  z.strictObject({ ...commandBase, type: z.literal('use-item'), itemId: identifier, target: point.nullable() }),
  z.strictObject({ ...commandBase, type: z.literal('equip'), itemId: identifier, slot: equipmentSlot }),
  z.strictObject({ ...commandBase, type: z.literal('unequip'), slot: equipmentSlot }),
  z.strictObject({ ...commandBase, type: z.literal('pickup'), itemId: identifier, quantity: positiveQuantity }),
  z.strictObject({ ...commandBase, type: z.literal('drop'), itemId: identifier, quantity: positiveQuantity }),
  z.strictObject({ ...commandBase, type: z.literal('split-stack'), itemId: identifier, quantity: positiveQuantity }),
  z.strictObject({ ...commandBase, type: z.literal('refuel'), itemId: identifier, fuelItemId: identifier, quantity: positiveQuantity }),
  z.strictObject({ ...commandBase, type: z.literal('toggle-light'), itemId: identifier, enabled: z.boolean() }),
  z.strictObject({ ...commandBase, type: z.literal('open-door'), featureId: identifier }),
  z.strictObject({ ...commandBase, type: z.literal('close-door'), featureId: identifier }),
  z.strictObject({ ...commandBase, type: z.literal('search') }),
  z.strictObject({ ...commandBase, type: z.literal('disarm'), featureId: identifier }),
  z.strictObject({ ...commandBase, type: z.literal('rest'), until: z.enum(['healed', 'interrupted']) }),
]);
const movedEvent = z.strictObject({ type: z.literal('hero.moved'), eventId: identifier, heroId: identifier, from: point, to: point });
const waitedEvent = z.strictObject({ type: z.literal('hero.waited'), eventId: identifier, heroId: identifier, x: safeNonNegative, y: safeNonNegative });
const blockReason = z.enum([
  'blocked.bounds', 'blocked.wall', 'blocked.door', 'blocked.pillar', 'blocked.void',
  'blocked.corner', 'blocked.actor', 'action.unavailable',
]);
const invalidEvent = z.strictObject({ type: z.literal('action.invalid'), eventId: identifier, commandId: identifier, reason: blockReason });
const attackBase = { eventId: identifier, actorId: identifier, targetActorId: identifier,
  naturalRoll: z.number().int().min(1).max(20), total: z.number().int().safe(), defense: z.number().int().safe() } as const;
const attackMissedEvent = z.strictObject({ ...attackBase, type: z.literal('attack.missed') });
const attackHitEvent = z.strictObject({
  ...attackBase, type: z.literal('attack.hit'), critical: z.boolean(), rolledDice: positiveQuantity,
  rolledDamage: safeNonNegative, effectiveDamage: safeNonNegative,
  damageType: z.enum(['physical', 'fire', 'cold', 'lightning', 'poison', 'arcane']),
});
const actorDamagedEvent = z.strictObject({ type: z.literal('actor.damaged'), eventId: identifier,
  actorId: identifier, sourceActorId: identifier, amount: safeNonNegative, health: safeNonNegative });
const actorDiedEvent = z.strictObject({ type: z.literal('actor.died'), eventId: identifier,
  actorId: identifier, contentId: identifier, killerActorId: identifier });
const actorHealedEvent = z.strictObject({ type: z.literal('actor.healed'), eventId: identifier,
  actorId: identifier, sourceActorId: identifier, amount: safeNonNegative, health: safeNonNegative });
const conditionAppliedEvent = z.strictObject({ type: z.literal('condition.applied'), eventId: identifier,
  actorId: identifier, sourceActorId: identifier, conditionId: identifier, stacks: positiveQuantity, expiresAt: safeNonNegative.nullable() });
const conditionRemovedEvent = z.strictObject({ type: z.enum(['condition.removed', 'condition.expired']),
  eventId: identifier, actorId: identifier, conditionId: identifier });
const actorForcedMoveEvent = z.strictObject({ type: z.literal('actor.forced-move'), eventId: identifier,
  actorId: identifier, from: point, to: point });
const reactionTriggeredEvent = z.strictObject({ type: z.literal('reaction.triggered'), eventId: identifier,
  actorId: identifier, targetActorId: identifier });
const relationshipChangedEvent = z.strictObject({ type: z.literal('relationship.changed'), eventId: identifier,
  actorId: identifier, targetActorId: identifier, relationship: z.enum(['friendly', 'neutral', 'hostile']) });
const actorTurnStartedEvent = z.strictObject({ type: z.literal('actor.turn.started'), eventId: identifier,
  actorId: identifier });
const actorTurnCompletedEvent = z.strictObject({ type: z.literal('actor.turn.completed'), eventId: identifier,
  actorId: identifier, actionType: z.enum(['move', 'wait', 'bump-attack']) });
const actorMovedEvent = z.strictObject({ type: z.literal('actor.moved'), eventId: identifier,
  actorId: identifier, from: point, to: point });
const event = z.discriminatedUnion('type', [
  movedEvent, waitedEvent, invalidEvent, attackMissedEvent, attackHitEvent, actorDamagedEvent,
  actorDiedEvent, actorHealedEvent, conditionAppliedEvent, conditionRemovedEvent, actorForcedMoveEvent,
  reactionTriggeredEvent, relationshipChangedEvent, actorTurnStartedEvent, actorTurnCompletedEvent, actorMovedEvent,
]);
const appliedResult = z.strictObject({ status: z.literal('applied'), commandId: identifier, revision: safeNonNegative, turn: safeNonNegative });
const invalidResult = z.strictObject({ status: z.literal('invalid'), commandId: identifier, revision: safeNonNegative, turn: safeNonNegative, reason: blockReason });
const processedResult = z.discriminatedUnion('status', [appliedResult, invalidResult]);
const recorded = z.strictObject({
  command,
  result: processedResult,
  events: z.array(event).readonly(),
  publicEvents: z.array(event).readonly(),
});
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
const nullableIdentifier = identifier.nullable();
const attributes = z.strictObject({
  might: safeNonNegative,
  agility: safeNonNegative,
  vitality: safeNonNegative,
  wits: safeNonNegative,
  resolve: safeNonNegative,
});
const condition = z.strictObject({
  conditionId: identifier,
  sourceActorId: nullableIdentifier,
  appliedAt: safeNonNegative,
  expiresAt: safeNonNegative.nullable(),
  stacks: z.number().int().safe().positive(),
});
const equipment = z.strictObject({
  'main-hand': nullableIdentifier,
  'off-hand': nullableIdentifier,
  body: nullableIdentifier,
  head: nullableIdentifier,
  hands: nullableIdentifier,
  feet: nullableIdentifier,
  neck: nullableIdentifier,
  'left-ring': nullableIdentifier,
  'right-ring': nullableIdentifier,
});
const behaviorValue = z.union([z.string(), z.number().int().safe(), z.boolean(), z.null()]);
const actor = z.strictObject({
  actorId: identifier,
  contentId: identifier,
  playerControlled: z.boolean(),
  floorId: identifier,
  x: safeNonNegative,
  y: safeNonNegative,
  attributes,
  health: safeNonNegative,
  maxHealth: safeNonNegative,
  energy: z.number().int().safe(),
  speed: z.number().int().safe().positive(),
  reactionReady: z.boolean(),
  disposition: z.enum(['friendly', 'neutral', 'hostile']),
  awareActorIds: z.array(identifier).readonly(),
  conditions: z.array(condition).readonly(),
  equipment,
  behaviorId: nullableIdentifier,
  behaviorState: z.record(z.string(), behaviorValue).readonly(),
});
const itemLocation = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('backpack'), actorId: identifier }),
  z.strictObject({ type: z.literal('equipped'), actorId: identifier, slot: z.enum(['main-hand', 'off-hand', 'body', 'head', 'hands', 'feet', 'neck', 'left-ring', 'right-ring']) }),
  z.strictObject({ type: z.literal('floor'), floorId: identifier, x: safeNonNegative, y: safeNonNegative }),
]);
const enchantment = z.strictObject({
  enchantmentId: identifier,
  modifiers: z.record(z.string(), z.number().int().safe()).readonly(),
});
const item = z.strictObject({
  itemId: identifier,
  contentId: identifier,
  quantity: z.number().int().safe().positive(),
  condition: safeNonNegative,
  enchantment: enchantment.nullable(),
  identified: z.boolean(),
  charges: safeNonNegative.nullable(),
  fuel: safeNonNegative.nullable(),
  enabled: z.boolean().nullable(),
  location: itemLocation,
});
const discovery = z.strictObject({
  discoveredByActorIds: z.array(identifier).readonly(),
  progressByActorId: z.record(identifier, safeNonNegative).readonly(),
  attemptedContextKeys: z.array(z.string().min(1).max(256)).readonly(),
});
const featureBase = {
  featureId: identifier,
  floorId: identifier,
  x: safeNonNegative,
  y: safeNonNegative,
  contentId: nullableIdentifier,
  coverTileId: tile,
} as const;
const feature = z.discriminatedUnion('type', [
  z.strictObject({ ...featureBase, type: z.literal('door'), state: z.enum(['open', 'closed', 'locked']) }),
  z.strictObject({ ...featureBase, type: z.literal('trap'), state: z.enum(['armed', 'disabled', 'spent']), discoveryDifficulty: safeNonNegative, discovery }),
  z.strictObject({ ...featureBase, type: z.literal('secret'), state: z.enum(['hidden', 'revealed']), discoveryDifficulty: safeNonNegative, discovery }),
]);
const relationship = z.strictObject({
  leftActorId: identifier,
  rightActorId: identifier,
  relationship: z.enum(['friendly', 'neutral', 'hostile']),
});
const survival = z.strictObject({
  hungerReserve: safeNonNegative,
  hungerStage: z.enum(['sated', 'hungry', 'weak', 'starving']),
  nextStarvationAt: safeNonNegative.nullable(),
  emittedHungerWarnings: z.array(z.enum(['sated', 'hungry', 'weak', 'starving'])).readonly(),
  emittedFuelWarnings: z.array(identifier).readonly(),
});
const identification = z.strictObject({
  appearanceByContentId: z.record(identifier, identifier).readonly(),
  knownAppearanceIds: z.array(identifier).readonly(),
});
const hero = z.strictObject({ actorId: identifier, name: heroName, sightRadius: safeNonNegative, backpackCapacity: safeNonNegative });
const rngEntries = Object.fromEntries(RNG_STREAM_NAMES.map((name) => [name, uint32State]));
const directionOffsets: Readonly<Record<Direction, Readonly<{ x: number; y: number }>>> = {
  northwest: { x: -1, y: -1 }, north: { x: 0, y: -1 }, northeast: { x: 1, y: -1 },
  west: { x: -1, y: 0 }, east: { x: 1, y: 0 },
  southwest: { x: -1, y: 1 }, south: { x: 0, y: 1 }, southeast: { x: 1, y: 1 },
};

const activeRunSchema = z.strictObject({
  schemaVersion: z.literal(SAVE_SCHEMA_VERSION), gameVersion: z.literal(ENGINE_GAME_VERSION),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/), runId: identifier, runSeed: uint32Tuple,
  rng: z.strictObject(rngEntries as Record<(typeof RNG_STREAM_NAMES)[number], typeof uint32State>),
  revision: safeNonNegative, turn: safeNonNegative, worldTime: safeNonNegative,
  hero, actors: z.array(actor).min(1).readonly(), items: z.array(item).readonly(), features: z.array(feature).readonly(),
  relationships: z.array(relationship).readonly(), survival, identification,
  activeFloorId: identifier,
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

function ensureActorWalkable(
  floorValue: SavedFloor,
  features: readonly z.infer<typeof feature>[],
  x: number,
  y: number,
  path: string,
): void {
  const index = cell(floorValue, x, y, path);
  if (tileDefinition(floorValue.tiles[index]!).walkable) return;
  const openDoor = features.some((candidate) => candidate.type === 'door' && candidate.state === 'open'
    && candidate.floorId === floorValue.floorId && candidate.x === x && candidate.y === y);
  if (!openDoor) fail(path, 'position is not on walkable terrain');
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

  validateOrderedIds(run.actors.map((entry) => entry.actorId), 'actors', 'actor', 'actorId');
  const actors = new Map(run.actors.map((entry) => [entry.actorId, entry]));
  const occupiedCells = new Set<string>();
  for (const [actorIndex, actorValue] of run.actors.entries()) {
    const path = `actors.${actorIndex}`;
    const actorFloor = run.floors.find((candidate) => candidate.floorId === actorValue.floorId);
    if (!actorFloor) fail(`${path}.floorId`, 'actor floor does not exist');
    ensureActorWalkable(actorFloor, run.features, actorValue.x, actorValue.y, path);
    if (actorValue.health > actorValue.maxHealth) fail(`${path}.health`, 'health exceeds maximum health');
    validateOrderedIds(actorValue.awareActorIds, `${path}.awareActorIds`, 'aware actor');
    for (const [awareIndex, awareActorId] of actorValue.awareActorIds.entries()) {
      if (awareActorId === actorValue.actorId) fail(`${path}.awareActorIds.${awareIndex}`, 'actor cannot be aware of itself');
      if (!actors.has(awareActorId)) fail(`${path}.awareActorIds.${awareIndex}`, 'aware actor does not exist');
    }
    validateOrderedIds(actorValue.conditions.map((entry) => entry.conditionId), `${path}.conditions`, 'condition', 'conditionId');
    for (const [conditionIndex, conditionValue] of actorValue.conditions.entries()) {
      if (conditionValue.sourceActorId !== null && !actors.has(conditionValue.sourceActorId)) {
        fail(`${path}.conditions.${conditionIndex}.sourceActorId`, 'condition source actor does not exist');
      }
      if (conditionValue.expiresAt !== null && conditionValue.expiresAt < conditionValue.appliedAt) {
        fail(`${path}.conditions.${conditionIndex}.expiresAt`, 'condition cannot expire before it was applied');
      }
    }
    if (actorValue.health > 0) {
      const occupiedKey = `${actorValue.floorId}:${actorValue.x}:${actorValue.y}`;
      if (occupiedCells.has(occupiedKey)) fail(path, 'living actors cannot share a cell');
      occupiedCells.add(occupiedKey);
    }
  }

  const savedHeroActor = actors.get(run.hero.actorId);
  if (!savedHeroActor || !savedHeroActor.playerControlled) fail('hero.actorId', 'hero must reference one player-controlled actor');
  if (savedHeroActor.floorId !== run.activeFloorId) fail('hero.actorId', 'hero actor must occupy the active floor');

  validateOrderedIds(run.items.map((entry) => entry.itemId), 'items', 'item', 'itemId');
  const items = new Map(run.items.map((entry) => [entry.itemId, entry]));
  for (const [itemIndex, itemValue] of run.items.entries()) {
    const path = `items.${itemIndex}`;
    const location = itemValue.location;
    if (location.type === 'floor') {
      const itemFloor = run.floors.find((candidate) => candidate.floorId === location.floorId);
      if (!itemFloor) fail(`${path}.location.floorId`, 'item floor does not exist');
      ensureWalkable(itemFloor, location.x, location.y, `${path}.location`);
      continue;
    }
    const owner = actors.get(location.actorId);
    if (!owner) fail(`${path}.location.actorId`, 'item owner does not exist');
    if (location.type === 'equipped' && owner.equipment[location.slot] !== itemValue.itemId) {
      fail(`${path}.location.slot`, 'equipped item is not referenced by its actor slot');
    }
  }
  for (const [actorIndex, actorValue] of run.actors.entries()) {
    for (const [slotName, itemId] of Object.entries(actorValue.equipment)) {
      if (itemId === null) continue;
      const itemValue = items.get(itemId);
      if (!itemValue) fail(`actors.${actorIndex}.equipment.${slotName}`, 'equipped item does not exist');
      if (itemValue.location.type !== 'equipped' || itemValue.location.actorId !== actorValue.actorId || itemValue.location.slot !== slotName) {
        fail(`actors.${actorIndex}.equipment.${slotName}`, 'equipment reference disagrees with item location');
      }
    }
  }

  validateOrderedIds(run.features.map((entry) => entry.featureId), 'features', 'feature', 'featureId');
  for (const [featureIndex, featureValue] of run.features.entries()) {
    const path = `features.${featureIndex}`;
    const featureFloor = run.floors.find((candidate) => candidate.floorId === featureValue.floorId);
    if (!featureFloor) fail(`${path}.floorId`, 'feature floor does not exist');
    const featureCell = cell(featureFloor, featureValue.x, featureValue.y, path);
    if (featureValue.type === 'door' && featureFloor.tiles[featureCell] !== featureValue.coverTileId) {
      fail(`${path}.coverTileId`, 'door cover tile does not match its floor terrain');
    }
    if (featureValue.type !== 'door') {
      validateOrderedIds(featureValue.discovery.discoveredByActorIds, `${path}.discovery.discoveredByActorIds`, 'discovering actor');
      validateOrderedIds(featureValue.discovery.attemptedContextKeys, `${path}.discovery.attemptedContextKeys`, 'discovery context');
      for (const actorId of featureValue.discovery.discoveredByActorIds) {
        if (!actors.has(actorId)) fail(`${path}.discovery.discoveredByActorIds`, 'discovering actor does not exist');
      }
      for (const actorId of Object.keys(featureValue.discovery.progressByActorId)) {
        if (!actors.has(actorId)) fail(`${path}.discovery.progressByActorId.${actorId}`, 'progress actor does not exist');
      }
    }
  }

  let previousRelationshipKey = '';
  for (const [relationshipIndex, relationshipValue] of run.relationships.entries()) {
    const path = `relationships.${relationshipIndex}`;
    if (relationshipValue.leftActorId >= relationshipValue.rightActorId) fail(`${path}.rightActorId`, 'relationship actor identifiers must be a strictly increasing pair');
    if (!actors.has(relationshipValue.leftActorId) || !actors.has(relationshipValue.rightActorId)) fail(path, 'relationship actor does not exist');
    const key = `${relationshipValue.leftActorId}\u0000${relationshipValue.rightActorId}`;
    if (key <= previousRelationshipKey) fail(path, 'relationship pairs must be unique and strictly increasing');
    previousRelationshipKey = key;
  }

  validateOrderedIds(Object.keys(run.identification.appearanceByContentId), 'identification.appearanceByContentId', 'content');
  validateOrderedIds(run.identification.knownAppearanceIds, 'identification.knownAppearanceIds', 'appearance');
  for (const [floorIndex, floorValue] of run.floors.entries()) {
    for (const [lightIndex, source] of floorValue.lights.entries()) {
      const actorId = source.location.type === 'actor' ? source.location.actorId : undefined;
      const attachedActor = actorId === undefined ? undefined : actors.get(actorId);
      if (attachedActor && attachedActor.floorId === floorValue.floorId) continue;
      if (actorId !== undefined && !floorValue.entities.some((entry) => entry.entityId === actorId)) {
        fail(`floors.${floorIndex}.lights.${lightIndex}.location.actorId`, 'attached actor does not exist on this floor');
      }
    }
  }
  if (run.turn !== run.revision) fail('turn', 'turn and revision must match in schema v3');

  const commandIds = new Set<string>();
  let previousRevision = 0;
  for (const [index, recordValue] of run.recentCommands.entries()) {
    const path = `recentCommands.${index}`;
    if (commandIds.has(recordValue.command.commandId)) fail(`${path}.command.commandId`, 'command identifier is duplicated');
    commandIds.add(recordValue.command.commandId);
    if (recordValue.command.commandId !== recordValue.result.commandId) fail(`${path}.result.commandId`, 'result does not match command');
    if (recordValue.events.length === 0) fail(`${path}.events`, 'processed commands require at least one event');
    if (recordValue.events.some((entry) => entry.eventId !== recordValue.command.commandId)) fail(`${path}.events`, 'event identifier does not match command');
    if (recordValue.publicEvents.some((entry) => entry.eventId !== recordValue.command.commandId)) fail(`${path}.publicEvents`, 'public event identifier does not match command');
    const attackTargetActorId = recordValue.command.type === 'attack' ? recordValue.command.targetActorId : undefined;
    const eventValue = recordValue.result.status === 'invalid'
      ? recordValue.events.find((entry) => entry.type === 'action.invalid')
      : recordValue.command.type === 'wait'
        ? recordValue.events.find((entry) => entry.type === 'hero.waited')
      : recordValue.command.type === 'move'
          ? recordValue.events.find((entry) => entry.type === 'hero.moved')
            ?? recordValue.events.find((entry) => (entry.type === 'attack.hit' || entry.type === 'attack.missed')
              && entry.actorId === run.hero.actorId)
            ?? recordValue.events.find((entry) => entry.type === 'reaction.triggered' && entry.targetActorId === run.hero.actorId)
          : recordValue.command.type === 'attack'
            ? recordValue.events.find((entry) => (entry.type === 'attack.hit' || entry.type === 'attack.missed')
              && entry.actorId === run.hero.actorId && entry.targetActorId === attackTargetActorId)
          : undefined;
    if (!eventValue) fail(`${path}.events`, 'processed result has no matching event');
    if (recordValue.result.status === 'invalid') {
      if (eventValue.type !== 'action.invalid' || eventValue.commandId !== recordValue.command.commandId || eventValue.reason !== recordValue.result.reason) fail(`${path}.events.0`, 'invalid result and event are inconsistent');
    } else if (recordValue.command.type === 'wait') {
      if (eventValue.type !== 'hero.waited' || eventValue.heroId !== run.hero.actorId) fail(`${path}.events.0`, 'wait result and event are inconsistent');
      ensureActorWalkable(activeFloor, run.features, eventValue.x, eventValue.y, `${path}.events.0`);
    } else if (recordValue.command.type === 'move' && eventValue.type === 'hero.moved' && eventValue.heroId === run.hero.actorId) {
      ensureActorWalkable(activeFloor, run.features, eventValue.from.x, eventValue.from.y, `${path}.events.0.from`);
      ensureActorWalkable(activeFloor, run.features, eventValue.to.x, eventValue.to.y, `${path}.events.0.to`);
    } else if (recordValue.command.type === 'move' && eventValue.type === 'reaction.triggered'
      && eventValue.targetActorId === run.hero.actorId) {
      // A reaction may kill or immobilize the hero before the attempted move completes.
    } else if ((recordValue.command.type === 'move' || recordValue.command.type === 'attack')
      && (eventValue.type === 'attack.hit' || eventValue.type === 'attack.missed')
      && eventValue.actorId === run.hero.actorId) {
      if (recordValue.command.type === 'attack' && eventValue.targetActorId !== recordValue.command.targetActorId) {
        fail(`${path}.events`, 'attack target and event are inconsistent');
      }
    } else fail(`${path}.events`, 'applied command and event are inconsistent');
    if (recordValue.result.revision < previousRevision || recordValue.result.revision > run.revision) fail(`${path}.result.revision`, 'record revisions are not monotonic');
    if (recordValue.result.turn > run.turn) fail(`${path}.result.turn`, 'record turn exceeds current turn');
    if (recordValue.result.turn !== recordValue.result.revision) fail(`${path}.result.turn`, 'result turn and revision must match in schema v3');
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
  let knownPosition = { x: savedHeroActor.x, y: savedHeroActor.y };
  for (let index = run.recentCommands.length - 1; index >= 0; index -= 1) {
    const recordValue = run.recentCommands[index]!;
    const eventValue = recordValue.result.status === 'invalid'
      ? recordValue.events.find((entry) => entry.type === 'action.invalid')!
      : recordValue.command.type === 'wait'
        ? recordValue.events.find((entry) => entry.type === 'hero.waited')!
        : recordValue.command.type === 'move'
          ? recordValue.events.find((entry) => entry.type === 'hero.moved')
            ?? recordValue.events.find((entry) => (entry.type === 'attack.hit' || entry.type === 'attack.missed')
              && entry.actorId === run.hero.actorId)
            ?? recordValue.events.find((entry) => entry.type === 'reaction.triggered' && entry.targetActorId === run.hero.actorId)!
          : recordValue.events.find((entry) => (entry.type === 'attack.hit' || entry.type === 'attack.missed')
            && entry.actorId === run.hero.actorId)!;
    const path = `recentCommands.${index}`;
    if (recordValue.result.status === 'invalid') {
      if (recordValue.command.type !== 'move') {
        if (recordValue.result.reason !== 'action.unavailable') fail(`${path}.result.reason`, 'unregistered actions must use action.unavailable');
        continue;
      }
      if (recordValue.result.reason === 'action.unavailable') continue;
      if (['blocked.bounds', 'blocked.wall', 'blocked.door', 'blocked.pillar', 'blocked.void'].includes(recordValue.result.reason)) {
        const offset = directionOffsets[recordValue.command.direction];
        const attempted = { x: knownPosition.x + offset.x, y: knownPosition.y + offset.y };
        const attemptedIndex = tileIndex(activeFloor, attempted.x, attempted.y);
        const actualReason = attemptedIndex === undefined ? 'blocked.bounds' : movementBlockReason(activeFloor.tiles[attemptedIndex]!);
        if (recordValue.result.reason !== actualReason) fail(`${path}.result.reason`, 'invalid reason does not match the active floor');
      }
      continue;
    }
    if (recordValue.command.type === 'wait') {
      if (eventValue.type !== 'hero.waited' || eventValue.x !== knownPosition.x || eventValue.y !== knownPosition.y) fail(`${path}.events.0`, 'wait position does not match the retained position chain');
      continue;
    }
    if (recordValue.command.type === 'attack') continue;
    if (recordValue.command.type !== 'move') fail(`${path}.events`, 'move result and event are inconsistent');
    if (eventValue.type === 'attack.hit' || eventValue.type === 'attack.missed' || eventValue.type === 'reaction.triggered') continue;
    if (eventValue.type !== 'hero.moved') fail(`${path}.events`, 'move result and event are inconsistent');
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
