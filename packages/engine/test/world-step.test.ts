import { describe, expect, it } from 'vitest';
import type { CompiledContentPack, MonsterContentEntry } from '@woven-deep/content';
import {
  createDemoContentPack,
  createDemoRun,
  relationshipBetween,
  resolveWorldStep,
  selectReadyActor,
  type ActorState,
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
      'hero.moved', 'actor.turn.started', 'attack.hit', 'actor.damaged', 'actor.turn.completed',
    ]);
    expect(result.state.worldTime).toBe(1);
    expect(selectReadyActor(result.state.actors, content)?.actorId).toBe('hero.demo');
    expect(result.publicEvents).toEqual(result.events);
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
      'hero.waited', 'actor.turn.started', 'actor.moved', 'actor.turn.completed',
    ]);
    expect(result.publicEvents.map((event) => event.type)).toEqual(['hero.waited']);
  });
});
