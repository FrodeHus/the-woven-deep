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
  if (action.type === 'toggle-light') {
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

function eventParticipants(event: DomainEvent): readonly OpaqueId[] {
  const ids: OpaqueId[] = [];
  if ('heroId' in event) ids.push(event.heroId);
  if ('actorId' in event) ids.push(event.actorId);
  if ('targetActorId' in event) ids.push(event.targetActorId);
  if ('sourceActorId' in event) ids.push(event.sourceActorId);
  if ('killerActorId' in event) ids.push(event.killerActorId);
  return ids;
}

function eventIsPublic(event: DomainEvent, state: ActiveRun, heroId: OpaqueId, content: CompiledContentPack): boolean {
  if (event.type === 'action.invalid') return true;
  if (event.type === 'identification.appearance-revealed' || event.type === 'item.identified') return true;
  if (event.type === 'fuel.warning' || event.type === 'item.light-extinguished') {
    const item = state.items.find((candidate) => candidate.itemId === event.itemId);
    if (item && (item.location.type === 'backpack' || item.location.type === 'equipped')
      && item.location.actorId === heroId) return true;
  }
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
  const perception = refreshKnowledge({ floor, hero: heroPerception(state.hero, hero), actors: positions,
    additionalLights: itemLightSources({ run: state, content, floorId: floor.floorId }) });
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
  content: CompiledContentPack,
): void {
  authoritative.push(...emitted);
  publicEvents.push(...emitted.filter((event) => eventIsPublic(event, state, heroId, content)));
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
    floor, hero: heroPerception(state.hero, hero), actors: positions,
    additionalLights: itemLightSources({ run: state, content, floorId: floor.floorId }),
  }).knowledge;
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
  appendEvents(events, publicEvents, resolved.events, state, heroId, input.content);
  const actedHero = actorById(state, heroId);
  if (actedHero) state = withActor(state, completeNormalActorTurn(actedHero));
  const limit = input.maxInternalActions ?? 10_000;
  let internalActions = 0;
  while ((actorById(state, heroId)?.health ?? 0) > 0) {
    let selected = selectReadyActor(state.actors, input.content);
    if (!selected) {
      const previousWorldTime = state.worldTime;
      const advanced = advanceToNextReady({ worldTime: state.worldTime, actors: state.actors, content: input.content });
      state = { ...state, worldTime: advanced.worldTime, actors: advanced.actors };
      const danger = state.actors.some((actor) => actor.actorId !== heroId && actor.health > 0
        && actor.awareActorIds.includes(heroId) && relationshipBetween(state, heroId, actor.actorId) === 'hostile');
      const survival = advanceSurvival({ state, content: input.content,
        elapsed: state.worldTime - previousWorldTime, eventId: input.eventId, danger });
      state = survival.state;
      appendEvents(events, publicEvents, survival.events, state, heroId, input.content);
      selected = selectReadyActor(state.actors, input.content);
      if (!selected) break;
    }
    if (selected.actorId === heroId) break;
    if (internalActions >= limit) throw new Error(`internal action safety limit ${limit} exceeded`);
    internalActions += 1;
    appendEvents(events, publicEvents, [{
      type: 'actor.turn.started', eventId: input.eventId, actorId: selected.actorId,
    }], state, heroId, input.content);
    const action = chooseBehaviorAction({ state, actorId: selected.actorId, content: input.content });
    resolved = applyAction({ state, action, content: input.content, eventId: input.eventId });
    state = resolved.state;
    appendEvents(events, publicEvents, resolved.events, state, heroId, input.content);
    const completed = actorById(state, selected.actorId);
    if (completed) state = withActor(state, completeNormalActorTurn(completed));
    appendEvents(events, publicEvents, [{
      type: 'actor.turn.completed', eventId: input.eventId, actorId: selected.actorId, actionType: action.type,
    }], state, heroId, input.content);
  }
  state = refreshHeroKnowledge(state, input.content);
  return { state, events, publicEvents };
}
