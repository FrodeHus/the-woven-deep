export const CONTENT_SCHEMA_VERSION = 2 as const;

export type ContentId = string;
export type ContentKind = 'monster' | 'item' | 'spell' | 'trap' | 'loot-table' | 'balance' | 'vault';
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
  readonly runAppearanceChance: number;
  readonly minDepth: number;
  readonly maxDepth: number;
  readonly rarity: ItemRarity;
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
  readonly groupId: string | null;
  readonly appearances: readonly string[];
}

export interface ItemContentEntry extends PresentedContentEntry {
  readonly kind: 'item';
  readonly category: ItemCategory;
  readonly stackLimit: number;
  readonly price: number;
  readonly rarity: ItemRarity;
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
  readonly resetMode: 'once' | 'reset' | 'disabled';
  readonly effects: readonly EffectDefinition[];
}

export interface LootChoiceDefinition {
  readonly contentId: ContentId | null;
  readonly lootTableId: ContentId | null;
  readonly weight: number;
  readonly minimumQuantity: number;
  readonly maximumQuantity: number;
}

export interface LootTableContentEntry extends BaseContentEntry {
  readonly kind: 'loot-table';
  readonly rolls: number;
  readonly choices: readonly LootChoiceDefinition[];
}

export interface BalanceContentEntry extends BaseContentEntry {
  readonly kind: 'balance';
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
  readonly formulas: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly actionCosts: Readonly<Record<string, number>>;
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
  | LootTableContentEntry | BalanceContentEntry | VaultContentEntry;

export interface ContentGenerationReport {
  readonly foundationalCategories: readonly string[];
}

export interface CompiledContentPack {
  readonly schemaVersion: typeof CONTENT_SCHEMA_VERSION;
  readonly hash: string;
  readonly entries: readonly ContentEntry[];
  readonly generationReport: ContentGenerationReport;
}
