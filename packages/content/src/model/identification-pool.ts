import type { BaseContentEntry, ContentId, ItemCategory } from './common.js';

export interface ItemAppearanceVisualDefinition {
  readonly id: ContentId;
  readonly glyph: string;
  readonly color: string;
}

export interface IdentificationPoolContentEntry extends BaseContentEntry {
  readonly kind: 'identification-pool';
  readonly category: ItemCategory;
  readonly verbs: readonly string[];
  readonly nouns: readonly string[];
  readonly visuals: readonly ItemAppearanceVisualDefinition[];
}
