import { z } from 'zod';
import {
  heroName,
  identifier,
  positiveQuantity,
  safeNonNegative,
  uint32State,
  uint32Tuple,
} from './primitives.js';
import { commandV7 } from './commands.js';
import {
  authoritativeEvent,
  eventOptions,
  hiddenPublicEventTypes,
  merchantDepartedEvent,
  merchantDepartureWarningEvent,
  merchantDiedEvent,
  merchantProvokedEvent,
  merchantStockDroppedEvent,
  populationCreatedEvent,
  processedResult,
  publicEvent,
  publicOnlyEventTypes,
  recorded,
  reputationChangedEvent,
  tradeBoughtEvent,
  tradeClosedEvent,
  tradeOpenedEvent,
  tradeServicePurchasedEvent,
  tradeSoldEvent,
} from './events.js';
import { floor } from './floor.js';
import { legacyActor } from './actor.js';
import { feature, item, itemFields, itemLocationV7, legacyItemLocation } from './item.js';
import {
  encounterDecision,
  fallenDecision,
  fallenStanding,
  hero,
  heroV6,
  identification,
  legacyPopulation,
  population,
  populationV7,
  relationship,
  survival,
} from './population.js';
import { rngEntries, runConclusionSchema, runMetrics } from './run-record.js';
import { ENGINE_GAME_VERSION, RECENT_COMMAND_LIMIT, type RNG_STREAM_NAMES } from '../versions.js';

export const legacyPopulationCreatedEvent = z.strictObject({
  type: z.literal('population.created'),
  eventId: identifier,
  populationId: identifier,
  encounterId: identifier,
  floorId: identifier,
  model: z.enum(['individual', 'group', 'swarm', 'boss', 'champion', 'echo']),
  actorIds: z.array(identifier).readonly(),
});
export const legacyEvent = z.discriminatedUnion('type', [
  ...eventOptions,
  legacyPopulationCreatedEvent,
]);
export const legacyAuthoritativeEvent = legacyEvent.refine(
  (value) => !publicOnlyEventTypes.has(value.type),
  'public projection event cannot be stored as authoritative',
);
export const legacyPublicEvent = legacyEvent.refine(
  (value) => !hiddenPublicEventTypes.has(value.type),
  'authoritative or roll-bearing event must be projected before public storage',
);
export const recordedV7 = z.strictObject({
  command: commandV7,
  result: processedResult,
  events: z.array(authoritativeEvent).readonly(),
  publicEvents: z.array(publicEvent).readonly(),
});
export const legacyRecorded = z.strictObject({
  command: commandV7,
  result: processedResult,
  events: z.array(legacyAuthoritativeEvent).readonly(),
  publicEvents: z.array(legacyPublicEvent).readonly(),
});
export const legacyItem = z.strictObject({ ...itemFields, location: legacyItemLocation });
export const itemV7 = z.strictObject({ ...itemFields, location: itemLocationV7 });
export const legacyHero = z.strictObject({
  actorId: identifier,
  name: heroName,
  sightRadius: safeNonNegative,
  backpackCapacity: safeNonNegative,
});
export const LEGACY_RNG_STREAM_NAMES = [
  'generation',
  'encounters',
  'population-gates',
  'combat',
  'loot',
  'effects',
  'narrative',
] as const;
export const LEGACY_V5_RNG_STREAM_NAMES = [
  'generation',
  'encounters',
  'population-gates',
  'merchant-stock',
  'merchant-runtime',
  'combat',
  'loot',
  'effects',
  'narrative',
] as const;
export const legacyRngEntries = Object.fromEntries(
  LEGACY_RNG_STREAM_NAMES.map((name) => [name, uint32State]),
);
export const legacyV5RngEntries = Object.fromEntries(
  LEGACY_V5_RNG_STREAM_NAMES.map((name) => [name, uint32State]),
);
export const legacyV5Event = z.discriminatedUnion('type', [
  ...eventOptions,
  populationCreatedEvent,
  reputationChangedEvent,
  tradeOpenedEvent,
  tradeBoughtEvent,
  tradeSoldEvent,
  tradeServicePurchasedEvent,
  tradeClosedEvent,
  merchantDepartureWarningEvent,
  merchantDepartedEvent,
  merchantProvokedEvent,
  merchantStockDroppedEvent,
  merchantDiedEvent,
]);
export const legacyV5AuthoritativeEvent = legacyV5Event.refine(
  (value) => !publicOnlyEventTypes.has(value.type),
  'public projection event cannot be stored as authoritative',
);
export const legacyV5PublicEvent = legacyV5Event.refine(
  (value) => !hiddenPublicEventTypes.has(value.type),
  'authoritative or roll-bearing event must be projected before public storage',
);
export const legacyV5Recorded = z.strictObject({
  command: commandV7,
  result: processedResult,
  events: z.array(legacyV5AuthoritativeEvent).readonly(),
  publicEvents: z.array(legacyV5PublicEvent).readonly(),
});
export const legacyActiveRunV7Schema = z.strictObject({
  schemaVersion: z.literal(7),
  gameVersion: z.literal(ENGINE_GAME_VERSION),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  runId: identifier,
  runSeed: uint32Tuple,
  rng: z.strictObject(rngEntries as Record<(typeof RNG_STREAM_NAMES)[number], typeof uint32State>),
  revision: safeNonNegative,
  turn: safeNonNegative,
  worldTime: safeNonNegative,
  hero,
  reputations: z
    .array(z.strictObject({ factionId: identifier, value: z.number().int().safe() }))
    .readonly(),
  activeTrade: z
    .strictObject({
      merchantPopulationId: identifier,
      merchantActorId: identifier,
      openedByCommandId: identifier,
      openedAtRevision: safeNonNegative,
      completedCommerce: z.boolean(),
    })
    .nullable(),
  actors: z.array(legacyActor).min(1).readonly(),
  items: z.array(itemV7).readonly(),
  features: z.array(feature).readonly(),
  relationships: z.array(relationship).readonly(),
  survival,
  identification,
  activeFloorId: identifier,
  activeFloorEnteredAt: safeNonNegative,
  floors: z.array(floor).min(1).readonly(),
  recentCommands: z.array(recordedV7).max(RECENT_COMMAND_LIMIT).readonly(),
  encounterDecisions: z.array(encounterDecision).readonly(),
  populations: z.array(populationV7).readonly(),
  fallenHeroStandings: z.array(fallenStanding).max(10).readonly(),
  fallenHeroDecisions: z.array(fallenDecision).max(10).readonly(),
  conqueredChampionRecordIds: z.array(identifier).readonly(),
  metrics: runMetrics,
  conclusion: runConclusionSchema.nullable(),
});

