import { describe, expect, it } from 'vitest';
import { MATERIAL_BASE_RGB, relativeLuminance, visibleForeground } from '../src/ui/cell-color.js';

/**
 * `.cell-remembered`'s static color in `styles.css` -- reproduced as a literal here (not imported,
 * since this is a pure-TS test with no stylesheet parsing) so this suite pins the exact regression
 * the bug report was about: a `.cell-visible` glyph must never render darker than this gray, even
 * at the light-radius rim where `intensity` bottoms out to single digits and `tint` goes near-black.
 */
const REMEMBERED_GRAY: readonly [number, number, number] = [0x4b, 0x52, 0x6b];
const REMEMBERED_LUMINANCE = relativeLuminance(REMEMBERED_GRAY);

/**
 * `FLOOR_RGB` in `cell-color.ts` -- reproduced as a literal here (it isn't exported) so the property
 * tests below can assert against the exact floor the implementation targets, not just "above
 * remembered". Do not let the two drift.
 */
const FLOOR_RGB: readonly [number, number, number] = [100, 106, 130];
const FLOOR_LUMINANCE = relativeLuminance(FLOOR_RGB);

/** A representative warm torch tint -- the color the engine reports for a lit, gold-ish light
 * source, sampled at full brightness. Used to check the blend stays gold-ish (not washed out to
 * gray) at healthy intensity, and never dips below the remembered floor as intensity climbs. */
const TORCH_TINT: readonly [number, number, number] = [255, 200, 100];

describe('visibleForeground', () => {
  it('floors the output above the remembered gray even at the lowest visible intensity', () => {
    // Near-black tint, as the engine reports right at a torch's radius edge.
    const rimTint: readonly [number, number, number] = [4, 3, 2];
    const output = visibleForeground(rimTint, 1);
    const [r, g, b] = parseRgb(output);
    expect(relativeLuminance([r, g, b])).toBeGreaterThan(REMEMBERED_LUMINANCE);
  });

  it('is monotone non-decreasing in intensity for a fixed tint', () => {
    const samples = [0, 1, 8, 32, 64, 128, 192, 255];
    const luminances = samples.map((intensity) => relativeLuminance(parseRgb(visibleForeground(TORCH_TINT, intensity))));
    for (let i = 1; i < luminances.length; i += 1) {
      expect(luminances[i]).toBeGreaterThanOrEqual(luminances[i - 1]!);
    }
  });

  it('renders the tint verbatim (identity) at full intensity, so a gold torch rim stays gold', () => {
    const output = visibleForeground(TORCH_TINT, 255);
    expect(parseRgb(output)).toEqual(TORCH_TINT);
  });

  it('still reads as warm (red channel clearly above blue) at a healthy mid intensity, never washed to neutral gray', () => {
    const [r, , b] = parseRgb(visibleForeground(TORCH_TINT, 160));
    expect(r).toBeGreaterThan(b);
  });

  it('clamps intensity to the 0..255 range rather than producing an out-of-gamut blend', () => {
    const atZero = parseRgb(visibleForeground(TORCH_TINT, -50));
    const atMax = parseRgb(visibleForeground(TORCH_TINT, 999));
    for (const channel of [...atZero, ...atMax]) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(255);
    }
    expect(parseRgb(visibleForeground(TORCH_TINT, -50))).toEqual(parseRgb(visibleForeground(TORCH_TINT, 0)));
    expect(parseRgb(visibleForeground(TORCH_TINT, 999))).toEqual(parseRgb(visibleForeground(TORCH_TINT, 255)));
  });
});

describe('relativeLuminance', () => {
  it('ranks pure white above pure black', () => {
    expect(relativeLuminance([255, 255, 255])).toBeGreaterThan(relativeLuminance([0, 0, 0]));
  });
});

/**
 * Property-style coverage for the "floor + monotone, ALL tints" constraint. `TORCH_TINT` above is
 * warm, and warm is all that's authored in content today -- but the floor is documented as a
 * hue-independent guarantee, so it has to hold for cool/blue-dominant tints too, even though no
 * such light exists yet. A pure-blue tint is the adversarial case: blue contributes only 7.22% to
 * relative luminance (vs. 21.26% red / 71.52% green), so a naive blend toward a blue tint can drop
 * luminance well under the floor -- and even fully-saturated blue at intensity 255 can't reach the
 * floor by itself, forcing the "clip, then mix toward white" fallback to run.
 */
