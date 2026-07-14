import type { CompiledContentPack, MonsterContentEntry } from '@woven-deep/content';
import { type GameAction, balanceEntry } from './actions.js';
import { actorById, heroActor, heroPerception, type ActorState } from './actor-model.js';
import { deriveActorStats } from './attributes.js';
import { chooseBehaviorAction } from './behavior.js';
import { resolveAttack } from './combat.js';
import { conditionModifiers } from './conditions.js';
import { resolveEffectSequence } from './effects.js';
import { consumeItemQuantity, dropItem, pickupItem, splitStack } from './inventory.js';
import {
  equipItem, equipmentModifiers, itemLightSources, refuelItem, toggleItemLight, unequipItem,
} from './equipment.js';
import { identifyAppearance } from './identification.js';
import { advanceSurvival, hungerModifiers } from './survival.js';
import { applyPassiveDiscovery, closeDoor, disarmTrap, featureTiles, openDoor, searchFeatures, triggerTrap } from './features.js';
import { tileIndex, type ActiveRun, type DomainEvent, type OpaqueId, type Point, type Uint32State } from './model.js';
import { refreshKnowledge } from './perception.js';
import { markEncounterObserved } from './population-gates.js';
import { updatePopulationIntent } from './population-intent.js';
import { updateActorMemory, visibleTargetObservations } from './population-perception.js';
import { projectDomainEvents } from './event-projection.js';
import {
  completeNormalActorTurn, relationshipBetween, resolveOpportunityAttacks, setRelationship,
  type ReactionAttackResult,
} from './reactions.js';
import { advanceToNextReady, chargeActionEnergy, selectReadyActor } from './scheduler.js';
import { compareCodeUnits } from './stable-json.js';

