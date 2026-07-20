import type { CompiledContentPack } from '@woven-deep/content';
import type { GameAction } from './actions.js';
import { actorById, heroPerception, withActor, type ActorState } from './actor-model.js';
import { applyPopulationCombatModifiers, resolveAttack } from './combat.js';
import { applyEffectResult, resolveEffectSequence } from './effects.js';
import { consumeItemQuantity, dropItem, pickupItem, splitStack } from './inventory.js';
import {
  equipItem,
  itemLightSources,
  refuelItem,
  toggleItemLight,
  unequipItem,
} from './equipment.js';
import { identifyAppearance } from './identification.js';
import { deriveRunActorStats } from './stats.js';
import {
  closeDoor,
  disarmTrap,
  featureTiles,
  openDoor,
  pickLock,
  searchFeatures,
  triggerTrap,
} from './features.js';
import {
  tileIndex,
  type ActiveRun,
  type Direction,
  type DomainEvent,
  type OpaqueId,
  type Point,
} from './model.js';
import { movementAction } from './movement.js';
import { refreshKnowledge } from './perception.js';
import { groupCombatModifiers } from './group-behavior.js';
import { resolveSwarmSpawnAction } from './swarm-behavior.js';
import { relationshipBetween, resolveOpportunityAttacks, setRelationship } from './reactions.js';
import { provokeMerchant } from './merchant-behavior.js';
import type { MerchantPopulation } from './merchant-model.js';
import { combat, profile } from './combat-profile.js';
import { requireItem } from './content-index.js';
import { chargeActionEnergy } from './scheduler.js';

function moveActor(state: ActiveRun, actorId: OpaqueId, to: Point): ActiveRun {
  return {
    ...state,
    actors: state.actors.map((actor) => (actor.actorId === actorId ? { ...actor, ...to } : actor)),
  };
}

function movementDirection(from: Point, to: Point): Direction | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) return null;
  const directions: Readonly<Record<string, Direction>> = {
    '-1:-1': 'northwest',
    '0:-1': 'north',
    '1:-1': 'northeast',
    '-1:0': 'west',
    '1:0': 'east',
    '-1:1': 'southwest',
    '0:1': 'south',
    '1:1': 'southeast',
  };
  return directions[`${dx}:${dy}`] ?? null;
}

interface ResolverContext<A extends GameAction> {
  readonly state: ActiveRun;
  readonly action: A;
  readonly actor: ActorState;
  readonly content: CompiledContentPack;
  readonly eventId: OpaqueId;
  readonly events: DomainEvent[];
}

interface ResolverResult {
  readonly state: ActiveRun;
  readonly chargeEnergy: boolean;
}

type ActionResolver<A extends GameAction> = (context: ResolverContext<A>) => ResolverResult;

type ActionDispatchRegistry = {
  [T in GameAction['type']]: ActionResolver<Extract<GameAction, { type: T }>>;
};

const resolveBumpAttack: ActionResolver<Extract<GameAction, { type: 'bump-attack' }>> = ({
  state,
  action,
  actor,
  content,
  eventId,
  events,
}) => {
  let next = state;
  // A hero's explicit adjacent attack on an unprovoked merchant provokes it before the
  // attack resolves: even a miss counts as deliberate aggression.
  if (actor.playerControlled) {
    const merchant = next.populations.find(
      (candidate): candidate is MerchantPopulation =>
        candidate.model === 'merchant' &&
        candidate.actorId === action.targetActorId &&
        !candidate.provoked &&
        candidate.lifecycle !== 'dead' &&
        candidate.lifecycle !== 'departed',
    );
    if (merchant) {
      const provoked = provokeMerchant({
        state: next,
        content,
        merchantPopulationId: merchant.populationId,
        sourceActorId: actor.actorId,
        eventId,
      });
      next = provoked.state;
      events.push(...provoked.events);
    }
  }
  if (relationshipBetween(next, actor.actorId, action.targetActorId) !== 'hostile') {
    next = setRelationship(next, actor.actorId, action.targetActorId, 'hostile');
    events.push({
      type: 'relationship.changed',
      eventId,
      actorId: actor.actorId,
      targetActorId: action.targetActorId,
      relationship: 'hostile',
    });
  }
  const resolved = combat({
    actors: next.actors,
    combatState: next.rng.combat,
    attackerId: actor.actorId,
    targetActorId: action.targetActorId,
    eventId,
    content,
    items: next.items,
    survival: next.survival,
    populations: next.populations,
    fallenHeroStandings: next.fallenHeroStandings,
    worldTime: next.worldTime,
    hero: next.hero,
  });
  next = { ...next, actors: resolved.actors, rng: { ...next.rng, combat: resolved.combatState } };
  events.push(...resolved.events);
  return { state: next, chargeEnergy: true };
};

