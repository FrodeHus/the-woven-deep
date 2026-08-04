import type { CompiledContentPack } from '@woven-deep/content';
import type { ActorState } from './actor-model.js';
import type { DomainEvent, OpaqueId, Uint32State } from './model.js';
import type { CombatResolution } from './combat.js';
import { combat, monsterDefinition, type CombatInput } from './combat-profile.js';
import { applyCondition } from './conditions.js';
import { rollDie } from './random.js';

/**
 * Denominator for a rider's 0..1 authored `chance`, mirroring `monster-loot.ts`'s
 * `DROP_CHANCE_RESOLUTION`: one integer roll compared against an integer threshold, so no float
 * ever reaches a comparison the way engine arithmetic forbids.
 */
const RIDER_CHANCE_RESOLUTION = 10_000;

/**
 * Applies a monster's `onHitConditions` to whatever its attack just landed on.
 *
 * This lives outside `combat-profile.ts` on purpose: that module is the tail of the
 * `conditions.ts -> attributes.ts -> stats.ts -> combat-profile.ts` import chain, so importing
 * `applyCondition` there would close a cycle. Nothing in either chain imports this module back.
 *
 * Randomness is only drawn when a rider can actually fire — a miss, a killing blow, a
 * non-monster attacker, or an empty rider list all return the combat result untouched, so every
 * attack in the game draws exactly the dice it drew before riders existed.
 */
export function applyAttackRiders(
  input: Readonly<{
    resolution: CombatResolution;
    content: CompiledContentPack;
    attackerId: OpaqueId;
    targetActorId: OpaqueId;
    worldTime: number;
    eventId: OpaqueId;
  }>,
): CombatResolution {
  const { resolution } = input;
  if (!resolution.hit || resolution.targetDied) return resolution;
  const attacker = resolution.actors.find((actor) => actor.actorId === input.attackerId);
  if (!attacker) return resolution;
  const riders = monsterDefinition(input.content, attacker)?.onHitConditions ?? [];
  if (riders.length === 0) return resolution;

  let actors: readonly ActorState[] = resolution.actors;
  let combatState: Uint32State = resolution.combatState;
  const events: DomainEvent[] = [...resolution.events];
  // Content authoring keeps riders sorted and unique by condition id, so this draw order is fixed.
  for (const rider of riders) {
    const roll = rollDie(combatState, RIDER_CHANCE_RESOLUTION);
    combatState = roll.state;
    if (roll.value > Math.round(rider.chance * RIDER_CHANCE_RESOLUTION)) continue;
    const applied = applyCondition({
      actors,
      content: input.content,
      targetActorId: input.targetActorId,
      sourceActorId: input.attackerId,
      conditionId: rider.conditionId,
      ...(rider.duration === null ? {} : { duration: rider.duration }),
      worldTime: input.worldTime,
      eventId: input.eventId,
    });
    actors = applied.actors;
    events.push(...applied.events);
  }
  return { ...resolution, actors, combatState, events };
}

/** `combat` with the attacker's on-hit condition riders resolved against the target. */
export function combatWithRiders(input: CombatInput): CombatResolution {
  return applyAttackRiders({
    resolution: combat(input),
    content: input.content,
    attackerId: input.attackerId,
    targetActorId: input.targetActorId,
    worldTime: input.worldTime,
    eventId: input.eventId,
  });
}
