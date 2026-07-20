import { z } from 'zod';
import { DERIVED_STAT_NAMES } from '@woven-deep/content';
import {
  attributes,
  heroName,
  identifier,
  nullableIdentifier,
  populationBase,
  positiveQuantity,
  safeInteger,
  safeNonNegative,
  uint32,
  uint32State,
} from './primitives.js';
import { lastKnownTarget } from './actor.js';
import { merchantPopulation, merchantPopulationV7 } from './merchant.js';

export const relationship = z.strictObject({
  leftActorId: identifier,
  rightActorId: identifier,
  relationship: z.enum(['friendly', 'neutral', 'hostile']),
});
export const survival = z.strictObject({
  hungerReserve: safeNonNegative,
  hungerStage: z.enum(['sated', 'hungry', 'weak', 'starving']),
  nextStarvationAt: safeNonNegative.nullable(),
  emittedHungerWarnings: z.array(z.enum(['sated', 'hungry', 'weak', 'starving'])).readonly(),
  emittedFuelWarnings: z.array(identifier).readonly(),
});
export const identification = z.strictObject({
  appearanceByContentId: z.record(identifier, identifier).readonly(),
  knownAppearanceIds: z.array(identifier).readonly(),
});
export const heroV6 = z.strictObject({
  actorId: identifier,
  name: heroName,
  sightRadius: safeNonNegative,
  backpackCapacity: safeNonNegative,
  currency: safeNonNegative,
});
export const hero = heroV6.extend({
  classTags: z.array(z.string().trim().min(1)).readonly(),
  statModifiers: z.partialRecord(z.enum(DERIVED_STAT_NAMES), safeInteger),
});
export const probability = z.number().finite().min(0).max(1);
export const encounterDecision = z.strictObject({
  encounterId: identifier,
  baseProbability: probability,
  protectionBonus: probability,
  effectiveProbability: probability,
  eligible: z.boolean(),
  reachedEligibleDepth: z.boolean(),
  encountered: z.boolean(),
  instancesCreated: safeNonNegative,
});
export const roleMembership = z.strictObject({
  actorId: identifier,
  roleId: z.string().min(1).max(80),
});
export const bossRewardReceipt = z.strictObject({
  lootStateBefore: uint32State,
  lootStateAfter: uint32State,
  items: z
    .array(
      z.strictObject({ itemId: identifier, contentId: identifier, quantity: positiveQuantity }),
    )
    .min(1)
    .readonly(),
});
export const legacyPopulation = z.discriminatedUnion('model', [
  z.strictObject({ ...populationBase, model: z.literal('individual') }),
  z.strictObject({
    ...populationBase,
    model: z.literal('group'),
    leaderActorId: nullableIdentifier,
    bonusActive: z.boolean(),
    roleMembership: z.array(roleMembership).readonly(),
    sharedKnowledge: z.array(lastKnownTarget).readonly(),
    leaderResponseApplied: z.boolean(),
    leaderResponseExpiresAt: safeNonNegative.nullable(),
  }),
  z.strictObject({
    ...populationBase,
    model: z.literal('swarm'),
    sourceActorId: identifier,
    nextSpawnAt: safeNonNegative,
    spawnedCount: safeNonNegative,
    peakLivingSize: safeNonNegative,
    shutdownState: z.enum(['stop', 'flee', 'decay', 'frenzy']).nullable(),
    emittedCapLevels: z.array(z.enum(['source', 'encounter', 'floor'])).readonly(),
    shutdownExpiresAt: safeNonNegative.nullable(),
  }),
  z.strictObject({
    ...populationBase,
    model: z.literal('boss'),
    actorId: identifier,
    currentPhaseId: z.string().min(1).max(80).nullable(),
    crossedPhaseIds: z.array(z.string().min(1).max(80)).readonly(),
    lastFloorExitAt: safeNonNegative.nullable(),
    rewardCreated: z.boolean(),
    rewardReceipt: bossRewardReceipt.nullable(),
    recoveryHistory: z
      .array(z.strictObject({ at: safeNonNegative, amount: safeNonNegative }))
      .readonly(),
  }),
  z.strictObject({
    ...populationBase,
    model: z.literal('champion'),
    actorId: identifier,
    hallRecordId: identifier,
    rank: z.literal(1),
    defeated: z.boolean(),
    rewardCreated: z.boolean(),
    equipmentContentIds: z.array(identifier).readonly(),
    abilityIds: z.array(identifier).readonly(),
  }),
  z.strictObject({
    ...populationBase,
    model: z.literal('echo'),
    actorId: identifier,
    hallRecordId: identifier,
    rank: z.number().int().min(2).max(10),
    defeated: z.boolean(),
    lootCreated: z.boolean(),
    equipmentContentIds: z.array(identifier).readonly(),
    abilityIds: z.array(identifier).readonly(),
  }),
]);
export const populationV7 = z.discriminatedUnion('model', [
  ...legacyPopulation.options,
  merchantPopulationV7,
]);
export const population = z.discriminatedUnion('model', [
  ...legacyPopulation.options,
  merchantPopulation,
]);
export const heirloom = z.strictObject({
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
export const fallenStanding = z.strictObject({
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
export const fallenDecision = z.strictObject({
  hallRecordId: identifier,
  rank: z.number().int().min(1).max(10),
  role: z.enum(['champion', 'echo']),
  gateRoll: uint32.nullable(),
  retained: z.boolean(),
  encountered: z.boolean(),
  defeated: z.boolean(),
});

import type { RelationshipOverride } from '../actor-model.js';
import type { IdentificationState } from '../item-model.js';
import type { SurvivalState } from '../survival-model.js';
import type {
  EncounterRunDecision,
  FallenHeroRunDecision,
  FallenHeroStandingSnapshot,
  PopulationInstance,
} from '../population-model.js';
import type { HeroState } from '../model.js';
import type { Expect, SchemaMatches } from './drift.js';
type _PopulationDrift = Expect<SchemaMatches<z.infer<typeof population>, PopulationInstance>>;
type _HeroDrift = Expect<SchemaMatches<z.infer<typeof hero>, HeroState>>;
type _EncounterDecisionDrift = Expect<
  SchemaMatches<z.infer<typeof encounterDecision>, EncounterRunDecision>
>;
type _FallenStandingDrift = Expect<
  SchemaMatches<z.infer<typeof fallenStanding>, FallenHeroStandingSnapshot>
>;
type _FallenDecisionDrift = Expect<
  SchemaMatches<z.infer<typeof fallenDecision>, FallenHeroRunDecision>
>;
type _SurvivalDrift = Expect<SchemaMatches<z.infer<typeof survival>, SurvivalState>>;
type _IdentificationDrift = Expect<
  SchemaMatches<z.infer<typeof identification>, IdentificationState>
>;
type _RelationshipDrift = Expect<SchemaMatches<z.infer<typeof relationship>, RelationshipOverride>>;
