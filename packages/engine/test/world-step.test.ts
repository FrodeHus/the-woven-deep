import { describe, expect, it } from 'vitest';
import type { CompiledContentPack, EncounterContentEntry, ItemContentEntry, MonsterContentEntry } from '@woven-deep/content';
import {
  createDemoContentPack,
  createDemoRun,
  relationshipBetween,
  resolveCommand,
  resolveWorldStep,
  selectReadyActor,
  type ActorState,
  type ItemInstance,
} from '../src/index.js';

function monsterDefinition(id: string): MonsterContentEntry {
  return {
    kind: 'monster', id, name: id, glyph: 'm', color: '#aa4444', tags: [],
    minDepth: 1, maxDepth: 20,
    attributes: { might: 5, agility: 5, vitality: 5, wits: 5, resolve: 5 },
    health: 10, speed: 100, accuracy: 100, defense: 8, perception: 8,
    damage: { count: 1, sides: 1, bonus: 0 }, armor: 0,
    resistances: { physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0, arcane: 0 },
    disposition: 'hostile', behaviorId: 'behavior.approach-and-attack', behaviorParameters: {},
    runAppearanceChance: 1, rarity: 'common',
  };
}

function contentWithMonster(id: string): CompiledContentPack {
  const content = createDemoContentPack();
  return { ...content, entries: [...content.entries, monsterDefinition(id)] };
}

function monster(id: string, overrides: Partial<ActorState> = {}): ActorState {
  const hero = createDemoRun().actors[0]!;
  return {
    ...hero, actorId: id, contentId: id, playerControlled: false,
    disposition: 'hostile', behaviorId: 'behavior.approach-and-attack',
    x: 3, y: 1, awareActorIds: [hero.actorId], ...overrides,
  };
}

