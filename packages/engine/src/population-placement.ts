import type {
  BalanceContentEntry,
  CompiledContentPack,
  EncounterContentEntry,
  ItemContentEntry,
  MonsterContentEntry,
  VaultContentEntry,
  VaultPlacementSlot,
} from '@woven-deep/content';
import { emptyEquipment, type ActorState } from './actor-model.js';
import { preservesRequiredRoutes, protectedRouteIndexes, requiredPoints } from './connectivity.js';
import type { DungeonFeature } from './feature-model.js';
import { heroHoldsFragment, tabletFragmentIds } from './final-chamber-fragments.js';
import { createFloorItem, createFloorLootFromTable } from './inventory.js';
import { placeFloorLoot } from './loot-placement.js';
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

/**
 * Item-id prefix of the run's single vault artifact offer. Also the one-per-run guard: a scan of
 * `run.items` for this prefix is what stops a second artifact-tagged slot, on this floor or any
 * later one, from minting a duplicate of a singleton relic.
 */
export const ARTIFACT_OFFER_ITEM_PREFIX = 'item.artifact-offer.';

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

/**
 * The eligibility predicate shared by `candidates()` (the weighted density loop) and the
 * guaranteed-boss pre-pass filter in `placeFloorPopulations`: decision eligible, run-instance cap
 * not yet reached, floor depth within band, and every required-vault tag present. `candidates()`
 * layers an environment-tags check on top; the pre-pass layers `model === 'boss'` plus a
 * non-empty-required-tags guard on top. Kept as one function so the two call sites cannot drift.
 */
