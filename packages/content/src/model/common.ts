import type { AchievementContentEntry } from './achievement.js';
import type { BackgroundContentEntry } from './background.js';
import type { BalanceContentEntry } from './balance.js';
import type { ClassContentEntry } from './class.js';
import type { ConditionContentEntry } from './condition.js';
import type { CurseContentEntry } from './curse.js';
import type { DialogueContentEntry } from './dialogue.js';
import type { EnchantmentContentEntry } from './enchantment.js';
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

export const CONTENT_SCHEMA_VERSION = 14 as const;

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
  'dialogue',
  'identification-pool',
  'encounter',
  'fallen-champion-template',
  'npc',
  'npc-faction',
  'achievement',
  'class',
  'background',
  'trait',
  'curse',
  'enchantment',
] as const;
export type ContentKind = (typeof CONTENT_KIND_IDS)[number];
export const DERIVED_STAT_NAMES = [
  'maxHealth',
  'maxWeave',
  'meleeAccuracy',
  'meleeDamageBonus',
  'rangedAccuracy',
  'defense',
  'search',
  'disarm',
  'lightOutRevealRadius',
  'lightOutMemoryPersists',
  'lightOutCommitsMemory',
  'weaveRegen',
  'spellPower',
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
  'currency',
] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];
export const ITEM_RARITIES = ['common', 'uncommon', 'rare', 'legendary'] as const;
export type ItemRarity = (typeof ITEM_RARITIES)[number];
export const TARGETING_IDS = [
  'target.self',
  'target.actor',
  'target.line',
  'target.burst',
  'target.cone',
  'target.cell',
] as const;
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
export const CONTENT_LORE_MAX_LENGTH = 1200;

export interface PresentedContentEntry extends BaseContentEntry {
  readonly glyph: string;
  readonly color: string;
  readonly description?: string;
  readonly lore?: string;
}

export type CompletionType = 'died' | 'became-heart' | 'refused' | 'broke-cycle';

export const MERCHANT_SERVICE_IDS = [
  'merchant-service.identify',
  'merchant-service.remove-curse',
  'merchant-service.strongbox',
  'merchant-service.enchant',
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
  'effect.spell.learn',
  'effect.recall',
  'effect.curse.remove',
  'effect.item.enchant',
] as const;
export type EffectId = (typeof EFFECT_IDS)[number];

/**
 * Effects whose engine resolver (`resolveEffectSequence` in `effects.ts`) requires item-instance
 * context -- a `sourceItemId`, or another item-scoped RNG stream (`enchantingState`) -- that a
 * spell cast, a trap trigger, or a condition tick structurally cannot supply: none of those three
 * paths resolve against a specific item instance the way `use-item` does. Unlike curse triggers
 * and boss phases (both closed by their own compile-time allowlist), spell/trap/condition effect
 * lists otherwise carry no restriction, so this is enforced as a blocklist by the spell, trap, and
 * condition compile schemas. `effect.curse.remove` and `effect.fuel.transfer` were audited and
 * excluded: `effect.curse.remove` only ever reads the actor-owned `items` array (already supplied
 * by every caller) and never throws on a missing precondition, and `effect.fuel.transfer` is
 * resolved through the generic `operations` seam (already unimplemented -- and already rejected
 * the same way every other operations-seam effect is -- in these three contexts, not a new gap
 * this list needs to close).
 */
export const ITEM_ONLY_EFFECT_IDS = [
  'effect.item.consume',
  'effect.item.enchant',
] as const satisfies readonly EffectId[];
export type ItemOnlyEffectId = (typeof ITEM_ONLY_EFFECT_IDS)[number];

export type ContentEntry =
  | MonsterContentEntry
  | ItemContentEntry
  | SpellContentEntry
  | TrapContentEntry
  | LootTableContentEntry
  | BalanceContentEntry
  | VaultContentEntry
  | ConditionContentEntry
  | DialogueContentEntry
  | IdentificationPoolContentEntry
  | EncounterContentEntry
  | FallenChampionTemplateContentEntry
  | NpcContentEntry
  | NpcFactionContentEntry
  | AchievementContentEntry
  | ClassContentEntry
  | BackgroundContentEntry
  | TraitContentEntry
  | CurseContentEntry
  | EnchantmentContentEntry;

export interface ContentGenerationReport {
  readonly foundationalCategories: readonly string[];
}

export interface CompiledContentPack {
  readonly schemaVersion: typeof CONTENT_SCHEMA_VERSION;
  readonly hash: string;
  readonly entries: readonly ContentEntry[];
  readonly generationReport: ContentGenerationReport;
}