export interface WorldStepResult {
  readonly state: ActiveRun;
  readonly events: readonly DomainEvent[];
  readonly publicEvents: readonly DomainEvent[];
  readonly internalActions: number;
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

function requiredItemDefinition(content: CompiledContentPack, contentId: OpaqueId) {
  const entry = content.entries.find((candidate) => candidate.id === contentId);
  if (!entry || entry.kind !== 'item') throw new Error(`internal invariant: item definition ${contentId} does not exist`);
  return entry;
}

function profile(
  actor: ActorState,
  content: CompiledContentPack,
  items: ActiveRun['items'] = [],
  actors: ActiveRun['actors'] = [actor],
  survival: ActiveRun['survival'] | undefined = undefined,
): CombatProfile {
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
    equipmentModifiers: equipmentModifiers({ run: { actors, items }, content, actorId: actor.actorId })
      .map((source) => source.modifiers),
    conditionModifiers: [
      ...conditionModifiers(actor, content),
      hungerModifiers({ stage: survival?.hungerStage ?? 'sated', balance: balanceEntry(content) }),
    ],
  });
  const equipped = items.filter((item) => item.location.type === 'equipped'
    && item.location.actorId === actor.actorId);
  const mainHandId = actor.equipment['main-hand'];
  const mainHand = mainHandId ? equipped.find((item) => item.itemId === mainHandId) : undefined;
  const weapon = mainHand ? requiredItemDefinition(content, mainHand.contentId).combat : undefined;
  const damage = weapon?.damage && weapon.ammunitionTag === null
    ? { ...weapon.damage, bonus: weapon.damage.bonus + stats.meleeDamageBonus }
    : { count: 1, sides: 4, bonus: stats.meleeDamageBonus };
  const armor = equipped.reduce((total, item) => total
    + (requiredItemDefinition(content, item.contentId).combat?.armor ?? 0), 0);
  return {
    accuracy: stats.meleeAccuracy,
    defense: stats.defense,
    damage,
    armor,
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
  items: ActiveRun['items'];
  survival: ActiveRun['survival'];
}>): ReactionAttackResult {
  const attacker = input.actors.find((candidate) => candidate.actorId === input.attackerId);
  const target = input.actors.find((candidate) => candidate.actorId === input.targetActorId);
  if (!attacker || !target) throw new Error('internal invariant: combat actors must exist');
  const attack = profile(attacker, input.content, input.items, input.actors, input.survival);
  const defense = profile(target, input.content, input.items, input.actors, input.survival);
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
  const action = input.action;
  const actor = actorById(state, action.actorId);
  if (!actor) throw new Error(`internal invariant: actor ${action.actorId} does not exist`);
  const events: DomainEvent[] = [];
  if (action.type === 'rest') throw new Error('internal invariant: rest must be expanded into world steps');
  if (action.type === 'search') {
    const floor = state.floors.find((candidate) => candidate.floorId === actor.floorId)!;
    const positions = new Map(state.actors.filter((candidate) => candidate.floorId === floor.floorId)
      .map((candidate) => [candidate.actorId, candidate] as const));
    const perception = refreshKnowledge({ floor: { ...floor, tiles: featureTiles(state, floor.floorId) },
      hero: heroPerception(state.hero, actor), actors: positions,
      additionalLights: itemLightSources({ run: state, content: input.content, floorId: floor.floorId }) });
    const index = tileIndex(floor, actor.x, actor.y)!;
    const result = searchFeatures({ run: state, actorId: actor.actorId,
      illumination: perception.illumination.intensity[index]!, eventId: input.eventId });
    state = result.run; events.push(...result.events);
  } else if (action.type === 'disarm') {
    const result = disarmTrap({ run: state, content: input.content, actorId: actor.actorId,
      featureId: action.featureId, eventId: input.eventId });
    state = result.run; events.push(...result.events);
  } else if (action.type === 'open-door' || action.type === 'close-door') {
    const transition = action.type === 'open-door'
      ? openDoor({ run: state, actorId: actor.actorId, featureId: action.featureId })
      : closeDoor({ run: state, actorId: actor.actorId, featureId: action.featureId });
    if (!transition.ok) throw new Error(`internal invariant: validated door action failed with ${transition.reason}`);
    state = transition.run;
    events.push({ type: action.type === 'open-door' ? 'door.opened' : 'door.closed',
      eventId: input.eventId, actorId: actor.actorId, featureId: action.featureId });
  } else if (action.type === 'toggle-light') {
    const transition = toggleItemLight({ run: state, content: input.content,
      actorId: actor.actorId, itemId: action.itemId, enabled: action.enabled });
    if (!transition.ok) throw new Error(`internal invariant: validated light toggle failed with ${transition.reason}`);
    state = transition.run;
    events.push({ type: 'item.light-toggled', eventId: input.eventId, actorId: actor.actorId,
      itemId: action.itemId, enabled: action.enabled });
  } else if (action.type === 'refuel') {
    const transition = refuelItem({ run: state, content: input.content, actorId: actor.actorId,
      itemId: action.itemId, fuelItemId: action.fuelItemId, quantity: action.quantity });
    if (!transition.ok) throw new Error(`internal invariant: validated refuel failed with ${transition.reason}`);
    state = transition.run;
    const target = state.items.find((item) => item.itemId === action.itemId)!;
    events.push({ type: 'item.refueled', eventId: input.eventId, actorId: actor.actorId,
      itemId: action.itemId, fuelItemId: action.fuelItemId, quantity: transition.quantity!, fuel: target.fuel! });
  } else if (action.type === 'equip') {
    const transition = equipItem({ run: state, content: input.content, actorId: actor.actorId,
      itemId: action.itemId, slot: action.slot });
    if (!transition.ok) throw new Error(`internal invariant: validated equip failed with ${transition.reason}`);
    state = transition.run;
    events.push({ type: 'item.equipped', eventId: input.eventId, actorId: actor.actorId,
      itemId: action.itemId, slot: action.slot });
  } else if (action.type === 'unequip') {
    const transition = unequipItem({ run: state, actorId: actor.actorId, slot: action.slot });
    if (!transition.ok) throw new Error(`internal invariant: validated unequip failed with ${transition.reason}`);
    state = transition.run;
    events.push({ type: 'item.unequipped', eventId: input.eventId, actorId: actor.actorId,
      itemId: action.itemId, slot: action.slot });
  } else if (action.type === 'use-item') {
    const source = state.items.find((item) => item.itemId === action.itemId);
    if (!source) throw new Error(`internal invariant: used item ${action.itemId} disappeared`);
    const definition = requiredItemDefinition(input.content, source.contentId);
    const target = actorById(state, action.targetActorId);
    if (!target) throw new Error(`internal invariant: effect target ${action.targetActorId} disappeared`);
    events.push({ type: 'item.used', eventId: input.eventId, actorId: actor.actorId,
      itemId: source.itemId, targetActorId: target.actorId });
    const resolved = resolveEffectSequence({
      effects: definition.effects, actors: state.actors, items: state.items, content: input.content,
      sourceActorId: actor.actorId, sourceItemId: source.itemId, targetActorId: target.actorId,
      effectsState: state.rng.effects, worldTime: state.worldTime, eventId: input.eventId,
      survival: state.survival,
      survivalActorId: state.hero.actorId,
      forceMoveDirection: target.actorId === actor.actorId ? { x: 1, y: 0 } : {
        x: Math.sign(target.x - actor.x), y: Math.sign(target.y - actor.y),
      },
      operations: {},
    });
    state = { ...state, actors: resolved.actors, items: resolved.items, survival: resolved.survival,
      rng: { ...state.rng, effects: resolved.effectsState } };
    const consumedEvents = resolved.events.filter((event) => event.type === 'item.consumed');
    events.push(...resolved.events.filter((event) => event.type !== 'item.consumed'));
    if (definition.identification.mode === 'shuffled') {
      const identified = identifyAppearance({ run: state, contentId: definition.id, eventId: input.eventId });
      state = identified.state;
      events.push(...identified.events);
    }
    events.push(...consumedEvents);
  } else if (action.type === 'fire') {
    const weapon = state.items.find((item) => item.itemId === action.weaponItemId);
    if (!weapon) throw new Error(`internal invariant: weapon ${action.weaponItemId} disappeared`);
    const definition = requiredItemDefinition(input.content, weapon.contentId);
    if (!definition.combat?.damage) throw new Error(`internal invariant: weapon ${weapon.itemId} cannot fire`);
    const consumed = consumeItemQuantity({ run: state, itemId: action.ammunitionItemId, quantity: 1 });
    if (!consumed.ok) throw new Error(`internal invariant: validated ammunition failed with ${consumed.reason}`);
    state = consumed.run;
    events.push({ type: 'item.consumed', eventId: input.eventId, actorId: actor.actorId,
      itemId: action.ammunitionItemId, quantity: 1 });
    const attackerStats = deriveActorStats({
      attributes: actor.attributes, formulas: balanceEntry(input.content).formulas,
      equipmentModifiers: equipmentModifiers({ run: state, content: input.content, actorId: actor.actorId })
        .map((source) => source.modifiers),
      conditionModifiers: [
        ...conditionModifiers(actor, input.content),
        hungerModifiers({ stage: state.survival.hungerStage, balance: balanceEntry(input.content) }),
      ],
    });
    const target = actorById(state, action.targetActorId);
    if (!target) throw new Error(`internal invariant: target ${action.targetActorId} disappeared`);
    const defense = profile(target, input.content, state.items, state.actors, state.survival);
    const shot = resolveAttack({
      eventId: input.eventId, attackerId: actor.actorId, targetActorId: target.actorId,
      actors: state.actors, combatState: state.rng.combat,
      accuracy: attackerStats.rangedAccuracy,
      defense: defense.defense, damage: definition.combat.damage, armor: defense.armor,
      resistance: defense.resistance, immune: defense.immune, damageType: 'physical',
    });
    state = { ...state, actors: shot.actors, rng: { ...state.rng, combat: shot.combatState } };
    events.push(...shot.events);
  } else if (action.type === 'throw-item') {
    const source = state.items.find((item) => item.itemId === action.itemId);
    if (!source) throw new Error(`internal invariant: thrown item ${action.itemId} disappeared`);
    const definition = requiredItemDefinition(input.content, source.contentId);
    if (definition.effects.some((effect) => effect.effectId === 'effect.item.consume')) {
      const target = state.actors.find((candidate) => candidate.floorId === actor.floorId && candidate.health > 0
        && candidate.x === action.target.x && candidate.y === action.target.y);
      if (!target) throw new Error('internal invariant: thrown effect target disappeared');
      events.push({ type: 'item.thrown', eventId: input.eventId, actorId: actor.actorId,
        itemId: source.itemId, quantity: action.quantity, to: action.target });
      const resolved = resolveEffectSequence({
        effects: definition.effects, actors: state.actors, items: state.items, content: input.content,
        sourceActorId: actor.actorId, sourceItemId: source.itemId, targetActorId: target.actorId,
        effectsState: state.rng.effects, worldTime: state.worldTime, eventId: input.eventId,
        survival: state.survival,
        survivalActorId: state.hero.actorId,
        forceMoveDirection: { x: Math.sign(target.x - actor.x), y: Math.sign(target.y - actor.y) },
        operations: {},
      });
      state = { ...state, actors: resolved.actors, items: resolved.items, survival: resolved.survival,
        rng: { ...state.rng, effects: resolved.effectsState } };
      events.push(...resolved.events);
    } else {
      const partial = action.quantity < source.quantity;
      const transition = dropItem({
        run: state, actorId: actor.actorId, itemId: source.itemId,
        quantity: action.quantity, newItemId: action.newItemId,
      });
      if (!transition.ok) throw new Error(`internal invariant: validated throw failed with ${transition.reason}`);
      const thrownItemId = partial ? action.newItemId : source.itemId;
      state = {
        ...transition.run,
        items: transition.items.map((item) => item.itemId === thrownItemId
          ? { ...item, location: { type: 'floor' as const, floorId: actor.floorId, ...action.target } }
          : item),
      };
      events.push({ type: 'item.thrown', eventId: input.eventId, actorId: actor.actorId,
        itemId: thrownItemId, quantity: action.quantity, to: action.target });
    }
  } else if (action.type === 'pickup') {
    const transition = pickupItem({
      run: state, content: input.content, actorId: actor.actorId, itemId: action.itemId,
      quantity: action.quantity, newItemId: action.newItemId,
    });
    if (!transition.ok) throw new Error(`internal invariant: validated pickup failed with ${transition.reason}`);
    state = transition.run;
    events.push({ type: 'item.picked-up', eventId: input.eventId, actorId: actor.actorId,
      itemId: action.itemId, quantity: action.quantity });
  } else if (action.type === 'drop') {
    const transition = dropItem({
      run: state, actorId: actor.actorId, itemId: action.itemId,
      quantity: action.quantity, newItemId: action.newItemId,
    });
    if (!transition.ok) throw new Error(`internal invariant: validated drop failed with ${transition.reason}`);
    state = transition.run;
    events.push({ type: 'item.dropped', eventId: input.eventId, actorId: actor.actorId,
      itemId: action.itemId, quantity: action.quantity });
  } else if (action.type === 'split-stack') {
    const transition = splitStack({
      run: state, content: input.content, actorId: actor.actorId, itemId: action.itemId,
      quantity: action.quantity, newItemId: action.newItemId,
    });
    if (!transition.ok) throw new Error(`internal invariant: validated split failed with ${transition.reason}`);
    state = transition.run;
    events.push({ type: 'item.stack-split', eventId: input.eventId, actorId: actor.actorId,
      itemId: action.itemId, newItemId: action.newItemId, quantity: action.quantity });
  } else if (action.type === 'move') {
    const reactions = resolveOpportunityAttacks({
      run: state, content: input.content, moverActorId: actor.actorId,
      from: { x: actor.x, y: actor.y }, to: action.to, eventId: input.eventId,
      resolveAttack: (attack) => combat({ ...attack, content: input.content, items: state.items, survival: state.survival }),
    });
    state = reactions.state;
    events.push(...reactions.events);
    if (reactions.movementAllowed) {
      state = moveActor(state, actor.actorId, action.to);
      events.push(actor.playerControlled
        ? { type: 'hero.moved', eventId: input.eventId, heroId: actor.actorId, from: { x: actor.x, y: actor.y }, to: action.to }
        : { type: 'actor.moved', eventId: input.eventId, actorId: actor.actorId, from: { x: actor.x, y: actor.y }, to: action.to });
      const trap = state.features.find((feature) => feature.type === 'trap' && feature.state === 'armed'
        && feature.floorId === actor.floorId && feature.x === action.to.x && feature.y === action.to.y);
      if (trap) {
        const triggered = triggerTrap({ run: state, content: input.content, actorId: actor.actorId,
          featureId: trap.featureId, eventId: input.eventId });
        state = triggered.run; events.push(...triggered.events);
      }
    }
  } else if (action.type === 'wait') {
    if (actor.playerControlled) events.push({
      type: 'hero.waited', eventId: input.eventId, heroId: actor.actorId, x: actor.x, y: actor.y,
    });
  } else {
    if (relationshipBetween(state, actor.actorId, action.targetActorId) !== 'hostile') {
      state = setRelationship(state, actor.actorId, action.targetActorId, 'hostile');
      events.push({
        type: 'relationship.changed', eventId: input.eventId, actorId: actor.actorId,
        targetActorId: action.targetActorId, relationship: 'hostile',
      });
    }
    const resolved = combat({
      actors: state.actors, combatState: state.rng.combat, attackerId: actor.actorId,
      targetActorId: action.targetActorId, eventId: input.eventId, content: input.content,
      items: state.items, survival: state.survival,
    });
    state = { ...state, actors: resolved.actors, rng: { ...state.rng, combat: resolved.combatState } };
    events.push(...resolved.events);
  }
  const acted = actorById(state, actor.actorId);
  if (!acted) throw new Error(`internal invariant: acting actor ${actor.actorId} disappeared`);
  state = withActor(state, chargeActionEnergy(acted, action.cost));
  return { state, events };
}

