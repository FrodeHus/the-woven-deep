import { describe, expect, it } from 'vitest';
import {
  createDemoRun,
  createDemoContentPack,
  createUnknownKnowledge,
  heroActor,
  heroPerception,
  isExplored,
  refreshKnowledge,
  resolveCommand as resolveCommandWithContext,
  stableJson,
  type GameCommand,
  type LightSource,
  type TileId,
} from '../src/index.js';

const context = { content: createDemoContentPack() };
const resolveCommand = (
  state: Parameters<typeof resolveCommandWithContext>[0],
  command: Parameters<typeof resolveCommandWithContext>[1],
) => resolveCommandWithContext(state, command, context);

const move = (commandId: string, expectedRevision: number, direction: 'north' | 'south' | 'east' | 'west'): GameCommand => ({
  type: 'move', commandId, expectedRevision, direction,
});

describe('resolveCommand', () => {
  it('moves without mutating input and advances turn/revision', () => {
    const initial = createDemoRun();
    const resolution = resolveCommand(initial, move('command.1', 0, 'east'));
    expect(resolution.result).toMatchObject({ status: 'applied', revision: 1, turn: 1 });
    expect(heroActor(resolution.state)).toMatchObject({ x: 2, y: 1 });
    expect(resolution.events).toEqual([{ type: 'hero.moved', eventId: 'command.1', heroId: 'hero.demo', from: { x: 1, y: 1 }, to: { x: 2, y: 1 } }]);
    expect(heroActor(initial)).toMatchObject({ x: 1, y: 1 });
    expect(initial.recentCommands).toHaveLength(0);
  });

  it.each([
    [0, 'blocked.wall'],
    [2, 'blocked.door'],
    [3, 'blocked.pillar'],
    [6, 'blocked.void'],
  ] as const)('records terrain %i as %s without changing the run counters or world', (tile, reason) => {
    const demo = createDemoRun();
    const floor = demo.floors[0]!;
    const initial = {
      ...demo,
      floors: [{ ...floor, tiles: floor.tiles.map((current, index) => index === 9 ? tile : current) }],
    };
    const resolution = resolveCommand(initial, move(`command.${reason}`, 0, 'east'));

    expect(resolution.result).toEqual({ status: 'invalid', commandId: `command.${reason}`, reason, revision: 0, turn: 0 });
    expect(resolution.state.hero).toEqual(initial.hero);
    expect(resolution.state.floors).toEqual(initial.floors);
    expect(resolution.state.floors[0]?.knowledge).toBe(initial.floors[0]?.knowledge);
    expect(resolution.state).toMatchObject({ revision: 0, turn: 0 });
    expect(resolution.state.recentCommands).toHaveLength(1);
  });

  it.each([
    [1, 'floor'],
    [4, 'stair-up'],
    [5, 'stair-down'],
  ] as const)('walks onto terrain %i (%s) without changing floors', (tile, _name) => {
    const demo = createDemoRun();
    const floor = demo.floors[0]!;
    const initial = {
      ...demo,
      floors: [{ ...floor, tiles: floor.tiles.map((current, index) => index === 9 ? tile : current) }],
    };
    const resolution = resolveCommand(initial, move(`command.walk.${tile}`, 0, 'east'));

    expect(resolution.result).toMatchObject({ status: 'applied', revision: 1, turn: 1 });
    expect(heroActor(resolution.state)).toMatchObject({ floorId: floor.floorId, x: 2, y: 1 });
    expect(resolution.state.activeFloorId).toBe(floor.floorId);
  });

  it('rejects bounds and stale revisions without advancing', () => {
    const demo = createDemoRun();
    const floor = demo.floors[0]!;
    const initial = {
      ...demo,
      actors: [{ ...demo.actors[0]!, x: 0, y: 0 }],
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

  it('refreshes only applied movement knowledge with the moved carried light', () => {
    const width = 9;
    const tiles = Array.from({ length: width }, () => 1 as TileId);
    const demo = createDemoRun();
    const hero = { ...demo.hero, actorId: 'hero.corridor', sightRadius: 8 } as const;
    const actor = { ...demo.actors[0]!, actorId: hero.actorId, floorId: 'floor.corridor', x: 2, y: 0 };
    const perceivedHero = heroPerception(hero, actor);
    const carriedLight: LightSource = {
      lightId: 'light.carried', location: { type: 'actor', actorId: actor.actorId }, color: [255, 255, 255],
      radius: 2, strength: 255, enabled: true, falloff: 'linear', vaultPlacementId: null, presentation: null,
    };
    const entityLight: LightSource = {
      ...carriedLight, lightId: 'light.entity', location: { type: 'actor', actorId: 'entity.sentry' }, radius: 1,
    };
    const template = demo.floors[0]!;
    const corridor = {
      ...template,
      floorId: actor.floorId,
      width,
      height: 1,
      tiles,
      entities: [{ entityId: 'entity.sentry', x: 7, y: 0 }],
      ambient: { color: [255, 255, 255] as const, strength: 0 },
      knowledge: createUnknownKnowledge(width),
      lights: [carriedLight, entityLight],
      stairUp: null,
      stairDown: null,
    };
    const initialKnowledge = refreshKnowledge({
      floor: corridor,
      hero: perceivedHero,
      actors: new Map([[actor.actorId, actor], ['entity.sentry', corridor.entities[0]!]]),
    }).knowledge;
    const inactiveFloor = { ...template, floorId: 'floor.inactive' };
    const initial = {
      ...demo,
      hero,
      actors: [actor],
      activeFloorId: actor.floorId,
      floors: [{ ...corridor, knowledge: initialKnowledge }, inactiveFloor],
    };
    const before = stableJson(initial);
    const command = move('command.corridor', 0, 'east');

    const first = resolveCommand(initial, command);
    const activeKnowledge = first.state.floors[0]!.knowledge;

    expect(heroActor(first.state)).toMatchObject({ x: 3, y: 0 });
    expect(first.state.floors.map((floor) => floor.floorId)).toEqual(['floor.corridor', 'floor.inactive']);
    expect(first.state.floors[1]).toBe(inactiveFloor);
    expect(first.state.floors[0]!.lights[0]!.location).toEqual({ type: 'actor', actorId: actor.actorId });
    expect(isExplored(initialKnowledge, 5)).toBe(false);
    expect(isExplored(activeKnowledge, 5)).toBe(true);
    expect(isExplored(initialKnowledge, 0)).toBe(true);
    expect(isExplored(activeKnowledge, 0)).toBe(true);
    expect(stableJson(initial)).toBe(before);

    const duplicate = resolveCommand(first.state, command);
    expect(duplicate.state).toBe(first.state);
    expect(duplicate.result).toBe(first.result);
    expect(duplicate.events).toBe(first.events);

    const unchangedKnowledge = first.state.floors[0]!.knowledge;
    const stale = resolveCommand(first.state, move('command.stale.dark', 0, 'east'));
    const conflict = resolveCommand(first.state, { ...command, direction: 'west' });
    const invalid = resolveCommand(first.state, move('command.invalid.dark', 1, 'north'));
    const waited = resolveCommand(first.state, { type: 'wait', commandId: 'command.wait.dark', expectedRevision: 1 });

    expect(stale.state).toBe(first.state);
    expect(conflict.state).toBe(first.state);
    expect(stale.state.floors[0]!.knowledge).toBe(unchangedKnowledge);
    expect(conflict.state.floors[0]!.knowledge).toBe(unchangedKnowledge);
    expect(invalid.state.floors[0]!.knowledge).toBe(unchangedKnowledge);
    expect(waited.state.floors[0]!.knowledge).toStrictEqual(unchangedKnowledge);
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

  it.each([
    { type: 'wait', commandId: 'command.overflow.wait', expectedRevision: Number.MAX_SAFE_INTEGER } as const,
    move('command.overflow.move', Number.MAX_SAFE_INTEGER, 'east'),
  ])('throws an invariant error before an applied $type can overflow counters', (command) => {
    const initial = { ...createDemoRun(), revision: Number.MAX_SAFE_INTEGER, turn: Number.MAX_SAFE_INTEGER };
    const before = structuredClone(initial);
    expect(() => resolveCommand(initial, command)).toThrow(/invariant/i);
    expect(initial).toEqual(before);
  });
});
