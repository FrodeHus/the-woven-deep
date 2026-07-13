import { describe, expect, it } from 'vitest';
import {
  closeDoor, createDemoRun, featureBlocksMovement, featureTiles, openDoor, refreshKnowledge,
  type DoorFeature, applyPassiveDiscovery, decodeActiveRun, encodeActiveRun, projectFeature,
  stableJson, triggerTrap, createDemoContentPack,
  resolveCommand,
} from '../src/index.js';
import type { TrapContentEntry } from '@woven-deep/content';

function door(state: DoorFeature['state'] = 'closed'): DoorFeature {
  return { featureId: 'door.1', type: 'door', floorId: 'floor.demo', x: 3, y: 2,
    contentId: null, coverTileId: 0, state };
}

describe('mutable dungeon features', () => {
  it('changes movement, sight, and light geometry when a door opens', () => {
    const base = createDemoRun();
    const hero = { ...base.actors[0]!, x: 2, y: 2 };
    const closed = door();
    const run = { ...base, actors: [hero], features: [closed] };
    expect(featureBlocksMovement(closed)).toBe(true);
    const opened = openDoor({ run, actorId: hero.actorId, featureId: closed.featureId });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(featureBlocksMovement(opened.run.features[0]!)).toBe(false);
    const floor = opened.run.floors[0]!;
    const perception = refreshKnowledge({ floor: { ...floor, tiles: featureTiles(opened.run, floor.floorId) },
      hero: { heroId: hero.actorId, x: hero.x, y: hero.y, sightRadius: 12 },
      actors: new Map([[hero.actorId, hero]]) });
    expect(perception.illumination.intensity[2 * floor.width + 4]).toBeGreaterThan(0);
    expect((perception.visibilityWords[0]! >>> (2 * floor.width + 4)) & 1).toBe(1);
  });

  it('refuses to close an occupied doorway without changing the run', () => {
    const base = createDemoRun();
    const hero = { ...base.actors[0]!, x: 2, y: 2 };
    const occupant = { ...hero, actorId: 'monster.occupant', contentId: 'monster.occupant',
      playerControlled: false, x: 3, y: 2, disposition: 'hostile' as const };
    const run = { ...base, actors: [hero, occupant], features: [door('open')] };
    expect(closeDoor({ run, actorId: hero.actorId, featureId: 'door.1' }))
      .toEqual({ ok: false, reason: 'door.occupied' });
  });

  it('applies an open-door command atomically and keeps the result saveable', () => {
    const base = createDemoRun();
    const hero = { ...base.actors[0]!, x: 2, y: 2 };
    const result = resolveCommand({ ...base, actors: [hero], features: [door()] }, {
      type: 'open-door', commandId: 'command.open-door', expectedRevision: 0, featureId: 'door.1',
    }, { content: createDemoContentPack() });
    expect(result.state.features[0]).toMatchObject({ state: 'open' });
    expect(result.events[0]).toMatchObject({ type: 'door.opened', featureId: 'door.1' });
    expect(() => encodeActiveRun(result.state)).not.toThrow();
  });

  it('searches through the timed command path and saves revealed geometry', () => {
    const base = createDemoRun();
    const feature = { featureId: 'secret.easy', type: 'secret' as const, floorId: 'floor.demo', x: 2, y: 1,
      contentId: null, coverTileId: 0 as const, state: 'hidden' as const, discoveryDifficulty: 1,
      discovery: { discoveredByActorIds: [], progressByActorId: {}, attemptedContextKeys: [] } };
    const result = resolveCommand({ ...base, features: [feature] }, {
      type: 'search', commandId: 'command.search', expectedRevision: 0,
    }, { content: createDemoContentPack() });
    expect(result.events.map((event) => event.type).slice(0, 2)).toEqual(['feature.searched', 'feature.revealed']);
    expect(result.state.features[0]).toMatchObject({ state: 'revealed' });
    expect(() => encodeActiveRun(result.state)).not.toThrow();
  });

  it('records one passive contribution per saved illumination context', () => {
    const base = createDemoRun();
    const feature = { featureId: 'secret.1', type: 'secret' as const, floorId: 'floor.demo', x: 2, y: 2,
      contentId: null, coverTileId: 0 as const, state: 'hidden' as const, discoveryDifficulty: 100,
      discovery: { discoveredByActorIds: [], progressByActorId: {}, attemptedContextKeys: [] } };
    const input = { run: { ...base, features: [feature] }, actorId: 'hero.demo', illumination: 128,
      eventId: 'event.passive' };
    const once = applyPassiveDiscovery(input);
    const loaded = decodeActiveRun(encodeActiveRun(once.run));
    expect(applyPassiveDiscovery({ ...input, run: once.run }).run.features).toEqual(once.run.features);
    expect(applyPassiveDiscovery({ ...input, run: loaded }).run).toEqual(loaded);
  });

  it('reveals a hidden trap before its triggered effects', () => {
    const definition: TrapContentEntry = { kind: 'trap', id: 'trap.dart', name: 'Dart trap', glyph: '^',
      color: '#ffffff', tags: [], targetingId: 'target.actor', discoveryDifficulty: 10, disarmDifficulty: 10,
      disarmOutcomes: { failure: 'safe', criticalFailure: 'trigger', toolDamage: 10 },
      resetMode: 'once', effects: [{ effectId: 'effect.damage', parameters: {
        damageType: 'physical', dice: { count: 1, sides: 1, bonus: 0 } }, requiresLivingTarget: true }] };
    const base = createDemoRun();
    const feature = { featureId: 'trap.1', type: 'trap' as const, floorId: 'floor.demo', x: 1, y: 1,
      contentId: definition.id, coverTileId: 1 as const, state: 'armed' as const, discoveryDifficulty: 10,
      discovery: { discoveredByActorIds: [], progressByActorId: {}, attemptedContextKeys: [] } };
    const content = { ...createDemoContentPack(), entries: [...createDemoContentPack().entries, definition] };
    const result = triggerTrap({ run: { ...base, features: [feature] }, content, actorId: 'hero.demo',
      featureId: feature.featureId, eventId: 'event.trigger' });
    expect(result.events.slice(0, 2).map((event) => event.type)).toEqual(['feature.revealed', 'trap.triggered']);
  });

  it('projects an undiscovered secret as cover terrain without its identifier', () => {
    const feature = { featureId: 'secret.1', type: 'secret' as const, floorId: 'floor.demo', x: 2, y: 2,
      contentId: null, coverTileId: 0 as const, state: 'hidden' as const, discoveryDifficulty: 10,
      discovery: { discoveredByActorIds: [], progressByActorId: {}, attemptedContextKeys: [] } };
    const json = stableJson(projectFeature(feature, 'hero.demo'));
    expect(json).toContain('tileId');
    expect(json).not.toContain('secret.1');
  });
});
