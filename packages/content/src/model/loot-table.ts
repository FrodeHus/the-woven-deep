import type { BaseContentEntry, ContentId } from './common.js';

export interface LootChoiceDefinition {
  readonly contentId: ContentId | null;
  readonly lootTableId: ContentId | null;
  readonly weight: number;
  readonly minimumQuantity: number;
  readonly maximumQuantity: number;
  // Optional depth band restricting when this choice is offered (e.g. town merchant restocks
  // widening at balance.restockMilestones). Absent means unbanded: always available, matching
  // pre-existing behavior. When present, 0 <= minDepth <= maxDepth <= 999. Honoring the band
  // during loot/stock rolls is engine work tracked separately; the content layer only
  // authors and validates it.
  readonly minDepth?: number;
  readonly maxDepth?: number;
}

export interface LootTableContentEntry extends BaseContentEntry {
  readonly kind: 'loot-table';
  readonly rolls: number;
  readonly choices: readonly LootChoiceDefinition[];
}
