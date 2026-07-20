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
    ...hero,
    actorId: 'monster.hunter',
    contentId: 'monster.hunter',
    playerControlled: false,
    disposition: 'hostile',
    behaviorId: 'behavior.approach-and-attack',
    awareActorIds: [hero.actorId],
    ...overrides,
  };
}

function contentWithBehavior(
  actor: ActorState,
  behaviorParameters: Readonly<Record<string, unknown>>,
) {
  const content = createDemoContentPack();
  return {
    ...content,
    entries: [
      ...content.entries,
      {
        kind: 'monster' as const,
        id: actor.contentId,
        name: actor.contentId,
        glyph: 'm',
        color: '#aa4444',
        tags: [],
        minDepth: 1,
        maxDepth: 20,
        attributes: { might: 5, agility: 5, vitality: 5, wits: 5, resolve: 5 },
        health: 10,
        speed: 100,
        accuracy: 100,
        defense: 8,
        perception: 8,
        damage: { count: 1, sides: 1, bonus: 0 },
        armor: 0,
        resistances: { physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0, arcane: 0 },
        disposition: 'hostile' as const,
        behaviorId: actor.behaviorId!,
        behaviorParameters,
        rarity: 'common' as const,
      },
    ],
  };
}

describe('registered deterministic behavior', () => {
  it('attacks an adjacent aware hostile target', () => {
    const state = createDemoRun();
    const monster = hostile({ x: 2, y: 1 });
    expect(
      chooseBehaviorAction({
        state: { ...state, actors: [state.actors[0]!, monster] },
        actorId: monster.actorId,
        content: createDemoContentPack(),
      }),
    ).toMatchObject({
      type: 'bump-attack',
      actorId: monster.actorId,
      targetActorId: 'hero.demo',
    });
  });

  it('uses the owned path adapter to route around an occupied cell', () => {
    const state = createDemoRun();
    const monster = hostile({
      x: 4,
      y: 1,
      behaviorState: {
        intent: 'approach',
        goal: { type: 'actor', targetActorId: 'hero.demo' },
        lastKnownTargets: [],
        investigation: null,
      },
    });
    const blocker = hostile({
      actorId: 'monster.blocker',
      x: 3,
      y: 1,
      behaviorId: null,
      awareActorIds: [],
    });
    expect(
      chooseBehaviorAction({
        state: { ...state, actors: [state.actors[0]!, blocker, monster] },
        actorId: monster.actorId,
        content: createDemoContentPack(),
      }),
    ).toMatchObject({ type: 'move', to: { x: 4, y: 2 } });
  });

  it('waits when it has no aware hostile target', () => {
    const state = createDemoRun();
    const monster = hostile({ x: 3, y: 3, awareActorIds: [] });
    expect(
      chooseBehaviorAction({
        state: { ...state, actors: [state.actors[0]!, monster] },
        actorId: monster.actorId,
        content: createDemoContentPack(),
      }),
    ).toMatchObject({ type: 'wait', actorId: monster.actorId });
  });

  it('lets actors without an active behavior wait safely', () => {
    const state = createDemoRun();
    const npc = hostile({ behaviorId: null });
    expect(
      chooseBehaviorAction({
        state: { ...state, actors: [state.actors[0]!, npc] },
        actorId: npc.actorId,
        content: createDemoContentPack(),
      }),
    ).toMatchObject({ type: 'wait', actorId: npc.actorId });
  });

  it('holds when a saved goal becomes non-hostile before selection', () => {
    const state = createDemoRun();
    const monster = hostile({
      x: 3,
      y: 1,
      behaviorState: {
        intent: 'approach',
        goal: { type: 'actor', targetActorId: 'hero.demo' },
        lastKnownTargets: [],
        investigation: null,
      },
    });
    expect(
      chooseBehaviorAction({
        state: {
          ...state,
          actors: [state.actors[0]!, monster],
          relationships: [
            { leftActorId: 'hero.demo', rightActorId: monster.actorId, relationship: 'neutral' },
          ],
        },
        actorId: monster.actorId,
        content: createDemoContentPack(),
      }),
    ).toMatchObject({ type: 'wait' });
  });

  it('holds instead of pathing onto an occupied investigation cell', () => {
    const state = createDemoRun();
    const monster = hostile({
      x: 3,
      y: 1,
      awareActorIds: [],
      behaviorState: {
        intent: 'approach',
        goal: { type: 'cell', floorId: 'floor.demo', x: 2, y: 1 },
        lastKnownTargets: [],
        investigation: null,
      },
    });
    const blocker = hostile({
      actorId: 'monster.blocker',
      x: 2,
      y: 1,
      behaviorId: null,
      disposition: 'friendly',
      awareActorIds: [],
    });
    expect(
      chooseBehaviorAction({
        state: { ...state, actors: [state.actors[0]!, blocker, monster] },
        actorId: monster.actorId,
        content: createDemoContentPack(),
      }),
    ).toMatchObject({ type: 'wait' });
  });

  it('uses saved investigation instead of hidden live coordinates for a stale actor goal', () => {
    const state = createDemoRun();
    const monster = hostile({
      x: 5,
      y: 3,
      awareActorIds: [],
      behaviorState: {
        intent: 'approach',
        goal: { type: 'actor', targetActorId: 'hero.demo' },
        lastKnownTargets: [
          {
            targetActorId: 'hero.demo',
            floorId: 'floor.demo',
            x: 5,
            y: 1,
            observedAt: 1,
            source: 'sight',
            observerActorId: 'monster.hunter',
          },
        ],
        investigation: { floorId: 'floor.demo', x: 5, y: 1, startedAt: 1, expiresAt: null },
      },
    });
    const action = chooseBehaviorAction({
      state: { ...state, actors: [state.actors[0]!, monster] },
      actorId: monster.actorId,
      content: createDemoContentPack(),
    });
    expect(action).toMatchObject({ type: 'move', to: { x: 5, y: 2 } });
  });

  it('holds for a stale hidden actor goal without valid last-known investigation', () => {
    const state = createDemoRun();
    const monster = hostile({
      x: 5,
      y: 3,
      awareActorIds: [],
      behaviorState: {
        intent: 'approach',
        goal: { type: 'actor', targetActorId: 'hero.demo' },
        lastKnownTargets: [],
        investigation: null,
      },
    });
    expect(
      chooseBehaviorAction({
        state: { ...state, actors: [state.actors[0]!, monster] },
        actorId: monster.actorId,
        content: createDemoContentPack(),
      }),
    ).toMatchObject({ type: 'wait' });
  });

  it('runs a registered waypoint patrol while unaware', () => {
    const state = createDemoRun();
    const patrol = hostile({
      actorId: 'monster.patrol',
      contentId: 'monster.patrol',
      x: 5,
      y: 3,
      behaviorId: 'behavior.patrol',
      awareActorIds: [],
      behaviorState: {
        intent: 'approach',
        goal: { type: 'cell', floorId: 'floor.demo', x: 3, y: 3 },
        lastKnownTargets: [],
        investigation: null,
      },
    });
    expect(
      chooseBehaviorAction({
        state: { ...state, actors: [state.actors[0]!, patrol] },
        actorId: patrol.actorId,
        content: contentWithBehavior(patrol, {
          waypoints: [
            { x: 3, y: 3 },
            { x: 5, y: 1 },
          ],
        }),
      }),
    ).toMatchObject({ type: 'move', to: { x: 4, y: 3 } });
  });
});
