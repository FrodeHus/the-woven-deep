import type {
  BaseAttributeDefinition,
  BehaviorId,
  DamageType,
  DiceDefinition,
  Disposition,
  ContentId,
  ItemRarity,
  PresentedContentEntry,
} from './common.js';

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
  readonly behaviorId: BehaviorId;
  readonly behaviorParameters: Readonly<Record<string, unknown>>;
  readonly minDepth: number;
  readonly maxDepth: number;
  readonly threat: number;
  readonly rarity: ItemRarity;
  readonly lootTableId: ContentId | null;
  readonly dropChance: number;
}
