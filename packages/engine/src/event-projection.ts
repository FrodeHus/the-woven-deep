import type { CompiledContentPack, DamageType } from '@woven-deep/content';
import { heroActor, heroPerception } from './actor-model.js';
import { featureTiles } from './features.js';
import { itemLightSources } from './equipment.js';
import type {
  ActiveRun,
  DomainEvent,
  OpaqueId,
  Point,
  PopulationNoticePublicEvent,
  PublicEvent,
  SoundHeardEvent,
} from './model.js';
import { tileIndex } from './model.js';
import { refreshKnowledge } from './perception.js';
import { isVisible } from './visibility.js';

function direction(from: Point, to: Point): SoundHeardEvent['direction'] {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  const names = new Map<string, SoundHeardEvent['direction']>([
    ['0,-1', 'north'],
    ['1,-1', 'northeast'],
    ['1,0', 'east'],
    ['1,1', 'southeast'],
    ['0,1', 'south'],
    ['-1,1', 'southwest'],
    ['-1,0', 'west'],
    ['-1,-1', 'northwest'],
    ['0,0', 'here'],
  ]);
  return names.get(`${dx},${dy}`)!;
}

function sourcePoint(event: DomainEvent, state: ActiveRun): Point | undefined {
  if (event.type === 'actor.moved') return event.to;
  if ((event.type === 'door.opened' || event.type === 'door.closed') && 'featureId' in event) {
    return state.features.find((feature) => feature.featureId === event.featureId);
  }
  const sourceId =
    'actorId' in event ? event.actorId : 'sourceActorId' in event ? event.sourceActorId : undefined;
  return sourceId === undefined
    ? undefined
    : state.actors.find((actor) => actor.actorId === sourceId);
}

function notice(
  event: Readonly<{ eventId: OpaqueId }>,
  category: PopulationNoticePublicEvent['category'],
  actorId: OpaqueId | null,
  presentation: string,
  displayName?: string,
): PopulationNoticePublicEvent {
  return {
    type: 'population.notice',
    eventId: event.eventId,
    category,
    actorId,
    presentation,
    ...(displayName === undefined ? {} : { displayName }),
  };
}

function sound(event: DomainEvent, state: ActiveRun, hero: Point) {
  const point = sourcePoint(event, state);
  if (!point) return undefined;
  const distance = Math.max(Math.abs(point.x - hero.x), Math.abs(point.y - hero.y));
  if (distance > 12) return undefined;
  const category =
    event.type === 'actor.moved'
      ? ('movement' as const)
      : event.type === 'door.opened' || event.type === 'door.closed'
        ? ('mechanism' as const)
        : ('combat' as const);
  return {
    type: 'sound.heard' as const,
    category,
    direction: direction(hero, point),
    distanceBand:
      distance <= 3 ? ('near' as const) : distance <= 7 ? ('medium' as const) : ('far' as const),
  };
}

