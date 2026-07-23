import { describe, expect, it } from 'vitest';
import type { ObservableFloorProjection, Point } from '@woven-deep/engine';
import {
  affectedFootprint,
  aimInRange,
  computeValidTargets,
} from '../src/session/spell-targeting.js';
import type { ActorView } from '../src/session/projection-view.js';

/**
 * Mirrors `packages/engine/test/targeting.test.ts`'s fixture: the hero at (1,1), a hostile at
 * (4,1), a 7x3 all-floor grid (tileId 1) with an optional wall at (3,1) blocking the line. Every
 * cell defaults to `visible` with a full-brightness `tileId` -- exactly what the projection reports
 * for a lit, explored room -- unless the case asks for a hidden/unseen target.
 */
function floorFixture(
  input: Readonly<{ wall?: boolean; hiddenTarget?: boolean }> = {},
): ObservableFloorProjection {
  const width = 7;
  const height = 3;
  const cells: ObservableFloorProjection['cells'][number][] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const isWall = input.wall === true && x === 3 && y === 1;
      const isHiddenTarget = input.hiddenTarget === true && x === 4 && y === 1;
      cells.push(
        isHiddenTarget
          ? { index, x, y, knowledge: 'unknown', intensity: 0 }
          : {
              index,
              x,
              y,
              knowledge: 'visible',
              tileId: isWall ? 0 : 1,
              token: isWall ? 'terrain.wall' : 'terrain.floor',
              intensity: 255,
            },
      );
    }
  }
  return { floorId: 'floor.test', depth: 1, town: false, width, height, cells };
}

const HERO = { x: 1, y: 1, actorId: 'hero.demo' };

function hostileAt(x: number, y: number): ActorView {
  return {
    actorId: 'monster.hidden',
    contentId: 'monster.hidden',
    x,
    y,
    health: 4,
    maxHealth: 4,
    healthPresentation: { current: 4, maximum: 4, band: 'healthy' },
    disposition: 'hostile',
  };
}

describe('computeValidTargets (target.actor)', () => {
  it('accepts a visible, in-range, unobstructed hostile', () => {
    const result = computeValidTargets({
      spell: { range: 5, targetingId: 'target.actor' },
      floor: floorFixture(),
      hero: HERO,
      actors: [hostileAt(4, 1)],
    });
    expect(result.candidates).toEqual([
      { cell: { x: 4, y: 1 }, actorId: 'monster.hidden', affected: [{ x: 4, y: 1 }] },
    ]);
  });

  it('rejects a hostile the client has never observed (unknown cell)', () => {
    const result = computeValidTargets({
      spell: { range: 5, targetingId: 'target.actor' },
      floor: floorFixture({ hiddenTarget: true }),
      hero: HERO,
      actors: [hostileAt(4, 1)],
    });
    expect(result.candidates).toEqual([]);
  });

  it('rejects an out-of-range hostile', () => {
    const result = computeValidTargets({
      spell: { range: 2, targetingId: 'target.actor' },
      floor: floorFixture(),
      hero: HERO,
      actors: [hostileAt(4, 1)],
    });
    expect(result.candidates).toEqual([]);
  });

  it('rejects a hostile behind a wall blocking line of sight', () => {
    const result = computeValidTargets({
      spell: { range: 5, targetingId: 'target.actor' },
      floor: floorFixture({ wall: true }),
      hero: HERO,
      actors: [hostileAt(4, 1)],
    });
    expect(result.candidates).toEqual([]);
  });

  it('ignores a non-hostile actor even if it would otherwise be a valid target', () => {
    const result = computeValidTargets({
      spell: { range: 5, targetingId: 'target.actor' },
      floor: floorFixture(),
      hero: HERO,
      actors: [{ ...hostileAt(4, 1), disposition: 'neutral' }],
    });
    expect(result.candidates).toEqual([]);
  });

  it('returns one candidate per valid hostile when several are in view', () => {
    const result = computeValidTargets({
      spell: { range: 5, targetingId: 'target.actor' },
      floor: floorFixture(),
      hero: HERO,
      actors: [hostileAt(4, 1), hostileAt(2, 1)],
    });
    expect(result.candidates.map((candidate) => candidate.cell)).toEqual([
      { x: 4, y: 1 },
      { x: 2, y: 1 },
    ]);
  });
});

describe('computeValidTargets (target.self)', () => {
  it('always yields the caster cell regardless of actors/floor', () => {
    const result = computeValidTargets({
      spell: { range: 0, targetingId: 'target.self' },
      floor: floorFixture(),
      hero: HERO,
      actors: [],
    });
    expect(result.candidates).toEqual([
      { cell: { x: 1, y: 1 }, actorId: 'hero.demo', affected: [{ x: 1, y: 1 }] },
    ]);
  });
});

