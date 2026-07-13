import type { ActiveRun, CommandResult, DomainEvent, GameCommand } from './model.js';
import { resolveCommand } from './reducer.js';

export interface ReplayStep {
  readonly command: GameCommand;
  readonly result: CommandResult;
  readonly events: readonly DomainEvent[];
}

export interface ReplayResult {
  readonly state: ActiveRun;
  readonly steps: readonly ReplayStep[];
}

export function replayCommands(
  initial: ActiveRun,
  commands: readonly GameCommand[],
): ReplayResult {
  let state = initial;
  const steps: ReplayStep[] = [];

  for (const command of commands) {
    const resolution = resolveCommand(state, command);
    state = resolution.state;
    steps.push({ command, result: resolution.result, events: resolution.events });
  }

  return { state, steps };
}
