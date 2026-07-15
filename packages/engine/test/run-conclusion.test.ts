import { describe, expect, it } from 'vitest';
import {
  concludeRunOnHeroDeath, createDemoContentPack, createDemoRun,
  type ActiveRun, type ActorState, type DomainEvent,
} from '../src/index.js';

function withHeroHealth(state: ActiveRun, health: number): ActiveRun {
  return { ...state, actors: state.actors.map((actor) => actor.actorId === state.hero.actorId ? { ...actor, health } : actor) };
}

describe('concludeRunOnHeroDeath', () => {
  const content = createDemoContentPack();

  it('leaves a living hero unchanged and appends no event', () => {
    const state = createDemoRun();
    const events: DomainEvent[] = [{ type: 'hero.waited', eventId: 'command.alive', heroId: state.hero.actorId, x: 1, y: 1 }];
    const concluded = concludeRunOnHeroDeath({ state, content, events, revision: 1, turn: 1, eventId: 'command.alive' });
    expect(concluded.state).toBe(state);
    expect(concluded.events).toBe(events);
  });

  it('credits the killer from the last hero actor.died event and appends run.concluded', () => {
    const base = createDemoRun();
    const killer: ActorState = {
      ...base.actors[0]!, actorId: 'monster.cave-rat.1', contentId: 'monster.cave-rat',
      playerControlled: false, disposition: 'hostile', populationId: null,
    };
    const deadHeroState: ActiveRun = {
      ...withHeroHealth(base, 0),
      actors: [...withHeroHealth(base, 0).actors, killer],
      floors: [{ ...base.floors[0]!, depth: 3 }],
      worldTime: 42,
    };
    const killingEvents: DomainEvent[] = [
      { type: 'attack.hit', eventId: 'command.fatal', actorId: killer.actorId, targetActorId: deadHeroState.hero.actorId,
        naturalRoll: 20, total: 30, defense: 8, critical: true, rolledDice: 2, rolledDamage: 20,
        effectiveDamage: 20, damageType: 'physical' },
      { type: 'actor.damaged', eventId: 'command.fatal', actorId: deadHeroState.hero.actorId,
        sourceActorId: killer.actorId, amount: 20, health: 0 },
      { type: 'actor.died', eventId: 'command.fatal', actorId: deadHeroState.hero.actorId,
        contentId: deadHeroState.actors.find((actor) => actor.actorId === deadHeroState.hero.actorId)!.contentId,
        killerActorId: killer.actorId },
    ];

    const concluded = concludeRunOnHeroDeath({
      state: deadHeroState, content, events: killingEvents,
      revision: 7, turn: 12, eventId: 'command.fatal',
    });

    expect(concluded.state.conclusion).toEqual({
      completionType: 'died',
      cause: { killerContentId: 'monster.cave-rat', depth: 3, turn: 12, worldTime: deadHeroState.worldTime },
      concludedAtRevision: 7,
      finalized: false,
    });
    expect(concluded.events.at(-1)).toMatchObject({ type: 'run.concluded', completionType: 'died' });
    expect(concluded.events.filter((event) => event.type === 'run.concluded')).toHaveLength(1);
  });

  it('credits no killer for an environmental death with no hero actor.died event in the transition', () => {
    const state = withHeroHealth(createDemoRun(), 0);
    const events: DomainEvent[] = [{ type: 'hero.waited', eventId: 'command.starve', heroId: state.hero.actorId, x: 1, y: 1 }];

    const concluded = concludeRunOnHeroDeath({ state, content, events, revision: 3, turn: 5, eventId: 'command.starve' });

    expect(concluded.state.conclusion?.cause.killerContentId).toBeNull();
    expect(concluded.events.at(-1)).toMatchObject({ type: 'run.concluded', completionType: 'died' });
  });

  it('credits no killer when the killer is the hero itself (self-kill)', () => {
    const state = withHeroHealth(createDemoRun(), 0);
    const heroContentId = state.actors.find((actor) => actor.actorId === state.hero.actorId)!.contentId;
    const events: DomainEvent[] = [
      { type: 'actor.damaged', eventId: 'command.starve', actorId: state.hero.actorId,
        sourceActorId: state.hero.actorId, amount: 1, health: 0 },
      { type: 'actor.died', eventId: 'command.starve', actorId: state.hero.actorId,
        contentId: heroContentId, killerActorId: state.hero.actorId },
    ];

    const concluded = concludeRunOnHeroDeath({ state, content, events, revision: 3, turn: 5, eventId: 'command.starve' });

    expect(concluded.state.conclusion?.cause.killerContentId).toBeNull();
  });

  it('is idempotent when the run is already concluded', () => {
    const base = withHeroHealth(createDemoRun(), 0);
    const state: ActiveRun = {
      ...base,
      conclusion: {
        completionType: 'died',
        cause: { killerContentId: null, depth: 1, turn: 1, worldTime: 1 },
        concludedAtRevision: 1,
        finalized: false,
      },
    };
    const events: DomainEvent[] = [
      { type: 'actor.died', eventId: 'command.again', actorId: state.hero.actorId,
        contentId: state.actors[0]!.contentId, killerActorId: state.hero.actorId },
    ];

    const concluded = concludeRunOnHeroDeath({ state, content, events, revision: 9, turn: 9, eventId: 'command.again' });

    expect(concluded.state).toBe(state);
    expect(concluded.events).toBe(events);
  });
});
