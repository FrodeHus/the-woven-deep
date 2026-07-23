import {
  EFFECT_PARAMETER_SCHEMAS,
  type CompiledContentPack,
  type EffectDefinition,
  type EffectId,
} from '@woven-deep/content';
import { replaceActor, type ActorState } from './actor-model.js';
import type {
  ActiveRun,
  DomainEvent,
  FloorSnapshot,
  OpaqueId,
  Point,
  Uint32State,
} from './model.js';
import type { RngStreamName } from './versions.js';
import { rollDie } from './random.js';
import { resolveDamage } from './combat.js';
import { applyCondition, conditionDefinition } from './conditions.js';
import type { ItemInstance } from './item-model.js';
import { parseEffectParameters } from './parameter-contracts.js';
import { consumeItemQuantityFromItems } from './inventory.js';
import type { SurvivalState } from './survival-model.js';
import { restoreHunger } from './survival.js';
import type { DungeonFeature } from './feature-model.js';

export interface EffectSequenceResult {
  readonly actors: readonly ActorState[];
  readonly items: readonly ItemInstance[];
  readonly survival: SurvivalState;
  readonly features: readonly DungeonFeature[];
  readonly floors: readonly FloorSnapshot[];
  readonly effectsState: Uint32State;
  readonly events: readonly DomainEvent[];
}

export function withRngStream(state: ActiveRun, name: RngStreamName, next: Uint32State): ActiveRun {
  return { ...state, rng: { ...state.rng, [name]: next } };
}

export function applyEffectResult(
  state: ActiveRun,
  resolved: Pick<EffectSequenceResult, 'actors' | 'items' | 'survival' | 'effectsState'>,
): ActiveRun {
  return {
    ...state,
    actors: resolved.actors,
    items: resolved.items,
    survival: resolved.survival,
    rng: { ...state.rng, effects: resolved.effectsState },
  };
}

export interface EffectOperationInput {
  readonly effect: EffectDefinition;
  readonly actors: readonly ActorState[];
  readonly sourceActorId: OpaqueId;
  readonly targetActorId: OpaqueId;
  readonly eventId: OpaqueId;
  readonly items: readonly ItemInstance[];
  readonly features: readonly DungeonFeature[];
  readonly floors: readonly FloorSnapshot[];
}

export type EffectOperation = (input: EffectOperationInput) => Readonly<{
  actors: readonly ActorState[];
  items?: readonly ItemInstance[];
  features?: readonly DungeonFeature[];
  floors?: readonly FloorSnapshot[];
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
  readonly features?: readonly DungeonFeature[];
  readonly floors?: readonly FloorSnapshot[];
  readonly sourceItemId?: OpaqueId;
  readonly survival: SurvivalState;
  readonly survivalActorId: OpaqueId;
  readonly mitigationByActorId?: Readonly<
    Record<OpaqueId, Readonly<{ armor: number; resistance: number; immune: boolean }>>
  >;
}

const DIRECT_EFFECTS = new Set([
  'effect.damage',
  'effect.heal',
  'effect.condition.apply',
  'effect.condition.remove',
  'effect.force-move',
  'effect.item.consume',
  'effect.hunger.restore',
]);

const RUN_LEVEL_EFFECTS = new Set<EffectId>(['effect.spell.learn', 'effect.recall']);

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

function findActor(actors: readonly ActorState[], actorId: OpaqueId): ActorState {
  const actor = actors.find((candidate) => candidate.actorId === actorId);
  if (!actor) throw new Error(`internal invariant: actor ${actorId} does not exist`);
  return actor;
}

function rollDice(
  state: Uint32State,
  dice: Readonly<{ count: number; sides: number; bonus: number }>,
) {
  let cursor = state;
  let value = 0;
  for (let index = 0; index < dice.count; index += 1) {
    const step = rollDie(cursor, dice.sides);
    cursor = step.state;
    value = checkedSafeInteger('effect dice total', value + step.value);
  }
  value = checkedSafeInteger('effect dice total', value + dice.bonus);
  return { value: Math.max(0, value), state: cursor };
}

export function applyHealing(
  input: Readonly<{
    actors: readonly ActorState[];
    targetActorId: OpaqueId;
    sourceActorId: OpaqueId;
    amount: number;
    eventId: OpaqueId;
  }>,
): Readonly<{ actors: readonly ActorState[]; events: readonly DomainEvent[] }> {
  if (!Number.isSafeInteger(input.amount) || input.amount < 0)
    throw new RangeError('healing amount must be a non-negative safe integer');
  const target = findActor(input.actors, input.targetActorId);
  const missing = target.maxHealth - target.health;
  if (!Number.isSafeInteger(missing) || missing < 0)
    throw new RangeError('target health bounds must be safe integers');
  const amount = Math.min(missing, input.amount);
  const health = target.health + amount;
  return {
    actors: replaceActor(input.actors, { ...target, health }),
    events: [
      {
        type: 'actor.healed',
        eventId: input.eventId,
        actorId: target.actorId,
        sourceActorId: input.sourceActorId,
        amount,
        health,
      },
    ],
  };
}

