import type { CompiledContentPack, PopulationCombatModifiers, SwarmEncounterContentEntry } from '@woven-deep/content';
import { emptyEquipment, type ActorState } from './actor-model.js';
import { featureTiles } from './features.js';
import type { ActiveRun, DomainEvent, OpaqueId } from './model.js';
import type { SwarmPopulation } from './population-model.js';
import { rollDie } from './random.js';
import { compareCodeUnits } from './stable-json.js';
import { movementBlockReason, tileDefinition } from './terrain.js';

type CapLevel = SwarmPopulation['emittedCapLevels'][number];
const ZERO_MODIFIERS: PopulationCombatModifiers = { accuracy: 0, defense: 0, damage: 0 };

function deadline(worldTime: number, interval: number): number {
  const value = worldTime + interval;
  if (!Number.isSafeInteger(value)) throw new RangeError('swarm deadline must be a safe integer');
  return value;
}

function encounter(content: CompiledContentPack, encounterId: OpaqueId): SwarmEncounterContentEntry {
  const entry = content.entries.find((candidate) => candidate.id === encounterId);
  if (!entry || entry.kind !== 'encounter' || entry.model !== 'swarm') {
    throw new Error(`internal invariant: swarm encounter ${encounterId} does not exist`);
  }
  return entry;
}

function syncDeaths(population: SwarmPopulation, actors: readonly ActorState[]): SwarmPopulation {
  const dead = population.livingMemberIds.filter((id) => (actors.find((actor) => actor.actorId === id)?.health ?? 0) <= 0);
  return dead.length === 0 ? population : { ...population,
    livingMemberIds: population.livingMemberIds.filter((id) => !dead.includes(id)),
    formerMemberIds: [...new Set([...population.formerMemberIds, ...dead])].sort(compareCodeUnits) };
}

function capEvent(population: SwarmPopulation, level: CapLevel, eventId: OpaqueId): DomainEvent | null {
  return population.emittedCapLevels.includes(level) ? null : { type: 'swarm.cap-reached', eventId,
    populationId: population.populationId, sourceActorId: population.sourceActorId, level };
}

function spawnedActor(source: ActorState, definition: Extract<CompiledContentPack['entries'][number], { kind: 'monster' }>,
  population: SwarmPopulation, roleId: string, actorId: OpaqueId, x: number, y: number): ActorState {
  return { actorId, contentId: definition.id, playerControlled: false, floorId: population.floorId, x, y,
    attributes: definition.attributes, health: definition.health, maxHealth: definition.health,
    energy: source.energy, speed: definition.speed, reactionReady: true, disposition: definition.disposition,
    awareActorIds: [], conditions: [], equipment: emptyEquipment(), behaviorId: definition.behaviorId,
    behaviorState: { intent: 'hold', goal: null, lastKnownTargets: [], investigation: null },
    populationId: population.populationId, populationRoleId: roleId,
    populationPresentation: { name: definition.name, glyph: definition.glyph, color: definition.color, leader: false } };
}

function legalCells(state: ActiveRun, population: SwarmPopulation, radius: number, allowed: readonly string[]) {
  const floor = state.floors.find((candidate) => candidate.floorId === population.floorId)!;
  const source = state.actors.find((actor) => actor.actorId === population.sourceActorId)!;
  const tiles = featureTiles(state, floor.floorId);
  const occupied = new Set(state.actors.filter((actor) => actor.floorId === floor.floorId && actor.health > 0)
    .map((actor) => `${actor.x}:${actor.y}`));
  for (const entity of floor.entities) occupied.add(`${entity.x}:${entity.y}`);
  for (const feature of state.features) if (feature.floorId === floor.floorId) occupied.add(`${feature.x}:${feature.y}`);
  if (floor.stairUp) occupied.add(`${floor.stairUp.x}:${floor.stairUp.y}`);
  if (floor.stairDown) occupied.add(`${floor.stairDown.x}:${floor.stairDown.y}`);
  for (const slot of floor.placementSlots) if (slot.required || slot.kind === 'objective') occupied.add(`${slot.x}:${slot.y}`);
  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < floor.height; y += 1) for (let x = 0; x < floor.width; x += 1) {
    if (Math.max(Math.abs(x - source.x), Math.abs(y - source.y)) > radius || (x === source.x && y === source.y)) continue;
    const tile = tiles[y * floor.width + x]!;
    if (movementBlockReason(tile) !== undefined || occupied.has(`${x}:${y}`)) continue;
    const terrain = tileDefinition(tile);
    if (!allowed.includes(terrain.name) && !allowed.includes(terrain.token)) continue;
    cells.push({ x, y });
  }
  return cells;
}

