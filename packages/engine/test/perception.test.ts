import { describe, expect, it } from 'vitest';

import type { AmbientLight, LightSource } from '../src/light-model.js';
import type { TileId } from '../src/model.js';
import {
  createUnknownKnowledge,
  isExplored,
  rememberedTile,
  refreshKnowledge,
  stableJson,
} from '../src/index.js';

const width = 9;
const height = 7;
const lines = [
  '#########',
  '#...#...#',
  '#...#...#',
  '#...+...#',
  '#...O...#',
  '#.......#',
  '#########',
] as const;
const tiles = lines.flatMap((line) =>
  [...line].map<TileId>((glyph) => {
    if (glyph === '#') return 0;
    if (glyph === '+') return 2;
    if (glyph === 'O') return 3;
    return 1;
  }),
);
const at = (x: number, y: number): number => y * width + x;
const dark: AmbientLight = { color: [255, 255, 255], strength: 0 };
const ambient: AmbientLight = { color: [80, 100, 120], strength: 5 };
const hero = { heroId: 'hero.test', x: 2, y: 3, sightRadius: 5 } as const;

const carriedTorch: LightSource = {
  lightId: 'light.torch',
  location: { type: 'actor', actorId: hero.heroId },
  color: [255, 180, 90],
  radius: 3,
  strength: 255,
  enabled: true,
  falloff: 'linear',
  vaultPlacementId: null,
  presentation: null,
};

const fixedBlue: LightSource = {
  lightId: 'light.blue',
  location: { type: 'fixed', x: 6, y: 3 },
  color: [20, 50, 255],
  radius: 2,
  strength: 180,
  enabled: true,
  falloff: 'linear',
  vaultPlacementId: 'vault.blue',
  presentation: { glyph: '*', token: 'fixture.blue' },
};

function floor(overrides: Record<string, unknown> = {}) {
  return {
    floorId: 'floor.test',
    width,
    height,
    tiles,
    ambient: dark,
    lights: [carriedTorch, fixedBlue],
    knowledge: createUnknownKnowledge(width * height),
    ...overrides,
  } as Parameters<typeof refreshKnowledge>[0]['floor'];
}