export function resolveEffectSequence(input: EffectSequenceInput): EffectSequenceResult {
  if (!Number.isSafeInteger(input.worldTime) || input.worldTime < 0)
    throw new RangeError('worldTime must be a non-negative safe integer');
  findActor(input.actors, input.sourceActorId);
  findActor(input.actors, input.targetActorId);
  if (input.effects.some((effect) => effect.effectId === 'effect.force-move')) {
    const { x, y } = input.forceMoveDirection;
    if (
      !Number.isSafeInteger(x) ||
      !Number.isSafeInteger(y) ||
      Math.abs(x) > 1 ||
      Math.abs(y) > 1 ||
      (x === 0 && y === 0)
    ) {
      throw new RangeError('forced movement direction must be a nonzero unit direction');
    }
  }
  for (const [index, effect] of input.effects.entries()) {
    const schema = EFFECT_PARAMETER_SCHEMAS[effect.effectId];
    if (!schema) throw new TypeError(`unregistered effect ${effect.effectId} at effects.${index}`);
    const parsed = schema.safeParse(effect.parameters);
    if (!parsed.success)
      throw new TypeError(
        `invalid effect ${effect.effectId} at effects.${index}: ${parsed.error.issues[0]!.message}`,
      );
    if (
      !DIRECT_EFFECTS.has(effect.effectId) &&
      !RUN_LEVEL_EFFECTS.has(effect.effectId) &&
      !input.operations[effect.effectId]
    ) {
      throw new TypeError(`effect operation ${effect.effectId} is unavailable`);
    }
  }
  let actors = [...input.actors];
  let state = input.effectsState;
  const events: DomainEvent[] = [];
  let items = [...(input.items ?? [])];
  let features = [...(input.features ?? [])];
  let floors = [...(input.floors ?? [])];
  const balance = input.content.entries.find((entry) => entry.kind === 'balance');
  if (!balance) throw new Error('internal invariant: balance definition does not exist');
  let survival = input.survival;
  for (const effect of input.effects) {
    const target = findActor(actors, input.targetActorId);
    if (effect.requiresLivingTarget && target.health === 0) continue;
    if (effect.effectId === 'effect.damage') {
      const parameters = parseEffectParameters(effect, 'effect.damage');
      const rolled = rollDice(state, parameters.dice);
      state = rolled.state;
      const mitigation = input.mitigationByActorId?.[target.actorId] ?? {
        armor: 0,
        resistance: 0,
        immune: false,
      };
      const resolvedDamage = resolveEffectDamage(rolled.value, mitigation);
      const health = Math.max(0, target.health - resolvedDamage);
      actors = [...replaceActor(actors, { ...target, health })];
      events.push(
        {
          type: 'attack.hit',
          eventId: input.eventId,
          actorId: input.sourceActorId,
          targetActorId: target.actorId,
          naturalRoll: 2,
          total: 2,
          defense: 0,
          critical: false,
          rolledDice: parameters.dice.count,
          rolledDamage: rolled.value,
          effectiveDamage: resolvedDamage,
          damageType: parameters.damageType,
        },
        {
          type: 'actor.damaged',
          eventId: input.eventId,
          actorId: target.actorId,
          sourceActorId: input.sourceActorId,
          amount: resolvedDamage,
          health,
        },
      );
      if (target.health > 0 && health === 0)
        events.push({
          type: 'actor.died',
          eventId: input.eventId,
          actorId: target.actorId,
          contentId: target.contentId,
          killerActorId: input.sourceActorId,
        });
    } else if (effect.effectId === 'effect.heal') {
      const rolled = rollDice(state, parseEffectParameters(effect, 'effect.heal').dice);
      state = rolled.state;
      const result = applyHealing({
        actors,
        targetActorId: target.actorId,
        sourceActorId: input.sourceActorId,
        amount: rolled.value,
        eventId: input.eventId,
      });
      actors = [...result.actors];
      events.push(...result.events);
    } else if (effect.effectId === 'effect.hunger.restore') {
      if (target.actorId !== input.survivalActorId) {
        throw new TypeError('effect.hunger.restore requires the survival actor as its target');
      }
      const result = restoreHunger({
        survival,
        amount: parseEffectParameters(effect, 'effect.hunger.restore').amount,
        maximum: balance.hungerMaximum,
        thresholds: balance.hungerThresholds,
        actorId: target.actorId,
        eventId: input.eventId,
      });
      survival = result.survival;
      events.push(...result.events);
    } else if (effect.effectId === 'effect.condition.apply') {
      const parameters = parseEffectParameters(effect, 'effect.condition.apply');
      const result = applyCondition({
        actors,
        content: input.content,
        targetActorId: target.actorId,
        sourceActorId: input.sourceActorId,
        conditionId: parameters.conditionId,
        ...(parameters.duration === undefined ? {} : { duration: parameters.duration }),
        worldTime: input.worldTime,
        eventId: input.eventId,
      });
      actors = [...result.actors];
      events.push(...result.events);
    } else if (effect.effectId === 'effect.condition.remove') {
      const conditionId = parseEffectParameters(effect, 'effect.condition.remove').conditionId;
      conditionDefinition(input.content, conditionId);
      if (target.conditions.some((condition) => condition.conditionId === conditionId)) {
        actors = [
          ...replaceActor(actors, {
            ...target,
            conditions: target.conditions.filter(
              (condition) => condition.conditionId !== conditionId,
            ),
          }),
        ];
        events.push({
          type: 'condition.removed',
          eventId: input.eventId,
          actorId: target.actorId,
          conditionId,
        });
      }
    } else if (effect.effectId === 'effect.force-move') {
      const distance = parseEffectParameters(effect, 'effect.force-move').distance;
      const from = { x: target.x, y: target.y };
      const to = {
        x: checkedSafeInteger(
          'forced movement x',
          target.x + input.forceMoveDirection.x * distance,
        ),
        y: checkedSafeInteger(
          'forced movement y',
          target.y + input.forceMoveDirection.y * distance,
        ),
      };
      actors = [...replaceActor(actors, { ...target, ...to })];
      events.push({
        type: 'actor.forced-move',
        eventId: input.eventId,
        actorId: target.actorId,
        from,
        to,
      });
    } else if (effect.effectId === 'effect.item.consume') {
      if (!input.sourceItemId) throw new TypeError('effect.item.consume requires sourceItemId');
      const quantity = parseEffectParameters(effect, 'effect.item.consume').quantity;
      const consumed = consumeItemQuantityFromItems({
        items,
        itemId: input.sourceItemId,
        quantity,
      });
      if (!consumed.ok) throw new RangeError(`effect.item.consume failed: ${consumed.reason}`);
      items = [...consumed.items];
      events.push({
        type: 'item.consumed',
        eventId: input.eventId,
        actorId: input.sourceActorId,
        itemId: input.sourceItemId,
        quantity,
      });
    } else if (RUN_LEVEL_EFFECTS.has(effect.effectId)) {
      // Run-level effects (learn, recall) mutate ActiveRun, which resolveEffectSequence does not
      // own. The cast/use-item dispatch handlers apply them. No actor mutation, no RNG here.
      continue;
    } else {
      const operation = input.operations[effect.effectId as EffectId]!;
      const result = operation({
        effect,
        actors,
        items,
        features,
        floors,
        sourceActorId: input.sourceActorId,
        targetActorId: target.actorId,
        eventId: input.eventId,
      });
      actors = [...result.actors];
      if (result.items !== undefined) items = [...result.items];
      if (result.features !== undefined) features = [...result.features];
      if (result.floors !== undefined) floors = [...result.floors];
      events.push(...result.events);
    }
  }
  return { actors, items, features, floors, survival, effectsState: state, events };
}

