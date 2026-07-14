import type {
  CompiledContentPack,
  EncounterContentEntry,
  GroupEncounterDefinition,
  PopulationCombatModifiers,
} from '@woven-deep/content';
import type { ActorState } from './actor-model.js';
import { featureTiles } from './features.js';
import type {
  ActiveRun, ActorDiedEvent, GroupAwarenessSharedEvent, GroupLeaderDefeatedEvent,
  GroupOutcomeAppliedEvent, OpaqueId,
} from './model.js';
import type { GroupPopulation, LastKnownTarget } from './population-model.js';
import { compareCodeUnits } from './stable-json.js';
import { movementBlockReason } from './terrain.js';

const ZERO_MODIFIERS: PopulationCombatModifiers = Object.freeze({ accuracy: 0, defense: 0, damage: 0 });

export type GroupBehaviorEvent = GroupAwarenessSharedEvent | GroupLeaderDefeatedEvent
  | GroupOutcomeAppliedEvent | ActorDiedEvent;

function groupEncounter(content: CompiledContentPack, encounterId: OpaqueId): EncounterContentEntry & { model: 'group' } {
  const encounter = content.entries.find((entry) => entry.id === encounterId);
  if (!encounter || encounter.kind !== 'encounter' || encounter.model !== 'group') {
    throw new Error(`internal invariant: group encounter ${encounterId} does not exist`);
  }
  return encounter;
}

function distance(left: ActorState, right: ActorState): number {
  return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));
}

function newer(left: LastKnownTarget, right: LastKnownTarget): number {
  return right.observedAt - left.observedAt
    || compareCodeUnits(left.observerActorId, right.observerActorId)
    || compareCodeUnits(left.targetActorId, right.targetActorId);
}

function bestByTarget(memories: readonly LastKnownTarget[]): readonly LastKnownTarget[] {
  const byTarget = new Map<OpaqueId, LastKnownTarget>();
  for (const memory of [...memories].sort(newer)) {
    if (!byTarget.has(memory.targetActorId)) byTarget.set(memory.targetActorId, memory);
  }
  return [...byTarget.values()].sort((left, right) => compareCodeUnits(left.targetActorId, right.targetActorId));
}

function withMemory(actor: ActorState, memory: LastKnownTarget): ActorState {
  const existing = actor.behaviorState.lastKnownTargets.find((candidate) => candidate.targetActorId === memory.targetActorId);
  if (existing && newer(existing, memory) <= 0) return actor;
  const lastKnownTargets = bestByTarget([
    ...actor.behaviorState.lastKnownTargets.filter((candidate) => candidate.targetActorId !== memory.targetActorId),
    memory,
  ]);
  return { ...actor, behaviorState: { ...actor.behaviorState, lastKnownTargets,
    goal: { type: 'cell', floorId: memory.floorId, x: memory.x, y: memory.y },
    investigation: { floorId: memory.floorId, x: memory.x, y: memory.y,
      startedAt: memory.observedAt, expiresAt: null } } };
}

function relay(
  actors: readonly ActorState[],
  population: GroupPopulation,
  radius: number,
  eventId: OpaqueId,
): Readonly<{ actors: readonly ActorState[]; sharedKnowledge: readonly LastKnownTarget[]; events: readonly GroupBehaviorEvent[] }> {
  const memberIds = new Set(population.livingMemberIds);
  const members = actors.filter((actor) => memberIds.has(actor.actorId) && actor.health > 0)
    .sort((left, right) => compareCodeUnits(left.actorId, right.actorId));
  const direct = bestByTarget(members.flatMap((actor) => actor.behaviorState.lastKnownTargets
    .filter((memory) => memory.source !== 'group' && memory.observerActorId === actor.actorId)));
  const sharedKnowledge = bestByTarget([...population.sharedKnowledge, ...direct]);
  let updated = [...actors];
  const events: GroupBehaviorEvent[] = [];
  for (const observation of direct) {
    const source = members.find((actor) => actor.actorId === observation.observerActorId);
    if (!source) continue;
    const visited = new Set<OpaqueId>([source.actorId]);
    let frontier = [source];
    while (frontier.length > 0) {
      const next: ActorState[] = [];
      for (const sender of frontier) {
        for (const recipient of members) {
          if (visited.has(recipient.actorId) || distance(sender, recipient) > radius) continue;
          visited.add(recipient.actorId);
          next.push(recipient);
          const current = updated.find((actor) => actor.actorId === recipient.actorId)!;
          const groupMemory: LastKnownTarget = { ...observation, source: 'group' };
          const changed = withMemory(current, groupMemory);
          if (changed !== current) {
            updated = updated.map((actor) => actor.actorId === changed.actorId ? changed : actor);
            events.push({ type: 'group.awareness-shared', eventId, populationId: population.populationId,
              actorId: recipient.actorId, targetActorId: observation.targetActorId,
              floorId: observation.floorId, x: observation.x, y: observation.y,
              observedAt: observation.observedAt, observerActorId: observation.observerActorId });
          }
        }
      }
      frontier = next.sort((left, right) => compareCodeUnits(left.actorId, right.actorId));
    }
  }
  return { actors: updated, sharedKnowledge, events };
}

