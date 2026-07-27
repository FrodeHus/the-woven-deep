import { describe, expect, it } from 'vitest';
import { parseAtlas } from './atlas.js';
import raw from '../../../public/playfield/atlas-unified.json' with { type: 'json' };

describe('parseAtlas', () => {
  it('parses the committed unified atlas into typed rects', () => {
    const atlas = parseAtlas(raw);
    expect(atlas.imageUrl).toBe('/playfield/tiles.png');
    expect(atlas.blockDepthPx).toBe(48);
    expect(atlas.floors).toHaveLength(8);
    expect(atlas.dirty).toHaveLength(8);
    expect(atlas.walls).toHaveLength(6);
    expect(atlas.weaveWalls).toHaveLength(2);
    expect(atlas.rounded).toHaveLength(8);
    // Grid-derived cells: column c, row r slices as [c*128, r*128, 128, 128].
    expect(atlas.floors[0]).toEqual({ x: 0, y: 0, w: 128, h: 128 });
    expect(atlas.stairs).toEqual({ x: 0, y: 512, w: 128, h: 128 }); // down (row 4, col 0)
    expect(atlas.stairsUp).toEqual({ x: 128, y: 512, w: 128, h: 128 }); // up (row 4, col 1)
    expect(atlas.door).toEqual({ x: 256, y: 512, w: 128, h: 128 });
    // Town keys (row 5): cobbles, timber walls, house door, dungeon-entrance surround.
    expect(atlas.townFloors).toHaveLength(2);
    expect(atlas.townWalls).toHaveLength(2);
    expect(atlas.houseDoor).toEqual({ x: 512, y: 640, w: 128, h: 128 });
    expect(atlas.entranceSurround).toEqual({ x: 640, y: 640, w: 128, h: 128 });
  });

  it('throws on malformed input', () => {
    expect(() => parseAtlas({ image: 'x.png' })).toThrow();
  });

  it('throws when stairsUp is missing', () => {
    const { stairsUp: _omitted, ...withoutStairsUp } = raw as Record<string, unknown>;
    expect(() => parseAtlas(withoutStairsUp)).toThrow(/stairsUp/);
  });

  it('throws when a town key is missing', () => {
    const { entranceSurround: _omitted, ...withoutEntrance } = raw as Record<string, unknown>;
    expect(() => parseAtlas(withoutEntrance)).toThrow(/entranceSurround/);
  });
});
