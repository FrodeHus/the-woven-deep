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

  it('takes the first legal fixed-order step that reduces distance', () => {
    const state = createDemoRun();
    const monster = hostile({ x: 3, y: 3 });
    expect(chooseBehaviorAction({
      state: { ...state, actors: [state.actors[0]!, monster] },
      actorId: monster.actorId, content: createDemoContentPack(),
    })).toMatchObject({ type: 'move', to: { x: 2, y: 2 } });
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
});
