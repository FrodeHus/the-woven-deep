import type { BaseContentEntry, ContentId, ItemCategory, ItemRarity } from './common.js';

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
  /**
   * How a haunt of this template can be appeased instead of fought. Every value is a closed
   * `ItemCategory`; the need is computed from the standing, so both the engine (validation) and the
   * client (UI hint) derive it identically with no hidden state.
   */
  readonly appeasement: Readonly<{
    /** Class tag -> the categories a hero of that calling is remembered wanting. Keys are free-form
     * class tags (`wayfarer`, `lamplighter`, `loomcaller`, `archivist`, `warden`, and whatever a
     * future class declares); an unlisted tag contributes nothing. */
    readonly classFavors: Readonly<Record<string, readonly ItemCategory[]>>;
    /** Accepted additionally when the record has no cause, or a cause with no killer entity -- the
     * hero who went out in the dark wants light. */
    readonly causelessCategories: readonly ItemCategory[];
    /** Accepted when the class-tag favors contribute nothing, so every haunt is appeasable. */
    readonly defaultCategories: readonly ItemCategory[];
  }>;
}
