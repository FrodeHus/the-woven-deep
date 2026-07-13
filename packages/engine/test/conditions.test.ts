import { describe, expect, it } from 'vitest';
import { advanceConditions, createDemoRun } from '../src/index.js';

describe('condition deadlines', () => {
  it('expires conditions at their absolute world-time deadline without mutation', () => {
    const actor = {
      ...createDemoRun().actors[0]!,
      conditions: [{
        conditionId: 'condition.rooted', sourceActorId: null, appliedAt: 4, expiresAt: 12, stacks: 1,
      }],
    };
    const before = structuredClone(actor);
    const result = advanceConditions({ actors: [actor], worldTime: 12, eventId: 'event.condition' });
    expect(result.actors[0]?.conditions).toEqual([]);
    expect(result.events).toContainEqual(expect.objectContaining({
      type: 'condition.expired', actorId: 'hero.demo', conditionId: 'condition.rooted',
    }));
    expect(actor).toEqual(before);
  });

  it('retains permanent and future conditions', () => {
    const base = createDemoRun().actors[0]!;
    const conditions = [
      { conditionId: 'condition.future', sourceActorId: null, appliedAt: 0, expiresAt: 13, stacks: 1 },
      { conditionId: 'condition.permanent', sourceActorId: null, appliedAt: 0, expiresAt: null, stacks: 1 },
    ];
    expect(advanceConditions({ actors: [{ ...base, conditions }], worldTime: 12, eventId: 'event.condition' }).events).toEqual([]);
  });
});
