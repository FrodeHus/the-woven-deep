import type { ActorState, RelationshipOverride } from './actor-model.js';
import type { DungeonFeature } from './feature-model.js';
import type {
  ConfirmAggressionDecision, Direction, FloorSnapshot, MovementInvalidReason, OpaqueId, Point,
} from './model.js';
import { tileIndex } from './model.js';
import { movementBlockReason } from './terrain.js';

const DIRECTION_DELTAS: Readonly<Record<Direction, Point>> = {
  northwest: { x: -1, y: -1 }, north: { x: 0, y: -1 }, northeast: { x: 1, y: -1 },
  west: { x: -1, y: 0 }, east: { x: 1, y: 0 },
  southwest: { x: -1, y: 1 }, south: { x: 0, y: 1 }, southeast: { x: 1, y: 1 },
};

export type MovementActionResult =
  | Readonly<{ status: 'move'; to: Point; cost: number }>
  | Readonly<{ status: 'bump-attack'; targetActorId: OpaqueId; cost: number }>
  | Readonly<{ status: 'decision_required'; decision: ConfirmAggressionDecision }>
  | Readonly<{ status: 'invalid'; reason: MovementInvalidReason }>;

export interface MovementActionInput {
  readonly actor: ActorState;
  readonly floor: FloorSnapshot;
  readonly actors: readonly ActorState[];
  readonly features: readonly DungeonFeature[];
  readonly relationships: readonly RelationshipOverride[];
  readonly direction: Direction;
  readonly cost: number;
}

export function directionDelta(direction: Direction): Point {
  return DIRECTION_DELTAS[direction];
}

function blockReasonAt(input: MovementActionInput, point: Point): MovementInvalidReason | undefined {
  const index = tileIndex(input.floor, point.x, point.y);
  if (index === undefined) return 'blocked.bounds';
  const door = input.features.find((feature) => feature.type === 'door'
    && feature.floorId === input.floor.floorId && feature.x === point.x && feature.y === point.y);
  if (door?.state === 'open') return undefined;
  if (door) return 'blocked.door';
  return movementBlockReason(input.floor.tiles[index]!);
}

function relationship(input: MovementActionInput, target: ActorState): ActorState['disposition'] {
  const override = input.relationships.find((candidate) => (
    candidate.leftActorId === input.actor.actorId && candidate.rightActorId === target.actorId
  ) || (
    candidate.leftActorId === target.actorId && candidate.rightActorId === input.actor.actorId
  ));
  if (override) return override.relationship;
  if (input.actor.disposition === 'hostile' || target.disposition === 'hostile') return 'hostile';
  if (input.actor.disposition === 'neutral' || target.disposition === 'neutral') return 'neutral';
  return 'friendly';
}

export function movementAction(input: MovementActionInput): MovementActionResult {
  const delta = directionDelta(input.direction);
  const to = { x: input.actor.x + delta.x, y: input.actor.y + delta.y };
  const reason = blockReasonAt(input, to);
  if (reason) return { status: 'invalid', reason };
  if (delta.x !== 0 && delta.y !== 0) {
    const horizontal = blockReasonAt(input, { x: input.actor.x + delta.x, y: input.actor.y });
    const vertical = blockReasonAt(input, { x: input.actor.x, y: input.actor.y + delta.y });
    if (horizontal && vertical) return { status: 'invalid', reason: 'blocked.corner' };
  }
  const occupant = input.actors.find((candidate) => candidate.actorId !== input.actor.actorId
    && candidate.floorId === input.floor.floorId && candidate.health > 0 && candidate.x === to.x && candidate.y === to.y);
  if (!occupant) return { status: 'move', to, cost: input.cost };
  const disposition = relationship(input, occupant);
  if (disposition === 'hostile') return { status: 'bump-attack', targetActorId: occupant.actorId, cost: input.cost };
  if (disposition === 'neutral') {
    return { status: 'decision_required', decision: { type: 'confirm-aggression', targetActorId: occupant.actorId } };
  }
  return { status: 'invalid', reason: 'blocked.actor' };
}
