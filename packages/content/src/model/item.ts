import type {
  ContentId,
  DiceDefinition,
  EffectDefinition,
  EquipmentSlot,
  ItemCategory,
  ItemRarity,
  PresentedContentEntry,
} from './common.js';

export const ITEM_HANDEDNESS_VALUES = ['one-handed', 'two-handed', 'none'] as const;
export type ItemHandedness = (typeof ITEM_HANDEDNESS_VALUES)[number];

export interface EquipmentDefinition {
  readonly slots: readonly EquipmentSlot[];
  readonly handedness: ItemHandedness;
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

export const IDENTIFICATION_MODES = ['known', 'shuffled', 'instance'] as const;
export type IdentificationMode = (typeof IDENTIFICATION_MODES)[number];

export interface IdentificationDefinition {
  readonly mode: IdentificationMode;
  readonly poolId: string | null;
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
  readonly spellId?: ContentId;
  readonly equipment: EquipmentDefinition | null;
  readonly combat: CombatItemDefinition | null;
  readonly light: LightItemDefinition | null;
  readonly identification: IdentificationDefinition;
  readonly effects: readonly EffectDefinition[];
}
