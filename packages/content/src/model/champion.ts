import type { BaseContentEntry, ContentId, ItemRarity } from './common.js';

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
