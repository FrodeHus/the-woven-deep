import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createGameplayDemoRun,
  decodeActiveRun,
  encodeActiveRun,
  projectGameplayState,
  resolveCommand,
  stableJson,
  type ActiveRun,
  type GameCommand,
} from '../src/index.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

type CommandFactory = (
  state: ActiveRun,
  index: number,
) => Omit<GameCommand, 'commandId' | 'expectedRevision'>;

function directionTo(
  from: Readonly<{ x: number; y: number }>,
  to: Readonly<{ x: number; y: number }>,
) {
  const key = `${Math.sign(to.x - from.x)}:${Math.sign(to.y - from.y)}`;
  const directions = {
    '0:-1': 'north',
    '1:-1': 'northeast',
    '1:0': 'east',
    '1:1': 'southeast',
    '0:1': 'south',
    '-1:1': 'southwest',
    '-1:0': 'west',
    '-1:-1': 'northwest',
  } as const;
  return directions[key as keyof typeof directions];
}

function materializeScenario(
  initial: ActiveRun,
  ids: ReturnType<typeof createGameplayDemoRun>['ids'],
): readonly GameCommand[] {
  // Since the #212 tuning, neither wired monster dies to a single blow, so the rat kill and the
  // beetle shoot are bounded LOOPS (a `repeatUntil` per step) instead of one scripted command each.
  // The materialized command list is still fully deterministic -- each loop's length is fixed by
  // the seed -- and `execute` below replays the exact same list.
  const steps: readonly Readonly<{
    factory: CommandFactory;
    repeatUntil?: (state: ActiveRun) => boolean;
  }>[] = [
    { factory: () => ({ type: 'open-door', featureId: ids.door }) },
    {
      factory: (state) => {
        const hero = state.actors.find((actor) => actor.actorId === ids.hero)!;
        const door = state.features.find((feature) => feature.featureId === ids.door)!;
        return { type: 'move', direction: directionTo(hero, door) };
      },
    },
    { factory: () => ({ type: 'search' }) },
    { factory: () => ({ type: 'disarm', featureId: ids.trap }) },
    { factory: () => ({ type: 'equip', itemId: ids.armor, slot: 'body' }) },
    {
      factory: () => ({ type: 'attack', targetActorId: ids.rat }),
      repeatUntil: (state) =>
        state.actors.find((actor) => actor.actorId === ids.rat)!.health === 0,
    },
    { factory: () => ({ type: 'equip', itemId: ids.bow, slot: 'main-hand' }) },
    {
      factory: (state) => {
        const beetle = state.actors.find((actor) => actor.actorId === ids.beetle)!;
        return { type: 'fire', itemId: ids.bow, target: { x: beetle.x, y: beetle.y } };
      },
      repeatUntil: (state) =>
        state.actors.find((actor) => actor.actorId === ids.beetle)!.health === 0,
    },
    { factory: () => ({ type: 'equip', itemId: ids.sword, slot: 'main-hand' }) },
    { factory: () => ({ type: 'equip', itemId: ids.lantern, slot: 'off-hand' }) },
    { factory: () => ({ type: 'use-item', itemId: ids.crimsonPotion, target: null }) },
    { factory: () => ({ type: 'rest', until: 'interrupted', maximumDuration: 12 }) },
  ];
  let state = initial;
  const commands: GameCommand[] = [];
  for (const step of steps) {
    for (let iteration = 0; iteration < 24; iteration += 1) {
      const command = {
        ...step.factory(state, commands.length),
        commandId: `command.gameplay-${String(commands.length + 1).padStart(2, '0')}`,
        expectedRevision: state.revision,
      } as GameCommand;
      const resolution = resolveCommand(state, command, { content: pack });
      expect(resolution.result.status, stableJson({ command, events: resolution.events })).toBe(
        'applied',
      );
      commands.push(command);
      state = resolution.state;
      if (step.repeatUntil === undefined || step.repeatUntil(state)) break;
    }
    if (step.repeatUntil !== undefined) expect(step.repeatUntil(state)).toBe(true);
  }
  return commands;
}

function execute(
  initial: ActiveRun,
  commands: readonly GameCommand[],
  reloadAfter: ReadonlySet<number>,
) {
  let state = initial;
  const records: unknown[] = [];
  for (const [index, command] of commands.entries()) {
    const resolution = resolveCommand(state, command, { content: pack });
    state = resolution.state;
    const recorded = state.recentCommands.find(
      (entry) => entry.command.commandId === command.commandId,
    );
    records.push({
      command,
      result: resolution.result,
      authoritativeEvents: recorded?.events ?? [],
      publicEvents: resolution.events,
      projection: projectGameplayState({ state, content: pack }),
    });
    if (reloadAfter.has(index + 1)) state = decodeActiveRun(encodeActiveRun(state));
  }
  return { state, records };
}

describe('core gameplay replay', () => {
  it('is byte-identical across three save boundaries', () => {
    const fixture = createGameplayDemoRun(pack);
    const commands = materializeScenario(fixture.run, fixture.ids);
    const continuous = execute(fixture.run, commands, new Set());
    const split = execute(fixture.run, commands, new Set([2, 5, 8]));

    expect(encodeActiveRun(split.state)).toBe(encodeActiveRun(continuous.state));
    expect(stableJson(split.records)).toBe(stableJson(continuous.records));
    expect(continuous.records).toHaveLength(commands.length);
    const eventTypes = continuous.state.recentCommands.flatMap((record) =>
      record.events.map((event) => event.type),
    );
    expect(eventTypes).toEqual(
      expect.arrayContaining([
        'door.opened',
        'reaction.triggered',
        'attack.hit',
        'item.equipped',
        'identification.appearance-revealed',
        'feature.revealed',
        'rest.completed',
      ]),
    );
    expect(
      eventTypes.some(
        (type) =>
          type === 'trap.disarmed' || type === 'trap.triggered' || type === 'trap.disarm-failed',
      ),
    ).toBe(true);
    expect(
      continuous.state.features.find((feature) => feature.featureId === fixture.ids.secret),
    ).toMatchObject({ type: 'secret', state: 'revealed' });
  });
});
