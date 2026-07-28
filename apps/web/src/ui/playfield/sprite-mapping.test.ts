import { describe, expect, it } from 'vitest';
import type { SpriteAtlas } from './atlas.js';
import { cellSeed } from './tile-skinning.js';
import {
  groundItemHoverOffset,
  HOVER_AMPLITUDE_PX,
  parseColor,
  resolveActorRect,
  resolveFacing,
  resolveItemSprite,
} from './sprite-mapping.js';

const actorAtlas: SpriteAtlas = {
  imageUrl: '/playfield/actors.png',
  sprites: { 'monster.cave-rat': { x: 1, y: 2, w: 3, h: 4 } },
};

const itemAtlas: SpriteAtlas = {
  imageUrl: '/playfield/items.png',
  sprites: {
    'item.iron-sword': { x: 10, y: 10, w: 20, h: 20 },
    'GENERIC-SCROLL': { x: 30, y: 30, w: 40, h: 40 },
    'GENERIC-TOME': { x: 50, y: 50, w: 60, h: 60 },
    'GENERIC-POTION': { x: 70, y: 70, w: 80, h: 80 },
  },
};

describe('resolveFacing', () => {
  it('faces right on an eastward (screen +x) step', () => {
    // +x world with 0 y is screen-right.
    expect(resolveFacing('left', { fromX: 0, fromY: 0, toX: 1, toY: 0 })).toBe('right');
  });

  it('faces left on a westward (screen -x) step', () => {
    expect(resolveFacing('right', { fromX: 1, fromY: 0, toX: 0, toY: 0 })).toBe('left');
  });

  it('uses the iso screen-x (x - y), not world-x, to decide', () => {
    // Moving +1 in both x and y is straight DOWN the screen: screen-x delta is 0, facing preserved.
    expect(resolveFacing('right', { fromX: 0, fromY: 0, toX: 1, toY: 1 })).toBe('right');
    // Moving +y only is screen-left.
    expect(resolveFacing('right', { fromX: 0, fromY: 0, toX: 0, toY: 1 })).toBe('left');
  });

  it('preserves the last facing while idle (no motion)', () => {
    expect(resolveFacing('right', null)).toBe('right');
    expect(resolveFacing('left', null)).toBe('left');
  });
});

describe('resolveActorRect', () => {
  it('returns the crop for a mapped contentId', () => {
    expect(resolveActorRect('monster.cave-rat', actorAtlas)).toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });

  it('falls back (null) for an unmapped monster', () => {
    expect(resolveActorRect('monster.does-not-exist', actorAtlas)).toBeNull();
  });

  it('falls back (null) for a null contentId', () => {
    expect(resolveActorRect(null, actorAtlas)).toBeNull();
  });
});

describe('resolveItemSprite', () => {
  it('uses dedicated art untinted for a mapped, identified item', () => {
    const resolved = resolveItemSprite(
      { contentId: 'item.iron-sword', category: 'weapon', color: '#ff0000' },
      itemAtlas,
    );
    expect(resolved).toEqual({ rect: { x: 10, y: 10, w: 20, h: 20 } });
    expect(resolved?.tint).toBeUndefined();
  });

  it('falls back to a color-tinted GENERIC-SCROLL for an unmapped scroll', () => {
    const resolved = resolveItemSprite({ category: 'scroll', color: '#8a6fd1' }, itemAtlas);
    expect(resolved?.rect).toEqual({ x: 30, y: 30, w: 40, h: 40 });
    expect(resolved?.tint).toBe(0x8a6fd1);
  });

  it('falls back to GENERIC-TOME for a misc item whose id ends -tome', () => {
    const resolved = resolveItemSprite(
      { contentId: 'item.fireball-tome', category: 'misc', color: '#c0ffee' },
      itemAtlas,
    );
    expect(resolved?.rect).toEqual({ x: 50, y: 50, w: 60, h: 60 });
    expect(resolved?.tint).toBe(0xc0ffee);
  });

  it('falls back to GENERIC-POTION for an unidentified potion (no contentId)', () => {
    const resolved = resolveItemSprite({ category: 'potion', color: '#c3484f' }, itemAtlas);
    expect(resolved?.rect).toEqual({ x: 70, y: 70, w: 80, h: 80 });
    expect(resolved?.tint).toBe(0xc3484f);
  });

  it('returns null (glyph fallback) for an unmapped non-scroll/tome/potion category', () => {
    expect(resolveItemSprite({ category: 'ring' }, itemAtlas)).toBeNull();
    expect(
      resolveItemSprite({ contentId: 'item.mystery', category: 'misc' }, itemAtlas),
    ).toBeNull();
  });
});

describe('parseColor', () => {
  it('parses six-digit and three-digit hex, with or without #', () => {
    expect(parseColor('#8a6fd1')).toBe(0x8a6fd1);
    expect(parseColor('8a6fd1')).toBe(0x8a6fd1);
    expect(parseColor('#f0a')).toBe(0xff00aa);
  });

  it('returns undefined for absent or malformed colors', () => {
    expect(parseColor(undefined)).toBeUndefined();
    expect(parseColor('rebeccapurple')).toBeUndefined();
    expect(parseColor('#12')).toBeUndefined();
  });
});

describe('groundItemHoverOffset', () => {
  it('stays within the hover amplitude', () => {
    for (let t = 0; t < 4000; t += 37) {
      const offset = groundItemHoverOffset('floor.one', 3, 4, t);
      expect(Math.abs(offset)).toBeLessThanOrEqual(HOVER_AMPLITUDE_PX + 1e-9);
    }
  });

  it('is deterministic per cell (never Math.random) and stable across calls', () => {
    expect(groundItemHoverOffset('floor.one', 3, 4, 1234)).toBe(
      groundItemHoverOffset('floor.one', 3, 4, 1234),
    );
  });

  it('gives neighboring cells different phases so they do not bob in lockstep', () => {
    // Same instant, adjacent cells: distinct phases derived from distinct cellSeeds.
    const a = groundItemHoverOffset('floor.one', 3, 4, 500);
    const b = groundItemHoverOffset('floor.one', 4, 4, 500);
    expect(a).not.toBe(b);
    // Sanity: the seeds themselves differ, which is what drives the phase.
    expect(cellSeed('floor.one', 3, 4)).not.toBe(cellSeed('floor.one', 4, 4));
  });
});
