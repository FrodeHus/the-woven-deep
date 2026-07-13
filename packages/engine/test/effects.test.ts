import { describe, expect, it } from 'vitest';
import {
  createDemoContentPack,
  createDemoRun,
  expandLegacySeed,
  resolveEffectSequence,
  type ActorState,
} from '../src/index.js';
import type { ConditionContentEntry } from '@woven-deep/content';

function effectContent() {
  const base = createDemoContentPack();
  const conditions: ConditionContentEntry[] = ['condition.burning', 'condition.slow'].map((id) => ({
    kind: 'condition', id, name: id, description: id, tags: [], color: '#ffffff',
    duration: { mode: 'timed', default: 3, maximum: 30 },
    stacking: { mode: 'intensify', maximumStacks: 5 }, modifiersPerStack: {}, traits: [],
  }));
  return { ...base, entries: [...base.entries, ...conditions] };
}

function actors(health = 10): readonly ActorState[] {
  const hero = createDemoRun().actors[0]!;
  return [hero, {
    ...hero, actorId: 'monster.target', contentId: 'monster.target', playerControlled: false,
    x: 2, health, maxHealth: 10, disposition: 'hostile',
  }];
}

function fixture(effects: readonly any[], health = 10) {
  return {
    effects,
    actors: actors(health),
    content: effectContent(),
    sourceActorId: 'hero.demo',
    targetActorId: 'monster.target',
    effectsState: expandLegacySeed(42),
    worldTime: 12,
    eventId: 'command.effect',
    forceMoveDirection: { x: 1, y: 0 } as const,
    operations: {},
  };
}

describe('ordered effects', () => {
  it('applies damage then a condition in authored order', () => {
    const result = resolveEffectSequence(fixture([
      { effectId: 'effect.damage', parameters: { damageType: 'fire', dice: { count: 1, sides: 1, bonus: 0 } }, requiresLivingTarget: true },
      { effectId: 'effect.condition.apply', parameters: { conditionId: 'condition.burning', duration: 3 }, requiresLivingTarget: true },
    ]));
    expect(result.events.map((event) => event.type)).toEqual(['attack.hit', 'actor.damaged', 'condition.applied']);
    expect(result.actors[1]?.conditions).toContainEqual(expect.objectContaining({
      conditionId: 'condition.burning', appliedAt: 12, expiresAt: 15,
    }));
  });

  it('skips living-target effects after target death', () => {
    const result = resolveEffectSequence(fixture([
      { effectId: 'effect.damage', parameters: { damageType: 'fire', dice: { count: 1, sides: 1, bonus: 0 } }, requiresLivingTarget: true },
      { effectId: 'effect.condition.apply', parameters: { conditionId: 'condition.burning', duration: 3 }, requiresLivingTarget: true },
    ], 1));
    expect(result.events.map((event) => event.type)).toEqual(['attack.hit', 'actor.damaged', 'actor.died']);
  });

  it('prevalidates every effect before applying the first', () => {
    const input = fixture([
      { effectId: 'effect.heal', parameters: { dice: { count: 1, sides: 4, bonus: 0 } }, requiresLivingTarget: false },
      { effectId: 'effect.unknown', parameters: {}, requiresLivingTarget: false },
    ]);
    const before = structuredClone(input);
    expect(() => resolveEffectSequence(input)).toThrow(/unregistered effect/i);
    expect(input).toEqual(before);
  });

  it('heals, removes conditions, and force-moves directly', () => {
    const base = actors(3);
    const target = { ...base[1]!, conditions: [{
      conditionId: 'condition.slow', sourceActorId: 'hero.demo', appliedAt: 1, expiresAt: 20, stacks: 1,
    }] };
    const result = resolveEffectSequence({
      ...fixture([
        { effectId: 'effect.heal', parameters: { dice: { count: 1, sides: 1, bonus: 2 } }, requiresLivingTarget: true },
        { effectId: 'effect.condition.remove', parameters: { conditionId: 'condition.slow' }, requiresLivingTarget: true },
        { effectId: 'effect.force-move', parameters: { distance: 2 }, requiresLivingTarget: true },
      ]),
      actors: [base[0]!, target],
    });
    expect(result.events.map((event) => event.type)).toEqual([
      'actor.healed', 'condition.removed', 'actor.forced-move',
    ]);
    expect(result.actors[1]).toMatchObject({ health: 6, x: 4, conditions: [] });
  });

  it.each([
    'effect.reveal',
    'effect.fuel.transfer',
    'effect.light.toggle',
    'effect.item.consume',
    'effect.feature.mutate',
  ] as const)('delegates %s only after validating the full sequence', (effectId) => {
    const parameters = {
      'effect.reveal': { radius: 2 },
      'effect.fuel.transfer': { maximum: 10 },
      'effect.light.toggle': { enabled: true },
      'effect.item.consume': { quantity: 1 },
      'effect.feature.mutate': { state: 'door.open' },
    }[effectId];
    let calls = 0;
    const result = resolveEffectSequence({
      ...fixture([{ effectId, parameters, requiresLivingTarget: false }]),
      operations: {
        [effectId]: (input) => {
          calls += 1;
          return { actors: input.actors, events: [] };
        },
      },
    });
    expect(calls).toBe(1);
    expect(result.actors).toEqual(actors());
  });

  it('rejects invalid forced movement direction before changing state', () => {
    const input = {
      ...fixture([{ effectId: 'effect.force-move', parameters: { distance: 1 }, requiresLivingTarget: true }]),
      forceMoveDirection: { x: 0, y: 0 },
    };
    expect(() => resolveEffectSequence(input)).toThrow(/unit direction/i);
  });
});
