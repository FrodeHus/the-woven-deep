import { z } from 'zod';
import { DERIVED_STAT_NAMES } from '@woven-deep/content';
import {
  attributes,
  heroName,
  identifier,
  nullableIdentifier,
  positiveQuantity,
  safeInteger,
  safeNonNegative,
  uint32,
  uint32State,
  uint32Tuple,
} from './primitives.js';
import { command, commandV7 } from './commands.js';
import {
  eventOptions,
  hiddenPublicEventTypes,
  merchantDepartedEvent,
  merchantDepartureWarningEvent,
  merchantDiedEvent,
  merchantProvokedEvent,
  merchantRestockedEvent,
  merchantStockDroppedEvent,
  populationCreatedEvent,
  processedResult,
  publicOnlyEventTypes,
  recorded,
  reputationChangedEvent,
  runConcludedEvent,
  runFinalizedEvent,
  tradeBoughtEvent,
  tradeClosedEvent,
  tradeOpenedEvent,
  tradeServicePurchasedEvent,
  tradeSoldEvent,
} from './events.js';
import { floor } from './floor.js';
import { actor, legacyActor } from './actor.js';
import {
  enchantment,
  feature,
  heirloomItemMetadata,
  item,
  itemFields,
  itemLocation,
  itemLocationV7,
  legacyItemLocation,
} from './item.js';
import {
  encounterDecision,
  fallenDecision,
  fallenStanding,
  heirloom,
  hero,
  heroV6,
  identification,
  legacyPopulation,
  population,
  populationV7,
  relationship,
  survival,
} from './population.js';
import { runConclusionSchema, runKillsByModel, runMetrics } from './run-record.js';
import { ENGINE_GAME_VERSION, RECENT_COMMAND_LIMIT } from '../versions.js';
import { RUN_MODES } from '../model.js';

