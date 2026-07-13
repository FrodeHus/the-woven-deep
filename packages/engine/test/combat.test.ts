import { describe, expect, it } from 'vitest';
import {
  createDemoRun,
  expandLegacySeed,
  nextUint32,
  resolveAttack,
  resolveDamage,
  rollDie,
  type ActorState,
  type Uint32State,
} from '../src/index.js';

function stateProducing(face: number, sides = 20): Uint32State {
  const limit = Math.floor(0x1_0000_0000 / sides) * sides;
  for (let seed = 1; seed < 100_000; seed += 1) {
    const state = expandLegacySeed(seed);
    const step = nextUint32(state);
    if (step.value < limit && step.value % sides + 1 === face) return state;
  }
  throw new Error(`no state found for d${sides} face ${face}`);
}

function actors(targetHealth = 20): readonly ActorState[] {
  const hero = createDemoRun().actors[0]!;
  return [hero, {
    ...hero, actorId: 'monster.target', contentId: 'monster.target', playerControlled: false,
    x: 2, health: targetHealth, maxHealth: targetHealth, disposition: 'hostile',
  }];
}

function attack(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    eventId: 'command.attack', attackerId: 'hero.demo', targetActorId: 'monster.target', actors: actors(),
    combatState: stateProducing(10), accuracy: 5, defense: 10,
    damage: { count: 1, sides: 6, bonus: 2 }, armor: 0, resistance: 0, immune: false,
    damageType: 'physical' as const,
    ...overrides,
  };
}

describe('deterministic combat', () => {
  it('rolls unbiased bounded dice without mutating random state', () => {
    const state = stateProducing(6, 6);
    const before = [...state];
    expect(rollDie(state, 6).value).toBe(6);
    expect(state).toEqual(before);
    expect(() => rollDie(state, 0)).toThrow(/sides/i);
  });

  it('treats natural one as a miss and natural twenty as doubled damage dice', () => {
    expect(resolveAttack(attack({ combatState: stateProducing(1) })).events[0]).toMatchObject({
      type: 'attack.missed', naturalRoll: 1,
    });
    expect(resolveAttack(attack({ combatState: stateProducing(20) })).events).toContainEqual(expect.objectContaining({
      type: 'attack.hit', critical: true, rolledDice: 2,
    }));
  });

  it('applies armor and resistance with immunity allowed to reach zero', () => {
    expect(resolveDamage({ rolled: 10, armor: 3, resistance: 20, immune: false })).toBe(6);
    expect(resolveDamage({ rolled: 10, armor: 0, resistance: 0, immune: true })).toBe(0);
    expect(resolveDamage({ rolled: 1, armor: 99, resistance: 100, immune: false })).toBe(1);
  });

  it('reduces health, publishes effective values, and kills immediately', () => {
    const result = resolveAttack(attack({ combatState: stateProducing(20), actors: actors(1) }));
    expect(result.events.map((event) => event.type)).toEqual(['attack.hit', 'actor.damaged', 'actor.died']);
    expect(result.actors.find((actor) => actor.actorId === 'monster.target')?.health).toBe(0);
    expect(result.targetDied).toBe(true);
  });

  it('does not mutate actors or consume non-combat state', () => {
    const input = attack();
    const before = structuredClone(input);
    resolveAttack(input as Parameters<typeof resolveAttack>[0]);
    expect(input).toEqual(before);
  });
});
