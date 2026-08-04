import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createNewRun,
  descendToNextFloor,
  heroActor,
  projectGameplayState,
  projectRunConclusion,
  resolveCommand,
  DEFAULT_GUEST_HERO,
  type ActiveRun,
  type Direction,
  type ObservableCell,
  type Uint32State,
} from '@woven-deep/engine';
import { FloorWireDecoder, FloorWireEncoder, type WireRunSnapshot } from '../src/floor-wire.js';
import type { ServerRunSnapshot } from '../src/ws-protocol.js';

const SEED = [7, 14, 21, 28] as unknown as Uint32State;

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

/** The same shape `ServerPlaySession.snapshot()` builds, reduced to what the codec touches. */
function snapshotOf(run: ActiveRun): ServerRunSnapshot {
  return {
    projection: projectGameplayState({ state: run, content: pack }),
    lastEvents: [],
    revision: run.revision,
    pendingDecision: null,
    conclusion:
      run.conclusion === null
        ? null
        : projectRunConclusion({ run, record: null, achievements: [] }),
    houseOpen: false,
    heroClassTags: [...run.hero.classTags],
    bossActive: false,
    nextCommandSequence: 0,
  };
}

function onStairDown(run: ActiveRun): ActiveRun {
  const floor = run.floors.find((candidate) => candidate.floorId === run.activeFloorId)!;
  const hero = heroActor(run);
  return {
    ...run,
    actors: run.actors.map((actor) =>
      actor.actorId === hero.actorId
        ? { ...actor, x: floor.stairDown!.x, y: floor.stairDown!.y }
        : actor,
    ),
  };
}

function cellsOf(run: ActiveRun): readonly ObservableCell[] {
  return projectGameplayState({ state: run, content: pack }).floor.cells;
}

/** Never reset between `walk` calls: the reducer retains the last `RECENT_COMMAND_LIMIT` command
 * ids, so a counter restarting at 0 on each call would re-mint ids the run still remembers and
 * every move would be refused as a duplicate -- silently turning a walk into a no-op. */
let commandCounter = 0;

/** Walks the hero, skipping moves that resolve to nothing (a wall), so a test always gets the
 * number of REAL turns it asked for rather than however many the geometry happened to allow. */
function walk(run: ActiveRun, steps: number): ActiveRun {
  const directions: readonly Direction[] = ['east', 'east', 'south', 'south', 'west', 'north'];
  let current = run;
  let applied = 0;
  for (let attempt = 0; attempt < steps * 8 && applied < steps; attempt += 1) {
    commandCounter += 1;
    const resolution = resolveCommand(
      current,
      {
        type: 'move',
        direction: directions[attempt % directions.length]!,
        commandId: `command.walk-${commandCounter}`,
        expectedRevision: current.revision,
      },
      { content: pack },
    );
    if (resolution.state.revision === current.revision) continue;
    current = resolution.state;
    applied += 1;
  }
  return current;
}

