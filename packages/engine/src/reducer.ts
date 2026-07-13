import type {
  ActiveRun, CommandResolution, Direction, DomainEvent, GameCommand,
  ProcessedCommandResult, RecordedCommand,
} from './model.js';
import { tileIndex } from './model.js';
import { refreshKnowledge } from './perception.js';
import { movementBlockReason } from './terrain.js';
import { RECENT_COMMAND_LIMIT } from './versions.js';
import { heroActor, heroPerception } from './actor-model.js';

const DELTAS: Readonly<Record<Direction, Readonly<{ x: number; y: number }>>> = {
  north: { x: 0, y: -1 }, south: { x: 0, y: 1 }, east: { x: 1, y: 0 }, west: { x: -1, y: 0 },
};

function sameCommand(left: GameCommand, right: GameCommand): boolean {
  return left.type === right.type
    && left.commandId === right.commandId
    && left.expectedRevision === right.expectedRevision
    && (left.type !== 'move' || (right.type === 'move' && left.direction === right.direction));
}

function rejected(state: ActiveRun, command: GameCommand, reason: 'stale_revision' | 'command_id_conflict'): CommandResolution {
  return { state, result: { status: 'rejected', commandId: command.commandId, revision: state.revision, turn: state.turn, reason }, events: [] };
}

function record(
  state: ActiveRun,
  command: GameCommand,
  result: ProcessedCommandResult,
  events: readonly DomainEvent[],
  actors = state.actors,
): ActiveRun {
  const next: RecordedCommand = { command, result, events, publicEvents: events };
  return {
    ...state,
    actors,
    revision: result.revision,
    turn: result.turn,
    recentCommands: [...state.recentCommands, next].slice(-RECENT_COMMAND_LIMIT),
  };
}

function assertCountersCanAdvance(state: ActiveRun): void {
  if (!Number.isSafeInteger(state.revision + 1) || !Number.isSafeInteger(state.turn + 1)) {
    throw new Error('internal invariant: applied transition would overflow counters');
  }
}

export function resolveCommand(state: ActiveRun, command: GameCommand): CommandResolution {
  const previous = state.recentCommands.find((entry) => entry.command.commandId === command.commandId);
  if (previous) {
    return sameCommand(previous.command, command)
      ? { state, result: previous.result, events: previous.events }
      : rejected(state, command, 'command_id_conflict');
  }
  if (command.expectedRevision !== state.revision) return rejected(state, command, 'stale_revision');

  if (command.type === 'wait') {
    const actor = heroActor(state);
    assertCountersCanAdvance(state);
    const result = { status: 'applied', commandId: command.commandId, revision: state.revision + 1, turn: state.turn + 1 } as const;
    const events = [{ type: 'hero.waited', eventId: command.commandId, heroId: actor.actorId, x: actor.x, y: actor.y }] as const;
    return { state: record(state, command, result, events), result, events };
  }

  const actor = heroActor(state);
  const floor = state.floors.find((candidate) => candidate.floorId === actor.floorId);
  if (!floor) throw new Error(`active floor ${actor.floorId} is missing`);
  const delta = DELTAS[command.direction];
  const target = { x: actor.x + delta.x, y: actor.y + delta.y };
  const index = tileIndex(floor, target.x, target.y);
  const reason = index === undefined ? 'blocked.bounds' : movementBlockReason(floor.tiles[index]!);
  if (reason) {
    const result = { status: 'invalid', commandId: command.commandId, revision: state.revision, turn: state.turn, reason } as const;
    const events = [{ type: 'action.invalid', eventId: command.commandId, commandId: command.commandId, reason }] as const;
    return { state: record(state, command, result, events), result, events };
  }

  assertCountersCanAdvance(state);
  const result = { status: 'applied', commandId: command.commandId, revision: state.revision + 1, turn: state.turn + 1 } as const;
  const events = [{ type: 'hero.moved', eventId: command.commandId, heroId: actor.actorId, from: { x: actor.x, y: actor.y }, to: target }] as const;
  const movedActor = { ...actor, ...target };
  const nextActors = state.actors.map((candidate) => candidate.actorId === movedActor.actorId ? movedActor : candidate);
  const moved = record(state, command, result, events, nextActors);
  const actors = new Map<string, Readonly<{ x: number; y: number }>>(
    floor.entities.map((entity) => [entity.entityId, entity] as const),
  );
  for (const candidate of nextActors) {
    if (candidate.floorId === floor.floorId) actors.set(candidate.actorId, candidate);
  }
  const knowledge = refreshKnowledge({ floor, hero: heroPerception(state.hero, movedActor), actors }).knowledge;
  const floors = state.floors.map((candidate) => candidate === floor ? { ...candidate, knowledge } : candidate);
  return { state: { ...moved, floors }, result, events };
}
