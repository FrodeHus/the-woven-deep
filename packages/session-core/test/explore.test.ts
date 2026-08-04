import { describe, expect, it } from 'vitest';
import type { GameplayProjection, Point } from '@woven-deep/engine';
import { computeExplorePath } from '../src/explore.js';

const WIDTH = 12;
const HEIGHT = 8;

interface Actor {
  readonly actorId: string;
  readonly x: number;
  readonly y: number;
  readonly disposition: string;
  readonly health: number;
}

/** A grid of visible floor with optional walls, locked doors, actors and never-discovered cells. */
function makeProjection(input: {
  hero: Point;
  walls?: readonly Point[];
  unknownCells?: readonly Point[];
  lockedDoors?: readonly Point[];
  actors?: readonly Actor[];
}): GameplayProjection {
  const wallSet = new Set((input.walls ?? []).map((p) => `${p.x},${p.y}`));
  const unknownSet = new Set((input.unknownCells ?? []).map((p) => `${p.x},${p.y}`));
  const doorSet = new Set((input.lockedDoors ?? []).map((p) => `${p.x},${p.y}`));
  const cells = [];
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const wall = wallSet.has(`${x},${y}`);
      const door = doorSet.has(`${x},${y}`);
      cells.push({
        index: y * WIDTH + x,
        x,
        y,
        knowledge: unknownSet.has(`${x},${y}`) ? ('unknown' as const) : ('visible' as const),
        tileId: wall ? 0 : 1,
        glyph: wall ? '#' : door ? '+' : '.',
        token: wall ? 'terrain.wall' : door ? 'terrain.door' : 'terrain.floor',
        intensity: 255,
      });
    }
  }
  return {
    floor: { floorId: 'floor.test', depth: 1, town: false, width: WIDTH, height: HEIGHT, cells },
    hero: { x: input.hero.x, y: input.hero.y, health: 20, backpack: [], backpackCapacity: 10 },
    actors: input.actors ?? [],
    groundItems: [],
    features: (input.lockedDoors ?? []).map((p, index) => ({
      featureId: `feature.door.${index}`,
      type: 'door',
      state: 'locked',
      x: p.x,
      y: p.y,
    })),
  } as unknown as GameplayProjection;
}

/** Every cell unknown except a corridor of known floor, so the frontier is unambiguous. */
function corridorProjection(hero: Point, knownCells: readonly Point[]): GameplayProjection {
  const known = new Set(knownCells.map((p) => `${p.x},${p.y}`));
  const unknown: Point[] = [];
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      if (!known.has(`${x},${y}`)) unknown.push({ x, y });
    }
  }
  return makeProjection({ hero, unknownCells: unknown });
}

describe('computeExplorePath', () => {
  it('walks to the nearest cell that touches unexplored ground', () => {
    // Known: a straight run from (2,4) east to (6,4). Everything else is unknown, so (2,4) and
    // (6,4) are both frontier cells -- but the hero stands on (2,4), which is never a target.
    const known: Point[] = [
      { x: 2, y: 4 },
      { x: 3, y: 4 },
      { x: 4, y: 4 },
      { x: 5, y: 4 },
      { x: 6, y: 4 },
    ];
    const path = computeExplorePath(corridorProjection({ x: 4, y: 4 }, known));
    expect(path).not.toBeNull();
    // (3,4) and (5,4) both touch unknown ground and are both one step away; either is correct,
    // but the path must be exactly one step and must not stay put.
    expect(path).toHaveLength(1);
    expect(Math.abs(path![0]!.x - 4)).toBe(1);
    expect(path![0]!.y).toBe(4);
  });

  it('returns null on a fully explored floor', () => {
    expect(computeExplorePath(makeProjection({ hero: { x: 5, y: 5 } }))).toBeNull();
  });

  it('returns null when every frontier is walled off from the hero', () => {
    // A full-height wall at x=3 seals the hero (x=1) away from the unknown region at x>=6.
    const walls: Point[] = [];
    for (let y = 0; y < HEIGHT; y += 1) walls.push({ x: 3, y });
    const unknownCells: Point[] = [];
    for (let y = 0; y < HEIGHT; y += 1) {
      for (let x = 6; x < WIDTH; x += 1) unknownCells.push({ x, y });
    }
    expect(
      computeExplorePath(makeProjection({ hero: { x: 1, y: 4 }, walls, unknownCells })),
    ).toBeNull();
  });

  it('refuses to route through a locked door', () => {
    // A wall at x=3 with a single LOCKED door at (3,4): the only opening is not navigable.
    const walls: Point[] = [];
    for (let y = 0; y < HEIGHT; y += 1) {
      if (y !== 4) walls.push({ x: 3, y });
    }
    const unknownCells: Point[] = [];
    for (let y = 0; y < HEIGHT; y += 1) {
      for (let x = 6; x < WIDTH; x += 1) unknownCells.push({ x, y });
    }
    const projection = makeProjection({
      hero: { x: 1, y: 4 },
      walls,
      unknownCells,
      lockedDoors: [{ x: 3, y: 4 }],
    });
    expect(computeExplorePath(projection)).toBeNull();
  });

  it('refuses to route through a perceived actor', () => {
    // Same sealed wall, but the single opening at (3,4) is occupied by a bystander.
    const walls: Point[] = [];
    for (let y = 0; y < HEIGHT; y += 1) {
      if (y !== 4) walls.push({ x: 3, y });
    }
    const unknownCells: Point[] = [];
    for (let y = 0; y < HEIGHT; y += 1) {
      for (let x = 6; x < WIDTH; x += 1) unknownCells.push({ x, y });
    }
    const projection = makeProjection({
      hero: { x: 1, y: 4 },
      walls,
      unknownCells,
      actors: [{ actorId: 'a', x: 3, y: 4, disposition: 'neutral', health: 5 }],
    });
    expect(computeExplorePath(projection)).toBeNull();
  });
});