describe('computeValidTargets (unsupported targeting ids)', () => {
  it('yields no candidates for target.cell/target.line (no content spell uses them yet)', () => {
    const result = computeValidTargets({
      spell: { range: 5, targetingId: 'target.cell' },
      floor: floorFixture(),
      hero: HERO,
      actors: [hostileAt(4, 1)],
    });
    expect(result.candidates).toEqual([]);
  });
});

/** A `w x h` all-floor, all-visible projection with optional walls (tileId 0), origin (0,0). */
function openProjection(
  w: number,
  h: number,
  walls: readonly [number, number][] = [],
): ObservableFloorProjection {
  const wallSet = new Set(walls.map(([x, y]) => `${x},${y}`));
  const cells: ObservableFloorProjection['cells'][number][] = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const isWall = wallSet.has(`${x},${y}`);
      cells.push({
        index: y * w + x,
        x,
        y,
        knowledge: 'visible',
        tileId: isWall ? 0 : 1,
        token: isWall ? 'terrain.wall' : 'terrain.floor',
        intensity: 255,
      });
    }
  }
  return { floorId: 'floor.test', depth: 1, town: false, width: w, height: h, cells };
}

function footprintKeys(cells: readonly Point[]): Set<string> {
  return new Set(cells.map((c) => `${c.x},${c.y}`));
}

describe('affectedFootprint', () => {
  it('burst returns the Chebyshev disc around a visible, in-range aim', () => {
    const cells = affectedFootprint({
      spell: { range: 6, targetingId: 'target.burst', aoe: { shape: 'burst', radius: 1 } },
      floor: openProjection(9, 9),
      hero: { x: 2, y: 2 },
      aim: { x: 5, y: 5 },
    });
    expect(footprintKeys(cells)).toEqual(
      new Set(['4,4', '5,4', '6,4', '4,5', '5,5', '6,5', '4,6', '5,6', '6,6']),
    );
  });

  it('returns [] when the aim is out of range', () => {
    const cells = affectedFootprint({
      spell: { range: 2, targetingId: 'target.burst', aoe: { shape: 'burst', radius: 1 } },
      floor: openProjection(9, 9),
      hero: { x: 0, y: 0 },
      aim: { x: 8, y: 8 },
    });
    expect(cells).toEqual([]);
  });

  it('single-target self yields just the aim cell', () => {
    const cells = affectedFootprint({
      spell: { range: 0, targetingId: 'target.self' },
      floor: openProjection(5, 5),
      hero: { x: 2, y: 2 },
      aim: { x: 2, y: 2 },
    });
    expect(cells).toEqual([{ x: 2, y: 2 }]);
  });
});

describe('geometry parity: engine tiles vs full-visibility projection', () => {
  it('burst/line/cone match validateTarget cells on the same map', async () => {
    const { validateTarget, createDemoRun } = await import('@woven-deep/engine');
    const width = 11;
    const height = 5;
    const walls: [number, number][] = [[6, 2]];
    // Engine input: raw tiles (1 floor, 0 wall).
    const run = createDemoRun();
    const tiles = Array(width * height).fill(1);
    for (const [x, y] of walls) tiles[y * width + x] = 0;
    const floor = { ...run.floors[0]!, width, height, tiles };
    const source = { ...run.actors[0]!, x: 2, y: 2, floorId: floor.floorId };
    const engineInput = {
      sourceActor: source,
      targetActorId: null,
      floor,
      actors: [source],
      visibilityWords: Array(Math.ceil((width * height) / 32)).fill(0xffffffff),
      illumination: { intensity: Array(width * height).fill(255) },
      range: 6,
    } as const;
    const projection = openProjection(width, height, walls);

    for (const shape of ['burst', 'line', 'cone'] as const) {
      const targetingId = `target.${shape}` as const;
      const aoe = { shape, radius: 3 } as const;
      const aim = { x: 8, y: 2 };
      const engine = validateTarget({ ...engineInput, targetingId, target: aim, aoe });
      expect(engine.ok).toBe(true);
      const client = affectedFootprint({
        spell: { range: 6, targetingId, aoe },
        floor: projection,
        hero: { x: 2, y: 2 },
        aim,
      });
      if (!engine.ok) return;
      expect(footprintKeys(client)).toEqual(footprintKeys(engine.cells));
    }
  });
});

describe('aimInRange', () => {
  it('is Chebyshev range from the hero', () => {
    expect(aimInRange({ x: 0, y: 0 }, { x: 3, y: 2 }, 3)).toBe(true);
    expect(aimInRange({ x: 0, y: 0 }, { x: 4, y: 0 }, 3)).toBe(false);
  });
});
