import {
  EFFECT_PARAMETER_SCHEMAS,
  type CompiledContentPack,
  type EffectDefinition,
  type EffectId,
} from '@woven-deep/content';
import type { ActorState } from './actor-model.js';
import type { DomainEvent, OpaqueId, Point, Uint32State } from './model.js';
import { rollDie } from './random.js';
import { resolveDamage } from './combat.js';
import { applyCondition, conditionDefinition } from './conditions.js';
import type { ItemInstance } from './item-model.js';
import { consumeItemQuantityFromItems } from './inventory.js';
import type { SurvivalState } from './survival-model.js';
import { restoreHunger } from './survival.js';

export interface EffectSequenceResult {
  readonly actors: readonly ActorState[];
  readonly items: readonly ItemInstance[];
  readonly survival: SurvivalState;
  readonly effectsState: Uint32State;
  readonly events: readonly DomainEvent[];
}

export interface EffectOperationInput {
  readonly effect: EffectDefinition;
  readonly actors: readonly ActorState[];
  readonly sourceActorId: OpaqueId;
  readonly targetActorId: OpaqueId;
  readonly eventId: OpaqueId;
}

export type EffectOperation = (input: EffectOperationInput) => Readonly<{
  actors: readonly ActorState[];
  events: readonly DomainEvent[];
}>;
export type EffectOperations = Readonly<Partial<Record<EffectId, EffectOperation>>>;

export interface EffectSequenceInput {
  readonly effects: readonly EffectDefinition[];
  readonly actors: readonly ActorState[];
  readonly content: CompiledContentPack;
  readonly sourceActorId: OpaqueId;
  readonly targetActorId: OpaqueId;
  readonly effectsState: Uint32State;
  readonly worldTime: number;
  readonly eventId: OpaqueId;
  readonly forceMoveDirection: Point;
  readonly operations: EffectOperations;
  readonly items?: readonly ItemInstance[];
  readonly sourceItemId?: OpaqueId;
  readonly survival: SurvivalState;
  readonly survivalActorId: OpaqueId;
  readonly mitigationByActorId?: Readonly<Record<OpaqueId, Readonly<{ armor: number; resistance: number; immune: boolean }>>>;
}

const DIRECT_EFFECTS = new Set([
  'effect.damage', 'effect.heal', 'effect.condition.apply', 'effect.condition.remove', 'effect.force-move',
  'effect.item.consume', 'effect.hunger.restore',
]);

