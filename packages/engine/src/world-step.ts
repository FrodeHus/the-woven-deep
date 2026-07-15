import type { CompiledContentPack, MonsterContentEntry, NpcContentEntry } from '@woven-deep/content';
import { type GameAction, balanceEntry } from './actions.js';
import { actorById, heroActor, heroPerception, type ActorState } from './actor-model.js';
import { deriveActorStats } from './attributes.js';
import { chooseBehaviorAction, selectPatrolGoal } from './behavior.js';
import { ensureFactionReputation } from './commerce.js';
import { applyPopulationCombatModifiers, resolveAttack } from './combat.js';
import { conditionModifiers } from './conditions.js';
import { resolveEffectSequence } from './effects.js';
import { consumeItemQuantity, dropItem, pickupItem, splitStack } from './inventory.js';
import {
  equipItem, equipmentModifiers, itemLightSources, refuelItem, toggleItemLight, unequipItem,
} from './equipment.js';
import { identifyAppearance } from './identification.js';
import { advanceSurvival, hungerModifiers } from './survival.js';
import { applyPassiveDiscovery, closeDoor, disarmTrap, featureTiles, openDoor, searchFeatures, triggerTrap } from './features.js';
import {
  tileIndex, type ActiveRun, type Direction, type DomainEvent, type OpaqueId, type Point, type PublicEvent, type Uint32State,
} from './model.js';
import { movementAction } from './movement.js';
import { refreshKnowledge } from './perception.js';
import { markEncounterObserved } from './population-gates.js';
import { updatePopulationIntent } from './population-intent.js';
import { updateActorMemory, visibleTargetObservations } from './population-perception.js';
import { applyGroupLeaderOutcomes, coordinateGroups, groupCombatModifiers } from './group-behavior.js';
import { advanceSwarms, resolveSwarmSpawnAction, swarmCombatModifiers, swarmSpawnAction } from './swarm-behavior.js';
import { advanceBosses, bossCombatModifiers } from './boss-behavior.js';
import { advanceFallenHeroEncounters, fallenHeroCombatModifiers } from './champion.js';
import { projectDomainEvents } from './event-projection.js';
import {
  completeNormalActorTurn, relationshipBetween, resolveOpportunityAttacks, setRelationship,
  type ReactionAttackResult,
} from './reactions.js';
import { advanceMerchantLifecycle, scrubDepartedIntentEvents } from './merchant-lifecycle.js';
import {
  MERCHANT_BEHAVIOR_ID, prepareMerchantTurn, provokeMerchant, resolveMerchantCombatOutcomes,
} from './merchant-behavior.js';
import type { MerchantPopulation } from './merchant-model.js';
import { advanceToNextReady, chargeActionEnergy, selectReadyActor } from './scheduler.js';
import { compareCodeUnits } from './stable-json.js';

