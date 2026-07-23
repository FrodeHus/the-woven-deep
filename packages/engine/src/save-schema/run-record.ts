import { z } from 'zod';
import {
  completionType,
  identifier,
  positiveQuantity,
  runConclusionCause,
  safeNonNegative,
  uint32State,
  uint32Tuple,
} from './primitives.js';
import { floor, type vault } from './floor.js';
import { actor, type lastKnownTarget } from './actor.js';
import { feature, item } from './item.js';
import {
  encounterDecision,
  fallenDecision,
  fallenStanding,
  hero,
  identification,
  population,
  relationship,
  survival,
} from './population.js';
import { recorded } from './events.js';
import { validateKnowledgePacking } from '../knowledge.js';
import { tileIndex, type ActiveRun, type Direction } from '../model.js';
import { SaveLoadError } from '../save-error.js';
import { movementBlockReason, tileDefinition } from '../terrain.js';
import {
  ENGINE_GAME_VERSION,
  RECENT_COMMAND_LIMIT,
  RNG_STREAM_NAMES,
  SAVE_SCHEMA_VERSION,
} from '../versions.js';

export const rngEntries = Object.fromEntries(RNG_STREAM_NAMES.map((name) => [name, uint32State]));
export const runKillsByModel = z.strictObject({
  individual: safeNonNegative,
  group: safeNonNegative,
  swarm: safeNonNegative,
  boss: safeNonNegative,
});
export const runMetrics = z.strictObject({
  kills: safeNonNegative,
  killsByModel: runKillsByModel,
  bossKills: safeNonNegative,
  championKills: safeNonNegative,
  echoKills: safeNonNegative,
  threatDefeated: safeNonNegative,
  damageDealt: safeNonNegative,
  damageTaken: safeNonNegative,
  itemsCollected: safeNonNegative,
  itemsIdentified: safeNonNegative,
  currencyEarned: safeNonNegative,
  currencySpent: safeNonNegative,
  tradesCompleted: safeNonNegative,
  floorsEntered: safeNonNegative,
  deepestDepth: safeNonNegative,
  discoveriesRevealed: safeNonNegative,
  turnsElapsed: safeNonNegative,
  restsCompleted: safeNonNegative,
});
export const runConclusionSchema = z.strictObject({
  completionType,
  cause: runConclusionCause,
  concludedAtRevision: safeNonNegative,
  finalized: z.boolean(),
});
export const directionOffsets: Readonly<Record<Direction, Readonly<{ x: number; y: number }>>> = {
  northwest: { x: -1, y: -1 },
  north: { x: 0, y: -1 },
  northeast: { x: 1, y: -1 },
  west: { x: -1, y: 0 },
  east: { x: 1, y: 0 },
  southwest: { x: -1, y: 1 },
  south: { x: 0, y: 1 },
  southeast: { x: 1, y: 1 },
};

export const activeRunSchema = z.strictObject({
  schemaVersion: z.literal(SAVE_SCHEMA_VERSION),
  gameVersion: z.literal(ENGINE_GAME_VERSION),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  runId: identifier,
  runSeed: uint32Tuple,
  rng: z.strictObject(rngEntries as Record<(typeof RNG_STREAM_NAMES)[number], typeof uint32State>),
  revision: safeNonNegative,
  turn: safeNonNegative,
  worldTime: safeNonNegative,
  hero,
  reputations: z
    .array(z.strictObject({ factionId: identifier, value: z.number().int().safe() }))
    .readonly(),
  activeTrade: z
    .strictObject({
      merchantPopulationId: identifier,
      merchantActorId: identifier,
      openedByCommandId: identifier,
      openedAtRevision: safeNonNegative,
      completedCommerce: z.boolean(),
    })
    .nullable(),
  actors: z.array(actor).min(1).readonly(),
  items: z.array(item).readonly(),
  features: z.array(feature).readonly(),
  relationships: z.array(relationship).readonly(),
  survival,
  identification,
  activeFloorId: identifier,
  activeFloorEnteredAt: safeNonNegative,
  returnAnchorFloorId: identifier.optional(),
  floors: z.array(floor).min(1).readonly(),
  recentCommands: z.array(recorded).max(RECENT_COMMAND_LIMIT).readonly(),
  encounterDecisions: z.array(encounterDecision).readonly(),
  populations: z.array(population).readonly(),
  fallenHeroStandings: z.array(fallenStanding).max(10).readonly(),
  fallenHeroDecisions: z.array(fallenDecision).max(10).readonly(),
  conqueredChampionRecordIds: z.array(identifier).readonly(),
  metrics: runMetrics,
  conclusion: runConclusionSchema.nullable(),
  house: z.strictObject({ capacity: positiveQuantity, upgradesPurchased: safeNonNegative }),
  restockedMilestones: z.array(positiveQuantity).readonly(),
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
  if (!tileDefinition(floorValue.tiles[index]!).walkable)
    fail(path, 'position is not on walkable terrain');
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
  const walkableFeature = features.some(
    (candidate) =>
      ((candidate.type === 'door' && candidate.state === 'open') ||
        (candidate.type === 'secret' && candidate.state === 'revealed')) &&
      candidate.floorId === floorValue.floorId &&
      candidate.x === x &&
      candidate.y === y,
  );
  if (!walkableFeature) fail(path, 'position is not on walkable terrain');
}

function validateOrderedIds(
  values: readonly string[],
  path: string,
  noun: string,
  idField?: string,
): void {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1]! >= values[index]!)
      fail(
        `${path}.${index}${idField ? `.${idField}` : ''}`,
        `${noun} identifiers must be unique and strictly increasing`,
      );
  }
}

function overlaps(left: z.infer<typeof vault>, right: z.infer<typeof vault>): boolean {
  return (
    left.x < right.x + right.width &&
    right.x < left.x + left.width &&
    left.y < right.y + right.height &&
    right.y < left.y + left.height
  );
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
  if (floorValue.tiles.length !== cellCount)
    fail(`${base}.tiles`, 'tile length does not match dimensions');
  try {
    validateKnowledgePacking(floorValue.knowledge, cellCount);
  } catch (cause) {
    fail(`${base}.knowledge`, cause instanceof Error ? cause.message : 'invalid knowledge packing');
  }

  validateOrderedIds(
    floorValue.entities.map((entry) => entry.entityId),
    `${base}.entities`,
    'entity',
    'entityId',
  );
  for (const [entityIndex, entityValue] of floorValue.entities.entries()) {
    if (globalIds.entities.has(entityValue.entityId))
      fail(`${base}.entities.${entityIndex}.entityId`, 'entity identifier is duplicated');
    globalIds.entities.add(entityValue.entityId);
    ensureWalkable(floorValue, entityValue.x, entityValue.y, `${base}.entities.${entityIndex}`);
  }

  const stairs = [
    [floorValue.stairUp, 4, 'stairUp'],
    [floorValue.stairDown, 5, 'stairDown'],
  ] as const;
  for (const [position, expectedTile, name] of stairs) {
    const matchingTiles = floorValue.tiles.reduce<number[]>((indexes, tileValue, index) => {
      if (tileValue === expectedTile) indexes.push(index);
      return indexes;
    }, []);
    if (position === null) {
      if (matchingTiles.length !== 0)
        fail(`${base}.${name}`, `${name} metadata is required for its terrain tile`);
      continue;
    }
    if (
      floorValue.tiles[cell(floorValue, position.x, position.y, `${base}.${name}`)] !== expectedTile
    ) {
      fail(`${base}.${name}`, `${name} must match its terrain tile`);
    }
    if (matchingTiles.length !== 1)
      fail(`${base}.${name}`, `${name} must identify the only matching terrain tile`);
  }
  if (
    floorValue.stairUp &&
    floorValue.stairDown &&
    floorValue.stairUp.x === floorValue.stairDown.x &&
    floorValue.stairUp.y === floorValue.stairDown.y
  ) {
    fail(`${base}.stairDown`, 'stair positions must be distinct');
  }

  validateOrderedIds(
    floorValue.vaults.map((entry) => entry.placementId),
    `${base}.vaults`,
    'vault placement',
    'placementId',
  );
  const placements = new Map(floorValue.vaults.map((entry) => [entry.placementId, entry]));
  for (const [vaultIndex, placement] of floorValue.vaults.entries()) {
    const path = `${base}.vaults.${vaultIndex}`;
    if (globalIds.vaultPlacements.has(placement.placementId))
      fail(`${path}.placementId`, 'vault placement identifier is duplicated');
    globalIds.vaultPlacements.add(placement.placementId);
    if (
      placement.x + placement.width > floorValue.width ||
      placement.y + placement.height > floorValue.height
    )
      fail(path, 'vault placement is outside its floor');
    for (let otherIndex = 0; otherIndex < vaultIndex; otherIndex += 1) {
      if (overlaps(floorValue.vaults[otherIndex]!, placement))
        fail(path, 'vault placements overlap');
    }
    const entranceCells = new Set<number>();
    for (const [entranceIndex, entrance] of placement.entrances.entries()) {
      const entrancePath = `${path}.entrances.${entranceIndex}`;
      if (
        entrance.x < placement.x ||
        entrance.x >= placement.x + placement.width ||
        entrance.y < placement.y ||
        entrance.y >= placement.y + placement.height
      )
        fail(entrancePath, 'entrance is outside its vault placement');
      const index = cell(floorValue, entrance.x, entrance.y, entrancePath);
      if (!tileDefinition(floorValue.tiles[index]!).potentiallyTraversable)
        fail(entrancePath, 'entrance is not on traversable terrain');
      if (entranceCells.has(index)) fail(entrancePath, 'entrance position is duplicated');
      entranceCells.add(index);
    }
  }

  validateOrderedIds(
    floorValue.placementSlots.map((entry) => entry.slotId),
    `${base}.placementSlots`,
    'slot',
    'slotId',
  );
  for (const [slotIndex, placementSlot] of floorValue.placementSlots.entries()) {
    const path = `${base}.placementSlots.${slotIndex}`;
    if (globalIds.slots.has(placementSlot.slotId))
      fail(`${path}.slotId`, 'slot identifier is duplicated');
    globalIds.slots.add(placementSlot.slotId);
    const owner = placements.get(placementSlot.vaultPlacementId);
    if (!owner) fail(`${path}.vaultPlacementId`, 'slot owner does not exist');
    if (
      placementSlot.x < owner.x ||
      placementSlot.x >= owner.x + owner.width ||
      placementSlot.y < owner.y ||
      placementSlot.y >= owner.y + owner.height
    )
      fail(path, 'slot is outside its vault placement');
    const index = cell(floorValue, placementSlot.x, placementSlot.y, path);
    if (floorValue.tiles[index] === 6) fail(path, 'slot cannot occupy void terrain');
  }

  validateOrderedIds(
    floorValue.lights.map((entry) => entry.lightId),
    `${base}.lights`,
    'light',
    'lightId',
  );
  const presentedCells = new Set<number>();
  for (const [lightIndex, source] of floorValue.lights.entries()) {
    const path = `${base}.lights.${lightIndex}`;
    if (globalIds.lights.has(source.lightId))
      fail(`${path}.lightId`, 'light identifier is duplicated');
    globalIds.lights.add(source.lightId);
    if (source.location.type === 'actor') {
      if (source.vaultPlacementId !== null || source.presentation !== null)
        fail(path, 'actor-attached lights cannot have vault ownership or fixture presentation');
      continue;
    }
    const index = cell(floorValue, source.location.x, source.location.y, `${path}.location`);
    if (floorValue.tiles[index] === 6)
      fail(`${path}.location`, 'fixed light cannot occupy void terrain');
    if (source.vaultPlacementId !== null) {
      const owner = placements.get(source.vaultPlacementId);
      if (!owner) fail(`${path}.vaultPlacementId`, 'light owner does not exist');
      if (source.presentation === null)
        fail(`${path}.presentation`, 'vault-owned light requires fixture presentation');
      if (
        source.location.x < owner.x ||
        source.location.x >= owner.x + owner.width ||
        source.location.y < owner.y ||
        source.location.y >= owner.y + owner.height
      ) {
        fail(`${path}.location`, 'vault-owned light is outside its vault placement');
      }
    }
    if (source.presentation !== null) {
      if (presentedCells.has(index))
        fail(`${path}.location`, 'presented fixed lights cannot share a cell');
      presentedCells.add(index);
    }
  }
}