const FORMATION_OFFSETS: Readonly<Record<GroupEncounterDefinition['formation'], readonly Readonly<{ x: number; y: number }>[]>> = {
  cluster: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }],
  line: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 2, y: 0 }, { x: -2, y: 0 }],
  screen: [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: -1, y: 1 }, { x: 2, y: 1 }, { x: -2, y: 1 }],
  wedge: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: -1, y: 1 }, { x: 2, y: 2 }, { x: -2, y: 2 }],
  surround: [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 },
    { x: 1, y: 1 }, { x: -1, y: 1 }, { x: -1, y: -1 }, { x: 1, y: -1 }],
};

function formationGoals(
  state: ActiveRun,
  actors: readonly ActorState[],
  population: GroupPopulation,
  definition: GroupEncounterDefinition,
): readonly ActorState[] {
  if (population.leaderResponseApplied && (definition.leaderDeathResponse === 'panic'
    || definition.leaderDeathResponse === 'disband' || definition.leaderDeathResponse === 'surrender'
    || definition.leaderDeathResponse === 'collapse')) return actors;
  const members = actors.filter((actor) => population.livingMemberIds.includes(actor.actorId) && actor.health > 0)
    .sort((left, right) => compareCodeUnits(left.actorId, right.actorId));
  if (members.length === 0) return actors;
  const anchor = members.find((actor) => actor.actorId === population.leaderActorId) ?? members[0]!;
  const floor = state.floors.find((candidate) => candidate.floorId === population.floorId);
  if (!floor) throw new Error(`internal invariant: group floor ${population.floorId} does not exist`);
  const tiles = featureTiles(state, floor.floorId);
  const reserved = new Set<string>();
  const offsets = FORMATION_OFFSETS[definition.formation];
  return actors.map((actor) => {
    const index = members.findIndex((candidate) => candidate.actorId === actor.actorId);
    if (index < 0) return actor;
    if (actor.behaviorState.goal?.type === 'actor' || actor.behaviorState.intent === 'flee'
      || (actor.behaviorState.goal?.type === 'cell' && actor.behaviorState.investigation !== null)) return actor;
    const candidates = [...offsets.slice(index % offsets.length), ...offsets.slice(0, index % offsets.length), { x: 0, y: 0 }];
    const selected = candidates.map((offset) => ({ x: anchor.x + offset.x, y: anchor.y + offset.y }))
      .find((point) => point.x >= 0 && point.y >= 0 && point.x < floor.width && point.y < floor.height
        && movementBlockReason(tiles[point.y * floor.width + point.x]!) === undefined
        && !actors.some((occupant) => occupant.actorId !== actor.actorId && occupant.health > 0
          && occupant.floorId === actor.floorId && occupant.x === point.x && occupant.y === point.y)
        && !reserved.has(`${point.x}:${point.y}`)) ?? { x: actor.x, y: actor.y };
    reserved.add(`${selected.x}:${selected.y}`);
    const roleId = actor.populationRoleId;
    if (roleId === null) return actor;
    return { ...actor, behaviorState: { ...actor.behaviorState, goal: {
      type: 'formation', populationId: population.populationId, roleId, ...selected,
    } } };
  });
}

export function coordinateGroups(input: Readonly<{
  state: ActiveRun; content: CompiledContentPack; eventId: OpaqueId;
}>): Readonly<{ state: ActiveRun; events: readonly GroupBehaviorEvent[] }> {
  let actors = input.state.actors;
  let populations = input.state.populations;
  const events: GroupBehaviorEvent[] = [];
  for (const population of [...input.state.populations].sort((left, right) => compareCodeUnits(left.populationId, right.populationId))) {
    if (population.model !== 'group' || population.floorId !== input.state.activeFloorId) continue;
    const definition = groupEncounter(input.content, population.encounterId).definition;
    const relayed = relay(actors, population, definition.communicationRadius, input.eventId);
    actors = formationGoals(input.state, relayed.actors, population, definition);
    populations = populations.map((candidate) => candidate.populationId === population.populationId
      ? { ...population, sharedKnowledge: relayed.sharedKnowledge } : candidate);
    events.push(...relayed.events);
  }
  if (actors === input.state.actors && populations === input.state.populations) return { state: input.state, events };
  return { state: { ...input.state, actors, populations }, events };
}

