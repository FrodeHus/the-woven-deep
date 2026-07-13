import { describe, expect, it } from 'vitest';
import { createDemoRun, resolveCommand, type GameCommand } from '../src/index.js';

const move = (commandId: string, expectedRevision: number, direction: 'north' | 'south' | 'east' | 'west'): GameCommand => ({
  type: 'move', commandId, expectedRevision, direction,
});

describe('resolveCommand', () => {
  it('moves without mutating input and advances turn/revision', () => {
    const initial = createDemoRun();
    const resolution = resolveCommand(initial, move('command.1', 0, 'east'));
    expect(resolution.result).toMatchObject({ status: 'applied', revision: 1, turn: 1 });
    expect(resolution.state.hero).toMatchObject({ x: 2, y: 1 });
    expect(resolution.events).toEqual([{ type: 'hero.moved', eventId: 'command.1', heroId: 'hero.demo', from: { x: 1, y: 1 }, to: { x: 2, y: 1 } }]);
    expect(initial.hero).toMatchObject({ x: 1, y: 1 });
    expect(initial.recentCommands).toHaveLength(0);
  });

  it('records wall collisions without advancing time', () => {
    const initial = createDemoRun();
    const resolution = resolveCommand(initial, move('command.wall', 0, 'north'));
    expect(resolution.result).toMatchObject({ status: 'invalid', reason: 'blocked.wall', revision: 0, turn: 0 });
    expect(resolution.state.hero).toEqual(initial.hero);
    expect(resolution.state.recentCommands).toHaveLength(1);
  });

  it('rejects bounds and stale revisions without advancing', () => {
    const demo = createDemoRun();
    const floor = demo.floors[0]!;
    const initial = {
      ...demo,
      hero: { ...demo.hero, x: 0, y: 0 },
      floors: [{ ...floor, tiles: floor.tiles.map((tile, index) => index === 0 ? 1 : tile) }],
    };
    expect(resolveCommand(initial, move('command.bounds', 0, 'west')).result).toMatchObject({ status: 'invalid', reason: 'blocked.bounds' });
    expect(resolveCommand(createDemoRun(), move('command.stale', 9, 'east')).result).toMatchObject({ status: 'rejected', reason: 'stale_revision' });
  });

  it('applies wait without changing position', () => {
    const initial = createDemoRun();
    const resolution = resolveCommand(initial, { type: 'wait', commandId: 'command.wait', expectedRevision: 0 });
    expect(resolution.state.hero).toEqual(initial.hero);
    expect(resolution.result).toMatchObject({ status: 'applied', revision: 1, turn: 1 });
    expect(resolution.events[0]?.type).toBe('hero.waited');
  });

  it('replays identical IDs and rejects conflicting reuse', () => {
    const command = move('command.repeat', 0, 'east');
    const first = resolveCommand(createDemoRun(), command);
    const duplicate = resolveCommand(first.state, command);
    expect(duplicate.state).toBe(first.state);
    expect(duplicate.result).toEqual(first.result);
    expect(duplicate.events).toEqual(first.events);
    const conflict = resolveCommand(first.state, { ...command, direction: 'south' });
    expect(conflict.result).toMatchObject({ status: 'rejected', reason: 'command_id_conflict' });
  });

  it('evicts only the oldest processed result after 128 records', () => {
    let state = createDemoRun();
    for (let index = 0; index < 129; index += 1) {
      state = resolveCommand(state, { type: 'wait', commandId: `command.${index}`, expectedRevision: index }).state;
    }
    expect(state.recentCommands).toHaveLength(128);
    expect(state.recentCommands[0]?.command.commandId).toBe('command.1');
    expect(state.recentCommands.at(-1)?.command.commandId).toBe('command.128');
  });
});
