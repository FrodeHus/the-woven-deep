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

/**
 * A condition this monster applies to whatever it hits. `chance` is a 0..1 probability rolled
 * once per landed hit; `duration` overrides the condition's own default when non-null.
 */
export interface MonsterOnHitCondition {
  readonly conditionId: ContentId;
  readonly chance: number;
  readonly duration: number | null;
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
  readonly behaviorId: BehaviorId;
  readonly behaviorParameters: Readonly<Record<string, unknown>>;
  readonly minDepth: number;
  readonly maxDepth: number;
  readonly threat: number;
  readonly rarity: ItemRarity;
  readonly lootTableId: ContentId | null;
  readonly dropChance: number;
  readonly onHitConditions: readonly MonsterOnHitCondition[];
}
