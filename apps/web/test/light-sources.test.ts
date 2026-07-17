import { describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import type { GameplayProjection, ObservableCell } from '@woven-deep/engine';
import { equippedLightSource, fixtureLightsFor } from '../src/ui/light-sources.js';

const PITCH_TORCH_LIGHT = {
  color: [255, 154, 68] as const, radius: 5, strength: 220,
  fuelCapacity: 800, fuelPerTime: 2, warningThresholds: [200, 80], fuelTags: [],
};

function pack(entries: readonly Record<string, unknown>[]): CompiledContentPack {
  return {
    schemaVersion: 5, hash: 'hash.test', entries, generationReport: { foundationalCategories: [] },
  } as unknown as CompiledContentPack;
}

function emptyCell(index: number, x: number, y: number, extra: Partial<ObservableCell> = {}): ObservableCell {
  return { index, x, y, knowledge: 'unknown', intensity: 0, ...extra };
}

function makeProjection(input: Readonly<{
  heroX: number; heroY: number;
  equipment?: Record<string, unknown>;
  cells?: readonly ObservableCell[];
}>): GameplayProjection {
  const width = 20; const height = 10;
  const cells: ObservableCell[] = input.cells
    ? [...input.cells]
    : (() => {
      const generated: ObservableCell[] = [];
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) generated.push(emptyCell(y * width + x, x, y));
      }
      return generated;
    })();
  return {
    floor: { floorId: 'floor.one', width, height, cells },
    hero: {
      actorId: 'actor.hero', name: 'Ada', x: input.heroX, y: input.heroY,
      equipment: input.equipment ?? {},
    },
    actors: [], features: [], groundItems: [], actions: [],
    metrics: {} as GameplayProjection['metrics'],
    conclusion: null,
  } as unknown as GameplayProjection;
}

describe('equippedLightSource', () => {
  it('resolves undefined when the hero has no enabled equipped light', () => {
    const projection = makeProjection({ heroX: 5, heroY: 5 });
    expect(equippedLightSource(projection, pack([]))).toBeUndefined();
  });

  it('resolves the equipped light item, scaled by remaining fuel, plus its authored strength', () => {
    const projection = makeProjection({
      heroX: 5, heroY: 5,
      equipment: { 'off-hand': { contentId: 'item.pitch-torch', enabled: true, fuel: 400 } },
    });
    const contentPack = pack([{ id: 'item.pitch-torch', kind: 'item', light: PITCH_TORCH_LIGHT }]);
    const light = equippedLightSource(projection, contentPack);
    expect(light).toEqual({
      contentId: 'item.pitch-torch', color: [255, 154, 68], radius: 5, fuelFraction: 0.5, strength: 220,
    });
  });

  it('ignores an equipped item that is not enabled', () => {
    const projection = makeProjection({
      heroX: 5, heroY: 5,
      equipment: { 'off-hand': { contentId: 'item.pitch-torch', enabled: false, fuel: 400 } },
    });
    const contentPack = pack([{ id: 'item.pitch-torch', kind: 'item', light: PITCH_TORCH_LIGHT }]);
    expect(equippedLightSource(projection, contentPack)).toBeUndefined();
  });
});

const LAMP_VAULT = {
  id: 'vault.town', kind: 'vault', legend: {
    L: {
      terrain: 'floor', entrance: false, slot: null,
      light: {
        idSuffix: 'lamp', glyph: '1', presentationToken: 'fixture.lamp',
        color: [255, 179, 71], radius: 6, strength: 180, enabled: true,
      },
    },
  },
};

describe('fixtureLightsFor', () => {
  it('maps a visible town lamp cell to its legend light spec', () => {
    const cells: ObservableCell[] = [
      emptyCell(0, 3, 4, {
        knowledge: 'visible', fixture: { lightId: 'light.lamp-1', glyph: '1', token: 'fixture.lamp' },
      }),
    ];
    const projection = makeProjection({ heroX: 0, heroY: 0, cells });
    const lights = fixtureLightsFor(projection, pack([LAMP_VAULT]));
    expect(lights).toEqual([{ x: 3, y: 4, color: [255, 179, 71], radius: 6, strength: 180 }]);
  });

  it('excludes a fixture whose cell is only remembered, not currently visible', () => {
    const cells: ObservableCell[] = [
      emptyCell(0, 3, 4, {
        knowledge: 'remembered', fixture: { lightId: 'light.lamp-1', glyph: '1', token: 'fixture.lamp' },
      }),
    ];
    const projection = makeProjection({ heroX: 0, heroY: 0, cells });
    expect(fixtureLightsFor(projection, pack([LAMP_VAULT]))).toEqual([]);
  });

  it('excludes a visible cell with no fixture', () => {
    const cells: ObservableCell[] = [emptyCell(0, 3, 4, { knowledge: 'visible' })];
    const projection = makeProjection({ heroX: 0, heroY: 0, cells });
    expect(fixtureLightsFor(projection, pack([LAMP_VAULT]))).toEqual([]);
  });
});
