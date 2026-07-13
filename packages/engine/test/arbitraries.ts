import fc from 'fast-check';
import { emptyEquipment, type ActorState } from '../src/index.js';

const identifierPart = fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/);

function actor(input: Readonly<{
  actorId: string;
  playerControlled: boolean;
  health: number;
  energy: number;
  speed: number;
}>): ActorState {
  return {
    actorId: input.actorId,
    contentId: input.playerControlled ? 'hero.adventurer' : 'monster.test',
    playerControlled: input.playerControlled,
    floorId: 'floor.test',
    x: 0,
    y: 0,
    attributes: { might: 10, agility: 10, vitality: 10, wits: 10, resolve: 10 },
    health: input.health,
    maxHealth: Math.max(1, input.health),
    energy: input.energy,
    speed: input.speed,
    reactionReady: true,
    disposition: input.playerControlled ? 'friendly' : 'hostile',
    awareActorIds: [],
    conditions: [],
    equipment: emptyEquipment(),
    behaviorId: input.playerControlled ? null : 'behavior.approach-and-attack',
    behaviorState: {},
  };
}

export const actorStateArbitrary: fc.Arbitrary<ActorState> = fc.record({
  suffix: identifierPart,
  playerControlled: fc.boolean(),
  health: fc.integer({ min: 0, max: 100 }),
  energy: fc.integer({ min: -10_000, max: 10_000 }),
  speed: fc.integer({ min: 1, max: 400 }),
}).map(({ suffix, ...input }) => actor({ actorId: `actor.${suffix}`, ...input }));

export const schedulerStateArbitrary = fc.record({
  worldTime: fc.integer({ min: 0, max: 1_000_000 }),
  hero: fc.record({
    health: fc.integer({ min: 1, max: 100 }),
    energy: fc.integer({ min: -10_000, max: 10_000 }),
    speed: fc.integer({ min: 1, max: 400 }),
  }),
  enemies: fc.uniqueArray(fc.record({
    suffix: identifierPart,
    health: fc.integer({ min: 0, max: 100 }),
    energy: fc.integer({ min: -10_000, max: 10_000 }),
    speed: fc.integer({ min: 1, max: 400 }),
  }), { selector: ({ suffix }) => suffix, maxLength: 12 }),
}).map(({ worldTime, hero, enemies }) => ({
  worldTime,
  actors: [
    actor({ actorId: 'hero.test', playerControlled: true, ...hero }),
    ...enemies.map(({ suffix, ...enemy }) => actor({ actorId: `monster.${suffix}`, playerControlled: false, ...enemy })),
  ].sort((left, right) => left.actorId < right.actorId ? -1 : left.actorId > right.actorId ? 1 : 0),
}));

export { actor };
