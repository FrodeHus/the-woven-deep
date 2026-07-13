import { describe, expect, it } from 'vitest';
import {
  advanceToNextReady,
  chargeActionEnergy,
  createDemoRun,
  selectReadyActor,
  type ActorState,
} from '../src/index.js';

function actor(input: Partial<ActorState> & Pick<ActorState, 'actorId'>): ActorState {
  const base = createDemoRun().actors[0]!;
  return { ...base, playerControlled: false, ...input };
}

describe('integer-energy scheduler', () => {
  it('lets equal-speed enemies act once between normal hero actions', () => {
    const hero = actor({ actorId: 'hero.demo', playerControlled: true, energy: 0, speed: 100 });
    const enemy = actor({ actorId: 'monster.a', energy: 100, speed: 100 });
    expect(selectReadyActor([hero, enemy])?.actorId).toBe('monster.a');

    const afterEnemy = chargeActionEnergy(enemy, 100);
    expect(advanceToNextReady({ worldTime: 0, actors: [hero, afterEnemy] })).toMatchObject({
      worldTime: 1,
      selectedActorId: 'hero.demo',
    });
  });

  it('orders readiness by energy, player priority, then actor ID', () => {
    const actors = [
      actor({ actorId: 'monster.b', energy: 120 }),
      actor({ actorId: 'monster.a', energy: 120 }),
      actor({ actorId: 'hero.demo', playerControlled: true, energy: 120 }),
      actor({ actorId: 'monster.high', energy: 121 }),
    ];
    expect(selectReadyActor(actors)?.actorId).toBe('monster.high');
    expect(selectReadyActor(actors.slice(0, 3))?.actorId).toBe('hero.demo');
    expect(selectReadyActor(actors.slice(0, 2))?.actorId).toBe('monster.a');
  });

  it('excludes dead and incapacitated actors', () => {
    const dead = actor({ actorId: 'monster.dead', health: 0, energy: 1000 });
    const incapacitated = actor({
      actorId: 'monster.sleeping',
      energy: 1000,
      conditions: [{ conditionId: 'condition.incapacitated', sourceActorId: null, appliedAt: 0, expiresAt: null, stacks: 1 }],
    });
    const hero = actor({ actorId: 'hero.demo', playerControlled: true, energy: 100 });
    expect(selectReadyActor([dead, incapacitated, hero])?.actorId).toBe('hero.demo');
  });

  it('charges heavy actions into negative energy without mutation', () => {
    const before = actor({ actorId: 'hero.demo', playerControlled: true, energy: 100 });
    expect(chargeActionEnergy(before, 250)).toMatchObject({ energy: -150 });
    expect(before.energy).toBe(100);
  });

  it('fails deterministically on unsafe arithmetic', () => {
    expect(() => chargeActionEnergy(actor({ actorId: 'hero.demo', energy: Number.MIN_SAFE_INTEGER }), 1))
      .toThrow(/energy.*safe integer/i);
    expect(() => advanceToNextReady({
      worldTime: Number.MAX_SAFE_INTEGER,
      actors: [actor({ actorId: 'hero.demo', energy: 0, speed: 100 })],
    })).toThrow(/worldTime.*safe integer/i);
    expect(() => advanceToNextReady({
      worldTime: 0,
      actors: [actor({ actorId: 'hero.demo', energy: Number.MIN_SAFE_INTEGER, speed: 1 })],
    })).toThrow(/required energy.*safe integer/i);
  });
});
