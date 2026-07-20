import type { CompiledContentPack } from '@woven-deep/content';
import type { ActorState } from './actor-model.js';
import { actorById, heroActor, heroPerception } from './actor-model.js';
import { itemLightSources } from './equipment.js';
import { featureTiles } from './features.js';
import type { ActiveRun, FloorSnapshot, OpaqueId } from './model.js';
import { refreshKnowledge, type RefreshedPerception } from './perception.js';

export interface FloorPerception extends RefreshedPerception {
  /** The actor whose viewpoint drove the field-of-view (defaults to the hero). */
  readonly actor: ActorState;
  /** The floor with active feature tiles applied, carrying the pre-refresh knowledge. */
  readonly floor: FloorSnapshot;
}

/**
 * Rebuilds one floor's perception from an actor's viewpoint: a positions map of the floor's
 * entities and living-or-dead actors, the effective feature tiles, the hero's sight, and the
 * item light sources on that floor.
 */
export function floorPerception(
  input: Readonly<{
    state: ActiveRun;
    content: CompiledContentPack;
    actorId?: OpaqueId;
    floorId?: OpaqueId;
    lightOutMemory?: Readonly<{ commitsMemory: boolean; revealRadius: number }>;
  }>,
): FloorPerception {
  const actor =
    input.actorId === undefined ? heroActor(input.state) : actorById(input.state, input.actorId);
  if (!actor) throw new Error(`internal invariant: actor ${input.actorId} does not exist`);
  const floorId = input.floorId ?? actor.floorId;
  const floor = input.state.floors.find((candidate) => candidate.floorId === floorId);
  if (!floor) throw new Error(`internal invariant: active floor ${floorId} is missing`);
  const effectiveFloor = { ...floor, tiles: featureTiles(input.state, floor.floorId) };
  const positions = new Map<string, Readonly<{ x: number; y: number }>>(
    floor.entities.map((entity) => [entity.entityId, entity] as const),
  );
  for (const candidate of input.state.actors) {
    if (candidate.floorId === floor.floorId) positions.set(candidate.actorId, candidate);
  }
  const perception = refreshKnowledge({
    floor: effectiveFloor,
    hero: heroPerception(input.state.hero, actor),
    actors: positions,
    additionalLights: itemLightSources({
      run: input.state,
      content: input.content,
      floorId: floor.floorId,
    }),
    ...(input.lightOutMemory === undefined ? {} : { lightOutMemory: input.lightOutMemory }),
  });
  return { actor, floor: effectiveFloor, ...perception };
}

/** The hero's perception of its own active floor. */
export function heroFloorPerception(
  input: Readonly<{
    state: ActiveRun;
    content: CompiledContentPack;
    lightOutMemory?: Readonly<{ commitsMemory: boolean; revealRadius: number }>;
  }>,
): FloorPerception {
  return floorPerception(input);
}
