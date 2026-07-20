import type {
  BalanceContentEntry,
  CompiledContentPack,
  EncounterContentEntry,
  MonsterContentEntry,
  VaultContentEntry,
  VaultPlacementSlot,
} from '@woven-deep/content';
import { emptyEquipment, type ActorState } from './actor-model.js';
import { analyzeConnectivity, preservesRequiredRoutes } from './connectivity.js';
import type { DungeonFeature } from './feature-model.js';
import { createFloorItem, createFloorLootFromTable } from './inventory.js';
import type { ItemInstance } from './item-model.js';
import { materializeMerchant } from './merchant-stock.js';
import {
  tileIndex,
  type ActiveRun,
  type DomainEvent,
  type FloorSnapshot,
  type OpaqueId,
  type Point,
  type Uint32State,
} from './model.js';
import {
  emptyActorBehaviorState,
  type EncounterRunDecision,
  type PopulationInstance,
} from './population-model.js';
import { nextUint32, rollDie } from './random.js';
import { tileDefinition } from './terrain.js';
import { transformVault } from './vault-transform.js';

export type PopulationPlacementFailureReason =
  'no-eligible-encounter' | 'no-valid-placement' | 'required-route-blocked';

interface PlacementBase {
  readonly encounterId: OpaqueId | null;
  readonly reason?: PopulationPlacementFailureReason;
  readonly nextEncounterState: Uint32State;
  readonly encounterDecisions: readonly EncounterRunDecision[];
  readonly diagnostics: readonly Readonly<{
    type: 'population.placement-skipped';
    encounterId: OpaqueId;
    reason: PopulationPlacementFailureReason;
  }>[];
}

export interface PopulationPlaced extends PlacementBase {
  readonly status: 'placed';
  readonly encounterId: OpaqueId;
  readonly floor: FloorSnapshot;
  readonly createdActors: readonly ActorState[];
  readonly population: PopulationInstance;
  readonly createdItems: readonly ItemInstance[];
  readonly createdFeatures: readonly DungeonFeature[];
  readonly nextMerchantStockState: Uint32State | null;
}

export interface PopulationSkipped extends PlacementBase {
  readonly status: 'skipped';
  readonly reason: PopulationPlacementFailureReason;
}

export interface PopulationRejected extends PlacementBase {
  readonly status: 'rejected';
  readonly encounterId: OpaqueId;
  readonly reason: PopulationPlacementFailureReason;
}

export type PopulationPlacementResult = PopulationPlaced | PopulationSkipped | PopulationRejected;

export interface PlacePopulationInput {
  readonly run: ActiveRun;
  readonly floor: FloorSnapshot;
  readonly content: CompiledContentPack;
  readonly environmentTags?: readonly string[];
  /** Test/demo-only override. Production callers leave encounter selection weighted. */
  readonly forcedEncounterId?: OpaqueId;
}

interface MemberPlan {
  readonly monsterId: OpaqueId;
  readonly roleId: string | null;
}

const MAX_RANDOM_WEIGHT_TOTAL = 0x1_0000_0000;
const MAX_ENCOUNTER_MEMBERS = 1024;
const MAX_SWARM_SPAWN_QUANTITY = 256;
const MAX_SWARM_LIVING_CHILDREN = 1023;
const MAX_SWARM_LIVING_MEMBERS = 1024;
const MAX_SWARM_FLOOR_ACTORS = 1024;

function checkedTotalWithin(values: readonly number[], maximum: number): boolean {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum - total) return false;
    total += value;
  }
  return true;
}

function compareId(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function chebyshev(left: Point, right: Point): number {
  return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));
}

function contentMaps(content: CompiledContentPack): Readonly<{
  encounters: readonly EncounterContentEntry[];
  monsters: ReadonlyMap<string, MonsterContentEntry>;
  balance: BalanceContentEntry;
}> {
  const encounters = content.entries
    .filter((entry): entry is EncounterContentEntry => entry.kind === 'encounter')
    .sort((left, right) => compareId(left.id, right.id));
  const monsters = new Map(
    content.entries
      .filter((entry): entry is MonsterContentEntry => entry.kind === 'monster')
      .map((entry) => [entry.id, entry]),
  );
  const balances = content.entries.filter(
    (entry): entry is BalanceContentEntry => entry.kind === 'balance',
  );
  if (balances.length !== 1)
    throw new Error(
      `population placement requires one balance definition; found ${balances.length}`,
    );
  return { encounters, monsters, balance: balances[0]! };
}