function appendEvents(
  authoritative: DomainEvent[], publicEvents: DomainEvent[], emitted: readonly DomainEvent[], state: ActiveRun, heroId: OpaqueId,
  content: CompiledContentPack,
): void {
  authoritative.push(...emitted);
  publicEvents.push(...projectDomainEvents({ events: emitted, state, heroId, content }));
}

function refreshHeroKnowledge(state: ActiveRun, content: CompiledContentPack): ActiveRun {
  const hero = heroActor(state);
  const floor = state.floors.find((candidate) => candidate.floorId === hero.floorId);
  if (!floor) throw new Error(`internal invariant: active floor ${hero.floorId} is missing`);
  const positions = new Map<string, Readonly<{ x: number; y: number }>>(
    floor.entities.map((entity) => [entity.entityId, entity] as const),
  );
  for (const actor of state.actors) if (actor.floorId === floor.floorId) positions.set(actor.actorId, actor);
  const knowledge = refreshKnowledge({
    floor: { ...floor, tiles: featureTiles(state, floor.floorId) },
    hero: heroPerception(state.hero, hero), actors: positions,
    additionalLights: itemLightSources({ run: state, content, floorId: floor.floorId }),
  }).knowledge;
  return { ...state, floors: state.floors.map((candidate) => candidate === floor ? { ...candidate, knowledge } : candidate) };
}

