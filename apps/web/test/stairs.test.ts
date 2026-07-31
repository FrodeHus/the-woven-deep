import { describe, expect, it } from 'vitest';
import type { GameplayProjection, Point } from '@woven-deep/engine';
import { findDiscoveredStair, stairUnderHero } from '../src/session/stairs.js';

const WIDTH = 10;
const HEIGHT = 6;

function makeProjection(input: {
  hero: Point;
  stairs?: readonly (Point & { glyph: '>' | '<'; known?: boolean })[];
}): GameplayProjection {
  const byKey = new Map(
    (input.stairs ?? []).map((stair) => [`${stair.x},${stair.y}`, stair] as const),
  );
  const cells = [];
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const stair = byKey.get(`${x},${y}`);
      cells.push({
        index: y * WIDTH + x,
        x,
        y,
        knowledge: stair && stair.known === false ? ('unknown' as const) : ('visible' as const),
        tileId: 1,
        glyph: stair ? stair.glyph : '.',
        token: stair ? 'terrain.stair' : 'terrain.floor',
        intensity: 255,
      });
    }
  }
  return {
    floor: { floorId: 'f', depth: 1, town: false, width: WIDTH, height: HEIGHT, cells },
    hero: { x: input.hero.x, y: input.hero.y, health: 20, backpack: [], backpackCapacity: 10 },
    actors: [],
    groundItems: [],
    features: [],
  } as unknown as GameplayProjection;
}

describe('stairUnderHero', () => {
  it('is true only for a stair of the matching direction under the hero', () => {
    const down = makeProjection({ hero: { x: 3, y: 3 }, stairs: [{ x: 3, y: 3, glyph: '>' }] });
    expect(stairUnderHero(down, 'down')).toBe(true);
    expect(stairUnderHero(down, 'up')).toBe(false);
    const away = makeProjection({ hero: { x: 4, y: 3 }, stairs: [{ x: 3, y: 3, glyph: '>' }] });
    expect(stairUnderHero(away, 'down')).toBe(false);
  });
});

describe('findDiscoveredStair', () => {
  it('finds the nearest discovered stair of the matching direction', () => {
    const projection = makeProjection({
      hero: { x: 1, y: 1 },
      stairs: [
        { x: 8, y: 4, glyph: '>' },
        { x: 3, y: 1, glyph: '>' },
        { x: 5, y: 5, glyph: '<' },
      ],
    });
    expect(findDiscoveredStair(projection, 'down')).toEqual({ x: 3, y: 1 });
    expect(findDiscoveredStair(projection, 'up')).toEqual({ x: 5, y: 5 });
  });

  it('ignores an undiscovered stair and returns null when none is known', () => {
    const projection = makeProjection({
      hero: { x: 1, y: 1 },
      stairs: [{ x: 8, y: 4, glyph: '>', known: false }],
    });
    expect(findDiscoveredStair(projection, 'down')).toBeNull();
  });
});
