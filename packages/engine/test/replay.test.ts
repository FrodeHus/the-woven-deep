import { describe, expect, it } from 'vitest';
import {
  createDemoRun,
  decodeActiveRun,
  encodeActiveRun,
  replayCommands,
  resolveCommand,
  stableJson,
  type ActiveRun,
  type Direction,
  type GameCommand,
  type ReplayStep,
} from '../src/index.js';

const commands: readonly GameCommand[] = [
  { type: 'move', commandId: 'command.1', expectedRevision: 0, direction: 'east' },
  { type: 'move', commandId: 'command.2', expectedRevision: 1, direction: 'east' },
  { type: 'move', commandId: 'command.3', expectedRevision: 2, direction: 'south' },
  { type: 'wait', commandId: 'command.4', expectedRevision: 2 },
  { type: 'move', commandId: 'command.5', expectedRevision: 3, direction: 'west' },
  { type: 'wait', commandId: 'command.4', expectedRevision: 2 },
  { type: 'move', commandId: 'command.6', expectedRevision: 0, direction: 'east' },
];

function expectEquivalentReplay(
  continuous: Readonly<{ state: ActiveRun; steps: readonly ReplayStep[] }>,
  splitState: ActiveRun,
  splitSteps: readonly ReplayStep[],
): void {
  expect(encodeActiveRun(splitState)).toBe(encodeActiveRun(continuous.state));
  expect(stableJson(splitSteps)).toBe(stableJson(continuous.steps));
}

describe('replayCommands', () => {
  it('produces identical state and steps across an encode/decode boundary', () => {
    const initial = createDemoRun();
    const continuous = replayCommands(initial, commands);
    const before = replayCommands(initial, commands.slice(0, 4));
    const restored = decodeActiveRun(encodeActiveRun(before.state));
    const after = replayCommands(restored, commands.slice(4));

    expectEquivalentReplay(continuous, after.state, [...before.steps, ...after.steps]);
  });

  it('does not mutate its initial state or command sequence', () => {
    const initial = createDemoRun();
    const initialClone = structuredClone(initial);
    const commandClone = structuredClone(commands);

    replayCommands(initial, commands);

    expect(initial).toEqual(initialClone);
    expect(commands).toEqual(commandClone);
  });

  it('preserves deterministic results across save boundaries for generated movement sequences', () => {
    const directions = ['north', 'east', 'south', 'west'] as const satisfies readonly Direction[];

    for (let seed = 0; seed < 100; seed += 1) {
      const initial = createDemoRun();
      let evolving = initial;
      const generated: GameCommand[] = [];

      for (let index = 0; index < 24; index += 1) {
        const command: GameCommand = {
          type: 'move',
          commandId: `command.${seed}.${index}`,
          expectedRevision: evolving.revision,
          direction: directions[(seed * 17 + index * 31) % directions.length]!,
        };
        generated.push(command);
        evolving = resolveCommand(evolving, command).state;
      }

      const continuous = replayCommands(initial, generated);
      const before = replayCommands(initial, generated.slice(0, 12));
      const restored = decodeActiveRun(encodeActiveRun(before.state));
      const after = replayCommands(restored, generated.slice(12));

      expectEquivalentReplay(continuous, after.state, [...before.steps, ...after.steps]);
    }
  });
});
