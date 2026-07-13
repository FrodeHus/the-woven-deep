import { describe, expect, it } from 'vitest';
import type { CompiledContentPack, ConditionContentEntry } from '@woven-deep/content';
import {
  actorHasConditionTrait,
  advanceConditions,
  applyCondition,
  conditionModifiers,
  createDemoContentPack,
  createDemoRun,
  validateActiveConditions,
  type ActorState,
} from '../src/index.js';

function definition(overrides: Partial<ConditionContentEntry> = {}): ConditionContentEntry {
  return {
    kind: 'condition', id: 'condition.test', name: 'Test', description: 'Test condition',
    tags: [], color: '#ffffff',
    duration: { mode: 'timed', default: 5, maximum: 20 },
    stacking: { mode: 'refresh', maximumStacks: 1 },
    modifiersPerStack: {}, traits: [], ...overrides,
  } as ConditionContentEntry;
}

function content(condition: ConditionContentEntry): CompiledContentPack {
  const base = createDemoContentPack();
  return { ...base, entries: [...base.entries.filter((entry) => entry.id !== condition.id), condition] };
}

function actorWith(conditionId: string, stacks = 1): ActorState {
  return {
    ...createDemoRun().actors[0]!,
    conditions: [{ conditionId, sourceActorId: 'hero.old', appliedAt: 2, expiresAt: 12, stacks }],
  };
}

function applyFixture(condition: ConditionContentEntry, actor = createDemoRun().actors[0]!, duration?: number) {
  return {
    actors: [actor], content: content(condition), targetActorId: actor.actorId,
    sourceActorId: 'hero.new', conditionId: condition.id, duration,
    worldTime: 10, eventId: 'event.condition',
  };
}

describe('condition deadlines', () => {
  it('resolves traits and linear modifiers by content rather than condition ID', () => {
    const condition = definition({
      id: 'condition.blue', traits: ['condition-trait.incapacitated'],
      modifiersPerStack: { defense: -2 },
      stacking: { mode: 'intensify', maximumStacks: 5 },
    });
    const actor = actorWith(condition.id, 3);
    expect(actorHasConditionTrait(actor, 'condition-trait.incapacitated', content(condition))).toBe(true);
    expect(conditionModifiers(actor, content(condition))).toEqual([{ defense: -6 }]);
  });

  it('rejects missing definitions, unsafe modifiers, and invalid saved instances', () => {
    const actor = actorWith('condition.missing');
    expect(() => actorHasConditionTrait(actor, 'condition-trait.incapacitated', createDemoContentPack()))
      .toThrow(/condition\.missing.*definition/i);
    const unsafe = definition({
      id: 'condition.unsafe', modifiersPerStack: { defense: Number.MAX_SAFE_INTEGER },
      stacking: { mode: 'intensify', maximumStacks: 2 },
    });
    expect(() => conditionModifiers(actorWith(unsafe.id, 2), content(unsafe))).toThrow(/safe integer/i);
    expect(() => validateActiveConditions([actorWith(unsafe.id, 3)], content(unsafe))).toThrow(/maximumStacks/i);
  });

  it.each([
    ['replace', { mode: 'replace', maximumStacks: 1 }, 1, 1],
    ['refresh', { mode: 'refresh', maximumStacks: 1 }, 1, 1],
    ['intensify', { mode: 'intensify', maximumStacks: 3 }, 2, 3],
    ['intensify at cap', { mode: 'intensify', maximumStacks: 3 }, 3, 3],
  ] as const)('applies %s stacking with a refreshed source and deadline', (_label, stacking, beforeStacks, afterStacks) => {
    const condition = definition({ id: `condition.${stacking.mode}`, stacking });
    const actor = actorWith(condition.id, beforeStacks);
    const result = applyCondition(applyFixture(condition, actor));
    expect(result.actors[0]?.conditions).toEqual([{
      conditionId: condition.id, sourceActorId: 'hero.new', appliedAt: 10, expiresAt: 15, stacks: afterStacks,
    }]);
    expect(result.events).toEqual([expect.objectContaining({
      type: 'condition.applied', stacks: afterStacks, expiresAt: 15,
    })]);
  });

  it('uses authored timed duration and permanent null deadlines', () => {
    const timed = definition({ id: 'condition.timed' });
    expect(applyCondition(applyFixture(timed, createDemoRun().actors[0]!, 7)).actors[0]?.conditions[0]?.expiresAt).toBe(17);
    const permanent = definition({
      id: 'condition.permanent', duration: { mode: 'permanent', default: null, maximum: null },
    });
    expect(applyCondition(applyFixture(permanent)).actors[0]?.conditions[0]?.expiresAt).toBeNull();
    expect(() => applyCondition(applyFixture(permanent, createDemoRun().actors[0]!, 1))).toThrow(/permanent.*duration/i);
  });

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