// The pre-curse heirloom snapshot: identical to the live `heirloom` except it carries no `curse`,
// which the cursed-item feature introduced at v14. Spelled out as a frozen literal (not derived
// from the live `heirloom`) so a future schema bump can't silently change what a real pre-v14
// recorded heirloom is validated against. Shared by every legacy run schema (v4-v13): the heirloom
// shape has not changed across those versions apart from this field.
const legacyHeirloomV13 = z.strictObject({
  contentId: identifier,
  sourceItemId: nullableIdentifier,
  enchantment: z
    .strictObject({
      enchantmentId: identifier,
      modifiers: z.record(z.string(), z.number().int().safe()).readonly(),
    })
    .nullable(),
  condition: safeNonNegative,
  charges: safeNonNegative.nullable(),
  fuel: safeNonNegative.nullable(),
  qualityRank: safeNonNegative,
  displayName: heroName,
  glyph: z.string().refine((value) => [...value].length === 1, 'must be one Unicode glyph'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  originatingHallRecordId: identifier,
});
const legacyFallenStandingV13 = z.strictObject({
  rank: z.number().int().min(1).max(10),
  hallRecordId: identifier,
  heroName,
  portraitGlyph: z.string().refine((value) => [...value].length === 1),
  classTags: z.array(z.string().min(1).max(80)).readonly(),
  attributes,
  equippedItemContentIds: z.array(identifier).readonly(),
  signatureAbilityIds: z.array(identifier).readonly(),
  deathDepth: z.number().int().safe().positive(),
  sourceContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  heirloom: legacyHeirloomV13,
});

// The pre-haunt standing shape: identical to the live `fallenStanding` except it carries neither
// `cause` nor `deathInventory`, which the haunts feature introduced at v16. Spelled out as a frozen
// literal (not derived from the live `fallenStanding`) so a future schema bump can't silently
// change what every real pre-v16 standing (v4 through v15) is validated against. Every legacy
// active-run schema below v16 must reference this, never the live `fallenStanding` -- the live
// schema will keep moving out from under them.
const legacyFallenStandingPreHaunt = z.strictObject({
  rank: z.number().int().min(1).max(10),
  hallRecordId: identifier,
  heroName,
  portraitGlyph: z.string().refine((value) => [...value].length === 1),
  classTags: z.array(z.string().min(1).max(80)).readonly(),
  attributes,
  equippedItemContentIds: z.array(identifier).readonly(),
  signatureAbilityIds: z.array(identifier).readonly(),
  deathDepth: z.number().int().safe().positive(),
  sourceContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  heirloom,
});
// The pre-haunt decision shape: identical to the live `fallenDecision` except it carries no
// `appeased`, which the haunts feature introduced at v16. Spelled out as a frozen literal (not
// derived from the live `fallenDecision`) for the same reason as `legacyFallenStandingPreHaunt`
// above.
const legacyFallenDecisionPreHaunt = z.strictObject({
  hallRecordId: identifier,
  rank: z.number().int().min(1).max(10),
  role: z.enum(['champion', 'echo']),
  gateRoll: uint32.nullable(),
  retained: z.boolean(),
  encountered: z.boolean(),
  defeated: z.boolean(),
});

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
// The pre-parameterized-criteria achievement.granted shape: identical to the current event except
// it carries a `criteriaId` drawn from the old closed criteria registry. Spelled out as a frozen
// literal (not derived from the live content package, whose criteria registry is gone) so a future
// schema bump can't silently change what a real v6-v10 save's achievement events are validated
// against.
export const legacyAchievementGrantedEventV10 = z.strictObject({
  type: z.literal('achievement.granted'),
  eventId: identifier,
  achievementId: identifier,
  criteriaId: z.enum(['first-champion-defeat', 'first-echo-defeat']),
  name: heroName,
});
export const legacyEventV10 = z.discriminatedUnion('type', [
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
  merchantRestockedEvent,
  runConcludedEvent,
  runFinalizedEvent,
  legacyAchievementGrantedEventV10,
]);
export const legacyAuthoritativeEventV10 = legacyEventV10.refine(
  (value) => !publicOnlyEventTypes.has(value.type),
  'public projection event cannot be stored as authoritative',
);
export const legacyPublicEventV10 = legacyEventV10.refine(
  (value) => !hiddenPublicEventTypes.has(value.type),
  'authoritative or roll-bearing event must be projected before public storage',
);
export const recordedV7 = z.strictObject({
  command: commandV7,
  result: processedResult,
  events: z.array(legacyAuthoritativeEventV10).readonly(),
  publicEvents: z.array(legacyPublicEventV10).readonly(),
});
export const legacyRecordedV10 = z.strictObject({
  command,
  result: processedResult,
  events: z.array(legacyAuthoritativeEventV10).readonly(),
  publicEvents: z.array(legacyPublicEventV10).readonly(),
});
// The post-parameterized-criteria achievement.granted shape a v11 save carries: the v10 event with
// `criteriaId` dropped, exactly what `migrateV10ToV11` produces. Spelled out as a frozen literal so
// a future event change can't silently alter what a real v11 save is validated against.
export const legacyAchievementGrantedEventV11 = z.strictObject({
  type: z.literal('achievement.granted'),
  eventId: identifier,
  achievementId: identifier,
  name: heroName,
});
export const legacyEventV11 = z.discriminatedUnion('type', [
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
  merchantRestockedEvent,
  runConcludedEvent,
  runFinalizedEvent,
  legacyAchievementGrantedEventV11,
]);
export const legacyAuthoritativeEventV11 = legacyEventV11.refine(
  (value) => !publicOnlyEventTypes.has(value.type),
  'public projection event cannot be stored as authoritative',
);
export const legacyPublicEventV11 = legacyEventV11.refine(
  (value) => !hiddenPublicEventTypes.has(value.type),
  'authoritative or roll-bearing event must be projected before public storage',
);
export const legacyRecordedV11 = z.strictObject({
  command,
  result: processedResult,
  events: z.array(legacyAuthoritativeEventV11).readonly(),
  publicEvents: z.array(legacyPublicEventV11).readonly(),
});
// A v12 command record is byte-identical to a v11 one: the artifact bump at v13 added run fields
// only, no event or command shape. Aliased (rather than re-spelled) so the two frozen shapes can
// never drift apart, and named for v12 so a future event change freezes its own literal here.
// Not exported: knip rejects duplicate exports of one value, and nothing outside this file reads it.
const legacyRecordedV12 = legacyRecordedV11;
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
// The pre-tempering hero shape: identical to the live `hero` except it carries no `tempering`,
// which the hero-power-curve feature introduced at v17. Spelled out as a frozen literal (not
// derived from the live `hero`) so a future schema bump can't silently change what every real
// pre-v17 hero (v7 through v16) is validated against. Every legacy active-run schema below v17
// must reference this, never the live `hero` -- the live schema will keep moving out from under
// them.
export const legacyHeroPreTempering = z.strictObject({
  actorId: identifier,
  name: heroName,
  sightRadius: safeNonNegative,
  backpackCapacity: safeNonNegative,
  currency: safeNonNegative,
  classTags: z.array(z.string().trim().min(1)).readonly(),
  statModifiers: z.partialRecord(z.enum(DERIVED_STAT_NAMES), safeInteger),
  knownSpellIds: z.array(identifier).readonly().optional(),
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
// The ten streams every v6-v11 save carries, spelled out as a frozen literal rather than derived
// from the live `RNG_STREAM_NAMES`: a new stream must never retroactively become required of a
// genuine old save.
export const LEGACY_V11_RNG_STREAM_NAMES = [
  'generation',
  'encounters',
  'population-gates',
  'merchant-stock',
  'merchant-runtime',
  'combat',
  'loot',
  'effects',
  'narrative',
  'run-records',
] as const;
export const legacyRngEntries = Object.fromEntries(
  LEGACY_RNG_STREAM_NAMES.map((name) => [name, uint32State]),
);
export const legacyV5RngEntries = Object.fromEntries(
  LEGACY_V5_RNG_STREAM_NAMES.map((name) => [name, uint32State]),
);
export const legacyV11RngEntries = Object.fromEntries(
  LEGACY_V11_RNG_STREAM_NAMES.map((name) => [name, uint32State]),
) as Record<(typeof LEGACY_V11_RNG_STREAM_NAMES)[number], typeof uint32State>;
// The eleven streams a v12 save carries, spelled out as a frozen literal rather than derived from
// the live `RNG_STREAM_NAMES`: a new stream must never retroactively become required of a genuine
// v12 save.
export const LEGACY_V12_RNG_STREAM_NAMES = [
  'generation',
  'encounters',
  'population-gates',
  'merchant-stock',
  'merchant-runtime',
  'combat',
  'loot',
  'effects',
  'narrative',
  'run-records',
  'loot-placement',
] as const;
export const legacyV12RngEntries = Object.fromEntries(
  LEGACY_V12_RNG_STREAM_NAMES.map((name) => [name, uint32State]),
) as Record<(typeof LEGACY_V12_RNG_STREAM_NAMES)[number], typeof uint32State>;
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
// The pre-boss-tracking metrics shape: identical to the current `runMetrics` schema except it
// carries no `defeatedBossMonsterIds`. `metrics` has kept this exact shape since it was introduced
// at schema v6, so every legacy schema from v6 through v9 references this frozen shape too.
export const legacyRunMetricsV9 = z.strictObject({
  kills: safeNonNegative,
  killsByModel: runKillsByModel,
  bossKills: safeNonNegative,
  championKills: safeNonNegative,
  echoKills: safeNonNegative,
  threatDefeated: safeNonNegative,
  damageDealt: safeNonNegative,
  damageTaken: safeNonNegative,
  itemsCollected: safeNonNegative,
  itemsIdentified: safeNonNegative,
  currencyEarned: safeNonNegative,
  currencySpent: safeNonNegative,
  tradesCompleted: safeNonNegative,
  floorsEntered: safeNonNegative,
  deepestDepth: safeNonNegative,
  discoveriesRevealed: safeNonNegative,
  turnsElapsed: safeNonNegative,
  restsCompleted: safeNonNegative,
});

/** The pre-boss-tracking zero-value `metrics` literal, matching `legacyRunMetricsV9`. */
export const emptyLegacyRunMetricsV9: z.infer<typeof legacyRunMetricsV9> = {
  kills: 0,
  killsByModel: { individual: 0, group: 0, swarm: 0, boss: 0 },
  bossKills: 0,
  championKills: 0,
  echoKills: 0,
  threatDefeated: 0,
  damageDealt: 0,
  damageTaken: 0,
  itemsCollected: 0,
  itemsIdentified: 0,
  currencyEarned: 0,
  currencySpent: 0,
  tradesCompleted: 0,
  floorsEntered: 0,
  deepestDepth: 0,
  discoveriesRevealed: 0,
  turnsElapsed: 0,
  restsCompleted: 0,
};

export const legacyActiveRunV7Schema = z.strictObject({
  schemaVersion: z.literal(7),
  gameVersion: z.literal(ENGINE_GAME_VERSION),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  runId: identifier,
  runSeed: uint32Tuple,
  rng: z.strictObject(legacyV11RngEntries),
  revision: safeNonNegative,
  turn: safeNonNegative,
  worldTime: safeNonNegative,
  hero: legacyHeroPreTempering,
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
  fallenHeroStandings: z.array(legacyFallenStandingV13).max(10).readonly(),
  fallenHeroDecisions: z.array(legacyFallenDecisionPreHaunt).max(10).readonly(),
  conqueredChampionRecordIds: z.array(identifier).readonly(),
  metrics: legacyRunMetricsV9,
  conclusion: runConclusionSchema.nullable(),
});

// The pre-boss-tracking save shape: identical to the current run schema except `metrics` carries
// no `defeatedBossMonsterIds`. Spelled out as a frozen literal (not derived from the live
// `activeRunSchema`) so a future schema bump can't silently change what a real v9 save is
// validated against.
export const legacyActiveRunV9Schema = z.strictObject({
  schemaVersion: z.literal(9),
  gameVersion: z.literal(ENGINE_GAME_VERSION),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  runId: identifier,
  runSeed: uint32Tuple,
  rng: z.strictObject(legacyV11RngEntries),
  revision: safeNonNegative,
  turn: safeNonNegative,
  worldTime: safeNonNegative,
  hero: legacyHeroPreTempering,
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
  actors: z.array(actor).min(1).readonly(),
  items: z.array(item).readonly(),
  features: z.array(feature).readonly(),
  relationships: z.array(relationship).readonly(),
  survival,
  identification,
  activeFloorId: identifier,
  activeFloorEnteredAt: safeNonNegative,
  returnAnchorFloorId: identifier.optional(),
  floors: z.array(floor).min(1).readonly(),
  recentCommands: z.array(legacyRecordedV10).max(RECENT_COMMAND_LIMIT).readonly(),
  encounterDecisions: z.array(encounterDecision).readonly(),
  populations: z.array(population).readonly(),
  fallenHeroStandings: z.array(legacyFallenStandingV13).max(10).readonly(),
  fallenHeroDecisions: z.array(legacyFallenDecisionPreHaunt).max(10).readonly(),
  conqueredChampionRecordIds: z.array(identifier).readonly(),
  metrics: legacyRunMetricsV9,
  conclusion: runConclusionSchema.nullable(),
  house: z.strictObject({ capacity: positiveQuantity, upgradesPurchased: safeNonNegative }),
  restockedMilestones: z.array(positiveQuantity).readonly(),
});

// The pre-parameterized-criteria save shape: identical to the current run schema except achievement
// events carry `criteriaId`. Spelled out as a frozen literal (not derived from the live
// `activeRunSchema`) so a future schema bump can't silently change what a real v10 save is
// validated against.
export const legacyActiveRunV10Schema = z.strictObject({
  schemaVersion: z.literal(10),
  gameVersion: z.literal(ENGINE_GAME_VERSION),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  runId: identifier,
  runSeed: uint32Tuple,
  rng: z.strictObject(legacyV11RngEntries),
  revision: safeNonNegative,
  turn: safeNonNegative,
  worldTime: safeNonNegative,
  hero: legacyHeroPreTempering,
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
  actors: z.array(actor).min(1).readonly(),
  items: z.array(item).readonly(),
  features: z.array(feature).readonly(),
  relationships: z.array(relationship).readonly(),
  survival,
  identification,
  activeFloorId: identifier,
  activeFloorEnteredAt: safeNonNegative,
  returnAnchorFloorId: identifier.optional(),
  floors: z.array(floor).min(1).readonly(),
  recentCommands: z.array(legacyRecordedV10).max(RECENT_COMMAND_LIMIT).readonly(),
  encounterDecisions: z.array(encounterDecision).readonly(),
  populations: z.array(population).readonly(),
  fallenHeroStandings: z.array(legacyFallenStandingV13).max(10).readonly(),
  fallenHeroDecisions: z.array(legacyFallenDecisionPreHaunt).max(10).readonly(),
  conqueredChampionRecordIds: z.array(identifier).readonly(),
  metrics: runMetrics,
  conclusion: runConclusionSchema.nullable(),
  house: z.strictObject({ capacity: positiveQuantity, upgradesPurchased: safeNonNegative }),
  restockedMilestones: z.array(positiveQuantity).readonly(),
});

// The pre-curse item field set: identical to the live `itemFields` except it carries no `curse`,
// which the cursed-item feature introduced at v14. Spelled out as a frozen literal (not derived
// from the live `itemFields`) so a future schema bump can't silently change what a real v13 item is
// validated against.
const legacyItemFieldsV13 = {
  itemId: identifier,
  contentId: identifier,
  quantity: z.number().int().safe().positive(),
  condition: safeNonNegative,
  enchantment: enchantment.nullable(),
  identified: z.boolean(),
  charges: safeNonNegative.nullable(),
  fuel: safeNonNegative.nullable(),
  enabled: z.boolean().nullable(),
  heirloom: heirloomItemMetadata.optional(),
} as const;
const legacyItemV13 = z.strictObject({ ...legacyItemFieldsV13, location: itemLocation });

// The pre-tempering, eleven-stream save shape a real v16 save carries: identical to the current run
// schema except its `rng` is the frozen eleven-stream `legacyV12RngEntries` (no `enchanting`, which
// the hero-power-curve feature appended at v17) and its hero is pinned to the frozen
// `legacyHeroPreTempering` (no `tempering`, same feature). Its standings/decisions are the live
// `fallenStanding`/`fallenDecision` because haunts (v16) already shipped by this point. Spelled out
// as a frozen literal (not derived from the live `activeRunSchema`) so a future schema bump can't
// silently change what a real v16 save is validated against.
// The twelve RNG streams a v17 save carries. Frozen literal, like every legacy shape here: a future
// stream added to `RNG_STREAM_NAMES` must not change what a real v17 save is validated against.
const LEGACY_V17_RNG_STREAM_NAMES = [
  'generation',
  'encounters',
  'population-gates',
  'merchant-stock',
  'merchant-runtime',
  'combat',
  'loot',
  'effects',
  'narrative',
  'run-records',
  'loot-placement',
  'enchanting',
] as const;
const legacyV17RngEntries = Object.fromEntries(
  LEGACY_V17_RNG_STREAM_NAMES.map((name) => [name, uint32State]),
) as Record<(typeof LEGACY_V17_RNG_STREAM_NAMES)[number], typeof uint32State>;

// The pre-lifetime-fragments save shape: identical to the current run schema except it carries no
// `collectedFragmentIds`, which cross-run tablet assembly introduced at v18.
export const legacyActiveRunV17Schema = z.strictObject({
  schemaVersion: z.literal(17),
  gameVersion: z.literal(ENGINE_GAME_VERSION),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  mode: z.enum(RUN_MODES),
  runId: identifier,
  runSeed: uint32Tuple,
  rng: z.strictObject(legacyV17RngEntries),
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
  actors: z.array(actor).min(1).readonly(),
  items: z.array(item).readonly(),
  features: z.array(feature).readonly(),
  relationships: z.array(relationship).readonly(),
  survival,
  identification,
  activeFloorId: identifier,
  activeFloorEnteredAt: safeNonNegative,
  returnAnchorFloorId: identifier.optional(),
  floors: z.array(floor).min(1).readonly(),
  recentCommands: z.array(recorded).max(RECENT_COMMAND_LIMIT).readonly(),
  encounterDecisions: z.array(encounterDecision).readonly(),
  populations: z.array(population).readonly(),
  fallenHeroStandings: z.array(fallenStanding).max(10).readonly(),
  fallenHeroDecisions: z.array(fallenDecision).max(10).readonly(),
  conqueredChampionRecordIds: z.array(identifier).readonly(),
  offeredArtifact: identifier.nullable(),
  artifactsUndiscovered: z.array(identifier).readonly(),
  metrics: runMetrics,
  conclusion: runConclusionSchema.nullable(),
  house: z.strictObject({ capacity: positiveQuantity, upgradesPurchased: safeNonNegative }),
  restockedMilestones: z.array(positiveQuantity).readonly(),
});

export const legacyActiveRunV16Schema = z.strictObject({
  schemaVersion: z.literal(16),
  gameVersion: z.literal(ENGINE_GAME_VERSION),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  mode: z.enum(RUN_MODES),
  runId: identifier,
  runSeed: uint32Tuple,
  rng: z.strictObject(legacyV12RngEntries),
  revision: safeNonNegative,
  turn: safeNonNegative,
  worldTime: safeNonNegative,
  hero: legacyHeroPreTempering,
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
  actors: z.array(actor).min(1).readonly(),
  items: z.array(item).readonly(),
  features: z.array(feature).readonly(),
  relationships: z.array(relationship).readonly(),
  survival,
  identification,
  activeFloorId: identifier,
  activeFloorEnteredAt: safeNonNegative,
  returnAnchorFloorId: identifier.optional(),
  floors: z.array(floor).min(1).readonly(),
  recentCommands: z.array(recorded).max(RECENT_COMMAND_LIMIT).readonly(),
  encounterDecisions: z.array(encounterDecision).readonly(),
  populations: z.array(population).readonly(),
  fallenHeroStandings: z.array(fallenStanding).max(10).readonly(),
  fallenHeroDecisions: z.array(fallenDecision).max(10).readonly(),
  conqueredChampionRecordIds: z.array(identifier).readonly(),
  offeredArtifact: identifier.nullable(),
  artifactsUndiscovered: z.array(identifier).readonly(),
  metrics: runMetrics,
  conclusion: runConclusionSchema.nullable(),
  house: z.strictObject({ capacity: positiveQuantity, upgradesPurchased: safeNonNegative }),
  restockedMilestones: z.array(positiveQuantity).readonly(),
});

// The pre-haunt save shape: identical to the current run schema except its standings/decisions are
// pinned to the frozen pre-haunt shapes (no `cause`/`deathInventory`/`appeased`), which the haunts
// feature introduced at v16, and its hero is pinned to the frozen `legacyHeroPreTempering` (no
// `tempering`, introduced at v17). Spelled out as a frozen literal (not derived from the live
// `activeRunSchema`) so a future schema bump can't silently change what a real v15 save is validated
// against.
export const legacyActiveRunV15Schema = z.strictObject({
  schemaVersion: z.literal(15),
  gameVersion: z.literal(ENGINE_GAME_VERSION),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  mode: z.enum(RUN_MODES),
  runId: identifier,
  runSeed: uint32Tuple,
  rng: z.strictObject(legacyV12RngEntries),
  revision: safeNonNegative,
  turn: safeNonNegative,
  worldTime: safeNonNegative,
  hero: legacyHeroPreTempering,
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
  actors: z.array(actor).min(1).readonly(),
  items: z.array(item).readonly(),
  features: z.array(feature).readonly(),
  relationships: z.array(relationship).readonly(),
  survival,
  identification,
  activeFloorId: identifier,
  activeFloorEnteredAt: safeNonNegative,
  returnAnchorFloorId: identifier.optional(),
  floors: z.array(floor).min(1).readonly(),
  recentCommands: z.array(recorded).max(RECENT_COMMAND_LIMIT).readonly(),
  encounterDecisions: z.array(encounterDecision).readonly(),
  populations: z.array(population).readonly(),
  fallenHeroStandings: z.array(legacyFallenStandingPreHaunt).max(10).readonly(),
  fallenHeroDecisions: z.array(legacyFallenDecisionPreHaunt).max(10).readonly(),
  conqueredChampionRecordIds: z.array(identifier).readonly(),
  offeredArtifact: identifier.nullable(),
  artifactsUndiscovered: z.array(identifier).readonly(),
  metrics: runMetrics,
  conclusion: runConclusionSchema.nullable(),
  house: z.strictObject({ capacity: positiveQuantity, upgradesPurchased: safeNonNegative }),
  restockedMilestones: z.array(positiveQuantity).readonly(),
});

// The pre-run-mode save shape: identical to the current run schema except it carries no `mode`,
// which the run-mode feature introduced at v15, and its standings/decisions are pinned to the
// frozen pre-haunt shapes (the live `fallenStanding`/`fallenDecision` have since moved on with
// haunts at v16). Spelled out as a frozen literal (not derived from the live `activeRunSchema`) so
// a future schema bump can't silently change what a real v14 save is validated against. Its other
// sub-schemas (item, actor, hero, floors, rng, recorded commands) are the live ones because neither
// the run-mode nor the haunts bump touches them.
export const legacyActiveRunV14Schema = z.strictObject({
  schemaVersion: z.literal(14),
  gameVersion: z.literal(ENGINE_GAME_VERSION),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  runId: identifier,
  runSeed: uint32Tuple,
  rng: z.strictObject(legacyV12RngEntries),
  revision: safeNonNegative,
  turn: safeNonNegative,
  worldTime: safeNonNegative,
  hero: legacyHeroPreTempering,
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
  actors: z.array(actor).min(1).readonly(),
  items: z.array(item).readonly(),
  features: z.array(feature).readonly(),
  relationships: z.array(relationship).readonly(),
  survival,
  identification,
  activeFloorId: identifier,
  activeFloorEnteredAt: safeNonNegative,
  returnAnchorFloorId: identifier.optional(),
  floors: z.array(floor).min(1).readonly(),
  recentCommands: z.array(recorded).max(RECENT_COMMAND_LIMIT).readonly(),
  encounterDecisions: z.array(encounterDecision).readonly(),
  populations: z.array(population).readonly(),
  fallenHeroStandings: z.array(legacyFallenStandingPreHaunt).max(10).readonly(),
  fallenHeroDecisions: z.array(legacyFallenDecisionPreHaunt).max(10).readonly(),
  conqueredChampionRecordIds: z.array(identifier).readonly(),
  offeredArtifact: identifier.nullable(),
  artifactsUndiscovered: z.array(identifier).readonly(),
  metrics: runMetrics,
  conclusion: runConclusionSchema.nullable(),
  house: z.strictObject({ capacity: positiveQuantity, upgradesPurchased: safeNonNegative }),
  restockedMilestones: z.array(positiveQuantity).readonly(),
});

// The pre-curse save shape: identical to the current run schema except items and recorded
// heirlooms carry no `curse`, which the cursed-item feature introduced at v14. Spelled out as a
// frozen literal (not derived from the live `activeRunSchema`) so a future schema bump can't
// silently change what a real v13 save is validated against.
export const legacyActiveRunV13Schema = z.strictObject({
  schemaVersion: z.literal(13),
  gameVersion: z.literal(ENGINE_GAME_VERSION),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  runId: identifier,
  runSeed: uint32Tuple,
  rng: z.strictObject(legacyV12RngEntries),
  revision: safeNonNegative,
  turn: safeNonNegative,
  worldTime: safeNonNegative,
  hero: legacyHeroPreTempering,
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
  actors: z.array(actor).min(1).readonly(),
  items: z.array(legacyItemV13).readonly(),
  features: z.array(feature).readonly(),
  relationships: z.array(relationship).readonly(),
  survival,
  identification,
  activeFloorId: identifier,
  activeFloorEnteredAt: safeNonNegative,
  returnAnchorFloorId: identifier.optional(),
  floors: z.array(floor).min(1).readonly(),
  recentCommands: z.array(legacyRecordedV12).max(RECENT_COMMAND_LIMIT).readonly(),
  encounterDecisions: z.array(encounterDecision).readonly(),
  populations: z.array(population).readonly(),
  fallenHeroStandings: z.array(legacyFallenStandingV13).max(10).readonly(),
  fallenHeroDecisions: z.array(legacyFallenDecisionPreHaunt).max(10).readonly(),
  conqueredChampionRecordIds: z.array(identifier).readonly(),
  offeredArtifact: identifier.nullable(),
  artifactsUndiscovered: z.array(identifier).readonly(),
  metrics: runMetrics,
  conclusion: runConclusionSchema.nullable(),
  house: z.strictObject({ capacity: positiveQuantity, upgradesPurchased: safeNonNegative }),
  restockedMilestones: z.array(positiveQuantity).readonly(),
});

// The pre-artifact save shape: identical to the current run schema except it carries neither
// `offeredArtifact` nor `artifactsUndiscovered`, which the artifact offer introduced at v13.
// Spelled out as a frozen literal (not derived from the live `activeRunSchema`) so a future schema
// bump can't silently change what a real v12 save is validated against.
export const legacyActiveRunV12Schema = z.strictObject({
  schemaVersion: z.literal(12),
  gameVersion: z.literal(ENGINE_GAME_VERSION),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  runId: identifier,
  runSeed: uint32Tuple,
  rng: z.strictObject(legacyV12RngEntries),
  revision: safeNonNegative,
  turn: safeNonNegative,
  worldTime: safeNonNegative,
  hero: legacyHeroPreTempering,
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
  actors: z.array(actor).min(1).readonly(),
  items: z.array(item).readonly(),
  features: z.array(feature).readonly(),
  relationships: z.array(relationship).readonly(),
  survival,
  identification,
  activeFloorId: identifier,
  activeFloorEnteredAt: safeNonNegative,
  returnAnchorFloorId: identifier.optional(),
  floors: z.array(floor).min(1).readonly(),
  recentCommands: z.array(legacyRecordedV12).max(RECENT_COMMAND_LIMIT).readonly(),
  encounterDecisions: z.array(encounterDecision).readonly(),
  populations: z.array(population).readonly(),
  fallenHeroStandings: z.array(legacyFallenStandingV13).max(10).readonly(),
  fallenHeroDecisions: z.array(legacyFallenDecisionPreHaunt).max(10).readonly(),
  conqueredChampionRecordIds: z.array(identifier).readonly(),
  metrics: runMetrics,
  conclusion: runConclusionSchema.nullable(),
  house: z.strictObject({ capacity: positiveQuantity, upgradesPurchased: safeNonNegative }),
  restockedMilestones: z.array(positiveQuantity).readonly(),
});

// The pre-loot-placement save shape: identical to the current run schema except `rng` carries only
// the ten streams that existed before floor loot placement. Spelled out as a frozen literal (not
// derived from the live `activeRunSchema`) so a future schema bump can't silently change what a
// real v11 save is validated against.
export const legacyActiveRunV11Schema = z.strictObject({
  schemaVersion: z.literal(11),
  gameVersion: z.literal(ENGINE_GAME_VERSION),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  runId: identifier,
  runSeed: uint32Tuple,
  rng: z.strictObject(legacyV11RngEntries),
  revision: safeNonNegative,
  turn: safeNonNegative,
  worldTime: safeNonNegative,
  hero: legacyHeroPreTempering,
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
  actors: z.array(actor).min(1).readonly(),
  items: z.array(item).readonly(),
  features: z.array(feature).readonly(),
  relationships: z.array(relationship).readonly(),
  survival,
  identification,
  activeFloorId: identifier,
  activeFloorEnteredAt: safeNonNegative,
  returnAnchorFloorId: identifier.optional(),
  floors: z.array(floor).min(1).readonly(),
  recentCommands: z.array(legacyRecordedV11).max(RECENT_COMMAND_LIMIT).readonly(),
  encounterDecisions: z.array(encounterDecision).readonly(),
  populations: z.array(population).readonly(),
  fallenHeroStandings: z.array(legacyFallenStandingV13).max(10).readonly(),
  fallenHeroDecisions: z.array(legacyFallenDecisionPreHaunt).max(10).readonly(),
  conqueredChampionRecordIds: z.array(identifier).readonly(),
  metrics: runMetrics,
  conclusion: runConclusionSchema.nullable(),
  house: z.strictObject({ capacity: positiveQuantity, upgradesPurchased: safeNonNegative }),
  restockedMilestones: z.array(positiveQuantity).readonly(),
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
  rng: z.strictObject(legacyV11RngEntries),
  revision: safeNonNegative,
  turn: safeNonNegative,
  worldTime: safeNonNegative,
  hero: legacyHeroPreTempering,
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
  recentCommands: z.array(legacyRecordedV10).max(RECENT_COMMAND_LIMIT).readonly(),
  encounterDecisions: z.array(encounterDecision).readonly(),
  populations: z.array(population).readonly(),
  fallenHeroStandings: z.array(legacyFallenStandingV13).max(10).readonly(),
  fallenHeroDecisions: z.array(legacyFallenDecisionPreHaunt).max(10).readonly(),
  conqueredChampionRecordIds: z.array(identifier).readonly(),
  metrics: legacyRunMetricsV9,
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
  rng: z.strictObject(legacyV11RngEntries),
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
  fallenHeroStandings: z.array(legacyFallenStandingV13).max(10).readonly(),
  fallenHeroDecisions: z.array(legacyFallenDecisionPreHaunt).max(10).readonly(),
  conqueredChampionRecordIds: z.array(identifier).readonly(),
  metrics: legacyRunMetricsV9,
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
  fallenHeroStandings: z.array(legacyFallenStandingV13).max(10).readonly(),
  fallenHeroDecisions: z.array(legacyFallenDecisionPreHaunt).max(10).readonly(),
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
  fallenHeroStandings: z.array(legacyFallenStandingV13).max(10).readonly(),
  fallenHeroDecisions: z.array(legacyFallenDecisionPreHaunt).max(10).readonly(),
  conqueredChampionRecordIds: z.array(identifier).readonly(),
});