function prepareIndividualTurn(input: Readonly<{
  state: ActiveRun; actorId: OpaqueId; content: CompiledContentPack; eventId: OpaqueId;
}>): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  const actor = actorById(input.state, input.actorId);
  if (!actor) throw new Error(`internal invariant: actor ${input.actorId} does not exist`);
  if (actor.floorId !== input.state.activeFloorId || actor.behaviorId === null) return { state: input.state, events: [] };
  const floor = input.state.floors.find((candidate) => candidate.floorId === actor.floorId);
  if (!floor) throw new Error(`internal invariant: actor floor ${actor.floorId} does not exist`);
  const definition = monsterDefinition(input.content, actor);
  if (!definition) throw new Error(`internal invariant: monster definition ${actor.contentId} does not exist`);
  const positions = new Map<string, Readonly<Point>>(floor.entities.map((entity) => [entity.entityId, entity] as const));
  const floorActors = input.state.actors.filter((candidate) => candidate.floorId === floor.floorId && candidate.health > 0);
  for (const candidate of floorActors) positions.set(candidate.actorId, candidate);
  const perception = refreshKnowledge({
    floor: { ...floor, tiles: featureTiles(input.state, floor.floorId) },
    hero: { heroId: actor.actorId, x: actor.x, y: actor.y, sightRadius: definition.perception },
    actors: positions,
    additionalLights: itemLightSources({ run: input.state, content: input.content, floorId: floor.floorId }),
  });
  const observations = visibleTargetObservations({
    observerActorId: actor.actorId, floorId: floor.floorId, width: floor.width,
    visibilityWords: perception.visibilityWords, illuminationIntensity: perception.illumination.intensity,
    observedAt: input.state.worldTime, actors: floorActors,
  });
  const awareActorIds = observations.map((observation) => observation.targetActorId).sort(compareCodeUnits);
  const hostileObservations = observations.filter((observation) => (
    relationshipBetween(input.state, actor.actorId, observation.targetActorId) === 'hostile'
  )).sort((left, right) => {
    const leftDistance = Math.max(Math.abs(left.x - actor.x), Math.abs(left.y - actor.y));
    const rightDistance = Math.max(Math.abs(right.x - actor.x), Math.abs(right.y - actor.y));
    return leftDistance - rightDistance || compareCodeUnits(left.targetActorId, right.targetActorId);
  });
  let behaviorState = updateActorMemory({
    state: actor.behaviorState, observations: hostileObservations, investigationDuration: null,
  });
  const hostileObservation = hostileObservations[0];
  if (hostileObservation) {
    behaviorState = { ...behaviorState, goal: { type: 'actor', targetActorId: hostileObservation.targetActorId } };
  } else if (behaviorState.investigation) {
    const investigation = behaviorState.investigation;
    const investigatedTargets = behaviorState.lastKnownTargets.filter((memory) => memory.floorId === investigation.floorId
      && memory.x === investigation.x && memory.y === investigation.y);
    const remainsHostile = investigatedTargets.length === 0 || investigatedTargets.some((memory) => (
      actorById(input.state, memory.targetActorId) !== undefined
      && relationshipBetween(input.state, actor.actorId, memory.targetActorId) === 'hostile'
    ));
    const finished = investigation.floorId !== actor.floorId
      || (investigation.x === actor.x && investigation.y === actor.y)
      || (investigation.expiresAt !== null && investigation.expiresAt <= input.state.worldTime)
      || !remainsHostile;
    behaviorState = finished
      ? { ...behaviorState, goal: null, investigation: null }
      : { ...behaviorState, goal: { type: 'cell', floorId: investigation.floorId,
        x: investigation.x, y: investigation.y } };
  } else {
    behaviorState = { ...behaviorState, goal: null };
  }
  const target = behaviorState.goal?.type === 'actor'
    ? actorById(input.state, behaviorState.goal.targetActorId) : undefined;
  const adjacent = target !== undefined && Math.max(Math.abs(target.x - actor.x), Math.abs(target.y - actor.y)) === 1;
  const intent = adjacent ? 'attack' : behaviorState.goal === null ? 'hold' : 'approach';
  const updatedIntent = updatePopulationIntent({
    eventId: input.eventId, actorId: actor.actorId, state: behaviorState, intent,
    targetCategory: behaviorState.goal?.type === 'actor'
      ? (behaviorState.goal.targetActorId === input.state.hero.actorId ? 'hero' : null)
      : behaviorState.goal === null ? null : 'position',
  });
  const updated = { ...actor, awareActorIds, behaviorState: updatedIntent.state };
  return {
    state: withActor(input.state, updated),
    events: updatedIntent.event ? [updatedIntent.event] : [],
  };
}

