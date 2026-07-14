import { describe, expect, it } from 'vitest';
import {
  chooseBehaviorAction,
  createDemoContentPack,
  createDemoRun,
  type ActorState,
} from '../src/index.js';

function hostile(overrides: Partial<ActorState> = {}): ActorState {
  const hero = createDemoRun().actors[0]!;
  return {
    ...hero, actorId: 'monster.hunter', contentId: 'monster.hunter', playerControlled: false,
    disposition: 'hostile', behaviorId: 'behavior.approach-and-attack',
    awareActorIds: [hero.actorId], ...overrides,
  };
}

describe('registered deterministic behavior', () => {
  it('attacks an adjacent aware hostile target', () => {
    const state = createDemoRun();
    const monster = hostile({ x: 2, y: 1 });
    expect(chooseBehaviorAction({
      state: { ...state, actors: [state.actors[0]!, monster] },
      actorId: monster.actorId, content: createDemoContentPack(),
    })).toMatchObject({
      type: 'bump-attack', actorId: monster.actorId, targetActorId: 'hero.demo',
    });
  });

  it('uses the owned path adapter to route around an occupied cell', () => {
    const state = createDemoRun();
    const monster = hostile({ x: 4, y: 1, behaviorState: {
      intent: 'approach', goal: { type: 'actor', targetActorId: 'hero.demo' },
      lastKnownTargets: [], investigation: null,
    } });
    const blocker = hostile({
      actorId: 'monster.blocker', x: 3, y: 1, behaviorId: null, awareActorIds: [],
    });
    expect(chooseBehaviorAction({
      state: { ...state, actors: [state.actors[0]!, blocker, monster] },
      actorId: monster.actorId, content: createDemoContentPack(),
    })).toMatchObject({ type: 'move', to: { x: 4, y: 2 } });
  });

  it('waits when it has no aware hostile target', () => {
    const state = createDemoRun();
    const monster = hostile({ x: 3, y: 3, awareActorIds: [] });
    expect(chooseBehaviorAction({
      state: { ...state, actors: [state.actors[0]!, monster] },
      actorId: monster.actorId, content: createDemoContentPack(),
    })).toMatchObject({ type: 'wait', actorId: monster.actorId });
  });

  it('lets actors without an active behavior wait safely', () => {
    const state = createDemoRun();
    const npc = hostile({ behaviorId: null });
    expect(chooseBehaviorAction({
      state: { ...state, actors: [state.actors[0]!, npc] },
      actorId: npc.actorId, content: createDemoContentPack(),
    })).toMatchObject({ type: 'wait', actorId: npc.actorId });
  });

  it('holds when a saved goal becomes non-hostile before selection', () => {
    const state = createDemoRun();
    const monster = hostile({ x: 3, y: 1, behaviorState: {
      intent: 'approach', goal: { type: 'actor', targetActorId: 'hero.demo' },
      lastKnownTargets: [], investigation: null,
    } });
    expect(chooseBehaviorAction({
      state: {
        ...state, actors: [state.actors[0]!, monster],
        relationships: [{ leftActorId: 'hero.demo', rightActorId: monster.actorId, relationship: 'neutral' }],
      },
      actorId: monster.actorId, content: createDemoContentPack(),
    })).toMatchObject({ type: 'wait' });
  });

  it('holds instead of pathing onto an occupied investigation cell', () => {
    const state = createDemoRun();
    const monster = hostile({ x: 3, y: 1, awareActorIds: [], behaviorState: {
      intent: 'approach', goal: { type: 'cell', floorId: 'floor.demo', x: 2, y: 1 },
      lastKnownTargets: [], investigation: null,
    } });
    const blocker = hostile({ actorId: 'monster.blocker', x: 2, y: 1, behaviorId: null,
      disposition: 'friendly', awareActorIds: [] });
    expect(chooseBehaviorAction({
      state: { ...state, actors: [state.actors[0]!, blocker, monster] },
      actorId: monster.actorId, content: createDemoContentPack(),
    })).toMatchObject({ type: 'wait' });
  });
});
