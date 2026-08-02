import type { CompiledContentPack } from '@woven-deep/content';
import type {
  ActiveRun,
  CommandResolution,
  DomainEvent,
  GameCommand,
  InvalidActionReason,
  ProcessedCommandResult,
  PublicEvent,
  RecordedCommand,
} from './model.js';
import { RECENT_COMMAND_LIMIT } from './versions.js';
import { stableJson } from './stable-json.js';
import { validatePlayerAction, type ResolutionContext } from './actions.js';
import { resolveWorldStep } from './world-step.js';
import { resolveRest } from './rest.js';
import { validateContentBoundRun } from './content-bound-validation.js';
import {
  closeTradeIfInvalid,
  isTradeCommand,
  resolveTradeCommand,
  validateTradeCommand,
} from './trade.js';
import {
  applyDialogueConsequence,
  isDialogueCommand,
  validateDialogueCommand,
} from './dialogue.js';
import { isHouseCommand, resolveHouseCommand, validateHouseCommand } from './house.js';
import { advanceMerchantLifecycle } from './merchant-lifecycle.js';
import { projectDomainEvents } from './event-projection.js';
import { foldRunMetrics } from './run-metrics.js';
import { synchronizeDerivedMaxima } from './derived-maxima.js';
import { concludeRunOnChoice, concludeRunOnHeroDeath } from './run-conclusion.js';
import { applyCurseTriggers } from './curse-triggers.js';
import { isTownFloorActive } from './town-floor.js';
import { FINAL_CHAMBER_DEPTH } from './final-chamber.js';
import { heroHoldsAllFragments } from './final-chamber-fragments.js';
import { isHeartBossActive, isHeartBossDefeated } from './final-chamber-boss-state.js';

function sameCommand(left: GameCommand, right: GameCommand): boolean {
  return stableJson(left) === stableJson(right);
}

