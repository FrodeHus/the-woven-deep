import type { CompiledContentPack } from '@woven-deep/content';
import type { ActorState } from './actor-model.js';
import { actorHasConditionTrait, validateActiveConditions } from './conditions.js';
import type { OpaqueId } from './model.js';

export const READINESS_THRESHOLD = 100;

export interface SchedulerState {
  readonly worldTime: number;
  readonly actors: readonly ActorState[];
  readonly content: CompiledContentPack;
}

export interface SchedulerResult {
  readonly worldTime: number;
  readonly actors: readonly ActorState[];
  readonly selectedActorId: OpaqueId | null;
}

function safeInteger(label: string, value: number): number {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a safe integer`);
  return value;
}

function scheduled(actor: ActorState, content: CompiledContentPack): boolean {
  return actor.health > 0
    && !actorHasConditionTrait(actor, 'condition-trait.incapacitated', content);
}

function compareReadyActors(left: ActorState, right: ActorState): number {
  if (left.energy < right.energy) return 1;
  if (left.energy > right.energy) return -1;
  if (left.playerControlled !== right.playerControlled) return left.playerControlled ? -1 : 1;
  if (left.actorId < right.actorId) return -1;
  if (left.actorId > right.actorId) return 1;
  return 0;
}

function validateScheduledActor(actor: ActorState): void {
  safeInteger(`${actor.actorId}.energy`, actor.energy);
  if (!Number.isSafeInteger(actor.speed) || actor.speed <= 0) {
    throw new RangeError(`${actor.actorId}.speed must be a positive safe integer`);
  }
}

export function selectReadyActor(
  actors: readonly ActorState[],
  content: CompiledContentPack,
): ActorState | undefined {
  validateActiveConditions(actors, content);
  const ready: ActorState[] = [];
  for (const actor of actors) {
    if (!scheduled(actor, content)) continue;
    validateScheduledActor(actor);
    if (actor.energy >= READINESS_THRESHOLD) ready.push(actor);
  }
  ready.sort(compareReadyActors);
  return ready[0];
}

export function chargeActionEnergy(actor: ActorState, cost: number): ActorState {
  safeInteger(`${actor.actorId}.energy`, actor.energy);
  if (!Number.isSafeInteger(cost) || cost < 0) throw new RangeError('action cost must be a non-negative safe integer');
  return { ...actor, energy: safeInteger('energy after action cost', actor.energy - cost) };
}

export function advanceToNextReady(input: SchedulerState): SchedulerResult {
  if (safeInteger('worldTime', input.worldTime) < 0) throw new RangeError('worldTime must be non-negative');
  const immediatelyReady = selectReadyActor(input.actors, input.content);
  if (immediatelyReady) return { worldTime: input.worldTime, actors: [...input.actors], selectedActorId: immediatelyReady.actorId };

  const eligible = input.actors.filter((actor) => scheduled(actor, input.content));
  if (eligible.length === 0) return { worldTime: input.worldTime, actors: [...input.actors], selectedActorId: null };
  for (const actor of eligible) validateScheduledActor(actor);
  const elapsed = Math.min(...eligible.map((actor) => {
    const requiredEnergy = safeInteger(`${actor.actorId}.required energy`, READINESS_THRESHOLD - actor.energy);
    return Math.ceil(requiredEnergy / actor.speed);
  }));
  safeInteger('elapsed time', elapsed);
  const worldTime = safeInteger('worldTime after scheduler advance', input.worldTime + elapsed);
  const eligibleIds = new Set(eligible.map(({ actorId }) => actorId));
  const actors = input.actors.map((actor) => {
    if (!eligibleIds.has(actor.actorId)) return actor;
    const gained = safeInteger(`${actor.actorId}.energy gain`, actor.speed * elapsed);
    return { ...actor, energy: safeInteger(`${actor.actorId}.energy after scheduler advance`, actor.energy + gained) };
  });
  return { worldTime, actors, selectedActorId: selectReadyActor(actors, input.content)?.actorId ?? null };
}