describe('knowledge refresh', () => {
  it('marks only illuminated hero-FOV cells as explored', () => {
    const result = refreshKnowledge({
      floor: floor(),
      hero,
      actors: new Map([[hero.heroId, hero]]),
    });

    for (let index = 0; index < width * height; index += 1) {
      const inFov = ((result.visibilityWords[Math.floor(index / 32)]! >>> (index % 32)) & 1) === 1;
      expect(isExplored(result.knowledge, index)).toBe(
        inFov && result.illumination.intensity[index]! > 0,
      );
    }
    expect(isExplored(result.knowledge, at(2, 3))).toBe(true);
    expect(isExplored(result.knowledge, at(8, 6))).toBe(false);
  });

  it('shows no cells beyond sight in absolute darkness without a source', () => {
    const result = refreshKnowledge({
      floor: floor({ lights: [] }),
      hero,
      actors: new Map([[hero.heroId, hero]]),
    });

    expect(result.visibilityWords.some((word) => word !== 0)).toBe(true);
    expect(result.knowledge.exploredWords.every((word) => word === 0)).toBe(true);
  });

  it('reveals dim FOV cells when ambient strength is nonzero', () => {
    const result = refreshKnowledge({
      floor: floor({ ambient, lights: [] }),
      hero,
      actors: new Map([[hero.heroId, hero]]),
    });

    expect(result.illumination.intensity[at(1, 1)]).toBe(2);
    expect(isExplored(result.knowledge, at(1, 1))).toBe(true);
    expect(isExplored(result.knowledge, at(7, 1))).toBe(false);
  });

  it('retains the last terrain after an unseen door changes', () => {
    const observed = refreshKnowledge({
      floor: floor({ ambient, lights: [] }),
      hero,
      actors: new Map([[hero.heroId, hero]]),
    });
    expect(isExplored(observed.knowledge, at(4, 3))).toBe(true);

    const changedTiles = [...tiles];
    changedTiles[at(4, 3)] = 1;
    changedTiles[at(5, 3)] = 0;
    const hiddenHero = { ...hero, x: 6, y: 3 };
    const hidden = refreshKnowledge({
      floor: floor({ tiles: changedTiles, ambient, lights: [], knowledge: observed.knowledge }),
      hero: hiddenHero,
      actors: new Map([[hero.heroId, hiddenHero]]),
    });

    expect((hidden.visibilityWords[0]! >>> at(4, 3)) & 1).toBe(0);
    expect(rememberedTile(hidden.knowledge, at(4, 3))).toBe(2);
  });

  it('moves actor-attached light when the hero position changes', () => {
    const first = refreshKnowledge({
      floor: floor({ lights: [carriedTorch] }),
      hero,
      actors: new Map([[hero.heroId, hero]]),
    });
    const movedHero = { ...hero, x: 2, y: 5 };
    const moved = refreshKnowledge({
      floor: floor({ lights: [carriedTorch] }),
      hero: movedHero,
      actors: new Map([[hero.heroId, movedHero]]),
    });

    expect(first.illumination.intensity[at(2, 3)]).toBe(255);
    expect(moved.illumination.intensity[at(2, 5)]).toBe(255);
    expect(moved.illumination.intensity[at(2, 1)]).toBe(0);
  });

  it('returns identical bytes for identical inputs and does not mutate them', () => {
    const immutableFloor = Object.freeze({
      ...floor(),
      tiles: Object.freeze([...tiles]),
      lights: Object.freeze([Object.freeze(carriedTorch), Object.freeze(fixedBlue)]),
      knowledge: Object.freeze({
        exploredWords: Object.freeze([0, 0]),
        rememberedTerrainWords: Object.freeze(
          createUnknownKnowledge(width * height).rememberedTerrainWords,
        ),
      }),
    });
    const actors = new Map([[hero.heroId, Object.freeze({ x: hero.x, y: hero.y })]]);
    const before = stableJson({ floor: immutableFloor, hero, actors: [...actors] });

    const first = refreshKnowledge({ floor: immutableFloor, hero, actors });
    const second = refreshKnowledge({ floor: immutableFloor, hero, actors });

    expect(stableJson(first)).toBe(stableJson(second));
    expect(stableJson({ floor: immutableFloor, hero, actors: [...actors] })).toBe(before);
    expect(first).not.toBe(second);
    expect(first.knowledge).not.toBe(second.knowledge);
    expect(first.knowledge.exploredWords).not.toBe(second.knowledge.exploredWords);
    expect(first.knowledge.rememberedTerrainWords).not.toBe(
      second.knowledge.rememberedTerrainWords,
    );
    expect(first.visibilityWords).not.toBe(second.visibilityWords);
    expect(first.illumination.intensity).not.toBe(second.illumination.intensity);
  });

  it('commits the light-out bubble as explored terrain when lightOutMemory is active and the hero is dark', () => {
    const result = refreshKnowledge({
      floor: floor({ lights: [] }),
      hero,
      actors: new Map([[hero.heroId, hero]]),
      lightOutMemory: { commitsMemory: true, revealRadius: 2 },
    });

    expect(result.illumination.intensity[at(hero.x, hero.y)]).toBe(0);
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const x = hero.x + dx;
        const y = hero.y + dy;
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        expect(isExplored(result.knowledge, at(x, y))).toBe(true);
        expect(rememberedTile(result.knowledge, at(x, y))).toBe(tiles[at(x, y)]);
      }
    }
    // Outside the radius-2 bubble and outside the extinguished FOV/illumination stays unknown.
    expect(isExplored(result.knowledge, at(8, 6))).toBe(false);
  });

  it('commits nothing new when lightOutMemory is absent or commitsMemory is false (default knob 0)', () => {
    const withoutParam = refreshKnowledge({
      floor: floor({ lights: [] }),
      hero,
      actors: new Map([[hero.heroId, hero]]),
    });
    const explicitlyOff = refreshKnowledge({
      floor: floor({ lights: [] }),
      hero,
      actors: new Map([[hero.heroId, hero]]),
      lightOutMemory: { commitsMemory: false, revealRadius: 2 },
    });

    expect(withoutParam.knowledge.exploredWords.every((word) => word === 0)).toBe(true);
    expect(explicitlyOff.knowledge.exploredWords.every((word) => word === 0)).toBe(true);
    expect(stableJson(withoutParam)).toBe(stableJson(explicitlyOff));
  });

  it('rejects malformed and sparse structural inputs', () => {
    const sparseTiles = Array<TileId>(width * height);
    sparseTiles.fill(1);
    delete sparseTiles[4];

    expect(() =>
      refreshKnowledge({
        floor: floor({ tiles: sparseTiles }),
        hero,
        actors: new Map([[hero.heroId, hero]]),
      }),
    ).toThrow(/tile 4/);
    expect(() =>
      refreshKnowledge({
        floor: floor(),
        hero: { ...hero, sightRadius: -1 },
        actors: new Map([[hero.heroId, hero]]),
      }),
    ).toThrow(/radius/);
    expect(() =>
      refreshKnowledge({
        floor: floor({ floorId: 'Bad ID' }),
        hero,
        actors: new Map([[hero.heroId, hero]]),
      }),
    ).toThrow(/floorId/);
  });
});
