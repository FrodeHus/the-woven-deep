import { describe, expect, it } from 'vitest';
import {
  createDemoRun, createUnknownKnowledge, decodeActiveRun, encodeActiveRun,
  refreshKnowledge, resolveCommand, SaveLoadError,
} from '../src/index.js';

describe('active-run save codec', () => {
  function richRun(): ReturnType<typeof createDemoRun> {
    const base = createDemoRun();
    const tiles = [
      0, 0, 0, 0, 0,
      0, 4, 1, 2, 0,
      0, 1, 3, 1, 0,
      0, 1, 5, 1, 0,
      0, 0, 0, 0, 0,
    ] as const;
    const hero = { ...base.hero, floorId: 'floor.rich', x: 1, y: 2, sightRadius: 12 };
    const floor = {
      ...base.floors[0]!, floorId: 'floor.rich', width: 5, height: 5, tiles,
      themeId: 'theme.rich', ambient: { color: [255, 240, 224] as const, strength: 64 },
      knowledge: createUnknownKnowledge(25),
      lights: [
        { lightId: 'light.a', location: { type: 'fixed' as const, x: 2, y: 1 }, color: [255, 128, 64] as const, radius: 4, strength: 200, enabled: true, falloff: 'linear' as const, vaultPlacementId: 'placement.a', presentation: { glyph: '*', token: 'fixture.torch' } },
        { lightId: 'light.b', location: { type: 'actor' as const, actorId: hero.heroId }, color: [64, 128, 255] as const, radius: 3, strength: 100, enabled: true, falloff: 'linear' as const, vaultPlacementId: null, presentation: null },
      ],
      stairUp: { x: 1, y: 1 }, stairDown: { x: 2, y: 3 },
      vaults: [{ placementId: 'placement.a', vaultId: 'vault.a', x: 1, y: 1, width: 2, height: 2, rotation: 90 as const, reflected: true, entrances: [{ x: 1, y: 2 }] }],
      placementSlots: [{ slotId: 'slot.a', vaultPlacementId: 'placement.a', kind: 'fixture' as const, required: true, tags: ['lit'], x: 2, y: 1 }],
      entities: [{ entityId: 'entity.a', x: 3, y: 2 }],
    };
    const knowledge = refreshKnowledge({ floor, hero, actors: new Map([[hero.heroId, hero], ['entity.a', floor.entities[0]!]]) }).knowledge;
    return { ...base, hero, activeFloorId: floor.floorId, floors: [{ ...floor, knowledge }] } as ReturnType<typeof createDemoRun>;
  }

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

  it('round-trips all schema v2 source state without storing derived fields', () => {
    const state = richRun();
    const encoded = encodeActiveRun(state);
    expect(decodeActiveRun(encoded)).toEqual(state);
    expect(encoded).not.toMatch(/visibilityWords|illumination|projection|generationReport/);
  });

  it.each([
    ['tile outside 0-6', (run: any) => { run.floors[0].tiles[6] = 7; }],
    ['knowledge word length', (run: any) => { run.floors[0].knowledge.exploredWords = []; }],
    ['knowledge padding', (run: any) => { run.floors[0].knowledge.exploredWords[0] = 0xffff_ffff; }],
    ['knowledge disagreement', (run: any) => { run.floors[0].knowledge.rememberedTerrainWords[0] = 0xffff_ffff; }],
    ['ambient color', (run: any) => { run.floors[0].ambient.color[0] = 256; }],
    ['ambient strength', (run: any) => { run.floors[0].ambient.strength = -1; }],
    ['invalid light identifier', (run: any) => { run.floors[0].lights[0].lightId = 'Bad'; }],
    ['duplicate light identifier', (run: any) => { run.floors[0].lights[1].lightId = 'light.a'; }],
    ['unordered light identifiers', (run: any) => { run.floors[0].lights.reverse(); }],
    ['malformed presentation', (run: any) => { run.floors[0].lights[0].presentation.glyph = '**'; }],
    ['missing vault ownership', (run: any) => { run.floors[0].lights[0].vaultPlacementId = 'placement.missing'; }],
    ['unresolved actor', (run: any) => { run.floors[0].lights[1].location.actorId = 'actor.missing'; }],
    ['fixed light on void', (run: any) => { run.floors[0].tiles[7] = 6; }],
    ['fixed light out of bounds', (run: any) => { run.floors[0].lights[0].location.x = 99; }],
    ['vault-owned light outside placement', (run: any) => { run.floors[0].lights[0].location.x = 3; }],
    ['negative hero sight radius', (run: any) => { run.hero.sightRadius = -1; }],
    ['unsafe hero sight radius', (run: any) => { run.hero.sightRadius = Number.MAX_SAFE_INTEGER + 1; }],
    ['stair tile mismatch', (run: any) => { run.floors[0].stairUp = { x: 2, y: 1 }; }],
    ['duplicate stair positions', (run: any) => { run.floors[0].stairDown = { x: 1, y: 1 }; }],
    ['unreferenced stair-up tile', (run: any) => { run.floors[0].stairUp = null; }],
    ['unreferenced stair-down tile', (run: any) => { run.floors[0].stairDown = null; }],
    ['additional stair-up tile', (run: any) => { run.floors[0].tiles[8] = 4; }],
    ['additional stair-down tile', (run: any) => { run.floors[0].tiles[16] = 5; }],
    ['duplicate vault identifier', (run: any) => { run.floors[0].vaults.push({ ...run.floors[0].vaults[0] }); }],
    ['unordered vault identifiers', (run: any) => { run.floors[0].vaults.unshift({ ...run.floors[0].vaults[0], placementId: 'placement.z', vaultId: 'vault.z', x: 3, y: 1, width: 1, height: 1, entrances: [] }); }],
    ['duplicate slot identifier', (run: any) => { run.floors[0].placementSlots.push({ ...run.floors[0].placementSlots[0] }); }],
    ['unordered slot identifiers', (run: any) => { run.floors[0].placementSlots.unshift({ ...run.floors[0].placementSlots[0], slotId: 'slot.z' }); }],
    ['overlapping vaults', (run: any) => { run.floors[0].vaults.push({ ...run.floors[0].vaults[0], placementId: 'placement.b', vaultId: 'vault.b' }); }],
    ['out-of-bounds vault', (run: any) => { run.floors[0].vaults[0].width = 9; }],
    ['unowned slot', (run: any) => { run.floors[0].placementSlots[0].vaultPlacementId = 'placement.missing'; }],
  ])('rejects v2 corruption: %s', (_label, corrupt) => {
    const input = structuredClone(richRun()) as any;
    corrupt(input);
    expect(() => encodeActiveRun(input)).toThrow(SaveLoadError);
  });

  it('rejects sparse saved arrays and unordered entity identifiers', () => {
    const sparse = structuredClone(richRun()) as any;
    delete sparse.floors[0].tiles[1];
    expect(() => encodeActiveRun(sparse)).toThrow(SaveLoadError);

    const unordered = structuredClone(richRun()) as any;
    unordered.floors[0].entities = [
      { entityId: 'entity.z', x: 3, y: 1 },
      { entityId: 'entity.a', x: 3, y: 2 },
    ];
    expect(() => encodeActiveRun(unordered)).toThrow(SaveLoadError);
  });

  it.each(['visibilityWords', 'illumination', 'projection', 'generationReport'])('rejects derived floor field %s', (field) => {
    const input = structuredClone(richRun()) as any;
    input.floors[0][field] = [];
    expect(() => encodeActiveRun(input)).toThrow(SaveLoadError);
  });

  it('rejects colliding presented fixed fixtures', () => {
    const input = structuredClone(richRun()) as any;
    input.floors[0].lights.splice(1, 0, { ...input.floors[0].lights[0], lightId: 'light.aa' });
    expect(() => encodeActiveRun(input)).toThrow(SaveLoadError);
  });

  it('accepts a presented fixed fixture without vault ownership', () => {
    const input = structuredClone(richRun()) as any;
    input.floors[0].lights[0].vaultPlacementId = null;
    expect(() => encodeActiveRun(input)).not.toThrow();
  });

  it.each(['light', 'vault placement', 'slot'])('rejects a duplicate %s identifier across floors', (kind) => {
    const input = structuredClone(richRun()) as any;
    const first = input.floors[0];
    const second = {
      ...structuredClone(first), floorId: 'floor.z', entities: [], lights: [], vaults: [], placementSlots: [],
    };
    if (kind === 'light') {
      second.vaults = [{ ...first.vaults[0], placementId: 'placement.z', vaultId: 'vault.z' }];
      second.lights = [{ ...first.lights[0], vaultPlacementId: 'placement.z' }];
    } else if (kind === 'vault placement') {
      second.vaults = [structuredClone(first.vaults[0])];
    } else {
      second.vaults = [{ ...first.vaults[0], placementId: 'placement.z', vaultId: 'vault.z' }];
      second.placementSlots = [{ ...first.placementSlots[0], vaultPlacementId: 'placement.z' }];
    }
    input.floors.push(second);
    expect(() => encodeActiveRun(input)).toThrow(SaveLoadError);
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

  it.each([
    [0, 'blocked.wall'],
    [2, 'blocked.door'],
    [3, 'blocked.pillar'],
    [6, 'blocked.void'],
  ] as const)('validates retained terrain %i as %s', (tile, reason) => {
    const demo = createDemoRun();
    const floor = demo.floors[0]!;
    const initial = { ...demo, floors: [{
      ...floor,
      tiles: floor.tiles.map((current, index) => index === 1 ? tile : current),
    }] };
    const invalid = resolveCommand(initial, {
      type: 'move', commandId: `command.${reason}`, expectedRevision: 0, direction: 'north',
    }).state;
    const record = invalid.recentCommands[0]!;

    expect(record.result).toMatchObject({ status: 'invalid', reason });
    expect(() => encodeActiveRun(invalid)).not.toThrow();
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
