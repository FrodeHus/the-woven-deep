export const CONTENT_SCHEMA_VERSION = 7 as const;

export type ContentId = string;
export const CONTENT_KIND_IDS = [
  'monster', 'item', 'spell', 'trap', 'loot-table', 'balance', 'vault', 'condition',
  'identification-pool',
  'encounter', 'fallen-champion-template', 'npc', 'npc-faction', 'achievement',
  'class', 'background', 'trait',
] as const;
export type ContentKind = typeof CONTENT_KIND_IDS[number];
export const DERIVED_STAT_NAMES = [
  'maxHealth', 'meleeAccuracy', 'meleeDamageBonus', 'rangedAccuracy',
  'defense', 'search', 'disarm', 'lightOutRevealRadius', 'lightOutMemoryPersists',
] as const;
export type DerivedStatName = typeof DERIVED_STAT_NAMES[number];
export const CONDITION_TRAIT_IDS = [
  'condition-trait.avoids-opportunity-attacks',
  'condition-trait.incapacitated',
  'condition-trait.interrupts-rest',
  'condition-trait.blocks-recovery',
  'condition-trait.prevents-movement',
  'condition-trait.suppresses-reactions',
] as const;
export type ConditionTraitId = typeof CONDITION_TRAIT_IDS[number];
export type DamageType = 'physical' | 'fire' | 'cold' | 'lightning' | 'poison' | 'arcane';
export type Disposition = 'friendly' | 'neutral' | 'hostile';
export type EquipmentSlot = 'main-hand' | 'off-hand' | 'body' | 'head' | 'hands' | 'feet' | 'neck' | 'left-ring' | 'right-ring';
export type ItemCategory = 'weapon' | 'ammunition' | 'armor' | 'shield' | 'light' | 'fuel' | 'food' | 'potion' | 'scroll' | 'ring' | 'misc';
export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'legendary';
export type TargetingId = 'target.self' | 'target.actor' | 'target.line' | 'target.cell';
export type VaultTerrainName = 'wall' | 'floor' | 'closed-door' | 'pillar' | 'stair-up' | 'stair-down' | 'void';
export type VaultPlacementKind = 'monster' | 'item' | 'trap' | 'npc' | 'fixture' | 'objective';
export type VaultRotation = 0 | 90 | 180 | 270;
export type VaultRarity = 'common' | 'uncommon' | 'rare' | 'legendary';

export interface DiceDefinition {
  readonly count: number;
  readonly sides: number;
  readonly bonus: number;
}

export interface BaseAttributeDefinition {
  readonly might: number;
  readonly agility: number;
  readonly vitality: number;
  readonly wits: number;
  readonly resolve: number;
}

export interface EffectDefinition {
  readonly effectId: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly requiresLivingTarget: boolean;
}

export interface BaseContentEntry {
  readonly id: ContentId;
  readonly kind: ContentKind;
  readonly name: string;
  readonly tags: readonly string[];
}

export interface PresentedContentEntry extends BaseContentEntry {
  readonly glyph: string;
  readonly color: string;
}

export interface MonsterContentEntry extends PresentedContentEntry {
  readonly kind: 'monster';
  readonly attributes: BaseAttributeDefinition;
  readonly health: number;
  readonly speed: number;
  readonly accuracy: number;
  readonly defense: number;
  readonly perception: number;
  readonly damage: DiceDefinition;
  readonly armor: number;
  readonly resistances: Readonly<Record<DamageType, number>>;
  readonly disposition: Disposition;
  readonly behaviorId: string;
  readonly behaviorParameters: Readonly<Record<string, unknown>>;
  readonly minDepth: number;
  readonly maxDepth: number;
  readonly threat: number;
  readonly rarity: ItemRarity;
}

export type CompletionType = 'died' | 'became-heart' | 'refused' | 'broke-cycle';

export const ACHIEVEMENT_CRITERIA_IDS = ['first-champion-defeat', 'first-echo-defeat'] as const;
export type AchievementCriteriaId = typeof ACHIEVEMENT_CRITERIA_IDS[number];