function preflightEncounters(encounters: readonly EncounterContentEntry[]): void {
  if (
    !checkedTotalWithin(
      encounters.map((entry) => entry.weight),
      MAX_RANDOM_WEIGHT_TOTAL,
    )
  ) {
    throw new RangeError(
      'population preflight: encounter weight total exceeds rollDie maximum 2^32',
    );
  }
  for (const encounter of encounters) {
    if (
      encounter.model === 'individual' &&
      encounter.definition.maximumQuantity > MAX_ENCOUNTER_MEMBERS
    ) {
      throw new RangeError(
        `population preflight: individual quantity exceeds runtime-safe limit ${MAX_ENCOUNTER_MEMBERS}`,
      );
    }
    if (
      encounter.model === 'group' &&
      !checkedTotalWithin(
        encounter.definition.roles.map((role) => role.maximumQuantity),
        MAX_ENCOUNTER_MEMBERS,
      )
    ) {
      throw new RangeError(
        `population preflight: group quantity exceeds runtime-safe limit ${MAX_ENCOUNTER_MEMBERS}`,
      );
    }
    if (encounter.model === 'swarm') {
      const definition = encounter.definition;
      if (
        !checkedTotalWithin(
          definition.spawnRoles.map((role) => role.weight),
          MAX_RANDOM_WEIGHT_TOTAL,
        )
      ) {
        throw new RangeError(
          'population preflight: swarm spawn-role weight total exceeds rollDie maximum 2^32',
        );
      }
      if (
        definition.maximumSpawnQuantity > MAX_SWARM_SPAWN_QUANTITY ||
        definition.maximumLivingChildren > MAX_SWARM_LIVING_CHILDREN ||
        definition.maximumLivingMembers > MAX_SWARM_LIVING_MEMBERS ||
        definition.maximumFloorActors > MAX_SWARM_FLOOR_ACTORS
      ) {
        throw new RangeError('population preflight: swarm quantities exceed runtime-safe limits');
      }
    }
  }
}

function availableVaultTags(
  floor: FloorSnapshot,
  content: CompiledContentPack,
): ReadonlySet<string> {
  const tags = new Set(floor.placementSlots.flatMap((slot) => slot.tags));
  const vaultIds = new Set(floor.vaults.map((vault) => vault.vaultId));
  for (const entry of content.entries) {
    if (entry.kind === 'vault' && vaultIds.has(entry.id))
      entry.tags.forEach((tag) => tags.add(tag));
  }
  return tags;
}

function candidates(
  input: PlacePopulationInput,
  encounters: readonly EncounterContentEntry[],
): readonly EncounterContentEntry[] {
  const decisions = new Map(
    input.run.encounterDecisions.map((decision) => [decision.encounterId, decision]),
  );
  const vaultTags = availableVaultTags(input.floor, input.content);
  const environmentTags = new Set(input.environmentTags ?? []);
  return encounters.filter((encounter) => {
    const decision = decisions.get(encounter.id);
    const requiredTags =
      encounter.model === 'boss'
        ? [...encounter.requiredVaultTags, ...encounter.definition.vaultTags]
        : encounter.requiredVaultTags;
    return (
      decision?.eligible === true &&
      decision.instancesCreated < encounter.maximumInstancesPerRun &&
      input.floor.depth >= encounter.minDepth &&
      input.floor.depth <= encounter.maxDepth &&
      encounter.environmentTags.every((tag) => environmentTags.has(tag)) &&
      requiredTags.every((tag) => vaultTags.has(tag))
    );
  });
}

function chooseEncounter(
  input: PlacePopulationInput,
  eligible: readonly EncounterContentEntry[],
): Readonly<{ encounter: EncounterContentEntry; state: Uint32State }> | null {
  if (eligible.length === 0) return null;
  if (input.forcedEncounterId !== undefined) {
    const forced = eligible.find((entry) => entry.id === input.forcedEncounterId);
    if (!forced) return null;
    return { encounter: forced, state: input.run.rng.encounters };
  }
  const total = eligible.reduce((sum, entry) => sum + entry.weight, 0);
  const step = rollDie(input.run.rng.encounters, total);
  let cursor = step.value;
  for (const encounter of eligible) {
    cursor -= encounter.weight;
    if (cursor <= 0) return { encounter, state: step.state };
  }
  throw new Error('internal invariant: weighted encounter selection did not resolve');
}