const TINT_GRID: readonly RgbGridEntry[] = [
  ['pure blue', [0, 0, 255]],
  ['pure red', [255, 0, 0]],
  ['near-black', [0, 0, 10]],
  ['white', [255, 255, 255]],
  ['content torch (ashen-potion-ish warm)', [255, 179, 71]],
  ['content torch (mid-warm)', [255, 200, 100]],
];

type RgbGridEntry = readonly [string, readonly [number, number, number]];

const INTENSITY_GRID = [0, 1, 8, 32, 64, 128, 160, 192, 255];

describe('visibleForeground floor + monotonicity (all hues)', () => {
  for (const [label, tint] of TINT_GRID) {
    it(`holds the luminance floor for every intensity: ${label}`, () => {
      for (const intensity of INTENSITY_GRID) {
        const output = parseRgb(visibleForeground(tint, intensity));
        expect(relativeLuminance(output)).toBeGreaterThanOrEqual(FLOOR_LUMINANCE - 1e-9);
      }
    });

    it(`is monotone non-decreasing in intensity: ${label}`, () => {
      // Output channels are quantized to 8-bit integers, so two intensities that both land "at
      // the floor" can differ by a rounding unit or two per channel even though the underlying
      // continuous target luminance is identical -- that's sub-perceptual quantization noise, not
      // a regression. QUANTIZATION_NOISE bounds how much wobble that noise can produce; the check
      // still catches the real bug, which was luminance dropping by tens of percent, not a
      // fraction of a percent.
      const QUANTIZATION_NOISE = 0.004;
      const luminances = INTENSITY_GRID.map((intensity) => relativeLuminance(parseRgb(visibleForeground(tint, intensity))));
      for (let i = 1; i < luminances.length; i += 1) {
        expect(luminances[i]).toBeGreaterThanOrEqual(luminances[i - 1]! - QUANTIZATION_NOISE);
      }
    });
  }

  it('is exact identity at intensity 255 for a tint whose own luminance already clears the floor', () => {
    const output = parseRgb(visibleForeground(TORCH_TINT, 255));
    expect(output).toEqual(TORCH_TINT);
  });

  it('is a no-op change for the default (no base argument) call site vs. an explicit FLOOR_RGB base', () => {
    expect(visibleForeground(TORCH_TINT, 160)).toBe(visibleForeground(TORCH_TINT, 160, FLOOR_RGB));
  });

  it('stays close to the previous (unfloored) blend for warm tints at sub-max intensity', () => {
    // The warm domain was just eyeballed in-browser per the Task 10 recipe -- the fix must not
    // perceptibly shift it. Compare against the plain linear blend (the pre-fix formula) at a mid
    // intensity: for a warm tint the blend already clears the floor unaided, so the fix should be a
    // no-op here and the delta should be ~0, not just "small".
    const intensity = 160;
    const t = intensity / 255;
    const floorRgb: readonly [number, number, number] = [100, 106, 130];
    const oldBlend = floorRgb.map((f, index) => Math.round(f + t * (TORCH_TINT[index]! - f)));
    const newOutput = parseRgb(visibleForeground(TORCH_TINT, intensity));
    for (let i = 0; i < 3; i += 1) {
      expect(Math.abs(newOutput[i]! - oldBlend[i]!)).toBeLessThanOrEqual(1);
    }
  });
});

/**
 * Extends the "floor + monotone, ALL tints" property tests above over every material base
 * (`MATERIAL_BASE_RGB`, `cell-color.ts` -- mirrored from `styles.css`'s `--mat-*` custom
 * properties). `wall` is the adversarial case here: it is deliberately blue-leaning (mineral
 * blue-grey, per the Living Tapestry direction), and blue contributes only 7.22% to relative
 * luminance, so it is the material most likely to expose a regression in the floor guarantee if a
 * future change ever special-cased `FLOOR_RGB` instead of the generic `base` parameter.
 */