export interface WorldStepResult {
  readonly state: ActiveRun;
  readonly events: readonly DomainEvent[];
  readonly publicEvents: readonly PublicEvent[];
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

function npcDefinition(content: CompiledContentPack, actor: ActorState): NpcContentEntry | undefined {
  const entry = content.entries.find((candidate) => candidate.id === actor.contentId);
  return entry?.kind === 'npc' ? entry : undefined;
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
  populations: ActiveRun['populations'] = [],
  fallenHeroStandings: ActiveRun['fallenHeroStandings'] = [],
  worldTime = 0,
): CombatProfile {
  const monster = monsterDefinition(content, actor);
  const groupModifiers = groupCombatModifiers({ state: { actors, populations, worldTime }, content, actorId: actor.actorId });
  const swarmModifiers = swarmCombatModifiers({ state: { actors, populations, worldTime }, content, actorId: actor.actorId });
  const bossModifiers = bossCombatModifiers({ state: { actors, populations }, content, actorId: actor.actorId });
  const fallenModifiers = fallenHeroCombatModifiers({ state: { actors, populations,
    fallenHeroStandings }, content, actorId: actor.actorId });
  const populationModifiers = { accuracy: groupModifiers.accuracy + swarmModifiers.accuracy
    + bossModifiers.accuracy + fallenModifiers.accuracy,
    defense: groupModifiers.defense + swarmModifiers.defense + bossModifiers.defense + fallenModifiers.defense,
    damage: groupModifiers.damage + swarmModifiers.damage + bossModifiers.damage + fallenModifiers.damage };
  const npc = monster === undefined ? npcDefinition(content, actor) : undefined;
  if (npc) return applyPopulationCombatModifiers({
    accuracy: npc.accuracy,
    defense: npc.defense,
    damage: npc.damage,
    armor: npc.armor,
    resistance: npc.resistances.physical,
    immune: npc.resistances.physical === 100,
  }, populationModifiers);
  if (monster) return applyPopulationCombatModifiers({
    accuracy: monster.accuracy,
    defense: monster.defense,
    damage: monster.damage,
    armor: monster.armor,
    resistance: monster.resistances.physical,
    immune: monster.resistances.physical === 100,
  }, populationModifiers);
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
  return applyPopulationCombatModifiers({
    accuracy: stats.meleeAccuracy,
    defense: stats.defense,
    damage,
    armor,
    resistance: 0,
    immune: false,
  }, populationModifiers);
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
  populations: ActiveRun['populations'];
  fallenHeroStandings: ActiveRun['fallenHeroStandings'];
  worldTime: number;
}>): ReactionAttackResult {
  const attacker = input.actors.find((candidate) => candidate.actorId === input.attackerId);
  const target = input.actors.find((candidate) => candidate.actorId === input.targetActorId);
  if (!attacker || !target) throw new Error('internal invariant: combat actors must exist');
  const attack = profile(attacker, input.content, input.items, input.actors, input.survival,
    input.populations, input.fallenHeroStandings, input.worldTime);
  const defense = profile(target, input.content, input.items, input.actors, input.survival,
    input.populations, input.fallenHeroStandings, input.worldTime);
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

function movementDirection(from: Point, to: Point): Direction | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) return null;
  const directions: Readonly<Record<string, Direction>> = {
    '-1:-1': 'northwest', '0:-1': 'north', '1:-1': 'northeast',
    '-1:0': 'west', '1:0': 'east',
    '-1:1': 'southwest', '0:1': 'south', '1:1': 'southeast',
  };
  return directions[`${dx}:${dy}`] ?? null;
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
  if (action.type === 'swarm-spawn') {
    return resolveSwarmSpawnAction({ state, content: input.content, sourceActorId: actor.actorId, eventId: input.eventId });
  } else if (action.type === 'search') {
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
    const modifiers = groupCombatModifiers({ state, content: input.content, actorId: actor.actorId });
    const ranged = applyPopulationCombatModifiers({ accuracy: attackerStats.rangedAccuracy, defense: 0,
      damage: definition.combat.damage }, modifiers);
    const defense = profile(target, input.content, state.items, state.actors, state.survival,
      state.populations, state.fallenHeroStandings, state.worldTime);
    const shot = resolveAttack({
      eventId: input.eventId, attackerId: actor.actorId, targetActorId: target.actorId,
      actors: state.actors, combatState: state.rng.combat,
      accuracy: ranged.accuracy,
      defense: defense.defense, damage: ranged.damage, armor: defense.armor,
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
      resolveAttack: (attack) => combat({ ...attack, content: input.content, items: state.items,
        survival: state.survival, populations: state.populations,
        fallenHeroStandings: state.fallenHeroStandings, worldTime: state.worldTime }),
    });
    state = reactions.state;
    events.push(...reactions.events);
    if (reactions.movementAllowed) {
      const current = actorById(state, actor.actorId);
      const floor = current && state.floors.find((candidate) => candidate.floorId === current.floorId);
      const direction = current ? movementDirection(current, action.to) : null;
      const validated = current && floor && direction ? movementAction({
        actor: current, floor, actors: state.actors, features: state.features,
        relationships: state.relationships, direction, cost: action.cost,
      }) : null;
      if (validated?.status === 'move' && validated.to.x === action.to.x && validated.to.y === action.to.y) {
        state = moveActor(state, actor.actorId, validated.to);
        events.push(actor.playerControlled
          ? { type: 'hero.moved', eventId: input.eventId, heroId: actor.actorId,
            from: { x: actor.x, y: actor.y }, to: validated.to }
          : { type: 'actor.moved', eventId: input.eventId, actorId: actor.actorId,
            from: { x: actor.x, y: actor.y }, to: validated.to });
        const trap = state.features.find((feature) => feature.type === 'trap' && feature.state === 'armed'
          && feature.floorId === actor.floorId && feature.x === validated.to.x && feature.y === validated.to.y);
        if (trap) {
          const triggered = triggerTrap({ run: state, content: input.content, actorId: actor.actorId,
            featureId: trap.featureId, eventId: input.eventId });
          state = triggered.run; events.push(...triggered.events);
        }
      }
    }
  } else if (action.type === 'wait') {
    if (actor.playerControlled) events.push({
      type: 'hero.waited', eventId: input.eventId, heroId: actor.actorId, x: actor.x, y: actor.y,
    });
  } else {
    // A hero's explicit adjacent attack on an unprovoked merchant provokes it before the
    // attack resolves: even a miss counts as deliberate aggression.
    if (actor.playerControlled) {
      const merchant = state.populations.find((candidate): candidate is MerchantPopulation =>
        candidate.model === 'merchant' && candidate.actorId === action.targetActorId
        && !candidate.provoked && candidate.lifecycle !== 'dead' && candidate.lifecycle !== 'departed');
      if (merchant) {
        const provoked = provokeMerchant({
          state, content: input.content, merchantPopulationId: merchant.populationId,
          sourceActorId: actor.actorId, eventId: input.eventId,
        });
        state = provoked.state;
        events.push(...provoked.events);
      }
    }
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
      items: state.items, survival: state.survival, populations: state.populations,
      fallenHeroStandings: state.fallenHeroStandings, worldTime: state.worldTime,
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
  authoritative: DomainEvent[], publicEvents: PublicEvent[], emitted: readonly DomainEvent[], state: ActiveRun, heroId: OpaqueId,
  content: CompiledContentPack,
): void {
  if (emitted.length === 0) return;
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
  if (actor.behaviorId === MERCHANT_BEHAVIOR_ID) {
    return prepareMerchantTurn({
      state: input.state, content: input.content, actorId: actor.actorId, eventId: input.eventId,
    });
  }
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
  const fleeing = actor.behaviorState.intent === 'flee' && actor.behaviorState.investigation !== null
    && (actor.behaviorState.investigation.expiresAt === null
      || actor.behaviorState.investigation.expiresAt > input.state.worldTime);
  const hostileObservation = hostileObservations[0];
  if (fleeing) {
    behaviorState = { ...behaviorState, intent: 'flee', goal: actor.behaviorState.goal,
      investigation: actor.behaviorState.investigation };
  } else if (hostileObservation) {
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
  } else if (actor.behaviorId === 'behavior.patrol') {
    behaviorState = { ...behaviorState, goal: selectPatrolGoal({
      state: input.state, actor, content: input.content,
    }) };
  } else if (behaviorState.goal?.type !== 'formation') {
    behaviorState = { ...behaviorState, goal: null };
  }
  const target = !fleeing && behaviorState.goal?.type === 'actor'
    ? actorById(input.state, behaviorState.goal.targetActorId) : undefined;
  const adjacent = target !== undefined && Math.max(Math.abs(target.x - actor.x), Math.abs(target.y - actor.y)) === 1;
  const spawning = !fleeing && !adjacent && swarmSpawnAction({ state: input.state, content: input.content,
    actorId: actor.actorId }) !== null;
  const intent = fleeing ? 'flee' : adjacent ? 'attack' : spawning ? 'spawn'
    : behaviorState.goal?.type === 'formation' ? 'regroup'
      : behaviorState.goal === null ? 'hold' : 'approach';
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
  if (state.populations.length === 0
    || (state.encounterDecisions.length === 0 && state.fallenHeroDecisions.length === 0)) return state;
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
  let fallenDecisions = state.fallenHeroDecisions;
  const observedMerchantFactionIds: OpaqueId[] = [];
  for (const population of [...state.populations].sort((left, right) => compareCodeUnits(left.populationId, right.populationId))) {
    if (population.floorId !== floor.floorId) continue;
    const visible = population.livingMemberIds.some((actorId) => {
      const member = actorById(state, actorId);
      const index = member ? tileIndex(floor, member.x, member.y) : undefined;
      return index !== undefined && ((perception.visibilityWords[Math.floor(index / 32)]! >>> (index % 32)) & 1) === 1
        && perception.illumination.intensity[index]! > 0;
    });
    if (visible && (population.model === 'champion' || population.model === 'echo')) {
      fallenDecisions = fallenDecisions.map((decision) => decision.hallRecordId === population.hallRecordId
        && !decision.encountered ? { ...decision, encountered: true } : decision);
    } else if (visible && !decisions.find((decision) => decision.encounterId === population.encounterId)?.encountered) {
      decisions = markEncounterObserved(decisions, population.encounterId);
      if (population.model === 'merchant') observedMerchantFactionIds.push(population.factionId);
    }
  }
  let observed = decisions === state.encounterDecisions && fallenDecisions === state.fallenHeroDecisions
    ? state : { ...state, encounterDecisions: decisions, fallenHeroDecisions: fallenDecisions };
  // First legitimate observation of a merchant materializes its faction's authored
  // starting reputation exactly once; later observations keep the earned value.
  for (const factionId of observedMerchantFactionIds) {
    const faction = content.entries.find((entry) => entry.id === factionId);
    if (!faction || faction.kind !== 'npc-faction') {
      throw new Error(`internal invariant: merchant faction ${factionId} does not exist`);
    }
    observed = ensureFactionReputation(observed, faction);
  }
  return observed;
}

