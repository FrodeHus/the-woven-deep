import type {
  ActiveRun, CommandResolution, DomainEvent, GameCommand,
  ProcessedCommandResult, PublicEvent, RecordedCommand,
} from './model.js';
import { RECENT_COMMAND_LIMIT } from './versions.js';
import { stableJson } from './stable-json.js';
import { validatePlayerAction, type ResolutionContext } from './actions.js';
import { resolveWorldStep } from './world-step.js';
import { resolveRest } from './rest.js';
import { validateContentBoundRun } from './content-bound-validation.js';

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
  publicEvents: readonly PublicEvent[],
): ActiveRun {
  const next: RecordedCommand = { command, result, events, publicEvents };
  return {
    ...state,
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
  validateContentBoundRun(state, context.content);

  const validation = validatePlayerAction({ state, command, context });
  if ('status' in validation && validation.status === 'decision_required') {
    return { state, result: validation, events: [] };
  }
  if ('status' in validation) {
    const result = { status: 'invalid', commandId: command.commandId, revision: state.revision, turn: state.turn, reason: validation.reason } as const;
    const events = [{ type: 'action.invalid', eventId: command.commandId, commandId: command.commandId, reason: validation.reason }] as const;
    return { state: record(state, command, result, events, events), result, events };
  }

  assertCountersCanAdvance(state);
  const result = { status: 'applied', commandId: command.commandId, revision: state.revision + 1, turn: state.turn + 1 } as const;
  const world = validation.type === 'rest'
    ? resolveRest({ state, content: context.content, eventId: command.commandId,
      until: validation.until, maximumDuration: validation.maximumDuration })
    : resolveWorldStep({ state, content: context.content, action: validation, eventId: command.commandId });
  return {
    state: record(world.state, command, result, world.events, world.publicEvents),
    result,
    events: world.publicEvents,
  };
}