export function groupCombatModifiers(input: Readonly<{
  state: Pick<ActiveRun, 'actors' | 'populations'> & Partial<Pick<ActiveRun, 'worldTime'>>;
  content: CompiledContentPack; actorId: OpaqueId;
}>): PopulationCombatModifiers {
  const actor = input.state.actors.find((candidate) => candidate.actorId === input.actorId);
  if (!actor?.populationId) return ZERO_MODIFIERS;
  const population = input.state.populations.find((candidate) => candidate.populationId === actor.populationId);
  if (!population || population.model !== 'group') return ZERO_MODIFIERS;
  const definition = groupEncounter(input.content, population.encounterId).definition;
  const leaderAlive = population.leaderActorId !== null
    && (input.state.actors.find((candidate) => candidate.actorId === population.leaderActorId)?.health ?? 0) > 0;
  if (population.bonusActive && leaderAlive) return definition.coordinationModifiers;
  if (population.leaderResponseApplied && definition.leaderDeathResponse === 'weaken') {
    return definition.responseParameters.modifiers as PopulationCombatModifiers;
  }
  if (population.leaderResponseApplied && definition.leaderDeathResponse === 'frenzy'
    && actor.behaviorState.investigation?.expiresAt !== null
    && (actor.behaviorState.investigation?.expiresAt ?? 0) > (input.state.worldTime ?? 0)) {
    return definition.responseParameters.modifiers as PopulationCombatModifiers;
  }
  return ZERO_MODIFIERS;
}

export function applyGroupLeaderOutcomes(input: Readonly<{
  state: ActiveRun; content: CompiledContentPack; eventId: OpaqueId;
}>): Readonly<{ state: ActiveRun; events: readonly GroupBehaviorEvent[] }> {
  let actors = input.state.actors;
  let populations = input.state.populations;
  const events: GroupBehaviorEvent[] = [];
  for (const population of [...input.state.populations].sort((left, right) => compareCodeUnits(left.populationId, right.populationId))) {
    if (population.model !== 'group' || population.leaderActorId === null || population.leaderResponseApplied
      || population.floorId !== input.state.activeFloorId) continue;
    const leader = actors.find((actor) => actor.actorId === population.leaderActorId);
    if (!leader || leader.health > 0) continue;
    const definition = groupEncounter(input.content, population.encounterId).definition;
    const survivorIds = population.livingMemberIds.filter((actorId) => actorId !== leader.actorId
      && (actors.find((actor) => actor.actorId === actorId)?.health ?? 0) > 0).sort(compareCodeUnits);
    const duration = Number((definition.responseParameters as { duration?: number }).duration ?? 0);
    let collapsed = 0;
    actors = actors.map((actor) => {
      if (!survivorIds.includes(actor.actorId)) return actor;
      switch (definition.leaderDeathResponse) {
        case 'panic': return { ...actor, behaviorState: { ...actor.behaviorState, intent: 'flee',
          goal: { type: 'cell', floorId: actor.floorId, x: actor.x, y: actor.y },
          investigation: { floorId: actor.floorId, x: actor.x, y: actor.y,
            startedAt: input.state.worldTime, expiresAt: input.state.worldTime + duration } } };
        case 'disband': return { ...actor, populationId: null, populationRoleId: null,
          populationPresentation: actor.populationPresentation ? { ...actor.populationPresentation, leader: false } : null };
        case 'surrender': return { ...actor, disposition: 'neutral', awareActorIds: [],
          behaviorState: { ...actor.behaviorState, intent: 'hold', goal: null, investigation: null } };
        case 'collapse': collapsed += 1; return { ...actor, health: 0 };
        case 'frenzy': return { ...actor, behaviorState: { ...actor.behaviorState,
          investigation: { floorId: actor.floorId, x: actor.x, y: actor.y,
            startedAt: input.state.worldTime, expiresAt: input.state.worldTime + duration } } };
        default: return actor;
      }
    });
    const disband = definition.leaderDeathResponse === 'disband';
    const collapse = definition.leaderDeathResponse === 'collapse';
    const remaining = disband || collapse ? [] : survivorIds;
    const formerMemberIds = [...new Set([...population.formerMemberIds, leader.actorId,
      ...(disband || collapse ? survivorIds : [])])].sort(compareCodeUnits);
    const roleMembership = disband
      ? population.roleMembership.filter((entry) => entry.actorId === leader.actorId)
      : population.roleMembership;
    populations = populations.map((candidate) => candidate.populationId === population.populationId ? {
      ...population, livingMemberIds: remaining, formerMemberIds, roleMembership,
      bonusActive: false, leaderResponseApplied: true,
    } : candidate);
    events.push({ type: 'group.leader-defeated', eventId: input.eventId,
      populationId: population.populationId, actorId: leader.actorId });
    if (collapse && definition.collapseRewards === 'individual') {
      for (const actorId of survivorIds) {
        const actor = actors.find((candidate) => candidate.actorId === actorId)!;
        events.push({ type: 'actor.died', eventId: input.eventId, actorId,
          contentId: actor.contentId, killerActorId: input.state.hero.actorId });
      }
    }
    events.push({ type: 'group.outcome-applied', eventId: input.eventId,
      populationId: population.populationId, actorId: leader.actorId,
      response: definition.leaderDeathResponse,
      individualRewards: collapse && definition.collapseRewards === 'individual', collapsedMemberCount: collapsed });
  }
  return events.length === 0 ? { state: input.state, events: [] }
    : { state: { ...input.state, actors, populations }, events };
}
