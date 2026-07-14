import { describe, expect, it } from 'vitest';
import type { CompiledContentPack, EncounterContentEntry, SwarmEncounterDefinition } from '@woven-deep/content';
import {
  advanceSwarms, chooseBehaviorAction, createDemoContentPack, createDemoRun, decodeActiveRun, encodeActiveRun,
  resolveSwarmSpawnAction,
  resolveWorldStep,
  swarmSpawnAction,
  validateContentBoundRun,
  type ActiveRun, type ActorState, type SwarmPopulation,
} from '../src/index.js';

const roleMonster = (id: string, glyph: string) => ({
  kind: 'monster' as const, id, name: id, tags: [], glyph, color: '#888888',
  attributes: { might: 3, agility: 3, vitality: 3, wits: 3, resolve: 3 }, health: 4,
  speed: 100, accuracy: 1, defense: 1, perception: 6, damage: { count: 1, sides: 2, bonus: 0 },
  armor: 0, resistances: { physical: 0, fire: 0, cold: 0, poison: 0, arcane: 0 },
  disposition: 'hostile' as const, behaviorId: 'behavior.approach-and-attack', behaviorParameters: {},
  minDepth: 1, maxDepth: 20, rarity: 'common' as const,
});

function definition(overrides: Partial<SwarmEncounterDefinition> = {}): SwarmEncounterDefinition {
  return { sourceMonsterId: 'monster.source', spawnRoles: [
    { roleId: 'a', monsterId: 'monster.child-a', weight: 1 },
    { roleId: 'b', monsterId: 'monster.child-b', weight: 2 },
  ], spawnInterval: 10, minimumSpawnQuantity: 2, maximumSpawnQuantity: 2,
  placementRadius: 2, allowedTerrainTags: ['floor'], maximumLivingChildren: 4,
  maximumLivingMembers: 5, maximumFloorActors: 8, sourceDestructionResponse: 'stop',
  responseParameters: {}, ...overrides };
}

function fixture(overrides: Partial<SwarmEncounterDefinition> = {}, active = true) {
  const base = createDemoRun();
  const hero = base.actors[0]!;
  const source: ActorState = { ...hero, actorId: 'actor.source', contentId: 'monster.source',
    playerControlled: false, x: 3, y: 3, health: 8, maxHealth: 8, disposition: 'hostile',
    behaviorId: 'behavior.approach-and-attack', populationId: 'population.swarm', populationRoleId: null,
    populationPresentation: { name: 'Source', glyph: 'S', color: '#ffffff', leader: false } };
  const def = definition(overrides);
  const encounter: EncounterContentEntry = { kind: 'encounter', id: 'encounter.swarm', name: 'Swarm',
    description: '', tags: [], adminDescription: null, model: 'swarm', minDepth: 1, maxDepth: 20,
    environmentTags: [], requiredVaultTags: [], weight: 1, rarity: 'common', runAppearanceChance: 1,
    discoveryProtectionIncrement: 0, discoveryProtectionCap: 1, maximumInstancesPerRun: 1,
    placement: { minimumStairDistance: 0, minimumObjectiveDistance: 0, maximumMemberDistance: 2,
      allowedTerrainTags: ['floor'], requiresVaultSlot: false, failureMode: 'optional' },
    intentPresentation: { visible: true }, definition: def };
  const content: CompiledContentPack = { ...createDemoContentPack(), entries: [
    ...createDemoContentPack().entries, { ...roleMonster('monster.source', 'S'), tags: ['swarm-source'], health: 8 },
    roleMonster('monster.child-a', 'a'), roleMonster('monster.child-b', 'b'), encounter,
  ] };
  const population: SwarmPopulation = { populationId: 'population.swarm', encounterId: encounter.id,
    model: 'swarm', floorId: hero.floorId, createdAt: 0, livingMemberIds: [source.actorId], formerMemberIds: [],
    sourceActorId: source.actorId, nextSpawnAt: 10, spawnedCount: 0, peakLivingSize: 1,
    shutdownState: null, emittedCapLevels: [], shutdownExpiresAt: null };
  const state: ActiveRun = { ...base, worldTime: 10, activeFloorId: active ? hero.floorId : 'floor.inactive',
    actors: [hero, source], populations: [population], floors: [{ ...base.floors[0]!, entities: [
      { entityId: source.actorId, x: source.x, y: source.y },
    ] }], encounterDecisions: [{ encounterId: encounter.id, baseProbability: 1, protectionBonus: 0,
      effectiveProbability: 1, eligible: true, reachedEligibleDepth: true, encountered: false, instancesCreated: 1 }] };
  return { state, content };
}

