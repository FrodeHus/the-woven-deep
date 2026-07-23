import type { CompiledContentPack } from '@woven-deep/content';
import type { GameAction } from './actions.js';
import { actorById, heroActor, withActor } from './actor-model.js';
import { entryById } from './content-index.js';
import { chooseBehaviorAction, selectPatrolGoal } from './behavior.js';
import { ensureFactionReputation } from './commerce.js';
import { applyAction } from './action-dispatch.js';
import { damageMitigation, monsterDefinition } from './combat-profile.js';
import { tickConditions } from './condition-tick.js';
import { itemLightSources } from './equipment.js';
import { advanceSurvival, type ActorDamageMitigation } from './survival.js';
import { applyPassiveDiscovery, featureTiles } from './features.js';
import {
  tileIndex,
  type ActiveRun,
  type DomainEvent,
  type OpaqueId,
  type Point,
  type PublicEvent,
} from './model.js';
import { refreshKnowledge } from './perception.js';
import { heroFloorPerception } from './run-perception.js';
import { markEncounterObserved } from './population-gates.js';
import { updatePopulationIntent } from './population-intent.js';
import { updateActorMemory, visibleTargetObservations } from './population-perception.js';
import { applyGroupLeaderOutcomes, coordinateGroups } from './group-behavior.js';
import { advanceSwarms, swarmSpawnAction } from './swarm-behavior.js';
import { advanceBosses } from './boss-behavior.js';
import { reconcileIndividualDeaths } from './individual-behavior.js';
import { advanceFallenHeroEncounters } from './champion.js';
import { projectDomainEvents } from './event-projection.js';
import { dropMonsterLoot } from './monster-loot.js';
import { completeNormalActorTurn, relationshipBetween } from './reactions.js';
import { advanceMerchantLifecycle, scrubDepartedIntentEvents } from './merchant-lifecycle.js';
import {
  MERCHANT_BEHAVIOR_ID,
  prepareMerchantTurn,
  resolveMerchantCombatOutcomes,
} from './merchant-behavior.js';
import { advanceToNextReady, READINESS_THRESHOLD, selectReadyActor } from './scheduler.js';
import { compareCodeUnits } from './stable-json.js';
import { deriveRunActorStats } from './stats.js';
import { isTownFloorActive } from './town-floor.js';

export interface WorldStepResult {
  readonly state: ActiveRun;
  readonly events: readonly DomainEvent[];
  readonly publicEvents: readonly PublicEvent[];
  readonly internalActions: number;
}

function appendEvents(
  authoritative: DomainEvent[],
  publicEvents: PublicEvent[],
  emitted: readonly DomainEvent[],
  state: ActiveRun,
  heroId: OpaqueId,
  content: CompiledContentPack,
): void {
  if (emitted.length === 0) return;
  authoritative.push(...emitted);
  publicEvents.push(...projectDomainEvents({ events: emitted, state, heroId, content }));
}

const actorDamageMitigation: ActorDamageMitigation = (input) => {
  const actor = input.actors.find((candidate) => candidate.actorId === input.actorId);
  if (!actor) throw new Error(`internal invariant: actor ${input.actorId} does not exist`);
  return damageMitigation(actor, input.content, input.damageType);
};

function refreshHeroKnowledge(state: ActiveRun, content: CompiledContentPack): ActiveRun {
  const hero = heroActor(state);
  const floor = state.floors.find((candidate) => candidate.floorId === hero.floorId);
  if (!floor) throw new Error(`internal invariant: active floor ${hero.floorId} is missing`);
  const derived = deriveRunActorStats({ state, content, actor: hero });
  const knowledge = heroFloorPerception({
    state,
    content,
    lightOutMemory: {
      commitsMemory: derived.lightOutCommitsMemory > 0,
      revealRadius: derived.lightOutRevealRadius,
    },
  }).knowledge;
  return {
    ...state,
    floors: state.floors.map((candidate) =>
      candidate === floor ? { ...candidate, knowledge } : candidate,
    ),
  };
}

