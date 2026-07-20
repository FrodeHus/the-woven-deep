import type { BaseContentEntry, DerivedStatName } from './common.js';

export const CONDITION_TRAIT_IDS = [
  'condition-trait.avoids-opportunity-attacks',
  'condition-trait.incapacitated',
  'condition-trait.interrupts-rest',
  'condition-trait.blocks-recovery',
  'condition-trait.prevents-movement',
  'condition-trait.suppresses-reactions',
] as const;
export type ConditionTraitId = (typeof CONDITION_TRAIT_IDS)[number];

export const CONDITION_STACKING_MODES = ['replace', 'refresh', 'intensify'] as const;
export type ConditionStackingMode = (typeof CONDITION_STACKING_MODES)[number];

export interface ConditionContentEntry extends BaseContentEntry {
  readonly kind: 'condition';
  readonly description: string;
  readonly color: string;
  readonly duration:
    | Readonly<{ mode: 'timed'; default: number; maximum: number }>
    | Readonly<{ mode: 'permanent'; default: null; maximum: null }>;
  readonly stacking: Readonly<{
    mode: ConditionStackingMode;
    maximumStacks: number;
  }>;
  readonly modifiersPerStack: Readonly<Partial<Record<DerivedStatName, number>>>;
  readonly traits: readonly ConditionTraitId[];
}