describe('swarm timers, placement, and caps', () => {
  it.each([
    ['spawn quantity', { maximumSpawnQuantity: 257 }],
    ['spawn-role weight', { spawnRoles: [
      { roleId: 'a', monsterId: 'monster.child-a', weight: 0x8000_0000 },
      { roleId: 'b', monsterId: 'monster.child-b', weight: 0x8000_0001 },
    ] }],
  ] as const)('rejects bypassed unsafe %s before a partial swarm transition', (_label, overrides) => {
    const { state, content } = fixture(overrides);
    const before = structuredClone(state);
    expect(() => advanceSwarms({ state, content, eventId: 'event.preflight', sourceActionActorId: 'actor.source' }))
      .toThrow(/swarm preflight.*(spawn quantity|weight).*(256|2\^32)/i);
    expect(state).toEqual(before);
  });

  it('rejects a saved swarm above its authored living caps', () => {
    const first = fixture();
    const spawned = advanceSwarms({ state: first.state, content: first.content,
      eventId: 'event.overcap-validation', sourceActionActorId: 'actor.source' });
    const constrained = fixture({ maximumLivingChildren: 1, maximumLivingMembers: 2 }).content;
    expect(() => validateContentBoundRun(spawned.state, constrained)).toThrow(/swarm.*(cap|living)/i);
  });

  it('keeps spawned actor occupancy authoritative after movement frees an origin', () => {
    const first = fixture();
    const spawned = advanceSwarms({ state: first.state, content: first.content,
      eventId: 'event.spawn-authoritative', sourceActionActorId: 'actor.source' });
    const child = spawned.state.actors.find((actor) => actor.actorId.startsWith('actor.population.swarm.spawn.'))!;
    const floor = spawned.state.floors.find((candidate) => candidate.floorId === child.floorId)!;
    expect(floor.entities.some((entity) => entity.entityId === child.actorId)).toBe(false);
    const moved = { ...spawned.state, actors: spawned.state.actors.map((actor) => actor.actorId === child.actorId
      ? { ...actor, x: 5, y: 5, health: 0 } : actor), worldTime: spawned.state.worldTime + 10,
      populations: spawned.state.populations.map((population) => population.model === 'swarm'
        ? { ...population, nextSpawnAt: spawned.state.worldTime + 10 } : population) };
    const respawned = advanceSwarms({ state: moved, content: first.content,
      eventId: 'event.respawn-authoritative', sourceActionActorId: 'actor.source' });
    expect(respawned.state.actors.filter((actor) => actor.health > 0 && actor.populationId === 'population.swarm')
      .some((actor) => actor.x === child.x && actor.y === child.y)).toBe(true);
    expect(respawned.state.floors.find((candidate) => candidate.floorId === child.floorId)?.entities
      .some((entity) => entity.entityId.startsWith('actor.population.swarm.spawn.'))).toBe(false);
  });

  it('processes one world-time transition, fills legal row-major cells, and advances only encounters RNG', () => {
    const { state, content } = fixture();
    const before = structuredClone(state);
    const result = resolveSwarmSpawnAction({ state, content, sourceActorId: 'actor.source', eventId: 'event.spawn' });
    expect(state).toEqual(before);
    expect(result.state.populations[0]).toMatchObject({ nextSpawnAt: 20, spawnedCount: 2 });
    expect(result.state.actors.filter((actor) => actor.populationRoleId === 'a' || actor.populationRoleId === 'b')
      .map(({ actorId, x, y }) => ({ actorId, x, y }))).toEqual([
      { actorId: 'actor.population.swarm.spawn.000001', x: 2, y: 1 },
      { actorId: 'actor.population.swarm.spawn.000002', x: 3, y: 1 },
    ]);
    expect(result.state.rng.encounters).not.toEqual(state.rng.encounters);
    expect({ ...result.state.rng, encounters: state.rng.encounters }).toEqual(state.rng);
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'swarm.members-created', quantity: 2 }));
  });

  it('never overwrites occupied, blocked, stairs, objectives, features, or vault-reserved cells', () => {
    const { state, content } = fixture({ minimumSpawnQuantity: 4, maximumSpawnQuantity: 4 });
    const floor = state.floors[0]!;
    const blocked = floor.tiles.map((tile, index) => index === 9 ? 0 as const : tile);
    const protectedFloor = { ...floor, tiles: blocked, stairUp: { x: 2, y: 1 }, stairDown: { x: 3, y: 1 },
      placementSlots: [{ slotId: 'slot.objective', vaultPlacementId: 'vault.one', kind: 'objective' as const,
        required: true, tags: [], x: 4, y: 1 }] };
    const result = resolveSwarmSpawnAction({ state: { ...state, floors: [protectedFloor], features: [{ featureId: 'feature.one',
      floorId: floor.floorId, x: 2, y: 2, type: 'door', state: 'closed', discovery: 'visible', contentId: null,
      coverTileId: 1 }] }, content, sourceActorId: 'actor.source', eventId: 'event.blocked' });
    expect(result.state.actors.filter((actor) => actor.populationId === 'population.swarm' && actor.actorId !== 'actor.source')
      .every((actor) => !['2:1', '3:1', '4:1', '2:2'].includes(`${actor.x}:${actor.y}`))).toBe(true);
  });

  it.each([
    ['source', { maximumLivingChildren: 1, maximumLivingMembers: 5, maximumFloorActors: 8 }],
    ['encounter', { maximumLivingChildren: 4, maximumLivingMembers: 2, maximumFloorActors: 8 }],
    ['floor', { maximumLivingChildren: 4, maximumLivingMembers: 5, maximumFloorActors: 2 }],
  ] as const)('enforces and de-duplicates the %s cap event', (level, caps) => {
    const { state, content } = fixture(caps);
    const first = resolveSwarmSpawnAction({ state, content, sourceActorId: 'actor.source', eventId: `event.cap.${level}` });
    expect(first.events).toContainEqual(expect.objectContaining({ type: 'swarm.cap-reached', level }));
    const second = resolveSwarmSpawnAction({ state: { ...first.state, worldTime: 20,
      actors: first.state.actors.map((actor) => actor.actorId === 'actor.source' ? { ...actor, energy: 100 } : actor) },
      content, sourceActorId: 'actor.source', eventId: `event.cap2.${level}` });
    expect(second.events).not.toContainEqual(expect.objectContaining({ type: 'swarm.cap-reached', level }));
  });

  it('freezes inactive growth and schedules from re-entry without catch-up', () => {
    const { state, content } = fixture({}, false);
    const inactive = advanceSwarms({ state: { ...state, worldTime: 100 }, content, eventId: 'event.inactive' });
    expect(inactive.state.populations[0]).toEqual(state.populations[0]);
    const reentered = advanceSwarms({ state: { ...inactive.state, activeFloorId: 'floor.demo', activeFloorEnteredAt: 100 }, content,
      eventId: 'event.reentry' });
    expect(reentered.state.actors).toEqual(state.actors);
    expect(reentered.state.populations[0]).toMatchObject({ nextSpawnAt: 110, spawnedCount: 0 });
  });

  it('requires the ready source to select and pay the configured spawn action', () => {
    const { state, content } = fixture();
    const notReady = { ...state, actors: state.actors.map((actor) => actor.actorId === 'actor.source'
      ? { ...actor, energy: 99 } : actor) };
    expect(chooseBehaviorAction({ state: notReady, actorId: 'actor.source', content }).type).not.toBe('swarm-spawn');
    const action = chooseBehaviorAction({ state, actorId: 'actor.source', content });
    expect(action).toEqual({ type: 'swarm-spawn', actorId: 'actor.source', cost: 100 });
    const spawned = resolveSwarmSpawnAction({ state, content, sourceActorId: 'actor.source', eventId: 'event.action' });
    expect(spawned.state.actors.find((actor) => actor.actorId === 'actor.source')?.energy).toBe(0);
    expect(spawned.events).toContainEqual(expect.objectContaining({ type: 'swarm.members-created' }));
  });

  it.each(['dead', 'former'] as const)('rejects a %s source without charging energy or spawning', (mode) => {
    const { state, content } = fixture();
    const guarded = { ...state,
      actors: state.actors.map((actor) => actor.actorId === 'actor.source'
        ? { ...actor, health: mode === 'dead' ? 0 : actor.health } : actor),
      populations: state.populations.map((population) => population.model === 'swarm' && mode === 'former'
        ? { ...population, livingMemberIds: [], formerMemberIds: ['actor.source'] }
        : population) };
    expect(swarmSpawnAction({ state: guarded, content, actorId: 'actor.source' })).toBeNull();
    expect(() => resolveSwarmSpawnAction({ state: guarded, content, sourceActorId: 'actor.source',
      eventId: `event.${mode}` })).toThrow(/cannot spawn/);
    expect(guarded.actors.find((actor) => actor.actorId === 'actor.source')?.energy).toBe(100);
    expect(guarded.actors).toHaveLength(2);
  });

  it('runs one due spawn through ready actor turn selection', () => {
    const { state, content } = fixture();
    const result = resolveWorldStep({ state, content,
      action: { type: 'wait', actorId: state.hero.actorId, cost: 100 }, eventId: 'event.world-spawn' });
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'actor.turn.started', actorId: 'actor.source' }));
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'swarm.members-created', quantity: 2 }));
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'actor.turn.completed', actionType: 'swarm-spawn' }));
  });

  it('saves and emits spawn intent before a due non-adjacent source action', () => {
    const { state, content } = fixture();
    const slowedContent = { ...content, entries: content.entries.map((entry) => entry.kind === 'monster'
      && entry.id === 'monster.source' ? { ...entry, speed: 25 } : entry) };
    const slowedState = { ...state, actors: state.actors.map((actor) => actor.actorId === 'actor.source'
      ? { ...actor, speed: 25 } : actor) };
    const result = resolveWorldStep({ state: slowedState, content: slowedContent,
      action: { type: 'wait', actorId: state.hero.actorId, cost: 100 }, eventId: 'event.spawn-intent' });
    const intentIndex = result.events.findIndex((event) => event.type === 'actor.intent-changed'
      && event.actorId === 'actor.source' && event.intent === 'spawn');
    const spawnIndex = result.events.findIndex((event) => event.type === 'swarm.members-created');
    expect(intentIndex).toBeGreaterThanOrEqual(0);
    expect(spawnIndex).toBeGreaterThan(intentIndex);
    expect(result.state.actors.find((actor) => actor.actorId === 'actor.source')?.behaviorState.intent).toBe('spawn');
  });

  it('prioritizes adjacent legitimate attack over due spawn intent and action', () => {
    const { state, content } = fixture();
    const adjacent = { ...state, actors: state.actors.map((actor) => actor.actorId === state.hero.actorId
      ? { ...actor, x: 2, y: 3 } : actor) };
    const result = resolveWorldStep({ state: adjacent, content,
      action: { type: 'wait', actorId: state.hero.actorId, cost: 100 }, eventId: 'event.attack-before-spawn' });
    const sourceEvents = result.events.filter((event) => 'actorId' in event && event.actorId === 'actor.source');
    expect(sourceEvents).toContainEqual(expect.objectContaining({ type: 'actor.intent-changed', intent: 'attack' }));
    expect(sourceEvents).toContainEqual(expect.objectContaining({ type: 'actor.turn.completed', actionType: 'bump-attack' }));
    expect(result.events).not.toContainEqual(expect.objectContaining({ type: 'swarm.members-created' }));
  });

  it('starts a new cap event episode after population falls below the cap', () => {
    const { state, content } = fixture({ maximumLivingChildren: 1 });
    const first = resolveSwarmSpawnAction({ state, content, sourceActorId: 'actor.source', eventId: 'event.cap.first' });
    const child = first.state.actors.find((actor) => actor.populationRoleId === 'a' || actor.populationRoleId === 'b')!;
    const reduced = advanceSwarms({ state: { ...first.state, worldTime: 20, actors: first.state.actors.map((actor) =>
      actor.actorId === child.actorId ? { ...actor, health: 0 } : actor) }, content, eventId: 'event.cap.reset' });
    expect((reduced.state.populations[0] as SwarmPopulation).emittedCapLevels).not.toContain('source');
    const again = resolveSwarmSpawnAction({ state: { ...reduced.state, actors: reduced.state.actors.map((actor) =>
      actor.actorId === 'actor.source' ? { ...actor, energy: 100 } : actor) }, content,
      sourceActorId: 'actor.source', eventId: 'event.cap.again' });
    expect(again.events).toContainEqual(expect.objectContaining({ type: 'swarm.cap-reached', level: 'source' }));
  });
});

