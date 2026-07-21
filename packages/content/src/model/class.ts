import type { BaseContentEntry, ContentId, DerivedStatName, EquipmentSlot } from './common.js';

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
  readonly modifiers?: Readonly<Partial<Record<DerivedStatName, number>>>;
  readonly startingSpellIds?: readonly ContentId[];
}
