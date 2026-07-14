import type { CompiledContentPack, DamageType } from '@woven-deep/content';
import { heroActor, heroPerception } from './actor-model.js';
import { featureTiles } from './features.js';
import { itemLightSources } from './equipment.js';
import type { ActiveRun, DomainEvent, OpaqueId, Point, SoundHeardEvent } from './model.js';
import { tileIndex } from './model.js';
import { refreshKnowledge } from './perception.js';
import { isVisible } from './visibility.js';

function participants(event: DomainEvent): readonly OpaqueId[] {
  const result: OpaqueId[] = [];
  if ('heroId' in event) result.push(event.heroId);
  if ('actorId' in event) result.push(event.actorId);
  if ('targetActorId' in event) result.push(event.targetActorId);
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
}>): readonly DomainEvent[] {
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
  const output: DomainEvent[] = [];
  let pendingDamageType: DamageType = 'physical';
  for (const event of input.events) {
    if (event.type === 'group.awareness-shared' || event.type === 'group.leader-defeated'
      || event.type === 'group.outcome-applied' || event.type === 'swarm.spawned'
      || event.type === 'swarm.cap-reached' || event.type === 'swarm.source-destroyed') continue;
    if (event.type === 'sound.heard' || event.type === 'hero.damaged') { output.push(event); continue; }
    if (event.type === 'fuel.warning' || event.type === 'item.light-extinguished' || event.type === 'item.identified') {
      const item = input.state.items.find((candidate) => candidate.itemId === event.itemId);
      if (!item || item.location.type === 'floor' || item.location.actorId !== hero.actorId) continue;
      output.push(event);
      continue;
    }
    const ids = participants(event);
    const allVisible = ids.every(actorVisible);
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
    if (allVisible) { output.push(event); continue; }
    if (event.type === 'actor.moved' || event.type === 'door.opened' || event.type === 'door.closed') {
      const heard = sound(event, input.state, hero);
      if (heard) output.push(heard);
    }
  }
  return output;
}
