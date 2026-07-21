import type { AchievementContentEntry } from './achievement.js';
import type { BackgroundContentEntry } from './background.js';
import type { BalanceContentEntry } from './balance.js';
import type { ClassContentEntry } from './class.js';
import type { ConditionContentEntry } from './condition.js';
import type { EncounterContentEntry } from './encounter.js';
import type { FallenChampionTemplateContentEntry } from './champion.js';
import type { IdentificationPoolContentEntry } from './identification-pool.js';
import type { ItemContentEntry } from './item.js';
import type { LootTableContentEntry } from './loot-table.js';
import type { MonsterContentEntry } from './monster.js';
import type { NpcContentEntry } from './npc.js';
import type { NpcFactionContentEntry } from './npc-faction.js';
import type { SpellContentEntry } from './spell.js';
import type { TraitContentEntry } from './trait.js';
import type { TrapContentEntry } from './trap.js';
import type { VaultContentEntry } from './vault.js';

export const CONTENT_SCHEMA_VERSION = 7 as const;

export type ContentId = string;
export const CONTENT_KIND_IDS = [
  'monster',
  'item',
  'spell',
  'trap',
  'loot-table',
  'balance',
  'vault',
  'condition',
  'identification-pool',
  'encounter',
  'fallen-champion-template',
  'npc',
  'npc-faction',
  'achievement',
  'class',
  'background',
  'trait',
] as const;
export type ContentKind = (typeof CONTENT_KIND_IDS)[number];
export const DERIVED_STAT_NAMES = [
  'maxHealth',
  'meleeAccuracy',
  'meleeDamageBonus',
  'rangedAccuracy',
  'defense',
  'search',
  'disarm',
  'lightOutRevealRadius',
  'lightOutMemoryPersists',
  'lightOutCommitsMemory',
] as const;
export type DerivedStatName = (typeof DERIVED_STAT_NAMES)[number];
export const DAMAGE_TYPES = ['physical', 'fire', 'cold', 'lightning', 'poison', 'arcane'] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];
export const DISPOSITIONS = ['friendly', 'neutral', 'hostile'] as const;
export type Disposition = (typeof DISPOSITIONS)[number];
export const EQUIPMENT_SLOTS = [
  'main-hand',
  'off-hand',
  'body',
  'head',
  'hands',
  'feet',
  'neck',
  'left-ring',
  'right-ring',
] as const;
export type EquipmentSlot = (typeof EQUIPMENT_SLOTS)[number];
export const ITEM_CATEGORIES = [
  'weapon',
  'ammunition',
  'armor',
  'shield',
  'light',
  'fuel',
  'food',
  'potion',
  'scroll',
  'ring',
  'misc',
] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];
export const ITEM_RARITIES = ['common', 'uncommon', 'rare', 'legendary'] as const;
export type ItemRarity = (typeof ITEM_RARITIES)[number];
export const TARGETING_IDS = ['target.self', 'target.actor', 'target.line', 'target.cell'] as const;
export type TargetingId = (typeof TARGETING_IDS)[number];

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
  readonly effectId: EffectId;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly requiresLivingTarget: boolean;
}

export interface BaseContentEntry {
  readonly id: ContentId;
  readonly kind: ContentKind;
  readonly name: string;
  readonly tags: readonly string[];
}

export const CONTENT_DESCRIPTION_MAX_LENGTH = 300;

export interface PresentedContentEntry extends BaseContentEntry {
  readonly glyph: string;
  readonly color: string;
  readonly description?: string;
}

export type CompletionType = 'died' | 'became-heart' | 'refused' | 'broke-cycle';

export const MERCHANT_SERVICE_IDS = [
  'merchant-service.identify',
  'merchant-service.strongbox',
] as const;
export type MerchantServiceId = (typeof MERCHANT_SERVICE_IDS)[number];

export const BEHAVIOR_IDS = ['behavior.approach-and-attack', 'behavior.patrol'] as const;
export type BehaviorId = (typeof BEHAVIOR_IDS)[number];

export const EFFECT_IDS = [
  'effect.damage',
  'effect.heal',
  'effect.hunger.restore',
  'effect.condition.apply',
  'effect.condition.remove',
  'effect.force-move',
  'effect.reveal',
  'effect.fuel.transfer',
  'effect.light.toggle',
  'effect.item.consume',
  'effect.feature.mutate',
] as const;
export type EffectId = (typeof EFFECT_IDS)[number];

export type ContentEntry =
  | MonsterContentEntry
  | ItemContentEntry
  | SpellContentEntry
  | TrapContentEntry
  | LootTableContentEntry
  | BalanceContentEntry
  | VaultContentEntry
  | ConditionContentEntry
  | IdentificationPoolContentEntry
  | EncounterContentEntry
  | FallenChampionTemplateContentEntry
  | NpcContentEntry
  | NpcFactionContentEntry
  | AchievementContentEntry
  | ClassContentEntry
  | BackgroundContentEntry
  | TraitContentEntry;

export interface ContentGenerationReport {
  readonly foundationalCategories: readonly string[];
}

export interface CompiledContentPack {
  readonly schemaVersion: typeof CONTENT_SCHEMA_VERSION;
  readonly hash: string;
  readonly entries: readonly ContentEntry[];
  readonly generationReport: ContentGenerationReport;
}
