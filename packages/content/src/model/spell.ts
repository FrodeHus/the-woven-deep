import type { BaseContentEntry, EffectDefinition, TargetingId } from './common.js';

export interface SpellAoeDescriptor {
  readonly shape: 'burst' | 'line' | 'cone';
  readonly radius: number;
}

export interface SpellContentEntry extends BaseContentEntry {
  readonly kind: 'spell';
  readonly targetingId: TargetingId;
  readonly range: number;
  readonly actionCost: number;
  readonly weaveCost: number;
  readonly aoe?: SpellAoeDescriptor;
  readonly effects: readonly EffectDefinition[];
}
