import type { CompiledContentPack } from '@woven-deep/content';
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
import { advanceMerchantLifecycle } from './merchant-lifecycle.js';
import { projectDomainEvents } from './event-projection.js';
import { foldRunMetrics } from './run-metrics.js';
import { concludeRunOnHeroDeath } from './run-conclusion.js';

function sameCommand(left: GameCommand, right: GameCommand): boolean {
  return stableJson(left) === stableJson(right);
}

function rejected(state: ActiveRun, command: GameCommand, reason: 'stale_revision' | 'command_id_conflict'): CommandResolution {
  return { state, result: { status: 'rejected', commandId: command.commandId, revision: state.revision, turn: state.turn, reason }, events: [] };
}

function record(
  state: ActiveRun,
  content: CompiledContentPack,
  command: GameCommand,
  result: ProcessedCommandResult,
  events: readonly DomainEvent[],
  publicEvents: readonly PublicEvent[],
): ActiveRun {
  const next: RecordedCommand = { command, result, events, publicEvents };
  const turnAdvanced = result.status === 'applied' && result.turn > state.turn;
  return {
    ...state,
    revision: result.revision,
    turn: result.turn,
    recentCommands: [...state.recentCommands, next].slice(-RECENT_COMMAND_LIMIT),
    metrics: foldRunMetrics({ metrics: state.metrics, state, content, events, turnAdvanced }),
  };
}

function assertCountersCanAdvance(state: ActiveRun, advanceTurn: boolean): void {
  if (!Number.isSafeInteger(state.revision + 1) || (advanceTurn && !Number.isSafeInteger(state.turn + 1))) {
    throw new Error('internal invariant: applied transition would overflow counters');
  }
}

function recordInvalid(
  state: ActiveRun,
  content: CompiledContentPack,
  command: GameCommand,
  reason: InvalidActionReason,
  preEvents: readonly DomainEvent[],
  prePublicEvents: readonly PublicEvent[],
): CommandResolution {
  const result = { status: 'invalid', commandId: command.commandId, revision: state.revision, turn: state.turn, reason } as const;
  const invalid = { type: 'action.invalid', eventId: command.commandId, commandId: command.commandId, reason } as const;
  const events = [...preEvents, invalid];
  const publicEvents = [...prePublicEvents, invalid];
  return { state: record(state, content, command, result, events, publicEvents), result, events: publicEvents };
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

  // A concluded run accepts no further commands: the rejection consumes no randomness and never
  // touches the modal-session normalization or world branches below.
  if (state.conclusion !== null) {
    return recordInvalid(state, context.content, command, 'run.concluded', [], []);
  }

  // Normalize the modal session first: a session whose merchant no longer satisfies the
  // invariant closes (without a bonus) before the submitted command resolves against it.
  const normalized = closeTradeIfInvalid({ state, content: context.content, eventId: command.commandId });
  const current = normalized.state;
  const preEvents = normalized.events;
  const prePublicEvents = preEvents.length === 0 ? [] : projectDomainEvents({
    state: current, content: context.content, heroId: current.hero.actorId, events: preEvents,
  });

  if (isTradeCommand(command)) {
    // Ordinary trade commands never advance the merchant lifecycle; only trade-close resolves a
    // previously due merchant immediately after its session closed (whether the player closed it
    // or normalization above already did).
    const resolveDeadlines = (state: ActiveRun): ReturnType<typeof advanceMerchantLifecycle> =>
      command.type === 'trade-close'
        ? advanceMerchantLifecycle({ state, content: context.content, previousWorldTime: state.worldTime,
          nextWorldTime: state.worldTime, eventId: command.commandId })
        : { state, events: [] };
    const validation = validateTradeCommand({ state: current, command, content: context.content });
    if (!validation.ok) {
      const lifecycle = resolveDeadlines(current);
      const lifecyclePublic = lifecycle.events.length === 0 ? [] : projectDomainEvents({
        state: lifecycle.state, content: context.content, heroId: lifecycle.state.hero.actorId,
        events: lifecycle.events,
      });
      return recordInvalid(lifecycle.state, context.content, command, validation.reason,
        [...preEvents, ...lifecycle.events], [...prePublicEvents, ...lifecyclePublic]);
    }
    assertCountersCanAdvance(current, false);
    // Trade commands advance the revision only; turn, world time, energy, and survival are untouched.
    const result = { status: 'applied', commandId: command.commandId, revision: current.revision + 1, turn: current.turn } as const;
    const resolved = resolveTradeCommand({ state: current, command, content: context.content });
    const lifecycle = resolveDeadlines(resolved.state);
    const commandEvents = [...resolved.events, ...lifecycle.events];
    const events = [...preEvents, ...commandEvents];
    const publicEvents = [...prePublicEvents, ...projectDomainEvents({
      state: lifecycle.state, content: context.content, heroId: lifecycle.state.hero.actorId, events: commandEvents,
    })];
    return { state: record(lifecycle.state, context.content, command, result, events, publicEvents), result, events: publicEvents };
  }
  if (current.activeTrade !== null) {
    return recordInvalid(current, context.content, command, 'trade.active', preEvents, prePublicEvents);
  }

  const validation = validatePlayerAction({ state: current, command, context });
  if ('status' in validation && validation.status === 'decision_required') {
    // A pending decision leaves the command unrecorded, but the modal-session normalization above
    // already happened: keep the normalized state and deliver its events (e.g. trade.closed).
    return { state: current, result: validation, events: prePublicEvents };
  }
  if ('status' in validation) {
    return recordInvalid(current, context.content, command, validation.reason, preEvents, prePublicEvents);
  }

  assertCountersCanAdvance(current, true);
  const result = { status: 'applied', commandId: command.commandId, revision: current.revision + 1, turn: current.turn + 1 } as const;
  const world = validation.type === 'rest'
    ? resolveRest({ state: current, content: context.content, eventId: command.commandId,
      until: validation.until, maximumDuration: validation.maximumDuration })
    : resolveWorldStep({ state: current, content: context.content, action: validation, eventId: command.commandId });
  // The conclusion boundary runs inside this same transition: a hero killed by the world branch
  // above is concluded here, before the command is recorded, so the recorded event stream and the
  // resulting state agree on whether (and how) the run ended.
  const concluded = concludeRunOnHeroDeath({
    state: world.state, content: context.content, events: world.events,
    revision: result.revision, turn: result.turn, eventId: command.commandId,
  });
  const conclusionEvents = concluded.events.slice(world.events.length);
  const conclusionPublicEvents = conclusionEvents.length === 0 ? [] : projectDomainEvents({
    state: concluded.state, content: context.content, heroId: concluded.state.hero.actorId, events: conclusionEvents,
  });
  const worldPublicEvents = conclusionPublicEvents.length === 0 ? world.publicEvents
    : [...world.publicEvents, ...conclusionPublicEvents];
  const events = preEvents.length === 0 ? concluded.events : [...preEvents, ...concluded.events];
  const publicEvents = prePublicEvents.length === 0 ? worldPublicEvents : [...prePublicEvents, ...worldPublicEvents];
  return {
    state: record(concluded.state, context.content, command, result, events, publicEvents),
    result,
    events: publicEvents,
  };
}