// The pre-Weave save shape: identical to the current run schema except actors carry no
// `weave`/`maxWeave`. Spelled out as a frozen literal (not derived from the live
// `activeRunSchema`) so a future schema bump can't silently change what a real v8 save is
// validated against.
export const legacyActiveRunV8Schema = z.strictObject({
  schemaVersion: z.literal(8),
  gameVersion: z.literal(ENGINE_GAME_VERSION),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  runId: identifier,
  runSeed: uint32Tuple,
  rng: z.strictObject(rngEntries as Record<(typeof RNG_STREAM_NAMES)[number], typeof uint32State>),
  revision: safeNonNegative,
  turn: safeNonNegative,
  worldTime: safeNonNegative,
  hero,
  reputations: z
    .array(z.strictObject({ factionId: identifier, value: z.number().int().safe() }))
    .readonly(),
  activeTrade: z
    .strictObject({
      merchantPopulationId: identifier,
      merchantActorId: identifier,
      openedByCommandId: identifier,
      openedAtRevision: safeNonNegative,
      completedCommerce: z.boolean(),
    })
    .nullable(),
  actors: z.array(legacyActor).min(1).readonly(),
  items: z.array(item).readonly(),
  features: z.array(feature).readonly(),
  relationships: z.array(relationship).readonly(),
  survival,
  identification,
  activeFloorId: identifier,
  activeFloorEnteredAt: safeNonNegative,
  floors: z.array(floor).min(1).readonly(),
  recentCommands: z.array(recorded).max(RECENT_COMMAND_LIMIT).readonly(),
  encounterDecisions: z.array(encounterDecision).readonly(),
  populations: z.array(population).readonly(),
  fallenHeroStandings: z.array(fallenStanding).max(10).readonly(),
  fallenHeroDecisions: z.array(fallenDecision).max(10).readonly(),
  conqueredChampionRecordIds: z.array(identifier).readonly(),
  metrics: runMetrics,
  conclusion: runConclusionSchema.nullable(),
  house: z.strictObject({ capacity: positiveQuantity, upgradesPurchased: safeNonNegative }),
  restockedMilestones: z.array(positiveQuantity).readonly(),
});