function prepareIndividualTurn(
  input: Readonly<{
    state: ActiveRun;
    actorId: OpaqueId;
    content: CompiledContentPack;
    eventId: OpaqueId;
  }>,
): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  const actor = actorById(input.state, input.actorId);
  if (!actor) throw new Error(`internal invariant: actor ${input.actorId} does not exist`);
  if (actor.floorId !== input.state.activeFloorId || actor.behaviorId === null)
    return { state: input.state, events: [] };
  const floor = input.state.floors.find((candidate) => candidate.floorId === actor.floorId);
  if (!floor) throw new Error(`internal invariant: actor floor ${actor.floorId} does not exist`);
  if (actor.behaviorId === MERCHANT_BEHAVIOR_ID) {
    return prepareMerchantTurn({
      state: input.state,
      content: input.content,
      actorId: actor.actorId,
      eventId: input.eventId,
    });
  }
  const definition = monsterDefinition(input.content, actor);
  if (!definition)
    throw new Error(`internal invariant: monster definition ${actor.contentId} does not exist`);
  const positions = new Map<string, Readonly<Point>>(
    floor.entities.map((entity) => [entity.entityId, entity] as const),
  );
  const floorActors = input.state.actors.filter(
    (candidate) => candidate.floorId === floor.floorId && candidate.health > 0,
  );
  for (const candidate of floorActors) positions.set(candidate.actorId, candidate);
  const perception = refreshKnowledge({
    floor: { ...floor, tiles: featureTiles(input.state, floor.floorId) },
    hero: { heroId: actor.actorId, x: actor.x, y: actor.y, sightRadius: definition.perception },
    actors: positions,
    additionalLights: itemLightSources({
      run: input.state,
      content: input.content,
      floorId: floor.floorId,
    }),
  });
  const observations = visibleTargetObservations({
    observerActorId: actor.actorId,
    floorId: floor.floorId,
    width: floor.width,
    visibilityWords: perception.visibilityWords,
    illuminationIntensity: perception.illumination.intensity,
    observedAt: input.state.worldTime,
    actors: floorActors,
  });
  const awareActorIds = observations
    .map((observation) => observation.targetActorId)
    .sort(compareCodeUnits);
  const hostileObservations = observations
    .filter(
      (observation) =>
        relationshipBetween(input.state, actor.actorId, observation.targetActorId) === 'hostile',
    )
    .sort((left, right) => {
      const leftDistance = Math.max(Math.abs(left.x - actor.x), Math.abs(left.y - actor.y));
      const rightDistance = Math.max(Math.abs(right.x - actor.x), Math.abs(right.y - actor.y));
      return (
        leftDistance - rightDistance || compareCodeUnits(left.targetActorId, right.targetActorId)
      );
    });
  let behaviorState = updateActorMemory({
    state: actor.behaviorState,
    observations: hostileObservations,
    investigationDuration: null,
  });
  const fleeing =
    actor.behaviorState.intent === 'flee' &&
    actor.behaviorState.investigation !== null &&
    (actor.behaviorState.investigation.expiresAt === null ||
      actor.behaviorState.investigation.expiresAt > input.state.worldTime);
  const hostileObservation = hostileObservations[0];
  if (fleeing) {
    behaviorState = {
      ...behaviorState,
      intent: 'flee',
      goal: actor.behaviorState.goal,
      investigation: actor.behaviorState.investigation,
    };
  } else if (hostileObservation) {
    behaviorState = {
      ...behaviorState,
      goal: { type: 'actor', targetActorId: hostileObservation.targetActorId },
    };
  } else if (behaviorState.investigation) {
    const investigation = behaviorState.investigation;
    const investigatedTargets = behaviorState.lastKnownTargets.filter(
      (memory) =>
        memory.floorId === investigation.floorId &&
        memory.x === investigation.x &&
        memory.y === investigation.y,
    );
    const remainsHostile =
      investigatedTargets.length === 0 ||
      investigatedTargets.some(
        (memory) =>
          actorById(input.state, memory.targetActorId) !== undefined &&
          relationshipBetween(input.state, actor.actorId, memory.targetActorId) === 'hostile',
      );
    const finished =
      investigation.floorId !== actor.floorId ||
      (investigation.x === actor.x && investigation.y === actor.y) ||
      (investigation.expiresAt !== null && investigation.expiresAt <= input.state.worldTime) ||
      !remainsHostile;
    behaviorState = finished
      ? { ...behaviorState, goal: null, investigation: null }
      : {
          ...behaviorState,
          goal: {
            type: 'cell',
            floorId: investigation.floorId,
            x: investigation.x,
            y: investigation.y,
          },
        };
  } else if (actor.behaviorId === 'behavior.patrol') {
    behaviorState = {
      ...behaviorState,
      goal: selectPatrolGoal({
        state: input.state,
        actor,
        content: input.content,
      }),
    };
  } else if (behaviorState.goal?.type !== 'formation') {
    behaviorState = { ...behaviorState, goal: null };
  }
  const target =
    !fleeing && behaviorState.goal?.type === 'actor'
      ? actorById(input.state, behaviorState.goal.targetActorId)
      : undefined;
  const adjacent =
    target !== undefined &&
    Math.max(Math.abs(target.x - actor.x), Math.abs(target.y - actor.y)) === 1;
  const spawning =
    !fleeing &&
    !adjacent &&
    swarmSpawnAction({ state: input.state, content: input.content, actorId: actor.actorId }) !==
      null;
  const intent = fleeing
    ? 'flee'
    : adjacent
      ? 'attack'
      : spawning
        ? 'spawn'
        : behaviorState.goal?.type === 'formation'
          ? 'regroup'
          : behaviorState.goal === null
            ? 'hold'
            : 'approach';
  const updatedIntent = updatePopulationIntent({
    eventId: input.eventId,
    actorId: actor.actorId,
    state: behaviorState,
    intent,
    targetCategory:
      behaviorState.goal?.type === 'actor'
        ? behaviorState.goal.targetActorId === input.state.hero.actorId
          ? 'hero'
          : null
        : behaviorState.goal === null
          ? null
          : 'position',
  });
  const updated = { ...actor, awareActorIds, behaviorState: updatedIntent.state };
  return {
    state: withActor(input.state, updated),
    events: updatedIntent.event ? [updatedIntent.event] : [],
  };
}

