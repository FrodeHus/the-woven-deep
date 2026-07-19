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
export type DamageType = 'physical' | 'fire' | 'cold' | 'lightning' | 'poison' | 'arcane';
export type Disposition = 'friendly' | 'neutral' | 'hostile';
export type EquipmentSlot = 'main-hand' | 'off-hand' | 'body' | 'head' | 'hands' | 'feet' | 'neck' | 'left-ring' | 'right-ring';
export type ItemCategory = 'weapon' | 'ammunition' | 'armor' | 'shield' | 'light' | 'fuel' | 'food' | 'potion' | 'scroll' | 'ring' | 'misc';
export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'legendary';
export type TargetingId = 'target.self' | 'target.actor' | 'target.line' | 'target.cell';

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

export type CompletionType = 'died' | 'became-heart' | 'refused' | 'broke-cycle';

export type MerchantServiceId = 'merchant-service.identify' | 'merchant-service.strongbox';

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
