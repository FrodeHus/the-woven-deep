import type { ActiveRun, HeroState, OpaqueId } from './model.js';
import type { ActorBehaviorState, ActorPopulationPresentation } from './population-model.js';

export type AttributeName = 'might' | 'agility' | 'vitality' | 'wits' | 'resolve';
export type Disposition = 'friendly' | 'neutral' | 'hostile';
export type EquipmentSlot =
  | 'main-hand'
  | 'off-hand'
  | 'body'
  | 'head'
  | 'hands'
  | 'feet'
  | 'neck'
  | 'left-ring'
  | 'right-ring';

export interface BaseAttributes {
  readonly might: number;
  readonly agility: number;
  readonly vitality: number;
  readonly wits: number;
  readonly resolve: number;
}

export interface ConditionState {
  readonly conditionId: OpaqueId;
  readonly sourceActorId: OpaqueId | null;
  readonly appliedAt: number;
  readonly expiresAt: number | null;
  readonly stacks: number;
}

export type EquipmentState = Readonly<Record<EquipmentSlot, OpaqueId | null>>;

export interface ActorState {
  readonly actorId: OpaqueId;
  readonly contentId: OpaqueId;
  readonly playerControlled: boolean;
  readonly floorId: OpaqueId;
  readonly x: number;
  readonly y: number;
  readonly attributes: BaseAttributes;
  readonly health: number;
  readonly maxHealth: number;
  readonly weave: number;
  readonly maxWeave: number;
  readonly energy: number;
  readonly speed: number;
  readonly reactionReady: boolean;
  readonly disposition: Disposition;
  readonly awareActorIds: readonly OpaqueId[];
  readonly conditions: readonly ConditionState[];
  readonly equipment: EquipmentState;
  readonly behaviorId: OpaqueId | null;
  readonly behaviorState: ActorBehaviorState;
  readonly populationId: OpaqueId | null;
  readonly populationRoleId: string | null;
  readonly populationPresentation: ActorPopulationPresentation | null;
}

export interface RelationshipOverride {
  readonly leftActorId: OpaqueId;
  readonly rightActorId: OpaqueId;
  readonly relationship: Disposition;
}

export function emptyEquipment(): EquipmentState {
  return {
    'main-hand': null,
    'off-hand': null,
    body: null,
    head: null,
    hands: null,
    feet: null,
    neck: null,
    'left-ring': null,
    'right-ring': null,
  };
}

export function actorById(
  run: Pick<ActiveRun, 'actors'>,
  actorId: OpaqueId,
): ActorState | undefined {
  return run.actors.find((actor) => actor.actorId === actorId);
}

export function replaceActor(
  actors: readonly ActorState[],
  actor: ActorState,
): readonly ActorState[] {
  return actors.map((candidate) => (candidate.actorId === actor.actorId ? actor : candidate));
}

export function withActor(state: ActiveRun, actor: ActorState): ActiveRun {
  return { ...state, actors: replaceActor(state.actors, actor) };
}

export function heroActor(run: Pick<ActiveRun, 'actors' | 'hero'>): ActorState {
  const actor = actorById(run, run.hero.actorId);
  if (actor === undefined || !actor.playerControlled) {
    throw new Error(`internal invariant: hero actor ${run.hero.actorId} is missing`);
  }
  return actor;
}

export function heroPerception(
  hero: HeroState,
  actor: ActorState,
): Readonly<{ heroId: OpaqueId; x: number; y: number; sightRadius: number }> {
  return { heroId: actor.actorId, x: actor.x, y: actor.y, sightRadius: hero.sightRadius };
}