export function projectDomainEvents(
  input: Readonly<{
    state: ActiveRun;
    content: CompiledContentPack;
    heroId: OpaqueId;
    events: readonly DomainEvent[];
  }>,
): readonly PublicEvent[] {
  const hero = heroActor(input.state);
  if (hero.actorId !== input.heroId)
    throw new Error('public event hero must match the active hero');
  const floor = input.state.floors.find((candidate) => candidate.floorId === hero.floorId);
  if (!floor) throw new Error(`internal invariant: active floor ${hero.floorId} is missing`);
  const positions = new Map<string, Readonly<Point>>(
    floor.entities.map((entity) => [entity.entityId, entity] as const),
  );
  for (const actor of input.state.actors)
    if (actor.floorId === floor.floorId) positions.set(actor.actorId, actor);
  const perception = refreshKnowledge({
    floor: { ...floor, tiles: featureTiles(input.state, floor.floorId) },
    hero: heroPerception(input.state.hero, hero),
    actors: positions,
    additionalLights: itemLightSources({
      run: input.state,
      content: input.content,
      floorId: floor.floorId,
    }),
  });
  const actorVisible = (actorId: OpaqueId): boolean => {
    if (actorId === hero.actorId) return true;
    const actor = input.state.actors.find((candidate) => candidate.actorId === actorId);
    if (!actor || actor.floorId !== floor.floorId) return false;
    const index = tileIndex(floor, actor.x, actor.y);
    return (
      index !== undefined &&
      isVisible(perception.visibilityWords, index) &&
      perception.illumination.intensity[index]! > 0
    );
  };
  const pointVisible = (point: Point): boolean => {
    const index = tileIndex(floor, point.x, point.y);
    return (
      index !== undefined &&
      isVisible(perception.visibilityWords, index) &&
      perception.illumination.intensity[index]! > 0
    );
  };
  const actorName = (actorId: OpaqueId): string | undefined => {
    const actor = input.state.actors.find((candidate) => candidate.actorId === actorId);
    if (!actor || !actorVisible(actorId)) return undefined;
    if (actor.populationPresentation?.name) return actor.populationPresentation.name;
    const definition = input.content.entries.find(
      (entry) => entry.kind === 'monster' && entry.id === actor.contentId,
    );
    return definition?.kind === 'monster' ? definition.name : undefined;
  };
  const itemVisible = (itemId: OpaqueId): boolean => {
    const item = input.state.items.find((candidate) => candidate.itemId === itemId);
    if (!item) return false;
    if (item.location.type === 'floor')
      return item.location.floorId === floor.floorId && pointVisible(item.location);
    if (item.location.type === 'merchant-stock' || item.location.type === 'house') return false;
    return actorVisible(item.location.actorId);
  };
  const featureVisible = (featureId: OpaqueId): boolean => {
    const feature = input.state.features.find((candidate) => candidate.featureId === featureId);
    return feature !== undefined && feature.floorId === floor.floorId && pointVisible(feature);
  };
  const movement = (
    event: Extract<DomainEvent, { type: 'actor.moved' | 'actor.forced-move' }>,
  ): void => {
    const fromVisible = pointVisible(event.from);
    const toVisible = pointVisible(event.to);
    if (fromVisible && toVisible) output.push(event);
    else if (fromVisible || toVisible)
      output.push({
        type: 'actor.movement-observed',
        eventId: event.eventId,
        actorId: event.actorId,
        direction: direction(event.from, event.to) as Exclude<SoundHeardEvent['direction'], 'here'>,
        visibility: toVisible ? 'entered' : 'left',
      });
    else {
      const heard = sound(event, input.state, hero);
      if (heard) output.push(heard);
    }
  };
  const output: PublicEvent[] = [];
  let pendingDamageType: DamageType = 'physical';
  for (const event of input.events) {
    switch (event.type) {
      case 'hero.moved':
      case 'hero.waited':
      case 'action.invalid':
      case 'rest.completed':
      case 'identification.appearance-revealed':
        output.push(event);
        break;
      case 'attack.hit':
      case 'attack.missed': {
        const attackerVisible = actorVisible(event.actorId);
        const targetVisible = actorVisible(event.targetActorId);
        if (attackerVisible && targetVisible) {
          const attackerName = actorName(event.actorId);
          const targetName = actorName(event.targetActorId);
          output.push({
            type: 'combat.observed',
            eventId: event.eventId,
            outcome: event.type === 'attack.hit' ? 'hit' : 'missed',
            attackerActorId: event.actorId,
            targetActorId: event.targetActorId,
            ...(attackerName ? { attackerName } : {}),
            ...(targetName ? { targetName } : {}),
          });
        } else if (event.targetActorId === hero.actorId) {
          if (event.type === 'attack.hit') pendingDamageType = event.damageType;
          const heard = sound(event, input.state, hero);
          if (heard) output.push(heard);
        }
        break;
      }
      case 'actor.damaged':
        if (event.actorId === hero.actorId && !actorVisible(event.sourceActorId)) {
          output.push({
            type: 'hero.damaged',
            amount: event.amount,
            damageType: pendingDamageType,
          });
          pendingDamageType = 'physical';
        } else if (actorVisible(event.actorId) && actorVisible(event.sourceActorId))
          output.push(event);
        else if (actorVisible(event.actorId))
          output.push({
            type: 'actor.damage-observed',
            eventId: event.eventId,
            actorId: event.actorId,
            amount: event.amount,
            health: event.health,
          });
        break;
      case 'actor.died':
        if (actorVisible(event.actorId) && actorVisible(event.killerActorId)) output.push(event);
        else if (actorVisible(event.actorId)) {
          const displayName = actorName(event.actorId);
          output.push({
            type: 'actor.death-observed',
            eventId: event.eventId,
            actorId: event.actorId,
            contentId: event.contentId,
            ...(displayName ? { displayName } : {}),
          });
        }
        break;
      case 'actor.healed':
        if (actorVisible(event.actorId) && actorVisible(event.sourceActorId)) output.push(event);
        break;
      case 'loot.dropped':
        if (actorVisible(event.actorId) && event.itemIds.every((itemId) => itemVisible(itemId)))
          output.push(event);
        break;
      case 'condition.applied':
        if (actorVisible(event.actorId) && actorVisible(event.sourceActorId)) output.push(event);
        break;
      case 'condition.removed':
      case 'condition.expired':
        if (actorVisible(event.actorId)) output.push(event);
        break;
      case 'actor.moved':
      case 'actor.forced-move':
        movement(event);
        break;
      case 'reaction.triggered':
      case 'relationship.changed':
        if (actorVisible(event.actorId) && actorVisible(event.targetActorId)) output.push(event);
        break;
      case 'actor.turn.started':
      case 'actor.turn.completed':
      case 'actor.intent-changed':
        if (actorVisible(event.actorId)) output.push(event);
        break;
      case 'item.picked-up':
      case 'item.dropped':
      case 'item.consumed':
      case 'item.thrown':
        if (
          actorVisible(event.actorId) &&
          (event.actorId === hero.actorId || itemVisible(event.itemId)) &&
          (event.type !== 'item.thrown' || pointVisible(event.to))
        )
          output.push(event);
        break;
      case 'item.stack-split':
        if (
          actorVisible(event.actorId) &&
          itemVisible(event.itemId) &&
          itemVisible(event.newItemId)
        )
          output.push(event);
        break;
      case 'item.used':
        if (
          actorVisible(event.actorId) &&
          actorVisible(event.targetActorId) &&
          (event.actorId === hero.actorId || itemVisible(event.itemId))
        )
          output.push(event);
        break;
      case 'spell.learned':
      case 'hero.recalled':
        output.push(event);
        break;
      case 'item.equipped':
      case 'item.unequipped':
      case 'item.light-toggled':
        if (actorVisible(event.actorId) && itemVisible(event.itemId)) output.push(event);
        break;
      case 'item.refueled':
        if (
          actorVisible(event.actorId) &&
          itemVisible(event.itemId) &&
          (event.actorId === hero.actorId || itemVisible(event.fuelItemId))
        )
          output.push(event);
        break;
      case 'item.identified':
      case 'fuel.warning':
      case 'item.light-extinguished':
        if (itemVisible(event.itemId)) output.push(event);
        break;
      case 'hunger.stage-changed':
      case 'hunger.restored':
        if (event.actorId === hero.actorId) output.push(event);
        break;
      case 'item.damaged':
        if (actorVisible(event.actorId) && itemVisible(event.itemId)) output.push(event);
        break;
      case 'door.opened':
      case 'door.closed':
        if (actorVisible(event.actorId) && featureVisible(event.featureId)) output.push(event);
        else {
          const heard = sound(event, input.state, hero);
          if (heard) output.push(heard);
        }
        break;
      case 'feature.revealed':
      case 'trap.triggered':
      case 'trap.disarmed':
      case 'trap.disarm-failed':
      case 'lock.picked':
      case 'lock.pick-failed':
      case 'door.unlocked':
      case 'chest.jammed':
        if (actorVisible(event.actorId) && featureVisible(event.featureId)) output.push(event);
        break;
      case 'feature.searched':
        if (actorVisible(event.actorId)) output.push(event);
        break;
      case 'reputation.changed':
        output.push(event);
        break;
      case 'run.concluded':
      case 'run.finalized':
      case 'achievement.granted':
        output.push(event);
        break;
      case 'trade.opened':
      case 'trade.bought':
      case 'trade.sold':
      case 'trade.service-purchased':
      case 'trade.closed':
        output.push(event);
        break;
      case 'merchant.departure-warning':
      case 'merchant.provoked':
      case 'merchant.stock-dropped':
      case 'merchant.died':
      case 'merchant.restocked': {
        // Merchant lifecycle transitions are observable only while the merchant itself is
        // legitimately visible, and even then only as a qualitative notice: exact remaining
        // time, dropped/destroyed stock identifiers, and killer identity stay hidden. The
        // hero's own trade auto-close and reputation change arrive separately as exact events.
        // A restock fires from the descend boundary while the hero is deep in the dungeon, so
        // it resolves to a notice only on the rare case the hero is standing in town to see it.
        if (!actorVisible(event.actorId)) break;
        const category =
          event.type === 'merchant.departure-warning'
            ? ('merchant-departure-warning' as const)
            : event.type === 'merchant.provoked'
              ? ('merchant-provoked' as const)
              : event.type === 'merchant.stock-dropped'
                ? ('merchant-stock-dropped' as const)
                : event.type === 'merchant.died'
                  ? ('merchant-died' as const)
                  : ('merchant-restocked' as const);
        const presentation =
          event.type === 'merchant.departure-warning'
            ? `merchant.departure-warning.${event.threshold}`
            : event.type === 'merchant.provoked'
              ? `merchant.provoked.${event.response}`
              : event.type;
        output.push(notice(event, category, event.actorId, presentation, actorName(event.actorId)));
        break;
      }
      case 'merchant.departed': {
        // The departed actor no longer exists, so visibility cannot be evaluated; the player is
        // told only that a previously encountered merchant left their current floor. Off-floor
        // departures and never-observed merchants resolve silently, without stock identifiers.
        const population = input.state.populations.find(
          (candidate) => candidate.populationId === event.populationId,
        );
        const decision =
          population === undefined
            ? undefined
            : input.state.encounterDecisions.find(
                (candidate) => candidate.encounterId === population.encounterId,
              );
        if (decision?.encountered && population?.floorId === floor.floorId) {
          output.push(notice(event, 'merchant-departed', null, 'merchant.departed'));
        }
        break;
      }
      case 'population.created': {
        const visibleActor = event.actorIds.find(actorVisible);
        if (visibleActor) output.push(notice(event, 'created', visibleActor, 'population.created'));
        break;
      }
      case 'population.encountered':
        if (actorVisible(event.actorId))
          output.push(notice(event, 'encountered', event.actorId, event.type));
        break;
      case 'population.placement-skipped':
      case 'group.awareness-shared':
        break;
      case 'group.leader-created':
      case 'group.leader-defeated':
      case 'group.outcome-applied':
        if (actorVisible(event.actorId))
          output.push(
            notice(
              event,
              event.type === 'group.leader-created'
                ? 'leader-created'
                : event.type === 'group.leader-defeated'
                  ? 'leader-defeated'
                  : 'group-outcome',
              event.actorId,
              event.type === 'group.outcome-applied'
                ? `leader-response.${event.response}`
                : event.type,
            ),
          );
        break;
      case 'swarm.members-created':
      case 'swarm.cap-reached':
      case 'swarm.source-destroyed':
        if (actorVisible(event.sourceActorId))
          output.push(
            notice(
              event,
              event.type === 'swarm.members-created'
                ? 'swarm-growth'
                : event.type === 'swarm.cap-reached'
                  ? 'swarm-cap'
                  : 'source-destroyed',
              event.sourceActorId,
              event.type === 'swarm.cap-reached'
                ? 'swarm.growth-contained'
                : event.type === 'swarm.source-destroyed'
                  ? `swarm.source-${event.response}`
                  : 'swarm.growth',
            ),
          );
        else if (event.type === 'swarm.source-destroyed') {
          const heard = sound(event, input.state, hero);
          if (heard) output.push(heard);
        }
        break;
      case 'boss.encountered':
      case 'boss.phase-changed':
      case 'boss.recovered':
      case 'boss.defeated':
      case 'boss.reward-created':
        if (actorVisible(event.actorId))
          output.push(
            notice(
              event,
              event.type === 'boss.encountered'
                ? 'boss-encountered'
                : event.type === 'boss.phase-changed'
                  ? 'boss-phase'
                  : event.type === 'boss.recovered'
                    ? 'boss-recovery'
                    : event.type === 'boss.defeated'
                      ? 'boss-defeated'
                      : 'boss-reward',
              event.actorId,
              event.type === 'boss.phase-changed' ? `boss.phase.${event.phaseId}` : event.type,
              actorName(event.actorId),
            ),
          );
        else if (event.type === 'boss.phase-changed' || event.type === 'boss.defeated') {
          const heard = sound(event, input.state, hero);
          if (heard) output.push(heard);
        }
        break;
      case 'champion.encountered':
      case 'champion.defeated':
      case 'champion.heirloom-created':
      case 'echo.encountered':
      case 'echo.defeated':
      case 'echo.loot-created':
        if (actorVisible(event.actorId))
          output.push(
            notice(
              event,
              event.type === 'champion.encountered'
                ? 'champion-encountered'
                : event.type === 'champion.defeated'
                  ? 'champion-defeated'
                  : event.type === 'champion.heirloom-created'
                    ? 'champion-heirloom'
                    : event.type === 'echo.encountered'
                      ? 'echo-encountered'
                      : event.type === 'echo.defeated'
                        ? 'echo-defeated'
                        : 'echo-loot',
              event.actorId,
              event.type,
              event.type === 'champion.heirloom-created'
                ? event.displayName
                : actorName(event.actorId),
            ),
          );
        break;
      default: {
        const exhaustive: never = event;
        return exhaustive;
      }
    }
  }
  return output;
}
