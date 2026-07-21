import type {
  BalanceContentEntry,
  CompiledContentPack,
  MonsterContentEntry,
} from '@woven-deep/content';
import { emptyEquipment, heroActor, type ActorState } from './actor-model.js';
import { entryById } from './content-index.js';
import type { ActiveRun, DomainEvent, FloorSnapshot, OpaqueId, Point } from './model.js';
import { tileIndex } from './model.js';
import type { BossPopulation, EncounterRunDecision } from './population-model.js';
import { compareCodeUnits } from './stable-json.js';
import { movementBlockReason } from './terrain.js';
import { HEART_BOSS_ENCOUNTER_ID, isHeartBossPresent } from './final-chamber-boss-state.js';

export {
  HEART_BOSS_ENCOUNTER_ID,
  isHeartBossActive,
  isHeartBossDefeated,
} from './final-chamber-boss-state.js';

const HEART_BOSS_POPULATION_ID: OpaqueId = 'population.heart-boss';
const HEART_BOSS_ACTOR_ID: OpaqueId = 'actor.population.heart-boss.001';
const HEART_SLOT_TAG = 'heart';

function requireMonster(content: CompiledContentPack, monsterId: OpaqueId): MonsterContentEntry {
  const entry = entryById(content, monsterId);
  if (!entry || entry.kind !== 'monster') {
    throw new Error(`internal invariant: monster definition ${monsterId} does not exist`);
  }
  return entry;
}

function requireBalance(content: CompiledContentPack): BalanceContentEntry {
  const entry = content.entries.find(
    (candidate): candidate is BalanceContentEntry => candidate.kind === 'balance',
  );
  if (!entry) throw new Error('internal invariant: content pack has no balance entry');
  return entry;
}

function heartSlotCell(floor: FloorSnapshot): Point {
  const slot = floor.placementSlots.find((candidate) => candidate.tags.includes(HEART_SLOT_TAG));
  if (!slot) {
    throw new Error(
      `internal invariant: final chamber floor ${floor.floorId} has no "${HEART_SLOT_TAG}" slot`,
    );
  }
  return { x: slot.x, y: slot.y };
}

/**
 * Picks the boss's spawn cell: the Heart's own fixture cell when free, otherwise the first
 * unoccupied walkable neighbour in a fixed order. Deterministic and consumes no randomness.
 */
function bossSpawnCell(state: ActiveRun, floor: FloorSnapshot): Point {
  const origin = heartSlotCell(floor);
  const occupied = new Set(
    state.actors
      .filter((actor) => actor.floorId === floor.floorId && actor.health > 0)
      .map((actor) => `${actor.x}:${actor.y}`),
  );
  const offsets: readonly Point[] = [
    { x: 0, y: 0 },
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: -1, y: -1 },
    { x: 1, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: 1 },
  ];
  for (const offset of offsets) {
    const cell = { x: origin.x + offset.x, y: origin.y + offset.y };
    const index = tileIndex(floor, cell.x, cell.y);
    if (index === undefined) continue;
    const tile = floor.tiles[index];
    if (tile === undefined || movementBlockReason(tile) !== undefined) continue;
    if (occupied.has(`${cell.x}:${cell.y}`)) continue;
    return cell;
  }
  throw new Error(
    `internal invariant: final chamber floor ${floor.floorId} has no free cell for the heart boss`,
  );
}

function heartBossActor(
  content: CompiledContentPack,
  cell: Point,
  floorId: OpaqueId,
  hero: ActorState,
  worldTime: number,
): ActorState {
  const definition = requireMonster(content, 'monster.weakened-heart');
  const balance = requireBalance(content);
  const heroCell = { x: hero.x, y: hero.y };
  return {
    actorId: HEART_BOSS_ACTOR_ID,
    contentId: definition.id,
    playerControlled: false,
    floorId,
    ...cell,
    attributes: definition.attributes,
    health: definition.health,
    maxHealth: definition.health,
    energy: balance.readinessThreshold,
    speed: definition.speed,
    reactionReady: true,
    disposition: definition.disposition,
    awareActorIds: [hero.actorId],
    conditions: [],
    equipment: emptyEquipment(),
    behaviorId: definition.behaviorId,
    behaviorState: {
      intent: 'approach',
      goal: { type: 'cell', floorId, ...heroCell },
      lastKnownTargets: [
        {
          targetActorId: hero.actorId,
          floorId,
          ...heroCell,
          observedAt: worldTime,
          source: 'sight',
          observerActorId: HEART_BOSS_ACTOR_ID,
        },
      ],
      investigation: null,
    },
    populationId: HEART_BOSS_POPULATION_ID,
    populationRoleId: null,
    populationPresentation: {
      name: definition.name,
      glyph: definition.glyph,
      color: definition.color,
      leader: true,
    },
  };
}

