import { describe, expect, it } from 'vitest';
import type { CompiledContentPack, EncounterContentEntry, MonsterContentEntry } from '@woven-deep/content';
import {
  chooseBehaviorAction, createDemoContentPack, createDemoRun, resolveWorldStep,
  type ActorState, type FloorSnapshot,
} from '../src/index.js';

function definition(id: string): MonsterContentEntry {
  return {
    kind: 'monster', id, name: id, glyph: 'm', color: '#aa4444', tags: [],
    minDepth: 1, maxDepth: 20,
    attributes: { might: 5, agility: 5, vitality: 5, wits: 5, resolve: 5 },
    health: 10, speed: 100, accuracy: 100, defense: 8, perception: 8,
    damage: { count: 1, sides: 1, bonus: 0 }, armor: 0,
    resistances: { physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0, arcane: 0 },
    disposition: 'hostile', behaviorId: 'behavior.approach-and-attack', behaviorParameters: {}, rarity: 'common',
  };
}

function pack(...entries: (MonsterContentEntry | EncounterContentEntry)[]): CompiledContentPack {
  const base = createDemoContentPack();
  return { ...base, entries: [...base.entries, ...entries] };
}

function encounter(id: string, monsterId: string): EncounterContentEntry {
  return {
    kind: 'encounter', id, name: id, adminDescription: null, tags: [], model: 'individual',
    minDepth: 1, maxDepth: 20, environmentTags: [], requiredVaultTags: [], weight: 1, rarity: 'common',
    runAppearanceChance: 1, discoveryProtectionIncrement: 0, discoveryProtectionCap: 1,
    maximumInstancesPerRun: 1,
    placement: { minimumStairDistance: 0, minimumObjectiveDistance: 0, maximumMemberDistance: 0,
      allowedTerrainTags: ['floor'], requiresVaultSlot: false, failureMode: 'optional' },
    intentPresentation: { visible: true },
    definition: { monsterId, minimumQuantity: 1, maximumQuantity: 1 },
  };
}

function monster(id: string, overrides: Partial<ActorState> = {}): ActorState {
  const hero = createDemoRun().actors[0]!;
  return {
    ...hero, actorId: id, contentId: id, playerControlled: false,
    disposition: 'hostile', behaviorId: 'behavior.approach-and-attack',
    x: 3, y: 1, awareActorIds: [], ...overrides,
  };
}

