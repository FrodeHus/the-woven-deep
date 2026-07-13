import { describe, expect, it } from 'vitest';
import { classicMask, createClassicTheme, maskHas, validateThemeMask } from '../src/index.js';

function words(width: number, height: number, cells: readonly (readonly [number, number])[]): number[] {
  const result = Array(Math.ceil(width * height / 32)).fill(0) as number[];
  for (const [x, y] of cells) result[(y * width + x) >>> 5]! |= (1 << ((y * width + x) & 31)) >>> 0;
  return result.map((word) => word >>> 0);
}

describe('generation masks', () => {
  it('creates a classic mask with an excluded outer border', () => {
    const mask = classicMask(20, 12);
    expect(mask).toHaveLength(Math.ceil(20 * 12 / 32));
    for (let y = 0; y < 12; y += 1) for (let x = 0; x < 20; x += 1) {
      expect(maskHas(mask, 20, x, y)).toBe(x > 0 && x < 19 && y > 0 && y < 11);
    }
    expect(mask.at(-1)! >>> (240 & 31)).toBe(0);
  });

  it('accepts one connected irregular interior component', () => {
    const cells = Array.from({ length: 10 }, (_, y) =>
      Array.from({ length: 18 }, (_, x) => [x + 1, y + 1] as const),
    ).flat().filter(([x, y]) => !(x > 12 && y < 5));
    const validation = validateThemeMask(20, 12, words(20, 12, cells), 2, 10);
    expect(validation.cellCount).toBe(cells.length);
    expect(validation.componentStart).toBe(21);
  });

  it('rejects wrong word counts, padding, border cells, disconnected regions, and too few cells', () => {
    const valid = classicMask(20, 12);
    expect(() => validateThemeMask(20, 12, valid.slice(1), 1, 1)).toThrow();
    const sparse = [...valid]; delete sparse[sparse.length - 1];
    expect(() => validateThemeMask(20, 12, sparse, 1, 1)).toThrow();
    const padded = [...valid]; padded[padded.length - 1] = 0x8000_0000;
    expect(() => validateThemeMask(20, 12, padded, 1, 1)).toThrow();
    expect(() => validateThemeMask(20, 12, words(20, 12, [[0, 1], [1, 1], [2, 1]]), 1, 1)).toThrow();
    expect(() => validateThemeMask(20, 12, words(20, 12, [[1, 1], [2, 1], [17, 10], [18, 10]]), 1, 1)).toThrow();
    expect(() => validateThemeMask(20, 12, words(20, 12, [[1, 1], [2, 1]]), 6, 20)).toThrow();
  });

  it.each([
    null,
    {},
    { ambient: null },
    { ambient: {} },
    { ambient: { color: null, strength: 1 } },
    { ambient: { color: '000', strength: 1 } },
    { ambient: { color: [0, 0, 0], strength: 1 } },
  ])('rejects malformed classic settings with a safe generation error', (settings) => {
    if (settings && typeof settings === 'object' && 'ambient' in settings) {
      const ambient = (settings as { ambient?: { color?: unknown[] } }).ambient;
      if (ambient?.color && Array.isArray(ambient.color)) delete ambient.color[1];
    }
    expect(() => createClassicTheme(20, 12, settings as never)).toThrowError(
      expect.objectContaining({ code: 'generation.invalid-theme' }),
    );
  });
});
