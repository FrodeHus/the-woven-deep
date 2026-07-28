import { describe, expect, it } from 'vitest';
import { parseAtlas } from './atlas.js';
import raw from '../../../public/playfield/atlas-unified.json' with { type: 'json' };

describe('parseAtlas', () => {
  it('parses the committed unified atlas into typed rects', () => {
    const atlas = parseAtlas(raw);
    expect(atlas.imageUrl).toBe('/playfield/tiles.png');
    expect(atlas.blockDepthPx).toBe(80);
    expect(atlas.floors).toHaveLength(7);
    expect(atlas.dirty).toHaveLength(7);
    expect(atlas.walls).toHaveLength(6);
    expect(atlas.weaveWalls).toHaveLength(1);
    // 7 boulder pieces plus a duplicate filling the 8th lone-wall topology slot.
    expect(atlas.rounded).toHaveLength(8);
    expect(atlas.rounded[7]).toEqual(atlas.rounded[6]);
    // Measured (auto-sliced) rects, not grid cells: tight bounding boxes on an uneven pitch.
    expect(atlas.floors[0]).toEqual({ x: 14, y: 39, w: 151, h: 94 });
    expect(atlas.stairs).toEqual({ x: 10, y: 669, w: 160, h: 95 }); // down-well (row 4, col 0)
    expect(atlas.stairsUp).toEqual({ x: 189, y: 637, w: 127, h: 145 }); // up (row 4, col 1)
    expect(atlas.door).toEqual({ x: 364, y: 638, w: 109, h: 139 });
    // Town keys (row 5): cobbles, timber walls, house door, dungeon-entrance surround.
    expect(atlas.townFloors).toHaveLength(2);
    expect(atlas.townWalls).toHaveLength(2);
    expect(atlas.houseDoor).toEqual({ x: 665, y: 809, w: 96, h: 130 });
    expect(atlas.entranceSurround).toEqual({ x: 808, y: 801, w: 140, h: 151 });
  });

  it('leaves archOpen undefined when absent (current sheet) but parses it when present', () => {
    expect(parseAtlas(raw).archOpen).toBeUndefined();
    const withArch = { ...(raw as Record<string, unknown>), archOpen: [1, 2, 3, 4] };
    expect(parseAtlas(withArch).archOpen).toEqual({ x: 1, y: 2, w: 3, h: 4 });
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