export interface EffectSweepInput extends Omit<EffectSequenceInput, 'targetActorId'> {
  readonly targetActorIds: readonly OpaqueId[];
  readonly casterActorId: OpaqueId;
  readonly includeCaster: boolean;
}

/**
 * Applies `effects` to every actor named in `targetActorIds` (minus the caster unless opted in),
 * in a stable ascending `actorId` order, folding the effects RNG stream forward actor-by-actor:
 * target N+1 rolls from the state target N returned. Re-simulating from any iteration order is
 * bit-identical. A single-target sweep consumes RNG exactly like one resolveEffectSequence call.
 */
export function resolveEffectSweep(input: EffectSweepInput): EffectSequenceResult {
  const unique = [...new Set(input.targetActorIds)]
    .filter((id) => input.includeCaster || id !== input.casterActorId)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  let actors = input.actors;
  let items = input.items ?? [];
  let features = input.features ?? [];
  let floors = input.floors ?? [];
  let survival = input.survival;
  let state = input.effectsState;
  const events: DomainEvent[] = [];
  for (const targetActorId of unique) {
    const step = resolveEffectSequence({
      ...input,
      actors,
      items,
      features,
      floors,
      survival,
      effectsState: state,
      targetActorId,
    });
    actors = step.actors;
    items = step.items;
    features = step.features;
    floors = step.floors;
    survival = step.survival;
    state = step.effectsState;
    events.push(...step.events);
  }
  return { actors, items, survival, features, floors, effectsState: state, events };
}
