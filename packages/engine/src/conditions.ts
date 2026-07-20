import type {
  CompiledContentPack,
  ConditionContentEntry,
  ConditionTraitId,
} from '@woven-deep/content';
import type { ActorState, ConditionState } from './actor-model.js';
import { entryById } from './content-index.js';
import type { DerivedStatModifier } from './attributes.js';
import type { DomainEvent, OpaqueId } from './model.js';

function safeInteger(label: string, value: number): number {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a safe integer`);
  return value;
}

function targetActor(actors: readonly ActorState[], actorId: OpaqueId): ActorState {
  const actor = actors.find((candidate) => candidate.actorId === actorId);
  if (!actor) throw new Error(`internal invariant: actor ${actorId} does not exist`);
  return actor;
}

export function conditionDefinition(
  content: CompiledContentPack,
  conditionId: OpaqueId,
): ConditionContentEntry {
  const entry = entryById(content, conditionId);
  if (!entry)
    throw new Error(`internal invariant: condition ${conditionId} definition does not exist`);
  if (entry.kind !== 'condition') {
    throw new Error(
      `internal invariant: condition ${conditionId} definition resolves to ${entry.kind}`,
    );
  }
  return entry;
}

export function validateActiveConditions(
  actors: readonly ActorState[],
  content: CompiledContentPack,
): void {
  for (const actor of actors) {
    for (const condition of actor.conditions) {
      const definition = conditionDefinition(content, condition.conditionId);
      if (
        !Number.isSafeInteger(condition.stacks) ||
        condition.stacks <= 0 ||
        condition.stacks > definition.stacking.maximumStacks
      ) {
        throw new RangeError(
          `${actor.actorId}.${condition.conditionId}.stacks must be within maximumStacks ${definition.stacking.maximumStacks}`,
        );
      }
      if (definition.duration.mode === 'permanent' && condition.expiresAt !== null) {
        throw new Error(
          `internal invariant: permanent condition ${condition.conditionId} must have a null deadline`,
        );
      }
      if (definition.duration.mode === 'timed' && condition.expiresAt === null) {
        throw new Error(
          `internal invariant: timed condition ${condition.conditionId} requires a deadline`,
        );
      }
    }
  }
}

export function actorHasConditionTrait(
  actor: ActorState,
  trait: ConditionTraitId,
  content: CompiledContentPack,
): boolean {
  return actor.conditions.some((condition) =>
    conditionDefinition(content, condition.conditionId).traits.includes(trait),
  );
}

export function conditionModifiers(
  actor: ActorState,
  content: CompiledContentPack,
): readonly DerivedStatModifier[] {
  return actor.conditions.map((condition) => {
    const definition = conditionDefinition(content, condition.conditionId);
    return Object.fromEntries(
      Object.entries(definition.modifiersPerStack).map(([name, amount]) => [
        name,
        safeInteger(`${condition.conditionId}.${name} modifier`, amount * condition.stacks),
      ]),
    ) as DerivedStatModifier;
  });
}

export function advanceConditions(
  input: Readonly<{
    actors: readonly ActorState[];
    worldTime: number;
    eventId: OpaqueId;
  }>,
): Readonly<{ actors: readonly ActorState[]; events: readonly DomainEvent[] }> {
  if (!Number.isSafeInteger(input.worldTime) || input.worldTime < 0) {
    throw new RangeError('worldTime must be a non-negative safe integer');
  }
  const events: DomainEvent[] = [];
  const actors = input.actors.map((actor) => {
    const expired = actor.conditions.filter(
      (condition) => condition.expiresAt !== null && condition.expiresAt <= input.worldTime,
    );
    for (const condition of expired)
      events.push({
        type: 'condition.expired',
        eventId: input.eventId,
        actorId: actor.actorId,
        conditionId: condition.conditionId,
      });
    return expired.length === 0
      ? actor
      : {
          ...actor,
          conditions: actor.conditions.filter(
            (condition) => condition.expiresAt === null || condition.expiresAt > input.worldTime,
          ),
        };
  });
  return { actors, events };
}

function deadline(
  definition: ConditionContentEntry,
  duration: number | undefined,
  worldTime: number,
): number | null {
  if (definition.duration.mode === 'permanent') {
    if (duration !== undefined)
      throw new RangeError(`permanent condition ${definition.id} rejects a duration override`);
    return null;
  }
  const selected = duration ?? definition.duration.default;
  if (!Number.isSafeInteger(selected) || selected <= 0 || selected > definition.duration.maximum) {
    throw new RangeError(
      `condition ${definition.id} duration must be a positive safe integer no greater than ${definition.duration.maximum}`,
    );
  }
  return safeInteger(`${definition.id} deadline`, worldTime + selected);
}

function nextStacks(
  definition: ConditionContentEntry,
  existing: ConditionState | undefined,
): number {
  if (definition.stacking.mode !== 'intensify') return 1;
  return Math.min(
    definition.stacking.maximumStacks,
    safeInteger(`${definition.id} stacks`, (existing?.stacks ?? 0) + 1),
  );
}

export function applyCondition(
  input: Readonly<{
    actors: readonly ActorState[];
    content: CompiledContentPack;
    targetActorId: OpaqueId;
    sourceActorId: OpaqueId;
    conditionId: OpaqueId;
    duration?: number;
    worldTime: number;
    eventId: OpaqueId;
  }>,
): Readonly<{ actors: readonly ActorState[]; events: readonly DomainEvent[] }> {
  if (!Number.isSafeInteger(input.worldTime) || input.worldTime < 0) {
    throw new RangeError('worldTime must be a non-negative safe integer');
  }
  const definition = conditionDefinition(input.content, input.conditionId);
  const target = targetActor(input.actors, input.targetActorId);
  const existing = target.conditions.find((condition) => condition.conditionId === definition.id);
  const expiresAt = deadline(definition, input.duration, input.worldTime);
  const stacks = nextStacks(definition, existing);
  const condition: ConditionState = {
    conditionId: definition.id,
    sourceActorId: input.sourceActorId,
    appliedAt: input.worldTime,
    expiresAt,
    stacks,
  };
  const conditions = [
    ...target.conditions.filter((candidate) => candidate.conditionId !== definition.id),
    condition,
  ].sort((left, right) =>
    left.conditionId < right.conditionId ? -1 : left.conditionId > right.conditionId ? 1 : 0,
  );
  return {
    actors: input.actors.map((actor) =>
      actor.actorId === target.actorId ? { ...target, conditions } : actor,
    ),
    events: [
      {
        type: 'condition.applied',
        eventId: input.eventId,
        actorId: target.actorId,
        sourceActorId: input.sourceActorId,
        conditionId: definition.id,
        stacks,
        expiresAt,
      },
    ],
  };
}
