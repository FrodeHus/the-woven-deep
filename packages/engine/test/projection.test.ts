import { describe, expect, it } from 'vitest';

import type { LightSource } from '../src/light-model.js';
import type { TileId } from '../src/model.js';
import {
  createDemoContentPack,
  createDemoRun,
  createUnknownKnowledge,
  projectDecision,
  projectFloor,
  projectGameplayState,
  refreshKnowledge,
  stableJson,
} from '../src/index.js';
import type { MonsterContentEntry } from '@woven-deep/content';

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
const tiles = lines.flatMap((line) => [...line].map<TileId>((glyph) => {
  if (glyph === '#') return 0;
  if (glyph === '+') return 2;
  if (glyph === 'O') return 3;
  return 1;
}));
const at = (x: number, y: number): number => y * width + x;
const hero = { heroId: 'hero.test', x: 2, y: 3, sightRadius: 5 } as const;

const torch: LightSource = {
  lightId: 'light.torch', location: { type: 'actor', actorId: hero.heroId }, color: [255, 180, 90],
  radius: 3, strength: 255, enabled: true, falloff: 'linear', vaultPlacementId: null, presentation: null,
};
const fixture: LightSource = {
  lightId: 'light.blue', location: { type: 'fixed', x: 3, y: 3 }, color: [20, 50, 255],
  radius: 2, strength: 180, enabled: false, falloff: 'linear', vaultPlacementId: 'vault.blue',
  presentation: { glyph: '*', token: 'fixture.blue' },
};

function baseFloor(lights: readonly LightSource[] = [torch, fixture]) {
  return {
    floorId: 'floor.test', width, height, tiles,
    ambient: { color: [255, 255, 255] as const, strength: 0 },
    lights, knowledge: createUnknownKnowledge(width * height),
  };
}

function perceived(lights: readonly LightSource[] = [torch, fixture]) {
  const floor = baseFloor(lights);
  const result = refreshKnowledge({ floor, hero, actors: new Map([[hero.heroId, hero]]) });
  return { floor: { ...floor, knowledge: result.knowledge }, hero,
    visibilityWords: result.visibilityWords, illumination: result.illumination };
}