export interface AchievementContentEntry extends BaseContentEntry {
  readonly kind: 'achievement';
  readonly description: string;
  readonly criteriaId: AchievementCriteriaId;
}

export interface ClassKitEquippedItem {
  readonly contentId: ContentId;
  readonly slot: EquipmentSlot;
  readonly enabled?: boolean;
}
export interface ClassKitBackpackItem {
  readonly contentId: ContentId;
  readonly quantity?: number;
}
export interface ClassKitDefinition {
  readonly kitId: string;
  readonly name: string;
  readonly equipped: readonly ClassKitEquippedItem[];
  readonly backpack: readonly ClassKitBackpackItem[];
}
export interface ClassContentEntry extends BaseContentEntry {
  readonly kind: 'class';
  readonly description: string;
  readonly playable: boolean;
  readonly silhouetteGlyph: string;
  readonly unlockHint: string | null;
  readonly classTags: readonly string[];
  readonly kits: readonly ClassKitDefinition[];
}
export interface BackgroundContentEntry extends BaseContentEntry {
  readonly kind: 'background';
  readonly description: string;
  readonly modifiers: Readonly<Partial<Record<DerivedStatName, number>>>;
  readonly extraItems: readonly ClassKitBackpackItem[];
}
export interface TraitContentEntry extends BaseContentEntry {
  readonly kind: 'trait';
  readonly description: string;
  readonly modifiers: Readonly<Partial<Record<DerivedStatName, number>>>;
}
export interface PointBuyDefinition {
  readonly budget: number;
  readonly costs: readonly { readonly value: number; readonly cost: number }[];
}

export interface ScoreCoefficientsDefinition {
  readonly depthCoefficient: number;
  readonly bossDefeatCoefficient: number;
  readonly threatCoefficient: number;
  readonly discoveryCoefficient: number;
  readonly completionBonus: Readonly<Record<CompletionType, number>>;
  readonly turnEfficiencyBudget: number;
  readonly turnEfficiencyDecayInterval: number;
}

export type EncounterModel = 'individual' | 'group' | 'swarm' | 'boss' | 'merchant';
export type EncounterFormation = 'cluster' | 'line' | 'screen' | 'wedge' | 'surround';
export type FormationPreference = 'front' | 'center' | 'rear' | 'flank' | 'free';
export type LeaderDeathResponse = 'weaken' | 'panic' | 'disband' | 'surrender' | 'frenzy' | 'collapse';
export type SwarmDestructionResponse = 'stop' | 'flee' | 'decay' | 'frenzy';

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
  readonly behaviorId: string;
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

export type MerchantServiceId = 'merchant-service.identify' | 'merchant-service.strongbox';

export interface ReputationTierDefinition {
  readonly tierId: string; readonly name: string; readonly minimum: number; readonly maximum: number;
  readonly purchasePriceBps: number; readonly salePriceBps: number; readonly acceptsTrade: boolean;
  readonly serviceIds: readonly MerchantServiceId[];
}

export interface NpcFactionContentEntry extends BaseContentEntry {
  readonly kind: 'npc-faction'; readonly minimumReputation: number; readonly maximumReputation: number;
  readonly startingReputation: number; readonly tiers: readonly ReputationTierDefinition[];
}

