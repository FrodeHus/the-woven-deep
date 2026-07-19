import type { BaseContentEntry, DerivedStatName } from './common.js';

export interface TraitContentEntry extends BaseContentEntry {
  readonly kind: 'trait';
  readonly description: string;
  readonly modifiers: Readonly<Partial<Record<DerivedStatName, number>>>;
}