function composition(
  encounter: EncounterContentEntry,
  initialState: Uint32State,
): Readonly<{ members: readonly MemberPlan[]; leaderIndex: number | null; state: Uint32State }> {
  let state = initialState;
  if (encounter.model === 'individual') {
    const range = encounter.definition.maximumQuantity - encounter.definition.minimumQuantity + 1;
    const step = rollDie(state, range);
    state = step.state;
    return {
      members: Array.from(
        { length: encounter.definition.minimumQuantity + step.value - 1 },
        () => ({
          monsterId: encounter.definition.monsterId,
          roleId: null,
        }),
      ),
      leaderIndex: null,
      state,
    };
  }
  if (encounter.model === 'group') {
    const members: MemberPlan[] = [];
    for (const role of encounter.definition.roles) {
      const range = role.maximumQuantity - role.minimumQuantity + 1;
      const step = rollDie(state, range);
      state = step.state;
      const quantity = role.minimumQuantity + step.value - 1;
      for (let index = 0; index < quantity; index += 1) {
        members.push({ monsterId: role.monsterId, roleId: role.roleId });
      }
    }
    const leaderRoll = nextUint32(state);
    state = leaderRoll.state;
    const leaderIndex =
      leaderRoll.value / 0x1_0000_0000 < encounter.definition.leaderChance
        ? members.findIndex((member) => member.roleId === encounter.definition.leaderRoleId)
        : -1;
    return { members, leaderIndex: leaderIndex < 0 ? null : leaderIndex, state };
  }
  if (encounter.model === 'merchant') {
    // Merchants occupy one cell and roll nothing here; every merchant roll
    // comes from the dedicated merchant-stock stream during materialization.
    return {
      members: [{ monsterId: encounter.definition.npcId, roleId: null }],
      leaderIndex: null,
      state,
    };
  }
  const monsterId =
    encounter.model === 'swarm'
      ? encounter.definition.sourceMonsterId
      : encounter.definition.monsterId;
  return { members: [{ monsterId, roleId: null }], leaderIndex: null, state };
}

function nextPopulationId(input: PlacePopulationInput, memberCount: number): OpaqueId {
  const usedPopulations = new Set(
    input.run.populations.map((population) => population.populationId),
  );
  const usedEntities = new Set([
    ...input.run.actors.map((actor) => actor.actorId),
    ...input.run.floors.flatMap((floor) => floor.entities.map((entity) => entity.entityId)),
    ...input.floor.entities.map((entity) => entity.entityId),
  ]);
  for (let sequence = 1; sequence <= Number.MAX_SAFE_INTEGER; sequence += 1) {
    const id = `population.${String(sequence).padStart(6, '0')}`;
    const actorIdPrefix = `actor.${id}.`;
    const actorIdsAvailable = Array.from(
      { length: memberCount },
      (_, index) => `${actorIdPrefix}${String(index + 1).padStart(3, '0')}`,
    ).every((actorId) => !usedEntities.has(actorId));
    if (!usedPopulations.has(id) && actorIdsAvailable) return id;
  }
  throw new Error('internal invariant: population identifier space exhausted');
}

function reservedCellIndexes(
  input: PlacePopulationInput,
  includePlacementSlots = true,
): Set<number> {
  const { floor, run } = input;
  const index = (point: Point) => point.y * floor.width + point.x;
  const reserved = new Set(floor.entities.map(index));
  for (const actor of run.actors)
    if (actor.floorId === floor.floorId && actor.health > 0) reserved.add(index(actor));
  for (const feature of run.features)
    if (feature.floorId === floor.floorId) reserved.add(index(feature));
  for (const item of run.items) {
    if (item.location.type === 'floor' && item.location.floorId === floor.floorId)
      reserved.add(index(item.location));
  }
  for (const light of floor.lights)
    if (light.location.type === 'fixed') reserved.add(index(light.location));
  if (floor.stairUp) reserved.add(index(floor.stairUp));
  if (floor.stairDown) reserved.add(index(floor.stairDown));
  if (includePlacementSlots) floor.placementSlots.forEach((slot) => reserved.add(index(slot)));
  return reserved;
}

function satisfiesPlacementDistances(
  floor: FloorSnapshot,
  encounter: EncounterContentEntry,
  cell: Point,
): boolean {
  const stairs = [floor.stairUp, floor.stairDown].filter((point): point is Point => point !== null);
  const objectives = floor.placementSlots.filter((slot) => slot.kind === 'objective');
  return (
    stairs.every((stair) => chebyshev(cell, stair) >= encounter.placement.minimumStairDistance) &&
    objectives.every(
      (objective) => chebyshev(cell, objective) >= encounter.placement.minimumObjectiveDistance,
    )
  );
}

function legalCells(
  input: PlacePopulationInput,
  encounter: EncounterContentEntry,
): readonly Point[] {
  const { floor } = input;
  const reserved = reservedCellIndexes(input);
  const cells: Point[] = [];
  for (let y = 0; y < floor.height; y += 1) {
    for (let x = 0; x < floor.width; x += 1) {
      const cell = { x, y };
      const index = y * floor.width + x;
      const terrain = tileDefinition(floor.tiles[index]!);
      if (
        reserved.has(index) ||
        !terrain.walkable ||
        !encounter.placement.allowedTerrainTags.includes(terrain.name) ||
        !satisfiesPlacementDistances(floor, encounter, cell)
      )
        continue;
      cells.push(cell);
    }
  }
  return cells;
}

function requiredPoints(floor: FloorSnapshot): readonly Point[] {
  return [
    floor.stairUp,
    floor.stairDown,
    ...floor.placementSlots.filter((slot) => slot.kind === 'objective'),
  ].filter((point): point is Point => point !== null);
}

