import { describe, expect, it } from 'vitest';
import type { ObservableFloorProjection } from '@woven-deep/engine';
import { computeValidTargets } from '../src/session/spell-targeting.js';
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