function rejected(
  state: ActiveRun,
  command: GameCommand,
  reason: 'stale_revision' | 'command_id_conflict',
): CommandResolution {
  return {
    state,
    result: {
      status: 'rejected',
      commandId: command.commandId,
      revision: state.revision,
      turn: state.turn,
      reason,
    },
    events: [],
  };
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
  if (
    !Number.isSafeInteger(state.revision + 1) ||
    (advanceTurn && !Number.isSafeInteger(state.turn + 1))
  ) {
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
  const result = {
    status: 'invalid',
    commandId: command.commandId,
    revision: state.revision,
    turn: state.turn,
    reason,
  } as const;
  const invalid = {
    type: 'action.invalid',
    eventId: command.commandId,
    commandId: command.commandId,
    reason,
  } as const;
  const events = [...preEvents, invalid];
  const publicEvents = [...prePublicEvents, invalid];
  return {
    state: record(state, content, command, result, events, publicEvents),
    result,
    events: publicEvents,
  };
}

export function resolveCommand(
  state: ActiveRun,
  command: GameCommand,
  context: ResolutionContext,
): CommandResolution {
  const previous = state.recentCommands.find(
    (entry) => entry.command.commandId === command.commandId,
  );
  if (previous) {
    return sameCommand(previous.command, command)
      ? { state, result: previous.result, events: previous.publicEvents }
      : rejected(state, command, 'command_id_conflict');
  }
  if (command.expectedRevision !== state.revision)
    return rejected(state, command, 'stale_revision');
  if (context.content.hash !== state.contentHash) {
    throw new Error(
      `internal invariant: content hash ${context.content.hash} does not match run ${state.contentHash}`,
    );
  }
  validateContentBoundRun(state, context.content);

  // A concluded run accepts no further commands: the rejection consumes no randomness and never
  // touches the modal-session normalization or world branches below.
  if (state.conclusion !== null) {
    return recordInvalid(state, context.content, command, 'run.concluded', [], []);
  }

  // The town (depth 0) is a truce zone with frozen worldTime: hostile actions and resting both
  // consume no randomness here, so they are rejected before any stream touches, the same way a
  // concluded run is above.
  if (
    isTownFloorActive(state) &&
    (command.type === 'attack' ||
      command.type === 'fire' ||
      command.type === 'cast' ||
      command.type === 'throw-item')
  ) {
    return recordInvalid(state, context.content, command, 'town.truce', [], []);
  }
  if (isTownFloorActive(state) && command.type === 'rest') {
    return recordInvalid(state, context.content, command, 'town.rest', [], []);
  }

  // The Final Chamber choice is gated the same way: off the Chamber floor, or with an
  // unsatisfied fragment set for `break-cycle`, the rejection consumes no randomness and never
  // reaches the modal-session normalization or world branches below.
  if (command.type === 'final-chamber-choice') {
    const activeFloor = state.floors.find((floor) => floor.floorId === state.activeFloorId);
    if (!activeFloor || activeFloor.depth !== FINAL_CHAMBER_DEPTH) {
      return recordInvalid(state, context.content, command, 'final-chamber.unavailable', [], []);
    }
    // Turning away is a one-way door: once the weakened Heart is fighting, the choice window is
    // closed. The only way out is the fight (win -> `refused`, lose -> forced `became-heart`), so
    // every further choice -- a second `turn-away`, or a late `become-heart`/`break-cycle` -- is
    // rejected here before it could re-inject the boss or conclude mid-fight.
    if (isHeartBossActive(state)) {
      return recordInvalid(state, context.content, command, 'final-chamber.boss-active', [], []);
    }
    if (command.choice === 'break-cycle' && !heroHoldsAllFragments(state, context.content)) {
      return recordInvalid(
        state,
        context.content,
        command,
        'final-chamber.fragments-required',
        [],
        [],
      );
    }
  }

  // Normalize the modal session first: a session whose merchant no longer satisfies the
  // invariant closes (without a bonus) before the submitted command resolves against it.
  const normalized = closeTradeIfInvalid({
    state,
    content: context.content,
    eventId: command.commandId,
  });
  const current = normalized.state;
  const preEvents = normalized.events;
  const prePublicEvents =
    preEvents.length === 0
      ? []
      : projectDomainEvents({
          state: current,
          content: context.content,
          heroId: current.hero.actorId,
          events: preEvents,
        });

  if (isTradeCommand(command)) {
    // Ordinary trade commands never advance the merchant lifecycle; only trade-close resolves a
    // previously due merchant immediately after its session closed (whether the player closed it
    // or normalization above already did).
    const resolveDeadlines = (state: ActiveRun): ReturnType<typeof advanceMerchantLifecycle> =>
      command.type === 'trade-close'
        ? advanceMerchantLifecycle({
            state,
            content: context.content,
            previousWorldTime: state.worldTime,
            nextWorldTime: state.worldTime,
            eventId: command.commandId,
          })
        : { state, events: [] };
    const validation = validateTradeCommand({ state: current, command, content: context.content });
    if (!validation.ok) {
      const lifecycle = resolveDeadlines(current);
      const lifecyclePublic =
        lifecycle.events.length === 0
          ? []
          : projectDomainEvents({
              state: lifecycle.state,
              content: context.content,
              heroId: lifecycle.state.hero.actorId,
              events: lifecycle.events,
            });
      return recordInvalid(
        lifecycle.state,
        context.content,
        command,
        validation.reason,
        [...preEvents, ...lifecycle.events],
        [...prePublicEvents, ...lifecyclePublic],
      );
    }
    assertCountersCanAdvance(current, false);
    // Trade commands advance the revision only; turn, world time, energy, and survival are untouched.
    const result = {
      status: 'applied',
      commandId: command.commandId,
      revision: current.revision + 1,
      turn: current.turn,
    } as const;
    const resolved = resolveTradeCommand({ state: current, command, content: context.content });
    const lifecycle = resolveDeadlines(resolved.state);
    const commandEvents = [...resolved.events, ...lifecycle.events];
    const events = [...preEvents, ...commandEvents];
    const publicEvents = [
      ...prePublicEvents,
      ...projectDomainEvents({
        state: lifecycle.state,
        content: context.content,
        heroId: lifecycle.state.hero.actorId,
        events: commandEvents,
      }),
    ];
    return {
      state: record(lifecycle.state, context.content, command, result, events, publicEvents),
      result,
      events: publicEvents,
    };
  }
  if (current.activeTrade !== null) {
    return recordInvalid(
      current,
      context.content,
      command,
      'trade.active',
      preEvents,
      prePublicEvents,
    );
  }

  if (isDialogueCommand(command)) {
    const validation = validateDialogueCommand({
      state: current,
      command,
      content: context.content,
    });
    if (!validation.ok) {
      return recordInvalid(
        current,
        context.content,
        command,
        validation.reason,
        preEvents,
        prePublicEvents,
      );
    }
    assertCountersCanAdvance(current, false);
    // Dialogue commands advance the revision only, exactly like trade and house commands: no
    // turn, world time, energy, or survival change.
    const result = {
      status: 'applied',
      commandId: command.commandId,
      revision: current.revision + 1,
      turn: current.turn,
    } as const;
    const resolved = applyDialogueConsequence({
      state: current,
      command,
      content: context.content,
    });
    const events = [...preEvents, ...resolved.events];
    const publicEvents = [
      ...prePublicEvents,
      ...(resolved.events.length === 0
        ? []
        : projectDomainEvents({
            state: resolved.state,
            content: context.content,
            heroId: resolved.state.hero.actorId,
            events: resolved.events,
          })),
    ];
    return {
      state: record(resolved.state, context.content, command, result, events, publicEvents),
      result,
      events: publicEvents,
    };
  }

  if (isHouseCommand(command)) {
    const validation = validateHouseCommand({ state: current, command, content: context.content });
    if (!validation.ok) {
      return recordInvalid(
        current,
        context.content,
        command,
        validation.reason,
        preEvents,
        prePublicEvents,
      );
    }
    assertCountersCanAdvance(current, false);
    // House commands advance the revision only, exactly like trade commands: no turn, world
    // time, energy, or survival change.
    const result = {
      status: 'applied',
      commandId: command.commandId,
      revision: current.revision + 1,
      turn: current.turn,
    } as const;
    const resolved = resolveHouseCommand({ state: current, command, content: context.content });
    const events = [...preEvents, ...resolved.events];
    const publicEvents = [
      ...prePublicEvents,
      ...(resolved.events.length === 0
        ? []
        : projectDomainEvents({
            state: resolved.state,
            content: context.content,
            heroId: resolved.state.hero.actorId,
            events: resolved.events,
          })),
    ];
    return {
      state: record(resolved.state, context.content, command, result, events, publicEvents),
      result,
      events: publicEvents,
    };
  }

  const validation = validatePlayerAction({ state: current, command, context });
  if ('status' in validation && validation.status === 'decision_required') {
    // A pending decision leaves the command unrecorded, but the modal-session normalization above
    // already happened: keep the normalized state and deliver its events (e.g. trade.closed).
    return { state: current, result: validation, events: prePublicEvents };
  }
  if ('status' in validation) {
    return recordInvalid(
      current,
      context.content,
      command,
      validation.reason,
      preEvents,
      prePublicEvents,
    );
  }

  assertCountersCanAdvance(current, true);
  const result = {
    status: 'applied',
    commandId: command.commandId,
    revision: current.revision + 1,
    turn: current.turn + 1,
  } as const;
  const world =
    validation.type === 'rest'
      ? resolveRest({
          state: current,
          content: context.content,
          eventId: command.commandId,
          until: validation.until,
          maximumDuration: validation.maximumDuration,
        })
      : resolveWorldStep({
          state: current,
          content: context.content,
          action: validation,
          eventId: command.commandId,
        });
  // Curse triggers resolve inside this same transition, as a pure post-pass over the events the
  // command just emitted, and BEFORE the conclusion boundary below -- a curse that lands the killing
  // blow must conclude the run here rather than leaving a dead hero in an unconcluded state.
  // `applyCurseTriggers` self-guards an already-concluded run and an already-dead hero, which is the
  // spec's "concluded runs never trigger". The trade, dialogue, and house branches above are
  // deliberately untouched: none of them emits any of the three matching event types. The
  // on-floor-enter trigger does NOT ride this pass -- floor transitions bypass `resolveCommand`
  // entirely, so `floor-transition.ts` fires the same resolver from each of its own entry paths.
  const triggered = applyCurseTriggers({
    state: world.state,
    content: context.content,
    events: world.events,
    eventId: command.commandId,
  });
  const worldEvents =
    triggered.events.length === 0 ? world.events : [...world.events, ...triggered.events];
  const triggerPublicEvents =
    triggered.events.length === 0
      ? []
      : projectDomainEvents({
          state: triggered.state,
          content: context.content,
          heroId: triggered.state.hero.actorId,
          events: triggered.events,
        });
  // The hero's stored maxima are a cache of the derived stats, refreshed here -- after the world
  // step and the curse post-pass have finished moving equipment, conditions and hunger, and BEFORE
  // the conclusion boundary below. Placing it here is what makes a +maxHealth item apply at all,
  // and it is what keeps a DROPPING maximum (an expiring condition, a removed ring) from leaving
  // the recorded state with `health > maxHealth`, which the save schema rejects. It also means the
  // conclusion sees exactly the numbers the player will.
  const synchronized = synchronizeDerivedMaxima(triggered.state, context.content);
  // The conclusion boundary runs inside this same transition: a hero killed by the world branch
  // above is concluded here, before the command is recorded, so the recorded event stream and the
  // resulting state agree on whether (and how) the run ended.
  const concluded = concludeRunOnHeroDeath({
    state: synchronized,
    content: context.content,
    events: worldEvents,
    revision: result.revision,
    turn: result.turn,
    eventId: command.commandId,
  });
  // The Final Chamber conclusions resolve in this same transition, right after the hero-death
  // boundary above (a living hero taking these paths never collides with it). Two shapes: the
  // instant `become-heart`/`broke-cycle` choices conclude the moment they are made; the refused
  // branch instead concludes `refused` on whatever later step defeats the weakened Heart -- keyed
  // off the dead boss, not the command type, since the killing blow is an ordinary attack. Both are
  // guarded against an already-concluded run (a hero killed by the boss concluded `became-heart`
  // above, so the refused check does not fire).
  const chamberChoice =
    validation.type === 'final-chamber-choice' && validation.choice !== 'turn-away'
      ? concludeRunOnChoice({
          state: concluded.state,
          completionType: validation.choice === 'become-heart' ? 'became-heart' : 'broke-cycle',
          turn: result.turn,
          eventId: command.commandId,
        })
      : concluded.state.conclusion === null && isHeartBossDefeated(concluded.state)
        ? concludeRunOnChoice({
            state: concluded.state,
            completionType: 'refused',
            turn: result.turn,
            eventId: command.commandId,
          })
        : null;
  const concludedState = chamberChoice?.state ?? concluded.state;
  const concludedEvents = chamberChoice
    ? [...concluded.events, ...chamberChoice.events]
    : concluded.events;
  const conclusionEvents = concludedEvents.slice(worldEvents.length);
  const conclusionPublicEvents =
    conclusionEvents.length === 0
      ? []
      : projectDomainEvents({
          state: concludedState,
          content: context.content,
          heroId: concludedState.hero.actorId,
          events: conclusionEvents,
        });
  const worldPublicEvents = [
    ...world.publicEvents,
    ...triggerPublicEvents,
    ...conclusionPublicEvents,
  ];
  const events = preEvents.length === 0 ? concludedEvents : [...preEvents, ...concludedEvents];
  const publicEvents =
    prePublicEvents.length === 0 ? worldPublicEvents : [...prePublicEvents, ...worldPublicEvents];
  return {
    state: record(concludedState, context.content, command, result, events, publicEvents),
    result,
    events: publicEvents,
  };
}
