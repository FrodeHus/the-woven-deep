import { describe, expect, it } from 'vitest';
import type { ObservableCell } from '@woven-deep/engine';
import { cellDarkness, lightsForFloor, type LightSpec } from './light-layer.js';

function cell(input: Partial<ObservableCell> & { index: number; x: number; y: number }): ObservableCell {
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

describe('lightsForFloor', () => {
  const hero = { x: 5, y: 6, lightRadius: 7 };

  it('emits one fixture light per fixture cell plus one hero light', () => {
    const cells = [
      fixtureCell(0, 1, 1),
      cell({ index: 1, x: 2, y: 2 }),
      fixtureCell(2, 3, 3),
    ];
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