function protectedRouteIndexes(floor: FloorSnapshot): ReadonlySet<number> {
  const points = requiredPoints(floor);
  const protectedIndexes = new Set<number>();
  const start = points[0];
  if (!start) return protectedIndexes;
  for (const target of points.slice(1)) {
    const route = analyzeConnectivity({
      width: floor.width,
      height: floor.height,
      tiles: floor.tiles,
      start,
      target,
    }).route;
    for (const point of route) protectedIndexes.add(point.y * floor.width + point.x);
  }
  return protectedIndexes;
}

function requiredAnchorTags(encounter: EncounterContentEntry): readonly string[] {
  return encounter.model === 'boss'
    ? [...encounter.requiredVaultTags, ...encounter.definition.vaultTags]
    : encounter.requiredVaultTags;
}

function slotProvidesTags(
  input: PlacePopulationInput,
  slot: FloorSnapshot['placementSlots'][number],
  tags: readonly string[],
): boolean {
  const placement = input.floor.vaults.find((vault) => vault.placementId === slot.vaultPlacementId);
  const vault =
    placement === undefined
      ? undefined
      : input.content.entries.find(
          (entry) => entry.kind === 'vault' && entry.id === placement.vaultId,
        );
  const available = new Set([...slot.tags, ...(vault?.tags ?? [])]);
  return tags.every((tag) => available.has(tag));
}

/**
 * Resolves a `kind:'item'` `FloorPlacementSlot` back to the authored `VaultPlacementSlot` on its
 * originating vault's legend, so `fillItemSlots` can read the `lootTableId`/`contentId` the
 * runtime slot itself does not carry. Re-runs the same rotation/reflection transform
 * `vault-placement.ts` used to derive the slot's floor position, then matches by that position --
 * robust to callers (tests, notably) that append their own uniqueness suffixes onto `slotId`.
 */
function originatingVaultSlot(
  input: PlacePopulationInput,
  slot: FloorSnapshot['placementSlots'][number],
): VaultPlacementSlot {
  const placement = input.floor.vaults.find((vault) => vault.placementId === slot.vaultPlacementId);
  const vault =
    placement === undefined
      ? undefined
      : input.content.entries.find(
          (entry): entry is VaultContentEntry =>
            entry.kind === 'vault' && entry.id === placement.vaultId,
        );
  if (placement === undefined || vault === undefined) {
    throw new Error(`internal invariant: item slot ${slot.slotId} has no originating vault`);
  }
  const transformed = transformVault(vault, placement.rotation, placement.reflected);
  const localX = slot.x - placement.x;
  const localY = slot.y - placement.y;
  const match = transformed.slots.find(
    (candidate) => candidate.x === localX && candidate.y === localY,
  );
  if (match === undefined) {
    throw new Error(
      `internal invariant: vault ${vault.id} has no legend slot at local position (${localX}, ${localY})`,
    );
  }
  return match.slot;
}

function floorLocation(
  item: ItemInstance,
): Extract<ItemInstance['location'], { type: 'floor' }> | null {
  return item.location.type === 'floor' ? item.location : null;
}

function unfilledItemSlots(
  input: PlacePopulationInput,
): readonly FloorSnapshot['placementSlots'][number][] {
  const filledPositions = new Set(
    input.run.items
      .map(floorLocation)
      .filter(
        (location): location is Extract<ItemInstance['location'], { type: 'floor' }> =>
          location !== null && location.floorId === input.floor.floorId,
      )
      .map((location) => `${location.x},${location.y}`),
  );
  return input.floor.placementSlots.filter(
    (slot) => slot.kind === 'item' && !filledPositions.has(`${slot.x},${slot.y}`),
  );
}

/**
 * Fills every not-yet-filled `kind:'item'` vault slot on the floor with the item or loot-table
 * roll its originating `VaultPlacementSlot` names, threading the same `encounters` RNG stream the
 * rest of this file's floor-generation-time placement uses (never `run.rng.loot`, reserved for
 * runtime combat drops). Checking already-filled positions against `run.items` makes repeated
 * calls across `placeFloorPopulations`' multiple attempts on one floor idempotent.
 */
function fillItemSlots(
  input: PlacePopulationInput,
  state: Uint32State,
): Readonly<{ items: readonly ItemInstance[]; state: Uint32State }> {
  let currentState = state;
  const items: ItemInstance[] = [];
  for (const slot of unfilledItemSlots(input)) {
    const vaultSlot = originatingVaultSlot(input, slot);
    const itemId = `item.vault.${slot.slotId}`;
    if (vaultSlot.lootTableId !== null) {
      const loot = createFloorLootFromTable({
        content: input.content,
        tableId: vaultSlot.lootTableId,
        state: currentState,
        itemIdPrefix: itemId,
        floorId: input.floor.floorId,
        x: slot.x,
        y: slot.y,
      });
      items.push(...loot.items);
      currentState = loot.state;
    } else if (vaultSlot.contentId !== null) {
      items.push(
        createFloorItem({
          content: input.content,
          contentId: vaultSlot.contentId,
          itemId,
          floorId: input.floor.floorId,
          x: slot.x,
          y: slot.y,
        }),
      );
    } else {
      throw new Error(
        `internal invariant: item slot ${slot.slotId} has neither lootTableId nor contentId`,
      );
    }
  }
  return { items, state: currentState };
}

