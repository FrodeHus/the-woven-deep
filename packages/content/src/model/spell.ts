import type { BaseContentEntry, EffectDefinition, TargetingId } from './common.js';

export interface SpellContentEntry extends BaseContentEntry {
  readonly kind: 'spell';
  readonly targetingId: TargetingId;
  readonly range: number;
  readonly actionCost: number;
  readonly effects: readonly EffectDefinition[];
}