function meetsBaseEligibility(
  encounter: EncounterContentEntry,
  decision: EncounterRunDecision | undefined,
  depth: number,
  requiredTags: readonly string[],
  vaultTags: ReadonlySet<string>,
): boolean {
  return (
    decision?.eligible === true &&
    decision.instancesCreated < encounter.maximumInstancesPerRun &&
    depth >= encounter.minDepth &&
    depth <= encounter.maxDepth &&
    requiredTags.every((tag) => vaultTags.has(tag))
  );
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
    const requiredTags = requiredAnchorTags(encounter);
    return (
      meetsBaseEligibility(encounter, decision, input.floor.depth, requiredTags, vaultTags) &&
      encounter.environmentTags.every((tag) => environmentTags.has(tag))
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
 * roll its originating `VaultPlacementSlot` names, drawing from the dedicated `loot-placement` RNG
 * stream rather than the `encounters` stream the rest of this file's placement decisions use, so
 * an encounter-placement change can never re-roll a floor's loot (never `run.rng.loot` either,
 * which is reserved for runtime combat drops). Runs once per floor at the `placeFloorPopulations`
 * tail beside `placeFragmentSpawn`/`placeFloorLoot` rather than inside `placePopulation`, so the
 * stream advances even on a floor where every encounter placement fails. The already-filled
 * position check against `run.items` keeps a repeat call a no-op that leaves the stream untouched.
 *
 * An `artifact`-tagged slot is the exception that names no loot source at all: it is the vault
 * offer, and what it holds was decided once at run creation (`run.offeredArtifact`). It is placed
 * without touching any stream, at most once per run, and silently left empty when this run carries
 * no offer -- a vault authored with the slot must still generate normally for every other run.
 */
function fillItemSlots(
  input: PlacePopulationInput,
  state: Uint32State,
): Readonly<{ items: readonly ItemInstance[]; state: Uint32State }> {
  let currentState: Uint32State | null = null;
  const items: ItemInstance[] = [];
  let offerPlaced = input.run.items.some((item) =>
    item.itemId.startsWith(ARTIFACT_OFFER_ITEM_PREFIX),
  );
  for (const slot of unfilledItemSlots(input)) {
    const vaultSlot = originatingVaultSlot(input, slot);
    const itemId = `item.vault.${slot.slotId}`;
    if (slot.tags.includes('artifact') || vaultSlot.tags.includes('artifact')) {
      if (input.run.offeredArtifact === null || offerPlaced) continue;
      items.push(
        createFloorItem({
          content: input.content,
          contentId: input.run.offeredArtifact,
          itemId: `${ARTIFACT_OFFER_ITEM_PREFIX}${slot.slotId}`,
          floorId: input.floor.floorId,
          x: slot.x,
          y: slot.y,
        }),
      );
      offerPlaced = true;
    } else if (vaultSlot.lootTableId !== null) {
      const loot = createFloorLootFromTable({
        content: input.content,
        tableId: vaultSlot.lootTableId,
        state: currentState ?? state,
        itemIdPrefix: itemId,
        floorId: input.floor.floorId,
        x: slot.x,
        y: slot.y,
        depth: input.floor.depth,
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
  return { items, state: currentState ?? state };
}

function fragmentItemEntry(content: CompiledContentPack, fragmentId: string): ItemContentEntry {
  const entry = content.entries.find(
    (candidate): candidate is ItemContentEntry =>
      candidate.kind === 'item' && candidate.id === fragmentId,
  );
  if (entry === undefined) {
    throw new Error(`internal invariant: fragment ${fragmentId} has no item content entry`);
  }
  return entry;
}

/**
 * Fragment ids the spawn roll may pick from this floor: within the fragment's own authored
 * minDepth/maxDepth band, not already held in the hero's backpack this run (the run-local
 * no-duplicate rule, via `heroHoldsFragment`), and not already lying on this floor.
 */
function eligibleFragmentSpawnIds(input: PlacePopulationInput): readonly OpaqueId[] {
  return tabletFragmentIds(input.content).filter((fragmentId) => {
    const entry = fragmentItemEntry(input.content, fragmentId);
    if (input.floor.depth < entry.minDepth || input.floor.depth > entry.maxDepth) return false;
    if (heroHoldsFragment(input.run, fragmentId)) return false;
    return !input.run.items.some(
      (item) =>
        item.location.type === 'floor' &&
        item.location.floorId === input.floor.floorId &&
        item.contentId === fragmentId,
    );
  });
}

/** Every walkable, unoccupied cell on the floor -- deliberately unrestricted by terrain tags or
 * anchor/objective distance (unlike encounter `legalCells`): a lying item never blocks movement or
 * routes, so the only requirement is that nothing else already occupies the cell. */
function openFloorCells(input: PlacePopulationInput): readonly Point[] {
  const { floor } = input;
  const reserved = reservedCellIndexes(input);
  const cells: Point[] = [];
  for (let y = 0; y < floor.height; y += 1) {
    for (let x = 0; x < floor.width; x += 1) {
      const index = y * floor.width + x;
      if (reserved.has(index)) continue;
      if (!tileDefinition(floor.tiles[index]!).walkable) continue;
      cells.push({ x, y });
    }
  }
  return cells;
}

/**
 * Rare, depth-banded Ancient Tablet fragment spawn: rolled once per floor generation from the
 * dedicated `loot-placement` stream this file's other loot draws use, keeping it isolated from the
 * `encounters` stream that drives encounter selection and cell choice (never `run.rng.loot`, which
 * is reserved for runtime combat drops). A miss, an empty eligible set (nothing left
 * in band, or the hero already carries every eligible fragment this run), or no open cell all
 * consume no more than the roll(s) already made and place nothing.
 */
function placeFragmentSpawn(
  input: PlacePopulationInput,
  state: Uint32State,
): Readonly<{ items: readonly ItemInstance[]; state: Uint32State }> {
  const eligible = eligibleFragmentSpawnIds(input);
  if (eligible.length === 0) return { items: [], state };
  // 1-in-N odds per floor generation, N from content/balance: a rare roll, so a full fragment set
  // in one run stays rare.
  const fragmentSpawnRollDenominator = contentMaps(input.content).balance
    .fragmentSpawnRollDenominator;
  const roll = rollDie(state, fragmentSpawnRollDenominator);
  if (roll.value !== 1) return { items: [], state: roll.state };
  const cells = openFloorCells(input);
  if (cells.length === 0) return { items: [], state: roll.state };
  const fragmentPick = rollDie(roll.state, eligible.length);
  const cellPick = rollDie(fragmentPick.state, cells.length);
  const fragmentId = eligible[fragmentPick.value - 1]!;
  const cell = cells[cellPick.value - 1]!;
  // Invariant: at most one fragment spawns per floor generation (the roll above either misses or
  // places exactly one), so `floorId` alone keeps this id unique. Extending to multiple spawns per
  // floor would require a per-spawn suffix to avoid id collisions.
  const item = createFloorItem({
    content: input.content,
    contentId: fragmentId,
    itemId: `item.fragment-spawn.${input.floor.floorId}`,
    floorId: input.floor.floorId,
    x: cell.x,
    y: cell.y,
  });
  return { items: [item], state: cellPick.state };
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
  state: Uint32State,
): Readonly<{ cells: readonly Point[]; routeFailure: boolean; state: Uint32State }> {
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
    return { cells: [], routeFailure, state };
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
  // Seed the rectangle scan's origin from the encounter stream instead of always starting at the
  // floor's top-left corner. Without this, the first viable window -- always the minimal-y one --
  // wins for every seed, clamping every depth population into a single top-edge pocket (#109). The
  // scan below wraps cyclically over rows and columns from (top0, left0), so an origin of (0, 0)
  // reproduces the original top-left-first order exactly; the draw is what spreads placements.
  const topRoll = rollDie(state, input.floor.height);
  const top0 = topRoll.value - 1;
  const leftRoll = rollDie(topRoll.state, input.floor.width);
  const left0 = leftRoll.value - 1;
  const nextState = leftRoll.state;
  for (let dy = 0; dy < input.floor.height; dy += 1) {
    const top = (top0 + dy) % input.floor.height;
    const bottom = Math.min(input.floor.height - 1, top + maximumDistance);
    for (let dx = 0; dx < input.floor.width; dx += 1) {
      const left = (left0 + dx) % input.floor.width;
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
      if (routeOk) return { cells: selected, routeFailure, state: nextState };
      routeFailure = true;
    }
  }
  return { cells: [], routeFailure, state: nextState };
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
  const positions = selectCells(input, selected.encounter, planned.members.length, planned.state);
  if (positions.cells.length !== planned.members.length) {
    return placementFailure(
      selected.encounter,
      positions.routeFailure ? 'required-route-blocked' : 'no-valid-placement',
      positions.state,
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
    return {
      status: 'placed',
      encounterId: selected.encounter.id,
      nextEncounterState: positions.state,
      encounterDecisions: reachedDecisions.map((decision) =>
        decision.encounterId === selected.encounter.id
          ? { ...decision, instancesCreated: decision.instancesCreated + 1 }
          : decision,
      ),
      diagnostics: [],
      createdActors: [merchant.actor],
      population: merchant.population,
      floor: input.floor,
      createdItems: merchant.items,
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
      weave: 0,
      maxWeave: 0,
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
        positions.state,
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
  return {
    status: 'placed',
    encounterId: selected.encounter.id,
    nextEncounterState: positions.state,
    encounterDecisions,
    diagnostics: [],
    createdActors,
    population,
    floor: input.floor,
    createdItems: [],
    createdFeatures: fillFeatureSlots(input),
    nextMerchantStockState: null,
  };
}

const MINIMUM_FLOOR_POPULATION_ATTEMPTS = 1;
const MAXIMUM_FLOOR_POPULATION_ATTEMPTS = 8;

/**
 * How many `placePopulation` attempts a floor gets, from its walkable (open) cell count and the
 * balance-defined encounter density: `floor(openCellCount / openCellsPerEncounter)`, clamped to
 * [1, 8]. Counting only walkable tiles (`tileDefinition(tile).walkable`) rather than raw
 * `width * height` keeps the budget proportional to the space encounters can actually occupy, so
 * two floors of equal footprint but different amounts of open floor get different budgets. Checked
 * integer division (floor of a non-negative integer quotient) -- never a float approximation.
 */
function floorPopulationAttempts(
  floor: Pick<FloorSnapshot, 'tiles'>,
  openCellsPerEncounter: number,
): number {
  if (!Number.isSafeInteger(openCellsPerEncounter) || openCellsPerEncounter <= 0) {
    throw new RangeError(
      'balance encounterDensity.openCellsPerEncounter must be a positive safe integer',
    );
  }
  let openCellCount = 0;
  for (const tile of floor.tiles) if (tileDefinition(tile).walkable) openCellCount += 1;
  if (!Number.isSafeInteger(openCellCount))
    throw new RangeError('floor open cell count overflow computing population attempts');
  const raw = Math.floor(openCellCount / openCellsPerEncounter);
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
 * Applies one population placement to the running state: threads the encounters and merchant-stock
 * RNG streams (`loot-placement` is not among them -- every loot draw happens once per floor at the
 * `placeFloorPopulations` tail, never per attempt),
 * commits created actors/items/features/populations on `placed`, and emits the matching domain
 * events. Returns the advanced run and whether the caller should stop (a `rejected` placement).
 * Shared by the guaranteed-boss pre-pass and the weighted density loop so both commit identically.
 * `floorId` is `input.floor.floorId`, threaded in rather than derived from `placement` (which
 * carries no floor reference on a `skipped` result) so `skipped` diagnostics keep their exact
 * pre-extraction payload.
 */
function applyPopulationPlacement(
  run: ActiveRun,
  placement: PopulationPlacementResult,
  events: DomainEvent[],
  eventId: string,
  floorId: OpaqueId,
): Readonly<{ run: ActiveRun; stop: boolean }> {
  let next: ActiveRun = {
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
    next = {
      ...next,
      actors: sortByActorId([...next.actors, ...placement.createdActors]),
      items:
        placement.createdItems.length === 0
          ? next.items
          : sortByItemId([...next.items, ...placement.createdItems]),
      features:
        placement.createdFeatures.length === 0
          ? next.features
          : sortByFeatureId([...next.features, ...placement.createdFeatures]),
      populations: sortByPopulationId([...next.populations, placement.population]),
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
      events.push({ ...diagnostic, eventId, floorId });
  }
  return { run: next, stop: placement.status === 'rejected' };
}

/**
 * Fills a generated floor with encounters up to its density budget: repeatedly calls
 * `placePopulation`, threading the RNG streams and encounter decisions from each attempt into the
 * next so every attempt sees the cells and populations the previous ones committed (distinct
 * populationIds, no double-booked cells). A `rejected` result (a required encounter with no legal
 * placement) stops the loop immediately -- the floor is full, and the caller decides whether that
 * means regenerating (as `generateFloor` does for its own guaranteed placements) or failing.
 *
 * Before the weighted attempts, a guaranteed-boss pre-pass force-places any eligible `model:
 * 'boss'` encounter whose non-empty required vault tags (`requiredVaultTags` +
 * `definition.vaultTags`) are all present on the floor -- so a milestone boss whose arena vault
 * was forced onto the floor (see `milestoneBossVaultId`/`requiredVaultId`) always spawns instead of
 * merely competing for a weighted attempt slot. Bosses with no required vault tags (e.g. the
 * random `ashen-warden`) are excluded by the non-empty guard and keep their weighted behavior. On
 * a floor with no such vault this pre-pass runs zero iterations and consumes no randomness.
 */
export function placeFloorPopulations(input: PlacePopulationInput): FloorPopulationsResult {
  const maps = contentMaps(input.content);
  const attempts = floorPopulationAttempts(
    input.floor,
    maps.balance.encounterDensity.openCellsPerEncounter,
  );
  const eventId = `event.${input.floor.floorId}.population`;
  let run = input.run;
  const placements: PopulationPlacementResult[] = [];
  const events: DomainEvent[] = [];

  const availableTags = availableVaultTags(input.floor, input.content);
  const bossDecisions = new Map(
    run.encounterDecisions.map((decision) => [decision.encounterId, decision]),
  );
  const guaranteedBosses = maps.encounters.filter((encounter) => {
    if (encounter.model !== 'boss') return false;
    const requiredTags = requiredAnchorTags(encounter);
    if (requiredTags.length === 0) return false;
    const decision = bossDecisions.get(encounter.id);
    return meetsBaseEligibility(
      encounter,
      decision,
      input.floor.depth,
      requiredTags,
      availableTags,
    );
  });
  for (const boss of guaranteedBosses) {
    const placement = placePopulation({
      run,
      floor: input.floor,
      content: input.content,
      ...(input.environmentTags === undefined ? {} : { environmentTags: input.environmentTags }),
      forcedEncounterId: boss.id,
    });
    placements.push(placement);
    run = applyPopulationPlacement(run, placement, events, eventId, input.floor.floorId).run;
    if (placement.status !== 'placed') {
      throw new Error(
        `internal invariant: guaranteed milestone boss ${boss.id} was eligible with its arena ` +
          `tags present on floor depth ${input.floor.depth} but failed to place ` +
          `(status: ${placement.status})`,
      );
    }
  }

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
    const applied = applyPopulationPlacement(run, placement, events, eventId, input.floor.floorId);
    run = applied.run;
    if (applied.stop) break;
  }
  // Every `loot-placement` draw for the floor happens here, after the placement attempts: a floor
  // where all encounters fail still fills its vault item slots, rolls its fragment spawn, and
  // scatters its floor loot, so no encounter or balance change can starve this stream of the draws
  // it owes (#131). That is the guarantee -- unconditional draws, not identical ones. Placement
  // outcomes still legitimately move where loot lands and, through cell culling, how many draws a
  // pass makes: placed actors reserve cells against the fragment spawn's `openFloorCells` and
  // against `placeFloorLoot`'s candidate pool. Only the vault item slots, whose positions come
  // from the floor's own slots, are outcome-independent in position as well as in count.
  const itemSlots = fillItemSlots({ ...input, run }, run.rng['loot-placement']);
  run = {
    ...run,
    items:
      itemSlots.items.length === 0 ? run.items : sortByItemId([...run.items, ...itemSlots.items]),
    rng: { ...run.rng, 'loot-placement': itemSlots.state },
  };
  const fragmentSpawn = placeFragmentSpawn({ ...input, run }, run.rng['loot-placement']);
  run = {
    ...run,
    items:
      fragmentSpawn.items.length === 0
        ? run.items
        : sortByItemId([...run.items, ...fragmentSpawn.items]),
    rng: { ...run.rng, 'loot-placement': fragmentSpawn.state },
  };
  const floorLoot = placeFloorLoot(
    { run, floor: input.floor, content: input.content },
    run.rng['loot-placement'],
  );
  run = {
    ...run,
    items:
      floorLoot.items.length === 0 ? run.items : sortByItemId([...run.items, ...floorLoot.items]),
    features:
      floorLoot.features.length === 0
        ? run.features
        : sortByFeatureId([...run.features, ...floorLoot.features]),
    rng: { ...run.rng, 'loot-placement': floorLoot.state },
  };
  return { state: run, placements, events };
}