function observeEncounters(state: ActiveRun, content: CompiledContentPack): ActiveRun {
  if (
    state.populations.length === 0 ||
    (state.encounterDecisions.length === 0 && state.fallenHeroDecisions.length === 0)
  )
    return state;
  const hero = heroActor(state);
  const floor = state.floors.find((candidate) => candidate.floorId === hero.floorId);
  if (!floor) throw new Error(`internal invariant: active floor ${hero.floorId} is missing`);
  const perception = heroFloorPerception({ state, content });
  let decisions = state.encounterDecisions;
  let fallenDecisions = state.fallenHeroDecisions;
  const observedMerchantFactionIds: OpaqueId[] = [];
  for (const population of [...state.populations].sort((left, right) =>
    compareCodeUnits(left.populationId, right.populationId),
  )) {
    if (population.floorId !== floor.floorId) continue;
    const visible = population.livingMemberIds.some((actorId) => {
      const member = actorById(state, actorId);
      const index = member ? tileIndex(floor, member.x, member.y) : undefined;
      return (
        index !== undefined &&
        ((perception.visibilityWords[Math.floor(index / 32)]! >>> (index % 32)) & 1) === 1 &&
        perception.illumination.intensity[index]! > 0
      );
    });
    if (visible && (population.model === 'champion' || population.model === 'echo')) {
      fallenDecisions = fallenDecisions.map((decision) =>
        decision.hallRecordId === population.hallRecordId && !decision.encountered
          ? { ...decision, encountered: true }
          : decision,
      );
    } else if (
      visible &&
      !decisions.find((decision) => decision.encounterId === population.encounterId)?.encountered
    ) {
      decisions = markEncounterObserved(decisions, population.encounterId);
      if (population.model === 'merchant') observedMerchantFactionIds.push(population.factionId);
    }
  }
  let observed =
    decisions === state.encounterDecisions && fallenDecisions === state.fallenHeroDecisions
      ? state
      : { ...state, encounterDecisions: decisions, fallenHeroDecisions: fallenDecisions };
  // First legitimate observation of a merchant materializes its faction's authored
  // starting reputation exactly once; later observations keep the earned value.
  for (const factionId of observedMerchantFactionIds) {
    const faction = entryById(content, factionId);
    if (!faction || faction.kind !== 'npc-faction') {
      throw new Error(`internal invariant: merchant faction ${factionId} does not exist`);
    }
    observed = ensureFactionReputation(observed, faction);
  }
  return observed;
}