function unfilledFeatureSlots(
  input: PlacePopulationInput,
): readonly (FloorSnapshot['placementSlots'][number] & { kind: 'door' | 'chest' })[] {
  const filledPositions = new Set(
    input.run.features
      .filter((feature) => feature.floorId === input.floor.floorId)
      .map((feature) => `${feature.x},${feature.y}`),
  );
  return input.floor.placementSlots.filter(
    (slot): slot is FloorSnapshot['placementSlots'][number] & { kind: 'door' | 'chest' } =>
      (slot.kind === 'door' || slot.kind === 'chest') &&
      !filledPositions.has(`${slot.x},${slot.y}`),
  );
}

/**
 * Fills every not-yet-filled `kind:'door'|'chest'` vault slot on the floor with a locked
 * `DoorFeature`/`ChestFeature` built from its originating `VaultPlacementSlot`'s authored
 * `difficulty`/`keyContentId`/loot pointer, via the same `originatingVaultSlot` resolution
 * `fillItemSlots` uses. Chests never materialize their loot at spawn -- the authored
 * `lootTableId`/`contentId` is only stored on the feature and rolled on a successful open.
 * Placement is purely deterministic (position and identity come from the slot itself), so unlike
 * `fillItemSlots` no RNG stream is threaded. Checking already-filled positions against
 * `run.features` makes repeated calls across `placeFloorPopulations`' multiple attempts on one
 * floor idempotent.
 */
function fillFeatureSlots(input: PlacePopulationInput): readonly DungeonFeature[] {
  const features: DungeonFeature[] = [];
  for (const slot of unfilledFeatureSlots(input)) {
    const vaultSlot = originatingVaultSlot(input, slot);
    if (vaultSlot.difficulty === undefined) {
      throw new Error(
        `internal invariant: ${slot.kind} slot ${slot.slotId} has no authored difficulty`,
      );
    }
    const index = tileIndex(input.floor, slot.x, slot.y);
    if (index === undefined) {
      throw new Error(`internal invariant: feature slot ${slot.slotId} is outside its floor`);
    }
    const base = {
      featureId: `feature.vault.${slot.slotId}`,
      floorId: input.floor.floorId,
      x: slot.x,
      y: slot.y,
      contentId: null,
      coverTileId: input.floor.tiles[index]!,
    };
    switch (slot.kind) {
      case 'door': {
        features.push({
          ...base,
          type: 'door',
          state: 'locked',
          lock: { difficulty: vaultSlot.difficulty, keyContentId: vaultSlot.keyContentId ?? null },
        });
        break;
      }
      case 'chest': {
        const lootTableId = vaultSlot.lootTableId;
        const lootContentId = vaultSlot.contentId;
        if (Number(lootTableId !== null) + Number(lootContentId !== null) !== 1) {
          throw new Error(
            `internal invariant: chest slot ${slot.slotId} must set exactly one of lootTableId/contentId`,
          );
        }
        features.push({
          ...base,
          type: 'chest',
          state: 'locked',
          lock: { difficulty: vaultSlot.difficulty, keyContentId: null },
          lootTableId,
          lootContentId,
        });
        break;
      }
    }
  }
  return features;
}

