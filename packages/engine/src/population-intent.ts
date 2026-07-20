import type { ActorIntentChangedEvent, OpaqueId } from './model.js';
import type { ActorBehaviorState, PopulationIntent } from './population-model.js';

export type IntentTargetCategory = 'hero' | 'leader' | 'source' | 'position' | null;

export interface PopulationIntentContext {
  readonly phaseChange?: boolean;
  readonly canAttack?: boolean;
  readonly shouldSpawn?: boolean;
  readonly shouldFlee?: boolean;
  readonly protectTarget?: 'leader' | 'source';
  readonly shouldRegroup?: boolean;
  readonly hasTarget?: boolean;
}

export function selectPopulationIntent(context: PopulationIntentContext): PopulationIntent {
  if (context.phaseChange) return 'phase-change';
  if (context.canAttack) return 'attack';
  if (context.shouldSpawn) return 'spawn';
  if (context.shouldFlee) return 'flee';
  if (context.protectTarget) return 'protect';
  if (context.shouldRegroup) return 'regroup';
  if (context.hasTarget) return 'approach';
  return 'hold';
}

export function updatePopulationIntent(
  input: Readonly<{
    eventId: OpaqueId;
    actorId: OpaqueId;
    state: ActorBehaviorState;
    intent: PopulationIntent;
    targetCategory: IntentTargetCategory;
  }>,
): Readonly<{ state: ActorBehaviorState; event: ActorIntentChangedEvent | null }> {
  if (input.state.intent === input.intent) return { state: input.state, event: null };
  return {
    state: { ...input.state, intent: input.intent },
    event: {
      type: 'actor.intent-changed',
      eventId: input.eventId,
      actorId: input.actorId,
      intent: input.intent,
      presentation: `intent.${input.intent}`,
      targetCategory: input.targetCategory,
    },
  };
}