describe('observable floor projection', () => {
  it('uses explicit unknown, remembered, and visible cell shapes without hidden state', () => {
    const first = perceived();
    const changedTiles = [...tiles];
    changedTiles[at(4, 3)] = 1;
    const hiddenHero = { ...hero, x: 6, y: 1, sightRadius: 2 };
    const hiddenFloor = { ...first.floor, tiles: changedTiles };
    const hidden = refreshKnowledge({ floor: hiddenFloor, hero: hiddenHero,
      actors: new Map([[hero.heroId, hiddenHero]]) });
    const projection = projectFloor({ floor: { ...hiddenFloor, knowledge: hidden.knowledge }, hero: hiddenHero,
      visibilityWords: hidden.visibilityWords, illumination: hidden.illumination });

    expect(stableJson(projection.cells[at(0, 6)])).toBe(stableJson({
      index: at(0, 6), x: 0, y: 6, knowledge: 'unknown', intensity: 0,
    }));
    expect(stableJson(projection.cells[at(4, 3)])).toBe(stableJson({
      index: at(4, 3), x: 4, y: 3, knowledge: 'remembered', tileId: 2,
      glyph: '+', token: 'terrain.door', intensity: 24,
    }));
    expect(stableJson(projection.cells[at(6, 1)])).toBe(stableJson({
      index: at(6, 1), x: 6, y: 1, knowledge: 'visible', tileId: 1,
      glyph: '.', token: 'terrain.floor', intensity: 255, tint: [255, 180, 90],
    }));
    expect(stableJson(projection.cells[at(4, 3)])).not.toContain('fixture');
    expect(stableJson(projection.cells[at(4, 3)])).not.toContain('tint');
    expect(stableJson(projection.cells[at(4, 3)])).not.toContain('preview');
  });

  it('exposes only visible fixed presented fixtures, including disabled fixtures', () => {
    const input = perceived();
    const projection = projectFloor(input);

    expect(stableJson(projection.cells[at(3, 3)])).toBe(stableJson({
      index: at(3, 3), x: 3, y: 3, knowledge: 'visible', tileId: 1,
      glyph: '.', token: 'terrain.floor', intensity: 191, tint: [191, 134, 67],
      fixture: { lightId: 'light.blue', glyph: '*', token: 'fixture.blue' },
    }));
  });

  it('removes fixture presentation when its cell becomes remembered', () => {
    const first = perceived();
    const hiddenHero = { ...hero, x: 6, y: 1, sightRadius: 2 };
    const hidden = refreshKnowledge({ floor: first.floor, hero: hiddenHero,
      actors: new Map([[hero.heroId, hiddenHero]]) });
    const cell = projectFloor({ floor: { ...first.floor, knowledge: hidden.knowledge }, hero: hiddenHero,
      visibilityWords: hidden.visibilityWords, illumination: hidden.illumination }).cells[at(3, 3)]!;

    expect(cell.knowledge).toBe('remembered');
    expect(cell).not.toHaveProperty('fixture');
  });

  it('emits preview separately, clips it to visible or explored cells, and creates no knowledge', () => {
    const input = perceived();
    const knowledgeBefore = stableJson(input.floor.knowledge);
    const illuminationBefore = stableJson(input.illumination);
    const preview = { color: [20, 255, 80] as const, radius: 6, strength: 200, falloff: 'linear' as const };
    const projection = projectFloor({ ...input, preview });
    const zeroes = Array<number>(width * height).fill(0);
    const rememberedProjection = projectFloor({
      ...input,
      illumination: { red: [...zeroes], green: [...zeroes], blue: [...zeroes], intensity: [...zeroes] },
      preview,
    });

    expect(projection.cells[at(2, 3)]!.previewIntensity).toBe(200);
    expect(rememberedProjection.cells[at(2, 3)]!.knowledge).toBe('remembered');
    expect(rememberedProjection.cells[at(2, 3)]!.previewIntensity).toBe(200);
    expect(projection.cells[at(0, 6)]).toEqual({
      index: at(0, 6), x: 0, y: 6, knowledge: 'unknown', intensity: 0,
    });
    expect(projection.cells.some((cell) => cell.knowledge === 'unknown' && 'previewIntensity' in cell)).toBe(false);
    expect(stableJson(input.floor.knowledge)).toBe(knowledgeBefore);
    expect(stableJson(input.illumination)).toBe(illuminationBefore);
  });

  it('keeps preview bytes unchanged when unseen authoritative terrain changes', () => {
    const corridorTiles = Array<TileId>(width * height).fill(0);
    for (let x = 1; x < width - 1; x += 1) corridorTiles[at(x, 3)] = 1;
    const corridorHero = { ...hero, x: 1, y: 3, sightRadius: 8 };
    const corridorTorch: LightSource = {
      ...torch,
      location: { type: 'actor', actorId: corridorHero.heroId },
      radius: 1,
    };
    const observedFloor = {
      ...baseFloor([corridorTorch]),
      tiles: corridorTiles,
      ambient: { color: [255, 255, 255] as const, strength: 1 },
    };
    const observed = refreshKnowledge({
      floor: observedFloor,
      hero: corridorHero,
      actors: new Map([[corridorHero.heroId, corridorHero]]),
    });
    const currentHero = { ...corridorHero, sightRadius: 1 };
    const openTiles = [...corridorTiles];
    const closedTiles = [...corridorTiles];
    closedTiles[at(4, 3)] = 2;
    const perceiveCurrent = (currentTiles: readonly TileId[]) => {
      const floor = {
        ...observedFloor,
        tiles: currentTiles,
        ambient: { color: [255, 255, 255] as const, strength: 0 },
        knowledge: observed.knowledge,
      };
      const current = refreshKnowledge({
        floor,
        hero: currentHero,
        actors: new Map([[currentHero.heroId, currentHero]]),
      });
      return {
        floor: { ...floor, knowledge: current.knowledge },
        hero: currentHero,
        visibilityWords: current.visibilityWords,
        illumination: current.illumination,
        preview: { color: [20, 255, 80] as const, radius: 6, strength: 200, falloff: 'linear' as const },
      };
    };

    const openProjection = projectFloor(perceiveCurrent(openTiles));
    const closedProjection = projectFloor(perceiveCurrent(closedTiles));

    expect(openProjection.cells[at(5, 3)]).toMatchObject({
      knowledge: 'remembered', tileId: 1, previewIntensity: 85,
    });
    expect(closedProjection.cells[at(5, 3)]).toMatchObject({
      knowledge: 'remembered', tileId: 1, previewIntensity: 85,
    });
    expect(stableJson(openProjection)).toBe(stableJson(closedProjection));
  });

  it('returns byte-identical projections regardless of authoritative light input order', () => {
    const forward = perceived([torch, fixture]);
    const reverse = perceived([fixture, torch]);

    expect(stableJson(projectFloor(forward))).toBe(stableJson(projectFloor(reverse)));
  });

  it('rejects collocated presented fixtures deterministically', () => {
    const duplicate: LightSource = {
      ...fixture, lightId: 'light.amber', presentation: { glyph: '!', token: 'fixture.amber' },
    };
    const messages = ([first, second]: readonly LightSource[]): string => {
      const input = perceived([torch, first, second]);
      try {
        projectFloor(input);
      } catch (error) {
        return (error as Error).message;
      }
      throw new Error('expected collocated fixtures to be rejected');
    };

    expect(messages([fixture, duplicate])).toBe(messages([duplicate, fixture]));
    expect(messages([fixture, duplicate])).toMatch(/presented fixtures.*cell 30/);
  });

  it('does not mutate inputs and returns fresh nested outputs', () => {
    const input = perceived();
    const before = stableJson({ floor: input.floor, hero: input.hero,
      visibilityWords: input.visibilityWords, illumination: input.illumination });

    const first = projectFloor(input);
    const second = projectFloor(input);

    expect(stableJson({ floor: input.floor, hero: input.hero,
      visibilityWords: input.visibilityWords, illumination: input.illumination })).toBe(before);
    expect(first).not.toBe(second);
    expect(first.cells).not.toBe(second.cells);
    expect(first.cells[at(3, 3)]).not.toBe(second.cells[at(3, 3)]);
    expect(first.cells[at(3, 3)]!.tint).not.toBe(second.cells[at(3, 3)]!.tint);
    expect(first.cells[at(3, 3)]!.fixture).not.toBe(second.cells[at(3, 3)]!.fixture);
  });

  it('rejects malformed, mismatched, and sparse derived fields', () => {
    const input = perceived();
    const sparseIntensity = [...input.illumination.intensity];
    delete sparseIntensity[4];
    const mismatchedVisibility = [...input.visibilityWords];
    mismatchedVisibility[0] = (mismatchedVisibility[0]! ^ 1) >>> 0;
    const mismatchedIntensity = [...input.illumination.intensity];
    mismatchedIntensity[0] = mismatchedIntensity[0] === 0 ? 1 : 0;

    expect(() => projectFloor({ ...input, visibilityWords: [] })).toThrow(/visibility/);
    expect(() => projectFloor({ ...input, visibilityWords: mismatchedVisibility })).toThrow(/hero field of view/);
    expect(() => projectFloor({ ...input, illumination: { ...input.illumination, intensity: sparseIntensity } })).toThrow(/intensity 4/);
    expect(() => projectFloor({ ...input, illumination: {
      ...input.illumination, intensity: mismatchedIntensity,
    } })).toThrow(/intensity 0.*RGB/);
    expect(() => projectFloor({
      ...input,
      floor: { ...input.floor, knowledge: createUnknownKnowledge(width * height) },
    })).toThrow(/refreshed knowledge/);
    expect(() => projectFloor({ ...input, preview: {
      color: [1, 2, 3], radius: 0, strength: 1, falloff: 'linear',
    } })).toThrow(/radius/);
  });
});

