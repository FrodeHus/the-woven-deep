import type {
  BalanceContentEntry,
  CompiledContentPack,
  EncounterContentEntry,
  MonsterContentEntry,
} from '@woven-deep/content';
import { emptyEquipment, type ActorState } from './actor-model.js';
import { analyzeConnectivity, preservesRequiredRoutes } from './connectivity.js';
import type { ActiveRun, FloorSnapshot, OpaqueId, Point, Uint32State } from './model.js';
import { emptyActorBehaviorState, type EncounterRunDecision, type PopulationInstance } from './population-model.js';
import { nextUint32, rollDie } from './random.js';
import { tileDefinition } from './terrain.js';

export type PopulationPlacementFailureReason = 'no-eligible-encounter' | 'no-valid-placement'
  | 'required-route-blocked';

interface PlacementBase {
  readonly encounterId: OpaqueId | null;
  readonly reason?: PopulationPlacementFailureReason;
  readonly nextEncounterState: Uint32State;
  readonly encounterDecisions: readonly EncounterRunDecision[];
  readonly diagnostics: readonly Readonly<{
    type: 'population.placement-skipped'; encounterId: OpaqueId; reason: PopulationPlacementFailureReason;
  }>[];
}

export interface PopulationPlaced extends PlacementBase {
  readonly status: 'placed';
  readonly encounterId: OpaqueId;
  readonly floor: FloorSnapshot;
  readonly createdActors: readonly ActorState[];
  readonly population: PopulationInstance;
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
  const monsters = new Map(content.entries
    .filter((entry): entry is MonsterContentEntry => entry.kind === 'monster')
    .map((entry) => [entry.id, entry]));
  const balances = content.entries.filter((entry): entry is BalanceContentEntry => entry.kind === 'balance');
  if (balances.length !== 1) throw new Error(`population placement requires one balance definition; found ${balances.length}`);
  return { encounters, monsters, balance: balances[0]! };
}

function availableVaultTags(floor: FloorSnapshot, content: CompiledContentPack): ReadonlySet<string> {
  const tags = new Set(floor.placementSlots.flatMap((slot) => slot.tags));
  const vaultIds = new Set(floor.vaults.map((vault) => vault.vaultId));
  for (const entry of content.entries) {
    if (entry.kind === 'vault' && vaultIds.has(entry.id)) entry.tags.forEach((tag) => tags.add(tag));
  }
  return tags;
}

