import { describe, expect, it } from 'vitest';
import type { ObservableCell } from '@woven-deep/engine';
import {
  cellDarkness,
  isFogMaskedTier,
  lightPoolDiameterPx,
  lightsForFloor,
  visibleBrightness,
  VISIBLE_FLOOR_BRIGHTNESS,
  type LightSpec,
} from './light-layer.js';
import { TILE_HALF_W } from './iso-math.js';

function cell(
  input: Partial<ObservableCell> & { index: number; x: number; y: number },
): ObservableCell {
  return {
    knowledge: 'visible',
    intensity: 0,
    ...input,
  };
}

function fixtureCell(index: number, x: number, y: number): ObservableCell {
  return cell({
    index,
    x,
    y,
    fixture: { lightId: `light.${index}`, glyph: '*', token: 'fixture.lamp' },
  });
}

describe('cellDarkness', () => {
  it('maps full intensity to no darkening and zero intensity to full darkness', () => {
    expect(cellDarkness(255)).toBe(0);
    expect(cellDarkness(0)).toBe(1);
  });

  it('clamps out-of-range intensities to the [0, 1] alpha band', () => {
    expect(cellDarkness(300)).toBe(0);
    expect(cellDarkness(-50)).toBe(1);
  });

  it('is monotonic decreasing in intensity', () => {
    const samples = [0, 40, 80, 120, 160, 200, 255];
    for (let i = 1; i < samples.length; i += 1) {
      expect(cellDarkness(samples[i]!)).toBeLessThan(cellDarkness(samples[i - 1]!));
    }
  });
});

describe('visibleBrightness', () => {
  it('floors an unlit visible cell above black and reaches full brightness when fully lit', () => {
    expect(visibleBrightness(0)).toBe(VISIBLE_FLOOR_BRIGHTNESS);
    expect(visibleBrightness(255)).toBe(1);
  });

  it('never drops a visible cell to (or below) the remembered gray brightness (~0.29)', () => {
    // The bug being guarded: a torch-rim visible cell (single-digit intensity) must not read darker
    // than remembered terrain further out.
    for (const intensity of [0, 1, 5, 20, 80, 200, 255]) {
      expect(visibleBrightness(intensity)).toBeGreaterThan(0.29);
    }
  });

  it('is monotonic increasing in intensity', () => {
    const samples = [0, 40, 80, 120, 160, 200, 255];
    for (let i = 1; i < samples.length; i += 1) {
      expect(visibleBrightness(samples[i]!)).toBeGreaterThan(visibleBrightness(samples[i - 1]!));
    }
  });

  it('clamps out-of-range intensity to the floor..1 band', () => {
    expect(visibleBrightness(-10)).toBe(VISIBLE_FLOOR_BRIGHTNESS);
    expect(visibleBrightness(400)).toBe(1);
  });
});

describe('isFogMaskedTier', () => {
  it('overpaints non-visible tiers opaque so light pools never leak past the fog boundary', () => {
    expect(isFogMaskedTier('unknown')).toBe(true);
    expect(isFogMaskedTier('remembered')).toBe(true);
  });

  it('never overpaints a visible cell (it keeps floor brightness + additive pools)', () => {
    expect(isFogMaskedTier('visible')).toBe(false);
  });
});

describe('lightPoolDiameterPx', () => {
  it('converts a tile radius to a pixel diameter of radius * 2 * TILE_HALF_W', () => {
    expect(lightPoolDiameterPx(5)).toBe(5 * TILE_HALF_W * 2);
    expect(lightPoolDiameterPx(5)).toBe(320); // TILE_HALF_W === 32
    expect(lightPoolDiameterPx(7)).toBe(448);
    expect(lightPoolDiameterPx(0)).toBe(0);
  });
});

describe('lightsForFloor', () => {
  const hero = { x: 5, y: 6, lightRadius: 7 };

  it('emits one fixture light per fixture cell plus one hero light', () => {
    const cells = [fixtureCell(0, 1, 1), cell({ index: 1, x: 2, y: 2 }), fixtureCell(2, 3, 3)];
    const lights = lightsForFloor(cells, hero);
    expect(lights).toHaveLength(3); // two fixtures + hero
  });

  it('places the hero light last, at the hero cell, with the given radius', () => {
    const lights = lightsForFloor([fixtureCell(0, 1, 1)], hero);
    const heroLight = lights[lights.length - 1]!;
    expect(heroLight.x).toBe(hero.x);
    expect(heroLight.y).toBe(hero.y);
    expect(heroLight.radius).toBe(hero.lightRadius);
  });

  it('positions each fixture light at its cell', () => {
    const lights = lightsForFloor([fixtureCell(0, 4, 8)], hero);
    const fixture = lights[0]!;
    expect(fixture.x).toBe(4);
    expect(fixture.y).toBe(8);
    expect(fixture.radius).toBeGreaterThan(0);
  });

  it('produces deterministic flicker seeds for the same cells', () => {
    const cells = [fixtureCell(0, 1, 1), fixtureCell(1, 9, 2)];
    const first = lightsForFloor(cells, hero).map((light: LightSpec) => light.flickerSeed);
    const second = lightsForFloor(cells, hero).map((light: LightSpec) => light.flickerSeed);
    expect(second).toEqual(first);
  });

  it('gives distinct fixture cells distinct flicker seeds', () => {
    const lights = lightsForFloor([fixtureCell(0, 1, 1), fixtureCell(1, 9, 2)], hero);
    expect(lights[0]!.flickerSeed).not.toBe(lights[1]!.flickerSeed);
  });
});
