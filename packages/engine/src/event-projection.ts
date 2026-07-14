import type { CompiledContentPack, DamageType } from '@woven-deep/content';
import { heroActor, heroPerception } from './actor-model.js';
import { featureTiles } from './features.js';
import { itemLightSources } from './equipment.js';
import type { ActiveRun, DomainEvent, OpaqueId, Point, PopulationNoticePublicEvent, PublicEvent, SoundHeardEvent } from './model.js';
import { tileIndex } from './model.js';
import { refreshKnowledge } from './perception.js';
import { isVisible } from './visibility.js';

function participants(event: DomainEvent): readonly OpaqueId[] {
  const result: OpaqueId[] = [];
  if ('heroId' in event) result.push(event.heroId);
  if ('actorId' in event && event.actorId !== null) result.push(event.actorId);
  if ('targetActorId' in event && event.targetActorId !== null) result.push(event.targetActorId);
  if ('sourceActorId' in event) result.push(event.sourceActorId);
  if ('killerActorId' in event) result.push(event.killerActorId);
  return [...new Set(result)];
}

function direction(from: Point, to: Point): SoundHeardEvent['direction'] {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  const names = new Map<string, SoundHeardEvent['direction']>([
    ['0,-1', 'north'], ['1,-1', 'northeast'], ['1,0', 'east'], ['1,1', 'southeast'],
    ['0,1', 'south'], ['-1,1', 'southwest'], ['-1,0', 'west'], ['-1,-1', 'northwest'], ['0,0', 'here'],
  ]);
  return names.get(`${dx},${dy}`)!;
}

function sourcePoint(event: DomainEvent, state: ActiveRun): Point | undefined {
  if (event.type === 'actor.moved') return event.to;
  if ((event.type === 'door.opened' || event.type === 'door.closed') && 'featureId' in event) {
    return state.features.find((feature) => feature.featureId === event.featureId);
  }
  const sourceId = 'actorId' in event ? event.actorId
    : 'sourceActorId' in event ? event.sourceActorId : undefined;
  return sourceId === undefined ? undefined : state.actors.find((actor) => actor.actorId === sourceId);
}

function notice(
  event: Readonly<{ eventId: OpaqueId }>, category: PopulationNoticePublicEvent['category'],
  actorId: OpaqueId | null, presentation: string, displayName?: string,
): PopulationNoticePublicEvent {
  return { type: 'population.notice', eventId: event.eventId, category, actorId, presentation,
    ...(displayName === undefined ? {} : { displayName }) };
}

function directlyPublic(event: DomainEvent): event is Extract<PublicEvent, DomainEvent> {
  return event.type !== 'attack.hit' && event.type !== 'attack.missed'
    && event.type !== 'population.created' && event.type !== 'population.encountered'
    && event.type !== 'population.placement-skipped' && event.type !== 'group.awareness-shared'
    && event.type !== 'group.leader-created' && event.type !== 'group.leader-defeated'
    && event.type !== 'group.outcome-applied' && event.type !== 'swarm.members-created'
    && event.type !== 'swarm.cap-reached' && event.type !== 'swarm.source-destroyed'
    && event.type !== 'boss.encountered' && event.type !== 'boss.phase-changed'
    && event.type !== 'boss.recovered' && event.type !== 'boss.defeated' && event.type !== 'boss.reward-created'
    && event.type !== 'champion.encountered' && event.type !== 'champion.defeated'
    && event.type !== 'champion.heirloom-created' && event.type !== 'echo.encountered'
    && event.type !== 'echo.defeated' && event.type !== 'echo.loot-created';
}

function sound(event: DomainEvent, state: ActiveRun, hero: Point) {
  const point = sourcePoint(event, state);
  if (!point) return undefined;
  const distance = Math.max(Math.abs(point.x - hero.x), Math.abs(point.y - hero.y));
  if (distance > 12) return undefined;
  const category = event.type === 'actor.moved' ? 'movement' as const
    : event.type === 'door.opened' || event.type === 'door.closed' ? 'mechanism' as const : 'combat' as const;
  return { type: 'sound.heard' as const, category, direction: direction(hero, point),
    distanceBand: distance <= 3 ? 'near' as const : distance <= 7 ? 'medium' as const : 'far' as const };
}

