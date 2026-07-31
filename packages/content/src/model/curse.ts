import type { BaseContentEntry, EffectDefinition, EffectId } from './common.js';

export const CURSE_TRIGGER_EVENTS = ['on-kill', 'on-hurt-below-half', 'on-floor-enter'] as const;
export type CurseTriggerEvent = (typeof CURSE_TRIGGER_EVENTS)[number];

/**
 * Effects a curse trigger may fire. Deliberately excludes every effect that can touch terrain,
 * features, traversal, or item inventories — a curse must never gate the win path.
 */
export const CURSE_TRIGGER_EFFECT_IDS = [
  'effect.damage',
  'effect.heal',
  'effect.condition.apply',
  'effect.condition.remove',
  'effect.force-move',
  'effect.hunger.restore',
] as const satisfies readonly EffectId[];
export type CurseTriggerEffectId = (typeof CURSE_TRIGGER_EFFECT_IDS)[number];

export const CURSE_CHANCE_BPS_DEFAULT = 10000;

export interface CurseTriggerDefinition {
  readonly on: CurseTriggerEvent;
  readonly effect: EffectDefinition;
  readonly chanceBps: number; // 1..10000
}

export interface CurseContentEntry extends BaseContentEntry {
  readonly kind: 'curse';
  readonly revealText: string;
  readonly drawbackModifiers: Readonly<Record<string, number>>; // DerivedStatName keys, values < 0
  readonly trigger: CurseTriggerDefinition | null;
}