export const legacyActiveRunV6Schema = z.strictObject({
  schemaVersion: z.literal(6),
  gameVersion: z.literal(ENGINE_GAME_VERSION),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  runId: identifier,
  runSeed: uint32Tuple,
  rng: z.strictObject(rngEntries as Record<(typeof RNG_STREAM_NAMES)[number], typeof uint32State>),
  revision: safeNonNegative,
  turn: safeNonNegative,
  worldTime: safeNonNegative,
  hero: heroV6,
  reputations: z
    .array(z.strictObject({ factionId: identifier, value: z.number().int().safe() }))
    .readonly(),
  activeTrade: z
    .strictObject({
      merchantPopulationId: identifier,
      merchantActorId: identifier,
      openedByCommandId: identifier,
      openedAtRevision: safeNonNegative,
      completedCommerce: z.boolean(),
    })
    .nullable(),
  actors: z.array(legacyActor).min(1).readonly(),
  items: z.array(itemV7).readonly(),
  features: z.array(feature).readonly(),
  relationships: z.array(relationship).readonly(),
  survival,
  identification,
  activeFloorId: identifier,
  activeFloorEnteredAt: safeNonNegative,
  floors: z.array(floor).min(1).readonly(),
  recentCommands: z.array(recordedV7).max(RECENT_COMMAND_LIMIT).readonly(),
  encounterDecisions: z.array(encounterDecision).readonly(),
  populations: z.array(populationV7).readonly(),
  fallenHeroStandings: z.array(fallenStanding).max(10).readonly(),
  fallenHeroDecisions: z.array(fallenDecision).max(10).readonly(),
  conqueredChampionRecordIds: z.array(identifier).readonly(),
  metrics: runMetrics,
  conclusion: runConclusionSchema.nullable(),
});

export const legacyActiveRunV5Schema = z.strictObject({
  schemaVersion: z.literal(5),
  gameVersion: z.literal(ENGINE_GAME_VERSION),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  runId: identifier,
  runSeed: uint32Tuple,
  rng: z.strictObject(
    legacyV5RngEntries as Record<(typeof LEGACY_V5_RNG_STREAM_NAMES)[number], typeof uint32State>,
  ),
  revision: safeNonNegative,
  turn: safeNonNegative,
  worldTime: safeNonNegative,
  hero: heroV6,
  reputations: z
    .array(z.strictObject({ factionId: identifier, value: z.number().int().safe() }))
    .readonly(),
  activeTrade: z
    .strictObject({
      merchantPopulationId: identifier,
      merchantActorId: identifier,
      openedByCommandId: identifier,
      openedAtRevision: safeNonNegative,
      completedCommerce: z.boolean(),
    })
    .nullable(),
  actors: z.array(legacyActor).min(1).readonly(),
  items: z.array(itemV7).readonly(),
  features: z.array(feature).readonly(),
  relationships: z.array(relationship).readonly(),
  survival,
  identification,
  activeFloorId: identifier,
  activeFloorEnteredAt: safeNonNegative,
  floors: z.array(floor).min(1).readonly(),
  recentCommands: z.array(legacyV5Recorded).max(RECENT_COMMAND_LIMIT).readonly(),
  encounterDecisions: z.array(encounterDecision).readonly(),
  populations: z.array(populationV7).readonly(),
  fallenHeroStandings: z.array(fallenStanding).max(10).readonly(),
  fallenHeroDecisions: z.array(fallenDecision).max(10).readonly(),
  conqueredChampionRecordIds: z.array(identifier).readonly(),
});

export const legacyActiveRunV4Schema = z.strictObject({
  schemaVersion: z.literal(4),
  gameVersion: z.literal(ENGINE_GAME_VERSION),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  runId: identifier,
  runSeed: uint32Tuple,
  rng: z.strictObject(
    legacyRngEntries as Record<(typeof LEGACY_RNG_STREAM_NAMES)[number], typeof uint32State>,
  ),
  revision: safeNonNegative,
  turn: safeNonNegative,
  worldTime: safeNonNegative,
  hero: legacyHero,
  actors: z.array(legacyActor).min(1).readonly(),
  items: z.array(legacyItem).readonly(),
  features: z.array(feature).readonly(),
  relationships: z.array(relationship).readonly(),
  survival,
  identification,
  activeFloorId: identifier,
  activeFloorEnteredAt: safeNonNegative,
  floors: z.array(floor).min(1).readonly(),
  recentCommands: z.array(legacyRecorded).max(RECENT_COMMAND_LIMIT).readonly(),
  encounterDecisions: z.array(encounterDecision).readonly(),
  populations: z.array(legacyPopulation).readonly(),
  fallenHeroStandings: z.array(fallenStanding).max(10).readonly(),
  fallenHeroDecisions: z.array(fallenDecision).max(10).readonly(),
  conqueredChampionRecordIds: z.array(identifier).readonly(),
});