function bossEncounteredEvents(
  before: ActiveRun,
  after: ActiveRun,
  eventId: OpaqueId,
): readonly DomainEvent[] {
  return after.encounterDecisions.flatMap((decision) => {
    const previous = before.encounterDecisions.find(
      (candidate) => candidate.encounterId === decision.encounterId,
    );
    if (previous?.encountered !== false || !decision.encountered) return [];
    const population = after.populations.find(
      (candidate) => candidate.model === 'boss' && candidate.encounterId === decision.encounterId,
    );
    return population?.model === 'boss'
      ? [
          {
            type: 'boss.encountered' as const,
            eventId,
            populationId: population.populationId,
            actorId: population.actorId,
            encounterId: population.encounterId,
          },
        ]
      : [];
  });
}

function populationEncounteredEvents(
  before: ActiveRun,
  after: ActiveRun,
  eventId: OpaqueId,
  content: CompiledContentPack,
): readonly DomainEvent[] {
  const transitioned = after.encounterDecisions.filter((decision) => {
    const previous = before.encounterDecisions.find(
      (candidate) => candidate.encounterId === decision.encounterId,
    );
    return previous?.encountered === false && decision.encountered;
  });
  if (transitioned.length === 0) return [];
  const hero = heroActor(after);
  const floor = after.floors.find((candidate) => candidate.floorId === hero.floorId);
  if (!floor) throw new Error(`internal invariant: active floor ${hero.floorId} is missing`);
  const perception = heroFloorPerception({ state: after, content });
  return transitioned.flatMap((decision) => {
    for (const population of after.populations
      .filter((candidate) => candidate.encounterId === decision.encounterId)
      .sort((left, right) => compareCodeUnits(left.populationId, right.populationId))) {
      for (const actorId of population.livingMemberIds) {
        const actor = actorById(after, actorId);
        const index = actor ? tileIndex(floor, actor.x, actor.y) : undefined;
        if (
          index !== undefined &&
          ((perception.visibilityWords[Math.floor(index / 32)]! >>> (index % 32)) & 1) === 1 &&
          perception.illumination.intensity[index]! > 0
        ) {
          return [
            {
              type: 'population.encountered' as const,
              eventId,
              populationId: population.populationId,
              encounterId: population.encounterId,
              actorId,
            },
          ];
        }
      }
    }
    throw new Error(
      `internal invariant: encountered population ${decision.encounterId} has no visible member`,
    );
  });
}

function fallenHeroEncounteredEvents(
  before: ActiveRun,
  after: ActiveRun,
  eventId: OpaqueId,
): readonly DomainEvent[] {
  const events: DomainEvent[] = [];
  for (const decision of after.fallenHeroDecisions) {
    const previous = before.fallenHeroDecisions.find(
      (candidate) => candidate.hallRecordId === decision.hallRecordId,
    );
    if (previous?.encountered !== false || !decision.encountered) continue;
    const population = after.populations.find(
      (candidate) =>
        (candidate.model === 'champion' || candidate.model === 'echo') &&
        candidate.hallRecordId === decision.hallRecordId,
    );
    if (population?.model === 'champion')
      events.push({
        type: 'champion.encountered',
        eventId,
        populationId: population.populationId,
        actorId: population.actorId,
        hallRecordId: population.hallRecordId,
        rank: 1,
      });
    if (population?.model === 'echo')
      events.push({
        type: 'echo.encountered',
        eventId,
        populationId: population.populationId,
        actorId: population.actorId,
        hallRecordId: population.hallRecordId,
        rank: population.rank,
      });
  }
  return events;
}