export function swarmCombatModifiers(input: Readonly<{
  state: Pick<ActiveRun, 'actors' | 'populations' | 'worldTime'>; content: CompiledContentPack; actorId: OpaqueId;
}>): PopulationCombatModifiers {
  const actor = input.state.actors.find((candidate) => candidate.actorId === input.actorId);
  const population = input.state.populations.find((candidate) => candidate.populationId === actor?.populationId);
  if (!actor || population?.model !== 'swarm' || population.shutdownState !== 'frenzy'
    || population.shutdownExpiresAt === null || population.shutdownExpiresAt <= input.state.worldTime) return ZERO_MODIFIERS;
  return encounter(input.content, population.encounterId).definition.responseParameters.modifiers as PopulationCombatModifiers;
}

export function advanceSwarms(input: Readonly<{
  state: ActiveRun; content: CompiledContentPack; eventId: OpaqueId;
}>): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  let state = input.state;
  const events: DomainEvent[] = [];
  for (const original of [...state.populations].sort((a, b) => compareCodeUnits(a.populationId, b.populationId))) {
    if (original.model !== 'swarm') continue;
    const def = encounter(input.content, original.encounterId).definition;
    let population = syncDeaths(original, state.actors);
    const active = population.floorId === state.activeFloorId;
    if (!active) {
      if (population.shutdownState === null && population.nextSpawnAt <= state.worldTime) {
        population = { ...population, nextSpawnAt: deadline(state.worldTime, def.spawnInterval) };
      }
      state = { ...state, populations: state.populations.map((candidate) => candidate.populationId === population.populationId
        ? population : candidate) };
      continue;
    }
    const source = state.actors.find((actor) => actor.actorId === population.sourceActorId);
    const sourceAlive = source !== undefined && source.health > 0;
    if (!sourceAlive && population.shutdownState === null) {
      const response = def.sourceDestructionResponse;
      const duration = Number((def.responseParameters as { duration?: number }).duration ?? 0);
      const interval = Number((def.responseParameters as { interval?: number }).interval ?? 0);
      population = { ...population, shutdownState: response,
        nextSpawnAt: response === 'decay' ? deadline(state.worldTime, interval) : population.nextSpawnAt,
        shutdownExpiresAt: response === 'frenzy' ? deadline(state.worldTime, duration) : null };
      if (response === 'flee') state = { ...state, actors: state.actors.map((actor) =>
        population.livingMemberIds.includes(actor.actorId) ? { ...actor, behaviorState: { ...actor.behaviorState,
          intent: 'flee', goal: { type: 'cell', floorId: actor.floorId, x: actor.x, y: actor.y },
          investigation: { floorId: actor.floorId, x: actor.x, y: actor.y, startedAt: state.worldTime, expiresAt: null } } } : actor) };
      events.push({ type: 'swarm.source-destroyed', eventId: input.eventId, populationId: population.populationId,
        sourceActorId: population.sourceActorId, response });
    }
    if (population.shutdownState === 'decay' && population.nextSpawnAt <= state.worldTime) {
      const damage = Number((def.responseParameters as { damage: number }).damage);
      const interval = Number((def.responseParameters as { interval: number }).interval);
      state = { ...state, actors: state.actors.map((actor) => population.livingMemberIds.includes(actor.actorId)
        ? { ...actor, health: Math.max(0, actor.health - damage) } : actor) };
      population = syncDeaths({ ...population, nextSpawnAt: deadline(state.worldTime, interval) }, state.actors);
    } else if (population.shutdownState === 'frenzy' && population.shutdownExpiresAt !== null
      && population.shutdownExpiresAt <= state.worldTime) {
      state = { ...state, actors: state.actors.map((actor) => population.livingMemberIds.includes(actor.actorId)
        ? { ...actor, behaviorState: { ...actor.behaviorState, intent: 'hold', goal: null, investigation: null } } : actor) };
      population = { ...population, shutdownExpiresAt: null };
    } else if (population.shutdownState === null && population.nextSpawnAt <= state.worldTime && source) {
      const childCount = population.livingMemberIds.length - 1;
      const floorSwarmCount = state.actors.filter((actor) => actor.floorId === population.floorId && actor.health > 0
        && state.populations.some((candidate) => candidate.model === 'swarm' && candidate.populationId === actor.populationId)).length;
      const levels: CapLevel[] = [];
      if (childCount >= def.maximumLivingChildren) levels.push('source');
      if (population.livingMemberIds.length >= def.maximumLivingMembers) levels.push('encounter');
      if (floorSwarmCount >= def.maximumFloorActors) levels.push('floor');
      if (levels.length > 0) {
        for (const level of levels) { const event = capEvent(population, level, input.eventId); if (event) events.push(event); }
        population = { ...population, nextSpawnAt: deadline(state.worldTime, def.spawnInterval),
          emittedCapLevels: [...new Set([...population.emittedCapLevels, ...levels])].sort(compareCodeUnits) as CapLevel[] };
      } else {
        let rng = state.rng.encounters;
        const quantityRoll = rollDie(rng, def.maximumSpawnQuantity - def.minimumSpawnQuantity + 1); rng = quantityRoll.state;
        const requested = def.minimumSpawnQuantity + quantityRoll.value - 1;
        const capacity = Math.min(def.maximumLivingChildren - childCount,
          def.maximumLivingMembers - population.livingMemberIds.length, def.maximumFloorActors - floorSwarmCount);
        const cells = legalCells(state, population, def.placementRadius, def.allowedTerrainTags);
        const quantity = Math.min(requested, capacity, cells.length);
        const limitingLevels: CapLevel[] = [];
        if (requested > def.maximumLivingChildren - childCount) limitingLevels.push('source');
        if (requested > def.maximumLivingMembers - population.livingMemberIds.length) limitingLevels.push('encounter');
        if (requested > def.maximumFloorActors - floorSwarmCount) limitingLevels.push('floor');
        const totalWeight = def.spawnRoles.reduce((sum, role) => sum + role.weight, 0);
        const created: ActorState[] = [];
        for (let index = 0; index < quantity; index += 1) {
          const choice = rollDie(rng, totalWeight); rng = choice.state;
          let cursor = choice.value;
          const role = def.spawnRoles.find((candidate) => (cursor -= candidate.weight) <= 0)!;
          const monster = input.content.entries.find((entry) => entry.kind === 'monster' && entry.id === role.monsterId);
          if (!monster || monster.kind !== 'monster') throw new Error(`internal invariant: swarm monster ${role.monsterId} does not exist`);
          const sequence = population.spawnedCount + index + 1;
          const actorId = `actor.${population.populationId}.spawn.${String(sequence).padStart(6, '0')}`;
          if (state.actors.some((actor) => actor.actorId === actorId)) throw new Error(`internal invariant: duplicate swarm actor ${actorId}`);
          created.push(spawnedActor(source, monster, population, role.roleId, actorId, cells[index]!.x, cells[index]!.y));
        }
        const actorIds = created.map((actor) => actor.actorId).sort(compareCodeUnits);
        population = { ...population, nextSpawnAt: deadline(state.worldTime, def.spawnInterval),
          spawnedCount: population.spawnedCount + created.length,
          livingMemberIds: [...population.livingMemberIds, ...actorIds].sort(compareCodeUnits),
          peakLivingSize: Math.max(population.peakLivingSize, population.livingMemberIds.length + created.length),
          emittedCapLevels: [...new Set([...population.emittedCapLevels, ...limitingLevels])].sort(compareCodeUnits) as CapLevel[] };
        const floor = state.floors.find((candidate) => candidate.floorId === population.floorId)!;
        state = { ...state, rng: { ...state.rng, encounters: rng }, actors: [...state.actors, ...created]
          .sort((a, b) => compareCodeUnits(a.actorId, b.actorId)),
          floors: state.floors.map((candidate) => candidate.floorId === floor.floorId ? { ...candidate,
            entities: [...candidate.entities, ...created.map((actor) => ({ entityId: actor.actorId, x: actor.x, y: actor.y }))]
              .sort((a, b) => compareCodeUnits(a.entityId, b.entityId)) } : candidate) };
        if (created.length > 0) events.push({ type: 'swarm.spawned', eventId: input.eventId,
          populationId: population.populationId, sourceActorId: population.sourceActorId, actorIds, quantity: created.length });
        for (const level of limitingLevels) {
          if (!original.emittedCapLevels.includes(level)) events.push({ type: 'swarm.cap-reached', eventId: input.eventId,
            populationId: population.populationId, sourceActorId: population.sourceActorId, level });
        }
      }
    }
    state = { ...state, populations: state.populations.map((candidate) => candidate.populationId === population.populationId
      ? population : candidate) };
  }
  return { state, events };
}
