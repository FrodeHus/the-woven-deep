import type { CompiledContentPack, MonsterContentEntry } from '@woven-deep/content';
import { type GameAction, balanceEntry } from './actions.js';
import { actorById, heroActor, heroPerception, type ActorState } from './actor-model.js';
import { deriveActorStats } from './attributes.js';
import { chooseBehaviorAction } from './behavior.js';
import { resolveAttack } from './combat.js';
import { conditionModifiers } from './conditions.js';
import { advanceConditions } from './effects.js';
import { tileIndex, type ActiveRun, type DomainEvent, type OpaqueId, type Point, type Uint32State } from './model.js';
import { refreshKnowledge } from './perception.js';
import { isVisible } from './visibility.js';
import {
  completeNormalActorTurn, relationshipBetween, resolveOpportunityAttacks, setRelationship,
  type ReactionAttackResult,
} from './reactions.js';
import { advanceToNextReady, chargeActionEnergy, selectReadyActor } from './scheduler.js';

export interface WorldStepResult {
  readonly state: ActiveRun;
  readonly events: readonly DomainEvent[];
  readonly publicEvents: readonly DomainEvent[];
}

interface CombatProfile {
  readonly accuracy: number;
  readonly defense: number;
  readonly damage: Readonly<{ count: number; sides: number; bonus: number }>;
  readonly armor: number;
  readonly resistance: number;
  readonly immune: boolean;
}

function monsterDefinition(content: CompiledContentPack, actor: ActorState): MonsterContentEntry | undefined {
  const entry = content.entries.find((candidate) => candidate.id === actor.contentId);
  return entry?.kind === 'monster' ? entry : undefined;
}

function profile(actor: ActorState, content: CompiledContentPack): CombatProfile {
  const monster = monsterDefinition(content, actor);
  if (monster) return {
    accuracy: monster.accuracy,
    defense: monster.defense,
    damage: monster.damage,
    armor: monster.armor,
    resistance: monster.resistances.physical,
    immune: monster.resistances.physical === 100,
  };
  const stats = deriveActorStats({
    attributes: actor.attributes,
    formulas: balanceEntry(content).formulas,
    equipmentModifiers: [],
    conditionModifiers: conditionModifiers(actor, content),
  });
  return {
    accuracy: stats.meleeAccuracy,
    defense: stats.defense,
    damage: { count: 1, sides: 4, bonus: stats.meleeDamageBonus },
    armor: 0,
    resistance: 0,
    immune: false,
  };
}

function combat(input: Readonly<{
  actors: readonly ActorState[];
  combatState: Uint32State;
  attackerId: OpaqueId;
  targetActorId: OpaqueId;
  eventId: OpaqueId;
  content: CompiledContentPack;
}>): ReactionAttackResult {
  const attacker = input.actors.find((candidate) => candidate.actorId === input.attackerId);
  const target = input.actors.find((candidate) => candidate.actorId === input.targetActorId);
  if (!attacker || !target) throw new Error('internal invariant: combat actors must exist');
  const attack = profile(attacker, input.content);
  const defense = profile(target, input.content);
  return resolveAttack({
    ...input,
    accuracy: attack.accuracy,
    defense: defense.defense,
    damage: attack.damage,
    armor: defense.armor,
    resistance: defense.resistance,
    immune: defense.immune,
    damageType: 'physical',
  });
}

function moveActor(state: ActiveRun, actorId: OpaqueId, to: Point): ActiveRun {
  return {
    ...state,
    actors: state.actors.map((actor) => actor.actorId === actorId ? { ...actor, ...to } : actor),
  };
}

function withActor(state: ActiveRun, actor: ActorState): ActiveRun {
  return { ...state, actors: state.actors.map((candidate) => candidate.actorId === actor.actorId ? actor : candidate) };
}

function applyAction(input: Readonly<{
  state: ActiveRun;
  action: GameAction;
  content: CompiledContentPack;
  eventId: OpaqueId;
}>): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  let state = input.state;
  const actor = actorById(state, input.action.actorId);
  if (!actor) throw new Error(`internal invariant: actor ${input.action.actorId} does not exist`);
  const events: DomainEvent[] = [];
  if (input.action.type === 'move') {
    const reactions = resolveOpportunityAttacks({
      run: state, content: input.content, moverActorId: actor.actorId,
      from: { x: actor.x, y: actor.y }, to: input.action.to, eventId: input.eventId,
      resolveAttack: (attack) => combat({ ...attack, content: input.content }),
    });
    state = reactions.state;
    events.push(...reactions.events);
    if (reactions.movementAllowed) {
      state = moveActor(state, actor.actorId, input.action.to);
      events.push(actor.playerControlled
        ? { type: 'hero.moved', eventId: input.eventId, heroId: actor.actorId, from: { x: actor.x, y: actor.y }, to: input.action.to }
        : { type: 'actor.moved', eventId: input.eventId, actorId: actor.actorId, from: { x: actor.x, y: actor.y }, to: input.action.to });
    }
  } else if (input.action.type === 'wait') {
    if (actor.playerControlled) events.push({
      type: 'hero.waited', eventId: input.eventId, heroId: actor.actorId, x: actor.x, y: actor.y,
    });
  } else {
    if (relationshipBetween(state, actor.actorId, input.action.targetActorId) !== 'hostile') {
      state = setRelationship(state, actor.actorId, input.action.targetActorId, 'hostile');
      events.push({
        type: 'relationship.changed', eventId: input.eventId, actorId: actor.actorId,
        targetActorId: input.action.targetActorId, relationship: 'hostile',
      });
    }
    const resolved = combat({
      actors: state.actors, combatState: state.rng.combat, attackerId: actor.actorId,
      targetActorId: input.action.targetActorId, eventId: input.eventId, content: input.content,
    });
    state = { ...state, actors: resolved.actors, rng: { ...state.rng, combat: resolved.combatState } };
    events.push(...resolved.events);
  }
  const acted = actorById(state, actor.actorId);
  if (!acted) throw new Error(`internal invariant: acting actor ${actor.actorId} disappeared`);
  state = withActor(state, chargeActionEnergy(acted, input.action.cost));
  return { state, events };
}