describe('visibleForeground floor + monotonicity (all material bases)', () => {
  for (const [materialName, base] of Object.entries(MATERIAL_BASE_RGB)) {
    for (const [tintLabel, tint] of TINT_GRID) {
      it(`holds the luminance floor for every intensity: material=${materialName}, tint=${tintLabel}`, () => {
        for (const intensity of INTENSITY_GRID) {
          const output = parseRgb(visibleForeground(tint, intensity, base));
          expect(relativeLuminance(output)).toBeGreaterThanOrEqual(FLOOR_LUMINANCE - 1e-9);
        }
      });
    }

    it(`is monotone non-decreasing in intensity for material=${materialName} under the torch tint`, () => {
      const QUANTIZATION_NOISE = 0.004;
      const luminances = INTENSITY_GRID.map((intensity) => relativeLuminance(parseRgb(visibleForeground(TORCH_TINT, intensity, base))));
      for (let i = 1; i < luminances.length; i += 1) {
        expect(luminances[i]).toBeGreaterThanOrEqual(luminances[i - 1]! - QUANTIZATION_NOISE);
      }
    });

    it(`a fully-dark cell (intensity 0) of material=${materialName} still clears the remembered floor`, () => {
      const output = parseRgb(visibleForeground(TORCH_TINT, 0, base));
      expect(relativeLuminance(output)).toBeGreaterThan(REMEMBERED_LUMINANCE);
    });
  }

  it('the blue-leaning wall material specifically holds the floor even at minimum intensity with a near-black tint', () => {
    const rimTint: readonly [number, number, number] = [4, 3, 2];
    const output = parseRgb(visibleForeground(rimTint, 1, MATERIAL_BASE_RGB.wall));
    expect(relativeLuminance(output)).toBeGreaterThanOrEqual(FLOOR_LUMINANCE - 1e-9);
    expect(relativeLuminance(output)).toBeGreaterThan(REMEMBERED_LUMINANCE);
  });
});

/**
 * The bounded material floor (Task 2's browser-pass fix): a wall/floor/door/stair cell right
 * beside a carried torch must never wash all the way to the tint's own color, losing its material
 * hue entirely -- a plain linear blend reaches exact tint identity at `intensity` 255 for ANY base,
 * which read badly in-browser for the mineral-blue wall specifically (it converged on the same
 * warm torch orange as the floor beside it). `MATERIAL_MAX_BLEND_T` caps the blend fraction at 85%
 * for an explicit material base, so >= 15% of the base's own color always survives -- but the
 * PLAIN (no-material) floor path is exempt, preserving the pre-existing exact-identity-at-255
 * contract asserted elsewhere in this file for an un-parameterized call.
 */
describe('visibleForeground material floor (bounded blend, Task 2)', () => {
  it('does NOT reach the tint verbatim at intensity 255 for a material base whose own color differs from the tint', () => {
    for (const [materialName, base] of Object.entries(MATERIAL_BASE_RGB)) {
      const output = parseRgb(visibleForeground(TORCH_TINT, 255, base));
      expect(output, materialName).not.toEqual(TORCH_TINT);
    }
  });

  it('retains at least 15% of the material base color at intensity 255 (matches the t=0.85-capped blend, pre-floor-lift)', () => {
    for (const [materialName, base] of Object.entries(MATERIAL_BASE_RGB)) {
      const expected = base.map((channel, index) => Math.round(channel + 0.85 * (TORCH_TINT[index]! - channel)));
      const output = parseRgb(visibleForeground(TORCH_TINT, 255, base));
      // liftToFloor may adjust channels further upward if the capped blend still falls under the
      // remembered floor -- allow for that, but the un-lifted target is the capped blend itself.
      for (let i = 0; i < 3; i += 1) {
        expect(output[i]!, `${materialName} channel ${i}`).toBeGreaterThanOrEqual(expected[i]! - 1);
      }
    }
  });

  it('still holds the luminance floor at intensity 255 for every material base, even with the blend capped', () => {
    for (const [materialName, base] of Object.entries(MATERIAL_BASE_RGB)) {
      const output = parseRgb(visibleForeground(TORCH_TINT, 255, base));
      expect(relativeLuminance(output), materialName).toBeGreaterThanOrEqual(FLOOR_LUMINANCE - 1e-9);
    }
  });

  it('is unaffected for the plain (no-material) default base -- exact tint identity at 255 still holds', () => {
    expect(parseRgb(visibleForeground(TORCH_TINT, 255))).toEqual(TORCH_TINT);
    expect(parseRgb(visibleForeground(TORCH_TINT, 255, FLOOR_RGB))).toEqual(TORCH_TINT);
  });

  it('remains monotone non-decreasing in intensity for every material base up to and including the cap', () => {
    const QUANTIZATION_NOISE = 0.004;
    for (const base of Object.values(MATERIAL_BASE_RGB)) {
      const luminances = INTENSITY_GRID.map((intensity) => relativeLuminance(parseRgb(visibleForeground(TORCH_TINT, intensity, base))));
      for (let i = 1; i < luminances.length; i += 1) {
        expect(luminances[i]).toBeGreaterThanOrEqual(luminances[i - 1]! - QUANTIZATION_NOISE);
      }
    }
  });
});

function parseRgb(css: string): readonly [number, number, number] {
  const match = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(css);
  if (!match) throw new Error(`not an rgb(...) string: ${css}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