function observeEncounters(state: ActiveRun, content: CompiledContentPack): ActiveRun {
  if (state.encounterDecisions.length === 0 || state.populations.length === 0) return state;
  const hero = heroActor(state);
  const floor = state.floors.find((candidate) => candidate.floorId === hero.floorId);
  if (!floor) throw new Error(`internal invariant: active floor ${hero.floorId} is missing`);
  const positions = new Map<string, Readonly<Point>>(floor.entities.map((entity) => [entity.entityId, entity] as const));
  for (const actor of state.actors) if (actor.floorId === floor.floorId) positions.set(actor.actorId, actor);
  const perception = refreshKnowledge({
    floor: { ...floor, tiles: featureTiles(state, floor.floorId) }, hero: heroPerception(state.hero, hero), actors: positions,
    additionalLights: itemLightSources({ run: state, content, floorId: floor.floorId }),
  });
  let decisions = state.encounterDecisions;
  for (const population of [...state.populations].sort((left, right) => compareCodeUnits(left.populationId, right.populationId))) {
    if (population.floorId !== floor.floorId) continue;
    const visible = population.livingMemberIds.some((actorId) => {
      const member = actorById(state, actorId);
      const index = member ? tileIndex(floor, member.x, member.y) : undefined;
      return index !== undefined && ((perception.visibilityWords[Math.floor(index / 32)]! >>> (index % 32)) & 1) === 1
        && perception.illumination.intensity[index]! > 0;
    });
    if (visible && !decisions.find((decision) => decision.encounterId === population.encounterId)?.encountered) {
      decisions = markEncounterObserved(decisions, population.encounterId);
    }
  }
  return decisions === state.encounterDecisions ? state : { ...state, encounterDecisions: decisions };
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
  state = observeEncounters(state, input.content);
  appendEvents(events, publicEvents, resolved.events, state, heroId, input.content);
  const actedHero = actorById(state, heroId);
  if (actedHero) state = withActor(state, completeNormalActorTurn(actedHero));
  const limit = input.maxInternalActions ?? 10_000;
  let internalActions = 0;
  while ((actorById(state, heroId)?.health ?? 0) > 0) {
    let selected = selectReadyActor(state.actors, input.content, state.activeFloorId);
    if (!selected) {
      const previousWorldTime = state.worldTime;
      const advanced = advanceToNextReady({ worldTime: state.worldTime, actors: state.actors,
        content: input.content, activeFloorId: state.activeFloorId });
      state = { ...state, worldTime: advanced.worldTime, actors: advanced.actors };
      const danger = state.actors.some((actor) => actor.actorId !== heroId && actor.health > 0
        && actor.awareActorIds.includes(heroId) && relationshipBetween(state, heroId, actor.actorId) === 'hostile');
      const survival = advanceSurvival({ state, content: input.content,
        elapsed: state.worldTime - previousWorldTime, eventId: input.eventId, danger });
      state = survival.state;
      appendEvents(events, publicEvents, survival.events, state, heroId, input.content);
      selected = selectReadyActor(state.actors, input.content, state.activeFloorId);
      if (!selected) break;
    }
    if (selected.actorId === heroId) break;
    if (internalActions >= limit) throw new Error(`internal action safety limit ${limit} exceeded`);
    internalActions += 1;
    const prepared = prepareIndividualTurn({ state, actorId: selected.actorId, content: input.content, eventId: input.eventId });
    state = prepared.state;
    appendEvents(events, publicEvents, [{
      type: 'actor.turn.started', eventId: input.eventId, actorId: selected.actorId,
    }], state, heroId, input.content);
    appendEvents(events, publicEvents, prepared.events, state, heroId, input.content);
    const action = chooseBehaviorAction({ state, actorId: selected.actorId, content: input.content });
    if (action.type === 'rest') throw new Error('internal invariant: non-player behavior selected rest');
    resolved = applyAction({ state, action, content: input.content, eventId: input.eventId });
    state = resolved.state;
    state = observeEncounters(state, input.content);
    appendEvents(events, publicEvents, resolved.events, state, heroId, input.content);
    const completed = actorById(state, selected.actorId);
    if (completed) state = withActor(state, completeNormalActorTurn(completed));
    appendEvents(events, publicEvents, [{
      type: 'actor.turn.completed', eventId: input.eventId, actorId: selected.actorId, actionType: action.type,
    }], state, heroId, input.content);
  }
  state = refreshHeroKnowledge(state, input.content);
  const passiveHero = heroActor(state);
  if (passiveHero.health === 0) return { state, events, publicEvents, internalActions };
  const passiveFloor = state.floors.find((candidate) => candidate.floorId === passiveHero.floorId)!;
  const passivePositions = new Map<string, Readonly<{ x: number; y: number }>>(
    passiveFloor.entities.map((entity) => [entity.entityId, entity] as const),
  );
  for (const actor of state.actors) if (actor.floorId === passiveFloor.floorId) passivePositions.set(actor.actorId, actor);
  const passivePerception = refreshKnowledge({
    floor: { ...passiveFloor, tiles: featureTiles(state, passiveFloor.floorId) },
    hero: heroPerception(state.hero, passiveHero), actors: passivePositions,
    additionalLights: itemLightSources({ run: state, content: input.content, floorId: passiveFloor.floorId }),
  });
  const passiveIndex = tileIndex(passiveFloor, passiveHero.x, passiveHero.y)!;
  const passive = applyPassiveDiscovery({ run: state, actorId: passiveHero.actorId,
    illumination: passivePerception.illumination.intensity[passiveIndex]!, eventId: input.eventId });
  state = passive.run;
  appendEvents(events, publicEvents, passive.events, state, heroId, input.content);
  if (passive.events.length > 0) state = refreshHeroKnowledge(state, input.content);
  return { state, events, publicEvents, internalActions };
}