function bossEncounteredEvents(before: ActiveRun, after: ActiveRun, eventId: OpaqueId): readonly DomainEvent[] {
  return after.encounterDecisions.flatMap((decision) => {
    const previous = before.encounterDecisions.find((candidate) => candidate.encounterId === decision.encounterId);
    if (previous?.encountered !== false || !decision.encountered) return [];
    const population = after.populations.find((candidate) => candidate.model === 'boss'
      && candidate.encounterId === decision.encounterId);
    return population?.model === 'boss' ? [{ type: 'boss.encountered' as const, eventId,
      populationId: population.populationId, actorId: population.actorId, encounterId: population.encounterId }] : [];
  });
}

function populationEncounteredEvents(
  before: ActiveRun, after: ActiveRun, eventId: OpaqueId, content: CompiledContentPack,
): readonly DomainEvent[] {
  const transitioned = after.encounterDecisions.filter((decision) => {
    const previous = before.encounterDecisions.find((candidate) => candidate.encounterId === decision.encounterId);
    return previous?.encountered === false && decision.encountered;
  });
  if (transitioned.length === 0) return [];
  const hero = heroActor(after);
  const floor = after.floors.find((candidate) => candidate.floorId === hero.floorId);
  if (!floor) throw new Error(`internal invariant: active floor ${hero.floorId} is missing`);
  const positions = new Map<string, Readonly<Point>>(floor.entities.map((entity) => [entity.entityId, entity] as const));
  for (const actor of after.actors) if (actor.floorId === floor.floorId) positions.set(actor.actorId, actor);
  const perception = refreshKnowledge({ floor: { ...floor, tiles: featureTiles(after, floor.floorId) },
    hero: heroPerception(after.hero, hero), actors: positions,
    additionalLights: itemLightSources({ run: after, content, floorId: floor.floorId }) });
  return transitioned.flatMap((decision) => {
    for (const population of after.populations.filter((candidate) => candidate.encounterId === decision.encounterId)
      .sort((left, right) => compareCodeUnits(left.populationId, right.populationId))) {
      for (const actorId of population.livingMemberIds) {
        const actor = actorById(after, actorId); const index = actor ? tileIndex(floor, actor.x, actor.y) : undefined;
        if (index !== undefined && ((perception.visibilityWords[Math.floor(index / 32)]! >>> (index % 32)) & 1) === 1
          && perception.illumination.intensity[index]! > 0) {
          return [{ type: 'population.encountered' as const, eventId, populationId: population.populationId,
            encounterId: population.encounterId, actorId }];
        }
      }
    }
    throw new Error(`internal invariant: encountered population ${decision.encounterId} has no visible member`);
  });
}