function validateSemantics(run: z.infer<typeof activeRunSchema>): ActiveRun {
  const floorIds = new Set<string>();
  const globalIds: GlobalIds = {
    entities: new Set<string>(),
    lights: new Set<string>(),
    vaultPlacements: new Set<string>(),
    slots: new Set<string>(),
  };
  for (const [floorIndex, floorValue] of run.floors.entries()) {
    const previousFloor = run.floors[floorIndex - 1];
    if (previousFloor && previousFloor.floorId >= floorValue.floorId)
      fail(`floors.${floorIndex}.floorId`, 'floor identifiers must be strictly increasing');
    if (floorIds.has(floorValue.floorId))
      fail(`floors.${floorIndex}.floorId`, 'floor identifier is duplicated');
    floorIds.add(floorValue.floorId);
    validateFloor(floorValue, floorIndex, globalIds);
  }
  const activeFloor = run.floors.find((candidate) => candidate.floorId === run.activeFloorId);
  if (!activeFloor) fail('activeFloorId', 'active floor does not exist');
  if (run.activeFloorEnteredAt > run.worldTime)
    fail('activeFloorEnteredAt', 'active floor entry cannot be in the future');
  if (run.returnAnchorFloorId !== undefined) {
    const anchor = run.floors.find((floor) => floor.floorId === run.returnAnchorFloorId);
    if (!anchor) fail('returnAnchorFloorId', 'recall anchor floor does not exist');
  }

  validateOrderedIds(
    run.reputations.map((entry) => entry.factionId),
    'reputations',
    'faction reputation',
    'factionId',
  );

  validateOrderedIds(
    run.actors.map((entry) => entry.actorId),
    'actors',
    'actor',
    'actorId',
  );
  const actors = new Map(run.actors.map((entry) => [entry.actorId, entry]));
  const occupiedCells = new Set<string>();
  for (const [actorIndex, actorValue] of run.actors.entries()) {
    const path = `actors.${actorIndex}`;
    const actorFloor = run.floors.find((candidate) => candidate.floorId === actorValue.floorId);
    if (!actorFloor) fail(`${path}.floorId`, 'actor floor does not exist');
    ensureActorWalkable(actorFloor, run.features, actorValue.x, actorValue.y, path);
    if (actorValue.health > actorValue.maxHealth)
      fail(`${path}.health`, 'health exceeds maximum health');
    if (actorValue.weave > actorValue.maxWeave)
      fail(`${path}.weave`, 'weave exceeds maximum weave');
    validateOrderedIds(actorValue.awareActorIds, `${path}.awareActorIds`, 'aware actor');
    for (const [awareIndex, awareActorId] of actorValue.awareActorIds.entries()) {
      if (awareActorId === actorValue.actorId)
        fail(`${path}.awareActorIds.${awareIndex}`, 'actor cannot be aware of itself');
      if (!actors.has(awareActorId))
        fail(`${path}.awareActorIds.${awareIndex}`, 'aware actor does not exist');
    }
    validateOrderedIds(
      actorValue.conditions.map((entry) => entry.conditionId),
      `${path}.conditions`,
      'condition',
      'conditionId',
    );
    for (const [conditionIndex, conditionValue] of actorValue.conditions.entries()) {
      if (conditionValue.sourceActorId !== null && !actors.has(conditionValue.sourceActorId)) {
        fail(
          `${path}.conditions.${conditionIndex}.sourceActorId`,
          'condition source actor does not exist',
        );
      }
      if (
        conditionValue.expiresAt !== null &&
        conditionValue.expiresAt < conditionValue.appliedAt
      ) {
        fail(
          `${path}.conditions.${conditionIndex}.expiresAt`,
          'condition cannot expire before it was applied',
        );
      }
    }
    if (actorValue.health > 0) {
      const occupiedKey = `${actorValue.floorId}:${actorValue.x}:${actorValue.y}`;
      if (occupiedCells.has(occupiedKey)) fail(path, 'living actors cannot share a cell');
      occupiedCells.add(occupiedKey);
    }
  }

  validateOrderedIds(
    run.encounterDecisions.map((entry) => entry.encounterId),
    'encounterDecisions',
    'encounter decision',
    'encounterId',
  );
  const encounterDecisions = new Map(
    run.encounterDecisions.map((entry) => [entry.encounterId, entry]),
  );
  for (const [index, decision] of run.encounterDecisions.entries()) {
    if (
      decision.effectiveProbability < decision.baseProbability ||
      decision.effectiveProbability > decision.baseProbability + decision.protectionBonus
    ) {
      fail(
        `encounterDecisions.${index}.effectiveProbability`,
        'effective probability is inconsistent',
      );
    }
    if (decision.encountered && !decision.reachedEligibleDepth) {
      fail(
        `encounterDecisions.${index}.encountered`,
        'encountered decision must have reached eligible depth',
      );
    }
    if (decision.encountered && !decision.eligible) {
      fail(
        `encounterDecisions.${index}.encountered`,
        'an ineligible encounter cannot be encountered',
      );
    }
    if (!decision.eligible && decision.instancesCreated !== 0) {
      fail(
        `encounterDecisions.${index}.instancesCreated`,
        'an ineligible encounter cannot create instances',
      );
    }
  }

  validateOrderedIds(
    run.populations.map((entry) => entry.populationId),
    'populations',
    'population',
    'populationId',
  );
  const populations = new Map(run.populations.map((entry) => [entry.populationId, entry]));
  const validateMemories = (
    memories: readonly z.infer<typeof lastKnownTarget>[],
    path: string,
  ): void => {
    validateOrderedIds(
      memories.map((entry) => entry.targetActorId),
      path,
      'last-known target',
      'targetActorId',
    );
    for (const memory of memories) {
      if (!actors.has(memory.targetActorId) || !actors.has(memory.observerActorId)) {
        fail(path, 'memory actor reference does not exist');
      }
      const memoryFloor = run.floors.find((entry) => entry.floorId === memory.floorId);
      if (!memoryFloor) fail(path, 'memory floor does not exist');
      cell(memoryFloor, memory.x, memory.y, path);
    }
  };
  for (const [index, populationValue] of run.populations.entries()) {
    const path = `populations.${index}`;
    if (!floorIds.has(populationValue.floorId))
      fail(`${path}.floorId`, 'population floor does not exist');
    if (
      populationValue.model !== 'champion' &&
      populationValue.model !== 'echo' &&
      !encounterDecisions.has(populationValue.encounterId)
    ) {
      fail(`${path}.encounterId`, 'population encounter decision does not exist');
    }
    validateOrderedIds(populationValue.livingMemberIds, `${path}.livingMemberIds`, 'living member');
    validateOrderedIds(populationValue.formerMemberIds, `${path}.formerMemberIds`, 'former member');
    const memberIds = new Set([
      ...populationValue.livingMemberIds,
      ...populationValue.formerMemberIds,
    ]);
    if (
      memberIds.size !==
      populationValue.livingMemberIds.length + populationValue.formerMemberIds.length
    ) {
      fail(`${path}.formerMemberIds`, 'living and former member sets overlap');
    }
    for (const actorId of populationValue.livingMemberIds) {
      const member = actors.get(actorId);
      if (!member || member.health <= 0)
        fail(`${path}.livingMemberIds`, 'living population member does not exist or is dead');
      if (member.populationId !== populationValue.populationId)
        fail(`${path}.livingMemberIds`, 'population membership disagrees with actor');
    }
    if (populationValue.model === 'group') {
      validateOrderedIds(
        populationValue.roleMembership.map((entry) => entry.actorId),
        `${path}.roleMembership`,
        'role member',
        'actorId',
      );
      const roles = new Map(
        populationValue.roleMembership.map((entry) => [entry.actorId, entry.roleId]),
      );
      for (const [roleIndex, role] of populationValue.roleMembership.entries()) {
        const member = actors.get(role.actorId);
        const disbandedFormer =
          member?.populationId === null &&
          member.populationRoleId === null &&
          populationValue.formerMemberIds.includes(role.actorId);
        if (
          !memberIds.has(role.actorId) ||
          !member ||
          (!disbandedFormer && member.populationRoleId !== role.roleId)
        ) {
          fail(
            `${path}.roleMembership.${roleIndex}`,
            'group role membership disagrees with its actor',
          );
        }
      }
      for (const actorId of populationValue.livingMemberIds) {
        if (!roles.has(actorId))
          fail(`${path}.roleMembership`, 'every living group member requires a role');
      }
      if (populationValue.leaderActorId !== null && !memberIds.has(populationValue.leaderActorId)) {
        fail(`${path}.leaderActorId`, 'group leader must belong to the population');
      }
      const leaderLiving =
        populationValue.leaderActorId !== null &&
        populationValue.livingMemberIds.includes(populationValue.leaderActorId);
      if (populationValue.bonusActive !== leaderLiving) {
        fail(`${path}.bonusActive`, 'group bonus must be active exactly while its leader lives');
      }
      const leaderDefeated =
        populationValue.leaderActorId !== null &&
        populationValue.formerMemberIds.includes(populationValue.leaderActorId);
      if (populationValue.leaderResponseApplied !== leaderDefeated) {
        fail(
          `${path}.leaderResponseApplied`,
          'leader response state disagrees with leader membership',
        );
      }
      if (
        !populationValue.leaderResponseApplied &&
        populationValue.leaderResponseExpiresAt !== null
      ) {
        fail(
          `${path}.leaderResponseExpiresAt`,
          'an unapplied leader response cannot have an expiry',
        );
      }
      validateMemories(populationValue.sharedKnowledge, `${path}.sharedKnowledge`);
    } else if (populationValue.model === 'swarm') {
      if (!memberIds.has(populationValue.sourceActorId))
        fail(`${path}.sourceActorId`, 'swarm source must belong to the population');
      const sourceLiving = populationValue.livingMemberIds.includes(populationValue.sourceActorId);
      if ((populationValue.shutdownState === null) !== sourceLiving) {
        fail(
          `${path}.shutdownState`,
          'swarm shutdown state must begin when its source is destroyed',
        );
      }
      if (populationValue.peakLivingSize < populationValue.livingMemberIds.length)
        fail(`${path}.peakLivingSize`, 'peak living size is below current size');
      if (
        new Set(populationValue.emittedCapLevels).size !== populationValue.emittedCapLevels.length
      ) {
        fail(`${path}.emittedCapLevels`, 'swarm cap level is duplicated');
      }
      if (
        populationValue.emittedCapLevels.some(
          (level, index) => index > 0 && populationValue.emittedCapLevels[index - 1]! >= level,
        )
      ) {
        fail(`${path}.emittedCapLevels`, 'swarm cap levels must use stable ordering');
      }
      if (
        populationValue.shutdownState !== 'frenzy' &&
        populationValue.shutdownExpiresAt !== null
      ) {
        fail(`${path}.shutdownExpiresAt`, 'only frenzy may own a shutdown expiry');
      }
    } else if (populationValue.model === 'merchant') {
      validateOrderedIds(
        populationValue.initialStockItemIds,
        `${path}.initialStockItemIds`,
        'initial stock item',
      );
      validateOrderedIds(populationValue.stockItemIds, `${path}.stockItemIds`, 'stock item');
      validateOrderedIds(
        populationValue.services.map((service) => service.serviceId),
        `${path}.services`,
        'merchant service',
        'serviceId',
      );
      for (const [serviceIndex, service] of populationValue.services.entries()) {
        validateOrderedIds(
          service.tierIds,
          `${path}.services.${serviceIndex}.tierIds`,
          'service tier',
        );
      }
      // `null` marks a permanent merchant, which never departs; a non-permanent merchant's
      // departure must still equal its creation time plus its rolled lifetime.
      if (
        populationValue.departureAt !== null &&
        populationValue.departureAt !== populationValue.createdAt + populationValue.rolledLifetime
      ) {
        fail(
          `${path}.departureAt`,
          'merchant departure must equal creation time plus rolled lifetime',
        );
      }
      for (
        let warningIndex = 0;
        warningIndex < populationValue.emittedWarningThresholds.length;
        warningIndex += 1
      ) {
        const threshold = populationValue.emittedWarningThresholds[warningIndex]!;
        if (threshold >= populationValue.rolledLifetime) {
          fail(
            `${path}.emittedWarningThresholds.${warningIndex}`,
            'merchant warning must be below rolled lifetime',
          );
        }
        if (
          warningIndex > 0 &&
          populationValue.emittedWarningThresholds[warningIndex - 1]! <= threshold
        ) {
          fail(
            `${path}.emittedWarningThresholds.${warningIndex}`,
            'merchant warnings must be unique and strictly descending',
          );
        }
      }
      const actorValue = actors.get(populationValue.actorId);
      if (
        populationValue.lifecycle === 'available' ||
        populationValue.lifecycle === 'fleeing' ||
        populationValue.lifecycle === 'defending'
      ) {
        if (
          !actorValue ||
          actorValue.health <= 0 ||
          populationValue.livingMemberIds.length !== 1 ||
          populationValue.livingMemberIds[0] !== populationValue.actorId ||
          populationValue.formerMemberIds.length !== 0
        ) {
          fail(`${path}.lifecycle`, 'active merchant lifecycle requires exactly one living actor');
        }
      } else if (populationValue.lifecycle === 'departed') {
        if (
          actorValue ||
          populationValue.livingMemberIds.length !== 0 ||
          populationValue.formerMemberIds.length !== 0 ||
          populationValue.stockItemIds.length !== 0
        ) {
          fail(`${path}.lifecycle`, 'departed merchant cannot retain an actor or stock');
        }
      } else if (
        !actorValue ||
        actorValue.health !== 0 ||
        populationValue.livingMemberIds.length !== 0 ||
        populationValue.formerMemberIds.length !== 1 ||
        populationValue.formerMemberIds[0] !== populationValue.actorId ||
        populationValue.stockItemIds.length !== 0
      ) {
        fail(
          `${path}.lifecycle`,
          'dead merchant requires one health-zero former actor and no stock',
        );
      }
      if (
        (populationValue.lifecycle === 'fleeing' || populationValue.lifecycle === 'defending') &&
        !populationValue.provoked
      ) {
        fail(`${path}.provoked`, 'hostile merchant lifecycle requires provocation');
      }
      if (populationValue.lifecycle === 'available' && populationValue.provoked) {
        fail(`${path}.provoked`, 'an available merchant cannot already be provoked');
      }
      if (populationValue.aggressionPenaltyApplied !== populationValue.provoked) {
        fail(
          `${path}.aggressionPenaltyApplied`,
          'aggression penalty must be applied exactly with provocation',
        );
      }
      if (populationValue.deathPenaltyApplied !== (populationValue.lifecycle === 'dead')) {
        fail(
          `${path}.deathPenaltyApplied`,
          'death penalty must be resolved exactly for a dead merchant',
        );
      }
      if (
        populationValue.stockLossResolved !==
        (populationValue.provoked || populationValue.lifecycle === 'dead')
      ) {
        fail(
          `${path}.stockLossResolved`,
          'stock loss must be resolved exactly after provocation or merchant death',
        );
      }
    } else if (
      populationValue.model === 'boss' ||
      populationValue.model === 'champion' ||
      populationValue.model === 'echo'
    ) {
      if (!memberIds.has(populationValue.actorId))
        fail(`${path}.actorId`, 'primary actor must belong to its population');
      if (populationValue.model === 'champion' || populationValue.model === 'echo') {
        validateOrderedIds(
          populationValue.equipmentContentIds,
          `${path}.equipmentContentIds`,
          'normalized equipment',
        );
        validateOrderedIds(populationValue.abilityIds, `${path}.abilityIds`, 'normalized ability');
      }
      if (
        'defeated' in populationValue &&
        populationValue.defeated !==
          populationValue.formerMemberIds.includes(populationValue.actorId)
      ) {
        fail(
          `${path}.defeated`,
          'fallen-hero defeat state disagrees with primary actor membership',
        );
      }
      if (
        populationValue.model === 'champion' &&
        populationValue.rewardCreated &&
        !populationValue.defeated
      ) {
        fail(`${path}.rewardCreated`, 'Champion reward cannot exist before defeat');
      }
      if (
        populationValue.model === 'echo' &&
        populationValue.lootCreated &&
        !populationValue.defeated
      ) {
        fail(`${path}.lootCreated`, 'Echo loot cannot exist before defeat');
      }
      if (populationValue.model === 'boss') {
        const crossed = new Set(populationValue.crossedPhaseIds);
        if (crossed.size !== populationValue.crossedPhaseIds.length)
          fail(`${path}.crossedPhaseIds`, 'boss phase is duplicated');
        if (
          populationValue.currentPhaseId !== null &&
          !crossed.has(populationValue.currentPhaseId)
        ) {
          fail(`${path}.currentPhaseId`, 'current boss phase has not been crossed');
        }
        if (
          populationValue.rewardCreated &&
          populationValue.livingMemberIds.includes(populationValue.actorId)
        ) {
          fail(`${path}.rewardCreated`, 'boss reward cannot exist while the boss lives');
        }
        if (populationValue.rewardCreated !== (populationValue.rewardReceipt !== null)) {
          fail(
            `${path}.rewardReceipt`,
            'boss reward receipt must exist exactly when rewards were created',
          );
        }
        for (
          let recoveryIndex = 1;
          recoveryIndex < populationValue.recoveryHistory.length;
          recoveryIndex += 1
        ) {
          if (
            populationValue.recoveryHistory[recoveryIndex - 1]!.at >=
            populationValue.recoveryHistory[recoveryIndex]!.at
          ) {
            fail(
              `${path}.recoveryHistory.${recoveryIndex}.at`,
              'boss recovery history must be strictly chronological',
            );
          }
        }
      }
    }
  }
  for (const [actorIndex, actorValue] of run.actors.entries()) {
    if (actorValue.populationId === null) {
      if (actorValue.populationRoleId !== null)
        fail(
          `actors.${actorIndex}.populationRoleId`,
          'actor without population cannot have a role',
        );
    } else {
      const owner = populations.get(actorValue.populationId);
      if (
        !owner ||
        ![...owner.livingMemberIds, ...owner.formerMemberIds].includes(actorValue.actorId)
      ) {
        fail(
          `actors.${actorIndex}.populationId`,
          'actor population membership does not resolve in both directions',
        );
      }
      if (
        owner.model !== 'group' &&
        owner.model !== 'swarm' &&
        actorValue.populationRoleId !== null
      ) {
        fail(
          `actors.${actorIndex}.populationRoleId`,
          'only group and swarm members can have population roles',
        );
      }
    }
    validateMemories(
      actorValue.behaviorState.lastKnownTargets,
      `actors.${actorIndex}.behaviorState.lastKnownTargets`,
    );
    const goal = actorValue.behaviorState.goal;
    if (goal?.type === 'actor' && !actors.has(goal.targetActorId)) {
      fail(
        `actors.${actorIndex}.behaviorState.goal.targetActorId`,
        'goal target actor does not exist',
      );
    }
    if (goal?.type === 'cell') {
      const goalFloor = run.floors.find((entry) => entry.floorId === goal.floorId);
      if (!goalFloor)
        fail(`actors.${actorIndex}.behaviorState.goal.floorId`, 'goal floor does not exist');
      cell(goalFloor, goal.x, goal.y, `actors.${actorIndex}.behaviorState.goal`);
    }
    if (goal?.type === 'formation') {
      const goalPopulation = populations.get(goal.populationId);
      if (
        !goalPopulation ||
        goalPopulation.model !== 'group' ||
        actorValue.populationId !== goal.populationId
      ) {
        fail(
          `actors.${actorIndex}.behaviorState.goal.populationId`,
          'formation goal must reference the actor group',
        );
      }
      if (actorValue.populationRoleId !== goal.roleId) {
        fail(
          `actors.${actorIndex}.behaviorState.goal.roleId`,
          'formation goal role disagrees with the actor role',
        );
      }
      const goalFloor = run.floors.find((entry) => entry.floorId === actorValue.floorId)!;
      cell(goalFloor, goal.x, goal.y, `actors.${actorIndex}.behaviorState.goal`);
    }
    const investigationValue = actorValue.behaviorState.investigation;
    if (investigationValue !== null) {
      const investigationFloor = run.floors.find(
        (entry) => entry.floorId === investigationValue.floorId,
      );
      if (!investigationFloor)
        fail(
          `actors.${actorIndex}.behaviorState.investigation.floorId`,
          'investigation floor does not exist',
        );
      cell(
        investigationFloor,
        investigationValue.x,
        investigationValue.y,
        `actors.${actorIndex}.behaviorState.investigation`,
      );
      if (
        investigationValue.expiresAt !== null &&
        investigationValue.expiresAt < investigationValue.startedAt
      ) {
        fail(
          `actors.${actorIndex}.behaviorState.investigation.expiresAt`,
          'investigation cannot expire before it starts',
        );
      }
    }
  }

  const standingRecordIds = new Set<string>();
  for (let index = 0; index < run.fallenHeroStandings.length; index += 1) {
    const standing = run.fallenHeroStandings[index]!;
    if (standing.rank !== index + 1)
      fail(`fallenHeroStandings.${index}.rank`, 'standing ranks must be contiguous from 1');
    if (standingRecordIds.has(standing.hallRecordId))
      fail(`fallenHeroStandings.${index}.hallRecordId`, 'Hall record is duplicated');
    standingRecordIds.add(standing.hallRecordId);
    if (standing.heirloom.originatingHallRecordId !== standing.hallRecordId) {
      fail(
        `fallenHeroStandings.${index}.heirloom.originatingHallRecordId`,
        'heirloom provenance must match its Hall record',
      );
    }
    validateOrderedIds(standing.classTags, `fallenHeroStandings.${index}.classTags`, 'class tag');
    validateOrderedIds(
      standing.equippedItemContentIds,
      `fallenHeroStandings.${index}.equippedItemContentIds`,
      'equipped item',
    );
    validateOrderedIds(
      standing.signatureAbilityIds,
      `fallenHeroStandings.${index}.signatureAbilityIds`,
      'signature ability',
    );
  }
  validateOrderedIds(
    run.conqueredChampionRecordIds,
    'conqueredChampionRecordIds',
    'conquered Champion record',
  );
  for (let index = 0; index < run.fallenHeroDecisions.length; index += 1) {
    const decision = run.fallenHeroDecisions[index]!;
    if (decision.rank !== index + 1)
      fail(
        `fallenHeroDecisions.${index}.rank`,
        'fallen-hero decisions must follow standing rank order',
      );
    const standing = run.fallenHeroStandings.find(
      (entry) => entry.hallRecordId === decision.hallRecordId,
    );
    if (!standing || standing.rank !== decision.rank)
      fail(
        `fallenHeroDecisions.${index}.hallRecordId`,
        'fallen-hero decision has no matching standing',
      );
    if ((decision.rank === 1) !== (decision.role === 'champion'))
      fail(
        `fallenHeroDecisions.${index}.role`,
        'rank 1 must be Champion and lower ranks must be Echoes',
      );
    if ((decision.role === 'champion') !== (decision.gateRoll === null))
      fail(
        `fallenHeroDecisions.${index}.gateRoll`,
        'Champion has no gate roll and Echoes require one',
      );
    if (decision.encountered && !decision.retained)
      fail(
        `fallenHeroDecisions.${index}.encountered`,
        'only a retained fallen hero can be encountered',
      );
    if (decision.defeated && !decision.encountered)
      fail(
        `fallenHeroDecisions.${index}.defeated`,
        'a fallen hero must be encountered before defeat',
      );
  }
  if (run.fallenHeroDecisions.length !== run.fallenHeroStandings.length) {
    fail('fallenHeroDecisions', 'every standing requires exactly one run decision');
  }

  const savedHeroActor = actors.get(run.hero.actorId);
  if (!savedHeroActor || !savedHeroActor.playerControlled)
    fail('hero.actorId', 'hero must reference one player-controlled actor');
  if (savedHeroActor.floorId !== run.activeFloorId)
    fail('hero.actorId', 'hero actor must occupy the active floor');

  // A dead hero always requires a conclusion (`died`), but the reverse no longer holds: the Final
  // Chamber's voluntary conclusions (`became-heart`, `broke-cycle`) close the run with the hero
  // still alive, so a living hero may carry either a null conclusion (still playing) or one of
  // those non-death completions.
  if (savedHeroActor.health === 0 && run.conclusion === null) {
    fail('conclusion', 'a dead hero requires a non-null conclusion');
  }
  if (
    savedHeroActor.health > 0 &&
    run.conclusion !== null &&
    run.conclusion.completionType === 'died'
  ) {
    fail('conclusion', 'a living hero cannot carry a died conclusion');
  }
  if (run.conclusion !== null) {
    const { conclusion } = run;
    if (conclusion.concludedAtRevision > run.revision) {
      fail(
        'conclusion.concludedAtRevision',
        'conclusion cannot be recorded after the current revision',
      );
    }
    if (conclusion.cause.turn > run.turn)
      fail('conclusion.cause.turn', 'conclusion cause cannot occur after the current turn');
    if (conclusion.cause.worldTime > run.worldTime) {
      fail(
        'conclusion.cause.worldTime',
        'conclusion cause cannot occur after the current world time',
      );
    }
    if (!run.floors.some((floorValue) => floorValue.depth === conclusion.cause.depth)) {
      fail('conclusion.cause.depth', 'conclusion cause depth must match an existing floor');
    }
    if (conclusion.completionType !== 'died' && conclusion.cause.killerContentId !== null) {
      fail(
        'conclusion.cause.killerContentId',
        'only a died completion may record a killer content id',
      );
    }
  }
  const killsByModelSum =
    run.metrics.killsByModel.individual +
    run.metrics.killsByModel.group +
    run.metrics.killsByModel.swarm +
    run.metrics.killsByModel.boss;
  if (run.metrics.kills < killsByModelSum) {
    fail('metrics.kills', 'total kills cannot be below the sum of kills by population model');
  }

  validateOrderedIds(
    run.items.map((entry) => entry.itemId),
    'items',
    'item',
    'itemId',
  );
  const items = new Map(run.items.map((entry) => [entry.itemId, entry]));
  for (const [itemIndex, itemValue] of run.items.entries()) {
    const path = `items.${itemIndex}`;
    const location = itemValue.location;
    if (location.type === 'merchant-stock') {
      const owner = populations.get(location.populationId);
      if (!owner || owner.model !== 'merchant') {
        fail(`${path}.location.populationId`, 'merchant stock owner does not exist');
      }
      if (!owner.stockItemIds.includes(itemValue.itemId)) {
        fail(
          `${path}.location.populationId`,
          'merchant stock location is not referenced by its population',
        );
      }
      continue;
    }
    if (location.type === 'house') continue;
    if (location.type === 'floor') {
      const itemFloor = run.floors.find((candidate) => candidate.floorId === location.floorId);
      if (!itemFloor) fail(`${path}.location.floorId`, 'item floor does not exist');
      // Items drop at actor positions (hero drops, merchant stock loss), so floor items accept
      // exactly the cells actors may legally occupy: walkable terrain plus feature-walkable cells.
      ensureActorWalkable(itemFloor, run.features, location.x, location.y, `${path}.location`);
      continue;
    }
    const owner = actors.get(location.actorId);
    if (!owner) fail(`${path}.location.actorId`, 'item owner does not exist');
    if (location.type === 'equipped' && owner.equipment[location.slot] !== itemValue.itemId) {
      fail(`${path}.location.slot`, 'equipped item is not referenced by its actor slot');
    }
  }
  for (const [populationIndex, populationValue] of run.populations.entries()) {
    if (populationValue.model !== 'merchant') continue;
    for (const [stockIndex, itemId] of populationValue.stockItemIds.entries()) {
      const stock = items.get(itemId);
      if (
        !stock ||
        stock.location.type !== 'merchant-stock' ||
        stock.location.populationId !== populationValue.populationId
      ) {
        fail(
          `populations.${populationIndex}.stockItemIds.${stockIndex}`,
          'merchant stock item does not resolve bidirectionally',
        );
      }
    }
  }

  const houseStackCount = run.items.filter((entry) => entry.location.type === 'house').length;
  if (houseStackCount > run.house.capacity) {
    fail('house.capacity', 'house holds more item stacks than its capacity allows');
  }
  for (let index = 0; index < run.restockedMilestones.length; index += 1) {
    if (index > 0 && run.restockedMilestones[index - 1]! >= run.restockedMilestones[index]!) {
      fail(
        `restockedMilestones.${index}`,
        'restocked milestones must be unique and strictly increasing',
      );
    }
  }

  if (run.activeTrade !== null) {
    const trade = run.activeTrade;
    const merchant = populations.get(trade.merchantPopulationId);
    const merchantActor = actors.get(trade.merchantActorId);
    if (!merchant || merchant.model !== 'merchant' || merchant.lifecycle !== 'available') {
      fail(
        'activeTrade.merchantPopulationId',
        'active trade requires an available merchant population',
      );
    }
    if (
      !merchantActor ||
      merchant.actorId !== trade.merchantActorId ||
      merchantActor.populationId !== merchant.populationId ||
      merchantActor.health <= 0
    ) {
      fail(
        'activeTrade.merchantActorId',
        'active trade merchant actor does not match its population',
      );
    }
    const heroActor = actors.get(run.hero.actorId)!;
    if (
      merchant.floorId !== run.activeFloorId ||
      merchantActor.floorId !== heroActor.floorId ||
      Math.max(Math.abs(merchantActor.x - heroActor.x), Math.abs(merchantActor.y - heroActor.y)) !==
        1
    ) {
      fail(
        'activeTrade.merchantActorId',
        'active trade merchant must be adjacent on the active floor',
      );
    }
    if (trade.openedAtRevision > run.revision) {
      fail('activeTrade.openedAtRevision', 'active trade cannot open in a future revision');
    }
  }
  const heirloomRecordIds = new Set<string>();
  for (const [itemIndex, itemValue] of run.items.entries()) {
    if (itemValue.heirloom === undefined) continue;
    const champion = run.populations.find(
      (population) =>
        population.model === 'champion' &&
        population.rewardCreated &&
        `item.heirloom.${population.populationId}` === itemValue.itemId,
    );
    const standing =
      champion?.model === 'champion'
        ? run.fallenHeroStandings.find((entry) => entry.hallRecordId === champion.hallRecordId)
        : undefined;
    if (
      !champion ||
      !standing ||
      itemValue.quantity !== 1 ||
      itemValue.heirloom.originatingHallRecordId !== standing.hallRecordId ||
      itemValue.heirloom.originatingRank !== standing.rank ||
      itemValue.heirloom.sourceItemId !== standing.heirloom.sourceItemId ||
      heirloomRecordIds.has(itemValue.heirloom.originatingHallRecordId)
    ) {
      fail(
        `items.${itemIndex}.heirloom`,
        'heirloom provenance must uniquely match its reward-created Champion',
      );
    }
    heirloomRecordIds.add(itemValue.heirloom.originatingHallRecordId);
  }
  for (const [populationIndex, populationValue] of run.populations.entries()) {
    if (populationValue.model === 'boss') {
      const uniqueRewardId = `item.reward.${populationValue.populationId}.unique`;
      if (populationValue.rewardCreated && !items.has(uniqueRewardId)) {
        fail(
          `populations.${populationIndex}.rewardCreated`,
          'reward-created boss requires its guaranteed unique item',
        );
      }
      if (
        !populationValue.rewardCreated &&
        run.items.some((item) =>
          item.itemId.startsWith(`item.reward.${populationValue.populationId}.`),
        )
      ) {
        fail(
          `populations.${populationIndex}.rewardCreated`,
          'boss reward items cannot exist before reward creation',
        );
      }
    }
    if (populationValue.model !== 'champion' || !populationValue.rewardCreated) continue;
    const expected = items.get(`item.heirloom.${populationValue.populationId}`);
    if (expected?.heirloom === undefined) {
      fail(
        `populations.${populationIndex}.rewardCreated`,
        'reward-created Champion requires its exact heirloom item',
      );
    }
  }
  for (const [actorIndex, actorValue] of run.actors.entries()) {
    for (const [slotName, itemId] of Object.entries(actorValue.equipment)) {
      if (itemId === null) continue;
      const itemValue = items.get(itemId);
      if (!itemValue)
        fail(`actors.${actorIndex}.equipment.${slotName}`, 'equipped item does not exist');
      if (
        itemValue.location.type !== 'equipped' ||
        itemValue.location.actorId !== actorValue.actorId ||
        itemValue.location.slot !== slotName
      ) {
        fail(
          `actors.${actorIndex}.equipment.${slotName}`,
          'equipment reference disagrees with item location',
        );
      }
    }
  }

  validateOrderedIds(
    run.features.map((entry) => entry.featureId),
    'features',
    'feature',
    'featureId',
  );
  for (const [featureIndex, featureValue] of run.features.entries()) {
    const path = `features.${featureIndex}`;
    const featureFloor = run.floors.find((candidate) => candidate.floorId === featureValue.floorId);
    if (!featureFloor) fail(`${path}.floorId`, 'feature floor does not exist');
    const featureCell = cell(featureFloor, featureValue.x, featureValue.y, path);
    if (
      featureValue.type === 'door' &&
      featureFloor.tiles[featureCell] !== featureValue.coverTileId
    ) {
      fail(`${path}.coverTileId`, 'door cover tile does not match its floor terrain');
    }
    if (featureValue.type === 'door') {
      if ((featureValue.state === 'locked') !== (featureValue.lock !== undefined)) {
        fail(`${path}.lock`, 'door lock is present if and only if it is locked');
      }
    }
    if (featureValue.type === 'chest') {
      if ((featureValue.state === 'locked') !== (featureValue.lock !== null)) {
        fail(`${path}.lock`, 'chest lock is present if and only if it is locked');
      }
      const hasLootPointer =
        featureValue.lootTableId !== null || featureValue.lootContentId !== null;
      if (featureValue.state === 'looted' || featureValue.state === 'jammed') {
        if (hasLootPointer)
          fail(`${path}.lootTableId`, 'looted or jammed chest must not carry a live loot pointer');
      } else if (!hasLootPointer) {
        fail(`${path}.lootTableId`, 'locked or closed chest requires loot contents');
      } else if (featureValue.lootTableId !== null && featureValue.lootContentId !== null) {
        fail(
          `${path}.lootTableId`,
          'chest loot must name exactly one of lootTableId/lootContentId',
        );
      }
    }
    if (featureValue.type !== 'door' && featureValue.type !== 'chest') {
      validateOrderedIds(
        featureValue.discovery.discoveredByActorIds,
        `${path}.discovery.discoveredByActorIds`,
        'discovering actor',
      );
      validateOrderedIds(
        featureValue.discovery.attemptedContextKeys,
        `${path}.discovery.attemptedContextKeys`,
        'discovery context',
      );
      for (const actorId of featureValue.discovery.discoveredByActorIds) {
        if (!actors.has(actorId))
          fail(`${path}.discovery.discoveredByActorIds`, 'discovering actor does not exist');
      }
      for (const actorId of Object.keys(featureValue.discovery.progressByActorId)) {
        if (!actors.has(actorId))
          fail(`${path}.discovery.progressByActorId.${actorId}`, 'progress actor does not exist');
      }
    }
  }

  let previousRelationshipKey = '';
  for (const [relationshipIndex, relationshipValue] of run.relationships.entries()) {
    const path = `relationships.${relationshipIndex}`;
    if (relationshipValue.leftActorId >= relationshipValue.rightActorId)
      fail(
        `${path}.rightActorId`,
        'relationship actor identifiers must be a strictly increasing pair',
      );
    if (!actors.has(relationshipValue.leftActorId) || !actors.has(relationshipValue.rightActorId))
      fail(path, 'relationship actor does not exist');
    const key = `${relationshipValue.leftActorId}\u0000${relationshipValue.rightActorId}`;
    if (key <= previousRelationshipKey)
      fail(path, 'relationship pairs must be unique and strictly increasing');
    previousRelationshipKey = key;
  }

  validateOrderedIds(
    Object.keys(run.identification.appearanceByContentId),
    'identification.appearanceByContentId',
    'content',
  );
  validateOrderedIds(
    run.identification.knownAppearanceIds,
    'identification.knownAppearanceIds',
    'appearance',
  );
  const hungerStageOrder = ['hungry', 'weak', 'starving'] as const;
  let previousHungerWarning = -1;
  for (const [index, warning] of run.survival.emittedHungerWarnings.entries()) {
    const position = hungerStageOrder.indexOf(warning as (typeof hungerStageOrder)[number]);
    if (position <= previousHungerWarning) {
      fail(
        `survival.emittedHungerWarnings.${index}`,
        'hunger warnings must be unique and in deterioration order',
      );
    }
    previousHungerWarning = position;
  }
  validateOrderedIds(
    run.survival.emittedFuelWarnings,
    'survival.emittedFuelWarnings',
    'fuel warning',
  );
  for (const [floorIndex, floorValue] of run.floors.entries()) {
    for (const [lightIndex, source] of floorValue.lights.entries()) {
      const actorId = source.location.type === 'actor' ? source.location.actorId : undefined;
      const attachedActor = actorId === undefined ? undefined : actors.get(actorId);
      if (attachedActor && attachedActor.floorId === floorValue.floorId) continue;
      if (
        actorId !== undefined &&
        !floorValue.entities.some((entry) => entry.entityId === actorId)
      ) {
        fail(
          `floors.${floorIndex}.lights.${lightIndex}.location.actorId`,
          'attached actor does not exist on this floor',
        );
      }
    }
  }
  // Revision-only trade commands advance the revision without a turn, so turn may trail revision.
  if (run.turn > run.revision) fail('turn', 'turn cannot exceed revision');

  const commandIds = new Set<string>();
  let previousRevision = 0;
  let concludedEventCount = 0;
  for (const [index, recordValue] of run.recentCommands.entries()) {
    const path = `recentCommands.${index}`;
    for (const [eventIndex, savedEvent] of recordValue.events.entries()) {
      if (savedEvent.type === 'actor.intent-changed') {
        if (!actors.has(savedEvent.actorId))
          fail(`${path}.events.${eventIndex}.actorId`, 'intent actor does not exist');
        if (savedEvent.presentation !== `intent.${savedEvent.intent}`) {
          fail(
            `${path}.events.${eventIndex}.presentation`,
            'intent presentation disagrees with intent',
          );
        }
      }
      if (savedEvent.type === 'run.finalized' || savedEvent.type === 'achievement.granted') {
        fail(
          `${path}.events.${eventIndex}`,
          'run.finalized and achievement.granted are produced only by finalizeRun and cannot be retained in recentCommands',
        );
      }
      if (savedEvent.type === 'run.concluded') {
        concludedEventCount += 1;
        if (concludedEventCount > 1)
          fail(
            `${path}.events.${eventIndex}`,
            'at most one run.concluded event may be retained across recentCommands',
          );
        if (run.conclusion === null)
          fail(`${path}.events.${eventIndex}`, 'a run.concluded event requires a concluded run');
      }
    }
    for (const [eventIndex, savedEvent] of recordValue.publicEvents.entries()) {
      if (savedEvent.type === 'run.finalized' || savedEvent.type === 'achievement.granted') {
        fail(
          `${path}.publicEvents.${eventIndex}`,
          'run.finalized and achievement.granted are produced only by finalizeRun and cannot be retained in recentCommands',
        );
      }
    }
    if (commandIds.has(recordValue.command.commandId))
      fail(`${path}.command.commandId`, 'command identifier is duplicated');
    commandIds.add(recordValue.command.commandId);
    if (recordValue.command.commandId !== recordValue.result.commandId)
      fail(`${path}.result.commandId`, 'result does not match command');
    // House deposit/withdraw only relocate an item and emit no domain event by design (see
    // `resolveHouseCommand`); they are still recorded for command-id dedup. Every other applied
    // command must carry at least one event.
    const eventFreeCommand =
      recordValue.command.type === 'house-deposit' || recordValue.command.type === 'house-withdraw';
    if (recordValue.events.length === 0 && !eventFreeCommand)
      fail(`${path}.events`, 'processed commands require at least one event');
    if (
      recordValue.events.some(
        (entry) => !('eventId' in entry) || entry.eventId !== recordValue.command.commandId,
      )
    )
      fail(`${path}.events`, 'event identifier does not match command');
    if (
      recordValue.publicEvents.some(
        (entry) => 'eventId' in entry && entry.eventId !== recordValue.command.commandId,
      )
    )
      fail(`${path}.publicEvents`, 'public event identifier does not match command');
    const attackTargetActorId =
      recordValue.command.type === 'attack' ? recordValue.command.targetActorId : undefined;
    const commandItemId = 'itemId' in recordValue.command ? recordValue.command.itemId : undefined;
    const splitNewItemId =
      recordValue.command.type === 'split-stack' ? recordValue.command.newItemId : undefined;
    const commandQuantity =
      'quantity' in recordValue.command ? recordValue.command.quantity : undefined;
    const commandSlot = 'slot' in recordValue.command ? recordValue.command.slot : undefined;
    const commandEnabled =
      recordValue.command.type === 'toggle-light' ? recordValue.command.enabled : undefined;
    const commandFuelItemId =
      recordValue.command.type === 'refuel' ? recordValue.command.fuelItemId : undefined;
    const commandFeatureId =
      'featureId' in recordValue.command ? recordValue.command.featureId : undefined;
    const commandTargetItemId =
      recordValue.command.type === 'trade-service' ? recordValue.command.targetItemId : undefined;
    // An applied house command relocates an item and emits no event (see `resolveHouseCommand`), so
    // there is no event to match or check consistency against. An *invalid* house command still
    // carries its `action.invalid` event and is validated normally below.
    if (!(eventFreeCommand && recordValue.result.status === 'applied')) {
      const eventValue =
        recordValue.result.status === 'invalid'
          ? recordValue.events.find((entry) => entry.type === 'action.invalid')
          : recordValue.command.type === 'wait'
            ? recordValue.events.find((entry) => entry.type === 'hero.waited')
            : recordValue.command.type === 'final-chamber-choice'
              ? (recordValue.events.find((entry) => entry.type === 'run.concluded') ??
                recordValue.events.find((entry) => entry.type === 'population.created'))
              : recordValue.command.type === 'move'
                ? (recordValue.events.find((entry) => entry.type === 'hero.moved') ??
                  recordValue.events.find(
                    (entry) =>
                      (entry.type === 'attack.hit' || entry.type === 'attack.missed') &&
                      entry.actorId === run.hero.actorId,
                  ) ??
                  recordValue.events.find(
                    (entry) =>
                      entry.type === 'reaction.triggered' &&
                      entry.targetActorId === run.hero.actorId,
                  ))
                : recordValue.command.type === 'attack'
                  ? recordValue.events.find(
                      (entry) =>
                        (entry.type === 'attack.hit' || entry.type === 'attack.missed') &&
                        entry.actorId === run.hero.actorId &&
                        entry.targetActorId === attackTargetActorId,
                    )
                  : recordValue.command.type === 'pickup'
                    ? recordValue.events.find(
                        (entry) =>
                          entry.type === 'item.picked-up' &&
                          entry.actorId === run.hero.actorId &&
                          entry.itemId === commandItemId,
                      )
                    : recordValue.command.type === 'drop'
                      ? recordValue.events.find(
                          (entry) =>
                            entry.type === 'item.dropped' &&
                            entry.actorId === run.hero.actorId &&
                            entry.itemId === commandItemId,
                        )
                      : recordValue.command.type === 'split-stack'
                        ? recordValue.events.find(
                            (entry) =>
                              entry.type === 'item.stack-split' &&
                              entry.actorId === run.hero.actorId &&
                              entry.itemId === commandItemId &&
                              entry.newItemId === splitNewItemId,
                          )
                        : recordValue.command.type === 'fire'
                          ? recordValue.events.find(
                              (entry) =>
                                (entry.type === 'attack.hit' || entry.type === 'attack.missed') &&
                                entry.actorId === run.hero.actorId,
                            )
                          : recordValue.command.type === 'cast'
                            ? recordValue.events.find(
                                (entry) =>
                                  (entry.type === 'attack.hit' &&
                                    entry.actorId === run.hero.actorId) ||
                                  ((entry.type === 'actor.damaged' ||
                                    entry.type === 'actor.healed' ||
                                    entry.type === 'condition.applied') &&
                                    entry.sourceActorId === run.hero.actorId) ||
                                  (entry.type === 'hero.recalled' &&
                                    entry.actorId === run.hero.actorId) ||
                                  (entry.type === 'spell.cast' &&
                                    entry.actorId === run.hero.actorId),
                              )
                            : recordValue.command.type === 'throw-item'
                              ? recordValue.events.find(
                                  (entry) =>
                                    entry.type === 'item.thrown' &&
                                    entry.actorId === run.hero.actorId &&
                                    entry.quantity === commandQuantity,
                                )
                              : recordValue.command.type === 'use-item'
                                ? recordValue.events.find(
                                    (entry) =>
                                      entry.type === 'item.used' &&
                                      entry.actorId === run.hero.actorId &&
                                      entry.itemId === commandItemId,
                                  )
                                : recordValue.command.type === 'equip'
                                  ? recordValue.events.find(
                                      (entry) =>
                                        entry.type === 'item.equipped' &&
                                        entry.actorId === run.hero.actorId &&
                                        entry.itemId === commandItemId &&
                                        entry.slot === commandSlot,
                                    )
                                  : recordValue.command.type === 'unequip'
                                    ? recordValue.events.find(
                                        (entry) =>
                                          entry.type === 'item.unequipped' &&
                                          entry.actorId === run.hero.actorId &&
                                          entry.slot === commandSlot,
                                      )
                                    : recordValue.command.type === 'toggle-light'
                                      ? recordValue.events.find(
                                          (entry) =>
                                            entry.type === 'item.light-toggled' &&
                                            entry.actorId === run.hero.actorId &&
                                            entry.itemId === commandItemId &&
                                            entry.enabled === commandEnabled,
                                        )
                                      : recordValue.command.type === 'refuel'
                                        ? recordValue.events.find(
                                            (entry) =>
                                              entry.type === 'item.refueled' &&
                                              entry.actorId === run.hero.actorId &&
                                              entry.itemId === commandItemId &&
                                              entry.fuelItemId === commandFuelItemId,
                                          )
                                        : recordValue.command.type === 'open-door'
                                          ? recordValue.events.find(
                                              (entry) =>
                                                entry.type === 'door.opened' &&
                                                entry.actorId === run.hero.actorId &&
                                                entry.featureId === commandFeatureId,
                                            )
                                          : recordValue.command.type === 'close-door'
                                            ? recordValue.events.find(
                                                (entry) =>
                                                  entry.type === 'door.closed' &&
                                                  entry.actorId === run.hero.actorId &&
                                                  entry.featureId === commandFeatureId,
                                              )
                                            : recordValue.command.type === 'search'
                                              ? recordValue.events.find(
                                                  (entry) =>
                                                    entry.type === 'feature.searched' &&
                                                    entry.actorId === run.hero.actorId,
                                                )
                                              : recordValue.command.type === 'disarm'
                                                ? recordValue.events.find(
                                                    (entry) =>
                                                      (entry.type === 'trap.disarmed' ||
                                                        entry.type === 'trap.triggered' ||
                                                        entry.type === 'trap.disarm-failed') &&
                                                      entry.actorId === run.hero.actorId &&
                                                      entry.featureId === commandFeatureId,
                                                  )
                                                : recordValue.command.type === 'pick-lock'
                                                  ? recordValue.events.find(
                                                      (entry) =>
                                                        (entry.type === 'lock.picked' ||
                                                          entry.type === 'lock.pick-failed' ||
                                                          entry.type === 'door.unlocked' ||
                                                          entry.type === 'chest.jammed') &&
                                                        entry.actorId === run.hero.actorId &&
                                                        entry.featureId === commandFeatureId,
                                                    )
                                                  : recordValue.command.type === 'rest'
                                                    ? recordValue.events.find(
                                                        (entry) => entry.type === 'rest.completed',
                                                      )
                                                    : recordValue.command.type === 'trade-open'
                                                      ? recordValue.events.find(
                                                          (entry) => entry.type === 'trade.opened',
                                                        )
                                                      : recordValue.command.type === 'trade-buy'
                                                        ? recordValue.events.find(
                                                            (entry) =>
                                                              entry.type === 'trade.bought' &&
                                                              entry.itemId === commandItemId &&
                                                              entry.quantity === commandQuantity,
                                                          )
                                                        : recordValue.command.type === 'trade-sell'
                                                          ? recordValue.events.find(
                                                              (entry) =>
                                                                entry.type === 'trade.sold' &&
                                                                entry.itemId === commandItemId &&
                                                                entry.quantity === commandQuantity,
                                                            )
                                                          : recordValue.command.type ===
                                                              'trade-service'
                                                            ? recordValue.events.find(
                                                                (entry) =>
                                                                  entry.type ===
                                                                    'trade.service-purchased' &&
                                                                  entry.targetItemId ===
                                                                    commandTargetItemId,
                                                              )
                                                            : recordValue.command.type ===
                                                                'trade-close'
                                                              ? recordValue.events.find(
                                                                  (entry) =>
                                                                    entry.type === 'trade.closed',
                                                                )
                                                              : undefined;
      if (!eventValue) fail(`${path}.events`, 'processed result has no matching event');
      if (recordValue.result.status === 'invalid') {
        if (
          eventValue.type !== 'action.invalid' ||
          eventValue.commandId !== recordValue.command.commandId ||
          eventValue.reason !== recordValue.result.reason
        )
          fail(`${path}.events.0`, 'invalid result and event are inconsistent');
      } else if (recordValue.command.type === 'wait') {
        if (eventValue.type !== 'hero.waited' || eventValue.heroId !== run.hero.actorId)
          fail(`${path}.events.0`, 'wait result and event are inconsistent');
        ensureActorWalkable(
          activeFloor,
          run.features,
          eventValue.x,
          eventValue.y,
          `${path}.events.0`,
        );
      } else if (
        recordValue.command.type === 'move' &&
        eventValue.type === 'hero.moved' &&
        eventValue.heroId === run.hero.actorId
      ) {
        ensureActorWalkable(
          activeFloor,
          run.features,
          eventValue.from.x,
          eventValue.from.y,
          `${path}.events.0.from`,
        );
        ensureActorWalkable(
          activeFloor,
          run.features,
          eventValue.to.x,
          eventValue.to.y,
          `${path}.events.0.to`,
        );
      } else if (
        recordValue.command.type === 'move' &&
        eventValue.type === 'reaction.triggered' &&
        eventValue.targetActorId === run.hero.actorId
      ) {
        // A reaction may kill or immobilize the hero before the attempted move completes.
      } else if (
        (recordValue.command.type === 'move' || recordValue.command.type === 'attack') &&
        (eventValue.type === 'attack.hit' || eventValue.type === 'attack.missed') &&
        eventValue.actorId === run.hero.actorId
      ) {
        if (
          recordValue.command.type === 'attack' &&
          eventValue.targetActorId !== recordValue.command.targetActorId
        ) {
          fail(`${path}.events`, 'attack target and event are inconsistent');
        }
      } else if (
        (recordValue.command.type === 'pickup' && eventValue.type === 'item.picked-up') ||
        (recordValue.command.type === 'drop' && eventValue.type === 'item.dropped') ||
        (recordValue.command.type === 'split-stack' && eventValue.type === 'item.stack-split')
      ) {
        if (eventValue.quantity !== recordValue.command.quantity)
          fail(`${path}.events`, 'item quantity and event are inconsistent');
      } else if (
        recordValue.command.type === 'fire' &&
        (eventValue.type === 'attack.hit' || eventValue.type === 'attack.missed') &&
        eventValue.actorId === run.hero.actorId
      ) {
        // Ammunition consumption is separately recorded before the attack event.
      } else if (
        recordValue.command.type === 'throw-item' &&
        eventValue.type === 'item.thrown' &&
        eventValue.actorId === run.hero.actorId &&
        eventValue.quantity === recordValue.command.quantity
      ) {
        ensureActorWalkable(
          activeFloor,
          run.features,
          eventValue.to.x,
          eventValue.to.y,
          `${path}.events.0.to`,
        );
      } else if (
        recordValue.command.type === 'use-item' &&
        eventValue.type === 'item.used' &&
        eventValue.actorId === run.hero.actorId &&
        eventValue.itemId === recordValue.command.itemId
      ) {
        // The item's authored effects determine whether and how much quantity is consumed.
      } else if (
        (recordValue.command.type === 'equip' && eventValue.type === 'item.equipped') ||
        (recordValue.command.type === 'unequip' && eventValue.type === 'item.unequipped')
      ) {
        if (
          eventValue.actorId !== run.hero.actorId ||
          eventValue.slot !== recordValue.command.slot
        ) {
          fail(`${path}.events`, 'equipment command and event are inconsistent');
        }
      } else if (
        recordValue.command.type === 'toggle-light' &&
        eventValue.type === 'item.light-toggled' &&
        eventValue.actorId === run.hero.actorId &&
        eventValue.itemId === recordValue.command.itemId &&
        eventValue.enabled === recordValue.command.enabled
      ) {
        // Item state carries the resulting enabled flag.
      } else if (
        recordValue.command.type === 'refuel' &&
        eventValue.type === 'item.refueled' &&
        eventValue.actorId === run.hero.actorId &&
        eventValue.itemId === recordValue.command.itemId &&
        eventValue.fuelItemId === recordValue.command.fuelItemId
      ) {
        if (eventValue.quantity > recordValue.command.quantity)
          fail(`${path}.events`, 'refuel event exceeds requested quantity');
      } else if (
        ((recordValue.command.type === 'open-door' && eventValue.type === 'door.opened') ||
          (recordValue.command.type === 'close-door' && eventValue.type === 'door.closed')) &&
        eventValue.actorId === run.hero.actorId &&
        eventValue.featureId === recordValue.command.featureId
      ) {
        // Feature state carries the resulting door geometry.
      } else if (
        recordValue.command.type === 'search' &&
        eventValue.type === 'feature.searched' &&
        eventValue.actorId === run.hero.actorId
      ) {
        // Discovery progress is stored on affected features.
      } else if (
        recordValue.command.type === 'disarm' &&
        (eventValue.type === 'trap.disarmed' ||
          eventValue.type === 'trap.triggered' ||
          eventValue.type === 'trap.disarm-failed') &&
        eventValue.actorId === run.hero.actorId &&
        eventValue.featureId === recordValue.command.featureId
      ) {
        // Trap state and the effects random stream store the outcome.
      } else if (
        recordValue.command.type === 'pick-lock' &&
        (eventValue.type === 'lock.picked' ||
          eventValue.type === 'lock.pick-failed' ||
          eventValue.type === 'door.unlocked' ||
          eventValue.type === 'chest.jammed') &&
        eventValue.actorId === run.hero.actorId &&
        eventValue.featureId === recordValue.command.featureId
      ) {
        // Feature state, any dropped loot, and the effects random stream store the outcome.
      } else if (recordValue.command.type === 'rest' && eventValue.type === 'rest.completed') {
        if (eventValue.elapsed > recordValue.command.maximumDuration) {
          fail(`${path}.events`, 'rest event exceeds requested maximum duration');
        }
      } else if (recordValue.command.type === 'trade-open' && eventValue.type === 'trade.opened') {
        if (eventValue.merchantActorId !== recordValue.command.merchantActorId) {
          fail(`${path}.events`, 'trade-open merchant and event are inconsistent');
        }
      } else if (
        (recordValue.command.type === 'trade-buy' && eventValue.type === 'trade.bought') ||
        (recordValue.command.type === 'trade-sell' && eventValue.type === 'trade.sold')
      ) {
        if (
          eventValue.merchantPopulationId !== recordValue.command.merchantPopulationId ||
          eventValue.itemId !== recordValue.command.itemId ||
          eventValue.quantity !== recordValue.command.quantity ||
          eventValue.total !== eventValue.unitPrice * eventValue.quantity
        ) {
          fail(`${path}.events`, 'trade transaction command and event are inconsistent');
        }
      } else if (
        recordValue.command.type === 'trade-service' &&
        eventValue.type === 'trade.service-purchased'
      ) {
        if (
          eventValue.merchantPopulationId !== recordValue.command.merchantPopulationId ||
          eventValue.serviceId !== recordValue.command.serviceId ||
          eventValue.targetItemId !== recordValue.command.targetItemId
        ) {
          fail(`${path}.events`, 'trade service command and event are inconsistent');
        }
      } else if (recordValue.command.type === 'trade-close' && eventValue.type === 'trade.closed') {
        if (
          eventValue.merchantPopulationId !== recordValue.command.merchantPopulationId ||
          eventValue.reason !== 'player'
        ) {
          fail(`${path}.events`, 'trade-close command and event are inconsistent');
        }
      } else if (
        recordValue.command.type === 'final-chamber-choice' &&
        (eventValue.type === 'run.concluded' || eventValue.type === 'population.created')
      ) {
        // `become-heart`/`broke-cycle` conclude immediately (`run.concluded`); `turn-away` activates
        // the weakened Heart boss (`population.created`) and concludes only once the fight resolves.
      } else if (
        recordValue.command.type === 'cast' &&
        ((eventValue.type === 'attack.hit' && eventValue.actorId === run.hero.actorId) ||
          ((eventValue.type === 'actor.damaged' ||
            eventValue.type === 'actor.healed' ||
            eventValue.type === 'condition.applied') &&
            eventValue.sourceActorId === run.hero.actorId) ||
          (eventValue.type === 'hero.recalled' && eventValue.actorId === run.hero.actorId) ||
          (eventValue.type === 'spell.cast' && eventValue.actorId === run.hero.actorId))
      ) {
        // The spell's authored effects (damage/heal/condition), a recall, or the cast marker
        // itself (guaranteed on every cast, including zero-target AoE) determine the outcome.
      } else fail(`${path}.events`, 'applied command and event are inconsistent');
    }
    if (
      recordValue.result.revision < previousRevision ||
      recordValue.result.revision > run.revision
    )
      fail(`${path}.result.revision`, 'record revisions are not monotonic');
    if (recordValue.result.turn > run.turn)
      fail(`${path}.result.turn`, 'record turn exceeds current turn');
    if (recordValue.result.turn > recordValue.result.revision)
      fail(`${path}.result.turn`, 'result turn cannot exceed its revision');
    if (
      recordValue.result.status === 'applied' &&
      recordValue.result.revision !== recordValue.command.expectedRevision + 1
    )
      fail(`${path}.result.revision`, 'applied revision is inconsistent');
    if (
      recordValue.result.status === 'invalid' &&
      recordValue.result.revision !== recordValue.command.expectedRevision
    )
      fail(`${path}.result.revision`, 'invalid revision is inconsistent');
    const previousRecord = run.recentCommands[index - 1];
    if (previousRecord && recordValue.command.expectedRevision !== previousRecord.result.revision)
      fail(
        `${path}.command.expectedRevision`,
        'command revision does not follow the preceding result',
      );
    previousRevision = recordValue.result.revision;
  }
  const finalRecord = run.recentCommands.at(-1);
  if (finalRecord) {
    const finalIndex = run.recentCommands.length - 1;
    if (finalRecord.result.revision !== run.revision)
      fail(
        `recentCommands.${finalIndex}.result.revision`,
        'final result does not match current revision',
      );
    if (finalRecord.result.turn !== run.turn)
      fail(`recentCommands.${finalIndex}.result.turn`, 'final result does not match current turn');
  }
  let knownPosition = { x: savedHeroActor.x, y: savedHeroActor.y };
  for (let index = run.recentCommands.length - 1; index >= 0; index -= 1) {
    const recordValue = run.recentCommands[index]!;
    const eventValue =
      recordValue.result.status === 'invalid'
        ? recordValue.events.find((entry) => entry.type === 'action.invalid')!
        : recordValue.command.type === 'wait'
          ? recordValue.events.find((entry) => entry.type === 'hero.waited')!
          : recordValue.command.type === 'move'
            ? (recordValue.events.find((entry) => entry.type === 'hero.moved') ??
              recordValue.events.find(
                (entry) =>
                  (entry.type === 'attack.hit' || entry.type === 'attack.missed') &&
                  entry.actorId === run.hero.actorId,
              ) ??
              recordValue.events.find(
                (entry) =>
                  entry.type === 'reaction.triggered' && entry.targetActorId === run.hero.actorId,
              )!)
            : (recordValue.events.find(
                (entry) =>
                  (entry.type === 'attack.hit' || entry.type === 'attack.missed') &&
                  entry.actorId === run.hero.actorId,
              ) ??
              recordValue.events.find(
                (entry) =>
                  (entry.type === 'item.picked-up' ||
                    entry.type === 'item.dropped' ||
                    entry.type === 'item.stack-split' ||
                    entry.type === 'item.thrown' ||
                    entry.type === 'item.used') &&
                  entry.actorId === run.hero.actorId,
              ) ??
              recordValue.events.find(
                (entry) =>
                  (entry.type === 'item.equipped' || entry.type === 'item.unequipped') &&
                  entry.actorId === run.hero.actorId,
              ) ??
              recordValue.events.find(
                (entry) =>
                  (entry.type === 'item.light-toggled' || entry.type === 'item.refueled') &&
                  entry.actorId === run.hero.actorId,
              ) ??
              recordValue.events.find(
                (entry) =>
                  (entry.type === 'door.opened' || entry.type === 'door.closed') &&
                  entry.actorId === run.hero.actorId,
              ) ??
              recordValue.events.find(
                (entry) => entry.type === 'feature.searched' && entry.actorId === run.hero.actorId,
              ) ??
              recordValue.events.find(
                (entry) =>
                  (entry.type === 'trap.disarmed' ||
                    entry.type === 'trap.triggered' ||
                    entry.type === 'trap.disarm-failed') &&
                  entry.actorId === run.hero.actorId,
              )!);
    const path = `recentCommands.${index}`;
    const tradeCommand =
      recordValue.command.type === 'trade-open' ||
      recordValue.command.type === 'trade-buy' ||
      recordValue.command.type === 'trade-sell' ||
      recordValue.command.type === 'trade-service' ||
      recordValue.command.type === 'trade-close';
    if (recordValue.result.status === 'invalid') {
      if (recordValue.command.type !== 'move') {
        const inventoryCommand =
          recordValue.command.type === 'pickup' ||
          recordValue.command.type === 'drop' ||
          recordValue.command.type === 'split-stack' ||
          recordValue.command.type === 'equip' ||
          recordValue.command.type === 'unequip' ||
          recordValue.command.type === 'refuel' ||
          recordValue.command.type === 'toggle-light';
        const inventoryReason =
          recordValue.result.reason === 'inventory.full' ||
          recordValue.result.reason.startsWith('item.');
        const targetReason = recordValue.result.reason.startsWith('target.');
        const targetingCommand =
          recordValue.command.type === 'fire' ||
          recordValue.command.type === 'cast' ||
          recordValue.command.type === 'throw-item' ||
          recordValue.command.type === 'use-item';
        const tradeReason =
          recordValue.result.reason.startsWith('trade.') ||
          recordValue.result.reason.startsWith('merchant.');
        const houseCommand =
          recordValue.command.type === 'house-deposit' ||
          recordValue.command.type === 'house-withdraw';
        const houseReason = recordValue.result.reason === 'house.full';
        // A truce or rest rejection may reject any in-town command, not just a specific shape.
        const townReason =
          recordValue.result.reason === 'town.truce' || recordValue.result.reason === 'town.rest';
        const doorCommand =
          recordValue.command.type === 'open-door' || recordValue.command.type === 'close-door';
        const doorReason = recordValue.result.reason.startsWith('door.');
        const finalChamberReason = recordValue.result.reason.startsWith('final-chamber.');
        const recallReason = recordValue.result.reason === 'recall.already-town';
        const castReason = recordValue.result.reason.startsWith('cast.');
        const learnReason = recordValue.result.reason.startsWith('learn.');
        if (tradeReason) {
          // Modal rejection: any command may fail with trade.active; other trade reasons
          // require the trade command boundary.
          if (!tradeCommand && recordValue.result.reason !== 'trade.active') {
            fail(`${path}.result.reason`, 'trade reason requires a trade command');
          }
          continue;
        }
        if (inventoryReason && !inventoryCommand && !houseCommand) {
          if (
            recordValue.command.type !== 'fire' &&
            recordValue.command.type !== 'throw-item' &&
            recordValue.command.type !== 'use-item' &&
            recordValue.command.type !== 'trade-buy' &&
            recordValue.command.type !== 'trade-sell'
          ) {
            fail(`${path}.result.reason`, 'inventory reasons require an item command');
          }
        }
        if (targetReason && !targetingCommand)
          fail(`${path}.result.reason`, 'target reason requires a targeting command');
        if (houseReason && !houseCommand)
          fail(`${path}.result.reason`, 'house reason requires a house command');
        if (doorReason && !doorCommand)
          fail(`${path}.result.reason`, 'door reason requires a door command');
        if (finalChamberReason && recordValue.command.type !== 'final-chamber-choice')
          fail(`${path}.result.reason`, 'final-chamber reason requires a final-chamber choice');
        if (recallReason && recordValue.command.type !== 'cast')
          fail(`${path}.result.reason`, 'recall reason requires a cast command');
        if (castReason && recordValue.command.type !== 'cast')
          fail(`${path}.result.reason`, 'cast reason requires a cast command');
        if (learnReason && recordValue.command.type !== 'use-item')
          fail(`${path}.result.reason`, 'learn reason requires a use-item command');
        if (
          !inventoryReason &&
          !targetReason &&
          !houseReason &&
          !townReason &&
          !doorReason &&
          !finalChamberReason &&
          !recallReason &&
          !castReason &&
          !learnReason &&
          recordValue.result.reason !== 'action.unavailable' &&
          recordValue.result.reason !== 'run.concluded'
        ) {
          fail(`${path}.result.reason`, 'non-movement command reason is inconsistent');
        }
        continue;
      }
      if (
        recordValue.result.reason === 'action.unavailable' ||
        recordValue.result.reason === 'run.concluded'
      )
        continue;
      if (
        [
          'blocked.bounds',
          'blocked.wall',
          'blocked.door',
          'blocked.pillar',
          'blocked.void',
        ].includes(recordValue.result.reason)
      ) {
        const offset = directionOffsets[recordValue.command.direction];
        const attempted = { x: knownPosition.x + offset.x, y: knownPosition.y + offset.y };
        const attemptedIndex = tileIndex(activeFloor, attempted.x, attempted.y);
        const actualReason =
          attemptedIndex === undefined
            ? 'blocked.bounds'
            : movementBlockReason(activeFloor.tiles[attemptedIndex]!);
        if (recordValue.result.reason !== actualReason)
          fail(`${path}.result.reason`, 'invalid reason does not match the active floor');
      }
      continue;
    }
    if (recordValue.command.type === 'wait') {
      if (
        eventValue.type !== 'hero.waited' ||
        eventValue.x !== knownPosition.x ||
        eventValue.y !== knownPosition.y
      )
        fail(`${path}.events.0`, 'wait position does not match the retained position chain');
      continue;
    }
    if (
      recordValue.command.type === 'attack' ||
      recordValue.command.type === 'pickup' ||
      recordValue.command.type === 'drop' ||
      recordValue.command.type === 'split-stack' ||
      recordValue.command.type === 'fire' ||
      recordValue.command.type === 'throw-item' ||
      recordValue.command.type === 'use-item' ||
      recordValue.command.type === 'equip' ||
      recordValue.command.type === 'unequip' ||
      recordValue.command.type === 'toggle-light' ||
      recordValue.command.type === 'refuel' ||
      recordValue.command.type === 'open-door' ||
      recordValue.command.type === 'close-door' ||
      recordValue.command.type === 'search' ||
      recordValue.command.type === 'disarm' ||
      recordValue.command.type === 'pick-lock' ||
      recordValue.command.type === 'rest' ||
      recordValue.command.type === 'house-deposit' ||
      recordValue.command.type === 'house-withdraw' ||
      recordValue.command.type === 'final-chamber-choice' ||
      recordValue.command.type === 'cast' ||
      tradeCommand
    )
      continue;
    if (recordValue.command.type !== 'move')
      fail(`${path}.events`, 'move result and event are inconsistent');
    if (
      eventValue.type === 'attack.hit' ||
      eventValue.type === 'attack.missed' ||
      eventValue.type === 'reaction.triggered'
    )
      continue;
    if (eventValue.type !== 'hero.moved')
      fail(`${path}.events`, 'move result and event are inconsistent');
    if (eventValue.to.x !== knownPosition.x || eventValue.to.y !== knownPosition.y)
      fail(`${path}.events.0.to`, 'move destination does not match the retained position chain');
    const offset = directionOffsets[recordValue.command.direction];
    if (
      eventValue.to.x !== eventValue.from.x + offset.x ||
      eventValue.to.y !== eventValue.from.y + offset.y
    )
      fail(`${path}.events.0.to`, 'move does not match its command direction');
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

// `activeRunSchema` cannot be bound structurally to `ActiveRun` as a whole: its
// `recentCommands` carry the broader `event` storage union (see the note in
// events.ts), which is why `validateSemantics` casts its return value. Every
// component shape is instead bound in its own domain module — `actor` in
// actor.ts, `item`/`feature` in item.ts, `floor` in floor.ts, and
// `hero`/`population`/`survival`/`identification` in population.ts — so a field
// added to any of those interfaces without its schema still fails `tsc`.
