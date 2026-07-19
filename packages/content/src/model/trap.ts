import type { EffectDefinition, PresentedContentEntry, TargetingId } from './common.js';

export interface TrapContentEntry extends PresentedContentEntry {
  readonly kind: 'trap';
  readonly targetingId: TargetingId;
  readonly discoveryDifficulty: number;
  readonly disarmDifficulty: number;
  readonly disarmOutcomes: Readonly<{
    failure: 'safe' | 'tool-damage' | 'trigger';
    criticalFailure: 'safe' | 'tool-damage' | 'trigger';
    toolDamage: number;
  }>;
  readonly resetMode: 'once' | 'reset' | 'disabled';
  readonly effects: readonly EffectDefinition[];
}
