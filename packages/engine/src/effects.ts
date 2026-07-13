import { EFFECT_PARAMETER_SCHEMAS, type EffectDefinition, type EffectId } from '@woven-deep/content';
import type { ActorState, ConditionState } from './actor-model.js';
import type { DomainEvent, OpaqueId, Point, Uint32State } from './model.js';
import { rollDie } from './random.js';
import { resolveDamage } from './combat.js';

export interface EffectSequenceResult {
  readonly actors: readonly ActorState[];
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
  readonly sourceActorId: OpaqueId;
  readonly targetActorId: OpaqueId;
  readonly effectsState: Uint32State;
  readonly worldTime: number;
  readonly eventId: OpaqueId;
  readonly forceMoveDirection: Point;
  readonly operations: EffectOperations;
  readonly mitigationByActorId?: Readonly<Record<OpaqueId, Readonly<{ armor: number; resistance: number; immune: boolean }>>>;
}

const DIRECT_EFFECTS = new Set([
  'effect.damage', 'effect.heal', 'effect.condition.apply', 'effect.condition.remove', 'effect.force-move',
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
    } else if (effect.effectId === 'effect.condition.apply') {
      const parameters = effect.parameters as { conditionId: OpaqueId; duration: number };
      const existing = target.conditions.find((condition) => condition.conditionId === parameters.conditionId);
      const expiresAt = input.worldTime + parameters.duration;
      if (!Number.isSafeInteger(expiresAt)) throw new RangeError('condition expiry must be a safe integer');
      const condition: ConditionState = {
        conditionId: parameters.conditionId, sourceActorId: input.sourceActorId, appliedAt: input.worldTime,
        expiresAt, stacks: checkedSafeInteger('condition stacks', (existing?.stacks ?? 0) + 1),
      };
      const conditions = [...target.conditions.filter((candidate) => candidate.conditionId !== condition.conditionId), condition]
        .sort((left, right) => left.conditionId < right.conditionId ? -1 : left.conditionId > right.conditionId ? 1 : 0);
      actors = [...replaceActor(actors, { ...target, conditions })];
      events.push({ type: 'condition.applied', eventId: input.eventId, actorId: target.actorId,
        sourceActorId: input.sourceActorId, conditionId: condition.conditionId, stacks: condition.stacks, expiresAt });
    } else if (effect.effectId === 'effect.condition.remove') {
      const conditionId = (effect.parameters as { conditionId: OpaqueId }).conditionId;
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
    } else {
      const operation = input.operations[effect.effectId as EffectId]!;
      const result = operation({ effect, actors, sourceActorId: input.sourceActorId, targetActorId: target.actorId, eventId: input.eventId });
      actors = [...result.actors]; events.push(...result.events);
    }
  }
  return { actors, effectsState: state, events };
}

export function advanceConditions(input: Readonly<{
  actors: readonly ActorState[]; worldTime: number; eventId: OpaqueId;
}>): Readonly<{ actors: readonly ActorState[]; events: readonly DomainEvent[] }> {
  if (!Number.isSafeInteger(input.worldTime) || input.worldTime < 0) throw new RangeError('worldTime must be a non-negative safe integer');
  const events: DomainEvent[] = [];
  const actors = input.actors.map((actor) => {
    const expired = actor.conditions.filter((condition) => condition.expiresAt !== null && condition.expiresAt <= input.worldTime);
    for (const condition of expired) events.push({
      type: 'condition.expired', eventId: input.eventId, actorId: actor.actorId, conditionId: condition.conditionId,
    });
    return expired.length === 0 ? actor : {
      ...actor,
      conditions: actor.conditions.filter((condition) => condition.expiresAt === null || condition.expiresAt > input.worldTime),
    };
  });
  return { actors, events };
}
