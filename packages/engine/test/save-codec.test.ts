import { describe, expect, it } from 'vitest';
import { createDemoRun, decodeActiveRun, encodeActiveRun, resolveCommand, SaveLoadError } from '../src/index.js';

describe('active-run save codec', () => {
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
});
