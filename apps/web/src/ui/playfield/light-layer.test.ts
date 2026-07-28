import { describe, expect, it } from 'vitest';
import type { ObservableCell } from '@woven-deep/engine';
import {
  buildVoidNoiseField,
  cellDarkness,
  composeTints,
  featureLightTint,
  isFogMaskedTier,
  lightPoolDiameterPx,
  lightsForFloor,
  REMEMBERED_TINT,
  spriteLightTint,
  tintLuminance,
  visibleBrightness,
  VISIBLE_FLOOR_BRIGHTNESS,
  VOID_NOISE_SIZE,
  VOID_ROCK_BRIGHTNESS,
  VOID_ROCK_BRIGHTNESS_VARIATION,
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

describe('spriteLightTint', () => {
  it('renders a fully lit visible cell verbatim (white) and a dark visible cell at the floored gray', () => {
    // Sprites live ABOVE the multiply light-map, so their tint carries the cell light directly.
    expect(spriteLightTint(255)).toBe(0xffffff);
    // floor 0.6 * 255 = 153 = 0x99 per channel -- floored, never black (an actor on a visible cell
    // is never fully dark).
    expect(spriteLightTint(0)).toBe(0x999999);
  });

  it('produces an equal-channel gray for every intensity', () => {
    for (const intensity of [0, 1, 40, 128, 200, 255]) {
      const tint = spriteLightTint(intensity);
      const r = (tint >> 16) & 0xff;
      const g = (tint >> 8) & 0xff;
      const b = tint & 0xff;
      expect(g).toBe(r);
      expect(b).toBe(r);
    }
  });

  it('is monotonic non-decreasing in intensity', () => {
    const samples = [0, 40, 80, 120, 160, 200, 255];
    for (let i = 1; i < samples.length; i += 1) {
      expect(spriteLightTint(samples[i]!)).toBeGreaterThanOrEqual(spriteLightTint(samples[i - 1]!));
    }
    // and strictly brighter across the full span
    expect(spriteLightTint(255)).toBeGreaterThan(spriteLightTint(0));
  });
});

describe('featureLightTint', () => {
  it('tints a remembered feature to the remembered dim gray regardless of intensity', () => {
    expect(featureLightTint('remembered', 255)).toBe(REMEMBERED_TINT);
    expect(featureLightTint('remembered', 0)).toBe(REMEMBERED_TINT);
  });

  it('tints a visible feature by its cell light, matching spriteLightTint', () => {
    expect(featureLightTint('visible', 255)).toBe(spriteLightTint(255));
    expect(featureLightTint('visible', 0)).toBe(spriteLightTint(0));
  });
});

describe('composeTints', () => {
  it('is the identity when the light tint is full white', () => {
    expect(composeTints(0x8a6fd1, 0xffffff)).toBe(0x8a6fd1);
  });

  it('multiplies channel-wise (half-bright light halves each channel)', () => {
    // 0x80/0xff ~= 0.5019; 0xff * that rounds to 0x80, 0x40 * that rounds to 0x20.
    expect(composeTints(0xff4020, 0x808080)).toBe(0x802010);
  });

  it('goes black only when a channel of either tint is zero', () => {
    expect(composeTints(0xffffff, 0x000000)).toBe(0x000000);
    expect(composeTints(0x00ff00, 0xffffff)).toBe(0x00ff00);
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

describe('void-fill rock contrast', () => {
  // The playfield's contrast ladder, pinned so a later tweak to any one tier cannot silently invert
  // it: unexcavated rock reads darkest, remembered terrain sits above it, and a visible cell never
  // drops below its own floor. Compared against the REAL constants, never a duplicated literal.
  it('is strictly darker than remembered terrain, which is darker than the visible floor', () => {
    const remembered = tintLuminance(REMEMBERED_TINT);
    expect(VOID_ROCK_BRIGHTNESS).toBeLessThan(remembered);
    expect(remembered).toBeLessThan(VISIBLE_FLOOR_BRIGHTNESS);
  });

  it('keeps the rock in a barely-there luminance band -- present, but never legible as terrain', () => {
    expect(VOID_ROCK_BRIGHTNESS).toBeGreaterThanOrEqual(0.02);
    expect(VOID_ROCK_BRIGHTNESS).toBeLessThanOrEqual(0.04);
  });

  it('reads a mid gray as brighter than a near-black tint', () => {
    expect(tintLuminance(0x808080)).toBeGreaterThan(tintLuminance(0x0a0a0a));
    expect(tintLuminance(0xffffff)).toBeCloseTo(1, 5);
    expect(tintLuminance(0x000000)).toBe(0);
  });
});

describe('buildVoidNoiseField', () => {
  const SIZE = 32;

  it('is deterministic: the same size always yields byte-identical output', () => {
    const first = buildVoidNoiseField(SIZE);
    const second = buildVoidNoiseField(SIZE);
    expect(Array.from(second)).toEqual(Array.from(first));
  });

  it('produces size*size values, each clamped to [0, 1]', () => {
    const field = buildVoidNoiseField(SIZE);
    expect(field.length).toBe(SIZE * SIZE);
    for (const value of field) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('normalizes into the tight dark band around VOID_ROCK_BRIGHTNESS', () => {
    const field = buildVoidNoiseField(VOID_NOISE_SIZE);
    let mean = 0;
    for (const value of field) mean += value;
    mean /= field.length;
    expect(mean).toBeGreaterThanOrEqual(VOID_ROCK_BRIGHTNESS - VOID_ROCK_BRIGHTNESS_VARIATION);
    expect(mean).toBeLessThanOrEqual(VOID_ROCK_BRIGHTNESS + VOID_ROCK_BRIGHTNESS_VARIATION);

    let variance = 0;
    for (const value of field) variance += (value - mean) * (value - mean);
    const stdDev = Math.sqrt(variance / field.length);
    // A handful of standard deviations wide: barely-there texture, no wild outliers.
    expect(stdDev).toBeLessThanOrEqual(VOID_ROCK_BRIGHTNESS_VARIATION * 1.5);
  });

  it('has no hard edges: adjacent pixels never jump by more than a sliver', () => {
    const field = buildVoidNoiseField(SIZE);
    const maxStep = VOID_ROCK_BRIGHTNESS_VARIATION * 2;
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        const value = field[y * SIZE + x] as number;
        const right = field[y * SIZE + ((x + 1) % SIZE)] as number;
        const down = field[((y + 1) % SIZE) * SIZE + x] as number;
        expect(Math.abs(right - value)).toBeLessThanOrEqual(maxStep);
        expect(Math.abs(down - value)).toBeLessThanOrEqual(maxStep);
      }
    }
  });

  it('tiles seamlessly: the field wraps its own edges with no visible seam', () => {
    // Wrapping column/row 0 and SIZE-1 (adjacent under toroidal tiling) must be as smooth as any
    // interior neighbor pair -- the same bound `has no hard edges` checks internally.
    const field = buildVoidNoiseField(SIZE);
    const maxStep = VOID_ROCK_BRIGHTNESS_VARIATION * 2;
    for (let y = 0; y < SIZE; y += 1) {
      const left = field[y * SIZE] as number;
      const right = field[y * SIZE + SIZE - 1] as number;
      expect(Math.abs(left - right)).toBeLessThanOrEqual(maxStep);
    }
    for (let x = 0; x < SIZE; x += 1) {
      const top = field[x] as number;
      const bottom = field[(SIZE - 1) * SIZE + x] as number;
      expect(Math.abs(top - bottom)).toBeLessThanOrEqual(maxStep);
    }
  });
});
