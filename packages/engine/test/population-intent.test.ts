import { describe, expect, it } from 'vitest';
import { emptyActorBehaviorState, selectPopulationIntent, updatePopulationIntent } from '../src/index.js';

describe('broad population intent', () => {
  it.each([
    ['phase-change', { phaseChange: true }],
    ['attack', { canAttack: true }],
    ['spawn', { shouldSpawn: true }],
    ['flee', { shouldFlee: true }],
    ['protect', { protectTarget: 'leader' as const }],
    ['regroup', { shouldRegroup: true }],
    ['approach', { hasTarget: true }],
    ['hold', {}],
  ] as const)('selects %s from authoritative state', (intent, context) => {
    expect(selectPopulationIntent(context)).toBe(intent);
  });

  it('emits only changes and exposes a target category without goal coordinates or path', () => {
    const first = updatePopulationIntent({
      eventId: 'event.intent.1', actorId: 'monster.one', state: emptyActorBehaviorState(),
      intent: 'approach', targetCategory: 'hero',
    });
    expect(first.event).toEqual({ type: 'actor.intent-changed', eventId: 'event.intent.1', actorId: 'monster.one',
      intent: 'approach', presentation: 'intent.approach', targetCategory: 'hero' });
    expect(JSON.stringify(first.event)).not.toMatch(/goal|path|"x":|"y":/);
    expect(updatePopulationIntent({ eventId: 'event.intent.2', actorId: 'monster.one', state: first.state,
      intent: 'approach', targetCategory: 'position' }).event).toBeNull();
  });
});