function fallenHeroEncounteredEvents(before: ActiveRun, after: ActiveRun, eventId: OpaqueId): readonly DomainEvent[] {
  const events: DomainEvent[] = [];
  for (const decision of after.fallenHeroDecisions) {
    const previous = before.fallenHeroDecisions.find((candidate) => candidate.hallRecordId === decision.hallRecordId);
    if (previous?.encountered !== false || !decision.encountered) continue;
    const population = after.populations.find((candidate) => (candidate.model === 'champion' || candidate.model === 'echo')
      && candidate.hallRecordId === decision.hallRecordId);
    if (population?.model === 'champion') events.push({ type: 'champion.encountered', eventId,
      populationId: population.populationId, actorId: population.actorId,
      hallRecordId: population.hallRecordId, rank: 1 });
    if (population?.model === 'echo') events.push({ type: 'echo.encountered', eventId,
      populationId: population.populationId, actorId: population.actorId,
      hallRecordId: population.hallRecordId, rank: population.rank });
  }
  return events;
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
  const publicEvents: PublicEvent[] = [];
  // Ranged/effect damage and deaths carry merchant consequences resolved from the action events.
  let merchantOutcome = resolveMerchantCombatOutcomes({
    state, content: input.content, events: resolved.events, eventId: input.eventId,
  });
  state = merchantOutcome.state;
  let bosses = advanceBosses({ state, content: input.content, eventId: input.eventId });
  state = bosses.state;
  let fallen = advanceFallenHeroEncounters({ state, content: input.content, eventId: input.eventId });
  state = fallen.state;
  let beforeObservation = state;
  state = observeEncounters(state, input.content);
  appendEvents(events, publicEvents, resolved.events, state, heroId, input.content);
  appendEvents(events, publicEvents, merchantOutcome.events, state, heroId, input.content);
  appendEvents(events, publicEvents, bosses.events, state, heroId, input.content);
  appendEvents(events, publicEvents, fallen.events, state, heroId, input.content);
  appendEvents(events, publicEvents, populationEncounteredEvents(beforeObservation, state, input.eventId, input.content), state, heroId, input.content);
  appendEvents(events, publicEvents, bossEncounteredEvents(beforeObservation, state, input.eventId), state, heroId, input.content);
  appendEvents(events, publicEvents, fallenHeroEncounteredEvents(beforeObservation, state, input.eventId), state, heroId, input.content);
  let groupOutcome = applyGroupLeaderOutcomes({ state, content: input.content, eventId: input.eventId });
  state = groupOutcome.state;
  appendEvents(events, publicEvents, groupOutcome.events, state, heroId, input.content);
  let coordinated = coordinateGroups({ state, content: input.content, eventId: input.eventId });
  state = coordinated.state;
  appendEvents(events, publicEvents, coordinated.events, state, heroId, input.content);
  let swarms = advanceSwarms({ state, content: input.content, eventId: input.eventId });
  state = swarms.state;
  appendEvents(events, publicEvents, swarms.events, state, heroId, input.content);
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
      swarms = advanceSwarms({ state, content: input.content, eventId: input.eventId });
      state = swarms.state;
      appendEvents(events, publicEvents, swarms.events, state, heroId, input.content);
      bosses = advanceBosses({ state, content: input.content, eventId: input.eventId });
      state = bosses.state;
      appendEvents(events, publicEvents, bosses.events, state, heroId, input.content);
      fallen = advanceFallenHeroEncounters({ state, content: input.content, eventId: input.eventId });
      state = fallen.state;
      appendEvents(events, publicEvents, fallen.events, state, heroId, input.content);
      selected = selectReadyActor(state.actors, input.content, state.activeFloorId);
      if (!selected) break;
    }
    if (selected.actorId === heroId) break;
    if (internalActions >= limit) throw new Error(`internal action safety limit ${limit} exceeded`);
    internalActions += 1;
    const prepared = prepareIndividualTurn({ state, actorId: selected.actorId, content: input.content, eventId: input.eventId });
    state = prepared.state;
    coordinated = coordinateGroups({ state, content: input.content, eventId: input.eventId });
    state = coordinated.state;
    appendEvents(events, publicEvents, [{
      type: 'actor.turn.started', eventId: input.eventId, actorId: selected.actorId,
    }], state, heroId, input.content);
    appendEvents(events, publicEvents, prepared.events, state, heroId, input.content);
    appendEvents(events, publicEvents, coordinated.events, state, heroId, input.content);
    const action = chooseBehaviorAction({ state, actorId: selected.actorId, content: input.content });
    if (action.type === 'rest') throw new Error('internal invariant: non-player behavior selected rest');
    resolved = applyAction({ state, action, content: input.content, eventId: input.eventId });
    state = resolved.state;
    merchantOutcome = resolveMerchantCombatOutcomes({
      state, content: input.content, events: resolved.events, eventId: input.eventId,
    });
    state = merchantOutcome.state;
    bosses = advanceBosses({ state, content: input.content, eventId: input.eventId });
    state = bosses.state;
    fallen = advanceFallenHeroEncounters({ state, content: input.content, eventId: input.eventId });
    state = fallen.state;
    beforeObservation = state;
    state = observeEncounters(state, input.content);
    appendEvents(events, publicEvents, resolved.events, state, heroId, input.content);
    appendEvents(events, publicEvents, merchantOutcome.events, state, heroId, input.content);
    appendEvents(events, publicEvents, bosses.events, state, heroId, input.content);
    appendEvents(events, publicEvents, fallen.events, state, heroId, input.content);
    appendEvents(events, publicEvents, populationEncounteredEvents(beforeObservation, state, input.eventId, input.content), state, heroId, input.content);
    appendEvents(events, publicEvents, bossEncounteredEvents(beforeObservation, state, input.eventId), state, heroId, input.content);
    appendEvents(events, publicEvents, fallenHeroEncounteredEvents(beforeObservation, state, input.eventId), state, heroId, input.content);
    groupOutcome = applyGroupLeaderOutcomes({ state, content: input.content, eventId: input.eventId });
    state = groupOutcome.state;
    appendEvents(events, publicEvents, groupOutcome.events, state, heroId, input.content);
    swarms = advanceSwarms({ state, content: input.content, eventId: input.eventId });
    state = swarms.state;
    appendEvents(events, publicEvents, swarms.events, state, heroId, input.content);
    const completed = actorById(state, selected.actorId);
    if (completed) state = withActor(state, completeNormalActorTurn(completed));
    appendEvents(events, publicEvents, [{
      type: 'actor.turn.completed', eventId: input.eventId, actorId: selected.actorId, actionType: action.type,
    }], state, heroId, input.content);
  }
  // Global merchant deadlines resolve at every world-time boundary — including merchants on
  // inactive floors, whose actors never take turns above.
  const lifecycle = advanceMerchantLifecycle({
    state, content: input.content, previousWorldTime: input.state.worldTime,
    nextWorldTime: state.worldTime, eventId: input.eventId,
  });
  state = lifecycle.state;
  // A merchant departing within this same command may already have emitted intent events into
  // the in-flight arrays; drop them before they are recorded, exactly as saved commands are
  // scrubbed, so the recorded command never carries a dangling actor reference.
  scrubDepartedIntentEvents({ events, publicEvents, departureEvents: lifecycle.events });
  appendEvents(events, publicEvents, lifecycle.events, state, heroId, input.content);
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
