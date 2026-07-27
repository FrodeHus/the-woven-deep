import { describe, expect, it } from 'vitest';
import { parseAtlas } from './atlas.js';
import raw from '../../../public/playfield/atlas-dungeon.json' with { type: 'json' };

describe('parseAtlas', () => {
  it('parses the committed atlas into typed rects', () => {
    const atlas = parseAtlas(raw);
    expect(atlas.floors).toHaveLength(7);
    expect(atlas.walls).toHaveLength(6);
    expect(atlas.rounded).toHaveLength(8);
    expect(atlas.stairs).toEqual({ x: 1059, y: 661, w: 160, h: 133 });
    expect(atlas.blockDepthPx).toBe(34);
  });
  it('throws on malformed input', () => {
    expect(() => parseAtlas({ image: 'x.png' })).toThrow();
  });
});