/**
 * Records the heart boss as an eligible encounter that created one instance. The Chamber floor's
 * eligibility pass already seeds a zero-instance decision for this depth-20 encounter, so the
 * existing entry is upgraded in place rather than duplicated; only a run that never saw that pass
 * appends a fresh one.
 */
function recordHeartBossInstance(
  decisions: readonly EncounterRunDecision[],
): readonly EncounterRunDecision[] {
  const existing = decisions.find((decision) => decision.encounterId === HEART_BOSS_ENCOUNTER_ID);
  if (existing) {
    return decisions.map((decision) =>
      decision.encounterId === HEART_BOSS_ENCOUNTER_ID
        ? {
            ...decision,
            eligible: true,
            reachedEligibleDepth: true,
            instancesCreated: decision.instancesCreated + 1,
          }
        : decision,
    );
  }
  const created: EncounterRunDecision = {
    encounterId: HEART_BOSS_ENCOUNTER_ID,
    baseProbability: 0,
    protectionBonus: 0,
    effectiveProbability: 0,
    eligible: true,
    reachedEligibleDepth: true,
    encountered: false,
    instancesCreated: 1,
  };
  return [...decisions, created].sort((left, right) =>
    compareCodeUnits(left.encounterId, right.encounterId),
  );
}

/**
 * Activates the weakened Heart as a hostile boss on the Final Chamber floor: injects the boss actor
 * at the Heart's cell, its `boss` population, and the encounter's run decision, then emits a
 * `population.created` event. Consumes no randomness. Combat then proceeds through the existing boss
 * and combat systems; the run does not conclude here. The caller guarantees the boss is not already
 * active, so a duplicate activation is an internal invariant violation.
 */
export function activateHeartBoss(
  input: Readonly<{ state: ActiveRun; content: CompiledContentPack; eventId: OpaqueId }>,
): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  const { state, content } = input;
  if (isHeartBossPresent(state)) {
    throw new Error('internal invariant: the heart boss is already active');
  }
  const floor = state.floors.find((candidate) => candidate.floorId === state.activeFloorId);
  if (!floor) throw new Error('internal invariant: active final chamber floor is missing');

  const hero = heroActor(state);
  const cell = bossSpawnCell(state, floor);
  const actor = heartBossActor(content, cell, floor.floorId, hero, state.worldTime);
  const population: BossPopulation = {
    model: 'boss',
    populationId: HEART_BOSS_POPULATION_ID,
    encounterId: HEART_BOSS_ENCOUNTER_ID,
    floorId: floor.floorId,
    createdAt: state.worldTime,
    livingMemberIds: [actor.actorId],
    formerMemberIds: [],
    actorId: actor.actorId,
    currentPhaseId: null,
    crossedPhaseIds: [],
    lastFloorExitAt: null,
    rewardCreated: false,
    rewardReceipt: null,
    recoveryHistory: [],
  };

  const nextState: ActiveRun = {
    ...state,
    actors: [...state.actors, actor].sort((left, right) =>
      compareCodeUnits(left.actorId, right.actorId),
    ),
    populations: [...state.populations, population].sort((left, right) =>
      compareCodeUnits(left.populationId, right.populationId),
    ),
    encounterDecisions: recordHeartBossInstance(state.encounterDecisions),
  };

  const event: DomainEvent = {
    type: 'population.created',
    eventId: input.eventId,
    populationId: population.populationId,
    encounterId: population.encounterId,
    floorId: population.floorId,
    model: population.model,
    actorIds: population.livingMemberIds,
  };
  return { state: nextState, events: [event] };
}
