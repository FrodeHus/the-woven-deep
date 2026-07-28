import { describe, expect, it } from 'vitest';
import { parseActorAtlas, parseAtlas, parseItemAtlas } from './atlas.js';
import raw from '../../../public/playfield/atlas-unified.json' with { type: 'json' };
import actorsRaw from '../../../public/playfield/atlas-actors.json' with { type: 'json' };
import itemsRaw from '../../../public/playfield/atlas-items.json' with { type: 'json' };

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

  it('parses waresCrate (the chest crop) and leaves it undefined when absent', () => {
    expect(parseAtlas(raw).waresCrate).toEqual({ x: 816, y: 978, w: 107, h: 129 });
    const { waresCrate: _omitted, ...withoutCrate } = raw as Record<string, unknown>;
    expect(parseAtlas(withoutCrate).waresCrate).toBeUndefined();
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

describe('parseActorAtlas', () => {
  it('parses the committed actor atlas: 52 contentId-keyed rects', () => {
    const atlas = parseActorAtlas(actorsRaw);
    expect(atlas.imageUrl).toBe('/playfield/actors.png');
    // 6 hero/townsfolk + 46 monsters = 52 keys.
    expect(Object.keys(atlas.sprites)).toHaveLength(52);
    const monsterKeys = Object.keys(atlas.sprites).filter((id) => id.startsWith('monster.'));
    expect(monsterKeys).toHaveLength(46);
    // Spot-check the hero, a townsfolk, a row-1 vermin, and a split-out LARGE boss.
    expect(atlas.sprites['hero.adventurer']).toEqual({ x: 35, y: 39, w: 112, h: 158 });
    expect(atlas.sprites['npc.town-spellvendor']).toEqual({ x: 654, y: 41, w: 90, h: 155 });
    expect(atlas.sprites['monster.cave-rat']).toEqual({ x: 37, y: 234, w: 120, h: 109 });
    expect(atlas.sprites['monster.tide-revenant']).toEqual({ x: 647, y: 838, w: 117, h: 159 });
    expect(atlas.sprites['monster.weakened-heart']).toEqual({ x: 806, y: 1095, w: 162, h: 156 });
  });

  it('throws on a missing actors record or a malformed rect', () => {
    expect(() => parseActorAtlas({ image: 'actors.png' })).toThrow(/actors/);
    expect(() => parseActorAtlas({ image: 'actors.png', actors: { x: [1, 2, 3] } })).toThrow();
  });
});

describe('parseItemAtlas', () => {
  it('parses the committed item atlas: 31 keys incl. the generic/currency slots', () => {
    const atlas = parseItemAtlas(itemsRaw);
    expect(atlas.imageUrl).toBe('/playfield/items.png');
    // 25 dedicated item ids + 6 generic/currency fallback slots.
    expect(Object.keys(atlas.sprites)).toHaveLength(31);
    expect(atlas.sprites['item.iron-sword']).toEqual({ x: 30, y: 26, w: 153, h: 141 });
    expect(atlas.sprites['item.echo-heartstone']).toEqual({ x: 985, y: 1039, w: 96, h: 98 });
    for (const slot of [
      'GENERIC-POTION',
      'GENERIC-SCROLL',
      'GENERIC-TOME',
      'GENERIC-TOME-ORNATE',
      'GOLD-COINS',
      'GOLD-POUCH',
    ]) {
      expect(atlas.sprites[slot]).toBeDefined();
    }
  });

  it('throws on a missing items record', () => {
    expect(() => parseItemAtlas({ image: 'items.png' })).toThrow(/items/);
  });
});
