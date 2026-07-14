import type {
  ActiveRun, CommandResolution, DomainEvent, GameCommand, InvalidActionReason,
  ProcessedCommandResult, PublicEvent, RecordedCommand,
} from './model.js';
import { RECENT_COMMAND_LIMIT } from './versions.js';
import { stableJson } from './stable-json.js';
import { validatePlayerAction, type ResolutionContext } from './actions.js';
import { resolveWorldStep } from './world-step.js';
import { resolveRest } from './rest.js';
import { validateContentBoundRun } from './content-bound-validation.js';
import { closeTradeIfInvalid, isTradeCommand, resolveTradeCommand, validateTradeCommand } from './trade.js';
import { projectDomainEvents } from './event-projection.js';

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

function assertCountersCanAdvance(state: ActiveRun, advanceTurn: boolean): void {
  if (!Number.isSafeInteger(state.revision + 1) || (advanceTurn && !Number.isSafeInteger(state.turn + 1))) {
    throw new Error('internal invariant: applied transition would overflow counters');
  }
}

function recordInvalid(
  state: ActiveRun,
  command: GameCommand,
  reason: InvalidActionReason,
  preEvents: readonly DomainEvent[],
  prePublicEvents: readonly PublicEvent[],
): CommandResolution {
  const result = { status: 'invalid', commandId: command.commandId, revision: state.revision, turn: state.turn, reason } as const;
  const invalid = { type: 'action.invalid', eventId: command.commandId, commandId: command.commandId, reason } as const;
  const events = [...preEvents, invalid];
  const publicEvents = [...prePublicEvents, invalid];
  return { state: record(state, command, result, events, publicEvents), result, events: publicEvents };
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

  // Normalize the modal session first: a session whose merchant no longer satisfies the
  // invariant closes (without a bonus) before the submitted command resolves against it.
  const normalized = closeTradeIfInvalid({ state, content: context.content, eventId: command.commandId });
  const current = normalized.state;
  const preEvents = normalized.events;
  const prePublicEvents = preEvents.length === 0 ? [] : projectDomainEvents({
    state: current, content: context.content, heroId: current.hero.actorId, events: preEvents,
  });

  if (isTradeCommand(command)) {
    const validation = validateTradeCommand({ state: current, command, content: context.content });
    if (!validation.ok) return recordInvalid(current, command, validation.reason, preEvents, prePublicEvents);
    assertCountersCanAdvance(current, false);
    // Trade commands advance the revision only; turn, world time, energy, and survival are untouched.
    const result = { status: 'applied', commandId: command.commandId, revision: current.revision + 1, turn: current.turn } as const;
    const resolved = resolveTradeCommand({ state: current, command, content: context.content });
    const events = [...preEvents, ...resolved.events];
    const publicEvents = [...prePublicEvents, ...projectDomainEvents({
      state: resolved.state, content: context.content, heroId: resolved.state.hero.actorId, events: resolved.events,
    })];
    return { state: record(resolved.state, command, result, events, publicEvents), result, events: publicEvents };
  }
  if (current.activeTrade !== null) {
    return recordInvalid(current, command, 'trade.active', preEvents, prePublicEvents);
  }

  const validation = validatePlayerAction({ state: current, command, context });
  if ('status' in validation && validation.status === 'decision_required') {
    return { state, result: validation, events: [] };
  }
  if ('status' in validation) {
    return recordInvalid(current, command, validation.reason, preEvents, prePublicEvents);
  }

  assertCountersCanAdvance(current, true);
  const result = { status: 'applied', commandId: command.commandId, revision: current.revision + 1, turn: current.turn + 1 } as const;
  const world = validation.type === 'rest'
    ? resolveRest({ state: current, content: context.content, eventId: command.commandId,
      until: validation.until, maximumDuration: validation.maximumDuration })
    : resolveWorldStep({ state: current, content: context.content, action: validation, eventId: command.commandId });
  const events = preEvents.length === 0 ? world.events : [...preEvents, ...world.events];
  const publicEvents = prePublicEvents.length === 0 ? world.publicEvents : [...prePublicEvents, ...world.publicEvents];
  return {
    state: record(world.state, command, result, events, publicEvents),
    result,
    events: publicEvents,
  };
}
