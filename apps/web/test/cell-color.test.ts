import { describe, expect, it } from 'vitest';
import { relativeLuminance, visibleForeground } from '../src/ui/cell-color.js';

/**
 * `.cell-remembered`'s static color in `styles.css` -- reproduced as a literal here (not imported,
 * since this is a pure-TS test with no stylesheet parsing) so this suite pins the exact regression
 * the bug report was about: a `.cell-visible` glyph must never render darker than this gray, even
 * at the light-radius rim where `intensity` bottoms out to single digits and `tint` goes near-black.
 */
const REMEMBERED_GRAY: readonly [number, number, number] = [0x4b, 0x52, 0x6b];
const REMEMBERED_LUMINANCE = relativeLuminance(REMEMBERED_GRAY);

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

function parseRgb(css: string): readonly [number, number, number] {
  const match = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(css);
  if (!match) throw new Error(`not an rgb(...) string: ${css}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
