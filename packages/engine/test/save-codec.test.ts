import { describe, expect, it } from 'vitest';
import { createDemoRun, decodeActiveRun, encodeActiveRun, resolveCommand, SaveLoadError } from '../src/index.js';

describe('active-run save codec', () => {
  function expectInvalidSave(state: ReturnType<typeof createDemoRun>, path: string): void {
    try {
      encodeActiveRun(state);
      throw new Error('expected save validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(SaveLoadError);
      expect((error as SaveLoadError).path).toBe(path);
      expect((error as Error).message).not.toContain(JSON.stringify(state));
    }
  }

  it('round-trips current state to identical stable bytes', () => {
    const state = createDemoRun();
    const encoded = encodeActiveRun(state);
    expect(encodeActiveRun(decodeActiveRun(encoded))).toBe(encoded);
    expect(encoded.startsWith('{"activeFloorId"')).toBe(true);
  });

  it.each([
    ['contentHash', 'bad'],
    ['activeFloorId', 'floor.missing'],
    ['hero.x', 99],
    ['floors.0.tiles', [1]],
    ['floors.0.tiles.8', 9],
    ['rng.combat', [0, 0, 0, 0]],
  ] as const)('rejects corrupt %s with a safe path', (path, replacement) => {
    const input = structuredClone(createDemoRun()) as Record<string, unknown>;
    const segments = path.split('.');
    let target: Record<string, unknown> | unknown[] = input;
    for (const segment of segments.slice(0, -1)) target = target[Number.isNaN(Number(segment)) ? segment : Number(segment)] as typeof target;
    target[Number.isNaN(Number(segments.at(-1))) ? segments.at(-1)! : Number(segments.at(-1))] = replacement;
    expect(() => decodeActiveRun(JSON.stringify(input))).toThrow(SaveLoadError);
    try { decodeActiveRun(JSON.stringify(input)); } catch (error) {
      expect((error as SaveLoadError).path).toContain(path.split('.')[0]);
      expect((error as Error).message).not.toContain(JSON.stringify(input));
    }
  });

  it('rejects malformed JSON and unknown object keys', () => {
    expect(() => decodeActiveRun('{')).toThrow(/JSON/);
    expect(() => decodeActiveRun(JSON.stringify({ ...createDemoRun(), surprise: true }))).toThrow(/surprise/);
  });

  it('rejects duplicate floor, entity, and recent-command identifiers', () => {
    const state = createDemoRun();
    expect(() => encodeActiveRun({ ...state, floors: [...state.floors, state.floors[0]!] })).toThrow(/floorId/);
    const floor = state.floors[0]!;
    const entity = { entityId: 'entity.1', x: 2, y: 1 };
    expect(() => encodeActiveRun({ ...state, floors: [{ ...floor, entities: [entity, entity] }] })).toThrow(/entityId/);
    const processed = resolveCommand(state, { type: 'wait', commandId: 'command.saved', expectedRevision: 0 }).state;
    const record = processed.recentCommands[0]!;
    expect(() => encodeActiveRun({ ...processed, recentCommands: [record, record] })).toThrow(/command identifier/);
  });

  it('rejects remaining semantic and numeric corruption boundaries', () => {
    const state = createDemoRun();
    expect(() => encodeActiveRun({ ...state, hero: { ...state.hero, x: 0, y: 0 } })).toThrow(/walkable/);
    expect(() => encodeActiveRun({ ...state, hero: { ...state.hero, name: 'e\u0301' } })).toThrow(/hero.name|Invalid save/);
    expect(() => encodeActiveRun({ ...state, hero: { ...state.hero, name: 'Ada\u0000' } })).toThrow(/hero.name|Invalid save/);
    expect(() => encodeActiveRun({ ...state, rng: { ...state.rng, combat: [0x1_0000_0000, 1, 2, 3] } })).toThrow(/rng.combat/);

    const first = resolveCommand(state, { type: 'wait', commandId: 'command.first', expectedRevision: 0 }).state;
    const second = resolveCommand(first, { type: 'wait', commandId: 'command.second', expectedRevision: 1 }).state;
    const [firstRecord, secondRecord] = second.recentCommands;
    expect(() => encodeActiveRun({ ...second, recentCommands: [secondRecord!, firstRecord!] })).toThrow(/monotonic/);
    expect(() => encodeActiveRun({
      ...first,
      recentCommands: [{
        ...first.recentCommands[0]!,
        result: { ...first.recentCommands[0]!.result, commandId: 'command.different' },
      }],
    })).toThrow(/result does not match command/);
  });

  it('rejects floor snapshots that are not strictly ordered by floor identifier', () => {
    const state = createDemoRun();
    const floor = state.floors[0]!;
    expectInvalidSave({
      ...state,
      floors: [{ ...floor, floorId: 'floor.z' }, { ...floor, floorId: 'floor.a' }],
      activeFloorId: 'floor.z',
      hero: { ...state.hero, floorId: 'floor.z' },
    }, 'floors.1.floorId');
  });

  it('rejects a large expected-revision gap between adjacent recent records', () => {
    const invalid = resolveCommand(createDemoRun(), { type: 'move', commandId: 'command.wall', expectedRevision: 0, direction: 'north' }).state;
    const moved = resolveCommand(invalid, { type: 'move', commandId: 'command.move', expectedRevision: 0, direction: 'east' }).state;
    const second = moved.recentCommands[1]!;
    expectInvalidSave({
      ...moved,
      revision: 101,
      turn: 101,
      recentCommands: [moved.recentCommands[0]!, {
        ...second,
        command: { ...second.command, expectedRevision: 100 },
        result: { ...second.result, revision: 101, turn: 101 },
      }],
    }, 'recentCommands.1.command.expectedRevision');
  });

  it('rejects move coordinates that disagree with the command direction', () => {
    const moved = resolveCommand(createDemoRun(), { type: 'move', commandId: 'command.move', expectedRevision: 0, direction: 'east' }).state;
    const record = moved.recentCommands[0]!;
    expectInvalidSave({
      ...moved,
      hero: { ...moved.hero, x: 1, y: 2 },
      recentCommands: [{ ...record, events: [{ ...record.events[0]!, from: { x: 1, y: 1 }, to: { x: 1, y: 2 } }] }],
    }, 'recentCommands.0.events.0.to');
  });

  it('rejects a move event that teleports more than one cell', () => {
    const moved = resolveCommand(createDemoRun(), { type: 'move', commandId: 'command.move', expectedRevision: 0, direction: 'east' }).state;
    const record = moved.recentCommands[0]!;
    expectInvalidSave({
      ...moved,
      hero: { ...moved.hero, x: 3, y: 1 },
      recentCommands: [{ ...record, events: [{ ...record.events[0]!, to: { x: 3, y: 1 } }] }],
    }, 'recentCommands.0.events.0.to');
  });

  it('rejects a broken position chain between adjacent processed commands', () => {
    const first = resolveCommand(createDemoRun(), { type: 'move', commandId: 'command.first', expectedRevision: 0, direction: 'east' }).state;
    const second = resolveCommand(first, { type: 'move', commandId: 'command.second', expectedRevision: 1, direction: 'east' }).state;
    const finalRecord = second.recentCommands[1]!;
    expectInvalidSave({
      ...second,
      hero: { ...second.hero, x: 2 },
      recentCommands: [second.recentCommands[0]!, {
        ...finalRecord,
        events: [{ ...finalRecord.events[0]!, from: { x: 1, y: 1 }, to: { x: 2, y: 1 } }],
      }],
    }, 'recentCommands.0.events.0.to');
  });

  it('rejects retained history that does not terminate at the current counters or hero', () => {
    const waited = resolveCommand(createDemoRun(), { type: 'wait', commandId: 'command.wait', expectedRevision: 0 }).state;
    expectInvalidSave({ ...waited, revision: 2, turn: 2 }, 'recentCommands.0.result.revision');
    expectInvalidSave({ ...waited, hero: { ...waited.hero, x: 2 } }, 'recentCommands.0.events.0');
  });

  it('rejects an invalid wait record', () => {
    const invalid = resolveCommand(createDemoRun(), { type: 'move', commandId: 'command.wall', expectedRevision: 0, direction: 'north' }).state;
    const record = invalid.recentCommands[0]!;
    expectInvalidSave({
      ...invalid,
      recentCommands: [{ ...record, command: { type: 'wait', commandId: record.command.commandId, expectedRevision: 0 } }],
    }, 'recentCommands.0.command.type');
  });

  it('rejects an invalid movement reason that disagrees with the active floor', () => {
    const invalid = resolveCommand(createDemoRun(), { type: 'move', commandId: 'command.wall', expectedRevision: 0, direction: 'north' }).state;
    const record = invalid.recentCommands[0]!;
    expectInvalidSave({
      ...invalid,
      recentCommands: [{
        ...record,
        result: { ...record.result, reason: 'blocked.bounds' },
        events: [{ ...record.events[0]!, reason: 'blocked.bounds' }],
      }],
    }, 'recentCommands.0.result.reason');
  });

  it('accepts a reachable retained suffix after older records are evicted', () => {
    let state = createDemoRun();
    for (let index = 0; index < 129; index += 1) {
      state = resolveCommand(state, { type: 'wait', commandId: `command.${index}`, expectedRevision: index }).state;
    }
    expect(state.recentCommands[0]?.command.expectedRevision).toBe(1);
    expect(() => encodeActiveRun(state)).not.toThrow();
  });
});