function monsterDefinition(id: string): MonsterContentEntry {
  return {
    kind: 'monster', id, name: id, glyph: 'm', color: '#aa4444', tags: [], minDepth: 1, maxDepth: 20,
    attributes: { might: 5, agility: 5, vitality: 5, wits: 5, resolve: 5 }, health: 10, speed: 100,
    accuracy: 1, defense: 8, perception: 8, damage: { count: 1, sides: 1, bonus: 0 }, armor: 0,
    resistances: { physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0, arcane: 0 },
    disposition: 'hostile', behaviorId: 'behavior.approach-and-attack', behaviorParameters: {},
    runAppearanceChance: 1, rarity: 'common',
  };
}

describe('gameplay projection', () => {
  it('includes hero resources and visible actors without private scheduler or random state', () => {
    const base = createDemoRun();
    const visible = { ...base.actors[0]!, actorId: 'monster.visible', contentId: 'monster.visible',
      playerControlled: false, disposition: 'hostile' as const, x: 2, y: 1 };
    const hidden = { ...visible, actorId: 'monster.hidden', contentId: 'monster.hidden', x: 5, y: 3 };
    const content = { ...createDemoContentPack(), entries: [
      ...createDemoContentPack().entries, monsterDefinition(visible.contentId), monsterDefinition(hidden.contentId),
    ] };
    const json = stableJson(projectGameplayState({ state: { ...base, actors: [base.actors[0]!, visible, hidden] }, content }));

    expect(json).toContain('monster.visible');
    expect(json).toContain('hungerStage');
    expect(json).not.toContain('monster.hidden');
    expect(json).not.toContain('appearanceByContentId');
    expect(json).not.toContain('reactionReady');
    expect(json).not.toContain('rng');
    expect(json).not.toContain('energy');
  });

  it('projects only a visible aggression target', () => {
    const base = createDemoRun();
    const target = { ...base.actors[0]!, actorId: 'monster.hidden', contentId: 'monster.hidden',
      playerControlled: false, disposition: 'neutral' as const, x: 5, y: 3 };
    const content = { ...createDemoContentPack(), entries: [
      ...createDemoContentPack().entries, monsterDefinition(target.contentId),
    ] };
    expect(projectDecision({ state: { ...base, actors: [base.actors[0]!, target] }, content,
      decision: { type: 'confirm-aggression', targetActorId: target.actorId } })).toBeUndefined();
  });

  it('is unchanged when only hidden actors and random streams differ', () => {
    const base = createDemoRun();
    const hidden = { ...base.actors[0]!, actorId: 'monster.hidden', contentId: 'monster.hidden',
      playerControlled: false, disposition: 'hostile' as const, x: 5, y: 3 };
    const content = { ...createDemoContentPack(), entries: [
      ...createDemoContentPack().entries, monsterDefinition(hidden.contentId),
    ] };
    const left = projectGameplayState({ state: base, content });
    const right = projectGameplayState({ state: { ...base, actors: [...base.actors, hidden],
      rng: { ...base.rng, combat: [44, 55, 66, 77] } }, content });
    expect(stableJson(left)).toBe(stableJson(right));
  });
});