function advanceWorldSystems(
  input: Readonly<{
    state: ActiveRun;
    content: CompiledContentPack;
    eventId: OpaqueId;
    heroId: OpaqueId;
    actionEvents: readonly DomainEvent[];
    events: DomainEvent[];
    publicEvents: PublicEvent[];
    phase: 'initial' | 'actor-turn';
  }>,
): ActiveRun {
  const { content, eventId, heroId, events, publicEvents } = input;
  let state = input.state;
  // Ranged/effect damage and deaths carry merchant consequences resolved from the action events.
  const merchantOutcome = resolveMerchantCombatOutcomes({
    state,
    content,
    events: input.actionEvents,
    eventId,
  });
  state = merchantOutcome.state;
  const bosses = advanceBosses({ state, content, eventId });
  state = bosses.state;
  state = reconcileIndividualDeaths({ state, eventId }).state;
  const fallen = advanceFallenHeroEncounters({ state, content, eventId });
  state = fallen.state;
  const beforeObservation = state;
  state = observeEncounters(state, content);
  appendEvents(events, publicEvents, input.actionEvents, state, heroId, content);
  appendEvents(events, publicEvents, merchantOutcome.events, state, heroId, content);
  appendEvents(events, publicEvents, bosses.events, state, heroId, content);
  appendEvents(events, publicEvents, fallen.events, state, heroId, content);
  appendEvents(
    events,
    publicEvents,
    populationEncounteredEvents(beforeObservation, state, eventId, content),
    state,
    heroId,
    content,
  );
  appendEvents(
    events,
    publicEvents,
    bossEncounteredEvents(beforeObservation, state, eventId),
    state,
    heroId,
    content,
  );
  appendEvents(
    events,
    publicEvents,
    fallenHeroEncounteredEvents(beforeObservation, state, eventId),
    state,
    heroId,
    content,
  );
  const groupOutcome = applyGroupLeaderOutcomes({ state, content, eventId });
  state = groupOutcome.state;
  appendEvents(events, publicEvents, groupOutcome.events, state, heroId, content);
  // The initial pass coordinates groups after leader outcomes; per-actor turns coordinate
  // earlier (before the actor's action), so it is not repeated here.
  if (input.phase === 'initial') {
    const coordinated = coordinateGroups({ state, content, eventId });
    state = coordinated.state;
    appendEvents(events, publicEvents, coordinated.events, state, heroId, content);
  }
  const swarms = advanceSwarms({ state, content, eventId });
  state = swarms.state;
  appendEvents(events, publicEvents, swarms.events, state, heroId, content);
  return state;
}