describe('individual population behavior', () => {
  it('holds while unaware', () => {
    const run = createDemoRun();
    const actor = monster('monster.unaware');
    expect(chooseBehaviorAction({
      state: { ...run, actors: [run.actors[0]!, actor] }, actorId: actor.actorId,
      content: pack(definition(actor.contentId)),
    })).toMatchObject({ type: 'wait' });
  });

  it('approaches a directly observed hostile and saves memory, goal, and intent before movement', () => {
    const run = createDemoRun();
    const actor = monster('monster.observer', { energy: 100 });
    const result = resolveWorldStep({
      state: { ...run, actors: [run.actors[0]!, actor] }, content: pack(definition(actor.contentId)),
      eventId: 'event.observe', action: { type: 'wait', actorId: run.hero.actorId, cost: 100 },
    });
    const saved = result.state.actors.find((candidate) => candidate.actorId === actor.actorId)!;
    expect(saved.awareActorIds).toContain(run.hero.actorId);
    expect(saved.behaviorState).toMatchObject({
      intent: 'approach', goal: { type: 'actor', targetActorId: run.hero.actorId },
      lastKnownTargets: [{ targetActorId: run.hero.actorId, x: 1, y: 1, observedAt: 0, source: 'sight' }],
    });
    expect(result.events.map((event) => event.type)).toEqual([
      'hero.waited', 'actor.turn.started', 'actor.intent-changed', 'actor.moved', 'actor.turn.completed',
    ]);
    expect(JSON.stringify(result.publicEvents)).not.toMatch(/lastKnownTargets|observerActorId|"goal"|"path"/);
  });

  it('attacks an adjacent directly observed hostile', () => {
    const run = createDemoRun();
    const actor = monster('monster.adjacent', { x: 2, y: 1, energy: 100 });
    const result = resolveWorldStep({
      state: { ...run, actors: [run.actors[0]!, actor] }, content: pack(definition(actor.contentId)),
      eventId: 'event.adjacent', action: { type: 'wait', actorId: run.hero.actorId, cost: 100 },
    });
    expect(result.events.map((event) => event.type)).toContain('actor.intent-changed');
    expect(result.events.some((event) => event.type === 'attack.hit' || event.type === 'attack.missed')).toBe(true);
    expect(result.state.actors.find((candidate) => candidate.actorId === actor.actorId)?.behaviorState.intent).toBe('attack');
  });

  it('holds after hostility changes even while the former target remains visible', () => {
    const run = createDemoRun();
    const actor = monster('monster.pacified', { energy: 100, behaviorState: {
      intent: 'approach', goal: { type: 'actor', targetActorId: run.hero.actorId },
      lastKnownTargets: [], investigation: null,
    } });
    const result = resolveWorldStep({
      state: { ...run, actors: [run.actors[0]!, actor], relationships: [{
        leftActorId: run.hero.actorId, rightActorId: actor.actorId, relationship: 'neutral',
      }] },
      content: pack(definition(actor.contentId)), eventId: 'event.pacified',
      action: { type: 'wait', actorId: run.hero.actorId, cost: 100 },
    });
    expect(result.state.actors.find((candidate) => candidate.actorId === actor.actorId))
      .toMatchObject({ x: 3, y: 1, behaviorState: { intent: 'hold', goal: null, investigation: null } });
  });

  it('investigates a last-known cell without tracking the unseen target', () => {
    const run = createDemoRun();
    const actor = monster('monster.investigator', { x: 4, y: 3, behaviorState: {
      intent: 'approach', goal: { type: 'cell', floorId: 'floor.demo', x: 1, y: 3 },
      lastKnownTargets: [{ targetActorId: run.hero.actorId, floorId: 'floor.demo', x: 1, y: 3,
        observedAt: 4, source: 'sound', observerActorId: 'monster.investigator' }],
      investigation: { floorId: 'floor.demo', x: 1, y: 3, startedAt: 4, expiresAt: 20 },
    } });
    const action = chooseBehaviorAction({
      state: { ...run, actors: [run.actors[0]!, actor] }, actorId: actor.actorId,
      content: pack(definition(actor.contentId)),
    });
    expect(action).toMatchObject({ type: 'move', to: { x: 3, y: 3 } });
  });

  it('abandons a search after reaching the last-known cell', () => {
    const run = createDemoRun();
    const dark = { ...run.floors[0]!, ambient: { color: [0, 0, 0] as const, strength: 0 } };
    const actor = monster('monster.searcher', { x: 3, y: 3, energy: 100, behaviorState: {
      intent: 'approach', goal: { type: 'cell', floorId: 'floor.demo', x: 3, y: 3 },
      lastKnownTargets: [], investigation: { floorId: 'floor.demo', x: 3, y: 3, startedAt: 0, expiresAt: 20 },
    } });
    const result = resolveWorldStep({
      state: { ...run, floors: [dark], actors: [run.actors[0]!, actor] }, content: pack(definition(actor.contentId)),
      eventId: 'event.search-complete', action: { type: 'wait', actorId: run.hero.actorId, cost: 100 },
    });
    expect(result.state.actors.find((candidate) => candidate.actorId === actor.actorId)?.behaviorState)
      .toMatchObject({ intent: 'hold', goal: null, investigation: null });
  });

  it('holds when its investigation goal is unreachable', () => {
    const run = createDemoRun();
    const actor = monster('monster.trapped', { x: 1, y: 1, behaviorState: {
      intent: 'approach', goal: { type: 'cell', floorId: 'floor.demo', x: 5, y: 3 },
      lastKnownTargets: [], investigation: { floorId: 'floor.demo', x: 5, y: 3, startedAt: 0, expiresAt: null },
    } });
    const floor = { ...run.floors[0]!, tiles: run.floors[0]!.tiles.map((tile, index) => (
      index === 9 || index === 15 ? 0 : tile
    )) };
    expect(chooseBehaviorAction({
      state: { ...run, floors: [floor], actors: [actor] }, actorId: actor.actorId,
      content: pack(definition(actor.contentId)),
    })).toMatchObject({ type: 'wait' });
  });

  it('freezes actors on inactive floors', () => {
    const run = createDemoRun();
    const offFloor: FloorSnapshot = { ...run.floors[0]!, floorId: 'floor.inactive', depth: 2 };
    const actor = monster('monster.inactive', { floorId: offFloor.floorId, energy: 100 });
    const result = resolveWorldStep({
      state: { ...run, floors: [...run.floors, offFloor], actors: [run.actors[0]!, actor] },
      content: pack(definition(actor.contentId)), eventId: 'event.inactive',
      action: { type: 'wait', actorId: run.hero.actorId, cost: 100 },
    });
    expect(result.internalActions).toBe(0);
    expect(result.state.actors.find((candidate) => candidate.actorId === actor.actorId)?.energy).toBe(100);
  });

  it('marks an encounter only after the hero legitimately observes a member', () => {
    const run = createDemoRun();
    const actor = monster('monster.population', {
      x: 3, y: 1, energy: 0, populationId: 'population.visible',
      populationPresentation: { name: 'Visible monster', glyph: 'm', color: '#aa4444', leader: false },
    });
    const entry = encounter('encounter.visible', actor.contentId);
    const result = resolveWorldStep({
      state: {
        ...run, actors: [run.actors[0]!, actor],
        encounterDecisions: [{ encounterId: entry.id, baseProbability: 1, protectionBonus: 0,
          effectiveProbability: 1, eligible: true, reachedEligibleDepth: true, encountered: false,
          instancesCreated: 1 }],
        populations: [{ populationId: 'population.visible', encounterId: entry.id, model: 'individual',
          floorId: 'floor.demo', createdAt: 0, livingMemberIds: [actor.actorId], formerMemberIds: [] }],
      },
      content: pack(definition(actor.contentId), entry), eventId: 'event.encounter-observed',
      action: { type: 'wait', actorId: run.hero.actorId, cost: 100 },
    });
    expect(result.state.encounterDecisions[0]?.encountered).toBe(true);
  });

  it('does not mark generated membership encountered while every member is dark and unseen', () => {
    const run = createDemoRun();
    const actor = monster('monster.hidden-population', {
      x: 3, y: 1, energy: 0, populationId: 'population.hidden',
      populationPresentation: { name: 'Hidden monster', glyph: 'm', color: '#aa4444', leader: false },
    });
    const entry = encounter('encounter.hidden', actor.contentId);
    const darkFloor = { ...run.floors[0]!, ambient: { color: [0, 0, 0] as const, strength: 0 } };
    const result = resolveWorldStep({
      state: {
        ...run, floors: [darkFloor], actors: [run.actors[0]!, actor],
        encounterDecisions: [{ encounterId: entry.id, baseProbability: 1, protectionBonus: 0,
          effectiveProbability: 1, eligible: true, reachedEligibleDepth: true, encountered: false,
          instancesCreated: 1 }],
        populations: [{ populationId: 'population.hidden', encounterId: entry.id, model: 'individual',
          floorId: 'floor.demo', createdAt: 0, livingMemberIds: [actor.actorId], formerMemberIds: [] }],
      },
      content: pack(definition(actor.contentId), entry), eventId: 'event.encounter-unseen',
      action: { type: 'wait', actorId: run.hero.actorId, cost: 100 },
    });
    expect(result.state.encounterDecisions[0]?.encountered).toBe(false);
  });
});