describe('swarm shutdown responses', () => {
  const destroyed = (response: SwarmEncounterDefinition['sourceDestructionResponse'], parameters = {}) => {
    const result = fixture({ sourceDestructionResponse: response, responseParameters: parameters });
    const child: ActorState = { ...result.state.actors[1]!, actorId: 'actor.child', contentId: 'monster.child-a',
      x: 4, populationRoleId: 'a', health: 4, maxHealth: 4, behaviorState: { ...result.state.actors[1]!.behaviorState,
        lastKnownTargets: [{ targetActorId: result.state.hero.actorId, floorId: result.state.activeFloorId,
          x: 1, y: 1, observedAt: 9, source: 'sight', observerActorId: 'actor.child' }] } };
    return { ...result, state: { ...result.state, actors: [result.state.actors[0]!,
      { ...result.state.actors[1]!, health: 0 }, child], populations: [{ ...result.state.populations[0] as SwarmPopulation,
        livingMemberIds: ['actor.child', 'actor.source'] }] } };
  };

  it('stops permanently and children never inherit timers', () => {
    const { state, content } = destroyed('stop');
    const first = advanceSwarms({ state, content, eventId: 'event.stop' });
    expect(first.state.populations[0]).toMatchObject({ shutdownState: 'stop', livingMemberIds: ['actor.child'] });
    expect(first.state.actors.find((actor) => actor.actorId === 'actor.child')).not.toHaveProperty('nextSpawnAt');
  });

  it('uses normal path-based flee behavior', () => {
    const { state, content } = destroyed('flee');
    const result = advanceSwarms({ state, content, eventId: 'event.flee' });
    expect(result.state.actors.find((actor) => actor.actorId === 'actor.child')?.behaviorState)
      .toMatchObject({ intent: 'flee', goal: { type: 'cell' }, investigation: { expiresAt: null } });
    const saved = result.state.actors.find((actor) => actor.actorId === 'actor.child')!.behaviorState.goal;
    const movedHidden = { ...result.state, actors: result.state.actors.map((actor) => actor.actorId === result.state.hero.actorId
      ? { ...actor, x: 5, y: 3 } : actor) };
    expect(movedHidden.actors.find((actor) => actor.actorId === 'actor.child')!.behaviorState.goal).toEqual(saved);
  });

  it('applies deterministic timed decay once per interval', () => {
    const { state, content } = destroyed('decay', { interval: 5, damage: 2 });
    const started = advanceSwarms({ state, content, eventId: 'event.decay.start' });
    expect(started.events).toContainEqual(expect.objectContaining({ type: 'condition.applied',
      conditionId: 'condition.swarm-decay', actorId: 'actor.child' }));
    const due = advanceSwarms({ state: { ...started.state, worldTime: 15 }, content, eventId: 'event.decay.due' });
    expect(due.state.actors.find((actor) => actor.actorId === 'actor.child')?.health).toBe(2);
    expect(due.events.map((event) => event.type)).toEqual(['attack.hit', 'actor.damaged']);
    expect(advanceSwarms({ state: due.state, content, eventId: 'event.decay.repeat' }).state).toEqual(due.state);
    const death = advanceSwarms({ state: { ...due.state, worldTime: 20 }, content, eventId: 'event.decay.death' });
    expect(death.events).toContainEqual(expect.objectContaining({ type: 'actor.died', actorId: 'actor.child' }));
  });

  it('bounds frenzy by its authored duration', () => {
    const { state, content } = destroyed('frenzy', { duration: 5, modifiers: { accuracy: 1, defense: 0, damage: 2 } });
    const started = advanceSwarms({ state, content, eventId: 'event.frenzy' });
    expect(started.state.populations[0]).toMatchObject({ shutdownState: 'frenzy', shutdownExpiresAt: 15 });
    const ended = advanceSwarms({ state: { ...started.state, worldTime: 15 }, content, eventId: 'event.frenzy.end' });
    expect(ended.state.actors.find((actor) => actor.actorId === 'actor.child')?.behaviorState.intent).toBe('hold');
  });

  it('expires only the frenzy modifier while preserving legitimate member behavior state', () => {
    const { state, content } = destroyed('frenzy', { duration: 5,
      modifiers: { accuracy: 1, defense: 0, damage: 2 } });
    const started = advanceSwarms({ state, content, eventId: 'event.frenzy.preserve' });
    const goal = { type: 'cell' as const, floorId: state.activeFloorId, x: 5, y: 3 };
    const behavioral = { ...started.state, actors: started.state.actors.map((actor) => actor.actorId === 'actor.child'
      ? { ...actor, behaviorState: { ...actor.behaviorState, intent: 'approach' as const, goal,
        investigation: { floorId: goal.floorId, x: goal.x, y: goal.y, startedAt: 12, expiresAt: null } } } : actor),
      worldTime: 15 };
    const ended = advanceSwarms({ state: behavioral, content, eventId: 'event.frenzy.expired' });
    expect(ended.state.actors.find((actor) => actor.actorId === 'actor.child')?.behaviorState)
      .toEqual(behavioral.actors.find((actor) => actor.actorId === 'actor.child')?.behaviorState);
    expect((ended.state.populations[0] as SwarmPopulation).shutdownExpiresAt).toBeNull();
  });

  it('round-trips lifecycle state exactly', () => {
    const { state, content } = fixture();
    const advanced = resolveSwarmSpawnAction({ state, content, sourceActorId: 'actor.source', eventId: 'event.save' }).state;
    expect(decodeActiveRun(encodeActiveRun(advanced), content)).toEqual(advanced);
  });
});