function checkedSafeInteger(label: string, value: number): number {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a safe integer`);
  return value;
}

function resolveEffectDamage(
  rolled: number,
  mitigation: Readonly<{ armor: number; resistance: number; immune: boolean }>,
): number {
  return resolveDamage({ rolled, ...mitigation });
}

function actorById(actors: readonly ActorState[], actorId: OpaqueId): ActorState {
  const actor = actors.find((candidate) => candidate.actorId === actorId);
  if (!actor) throw new Error(`internal invariant: actor ${actorId} does not exist`);
  return actor;
}

function replaceActor(actors: readonly ActorState[], updated: ActorState): readonly ActorState[] {
  return actors.map((actor) => actor.actorId === updated.actorId ? updated : actor);
}

function rollDice(state: Uint32State, dice: Readonly<{ count: number; sides: number; bonus: number }>) {
  let cursor = state; let value = 0;
  for (let index = 0; index < dice.count; index += 1) {
    const step = rollDie(cursor, dice.sides); cursor = step.state;
    value = checkedSafeInteger('effect dice total', value + step.value);
  }
  value = checkedSafeInteger('effect dice total', value + dice.bonus);
  return { value: Math.max(0, value), state: cursor };
}

export function applyHealing(input: Readonly<{
  actors: readonly ActorState[]; targetActorId: OpaqueId; sourceActorId: OpaqueId; amount: number; eventId: OpaqueId;
}>): Readonly<{ actors: readonly ActorState[]; events: readonly DomainEvent[] }> {
  if (!Number.isSafeInteger(input.amount) || input.amount < 0) throw new RangeError('healing amount must be a non-negative safe integer');
  const target = actorById(input.actors, input.targetActorId);
  const missing = target.maxHealth - target.health;
  if (!Number.isSafeInteger(missing) || missing < 0) throw new RangeError('target health bounds must be safe integers');
  const amount = Math.min(missing, input.amount);
  const health = target.health + amount;
  return {
    actors: replaceActor(input.actors, { ...target, health }),
    events: [{ type: 'actor.healed', eventId: input.eventId, actorId: target.actorId, sourceActorId: input.sourceActorId, amount, health }],
  };
}

export function resolveEffectSequence(input: EffectSequenceInput): EffectSequenceResult {
  if (!Number.isSafeInteger(input.worldTime) || input.worldTime < 0) throw new RangeError('worldTime must be a non-negative safe integer');
  actorById(input.actors, input.sourceActorId);
  actorById(input.actors, input.targetActorId);
  if (input.effects.some((effect) => effect.effectId === 'effect.force-move')) {
    const { x, y } = input.forceMoveDirection;
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)
      || Math.abs(x) > 1 || Math.abs(y) > 1 || (x === 0 && y === 0)) {
      throw new RangeError('forced movement direction must be a nonzero unit direction');
    }
  }
  for (const [index, effect] of input.effects.entries()) {
    const schema = EFFECT_PARAMETER_SCHEMAS[effect.effectId as keyof typeof EFFECT_PARAMETER_SCHEMAS];
    if (!schema) throw new TypeError(`unregistered effect ${effect.effectId} at effects.${index}`);
    const parsed = schema.safeParse(effect.parameters);
    if (!parsed.success) throw new TypeError(`invalid effect ${effect.effectId} at effects.${index}: ${parsed.error.issues[0]!.message}`);
    if (!DIRECT_EFFECTS.has(effect.effectId) && !input.operations[effect.effectId as EffectId]) {
      throw new TypeError(`effect operation ${effect.effectId} is unavailable`);
    }
  }
  let actors = [...input.actors]; let state = input.effectsState; const events: DomainEvent[] = [];
  let items = [...(input.items ?? [])];
  const balance = input.content.entries.find((entry) => entry.kind === 'balance');
  if (!balance) throw new Error('internal invariant: balance definition does not exist');
  let survival = input.survival;
  for (const effect of input.effects) {
    const target = actorById(actors, input.targetActorId);
    if (effect.requiresLivingTarget && target.health === 0) continue;
    if (effect.effectId === 'effect.damage') {
      const parameters = effect.parameters as { damageType: import('@woven-deep/content').DamageType; dice: { count: number; sides: number; bonus: number } };
      const rolled = rollDice(state, parameters.dice); state = rolled.state;
      const mitigation = input.mitigationByActorId?.[target.actorId] ?? { armor: 0, resistance: 0, immune: false };
      const resolvedDamage = resolveEffectDamage(rolled.value, mitigation);
      const health = Math.max(0, target.health - resolvedDamage);
      actors = [...replaceActor(actors, { ...target, health })];
      events.push({
        type: 'attack.hit', eventId: input.eventId, actorId: input.sourceActorId, targetActorId: target.actorId,
        naturalRoll: 2, total: 2, defense: 0, critical: false, rolledDice: parameters.dice.count,
        rolledDamage: rolled.value, effectiveDamage: resolvedDamage, damageType: parameters.damageType,
      }, { type: 'actor.damaged', eventId: input.eventId, actorId: target.actorId, sourceActorId: input.sourceActorId, amount: resolvedDamage, health });
      if (target.health > 0 && health === 0) events.push({
        type: 'actor.died', eventId: input.eventId, actorId: target.actorId,
        contentId: target.contentId, killerActorId: input.sourceActorId,
      });
    } else if (effect.effectId === 'effect.heal') {
      const rolled = rollDice(state, (effect.parameters as { dice: { count: number; sides: number; bonus: number } }).dice); state = rolled.state;
      const result = applyHealing({ actors, targetActorId: target.actorId, sourceActorId: input.sourceActorId, amount: rolled.value, eventId: input.eventId });
      actors = [...result.actors]; events.push(...result.events);
    } else if (effect.effectId === 'effect.hunger.restore') {
      if (target.actorId !== input.survivalActorId) {
        throw new TypeError('effect.hunger.restore requires the survival actor as its target');
      }
      const result = restoreHunger({ survival,
        amount: (effect.parameters as { amount: number }).amount,
        maximum: balance.hungerMaximum, thresholds: balance.hungerThresholds,
        actorId: target.actorId, eventId: input.eventId });
      survival = result.survival; events.push(...result.events);
    } else if (effect.effectId === 'effect.condition.apply') {
      const parameters = effect.parameters as { conditionId: OpaqueId; duration?: number };
      const result = applyCondition({
        actors, content: input.content, targetActorId: target.actorId,
        sourceActorId: input.sourceActorId, conditionId: parameters.conditionId,
        ...(parameters.duration === undefined ? {} : { duration: parameters.duration }),
        worldTime: input.worldTime, eventId: input.eventId,
      });
      actors = [...result.actors]; events.push(...result.events);
    } else if (effect.effectId === 'effect.condition.remove') {
      const conditionId = (effect.parameters as { conditionId: OpaqueId }).conditionId;
      conditionDefinition(input.content, conditionId);
      if (target.conditions.some((condition) => condition.conditionId === conditionId)) {
        actors = [...replaceActor(actors, { ...target, conditions: target.conditions.filter((condition) => condition.conditionId !== conditionId) })];
        events.push({ type: 'condition.removed', eventId: input.eventId, actorId: target.actorId, conditionId });
      }
    } else if (effect.effectId === 'effect.force-move') {
      const distance = (effect.parameters as { distance: number }).distance;
      const from = { x: target.x, y: target.y };
      const to = {
        x: checkedSafeInteger('forced movement x', target.x + input.forceMoveDirection.x * distance),
        y: checkedSafeInteger('forced movement y', target.y + input.forceMoveDirection.y * distance),
      };
      actors = [...replaceActor(actors, { ...target, ...to })];
      events.push({ type: 'actor.forced-move', eventId: input.eventId, actorId: target.actorId, from, to });
    } else if (effect.effectId === 'effect.item.consume') {
      if (!input.sourceItemId) throw new TypeError('effect.item.consume requires sourceItemId');
      const quantity = (effect.parameters as { quantity: number }).quantity;
      const consumed = consumeItemQuantityFromItems({ items, itemId: input.sourceItemId, quantity });
      if (!consumed.ok) throw new RangeError(`effect.item.consume failed: ${consumed.reason}`);
      items = [...consumed.items];
      events.push({
        type: 'item.consumed', eventId: input.eventId, actorId: input.sourceActorId,
        itemId: input.sourceItemId, quantity,
      });
    } else {
      const operation = input.operations[effect.effectId as EffectId]!;
      const result = operation({ effect, actors, sourceActorId: input.sourceActorId, targetActorId: target.actorId, eventId: input.eventId });
      actors = [...result.actors]; events.push(...result.events);
    }
  }
  return { actors, items, survival, effectsState: state, events };
}