function eventParticipants(event: DomainEvent): readonly OpaqueId[] {
  const ids: OpaqueId[] = [];
  if ('heroId' in event) ids.push(event.heroId);
  if ('actorId' in event) ids.push(event.actorId);
  if ('targetActorId' in event) ids.push(event.targetActorId);
  if ('sourceActorId' in event) ids.push(event.sourceActorId);
  if ('killerActorId' in event) ids.push(event.killerActorId);
  return ids;
}

function eventIsPublic(event: DomainEvent, state: ActiveRun, heroId: OpaqueId): boolean {
  if (event.type === 'action.invalid') return true;
  const participants = eventParticipants(event);
  if (participants.includes(heroId)) return true;
  const hero = actorById(state, heroId);
  if (!hero || hero.health === 0) return false;
  const floor = state.floors.find((candidate) => candidate.floorId === hero.floorId);
  if (!floor) return false;
  const positions = new Map<string, Readonly<{ x: number; y: number }>>(
    floor.entities.map((entity) => [entity.entityId, entity] as const),
  );
  for (const actor of state.actors) if (actor.floorId === floor.floorId) positions.set(actor.actorId, actor);
  const perception = refreshKnowledge({ floor, hero: heroPerception(state.hero, hero), actors: positions });
  return participants.some((actorId) => {
    const actor = actorById(state, actorId);
    if (!actor || actor.floorId !== floor.floorId) return false;
    const index = tileIndex(floor, actor.x, actor.y);
    return index !== undefined && isVisible(perception.visibilityWords, index)
      && perception.illumination.intensity[index]! > 0;
  });
}

function appendEvents(
  authoritative: DomainEvent[], publicEvents: DomainEvent[], emitted: readonly DomainEvent[], state: ActiveRun, heroId: OpaqueId,
): void {
  authoritative.push(...emitted);
  publicEvents.push(...emitted.filter((event) => eventIsPublic(event, state, heroId)));
}

function refreshHeroKnowledge(state: ActiveRun): ActiveRun {
  const hero = heroActor(state);
  const floor = state.floors.find((candidate) => candidate.floorId === hero.floorId);
  if (!floor) throw new Error(`internal invariant: active floor ${hero.floorId} is missing`);
  const positions = new Map<string, Readonly<{ x: number; y: number }>>(
    floor.entities.map((entity) => [entity.entityId, entity] as const),
  );
  for (const actor of state.actors) if (actor.floorId === floor.floorId) positions.set(actor.actorId, actor);
  const knowledge = refreshKnowledge({ floor, hero: heroPerception(state.hero, hero), actors: positions }).knowledge;
  return { ...state, floors: state.floors.map((candidate) => candidate === floor ? { ...candidate, knowledge } : candidate) };
}

export function resolveWorldStep(input: Readonly<{
  state: ActiveRun;
  content: CompiledContentPack;
  action: GameAction;
  eventId: OpaqueId;
  maxInternalActions?: number;
}>): WorldStepResult {
  if (input.content.hash !== input.state.contentHash) {
    throw new Error(`internal invariant: content hash ${input.content.hash} does not match run ${input.state.contentHash}`);
  }
  const heroId = input.state.hero.actorId;
  let resolved = applyAction({ state: input.state, action: input.action, content: input.content, eventId: input.eventId });
  let state = resolved.state;
  const events: DomainEvent[] = [];
  const publicEvents: DomainEvent[] = [];
  appendEvents(events, publicEvents, resolved.events, state, heroId);
  const actedHero = actorById(state, heroId);
  if (actedHero) state = withActor(state, completeNormalActorTurn(actedHero));
  const limit = input.maxInternalActions ?? 10_000;
  let internalActions = 0;
  while ((actorById(state, heroId)?.health ?? 0) > 0) {
    let selected = selectReadyActor(state.actors, input.content);
    if (!selected) {
      const advanced = advanceToNextReady({ worldTime: state.worldTime, actors: state.actors, content: input.content });
      state = { ...state, worldTime: advanced.worldTime, actors: advanced.actors };
      const conditions = advanceConditions({ actors: state.actors, worldTime: state.worldTime, eventId: input.eventId });
      state = { ...state, actors: conditions.actors };
      appendEvents(events, publicEvents, conditions.events, state, heroId);
      selected = selectReadyActor(state.actors, input.content);
      if (!selected) break;
    }
    if (selected.actorId === heroId) break;
    if (internalActions >= limit) throw new Error(`internal action safety limit ${limit} exceeded`);
    internalActions += 1;
    appendEvents(events, publicEvents, [{
      type: 'actor.turn.started', eventId: input.eventId, actorId: selected.actorId,
    }], state, heroId);
    const action = chooseBehaviorAction({ state, actorId: selected.actorId, content: input.content });
    resolved = applyAction({ state, action, content: input.content, eventId: input.eventId });
    state = resolved.state;
    appendEvents(events, publicEvents, resolved.events, state, heroId);
    const completed = actorById(state, selected.actorId);
    if (completed) state = withActor(state, completeNormalActorTurn(completed));
    appendEvents(events, publicEvents, [{
      type: 'actor.turn.completed', eventId: input.eventId, actorId: selected.actorId, actionType: action.type,
    }], state, heroId);
  }
  state = refreshHeroKnowledge(state);
  return { state, events, publicEvents };
}
