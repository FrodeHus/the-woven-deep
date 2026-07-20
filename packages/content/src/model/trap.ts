import type { EffectDefinition, PresentedContentEntry, TargetingId } from './common.js';

export const TRAP_DISARM_OUTCOMES = ['safe', 'tool-damage', 'trigger'] as const;
export type TrapDisarmOutcome = typeof TRAP_DISARM_OUTCOMES[number];

export const TRAP_RESET_MODES = ['once', 'reset', 'disabled'] as const;
export type TrapResetMode = typeof TRAP_RESET_MODES[number];

export interface TrapContentEntry extends PresentedContentEntry {
  readonly kind: 'trap';
  readonly targetingId: TargetingId;
  readonly discoveryDifficulty: number;
  readonly disarmDifficulty: number;
  readonly disarmOutcomes: Readonly<{
    failure: TrapDisarmOutcome;
    criticalFailure: TrapDisarmOutcome;
    toolDamage: number;
  }>;
  readonly resetMode: TrapResetMode;
  readonly effects: readonly EffectDefinition[];
}