const resolveDoor: ActionResolver<Extract<GameAction, { type: 'open-door' | 'close-door' }>> = ({
  state,
  action,
  actor,
  eventId,
  events,
}) => {
  const transition =
    action.type === 'open-door'
      ? openDoor({ run: state, actorId: actor.actorId, featureId: action.featureId })
      : closeDoor({ run: state, actorId: actor.actorId, featureId: action.featureId });
  if (!transition.ok)
    throw new Error(`internal invariant: validated door action failed with ${transition.reason}`);
  events.push({
    type: action.type === 'open-door' ? 'door.opened' : 'door.closed',
    eventId,
    actorId: actor.actorId,
    featureId: action.featureId,
  });
  return { state: transition.run, chargeEnergy: true };
};

const ACTION_DISPATCH: ActionDispatchRegistry = {
  rest: () => {
    throw new Error('internal invariant: rest must be expanded into world steps');
  },
  'swarm-spawn': ({ state, actor, content, eventId, events }) => {
    const result = resolveSwarmSpawnAction({
      state,
      content,
      sourceActorId: actor.actorId,
      eventId,
    });
    events.push(...result.events);
    return { state: result.state, chargeEnergy: false };
  },
  search: ({ state, actor, content, eventId, events }) => {
    const floor = state.floors.find((candidate) => candidate.floorId === actor.floorId)!;
    const positions = new Map(
      state.actors
        .filter((candidate) => candidate.floorId === floor.floorId)
        .map((candidate) => [candidate.actorId, candidate] as const),
    );
    const perception = refreshKnowledge({
      floor: { ...floor, tiles: featureTiles(state, floor.floorId) },
      hero: heroPerception(state.hero, actor),
      actors: positions,
      additionalLights: itemLightSources({ run: state, content, floorId: floor.floorId }),
    });
    const index = tileIndex(floor, actor.x, actor.y)!;
    const result = searchFeatures({
      run: state,
      actorId: actor.actorId,
      illumination: perception.illumination.intensity[index]!,
      eventId,
    });
    events.push(...result.events);
    return { state: result.run, chargeEnergy: true };
  },
  disarm: ({ state, action, actor, content, eventId, events }) => {
    const result = disarmTrap({
      run: state,
      content,
      actorId: actor.actorId,
      featureId: action.featureId,
      eventId,
    });
    events.push(...result.events);
    return { state: result.run, chargeEnergy: true };
  },
  'pick-lock': ({ state, action, actor, content, eventId, events }) => {
    const result = pickLock({
      run: state,
      content,
      actorId: actor.actorId,
      featureId: action.featureId,
      eventId,
    });
    events.push(...result.events);
    return { state: result.run, chargeEnergy: true };
  },
  'open-door': resolveDoor,
  'close-door': resolveDoor,
  'toggle-light': ({ state, action, actor, content, eventId, events }) => {
    const transition = toggleItemLight({
      run: state,
      content,
      actorId: actor.actorId,
      itemId: action.itemId,
      enabled: action.enabled,
    });
    if (!transition.ok)
      throw new Error(
        `internal invariant: validated light toggle failed with ${transition.reason}`,
      );
    events.push({
      type: 'item.light-toggled',
      eventId,
      actorId: actor.actorId,
      itemId: action.itemId,
      enabled: action.enabled,
    });
    return { state: transition.run, chargeEnergy: true };
  },
  refuel: ({ state, action, actor, content, eventId, events }) => {
    const transition = refuelItem({
      run: state,
      content,
      actorId: actor.actorId,
      itemId: action.itemId,
      fuelItemId: action.fuelItemId,
      quantity: action.quantity,
    });
    if (!transition.ok)
      throw new Error(`internal invariant: validated refuel failed with ${transition.reason}`);
    const next = transition.run;
    const target = next.items.find((item) => item.itemId === action.itemId)!;
    events.push({
      type: 'item.refueled',
      eventId,
      actorId: actor.actorId,
      itemId: action.itemId,
      fuelItemId: action.fuelItemId,
      quantity: transition.quantity!,
      fuel: target.fuel!,
    });
    return { state: next, chargeEnergy: true };
  },
  equip: ({ state, action, actor, content, eventId, events }) => {
    const transition = equipItem({
      run: state,
      content,
      actorId: actor.actorId,
      itemId: action.itemId,
      slot: action.slot,
    });
    if (!transition.ok)
      throw new Error(`internal invariant: validated equip failed with ${transition.reason}`);
    events.push({
      type: 'item.equipped',
      eventId,
      actorId: actor.actorId,
      itemId: action.itemId,
      slot: action.slot,
    });
    return { state: transition.run, chargeEnergy: true };
  },
  unequip: ({ state, action, actor, eventId, events }) => {
    const transition = unequipItem({ run: state, actorId: actor.actorId, slot: action.slot });
    if (!transition.ok)
      throw new Error(`internal invariant: validated unequip failed with ${transition.reason}`);
    events.push({
      type: 'item.unequipped',
      eventId,
      actorId: actor.actorId,
      itemId: action.itemId,
      slot: action.slot,
    });
    return { state: transition.run, chargeEnergy: true };
  },
  'use-item': ({ state, action, actor, content, eventId, events }) => {
    const source = state.items.find((item) => item.itemId === action.itemId);
    if (!source) throw new Error(`internal invariant: used item ${action.itemId} disappeared`);
    const definition = requireItem(content, source.contentId);
    const target = actorById(state, action.targetActorId);
    if (!target)
      throw new Error(`internal invariant: effect target ${action.targetActorId} disappeared`);
    events.push({
      type: 'item.used',
      eventId,
      actorId: actor.actorId,
      itemId: source.itemId,
      targetActorId: target.actorId,
    });
    const resolved = resolveEffectSequence({
      effects: definition.effects,
      actors: state.actors,
      items: state.items,
      content,
      sourceActorId: actor.actorId,
      sourceItemId: source.itemId,
      targetActorId: target.actorId,
      effectsState: state.rng.effects,
      worldTime: state.worldTime,
      eventId,
      survival: state.survival,
      survivalActorId: state.hero.actorId,
      forceMoveDirection:
        target.actorId === actor.actorId
          ? { x: 1, y: 0 }
          : {
              x: Math.sign(target.x - actor.x),
              y: Math.sign(target.y - actor.y),
            },
      operations: {},
    });
    let next = applyEffectResult(state, resolved);
    const consumedEvents = resolved.events.filter((event) => event.type === 'item.consumed');
    events.push(...resolved.events.filter((event) => event.type !== 'item.consumed'));
    if (definition.identification.mode === 'shuffled') {
      const identified = identifyAppearance({ run: next, contentId: definition.id, eventId });
      next = identified.state;
      events.push(...identified.events);
    }
    events.push(...consumedEvents);
    return { state: next, chargeEnergy: true };
  },
  fire: ({ state, action, actor, content, eventId, events }) => {
    const weapon = state.items.find((item) => item.itemId === action.weaponItemId);
    if (!weapon) throw new Error(`internal invariant: weapon ${action.weaponItemId} disappeared`);
    const definition = requireItem(content, weapon.contentId);
    if (!definition.combat?.damage)
      throw new Error(`internal invariant: weapon ${weapon.itemId} cannot fire`);
    const consumed = consumeItemQuantity({
      run: state,
      itemId: action.ammunitionItemId,
      quantity: 1,
    });
    if (!consumed.ok)
      throw new Error(`internal invariant: validated ammunition failed with ${consumed.reason}`);
    let next = consumed.run;
    events.push({
      type: 'item.consumed',
      eventId,
      actorId: actor.actorId,
      itemId: action.ammunitionItemId,
      quantity: 1,
    });
    const attackerStats = deriveRunActorStats({ state: next, content, actor });
    const target = actorById(next, action.targetActorId);
    if (!target) throw new Error(`internal invariant: target ${action.targetActorId} disappeared`);
    const modifiers = groupCombatModifiers({ state: next, content, actorId: actor.actorId });
    const ranged = applyPopulationCombatModifiers(
      { accuracy: attackerStats.rangedAccuracy, defense: 0, damage: definition.combat.damage },
      modifiers,
    );
    const defense = profile(
      target,
      content,
      next.items,
      next.actors,
      next.survival,
      next.populations,
      next.fallenHeroStandings,
      next.worldTime,
      next.hero,
    );
    const shot = resolveAttack({
      eventId,
      attackerId: actor.actorId,
      targetActorId: target.actorId,
      actors: next.actors,
      combatState: next.rng.combat,
      accuracy: ranged.accuracy,
      defense: defense.defense,
      damage: ranged.damage,
      armor: defense.armor,
      resistance: defense.resistance,
      immune: defense.immune,
      damageType: 'physical',
    });
    next = { ...next, actors: shot.actors, rng: { ...next.rng, combat: shot.combatState } };
    events.push(...shot.events);
    return { state: next, chargeEnergy: true };
  },
  'throw-item': ({ state, action, actor, content, eventId, events }) => {
    const source = state.items.find((item) => item.itemId === action.itemId);
    if (!source) throw new Error(`internal invariant: thrown item ${action.itemId} disappeared`);
    const definition = requireItem(content, source.contentId);
    if (definition.effects.some((effect) => effect.effectId === 'effect.item.consume')) {
      const target = state.actors.find(
        (candidate) =>
          candidate.floorId === actor.floorId &&
          candidate.health > 0 &&
          candidate.x === action.target.x &&
          candidate.y === action.target.y,
      );
      if (!target) throw new Error('internal invariant: thrown effect target disappeared');
      events.push({
        type: 'item.thrown',
        eventId,
        actorId: actor.actorId,
        itemId: source.itemId,
        quantity: action.quantity,
        to: action.target,
      });
      const resolved = resolveEffectSequence({
        effects: definition.effects,
        actors: state.actors,
        items: state.items,
        content,
        sourceActorId: actor.actorId,
        sourceItemId: source.itemId,
        targetActorId: target.actorId,
        effectsState: state.rng.effects,
        worldTime: state.worldTime,
        eventId,
        survival: state.survival,
        survivalActorId: state.hero.actorId,
        forceMoveDirection: { x: Math.sign(target.x - actor.x), y: Math.sign(target.y - actor.y) },
        operations: {},
      });
      const next = applyEffectResult(state, resolved);
      events.push(...resolved.events);
      return { state: next, chargeEnergy: true };
    }
    const partial = action.quantity < source.quantity;
    const transition = dropItem({
      run: state,
      actorId: actor.actorId,
      itemId: source.itemId,
      quantity: action.quantity,
      newItemId: action.newItemId,
    });
    if (!transition.ok)
      throw new Error(`internal invariant: validated throw failed with ${transition.reason}`);
    const thrownItemId = partial ? action.newItemId : source.itemId;
    const next = {
      ...transition.run,
      items: transition.items.map((item) =>
        item.itemId === thrownItemId
          ? {
              ...item,
              location: { type: 'floor' as const, floorId: actor.floorId, ...action.target },
            }
          : item,
      ),
    };
    events.push({
      type: 'item.thrown',
      eventId,
      actorId: actor.actorId,
      itemId: thrownItemId,
      quantity: action.quantity,
      to: action.target,
    });
    return { state: next, chargeEnergy: true };
  },
  pickup: ({ state, action, actor, content, eventId, events }) => {
    const transition = pickupItem({
      run: state,
      content,
      actorId: actor.actorId,
      itemId: action.itemId,
      quantity: action.quantity,
      newItemId: action.newItemId,
    });
    if (!transition.ok)
      throw new Error(`internal invariant: validated pickup failed with ${transition.reason}`);
    events.push({
      type: 'item.picked-up',
      eventId,
      actorId: actor.actorId,
      itemId: action.itemId,
      quantity: action.quantity,
    });
    return { state: transition.run, chargeEnergy: true };
  },
  drop: ({ state, action, actor, eventId, events }) => {
    const transition = dropItem({
      run: state,
      actorId: actor.actorId,
      itemId: action.itemId,
      quantity: action.quantity,
      newItemId: action.newItemId,
    });
    if (!transition.ok)
      throw new Error(`internal invariant: validated drop failed with ${transition.reason}`);
    events.push({
      type: 'item.dropped',
      eventId,
      actorId: actor.actorId,
      itemId: action.itemId,
      quantity: action.quantity,
    });
    return { state: transition.run, chargeEnergy: true };
  },
  'split-stack': ({ state, action, actor, content, eventId, events }) => {
    const transition = splitStack({
      run: state,
      content,
      actorId: actor.actorId,
      itemId: action.itemId,
      quantity: action.quantity,
      newItemId: action.newItemId,
    });
    if (!transition.ok)
      throw new Error(`internal invariant: validated split failed with ${transition.reason}`);
    events.push({
      type: 'item.stack-split',
      eventId,
      actorId: actor.actorId,
      itemId: action.itemId,
      newItemId: action.newItemId,
      quantity: action.quantity,
    });
    return { state: transition.run, chargeEnergy: true };
  },
  move: ({ state, action, actor, content, eventId, events }) => {
    let next = state;
    const reactions = resolveOpportunityAttacks({
      run: next,
      content,
      moverActorId: actor.actorId,
      from: { x: actor.x, y: actor.y },
      to: action.to,
      eventId,
      resolveAttack: (attack) =>
        combat({
          ...attack,
          content,
          items: next.items,
          survival: next.survival,
          populations: next.populations,
          fallenHeroStandings: next.fallenHeroStandings,
          worldTime: next.worldTime,
          hero: next.hero,
        }),
    });
    next = reactions.state;
    events.push(...reactions.events);
    if (reactions.movementAllowed) {
      const current = actorById(next, actor.actorId);
      const floor =
        current && next.floors.find((candidate) => candidate.floorId === current.floorId);
      const direction = current ? movementDirection(current, action.to) : null;
      const validated =
        current && floor && direction
          ? movementAction({
              actor: current,
              floor,
              actors: next.actors,
              features: next.features,
              relationships: next.relationships,
              direction,
              cost: action.cost,
            })
          : null;
      if (
        validated?.status === 'move' &&
        validated.to.x === action.to.x &&
        validated.to.y === action.to.y
      ) {
        next = moveActor(next, actor.actorId, validated.to);
        events.push(
          actor.playerControlled
            ? {
                type: 'hero.moved',
                eventId,
                heroId: actor.actorId,
                from: { x: actor.x, y: actor.y },
                to: validated.to,
              }
            : {
                type: 'actor.moved',
                eventId,
                actorId: actor.actorId,
                from: { x: actor.x, y: actor.y },
                to: validated.to,
              },
        );
        const trap = next.features.find(
          (feature) =>
            feature.type === 'trap' &&
            feature.state === 'armed' &&
            feature.floorId === actor.floorId &&
            feature.x === validated.to.x &&
            feature.y === validated.to.y,
        );
        if (trap) {
          const triggered = triggerTrap({
            run: next,
            content,
            actorId: actor.actorId,
            featureId: trap.featureId,
            eventId,
          });
          next = triggered.run;
          events.push(...triggered.events);
        }
      }
    }
    return { state: next, chargeEnergy: true };
  },
  wait: ({ state, actor, eventId, events }) => {
    if (actor.playerControlled)
      events.push({
        type: 'hero.waited',
        eventId,
        heroId: actor.actorId,
        x: actor.x,
        y: actor.y,
      });
    return { state, chargeEnergy: true };
  },
  'bump-attack': resolveBumpAttack,
};

export function isDispatchableActionType(type: GameAction['type']): boolean {
  return type in ACTION_DISPATCH;
}

export function applyAction(
  input: Readonly<{
    state: ActiveRun;
    action: GameAction;
    content: CompiledContentPack;
    eventId: OpaqueId;
  }>,
): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  const action = input.action;
  const actor = actorById(input.state, action.actorId);
  if (!actor) throw new Error(`internal invariant: actor ${action.actorId} does not exist`);
  const events: DomainEvent[] = [];
  // An action type with no registered resolver defaults to the bump-attack resolver: it is the
  // catch-all melee path for any adjacent attack action carrying a target actor id.
  const resolver = (ACTION_DISPATCH[action.type] ??
    resolveBumpAttack) as ActionResolver<GameAction>;
  const resolved = resolver({
    state: input.state,
    action,
    actor,
    content: input.content,
    eventId: input.eventId,
    events,
  });
  let state = resolved.state;
  if (resolved.chargeEnergy) {
    const acted = actorById(state, actor.actorId);
    if (!acted) throw new Error(`internal invariant: acting actor ${actor.actorId} disappeared`);
    state = withActor(state, chargeActionEnergy(acted, action.cost));
  }
  return { state, events };
}