function candidates(input: PlacePopulationInput, encounters: readonly EncounterContentEntry[]): readonly EncounterContentEntry[] {
  const decisions = new Map(input.run.encounterDecisions.map((decision) => [decision.encounterId, decision]));
  const vaultTags = availableVaultTags(input.floor, input.content);
  const environmentTags = new Set(input.environmentTags ?? []);
  return encounters.filter((encounter) => {
    const decision = decisions.get(encounter.id);
    const requiredTags = encounter.model === 'boss'
      ? [...encounter.requiredVaultTags, ...encounter.definition.vaultTags]
      : encounter.requiredVaultTags;
    return decision?.eligible === true
      && decision.instancesCreated < encounter.maximumInstancesPerRun
      && input.floor.depth >= encounter.minDepth && input.floor.depth <= encounter.maxDepth
      && encounter.environmentTags.every((tag) => environmentTags.has(tag))
      && requiredTags.every((tag) => vaultTags.has(tag));
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
    const step = rollDie(state, range); state = step.state;
    return {
      members: Array.from({ length: encounter.definition.minimumQuantity + step.value - 1 }, () => ({
        monsterId: encounter.definition.monsterId, roleId: null,
      })),
      leaderIndex: null, state,
    };
  }
  if (encounter.model === 'group') {
    const members: MemberPlan[] = [];
    for (const role of encounter.definition.roles) {
      const range = role.maximumQuantity - role.minimumQuantity + 1;
      const step = rollDie(state, range); state = step.state;
      const quantity = role.minimumQuantity + step.value - 1;
      for (let index = 0; index < quantity; index += 1) {
        members.push({ monsterId: role.monsterId, roleId: role.roleId });
      }
    }
    const leaderRoll = nextUint32(state); state = leaderRoll.state;
    const leaderIndex = leaderRoll.value / 0x1_0000_0000 < encounter.definition.leaderChance
      ? members.findIndex((member) => member.roleId === encounter.definition.leaderRoleId) : -1;
    return { members, leaderIndex: leaderIndex < 0 ? null : leaderIndex, state };
  }
  const monsterId = encounter.model === 'swarm'
    ? encounter.definition.sourceMonsterId : encounter.definition.monsterId;
  return { members: [{ monsterId, roleId: null }], leaderIndex: null, state };
}

function nextPopulationId(input: PlacePopulationInput, memberCount: number): OpaqueId {
  const usedPopulations = new Set(input.run.populations.map((population) => population.populationId));
  const usedEntities = new Set([
    ...input.run.actors.map((actor) => actor.actorId),
    ...input.run.floors.flatMap((floor) => floor.entities.map((entity) => entity.entityId)),
    ...input.floor.entities.map((entity) => entity.entityId),
  ]);
  for (let sequence = 1; sequence <= Number.MAX_SAFE_INTEGER; sequence += 1) {
    const id = `population.${String(sequence).padStart(6, '0')}`;
    const actorIdPrefix = `actor.${id}.`;
    const actorIdsAvailable = Array.from({ length: memberCount }, (_, index) =>
      `${actorIdPrefix}${String(index + 1).padStart(3, '0')}`)
      .every((actorId) => !usedEntities.has(actorId));
    if (!usedPopulations.has(id) && actorIdsAvailable) return id;
  }
  throw new Error('internal invariant: population identifier space exhausted');
}

function reservedCellIndexes(input: PlacePopulationInput, includePlacementSlots = true): Set<number> {
  const { floor, run } = input;
  const index = (point: Point) => point.y * floor.width + point.x;
  const reserved = new Set(floor.entities.map(index));
  for (const actor of run.actors) if (actor.floorId === floor.floorId && actor.health > 0) reserved.add(index(actor));
  for (const feature of run.features) if (feature.floorId === floor.floorId) reserved.add(index(feature));
  for (const item of run.items) {
    if (item.location.type === 'floor' && item.location.floorId === floor.floorId) reserved.add(index(item.location));
  }
  for (const light of floor.lights) if (light.location.type === 'fixed') reserved.add(index(light.location));
  if (floor.stairUp) reserved.add(index(floor.stairUp));
  if (floor.stairDown) reserved.add(index(floor.stairDown));
  if (includePlacementSlots) floor.placementSlots.forEach((slot) => reserved.add(index(slot)));
  return reserved;
}

function satisfiesPlacementDistances(floor: FloorSnapshot, encounter: EncounterContentEntry, cell: Point): boolean {
  const stairs = [floor.stairUp, floor.stairDown].filter((point): point is Point => point !== null);
  const objectives = floor.placementSlots.filter((slot) => slot.kind === 'objective');
  return stairs.every((stair) => chebyshev(cell, stair) >= encounter.placement.minimumStairDistance)
    && objectives.every((objective) => chebyshev(cell, objective) >= encounter.placement.minimumObjectiveDistance);
}

function legalCells(input: PlacePopulationInput, encounter: EncounterContentEntry): readonly Point[] {
  const { floor } = input;
  const reserved = reservedCellIndexes(input);
  const cells: Point[] = [];
  for (let y = 0; y < floor.height; y += 1) {
    for (let x = 0; x < floor.width; x += 1) {
      const cell = { x, y }; const index = y * floor.width + x;
      const terrain = tileDefinition(floor.tiles[index]!);
      if (reserved.has(index) || !terrain.walkable
        || !encounter.placement.allowedTerrainTags.includes(terrain.name)
        || !satisfiesPlacementDistances(floor, encounter, cell)) continue;
      cells.push(cell);
    }
  }
  return cells;
}

function requiredPoints(floor: FloorSnapshot): readonly Point[] {
  return [
    floor.stairUp, floor.stairDown,
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
      width: floor.width, height: floor.height, tiles: floor.tiles, start, target,
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

function slotProvidesTags(input: PlacePopulationInput, slot: FloorSnapshot['placementSlots'][number], tags: readonly string[]): boolean {
  const placement = input.floor.vaults.find((vault) => vault.placementId === slot.vaultPlacementId);
  const vault = placement === undefined ? undefined : input.content.entries.find((entry) =>
    entry.kind === 'vault' && entry.id === placement.vaultId);
  const available = new Set([...slot.tags, ...(vault?.tags ?? [])]);
  return tags.every((tag) => available.has(tag));
}

function selectCells(
  input: PlacePopulationInput,
  encounter: EncounterContentEntry,
  quantity: number,
): Readonly<{ cells: readonly Point[]; routeFailure: boolean }> {
  const rawCells = legalCells(input, encounter);
  const protectedIndexes = protectedRouteIndexes(input.floor);
  const all = rawCells.filter((point) => !protectedIndexes.has(point.y * input.floor.width + point.x));
  const hardReserved = reservedCellIndexes(input, false);
  const anchorTags = requiredAnchorTags(encounter);
  const vaultAnchors = encounter.placement.requiresVaultSlot
    ? input.floor.placementSlots.filter((slot) => slot.kind === 'monster'
      && slotProvidesTags(input, slot, anchorTags)) : null;
  const anchors = vaultAnchors === null ? all : vaultAnchors
    .filter((slot) => {
      const index = slot.y * input.floor.width + slot.x;
      const terrain = tileDefinition(input.floor.tiles[index]!);
      return !hardReserved.has(index) && terrain.walkable
        && encounter.placement.allowedTerrainTags.includes(terrain.name)
        && satisfiesPlacementDistances(input.floor, encounter, slot);
    })
    .map(({ x, y }) => ({ x, y }));
  let routeFailure = rawCells.length > all.length;
  const requiredOrdinaryCells = quantity - (vaultAnchors === null ? 0 : 1);
  if (requiredOrdinaryCells < 0 || requiredOrdinaryCells > all.length || (vaultAnchors !== null && anchors.length === 0)) {
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
    prefix[(bottom + 1) * stride + right + 1]!
    - prefix[top * stride + right + 1]!
    - prefix[(bottom + 1) * stride + left]!
    + prefix[top * stride + left]!;
  const inRectangle = (point: Point, left: number, top: number, right: number, bottom: number): boolean =>
    point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
  const maximumDistance = encounter.placement.maximumMemberDistance;
  for (let top = 0; top < input.floor.height; top += 1) {
    const bottom = Math.min(input.floor.height - 1, top + maximumDistance);
    for (let left = 0; left < input.floor.width; left += 1) {
      const right = Math.min(input.floor.width - 1, left + maximumDistance);
      if (rectangleCount(left, top, right, bottom) < requiredOrdinaryCells) continue;
      const anchor = vaultAnchors === null ? null
        : anchors.find((point) => inRectangle(point, left, top, right, bottom));
      if (vaultAnchors !== null && anchor === undefined) continue;
      const ordinary = all
        .filter((point) => inRectangle(point, left, top, right, bottom))
        .slice(0, requiredOrdinaryCells);
      const selected = anchor ? [anchor, ...ordinary] : ordinary;
      if (selected.length !== quantity) continue;
      const routeOk = preservesRequiredRoutes({
        width: input.floor.width, height: input.floor.height, tiles: input.floor.tiles,
        requiredPoints: requiredPoints(input.floor), blockedPoints: selected,
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
    encounterId: encounter.id, reason, nextEncounterState: state, encounterDecisions,
    diagnostics: [{ type: 'population.placement-skipped' as const, encounterId: encounter.id, reason }],
  };
  return encounter.placement.failureMode === 'required'
    ? { status: 'rejected', ...common } : { status: 'skipped', ...common };
}

export function placePopulation(input: PlacePopulationInput): PopulationPlacementResult {
  const maps = contentMaps(input.content);
  const reachedDecisions = input.run.encounterDecisions.map((decision) => {
    const encounter = maps.encounters.find((entry) => entry.id === decision.encounterId);
    return encounter && input.floor.depth >= encounter.minDepth && input.floor.depth <= encounter.maxDepth
      ? { ...decision, reachedEligibleDepth: true } : decision;
  });
  const selected = chooseEncounter(input, candidates({ ...input, run: { ...input.run, encounterDecisions: reachedDecisions } }, maps.encounters));
  if (!selected) {
    return {
      status: 'skipped', encounterId: null, reason: 'no-eligible-encounter',
      nextEncounterState: input.run.rng.encounters, encounterDecisions: reachedDecisions, diagnostics: [],
    };
  }
  const planned = composition(selected.encounter, selected.state);
  const positions = selectCells(input, selected.encounter, planned.members.length);
  if (positions.cells.length !== planned.members.length) {
    return placementFailure(selected.encounter, positions.routeFailure
      ? 'required-route-blocked' : 'no-valid-placement', planned.state, reachedDecisions);
  }

  const populationId = nextPopulationId(input, planned.members.length);
  const createdActors = planned.members.map((member, index): ActorState => {
    const definition = maps.monsters.get(member.monsterId);
    if (!definition) throw new Error(`population placement monster ${member.monsterId} does not exist`);
    const leader = planned.leaderIndex === index;
    return {
      actorId: `actor.${populationId}.${String(index + 1).padStart(3, '0')}`,
      contentId: definition.id, playerControlled: false, floorId: input.floor.floorId,
      ...positions.cells[index]!, attributes: definition.attributes,
      health: definition.health, maxHealth: definition.health, energy: maps.balance.readinessThreshold,
      speed: definition.speed, reactionReady: true, disposition: definition.disposition,
      awareActorIds: [], conditions: [], equipment: emptyEquipment(), behaviorId: definition.behaviorId,
      behaviorState: emptyActorBehaviorState(), populationId, populationRoleId: member.roleId,
      populationPresentation: {
        name: definition.name,
        glyph: leader && selected.encounter.model === 'group'
          ? (selected.encounter.definition.leaderAlternateGlyph ?? definition.glyph) : definition.glyph,
        color: leader && selected.encounter.model === 'group'
          ? selected.encounter.definition.leaderAccentColor : definition.color,
        leader,
      },
    };
  });
  const memberIds = createdActors.map((actor) => actor.actorId).sort(compareId);
  const base = {
    populationId, encounterId: selected.encounter.id, floorId: input.floor.floorId,
    createdAt: input.run.worldTime, livingMemberIds: memberIds, formerMemberIds: [],
  };
  let population: PopulationInstance;
  if (selected.encounter.model === 'individual') {
    population = { ...base, model: 'individual' };
  } else if (selected.encounter.model === 'group') {
    const leaderActorId = planned.leaderIndex === null ? null : createdActors[planned.leaderIndex]!.actorId;
    population = {
      ...base, model: 'group', leaderActorId, bonusActive: leaderActorId !== null,
      roleMembership: createdActors.map((actor) => ({ actorId: actor.actorId, roleId: actor.populationRoleId! })),
      sharedKnowledge: [], leaderResponseApplied: false, leaderResponseExpiresAt: null,
    };
  } else if (selected.encounter.model === 'swarm') {
    const nextSpawnAt = input.run.worldTime + selected.encounter.definition.spawnInterval;
    if (!Number.isSafeInteger(nextSpawnAt)) return placementFailure(selected.encounter,
      'no-valid-placement', planned.state, reachedDecisions);
    population = {
      ...base, model: 'swarm', sourceActorId: createdActors[0]!.actorId,
      nextSpawnAt,
      spawnedCount: 0, peakLivingSize: 1, shutdownState: null, emittedCapLevels: [], shutdownExpiresAt: null,
    };
  } else {
    population = {
      ...base, model: 'boss', actorId: createdActors[0]!.actorId, currentPhaseId: null,
      crossedPhaseIds: [], lastFloorExitAt: null, rewardCreated: false, rewardRollState: null, recoveryHistory: [],
    };
  }
  const encounterDecisions = reachedDecisions.map((decision) => decision.encounterId === selected.encounter.id
    ? { ...decision, instancesCreated: decision.instancesCreated + 1 } : decision);
  return {
    status: 'placed', encounterId: selected.encounter.id, nextEncounterState: planned.state,
    encounterDecisions, diagnostics: [], createdActors, population,
    floor: input.floor,
  };
}
