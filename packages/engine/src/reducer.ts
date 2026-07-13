import type {
  ActiveRun, CommandResolution, Direction, DomainEvent, GameCommand,
  ProcessedCommandResult, RecordedCommand,
} from './model.js';
import { tileIndex } from './model.js';
import { RECENT_COMMAND_LIMIT } from './versions.js';

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

function record(state: ActiveRun, command: GameCommand, result: ProcessedCommandResult, events: readonly DomainEvent[], hero = state.hero): ActiveRun {
  const next: RecordedCommand = { command, result, events };
  return { ...state, hero, revision: result.revision, turn: result.turn, recentCommands: [...state.recentCommands, next].slice(-RECENT_COMMAND_LIMIT) };
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
    const result = { status: 'applied', commandId: command.commandId, revision: state.revision + 1, turn: state.turn + 1 } as const;
    const events = [{ type: 'hero.waited', eventId: command.commandId, heroId: state.hero.heroId, x: state.hero.x, y: state.hero.y }] as const;
    return { state: record(state, command, result, events), result, events };
  }

  const floor = state.floors.find((candidate) => candidate.floorId === state.hero.floorId);
  if (!floor) throw new Error(`active floor ${state.hero.floorId} is missing`);
  const delta = DELTAS[command.direction];
  const target = { x: state.hero.x + delta.x, y: state.hero.y + delta.y };
  const index = tileIndex(floor, target.x, target.y);
  const reason = index === undefined ? 'blocked.bounds' : floor.tiles[index] === 0 ? 'blocked.wall' : undefined;
  if (reason) {
    const result = { status: 'invalid', commandId: command.commandId, revision: state.revision, turn: state.turn, reason } as const;
    const events = [{ type: 'action.invalid', eventId: command.commandId, commandId: command.commandId, reason }] as const;
    return { state: record(state, command, result, events), result, events };
  }

  const result = { status: 'applied', commandId: command.commandId, revision: state.revision + 1, turn: state.turn + 1 } as const;
  const events = [{ type: 'hero.moved', eventId: command.commandId, heroId: state.hero.heroId, from: { x: state.hero.x, y: state.hero.y }, to: target }] as const;
  return { state: record(state, command, result, events, { ...state.hero, ...target }), result, events };
}