function selectCells(
  input: PlacePopulationInput,
  encounter: EncounterContentEntry,
  quantity: number,
): Readonly<{ cells: readonly Point[]; routeFailure: boolean }> {
  const rawCells = legalCells(input, encounter);
  const protectedIndexes = protectedRouteIndexes(input.floor);
  const all = rawCells.filter(
    (point) => !protectedIndexes.has(point.y * input.floor.width + point.x),
  );
  const hardReserved = reservedCellIndexes(input, false);
  const anchorTags = requiredAnchorTags(encounter);
  const vaultAnchors = encounter.placement.requiresVaultSlot
    ? input.floor.placementSlots.filter(
        (slot) => slot.kind === 'monster' && slotProvidesTags(input, slot, anchorTags),
      )
    : null;
  const anchors =
    vaultAnchors === null
      ? all
      : vaultAnchors
          .filter((slot) => {
            const index = slot.y * input.floor.width + slot.x;
            const terrain = tileDefinition(input.floor.tiles[index]!);
            return (
              !hardReserved.has(index) &&
              terrain.walkable &&
              encounter.placement.allowedTerrainTags.includes(terrain.name) &&
              satisfiesPlacementDistances(input.floor, encounter, slot)
            );
          })
          .map(({ x, y }) => ({ x, y }));
  let routeFailure = rawCells.length > all.length;
  const requiredOrdinaryCells = quantity - (vaultAnchors === null ? 0 : 1);
  if (
    requiredOrdinaryCells < 0 ||
    requiredOrdinaryCells > all.length ||
    (vaultAnchors !== null && anchors.length === 0)
  ) {
    return { cells: [], routeFailure };
  }

  const stride = input.floor.width + 1;
  const prefix = new Int32Array(stride * (input.floor.height + 1));
  const candidateIndexes = new Set(all.map((point) => point.y * input.floor.width + point.x));
  for (let y = 1; y <= input.floor.height; y += 1) {
    let rowCount = 0;
    for (let x = 1; x <= input.floor.width; x += 1) {
      if (candidateIndexes.has((y - 1) * input.floor.width + x - 1)) rowCount += 1;
      prefix[y * stride + x] = prefix[(y - 1) * stride + x]! + rowCount;
    }
  }
  const rectangleCount = (left: number, top: number, right: number, bottom: number): number =>
    prefix[(bottom + 1) * stride + right + 1]! -
    prefix[top * stride + right + 1]! -
    prefix[(bottom + 1) * stride + left]! +
    prefix[top * stride + left]!;
  const inRectangle = (
    point: Point,
    left: number,
    top: number,
    right: number,
    bottom: number,
  ): boolean => point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
  const maximumDistance = encounter.placement.maximumMemberDistance;
  for (let top = 0; top < input.floor.height; top += 1) {
    const bottom = Math.min(input.floor.height - 1, top + maximumDistance);
    for (let left = 0; left < input.floor.width; left += 1) {
      const right = Math.min(input.floor.width - 1, left + maximumDistance);
      if (rectangleCount(left, top, right, bottom) < requiredOrdinaryCells) continue;
      const anchor =
        vaultAnchors === null
          ? null
          : anchors.find((point) => inRectangle(point, left, top, right, bottom));
      if (vaultAnchors !== null && anchor === undefined) continue;
      const ordinary = all
        .filter((point) => inRectangle(point, left, top, right, bottom))
        .slice(0, requiredOrdinaryCells);
      const selected = anchor ? [anchor, ...ordinary] : ordinary;
      if (selected.length !== quantity) continue;
      const routeOk = preservesRequiredRoutes({
        width: input.floor.width,
        height: input.floor.height,
        tiles: input.floor.tiles,
        requiredPoints: requiredPoints(input.floor),
        blockedPoints: selected,
      });
      if (routeOk) return { cells: selected, routeFailure };
      routeFailure = true;
    }
  }
  return { cells: [], routeFailure };
}

function placementFailure(
  encounter: EncounterContentEntry,
  reason: PopulationPlacementFailureReason,
  state: Uint32State,
  encounterDecisions: readonly EncounterRunDecision[],
): PopulationSkipped | PopulationRejected {
  const common = {
    encounterId: encounter.id,
    reason,
    nextEncounterState: state,
    encounterDecisions,
    diagnostics: [
      { type: 'population.placement-skipped' as const, encounterId: encounter.id, reason },
    ],
  };
  return encounter.placement.failureMode === 'required'
    ? { status: 'rejected', ...common }
    : { status: 'skipped', ...common };
}

