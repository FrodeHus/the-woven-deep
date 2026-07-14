import type { EncounterContentEntry } from '@woven-deep/content';
import type { Uint32State } from './model.js';
import type { EncounterRunDecision } from './population-model.js';
import { compareCodeUnits } from './stable-json.js';
import { isNonZeroState, nextUint32 } from './random.js';

const UINT32_RANGE = 0x1_0000_0000;
const PROBABILITY_SCALE = 1_000_000_000_000;

export interface DiscoveryProtectionBonus {
  readonly encounterId: string;
  readonly bonus: number;
}

export interface EncounterDecisionResult {
  readonly decisions: readonly EncounterRunDecision[];
  readonly state: Uint32State;
}

export interface DiscoveryProtectionUpdate {
  readonly encounterId: string;
  readonly previousBonus: number;
  readonly nextBonus: number;
  readonly outcome: 'encountered' | 'reached-unseen' | 'unreached';
}

function probability(value: number): number {
  return Math.round(value * PROBABILITY_SCALE) / PROBABILITY_SCALE;
}

export function maximumDiscoveryProtectionBonus(encounter: EncounterContentEntry): number {
  return probability(encounter.discoveryProtectionCap - encounter.runAppearanceChance);
}

export function effectiveEncounterProbability(
  encounter: EncounterContentEntry, protectionBonus: number,
): number {
  return probability(Math.min(
    encounter.discoveryProtectionCap,
    probability(encounter.runAppearanceChance + protectionBonus),
  ));
}

function sortedEncounters(encounters: readonly EncounterContentEntry[]): readonly EncounterContentEntry[] {
  const sorted = [...encounters].sort((left, right) => compareCodeUnits(left.id, right.id));
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1]!.id === sorted[index]!.id) {
      throw new RangeError(`duplicate encounter ${sorted[index]!.id}`);
    }
  }
  return sorted;
}

function bonusMap(
  bonuses: readonly DiscoveryProtectionBonus[],
  encounters: ReadonlyMap<string, EncounterContentEntry>,
): ReadonlyMap<string, number> {
  const result = new Map<string, number>();
  let previousId: string | null = null;
  for (const entry of bonuses) {
    if (entry.encounterId === previousId) throw new RangeError(`duplicate protection bonus ${entry.encounterId}`);
    if (previousId !== null && compareCodeUnits(previousId, entry.encounterId) >= 0) {
      throw new RangeError('protection bonuses must be sorted by encounter ID');
    }
    const encounter = encounters.get(entry.encounterId);
    if (!encounter) throw new RangeError(`unknown encounter protection bonus ${entry.encounterId}`);
    const maximum = maximumDiscoveryProtectionBonus(encounter);
    if (!Number.isFinite(entry.bonus) || entry.bonus < 0) {
      throw new RangeError(`protection bonus for ${entry.encounterId} must be a non-negative probability`);
    }
    const normalizedBonus = probability(entry.bonus);
    if (normalizedBonus > maximum) {
      throw new RangeError(`protection bonus for ${entry.encounterId} exceeds its discovery protection cap`);
    }
    result.set(entry.encounterId, normalizedBonus);
    previousId = entry.encounterId;
  }
  return result;
}

function encounterMap(encounters: readonly EncounterContentEntry[]): ReadonlyMap<string, EncounterContentEntry> {
  return new Map(sortedEncounters(encounters).map((entry) => [entry.id, entry]));
}

function validateDecisionSet(
  decisions: readonly EncounterRunDecision[],
  encounters: ReadonlyMap<string, EncounterContentEntry>,
): void {
  if (decisions.length !== encounters.size) throw new RangeError('encounter decisions do not match current encounters');
  let previousId: string | null = null;
  for (const decision of decisions) {
    if (previousId !== null && compareCodeUnits(previousId, decision.encounterId) >= 0) {
      throw new RangeError('encounter decisions must be uniquely sorted by encounter ID');
    }
    if (!encounters.has(decision.encounterId)) throw new RangeError(`unknown encounter decision ${decision.encounterId}`);
    previousId = decision.encounterId;
  }
}