export function resolveWorldStep(
  input: Readonly<{
    state: ActiveRun;
    content: CompiledContentPack;
    action: GameAction;
    eventId: OpaqueId;
    maxInternalActions?: number;
  }>,
): WorldStepResult {
  if (input.content.hash !== input.state.contentHash) {
    throw new Error(
      `internal invariant: content hash ${input.content.hash} does not match run ${input.state.contentHash}`,
    );
  }
  const heroId = input.state.hero.actorId;
  // The town (depth 0) never advances worldTime -- see below -- so time-based energy recovery can
  // never run there. Computed once up front: a world step never changes the active floor mid-step.
  const isTownStep = isTownFloorActive(input.state);
  let resolved = applyAction({
    state: input.state,
    action: input.action,
    content: input.content,
    eventId: input.eventId,
  });
  let state = resolved.state;
  if (isTownStep) {
    // Hero-always-ready contract: worldTime is frozen in town, so the scheduler's normal
    // time-based energy recovery can never restore the hero to the acting threshold. Restore it
    // directly after the hero's action resolves so the hero can always act again immediately.
    const actedHeroForTown = actorById(state, heroId);
    if (actedHeroForTown)
      state = withActor(state, { ...actedHeroForTown, energy: READINESS_THRESHOLD });
  }
  const events: DomainEvent[] = [];
  const publicEvents: PublicEvent[] = [];
  state = advanceWorldSystems({
    state,
    content: input.content,
    eventId: input.eventId,
    heroId,
    actionEvents: resolved.events,
    events,
    publicEvents,
    phase: 'initial',
  });
  const actedHero = actorById(state, heroId);
  if (actedHero) state = withActor(state, completeNormalActorTurn(actedHero));
  const limit = input.maxInternalActions ?? 10_000;
  let internalActions = 0;
  while ((actorById(state, heroId)?.health ?? 0) > 0) {
    let selected = selectReadyActor(state.actors, input.content, state.activeFloorId);
    if (!selected && isTownStep) break; // worldTime is frozen in town: nothing can ever become ready.
    if (!selected) {
      const previousWorldTime = state.worldTime;
      const advanced = advanceToNextReady({
        worldTime: state.worldTime,
        actors: state.actors,
        content: input.content,
        activeFloorId: state.activeFloorId,
      });
      state = { ...state, worldTime: advanced.worldTime, actors: advanced.actors };
      const danger = state.actors.some(
        (actor) =>
          actor.actorId !== heroId &&
          actor.health > 0 &&
          actor.awareActorIds.includes(heroId) &&
          relationshipBetween(state, heroId, actor.actorId) === 'hostile',
      );
      const survival = advanceSurvival({
        state,
        content: input.content,
        elapsed: state.worldTime - previousWorldTime,
        eventId: input.eventId,
        danger,
        tickConditions,
        mitigationFor: actorDamageMitigation,
      });
      state = survival.state;
      appendEvents(events, publicEvents, survival.events, state, heroId, input.content);
      const swarms = advanceSwarms({ state, content: input.content, eventId: input.eventId });
      state = swarms.state;
      appendEvents(events, publicEvents, swarms.events, state, heroId, input.content);
      const bosses = advanceBosses({ state, content: input.content, eventId: input.eventId });
      state = bosses.state;
      appendEvents(events, publicEvents, bosses.events, state, heroId, input.content);
      state = reconcileIndividualDeaths({ state, eventId: input.eventId }).state;
      const fallen = advanceFallenHeroEncounters({
        state,
        content: input.content,
        eventId: input.eventId,
      });
      state = fallen.state;
      appendEvents(events, publicEvents, fallen.events, state, heroId, input.content);
      selected = selectReadyActor(state.actors, input.content, state.activeFloorId);
      if (!selected) break;
    }
    if (selected.actorId === heroId) break;
    // Town step contract: no non-hero actor is ever scheduled on depth 0 (town merchants carry
    // `behaviorId: null`, so they take no turns). This is a defense-in-depth invariant, not a
    // reachable path -- with the hero always restored to the readiness threshold and no other
    // ready actor able to out-race it, `selectReadyActor` should never surface anyone else here.
    if (isTownStep)
      throw new Error(
        `internal invariant: town floor scheduled a non-hero actor ${selected.actorId}`,
      );
    if (internalActions >= limit) throw new Error(`internal action safety limit ${limit} exceeded`);
    internalActions += 1;
    const prepared = prepareIndividualTurn({
      state,
      actorId: selected.actorId,
      content: input.content,
      eventId: input.eventId,
    });
    state = prepared.state;
    const coordinated = coordinateGroups({ state, content: input.content, eventId: input.eventId });
    state = coordinated.state;
    appendEvents(
      events,
      publicEvents,
      [
        {
          type: 'actor.turn.started',
          eventId: input.eventId,
          actorId: selected.actorId,
        },
      ],
      state,
      heroId,
      input.content,
    );
    appendEvents(events, publicEvents, prepared.events, state, heroId, input.content);
    appendEvents(events, publicEvents, coordinated.events, state, heroId, input.content);
    const action = chooseBehaviorAction({
      state,
      actorId: selected.actorId,
      content: input.content,
    });
    if (action.type === 'rest')
      throw new Error('internal invariant: non-player behavior selected rest');
    if (action.type === 'final-chamber-choice')
      throw new Error('internal invariant: non-player behavior selected final-chamber-choice');
    resolved = applyAction({ state, action, content: input.content, eventId: input.eventId });
    state = resolved.state;
    state = advanceWorldSystems({
      state,
      content: input.content,
      eventId: input.eventId,
      heroId,
      actionEvents: resolved.events,
      events,
      publicEvents,
      phase: 'actor-turn',
    });
    const completed = actorById(state, selected.actorId);
    if (completed) state = withActor(state, completeNormalActorTurn(completed));
    appendEvents(
      events,
      publicEvents,
      [
        {
          type: 'actor.turn.completed',
          eventId: input.eventId,
          actorId: selected.actorId,
          actionType: action.type,
        },
      ],
      state,
      heroId,
      input.content,
    );
  }
  // Global merchant deadlines resolve at every world-time boundary — including merchants on
  // inactive floors, whose actors never take turns above. In town, worldTime never moved this
  // step (frozen by contract), so this would no-op anyway; skipped outright for clarity.
  const lifecycle = isTownStep
    ? { state, events: [] as readonly DomainEvent[] }
    : advanceMerchantLifecycle({
        state,
        content: input.content,
        previousWorldTime: input.state.worldTime,
        nextWorldTime: state.worldTime,
        eventId: input.eventId,
      });
  state = lifecycle.state;
  // A merchant departing within this same command may already have emitted intent events into
  // the in-flight arrays; drop them before they are recorded, exactly as saved commands are
  // scrubbed, so the recorded command never carries a dangling actor reference.
  scrubDepartedIntentEvents({ events, publicEvents, departureEvents: lifecycle.events });
  appendEvents(events, publicEvents, lifecycle.events, state, heroId, input.content);
  state = refreshHeroKnowledge(state, input.content);
  // Single reaping pass: any actor (never the hero) that transitioned from health >0 to 0
  // this step drops its monster loot exactly once, in deterministic actorId order, before
  // the function's two return points below.
  const preStepHealth = new Map(
    input.state.actors.map((actor) => [actor.actorId, actor.health] as const),
  );
  const newlyDead = state.actors
    .filter(
      (actor) =>
        actor.health === 0 &&
        !actor.playerControlled &&
        (preStepHealth.get(actor.actorId) ?? 0) > 0,
    )
    .sort((left, right) => compareCodeUnits(left.actorId, right.actorId));
  for (const deadActor of newlyDead) {
    const drop = dropMonsterLoot({
      state,
      content: input.content,
      deadActor,
      eventId: input.eventId,
    });
    state = drop.state;
    appendEvents(events, publicEvents, drop.events, state, heroId, input.content);
  }
  const passiveHero = heroActor(state);
  if (passiveHero.health === 0) return { state, events, publicEvents, internalActions };
  const passiveFloor = state.floors.find((candidate) => candidate.floorId === passiveHero.floorId)!;
  const passivePerception = heroFloorPerception({ state, content: input.content });
  const passiveIndex = tileIndex(passiveFloor, passiveHero.x, passiveHero.y)!;
  const passive = applyPassiveDiscovery({
    run: state,
    actorId: passiveHero.actorId,
    illumination: passivePerception.illumination.intensity[passiveIndex]!,
    eventId: input.eventId,
  });
  state = passive.run;
  appendEvents(events, publicEvents, passive.events, state, heroId, input.content);
  if (passive.events.length > 0) state = refreshHeroKnowledge(state, input.content);
  return { state, events, publicEvents, internalActions };
}