export function placePopulation(input: PlacePopulationInput): PopulationPlacementResult {
  const maps = contentMaps(input.content);
  preflightEncounters(maps.encounters);
  const reachedDecisions = input.run.encounterDecisions.map((decision) => {
    const encounter = maps.encounters.find((entry) => entry.id === decision.encounterId);
    return encounter &&
      input.floor.depth >= encounter.minDepth &&
      input.floor.depth <= encounter.maxDepth
      ? { ...decision, reachedEligibleDepth: true }
      : decision;
  });
  const selected = chooseEncounter(
    input,
    candidates(
      { ...input, run: { ...input.run, encounterDecisions: reachedDecisions } },
      maps.encounters,
    ),
  );
  if (!selected) {
    return {
      status: 'skipped',
      encounterId: null,
      reason: 'no-eligible-encounter',
      nextEncounterState: input.run.rng.encounters,
      encounterDecisions: reachedDecisions,
      diagnostics: [],
    };
  }
  const planned = composition(selected.encounter, selected.state);
  const positions = selectCells(input, selected.encounter, planned.members.length);
  if (positions.cells.length !== planned.members.length) {
    return placementFailure(
      selected.encounter,
      positions.routeFailure ? 'required-route-blocked' : 'no-valid-placement',
      planned.state,
      reachedDecisions,
    );
  }

  const populationId = nextPopulationId(input, planned.members.length);
  if (selected.encounter.model === 'merchant') {
    // Materialize only after a legal cell exists so skipped or rejected
    // placement never advances the merchant-stock stream or creates items.
    const runWithFloor = input.run.floors.some((floor) => floor.floorId === input.floor.floorId)
      ? input.run
      : { ...input.run, floors: [...input.run.floors, input.floor] };
    const merchant = materializeMerchant({
      run: runWithFloor,
      content: input.content,
      encounter: selected.encounter,
      populationId,
      floorId: input.floor.floorId,
      position: positions.cells[0]!,
    });
    const itemSlots = fillItemSlots(input, planned.state);
    return {
      status: 'placed',
      encounterId: selected.encounter.id,
      nextEncounterState: itemSlots.state,
      encounterDecisions: reachedDecisions.map((decision) =>
        decision.encounterId === selected.encounter.id
          ? { ...decision, instancesCreated: decision.instancesCreated + 1 }
          : decision,
      ),
      diagnostics: [],
      createdActors: [merchant.actor],
      population: merchant.population,
      floor: input.floor,
      createdItems: [...merchant.items, ...itemSlots.items],
      createdFeatures: fillFeatureSlots(input),
      nextMerchantStockState: merchant.nextMerchantStockState,
    };
  }
  const createdActors = planned.members.map((member, index): ActorState => {
    const definition = maps.monsters.get(member.monsterId);
    if (!definition)
      throw new Error(`population placement monster ${member.monsterId} does not exist`);
    const leader = planned.leaderIndex === index;
    return {
      actorId: `actor.${populationId}.${String(index + 1).padStart(3, '0')}`,
      contentId: definition.id,
      playerControlled: false,
      floorId: input.floor.floorId,
      ...positions.cells[index]!,
      attributes: definition.attributes,
      health: definition.health,
      maxHealth: definition.health,
      energy: maps.balance.readinessThreshold,
      speed: definition.speed,
      reactionReady: true,
      disposition: definition.disposition,
      awareActorIds: [],
      conditions: [],
      equipment: emptyEquipment(),
      behaviorId: definition.behaviorId,
      behaviorState: emptyActorBehaviorState(),
      populationId,
      populationRoleId: member.roleId,
      populationPresentation: {
        name: definition.name,
        glyph:
          leader && selected.encounter.model === 'group'
            ? (selected.encounter.definition.leaderAlternateGlyph ?? definition.glyph)
            : definition.glyph,
        color:
          leader && selected.encounter.model === 'group'
            ? selected.encounter.definition.leaderAccentColor
            : definition.color,
        leader,
      },
    };
  });
  const memberIds = createdActors.map((actor) => actor.actorId).sort(compareId);
  const base = {
    populationId,
    encounterId: selected.encounter.id,
    floorId: input.floor.floorId,
    createdAt: input.run.worldTime,
    livingMemberIds: memberIds,
    formerMemberIds: [],
  };
  let population: PopulationInstance;
  if (selected.encounter.model === 'individual') {
    population = { ...base, model: 'individual' };
  } else if (selected.encounter.model === 'group') {
    const leaderActorId =
      planned.leaderIndex === null ? null : createdActors[planned.leaderIndex]!.actorId;
    population = {
      ...base,
      model: 'group',
      leaderActorId,
      bonusActive: leaderActorId !== null,
      roleMembership: createdActors.map((actor) => ({
        actorId: actor.actorId,
        roleId: actor.populationRoleId!,
      })),
      sharedKnowledge: [],
      leaderResponseApplied: false,
      leaderResponseExpiresAt: null,
    };
  } else if (selected.encounter.model === 'swarm') {
    const nextSpawnAt = input.run.worldTime + selected.encounter.definition.spawnInterval;
    if (!Number.isSafeInteger(nextSpawnAt))
      return placementFailure(
        selected.encounter,
        'no-valid-placement',
        planned.state,
        reachedDecisions,
      );
    population = {
      ...base,
      model: 'swarm',
      sourceActorId: createdActors[0]!.actorId,
      nextSpawnAt,
      spawnedCount: 0,
      peakLivingSize: 1,
      shutdownState: null,
      emittedCapLevels: [],
      shutdownExpiresAt: null,
    };
  } else {
    population = {
      ...base,
      model: 'boss',
      actorId: createdActors[0]!.actorId,
      currentPhaseId: null,
      crossedPhaseIds: [],
      lastFloorExitAt: null,
      rewardCreated: false,
      rewardReceipt: null,
      recoveryHistory: [],
    };
  }
  const encounterDecisions = reachedDecisions.map((decision) =>
    decision.encounterId === selected.encounter.id
      ? { ...decision, instancesCreated: decision.instancesCreated + 1 }
      : decision,
  );
  const itemSlots = fillItemSlots(input, planned.state);
  return {
    status: 'placed',
    encounterId: selected.encounter.id,
    nextEncounterState: itemSlots.state,
    encounterDecisions,
    diagnostics: [],
    createdActors,
    population,
    floor: input.floor,
    createdItems: itemSlots.items,
    createdFeatures: fillFeatureSlots(input),
    nextMerchantStockState: null,
  };
}

const MINIMUM_FLOOR_POPULATION_ATTEMPTS = 1;
const MAXIMUM_FLOOR_POPULATION_ATTEMPTS = 8;

/**
 * How many `placePopulation` attempts a floor gets, from its cell count and the balance-defined
 * encounter density: `floor((width * height) / cellsPerEncounter)`, clamped to [1, 8]. Checked
 * integer division (floor of a non-negative integer quotient) -- never a float approximation.
 */