export function createEncounterRunDecisions(input: Readonly<{
  encounters: readonly EncounterContentEntry[];
  protectionBonuses?: readonly DiscoveryProtectionBonus[];
  state: Uint32State;
}>): EncounterDecisionResult {
  if (!isNonZeroState(input.state)) throw new RangeError('population gate random state must not be all zero');
  const encounters = sortedEncounters(input.encounters);
  const byId = new Map(encounters.map((entry) => [entry.id, entry]));
  const bonuses = bonusMap(input.protectionBonuses ?? [], byId);
  let state = input.state;
  const decisions = encounters.map((encounter): EncounterRunDecision => {
    const roll = nextUint32(state);
    state = roll.state;
    const protectionBonus = bonuses.get(encounter.id) ?? 0;
    const effectiveProbability = effectiveEncounterProbability(encounter, protectionBonus);
    return {
      encounterId: encounter.id,
      baseProbability: encounter.runAppearanceChance,
      protectionBonus,
      effectiveProbability,
      eligible: roll.value / UINT32_RANGE < effectiveProbability,
      reachedEligibleDepth: false,
      encountered: false,
      instancesCreated: 0,
    };
  });
  return { decisions, state };
}

export function recordReachedEncounterDepths(input: Readonly<{
  decisions: readonly EncounterRunDecision[];
  encounters: readonly EncounterContentEntry[];
  reachedDepths: readonly number[];
}>): readonly EncounterRunDecision[] {
  const encounters = encounterMap(input.encounters);
  validateDecisionSet(input.decisions, encounters);
  if (input.reachedDepths.some((depth) => !Number.isSafeInteger(depth) || depth < 0)) {
    throw new RangeError('reached depths must be non-negative safe integers');
  }
  return input.decisions.map((decision) => {
    if (decision.reachedEligibleDepth) return decision;
    const encounter = encounters.get(decision.encounterId)!;
    const reached = input.reachedDepths.some((depth) => depth >= encounter.minDepth && depth <= encounter.maxDepth);
    return reached ? { ...decision, reachedEligibleDepth: true } : decision;
  });
}

export function markEncounterObserved(
  decisions: readonly EncounterRunDecision[], encounterId: string,
): readonly EncounterRunDecision[] {
  const index = decisions.findIndex((decision) => decision.encounterId === encounterId);
  if (index < 0) throw new RangeError(`unknown encounter decision ${encounterId}`);
  const decision = decisions[index]!;
  if (decision.instancesCreated === 0) throw new RangeError('cannot observe an encounter without a created instance');
  if (decision.encountered) return decisions;
  return decisions.map((entry, entryIndex) => entryIndex === index
    ? { ...entry, reachedEligibleDepth: true, encountered: true } : entry);
}

export function evaluateDiscoveryProtection(input: Readonly<{
  decisions: readonly EncounterRunDecision[];
  encounters: readonly EncounterContentEntry[];
}>): readonly DiscoveryProtectionUpdate[] {
  const encounters = encounterMap(input.encounters);
  validateDecisionSet(input.decisions, encounters);
  return input.decisions.map((decision): DiscoveryProtectionUpdate => {
    const encounter = encounters.get(decision.encounterId)!;
    if (decision.encountered) {
      return { encounterId: decision.encounterId, previousBonus: decision.protectionBonus,
        nextBonus: 0, outcome: 'encountered' };
    }
    if (!decision.reachedEligibleDepth) {
      return { encounterId: decision.encounterId, previousBonus: decision.protectionBonus,
        nextBonus: decision.protectionBonus, outcome: 'unreached' };
    }
    const maximum = maximumDiscoveryProtectionBonus(encounter);
    const nextBonus = probability(Math.min(maximum,
      probability(decision.protectionBonus + encounter.discoveryProtectionIncrement)));
    return { encounterId: decision.encounterId, previousBonus: decision.protectionBonus,
      nextBonus, outcome: 'reached-unseen' };
  });
}
