import type {
  ActiveRun, CommandResolution, DomainEvent, GameCommand,
  ProcessedCommandResult, RecordedCommand,
} from './model.js';
import { refreshKnowledge } from './perception.js';
import { RECENT_COMMAND_LIMIT } from './versions.js';
import { heroActor, heroPerception } from './actor-model.js';
import { stableJson } from './stable-json.js';
import { validatePlayerAction, type ResolutionContext } from './actions.js';

function sameCommand(left: GameCommand, right: GameCommand): boolean {
  return stableJson(left) === stableJson(right);
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

export function resolveCommand(state: ActiveRun, command: GameCommand, context: ResolutionContext): CommandResolution {
  const previous = state.recentCommands.find((entry) => entry.command.commandId === command.commandId);
  if (previous) {
    return sameCommand(previous.command, command)
      ? { state, result: previous.result, events: previous.publicEvents }
      : rejected(state, command, 'command_id_conflict');
  }
  if (command.expectedRevision !== state.revision) return rejected(state, command, 'stale_revision');
  if (context.content.hash !== state.contentHash) {
    throw new Error(`internal invariant: content hash ${context.content.hash} does not match run ${state.contentHash}`);
  }

  const validation = validatePlayerAction({ state, command, context });
  if ('status' in validation && validation.status === 'decision_required') {
    return { state, result: validation, events: [] };
  }
  if ('status' in validation) {
    const result = { status: 'invalid', commandId: command.commandId, revision: state.revision, turn: state.turn, reason: validation.reason } as const;
    const events = [{ type: 'action.invalid', eventId: command.commandId, commandId: command.commandId, reason: validation.reason }] as const;
    return { state: record(state, command, result, events), result, events };
  }

  const actor = heroActor(state);
  assertCountersCanAdvance(state);
  const result = { status: 'applied', commandId: command.commandId, revision: state.revision + 1, turn: state.turn + 1 } as const;
  if (validation.type === 'wait') {
    const events = [{ type: 'hero.waited', eventId: command.commandId, heroId: actor.actorId, x: actor.x, y: actor.y }] as const;
    return { state: record(state, command, result, events), result, events };
  }
  if (validation.type !== 'move') throw new Error(`internal invariant: no resolver for action ${validation.type}`);
  const floor = state.floors.find((candidate) => candidate.floorId === actor.floorId);
  if (!floor) throw new Error(`internal invariant: active floor ${actor.floorId} is missing`);
  const events = [{ type: 'hero.moved', eventId: command.commandId, heroId: actor.actorId, from: { x: actor.x, y: actor.y }, to: validation.to }] as const;
  const movedActor = { ...actor, ...validation.to };
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
