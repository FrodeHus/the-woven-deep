import type {
  BaseContentEntry, BehaviorId, ContentId, EffectDefinition, ItemCategory, ItemRarity, MerchantServiceId,
} from './common.js';

export const ENCOUNTER_MODELS = ['individual', 'group', 'swarm', 'boss', 'merchant'] as const;
export type EncounterModel = typeof ENCOUNTER_MODELS[number];
export const ENCOUNTER_FORMATIONS = ['cluster', 'line', 'screen', 'wedge', 'surround'] as const;
export type EncounterFormation = typeof ENCOUNTER_FORMATIONS[number];
export const FORMATION_PREFERENCES = ['front', 'center', 'rear', 'flank', 'free'] as const;
export type FormationPreference = typeof FORMATION_PREFERENCES[number];
export const LEADER_DEATH_RESPONSES = ['weaken', 'panic', 'disband', 'surrender', 'frenzy', 'collapse'] as const;
export type LeaderDeathResponse = typeof LEADER_DEATH_RESPONSES[number];
export const SWARM_DESTRUCTION_RESPONSES = ['stop', 'flee', 'decay', 'frenzy'] as const;
export type SwarmDestructionResponse = typeof SWARM_DESTRUCTION_RESPONSES[number];

export interface EncounterPlacementDefinition {
  readonly minimumStairDistance: number;
  readonly minimumObjectiveDistance: number;
  readonly maximumMemberDistance: number;
  readonly allowedTerrainTags: readonly string[];
  readonly requiresVaultSlot: boolean;
  readonly failureMode: 'optional' | 'required';
}

export interface EncounterIntentPresentation {
  readonly visible: boolean;
}

export interface IndividualEncounterDefinition {
  readonly monsterId: ContentId;
  readonly minimumQuantity: number;
  readonly maximumQuantity: number;
}

export interface GroupRoleDefinition {
  readonly roleId: string;
  readonly monsterId: ContentId;
  readonly minimumQuantity: number;
  readonly maximumQuantity: number;
  readonly formationPreference: FormationPreference;
  readonly behaviorParameters: Readonly<Record<string, unknown>>;
}

export interface PopulationCombatModifiers {
  readonly accuracy: number;
  readonly defense: number;
  readonly damage: number;
}

export interface GroupEncounterDefinition {
  readonly roles: readonly GroupRoleDefinition[];
  readonly formation: EncounterFormation;
  readonly communicationRadius: number;
  readonly leaderChance: number;
  readonly leaderRoleId: string;
  readonly leaderAccentColor: string;
  readonly leaderAlternateGlyph: string | null;
  readonly coordinationModifiers: PopulationCombatModifiers;
  readonly leaderDeathResponse: LeaderDeathResponse;
  readonly responseParameters: Readonly<Record<string, unknown>>;
  readonly supernaturalBond: boolean;
  readonly collapseRewards: 'none' | 'individual';
}

export interface SwarmSpawnRoleDefinition {
  readonly roleId: string;
  readonly monsterId: ContentId;
  readonly weight: number;
}

export interface SwarmEncounterDefinition {
  readonly sourceMonsterId: ContentId;
  readonly spawnRoles: readonly SwarmSpawnRoleDefinition[];
  readonly spawnInterval: number;
  readonly minimumSpawnQuantity: number;
  readonly maximumSpawnQuantity: number;
  readonly placementRadius: number;
  readonly allowedTerrainTags: readonly string[];
  readonly maximumLivingChildren: number;
  readonly maximumLivingMembers: number;
  readonly maximumFloorActors: number;
  readonly sourceDestructionResponse: SwarmDestructionResponse;
  readonly responseParameters: Readonly<Record<string, unknown>>;
}

export interface BossPhaseDefinition {
  readonly phaseId: string;
  readonly healthThresholdPercent: number;
  readonly behaviorId: BehaviorId;
  readonly behaviorParameters: Readonly<Record<string, unknown>>;
  readonly modifiers: PopulationCombatModifiers;
  readonly effects: readonly EffectDefinition[];
}

export interface BossEncounterDefinition {
  readonly monsterId: ContentId;
  readonly phases: readonly BossPhaseDefinition[];
  readonly recoveryPerWorldTime: number;
  readonly recoveryCapPercent: number;
  readonly uniqueItemId: ContentId;
  readonly enhancedLootTableId: ContentId;
  readonly vaultTags: readonly string[];
}

export interface MerchantServiceOfferDefinition {
  readonly serviceId: MerchantServiceId; readonly basePrice: number;
  readonly minimumUses: number; readonly maximumUses: number; readonly tierIds: readonly string[];
}

export interface MerchantEncounterDefinition {
  readonly npcId: ContentId; readonly stockLootTableId: ContentId;
  readonly minimumStockRolls: number; readonly maximumStockRolls: number;
  readonly merchantSaleBps: number; readonly merchantPurchaseBps: number;
  readonly acceptedCategories: readonly ItemCategory[]; readonly services: readonly MerchantServiceOfferDefinition[];
  // `permanent` merchants (town shopkeepers) never depart and must omit every lifetime field below.
  // Non-permanent (dungeon-wandering) merchants must declare all three.
  readonly permanent: boolean;
  readonly minimumLifetime?: number; readonly maximumLifetime?: number;
  readonly departureWarningThresholds?: readonly number[]; readonly aggressionResponse: 'flee' | 'self-defense';
  readonly commerceReputationDelta: number; readonly aggressionReputationDelta: number;
  readonly deathReputationDelta: number; readonly stockDropFraction: number;
}

interface BaseEncounterContentEntry extends BaseContentEntry {
  readonly kind: 'encounter';
  readonly adminDescription: string | null;
  readonly minDepth: number;
  readonly maxDepth: number;
  readonly environmentTags: readonly string[];
  readonly requiredVaultTags: readonly string[];
  readonly weight: number;
  readonly rarity: ItemRarity;
  readonly runAppearanceChance: number;
  readonly discoveryProtectionIncrement: number;
  readonly discoveryProtectionCap: number;
  readonly maximumInstancesPerRun: number;
  readonly placement: EncounterPlacementDefinition;
  readonly intentPresentation: EncounterIntentPresentation;
}

export interface IndividualEncounterContentEntry extends BaseEncounterContentEntry {
  readonly model: 'individual';
  readonly definition: IndividualEncounterDefinition;
}

export interface GroupEncounterContentEntry extends BaseEncounterContentEntry {
  readonly model: 'group';
  readonly definition: GroupEncounterDefinition;
}

export interface SwarmEncounterContentEntry extends BaseEncounterContentEntry {
  readonly model: 'swarm';
  readonly definition: SwarmEncounterDefinition;
}

export interface BossEncounterContentEntry extends BaseEncounterContentEntry {
  readonly model: 'boss';
  readonly definition: BossEncounterDefinition;
}

export interface MerchantEncounterContentEntry extends BaseEncounterContentEntry {
  readonly model: 'merchant'; readonly definition: MerchantEncounterDefinition;
}

export type EncounterContentEntry = IndividualEncounterContentEntry | GroupEncounterContentEntry
  | SwarmEncounterContentEntry | BossEncounterContentEntry | MerchantEncounterContentEntry;
