import type { CompiledContentPack, ConditionContentEntry, DamageType } from '@woven-deep/content';
import type { ActorState } from './actor-model.js';
import type { DomainEvent, OpaqueId, Uint32State } from './model.js';
import { resolveEffectSequence } from './effects.js';
import { conditionDefinition } from './conditions.js';
import type { SurvivalState } from './survival-model.js';

function firstDamageType(definition: ConditionContentEntry): DamageType {
  const damage = (definition.tickEffects ?? []).find(
    (effect) => effect.effectId === 'effect.damage',
  );
  return (damage?.parameters as { damageType?: DamageType } | undefined)?.damageType ?? 'physical';
}

/**
 * Applies each bearer's condition `tickEffects` to the bearer once per world-step tick, BEFORE
 * expiry (`advanceConditions` still owns expiry). Iterates actors in ascending `actorId` and, per
 * actor, conditions in ascending `conditionId`, folding the effects RNG stream forward step by
 * step: re-simulating the same tick from any actor/condition array ordering is bit-identical.
 * Damage is resolved through `resolveEffectSequence` (reusing `resolveDamage`/mitigation), never
 * hand-rolled.
 *
 * This module (not `conditions.ts`) owns the effect-pipeline dependency: it is the only place
 * where condition data and `resolveEffectSequence` (from `effects.ts`) meet, so `conditions.ts`
 * and `survival.ts` stay free of the effect pipeline and out of its import cycle.
 */
export function tickConditions(
  input: Readonly<{
    actors: readonly ActorState[];
    content: CompiledContentPack;
    effectsState: Uint32State;
    worldTime: number;
    eventId: OpaqueId;
    survival: SurvivalState;
    survivalActorId: OpaqueId;
    mitigationFor: (
      actorId: OpaqueId,
      damageType: DamageType,
    ) => Readonly<{ armor: number; resistance: number; immune: boolean }>;
  }>,
): Readonly<{
  actors: readonly ActorState[];
  effectsState: Uint32State;
  events: readonly DomainEvent[];
}> {
  const orderedActorIds = input.actors
    .map((actor) => actor.actorId)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  let actors = input.actors;
  let state = input.effectsState;
  const events: DomainEvent[] = [];
  for (const actorId of orderedActorIds) {
    const bearer = actors.find((actor) => actor.actorId === actorId);
    if (!bearer || bearer.health === 0) continue;
    const conditionIds = [...bearer.conditions]
      .map((condition) => condition.conditionId)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    for (const conditionId of conditionIds) {
      const definition = conditionDefinition(input.content, conditionId);
      const tickEffects = definition.tickEffects ?? [];
      if (tickEffects.length === 0) continue;
      const damageType = firstDamageType(definition);
      const step = resolveEffectSequence({
        effects: tickEffects,
        actors,
        content: input.content,
        sourceActorId: actorId,
        targetActorId: actorId,
        effectsState: state,
        worldTime: input.worldTime,
        eventId: input.eventId,
        forceMoveDirection: { x: 1, y: 0 },
        operations: {},
        survival: input.survival,
        survivalActorId: input.survivalActorId,
        mitigationByActorId: { [actorId]: input.mitigationFor(actorId, damageType) },
      });
      actors = step.actors;
      state = step.effectsState;
      events.push(...step.events);
    }
  }
  return { actors, effectsState: state, events };
}