describe('atomic world steps', () => {
  it('makes confirmed aggression hostile before the attack roll and saves it', () => {
    const state = createDemoRun();
    const target = monster('monster.neutral', { x: 2, disposition: 'neutral', energy: 0 });
    const content = contentWithMonster(target.contentId);
    const result = resolveWorldStep({
      state: { ...state, actors: [state.actors[0]!, target] }, content,
      eventId: 'command.attack-neutral',
      action: { type: 'bump-attack', actorId: 'hero.demo', targetActorId: target.actorId, cost: 100 },
    });
    expect(relationshipBetween(result.state, 'hero.demo', target.actorId)).toBe('hostile');
    expect(result.events[0]).toMatchObject({
      type: 'relationship.changed', actorId: 'hero.demo', targetActorId: target.actorId,
      relationship: 'hostile',
    });
    expect(result.events.some((event) => event.type === 'attack.hit' || event.type === 'attack.missed')).toBe(true);
  });

  it('applies the hero action then actors until the hero is selected again', () => {
    const state = createDemoRun();
    const enemy = monster('monster.equal', { energy: 100 });
    const content = contentWithMonster(enemy.contentId);
    const result = resolveWorldStep({
      state: { ...state, actors: [state.actors[0]!, enemy] }, content,
      eventId: 'command.move',
      action: { type: 'move', actorId: 'hero.demo', to: { x: 2, y: 1 }, cost: 100 },
    });
    expect(result.events.map((event) => event.type)).toEqual([
      'hero.moved', 'actor.turn.started', 'actor.intent-changed', 'attack.hit', 'actor.damaged', 'actor.turn.completed',
    ]);
    expect(result.state.worldTime).toBe(1);
    expect(selectReadyActor(result.state.actors, content)?.actorId).toBe('hero.demo');
    expect(result.publicEvents.map((event) => event.type)).toEqual([
      'hero.moved', 'actor.turn.started', 'actor.intent-changed', 'combat.observed', 'actor.damaged', 'actor.turn.completed',
    ]);
    expect(JSON.stringify(result.publicEvents)).not.toMatch(/naturalRoll|rolledDice|rolledDamage|defense/);
  });

  it('throws before returning when the internal action safety limit is reached', () => {
    const state = createDemoRun();
    const enemy = monster('monster.loop', { energy: 100 });
    const content = contentWithMonster(enemy.contentId);
    expect(() => resolveWorldStep({
      state: { ...state, actors: [state.actors[0]!, enemy] }, content,
      eventId: 'command.safety', maxInternalActions: 0,
      action: { type: 'wait', actorId: 'hero.demo', cost: 100 },
    })).toThrow('internal action safety limit 0 exceeded');
  });

  it('does not partially mutate input when one actor behavior fails', () => {
    const state = createDemoRun();
    const enemy = monster('monster.invalid-behavior', { energy: 100, behaviorId: 'behavior.missing' });
    const content = contentWithMonster(enemy.contentId);
    const input = { ...state, actors: [state.actors[0]!, enemy] };
    const before = structuredClone(input);
    expect(() => resolveWorldStep({
      state: input, content, eventId: 'command.invalid-behavior',
      action: { type: 'wait', actorId: 'hero.demo', cost: 100 },
    })).toThrow(/no behavior resolver/);
    expect(input).toEqual(before);
  });

  it('resolves hostile opportunity attacks before applying movement', () => {
    const state = createDemoRun();
    const hero = { ...state.actors[0]!, x: 2, y: 2 };
    const enemy = monster('monster.reactor', { x: 3, y: 2, energy: 0, reactionReady: true,
      awareActorIds: [hero.actorId] });
    const content = contentWithMonster(enemy.contentId);
    const result = resolveWorldStep({
      state: { ...state, actors: [hero, enemy] }, content, eventId: 'command.depart',
      action: { type: 'move', actorId: hero.actorId, to: { x: 1, y: 2 }, cost: 100 },
    });
    const types = result.events.map((event) => event.type);
    expect(types.indexOf('reaction.triggered')).toBeGreaterThanOrEqual(0);
    expect(types.indexOf('reaction.triggered')).toBeLessThan(types.indexOf('hero.moved'));
  });

  it('revalidates a candidate move against normal movement rules before mutation', () => {
    const state = createDemoRun();
    const before = structuredClone(state);
    const result = resolveWorldStep({
      state, content: createDemoContentPack(), eventId: 'command.stale-move',
      action: { type: 'move', actorId: state.hero.actorId, to: { x: 0, y: 1 }, cost: 100 },
    });
    expect(result.state.actors[0]).toMatchObject({ x: 1, y: 1 });
    expect(result.events.some((event) => event.type === 'hero.moved')).toBe(false);
    expect(state).toEqual(before);
  });

  it('omits unseen actor activity from the public event sequence', () => {
    const state = createDemoRun();
    const enemy = monster('monster.unseen', { energy: 100 });
    const content = contentWithMonster(enemy.contentId);
    const darkFloor = { ...state.floors[0]!, ambient: { color: [0, 0, 0] as const, strength: 0 } };
    const result = resolveWorldStep({
      state: { ...state, floors: [darkFloor], actors: [state.actors[0]!, enemy] }, content,
      eventId: 'command.wait-dark',
      action: { type: 'wait', actorId: 'hero.demo', cost: 100 },
    });
    expect(result.events.map((event) => event.type)).toEqual([
      'hero.waited', 'actor.turn.started', 'actor.turn.completed',
    ]);
    expect(result.publicEvents.map((event) => event.type)).toEqual(['hero.waited']);
  });

  it('emits an ordinary population encounter exactly once with public redaction', () => {
    const base = createDemoRun();
    const enemy = { ...monster('monster.population', { energy: 0 }), x: 2, y: 1,
      populationId: 'population.visible', populationRoleId: 'individual' };
    const encounter: EncounterContentEntry = {
      kind: 'encounter', id: 'encounter.visible', name: 'Visible encounter', adminDescription: null, tags: [],
      model: 'individual', minDepth: 1, maxDepth: 2, environmentTags: [], requiredVaultTags: [], weight: 1,
      rarity: 'common', runAppearanceChance: 1, discoveryProtectionIncrement: 0, discoveryProtectionCap: 1,
      maximumInstancesPerRun: 1, placement: { minimumStairDistance: 1, minimumObjectiveDistance: 1,
        maximumMemberDistance: 1, allowedTerrainTags: ['floor'], requiresVaultSlot: false, failureMode: 'optional' },
      intentPresentation: { visible: true }, definition: { monsterId: enemy.contentId, minimumQuantity: 1, maximumQuantity: 1 },
    };
    const content = contentWithMonster(enemy.contentId);
    const withEncounter = { ...content, entries: [...content.entries, encounter] };
    const state = { ...base, contentHash: withEncounter.hash, actors: [base.actors[0]!, enemy],
      encounterDecisions: [{ encounterId: encounter.id, baseProbability: 1, protectionBonus: 0,
        effectiveProbability: 1, eligible: true, reachedEligibleDepth: true, encountered: false, instancesCreated: 1 }],
      populations: [{ populationId: 'population.visible', encounterId: encounter.id, floorId: base.activeFloorId,
        createdAt: 0, model: 'individual' as const, livingMemberIds: [enemy.actorId], formerMemberIds: [] }] };
    const first = resolveWorldStep({ state, content: withEncounter, eventId: 'command.encounter-1',
      action: { type: 'wait', actorId: base.hero.actorId, cost: 100 } });
    expect(first.events.filter((event) => event.type === 'population.encountered')).toHaveLength(1);
    expect(first.publicEvents).toContainEqual({ type: 'population.notice', eventId: 'command.encounter-1',
      category: 'encountered', actorId: enemy.actorId, presentation: 'population.encountered' });
    const second = resolveWorldStep({ state: first.state, content: withEncounter, eventId: 'command.encounter-2',
      action: { type: 'wait', actorId: base.hero.actorId, cost: 100 } });
    expect(second.events.some((event) => event.type === 'population.encountered')).toBe(false);
  });

  it('returns the saved public sequence when a duplicate command is retried after visibility changes', () => {
    const state = createDemoRun();
    const enemy = monster('monster.unseen', { energy: 100 });
    const content = contentWithMonster(enemy.contentId);
    const darkFloor = { ...state.floors[0]!, ambient: { color: [0, 0, 0] as const, strength: 0 } };
    const command = { type: 'wait' as const, commandId: 'command.retry-dark', expectedRevision: 0 };
    const first = resolveCommand({ ...state, floors: [darkFloor], actors: [state.actors[0]!, enemy] },
      command, { content });
    const later = { ...first.state, floors: first.state.floors.map((floor) => ({ ...floor,
      ambient: { color: [255, 255, 255] as const, strength: 255 } })) };
    const duplicate = resolveCommand(later, command, { content });
    expect(duplicate.events).toEqual(first.events);
    expect(duplicate.events.map((event) => event.type)).toEqual(['hero.waited']);
  });

  it('advances hunger and equipped light fuel by scheduler elapsed time', () => {
    const state = createDemoRun();
    const definition: ItemContentEntry = {
      kind: 'item', id: 'item.step-torch', name: 'Step torch', glyph: 'i', color: '#ffffff', tags: [],
      category: 'light', stackLimit: 1, price: 1, rarity: 'common', minDepth: 0, maxDepth: 20, actionCost: 100,
      equipment: { slots: ['off-hand'], handedness: 'one-handed', reservedSlots: [] }, combat: null,
      light: { color: [255, 180, 100], radius: 3, strength: 100, fuelCapacity: 2,
        fuelPerTime: 1, warningThresholds: [1], fuelTags: ['oil'] },
      identification: { mode: 'known', poolId: null }, effects: [],
    };
    const item: ItemInstance = { itemId: 'item.step-torch.1', contentId: definition.id, quantity: 1,
      condition: 100, enchantment: null, identified: true, charges: null, fuel: 2, enabled: true,
      location: { type: 'equipped', actorId: 'hero.demo', slot: 'off-hand' } };
    const content = { ...createDemoContentPack(), entries: [...createDemoContentPack().entries, definition] };
    const result = resolveWorldStep({ state: { ...state, items: [item] }, content,
      eventId: 'command.survival-step', action: { type: 'wait', actorId: 'hero.demo', cost: 100 } });
    expect(result.state.worldTime).toBe(1);
    expect(result.state.survival.hungerReserve).toBe(9_999);
    expect(result.state.items[0]).toMatchObject({ fuel: 1, enabled: true });
    expect(result.events.some((event) => event.type === 'fuel.warning')).toBe(true);
  });

  it('stops before granting input when starvation kills the hero during clock advance', () => {
    const state = createDemoRun();
    const hero = { ...state.actors[0]!, health: 1 };
    const result = resolveWorldStep({ state: { ...state, actors: [hero], survival: {
      ...state.survival, hungerReserve: 0, hungerStage: 'starving', nextStarvationAt: 1,
    } }, content: createDemoContentPack(), eventId: 'command.starve',
    action: { type: 'wait', actorId: hero.actorId, cost: 100 } });
    expect(result.state.actors[0]?.health).toBe(0);
    expect(result.events.map((event) => event.type)).toEqual(['hero.waited', 'actor.damaged', 'actor.died']);
    expect(selectReadyActor(result.state.actors, createDemoContentPack())).toBeUndefined();
  });
});
