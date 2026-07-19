import type { BaseContentEntry, DerivedStatName } from './common.js';
import type { ClassKitBackpackItem } from './class.js';

export interface BackgroundContentEntry extends BaseContentEntry {
  readonly kind: 'background';
  readonly description: string;
  readonly modifiers: Readonly<Partial<Record<DerivedStatName, number>>>;
  readonly extraItems: readonly ClassKitBackpackItem[];
}