export interface NpcContentEntry extends PresentedContentEntry {
  readonly kind: 'npc'; readonly factionId: ContentId; readonly attributes: BaseAttributeDefinition;
  readonly health: number; readonly speed: number; readonly perception: number; readonly accuracy: number;
  readonly defense: number; readonly damage: DiceDefinition; readonly armor: number;
  readonly resistances: Readonly<Record<DamageType, number>>; readonly disposition: 'neutral';
  readonly behaviorId: 'npc-behavior.travelling-merchant';
  readonly behaviorParameters: Readonly<Record<string, unknown>>; readonly selfPreservationThresholdBps: number;
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

export interface FallenChampionTemplateContentEntry extends BaseContentEntry {
  readonly kind: 'fallen-champion-template';
  readonly fallbackMonsterId: ContentId;
  readonly fallbackItemId: ContentId;
  readonly minimumHealth: number;
  readonly maximumHealth: number;
  readonly attributeMaximum: number;
  readonly damageMaximum: number;
  readonly abilityLimit: number;
  readonly echoAppearanceChance: number;
  readonly maximumEchoesPerRun: number;
  readonly echoHealthPercent: number;
  readonly echoDamagePercent: number;
  readonly echoDefensePercent: number;
  readonly echoAbilityLimit: number;
  readonly echoLootTableId: ContentId;
  readonly heirloomSelection: Readonly<{
    rarityWeights: Readonly<Record<ItemRarity, number>>;
    qualityRankBonus: number;
  }>;
}

export interface EquipmentDefinition {
  readonly slots: readonly EquipmentSlot[];
  readonly handedness: 'one-handed' | 'two-handed' | 'none';
  readonly reservedSlots: readonly EquipmentSlot[];
}

export interface CombatItemDefinition {
  readonly accuracy: number;
  readonly defense: number;
  readonly armor: number;
  readonly damage: DiceDefinition | null;
  readonly range: number;
  readonly ammunitionTag: string | null;
}

export interface LightItemDefinition {
  readonly color: readonly [number, number, number];
  readonly radius: number;
  readonly strength: number;
  readonly fuelCapacity: number;
  readonly fuelPerTime: number;
  readonly warningThresholds: readonly number[];
  readonly fuelTags: readonly string[];
}

export interface IdentificationDefinition {
  readonly mode: 'known' | 'shuffled' | 'instance';
  readonly poolId: string | null;
}

export interface ItemAppearanceVisualDefinition {
  readonly id: ContentId;
  readonly glyph: string;
  readonly color: string;
}

export interface IdentificationPoolContentEntry extends BaseContentEntry {
  readonly kind: 'identification-pool';
  readonly category: ItemCategory;
  readonly verbs: readonly string[];
  readonly nouns: readonly string[];
  readonly visuals: readonly ItemAppearanceVisualDefinition[];
}

export interface ItemContentEntry extends PresentedContentEntry {
  readonly kind: 'item';
  readonly category: ItemCategory;
  readonly stackLimit: number;
  readonly price: number;
  readonly rarity: ItemRarity;
  readonly heirloomEligible: boolean;
  readonly minDepth: number;
  readonly maxDepth: number;
  readonly actionCost: number;
  readonly equipment: EquipmentDefinition | null;
  readonly combat: CombatItemDefinition | null;
  readonly light: LightItemDefinition | null;
  readonly identification: IdentificationDefinition;
  readonly effects: readonly EffectDefinition[];
}

export interface SpellContentEntry extends BaseContentEntry {
  readonly kind: 'spell';
  readonly targetingId: TargetingId;
  readonly range: number;
  readonly actionCost: number;
  readonly effects: readonly EffectDefinition[];
}

export interface TrapContentEntry extends PresentedContentEntry {
  readonly kind: 'trap';
  readonly targetingId: TargetingId;
  readonly discoveryDifficulty: number;
  readonly disarmDifficulty: number;
  readonly disarmOutcomes: Readonly<{
    failure: 'safe' | 'tool-damage' | 'trigger';
    criticalFailure: 'safe' | 'tool-damage' | 'trigger';
    toolDamage: number;
  }>;
  readonly resetMode: 'once' | 'reset' | 'disabled';
  readonly effects: readonly EffectDefinition[];
}

export interface LootChoiceDefinition {
  readonly contentId: ContentId | null;
  readonly lootTableId: ContentId | null;
  readonly weight: number;
  readonly minimumQuantity: number;
  readonly maximumQuantity: number;
  // Optional depth band restricting when this choice is offered (e.g. town merchant restocks
  // widening at balance.restockMilestones). Absent means unbanded: always available, matching
  // pre-existing behavior. When present, 0 <= minDepth <= maxDepth <= 999. Honoring the band
  // during loot/stock rolls is engine work tracked separately; the content layer only
  // authors and validates it.
  readonly minDepth?: number;
  readonly maxDepth?: number;
}

export interface LootTableContentEntry extends BaseContentEntry {
  readonly kind: 'loot-table';
  readonly rolls: number;
  readonly choices: readonly LootChoiceDefinition[];
}

export interface BalanceContentEntry extends BaseContentEntry {
  readonly kind: 'balance';
  readonly startingCurrency: number;
  readonly readinessThreshold: number;
  readonly normalActionCost: number;
  readonly speedMinimum: number;
  readonly speedMaximum: number;
  readonly energyMinimum: number;
  readonly energyMaximum: number;
  readonly attributeMinimum: number;
  readonly attributeMaximum: number;
  readonly hungerMaximum: number;
  readonly hungerThresholds: Readonly<{ hungry: number; weak: number; starving: number }>;
  readonly starvationInterval: number;
  readonly starvationDamage: number;
  readonly recoveryInterval: number;
  readonly recoveryAmount: number;
  readonly restMaximumDuration: number;
  readonly recoveryByHungerStage: Readonly<Record<'sated' | 'hungry' | 'weak' | 'starving', number>>;
  readonly hungerStageModifiers: Readonly<Record<'sated' | 'hungry' | 'weak' | 'starving', Readonly<Partial<Record<DerivedStatName, number>>>>>;
  readonly formulas: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly actionCosts: Readonly<Record<string, number>>;
  readonly score: ScoreCoefficientsDefinition;
  readonly pointBuy: PointBuyDefinition;
  readonly restockMilestones: readonly number[];
  readonly house: Readonly<{ baseCapacity: number; strongboxIncrement: number }>;
  readonly encounterDensity: Readonly<{ cellsPerEncounter: number }>;
}

export interface ConditionContentEntry extends BaseContentEntry {
  readonly kind: 'condition';
  readonly description: string;
  readonly color: string;
  readonly duration:
    | Readonly<{ mode: 'timed'; default: number; maximum: number }>
    | Readonly<{ mode: 'permanent'; default: null; maximum: null }>;
  readonly stacking: Readonly<{
    mode: 'replace' | 'refresh' | 'intensify';
    maximumStacks: number;
  }>;
  readonly modifiersPerStack: Readonly<Partial<Record<DerivedStatName, number>>>;
  readonly traits: readonly ConditionTraitId[];
}

export interface VaultPlacementSlot {
  readonly id: string;
  readonly kind: VaultPlacementKind;
  readonly required: boolean;
  readonly tags: readonly string[];
}

export interface VaultLightFixture {
  readonly idSuffix: string;
  readonly glyph: string;
  readonly presentationToken: string;
  readonly color: readonly [number, number, number];
  readonly radius: number;
  readonly strength: number;
  readonly enabled: boolean;
}

export interface VaultLegendEntry {
  readonly terrain: VaultTerrainName;
  readonly entrance: boolean;
  readonly light: VaultLightFixture | null;
  readonly slot: VaultPlacementSlot | null;
}

export interface VaultContentEntry extends BaseContentEntry {
  readonly kind: 'vault';
  readonly minDepth: number;
  readonly maxDepth: number;
  readonly rarity: VaultRarity;
  readonly weight: number;
  readonly maxPerFloor: number;
  readonly margin: number;
  readonly transforms: {
    readonly rotations: readonly VaultRotation[];
    readonly reflectHorizontal: boolean;
  };
  readonly layout: readonly string[];
  readonly legend: Readonly<Record<string, VaultLegendEntry>>;
  readonly entranceCount: number;
  readonly requiredSlotIds: readonly string[];
}

export type ContentEntry = MonsterContentEntry | ItemContentEntry | SpellContentEntry | TrapContentEntry
  | LootTableContentEntry | BalanceContentEntry | VaultContentEntry | ConditionContentEntry
  | IdentificationPoolContentEntry | EncounterContentEntry | FallenChampionTemplateContentEntry
  | NpcContentEntry | NpcFactionContentEntry | AchievementContentEntry
  | ClassContentEntry | BackgroundContentEntry | TraitContentEntry;

export interface ContentGenerationReport {
  readonly foundationalCategories: readonly string[];
}

export interface CompiledContentPack {
  readonly schemaVersion: typeof CONTENT_SCHEMA_VERSION;
  readonly hash: string;
  readonly entries: readonly ContentEntry[];
  readonly generationReport: ContentGenerationReport;
}