function floorPopulationAttempts(
  floor: Pick<FloorSnapshot, 'width' | 'height'>,
  cellsPerEncounter: number,
): number {
  if (!Number.isSafeInteger(cellsPerEncounter) || cellsPerEncounter <= 0) {
    throw new RangeError(
      'balance encounterDensity.cellsPerEncounter must be a positive safe integer',
    );
  }
  const cellCount = floor.width * floor.height;
  if (!Number.isSafeInteger(cellCount))
    throw new RangeError('floor cell count overflow computing population attempts');
  const raw = Math.floor(cellCount / cellsPerEncounter);
  return Math.min(
    MAXIMUM_FLOOR_POPULATION_ATTEMPTS,
    Math.max(MINIMUM_FLOOR_POPULATION_ATTEMPTS, raw),
  );
}

function sortByActorId(items: readonly ActorState[]): ActorState[] {
  return [...items].sort((left, right) => compareId(left.actorId, right.actorId));
}

function sortByItemId(items: readonly ItemInstance[]): ItemInstance[] {
  return [...items].sort((left, right) => compareId(left.itemId, right.itemId));
}

function sortByPopulationId(items: readonly PopulationInstance[]): PopulationInstance[] {
  return [...items].sort((left, right) => compareId(left.populationId, right.populationId));
}

function sortByFeatureId(features: readonly DungeonFeature[]): DungeonFeature[] {
  return [...features].sort((left, right) => compareId(left.featureId, right.featureId));
}

export interface FloorPopulationsResult {
  readonly state: ActiveRun;
  readonly placements: readonly PopulationPlacementResult[];
  readonly events: readonly DomainEvent[];
}

/**
 * Fills a generated floor with encounters up to its density budget: repeatedly calls
 * `placePopulation`, threading the RNG streams and encounter decisions from each attempt into the
 * next so every attempt sees the cells and populations the previous ones committed (distinct
 * populationIds, no double-booked cells). A `rejected` result (a required encounter with no legal
 * placement) stops the loop immediately -- the floor is full, and the caller decides whether that
 * means regenerating (as `generateFloor` does for its own guaranteed placements) or failing.
 */
export function placeFloorPopulations(input: PlacePopulationInput): FloorPopulationsResult {
  const maps = contentMaps(input.content);
  const attempts = floorPopulationAttempts(
    input.floor,
    maps.balance.encounterDensity.cellsPerEncounter,
  );
  const eventId = `event.${input.floor.floorId}.population`;
  let run = input.run;
  const placements: PopulationPlacementResult[] = [];
  const events: DomainEvent[] = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const placement = placePopulation({
      run,
      floor: input.floor,
      content: input.content,
      ...(input.environmentTags === undefined ? {} : { environmentTags: input.environmentTags }),
      ...(input.forcedEncounterId === undefined
        ? {}
        : { forcedEncounterId: input.forcedEncounterId }),
    });
    placements.push(placement);
    run = {
      ...run,
      rng: {
        ...run.rng,
        encounters: placement.nextEncounterState,
        ...(placement.status === 'placed' && placement.nextMerchantStockState !== null
          ? { 'merchant-stock': placement.nextMerchantStockState }
          : {}),
      },
      encounterDecisions: placement.encounterDecisions,
    };
    if (placement.status === 'placed') {
      run = {
        ...run,
        actors: sortByActorId([...run.actors, ...placement.createdActors]),
        items:
          placement.createdItems.length === 0
            ? run.items
            : sortByItemId([...run.items, ...placement.createdItems]),
        features:
          placement.createdFeatures.length === 0
            ? run.features
            : sortByFeatureId([...run.features, ...placement.createdFeatures]),
        populations: sortByPopulationId([...run.populations, placement.population]),
      };
      events.push({
        type: 'population.created',
        eventId,
        populationId: placement.population.populationId,
        encounterId: placement.population.encounterId,
        floorId: placement.population.floorId,
        model: placement.population.model,
        actorIds: placement.population.livingMemberIds,
      });
      if (placement.population.model === 'group' && placement.population.leaderActorId !== null) {
        const leaderActorId = placement.population.leaderActorId;
        const roleId = placement.population.roleMembership.find(
          (role) => role.actorId === leaderActorId,
        )?.roleId;
        if (roleId === undefined)
          throw new Error(`internal invariant: group leader ${leaderActorId} has no role`);
        events.push({
          type: 'group.leader-created',
          eventId,
          populationId: placement.population.populationId,
          actorId: leaderActorId,
          roleId,
        });
      }
    } else if (placement.status === 'skipped') {
      for (const diagnostic of placement.diagnostics)
        events.push({ ...diagnostic, eventId, floorId: input.floor.floorId });
    }
    if (placement.status === 'rejected') break;
  }
  return { state: run, placements, events };
}
