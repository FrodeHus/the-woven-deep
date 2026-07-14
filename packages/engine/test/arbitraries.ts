import fc from 'fast-check';
import {
  createDemoContentPack, emptyEquipment, type ActorState, type FactionReputation,
  type MerchantServiceState, type Uint32State,
} from '../src/index.js';
import type { EncounterContentEntry } from '@woven-deep/content';

const identifierPart = fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/);

export const currencyArbitrary = fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER });

export const factionReputationArbitrary: fc.Arbitrary<FactionReputation> = fc.record({
  factionId: identifierPart.map((suffix) => `npc-faction.${suffix}`),
  value: fc.integer({ min: -1_000, max: 1_000 }),
});

export const merchantServiceStateArbitrary: fc.Arbitrary<MerchantServiceState> = fc.record({
  serviceId: fc.constant('merchant-service.identify' as const),
  basePrice: currencyArbitrary,
  remainingUses: fc.integer({ min: 0, max: 100 }),
  tierIds: fc.uniqueArray(identifierPart, { maxLength: 8 }).map((ids) => ids.sort()),
});

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
    behaviorState: { intent: 'hold', goal: null, lastKnownTargets: [], investigation: null },
    populationId: null,
    populationRoleId: null,
    populationPresentation: null,
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
  content: createDemoContentPack(),
  actors: [
    actor({ actorId: 'hero.test', playerControlled: true, ...hero }),
    ...enemies.map(({ suffix, ...enemy }) => actor({ actorId: `monster.${suffix}`, playerControlled: false, ...enemy })),
  ].sort((left, right) => left.actorId < right.actorId ? -1 : left.actorId > right.actorId ? 1 : 0),
}));

export const encounterGateInputArbitrary = fc.uniqueArray(fc.record({
  suffix: identifierPart,
  baseUnits: fc.integer({ min: 0, max: 80 }),
  roomUnits: fc.integer({ min: 0, max: 20 }),
  incrementUnits: fc.integer({ min: 0, max: 20 }),
}), { selector: ({ suffix }) => suffix, minLength: 1, maxLength: 12 }).chain((definitions) => {
  const encounters = definitions.map(({ suffix, baseUnits, roomUnits, incrementUnits }): EncounterContentEntry => ({
    kind: 'encounter', id: `encounter.${suffix}`, name: suffix, adminDescription: null, tags: [], model: 'individual',
    minDepth: 1, maxDepth: 10, environmentTags: [], requiredVaultTags: [], weight: 1, rarity: 'common',
    runAppearanceChance: baseUnits / 100, discoveryProtectionIncrement: incrementUnits / 100,
    discoveryProtectionCap: (baseUnits + roomUnits) / 100, maximumInstancesPerRun: 1,
    placement: { minimumStairDistance: 0, minimumObjectiveDistance: 0, maximumMemberDistance: 0,
      allowedTerrainTags: [], requiresVaultSlot: false, failureMode: 'optional' },
    intentPresentation: { visible: true },
    definition: { monsterId: 'monster.test', minimumQuantity: 1, maximumQuantity: 1 },
  }));
  return fc.tuple(
    fc.constant(encounters),
    fc.array(fc.integer({ min: 0, max: 20 }), { minLength: encounters.length, maxLength: encounters.length }),
    fc.tuple(fc.nat(), fc.nat(), fc.nat(), fc.integer({ min: 1, max: 0xffff_ffff })),
  ).map(([entries, bonusUnits, randomState]) => ({
    encounters: entries,
    bonuses: entries.map((entry, index) => ({
      encounterId: entry.id,
      bonus: Math.min(bonusUnits[index]! / 100, entry.discoveryProtectionCap - entry.runAppearanceChance),
    })).sort((left, right) => left.encounterId < right.encounterId ? -1 : left.encounterId > right.encounterId ? 1 : 0),
    state: randomState as Uint32State,
  }));
});

export { actor };
