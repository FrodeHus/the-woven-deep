import type { BaseAttributes } from './actor-model.js';
import type { OpaqueId } from './model.js';

export type PopulationIntent = 'approach' | 'attack' | 'hold' | 'regroup' | 'flee' | 'protect' | 'spawn' | 'phase-change';

export type ActorGoal =
  | Readonly<{ type: 'actor'; targetActorId: OpaqueId }>
  | Readonly<{ type: 'cell'; floorId: OpaqueId; x: number; y: number }>
  | Readonly<{ type: 'formation'; populationId: OpaqueId; roleId: string; x: number; y: number }>;

export interface LastKnownTarget {
  readonly targetActorId: OpaqueId;
  readonly floorId: OpaqueId;
  readonly x: number;
  readonly y: number;
  readonly observedAt: number;
  readonly source: 'sight' | 'sound' | 'group';
  readonly observerActorId: OpaqueId;
}

export interface InvestigationState {
  readonly floorId: OpaqueId;
  readonly x: number;
  readonly y: number;
  readonly startedAt: number;
  readonly expiresAt: number | null;
}

export interface ActorBehaviorState {
  readonly intent: PopulationIntent;
  readonly goal: ActorGoal | null;
  readonly lastKnownTargets: readonly LastKnownTarget[];
  readonly investigation: InvestigationState | null;
}

export interface ActorPopulationPresentation {
  readonly name: string;
  readonly glyph: string;
  readonly color: string;
  readonly leader: boolean;
}

export interface EncounterRunDecision {
  readonly encounterId: OpaqueId;
  readonly baseProbability: number;
  readonly protectionBonus: number;
  readonly effectiveProbability: number;
  readonly eligible: boolean;
  readonly reachedEligibleDepth: boolean;
  readonly encountered: boolean;
  readonly instancesCreated: number;
}

interface PopulationBase {
  readonly populationId: OpaqueId;
  readonly encounterId: OpaqueId;
  readonly floorId: OpaqueId;
  readonly createdAt: number;
  readonly livingMemberIds: readonly OpaqueId[];
  readonly formerMemberIds: readonly OpaqueId[];
}

export interface IndividualPopulation extends PopulationBase { readonly model: 'individual' }
export interface GroupPopulation extends PopulationBase {
  readonly model: 'group';
  readonly leaderActorId: OpaqueId | null;
  readonly bonusActive: boolean;
  readonly roleMembership: readonly Readonly<{ actorId: OpaqueId; roleId: string }>[];
  readonly sharedKnowledge: readonly LastKnownTarget[];
  readonly leaderResponseApplied: boolean;
}
export interface SwarmPopulation extends PopulationBase {
  readonly model: 'swarm';
  readonly sourceActorId: OpaqueId;
  readonly nextSpawnAt: number;
  readonly spawnedCount: number;
  readonly peakLivingSize: number;
  readonly shutdownState: 'stop' | 'flee' | 'decay' | 'frenzy' | null;
}
export interface BossPopulation extends PopulationBase {
  readonly model: 'boss';
  readonly actorId: OpaqueId;
  readonly currentPhaseId: string | null;
  readonly crossedPhaseIds: readonly string[];
  readonly lastFloorExitAt: number | null;
  readonly rewardCreated: boolean;
  readonly recoveryHistory: readonly Readonly<{ at: number; amount: number }>[];
}
export interface ChampionPopulation extends PopulationBase {
  readonly model: 'champion';
  readonly actorId: OpaqueId;
  readonly hallRecordId: OpaqueId;
  readonly rank: 1;
  readonly defeated: boolean;
  readonly rewardCreated: boolean;
}
export interface EchoPopulation extends PopulationBase {
  readonly model: 'echo';
  readonly actorId: OpaqueId;
  readonly hallRecordId: OpaqueId;
  readonly rank: number;
  readonly defeated: boolean;
  readonly lootCreated: boolean;
}

export type PopulationInstance = IndividualPopulation | GroupPopulation | SwarmPopulation
  | BossPopulation | ChampionPopulation | EchoPopulation;

export interface RecordedHeirloomSnapshot {
  readonly contentId: OpaqueId;
  readonly sourceItemId: OpaqueId | null;
  readonly enchantment: Readonly<{
    readonly enchantmentId: OpaqueId;
    readonly modifiers: Readonly<Record<string, number>>;
  }> | null;
  readonly condition: number;
  readonly charges: number | null;
  readonly fuel: number | null;
  readonly qualityRank: number;
  readonly displayName: string;
  readonly glyph: string;
  readonly color: string;
  readonly originatingHallRecordId: OpaqueId;
}

export interface FallenHeroStandingSnapshot {
  readonly rank: number;
  readonly hallRecordId: OpaqueId;
  readonly heroName: string;
  readonly portraitGlyph: string;
  readonly classTags: readonly string[];
  readonly attributes: BaseAttributes;
  readonly equippedItemContentIds: readonly OpaqueId[];
  readonly signatureAbilityIds: readonly OpaqueId[];
  readonly deathDepth: number;
  readonly sourceContentHash: string;
  readonly heirloom: RecordedHeirloomSnapshot;
}

export interface FallenHeroRunDecision {
  readonly hallRecordId: OpaqueId;
  readonly rank: number;
  readonly role: 'champion' | 'echo';
  readonly gateRoll: number | null;
  readonly retained: boolean;
  readonly encountered: boolean;
  readonly defeated: boolean;
}

export function emptyActorBehaviorState(): ActorBehaviorState {
  return { intent: 'hold', goal: null, lastKnownTargets: [], investigation: null };
}
