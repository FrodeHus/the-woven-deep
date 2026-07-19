import type { DamageType, DiceDefinition, PopulationCombatModifiers } from '@woven-deep/content';
import type { ActorState } from './actor-model.js';
import type { DomainEvent, OpaqueId, Uint32State } from './model.js';
import { rollDie } from './random.js';

export interface DamageResolutionInput {
  readonly rolled: number;
  readonly armor: number;
  readonly resistance: number;
  readonly immune: boolean;
}

export function resolveDamage(input: DamageResolutionInput): number {
  for (const [name, value] of Object.entries(input)) {
    if (name === 'immune') continue;
    if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be a safe integer`);
  }
  if (input.rolled < 0 || input.armor < 0 || input.resistance < -100 || input.resistance > 100) {
    throw new RangeError('damage, armor, and resistance are outside their supported range');
  }
  if (input.immune) return 0;
  const afterArmor = Math.max(0, input.rolled - input.armor);
  const effective = Math.ceil(afterArmor * (100 - input.resistance) / 100);
  if (!Number.isSafeInteger(effective)) throw new RangeError('effective damage must be a safe integer');
  return input.rolled > 0 ? Math.max(1, effective) : 0;
}

export interface AttackResolutionInput {
  readonly eventId: OpaqueId;
  readonly attackerId: OpaqueId;
  readonly targetActorId: OpaqueId;
  readonly actors: readonly ActorState[];
  readonly combatState: Uint32State;
  readonly accuracy: number;
  readonly defense: number;
  readonly damage: DiceDefinition;
  readonly armor: number;
  readonly resistance: number;
  readonly immune: boolean;
  readonly damageType: DamageType;
}

export interface CombatResolution {
  readonly actors: readonly ActorState[];
  readonly combatState: Uint32State;
  readonly events: readonly DomainEvent[];
  readonly targetDied: boolean;
}

function safeInteger(label: string, value: number): number {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a safe integer`);
  return value;
}

export function composePopulationCombatModifiers(
  modifierSets: readonly PopulationCombatModifiers[],
): PopulationCombatModifiers {
  return modifierSets.reduce<PopulationCombatModifiers>((total, modifiers) => ({
    accuracy: total.accuracy + modifiers.accuracy,
    defense: total.defense + modifiers.defense,
    damage: total.damage + modifiers.damage,
  }), { accuracy: 0, defense: 0, damage: 0 });
}

export function applyPopulationCombatModifiers<T extends Readonly<{
  accuracy: number; defense: number; damage: DiceDefinition;
}>>(profile: T, modifiers: PopulationCombatModifiers): T {
  const accuracy = safeInteger('population accuracy', profile.accuracy + modifiers.accuracy);
  const defense = safeInteger('population defense', profile.defense + modifiers.defense);
  const bonus = safeInteger('population damage', profile.damage.bonus + modifiers.damage);
  return { ...profile, accuracy, defense, damage: { ...profile.damage, bonus } };
}

export function resolveAttack(input: AttackResolutionInput): CombatResolution {
  const attacker = input.actors.find((actor) => actor.actorId === input.attackerId);
  const target = input.actors.find((actor) => actor.actorId === input.targetActorId);
  if (!attacker || !target) throw new Error('internal invariant: combat actors must exist');
  safeInteger('accuracy', input.accuracy);
  safeInteger('defense', input.defense);
  if (!Number.isSafeInteger(input.damage.count) || input.damage.count <= 0
    || !Number.isSafeInteger(input.damage.sides) || input.damage.sides <= 0) {
    throw new RangeError('damage dice must use positive safe integers');
  }
  safeInteger('damage bonus', input.damage.bonus);
  const attackRoll = rollDie(input.combatState, 20);
  const total = safeInteger('attack total', attackRoll.value + input.accuracy);
  const hit = attackRoll.value === 20 || (attackRoll.value !== 1 && total >= input.defense);
  if (!hit) {
    return {
      actors: [...input.actors], combatState: attackRoll.state, targetDied: false,
      events: [{
        type: 'attack.missed', eventId: input.eventId, actorId: attacker.actorId,
        targetActorId: target.actorId, naturalRoll: attackRoll.value, total, defense: input.defense,
      }],
    };
  }
  const critical = attackRoll.value === 20;
  const rolledDice = input.damage.count * (critical ? 2 : 1);
  safeInteger('rolled dice', rolledDice);
  let cursor = attackRoll.state;
  let rolledDamage = 0;
  for (let index = 0; index < rolledDice; index += 1) {
    const roll = rollDie(cursor, input.damage.sides);
    cursor = roll.state;
    rolledDamage = safeInteger('rolled damage', rolledDamage + roll.value);
  }
  rolledDamage = Math.max(0, safeInteger('rolled damage with bonus', rolledDamage + input.damage.bonus));
  const effectiveDamage = resolveDamage({
    rolled: rolledDamage, armor: input.armor, resistance: input.resistance, immune: input.immune,
  });
  const health = Math.max(0, safeInteger('target health', target.health - effectiveDamage));
  const damaged = { ...target, health };
  const actors = input.actors.map((actor) => actor.actorId === target.actorId ? damaged : actor);
  const events: DomainEvent[] = [{
    type: 'attack.hit', eventId: input.eventId, actorId: attacker.actorId, targetActorId: target.actorId,
    naturalRoll: attackRoll.value, total, defense: input.defense, critical, rolledDice, rolledDamage,
    effectiveDamage, damageType: input.damageType,
  }, {
    type: 'actor.damaged', eventId: input.eventId, actorId: target.actorId,
    sourceActorId: attacker.actorId, amount: effectiveDamage, health,
  }];
  const targetDied = target.health > 0 && health === 0;
  if (targetDied) events.push({
    type: 'actor.died', eventId: input.eventId, actorId: target.actorId,
    contentId: target.contentId, killerActorId: attacker.actorId,
  });
  return { actors, combatState: cursor, events, targetDied };
}