describe('floor wire codec', () => {
  it('round-trips a full sync to a byte-identical cell array', () => {
    const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const wire = new FloorWireEncoder().encode(snapshotOf(run));
    const decoded = new FloorWireDecoder().decode(wire);

    expect(wire.projection.floor.cells.kind).toBe('full');
    expect(decoded).not.toBeNull();
    expect(decoded!.projection.floor.cells).toEqual(cellsOf(run));
  });

  it('omits unknown cells from a full sync but reconstructs them exactly', () => {
    let run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    run = descendToNextFloor(onStairDown(run), { content: pack }).state;
    const cells = cellsOf(run);
    const unknownCount = cells.filter((cell) => cell.knowledge === 'unknown').length;

    const wire = new FloorWireEncoder().encode(snapshotOf(run));
    const encoded = wire.projection.floor.cells;
    if (encoded.kind !== 'full') throw new Error('expected a full sync');

    // A freshly-entered dungeon floor is almost entirely unknown -- that is the payload this whole
    // mechanism exists to stop shipping.
    expect(unknownCount).toBeGreaterThan(7000);
    expect(encoded.knownCells).toHaveLength(cells.length - unknownCount);
    expect(encoded.knownCells.every((cell) => cell.knowledge !== 'unknown')).toBe(true);
    expect(new FloorWireDecoder().decode(wire)!.projection.floor.cells).toEqual(cells);
  });

  it('keeps client and server cell arrays identical across a long walk (parity)', () => {
    let run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const encoder = new FloorWireEncoder();
    const decoder = new FloorWireDecoder();

    // Town, then a descent (which must force a full sync), then dungeon movement.
    const stages: readonly ((state: ActiveRun) => ActiveRun)[] = [
      (state) => walk(state, 6),
      (state) => descendToNextFloor(onStairDown(state), { content: pack }).state,
      (state) => walk(state, 25),
      (state) => descendToNextFloor(onStairDown(state), { content: pack }).state,
      (state) => walk(state, 25),
    ];

    let patches = 0;
    for (const stage of stages) {
      run = stage(run);
      const decoded = decoder.decode(encoder.encode(snapshotOf(run)));
      expect(decoded).not.toBeNull();
      expect(decoded!.projection.floor.cells).toEqual(cellsOf(run));
    }

    // Per-move parity, not just per-stage: this is the invariant the design rests on.
    for (let step = 0; step < 30; step += 1) {
      const before = run.revision;
      run = walk(run, 1);
      if (run.revision === before) continue;
      const wire = encoder.encode(snapshotOf(run));
      if (wire.projection.floor.cells.kind === 'patch') patches += 1;
      const decoded = decoder.decode(wire);
      expect(decoded).not.toBeNull();
      expect(decoded!.projection.floor.cells).toEqual(cellsOf(run));
    }
    // Guards against the whole test passing vacuously by never exercising the patch path.
    expect(patches).toBeGreaterThan(20);
  });

  it('sends a full sync on a floor change rather than a patch against the previous grid', () => {
    let run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const encoder = new FloorWireEncoder();
    encoder.encode(snapshotOf(run));
    run = walk(run, 3);
    expect(encoder.encode(snapshotOf(run)).projection.floor.cells.kind).toBe('patch');

    run = descendToNextFloor(onStairDown(run), { content: pack }).state;
    const wire = encoder.encode(snapshotOf(run));
    expect(wire.projection.floor.cells.kind).toBe('full');
    // Town is 34x16 and a dungeon floor 160x50 -- patching across that would be incoherent, not
    // merely wasteful.
    expect(wire.projection.floor.width * wire.projection.floor.height).not.toBe(544);
  });

  it('refuses a patch whose baseRevision the decoder does not hold', () => {
    let run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const encoder = new FloorWireEncoder();
    const decoder = new FloorWireDecoder();
    decoder.decode(encoder.encode(snapshotOf(run)));

    run = walk(run, 2);
    const wire = encoder.encode(snapshotOf(run));
    const cells = wire.projection.floor.cells;
    if (cells.kind !== 'patch') throw new Error('expected a patch');

    const forged: WireRunSnapshot = {
      ...wire,
      projection: {
        ...wire.projection,
        floor: {
          ...wire.projection.floor,
          cells: { ...cells, baseRevision: cells.baseRevision + 99 },
        },
      },
    };
    expect(decoder.decode(forged)).toBeNull();
  });

  it('refuses a patch when it has never seen a floor, and recovers from the next full sync', () => {
    const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const encoder = new FloorWireEncoder();
    const decoder = new FloorWireDecoder();
    // Prime ONLY the encoder, so its second message is a patch the fresh decoder cannot apply.
    encoder.encode(snapshotOf(run));
    const walked = walk(run, 2);
    expect(decoder.decode(encoder.encode(snapshotOf(walked)))).toBeNull();

    encoder.reset();
    const recovered = decoder.decode(encoder.encode(snapshotOf(walked)));
    expect(recovered).not.toBeNull();
    expect(recovered!.projection.floor.cells).toEqual(cellsOf(walked));
  });

  it('transmits a cell that reverts to unknown', () => {
    const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const encoder = new FloorWireEncoder();
    const decoder = new FloorWireDecoder();
    const base = snapshotOf(run);
    decoder.decode(encoder.encode(base));

    // Light-out's `rememberedMapPersists: false` branch turns known cells back to unknown; forging
    // the projection directly keeps this test about the CODEC rather than about the light model.
    const reverted = base.projection.floor.cells.map((cell, index) =>
      index === 0 ? { index: 0, x: 0, y: 0, knowledge: 'unknown' as const, intensity: 0 } : cell,
    );
    const wire = encoder.encode({
      ...base,
      revision: base.revision + 1,
      projection: {
        ...base.projection,
        floor: { ...base.projection.floor, cells: reverted },
      },
    });
    const cells = wire.projection.floor.cells;
    if (cells.kind !== 'patch') throw new Error('expected a patch');

    expect(cells.changedCells).toHaveLength(1);
    expect(cells.changedCells[0]!.knowledge).toBe('unknown');
    expect(decoder.decode(wire)!.projection.floor.cells).toEqual(reverted);
  });

  it('keeps a per-move reply far below the whole-floor payload it replaces', () => {
    let run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    run = descendToNextFloor(onStairDown(run), { content: pack }).state;
    const encoder = new FloorWireEncoder();
    encoder.encode(snapshotOf(run));

    const whole = JSON.stringify(snapshotOf(run)).length;
    let worst = 0;
    for (let step = 0; step < 20; step += 1) {
      const before = run.revision;
      run = walk(run, 1);
      if (run.revision === before) continue;
      worst = Math.max(worst, JSON.stringify(encoder.encode(snapshotOf(run))).length);
    }

    // A whole-floor reply measures ~527 KB; a per-move one ~10 KB. The threshold is deliberately
    // slack -- it exists to fail loudly if a change reintroduces whole-grid shipping, not to pin an
    // exact byte count that ordinary content edits would churn.
    expect(whole).toBeGreaterThan(400_000);
    expect(worst).toBeLessThan(32_000);
  });
});
