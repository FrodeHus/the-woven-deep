import type { AchievementCriteriaId, CompletionType } from '@woven-deep/content';
import type { BaseAttributes } from './actor-model.js';
import type { FactionReputation } from './merchant-model.js';
import { assertOpaqueId, type OpaqueId, type Uint32State } from './model.js';
import type { DiscoveryProtectionBonus, DiscoveryProtectionUpdate } from './population-gates.js';
import type { RecordedHeirloomSnapshot } from './population-model.js';
import type { RunConclusion } from './run-conclusion.js';
import type { RunMetrics } from './run-metrics.js';
import type { ScoreBreakdown } from './score-run.js';

export interface FallenHeroBuildSnapshot {
  readonly attributes: BaseAttributes;
  readonly equippedItemContentIds: readonly OpaqueId[];   // sorted unique
  readonly signatureAbilityIds: readonly OpaqueId[];      // [] in 4B3 (no hero spellbook state yet)
}

export interface HallRecord {
  readonly recordId: OpaqueId;            // deterministic: derived from run seed + content hash
  readonly heroName: string;
  readonly classTags: readonly string[];
  readonly completionType: CompletionType;
  readonly cause: RunConclusion['cause'];
  readonly deepestDepth: number;
  readonly score: ScoreBreakdown;
  readonly metrics: RunMetrics;           // copied snapshot
  readonly reputations: readonly FactionReputation[]; // finalized statistics
  readonly heirloom: RecordedHeirloomSnapshot;
  readonly build: FallenHeroBuildSnapshot; // engine facts feeding 4B1 standings normalization
  readonly runSeed: string;
  readonly contentHash: string;
}

/**
 * Host-enriched display fields stay outside `HallRecord`; the enrichment vocabulary is closed to
 * exactly the achieved-at date and portrait/appearance. The engine never produces either value.
 */
export interface HallRecordEnrichment {
  readonly achievedAt: string;            // host-supplied ISO date; never engine-produced
  readonly portraitGlyph: string;         // host-supplied appearance; '@' default
}

export interface StoredHallRecord extends HallRecord {
  readonly enrichment: HallRecordEnrichment;
}

/** Lineage display combines the closed enrichment with the engine-validated hero identity. */
export interface HeartLineageRecord {
  readonly heroName: string;              // engine-validated at record time
  readonly classTags: readonly string[];
  readonly hallRecordId: OpaqueId;
  readonly enrichment: HallRecordEnrichment;
}

export interface AchievementGrant {
  readonly achievementId: OpaqueId;
  readonly criteriaId: AchievementCriteriaId;
  readonly name: string;
}

export interface LifetimeState {
  readonly conqueredChampionRecordIds: readonly OpaqueId[]; // sorted unique
  readonly grantedAchievementIds: readonly OpaqueId[];      // sorted unique
  readonly discoveryProtection: readonly DiscoveryProtectionBonus[]; // sorted by encounterId
  readonly totals: RunMetrics;
}

export interface LifetimeDeltas {
  readonly recordId: OpaqueId;            // idempotence key at the repository
  readonly newlyConqueredChampionRecordIds: readonly OpaqueId[];
  readonly achievementGrants: readonly AchievementGrant[];
  readonly discoveryProtectionUpdates: readonly DiscoveryProtectionUpdate[];
  readonly metrics: RunMetrics;           // this run's metrics, merged by the host
}

/** Encodes the run seed as 32 lowercase hex characters: each word as eight zero-padded digits. */
export function encodeRunSeed(runSeed: Uint32State): string {
  return runSeed.map((word) => word.toString(16).padStart(8, '0')).join('');
}

/** Derives the deterministic Hall record identifier from the run seed and content hash. */
export function deriveHallRecordId(runSeed: Uint32State, contentHash: string): OpaqueId {
  const recordId = `record.${encodeRunSeed(runSeed)}.${contentHash.slice(0, 16)}`;
  assertOpaqueId(recordId, 'hall record ID');
  return recordId;
}