export function projectDomainEvents(input: Readonly<{
  state: ActiveRun;
  content: CompiledContentPack;
  heroId: OpaqueId;
  events: readonly DomainEvent[];
}>): readonly PublicEvent[] {
  const hero = heroActor(input.state);
  if (hero.actorId !== input.heroId) throw new Error('public event hero must match the active hero');
  const floor = input.state.floors.find((candidate) => candidate.floorId === hero.floorId);
  if (!floor) throw new Error(`internal invariant: active floor ${hero.floorId} is missing`);
  const positions = new Map<string, Readonly<Point>>(floor.entities.map((entity) => [entity.entityId, entity] as const));
  for (const actor of input.state.actors) if (actor.floorId === floor.floorId) positions.set(actor.actorId, actor);
  const perception = refreshKnowledge({
    floor: { ...floor, tiles: featureTiles(input.state, floor.floorId) },
    hero: heroPerception(input.state.hero, hero), actors: positions,
    additionalLights: itemLightSources({ run: input.state, content: input.content, floorId: floor.floorId }),
  });
  const actorVisible = (actorId: OpaqueId): boolean => {
    if (actorId === hero.actorId) return true;
    const actor = input.state.actors.find((candidate) => candidate.actorId === actorId);
    if (!actor || actor.floorId !== floor.floorId) return false;
    const index = tileIndex(floor, actor.x, actor.y);
    return index !== undefined && isVisible(perception.visibilityWords, index)
      && perception.illumination.intensity[index]! > 0;
  };
  const pointVisible = (point: Point): boolean => {
    const index = tileIndex(floor, point.x, point.y);
    return index !== undefined && isVisible(perception.visibilityWords, index)
      && perception.illumination.intensity[index]! > 0;
  };
  const actorName = (actorId: OpaqueId): string | undefined => {
    const actor = input.state.actors.find((candidate) => candidate.actorId === actorId);
    if (!actor || !actorVisible(actorId)) return undefined;
    if (actor.populationPresentation?.name) return actor.populationPresentation.name;
    const definition = input.content.entries.find((entry) => entry.kind === 'monster' && entry.id === actor.contentId);
    return definition?.kind === 'monster' ? definition.name : undefined;
  };
  const output: PublicEvent[] = [];
  let pendingDamageType: DamageType = 'physical';
  for (const event of input.events) {
    if (event.type === 'population.placement-skipped' || event.type === 'group.awareness-shared') continue;
    if (event.type === 'population.created') {
      const visibleActor = event.actorIds.find(actorVisible);
      if (visibleActor) output.push(notice(event, 'created', visibleActor, 'population.created'));
      continue;
    }
    if (event.type === 'population.encountered') {
      if (actorVisible(event.actorId)) output.push(notice(event, 'encountered', event.actorId, 'population.encountered'));
      continue;
    }
    if (event.type === 'group.leader-created' || event.type === 'group.leader-defeated'
      || event.type === 'group.outcome-applied') {
      if (actorVisible(event.actorId)) output.push(notice(event,
        event.type === 'group.leader-created' ? 'leader-created'
          : event.type === 'group.leader-defeated' ? 'leader-defeated' : 'group-outcome',
        event.actorId, event.type === 'group.outcome-applied' ? `leader-response.${event.response}` : event.type));
      continue;
    }
    if (event.type === 'swarm.members-created' || event.type === 'swarm.cap-reached'
      || event.type === 'swarm.source-destroyed') {
      if (actorVisible(event.sourceActorId)) output.push(notice(event,
        event.type === 'swarm.members-created' ? 'swarm-growth'
          : event.type === 'swarm.cap-reached' ? 'swarm-cap' : 'source-destroyed',
        event.sourceActorId, event.type === 'swarm.cap-reached' ? 'swarm.growth-contained'
          : event.type === 'swarm.source-destroyed' ? `swarm.source-${event.response}` : 'swarm.growth'));
      else if (event.type === 'swarm.source-destroyed') {
        const heard = sound(event, input.state, hero); if (heard) output.push(heard);
      }
      continue;
    }
    if (event.type === 'boss.encountered' || event.type === 'boss.phase-changed'
      || event.type === 'boss.recovered' || event.type === 'boss.defeated' || event.type === 'boss.reward-created') {
      if (actorVisible(event.actorId)) output.push(notice(event,
        event.type === 'boss.encountered' ? 'boss-encountered'
          : event.type === 'boss.phase-changed' ? 'boss-phase'
            : event.type === 'boss.recovered' ? 'boss-recovery'
              : event.type === 'boss.defeated' ? 'boss-defeated' : 'boss-reward',
        event.actorId, event.type === 'boss.phase-changed' ? `boss.phase.${event.phaseId}` : event.type,
        actorName(event.actorId)));
      else if (event.type === 'boss.phase-changed' || event.type === 'boss.defeated') {
        const heard = sound(event, input.state, hero); if (heard) output.push(heard);
      }
      continue;
    }
    if (event.type === 'champion.encountered' || event.type === 'champion.defeated'
      || event.type === 'champion.heirloom-created' || event.type === 'echo.encountered'
      || event.type === 'echo.defeated' || event.type === 'echo.loot-created') {
      if (actorVisible(event.actorId)) output.push(notice(event,
        event.type === 'champion.encountered' ? 'champion-encountered'
          : event.type === 'champion.defeated' ? 'champion-defeated'
            : event.type === 'champion.heirloom-created' ? 'champion-heirloom'
              : event.type === 'echo.encountered' ? 'echo-encountered'
                : event.type === 'echo.defeated' ? 'echo-defeated' : 'echo-loot',
        event.actorId, event.type, event.type === 'champion.heirloom-created' ? event.displayName : actorName(event.actorId)));
      continue;
    }
    if (event.type === 'fuel.warning' || event.type === 'item.light-extinguished' || event.type === 'item.identified') {
      const item = input.state.items.find((candidate) => candidate.itemId === event.itemId);
      if (!item || item.location.type === 'floor' || item.location.actorId !== hero.actorId) continue;
      output.push(event);
      continue;
    }
    const ids = participants(event);
    const allVisible = ids.every(actorVisible);
    if ((event.type === 'attack.hit' || event.type === 'attack.missed') && allVisible) {
      const attackerName = actorName(event.actorId);
      const targetName = actorName(event.targetActorId);
      output.push({ type: 'combat.observed', eventId: event.eventId,
        outcome: event.type === 'attack.hit' ? 'hit' : 'missed', attackerActorId: event.actorId,
        targetActorId: event.targetActorId,
        ...(attackerName === undefined ? {} : { attackerName }),
        ...(targetName === undefined ? {} : { targetName }) });
      continue;
    }
    if ((event.type === 'attack.hit' || event.type === 'attack.missed') && event.targetActorId === hero.actorId
      && !actorVisible(event.actorId)) {
      if (event.type === 'attack.hit') pendingDamageType = event.damageType;
      const heard = sound(event, input.state, hero);
      if (heard) output.push(heard);
      continue;
    }
    if (event.type === 'actor.damaged' && event.actorId === hero.actorId && !actorVisible(event.sourceActorId)) {
      output.push({ type: 'hero.damaged', amount: event.amount, damageType: pendingDamageType });
      pendingDamageType = 'physical';
      continue;
    }
    if (event.type === 'actor.moved' && (pointVisible(event.from) || pointVisible(event.to))) {
      if (pointVisible(event.from) && pointVisible(event.to)) output.push(event);
      else output.push({ type: 'actor.movement-observed', eventId: event.eventId, actorId: event.actorId,
        direction: direction(event.from, event.to) as Exclude<SoundHeardEvent['direction'], 'here'>,
        visibility: pointVisible(event.to) ? 'entered' : 'left' });
      continue;
    }
    if (allVisible && directlyPublic(event)) { output.push(event); continue; }
    if (event.type === 'actor.moved' || event.type === 'door.opened' || event.type === 'door.closed') {
      const heard = sound(event, input.state, hero);
      if (heard) output.push(heard);
    }
  }
  return output;
}
