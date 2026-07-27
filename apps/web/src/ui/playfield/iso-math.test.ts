import { describe, expect, it } from 'vitest';
import {
  TILE_HALF_W,
  TILE_HALF_H,
  worldToScreen,
  screenToWorld,
  cellAtScreen,
  type IsoView,
} from './iso-math.js';

describe('isometric math', () => {
  const view: IsoView = {
    camX: 10,
    camY: 8,
    zoom: 2,
    viewW: 800,
    viewH: 600,
  };

  describe('worldToScreen', () => {
    it('returns readonly tuple', () => {
      const result = worldToScreen(view, 10, 8);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
    });

    it('maps camera center to viewport center', () => {
      const [sx, sy] = worldToScreen(view, view.camX, view.camY);
      expect(sx).toBeCloseTo(view.viewW / 2, 5);
      expect(sy).toBeCloseTo(view.viewH / 2, 5);
    });

    it('applies zoom scaling', () => {
      const [sx1, sy1] = worldToScreen(view, 11, 8);
      const view2x = { ...view, zoom: 4 };
      const [sx2, sy2] = worldToScreen(view2x, 11, 8);
      expect(sx2 - view2x.viewW / 2).toBeCloseTo(2 * (sx1 - view.viewW / 2), 5);
      expect(sy2 - view2x.viewH / 2).toBeCloseTo(2 * (sy1 - view.viewH / 2), 5);
    });

    it('accounts for z elevation', () => {
      const [sx1, sy1] = worldToScreen(view, 10, 8, 0);
      const [sx2, sy2] = worldToScreen(view, 10, 8, 5);
      expect(sx2).toBeCloseTo(sx1, 5);
      expect(sy2).toBeCloseTo(sy1 - 5 * view.zoom, 5);
    });

    it('defaults z to 0', () => {
      const [sx1, sy1] = worldToScreen(view, 10, 8);
      const [sx2, sy2] = worldToScreen(view, 10, 8, 0);
      expect(sx1).toBeCloseTo(sx2, 5);
      expect(sy1).toBeCloseTo(sy2, 5);
    });
  });

  describe('screenToWorld', () => {
    it('returns readonly tuple', () => {
      const result = screenToWorld(view, 400, 300);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
    });

    it('is exact inverse of worldToScreen (z=0)', () => {
      const samples: readonly (readonly [number, number])[] = [
        [0, 0],
        [10, 8],
        [15, 12],
        [5, 3],
        [20, 25],
        [1, 1],
      ];

      samples.forEach(([tx, ty]) => {
        const [sx, sy] = worldToScreen(view, tx, ty, 0);
        const [tx2, ty2] = screenToWorld(view, sx, sy);
        expect(tx2).toBeCloseTo(tx, 9);
        expect(ty2).toBeCloseTo(ty, 9);
      });
    });

    it('handles camera offset correctly', () => {
      const [sx, sy] = worldToScreen(view, view.camX + 1, view.camY + 1);
      const [tx, ty] = screenToWorld(view, sx, sy);
      expect(tx).toBeCloseTo(view.camX + 1, 9);
      expect(ty).toBeCloseTo(view.camY + 1, 9);
    });

    it('handles zoom correctly', () => {
      const viewZoom4 = { ...view, zoom: 4 };
      const [sx, sy] = worldToScreen(viewZoom4, 15, 10);
      const [tx, ty] = screenToWorld(viewZoom4, sx, sy);
      expect(tx).toBeCloseTo(15, 9);
      expect(ty).toBeCloseTo(10, 9);
    });
  });

  describe('cellAtScreen', () => {
    it('returns cell at in-bounds screen position', () => {
      const [sx, sy] = worldToScreen(view, 12, 10);
      const result = cellAtScreen(view, sx, sy, 20, 20);
      expect(result).not.toBeNull();
      expect(result).toEqual({ x: 12, y: 10 });
    });

    it('floors world coords to integers', () => {
      const [sx, sy] = worldToScreen(view, 12.7, 10.3);
      const result = cellAtScreen(view, sx, sy, 20, 20);
      expect(result).toEqual({ x: 12, y: 10 });
    });

    it('returns null when x is negative', () => {
      const [sx, sy] = worldToScreen(view, -1, 10);
      const result = cellAtScreen(view, sx, sy, 20, 20);
      expect(result).toBeNull();
    });

    it('returns null when y is negative', () => {
      const [sx, sy] = worldToScreen(view, 12, -1);
      const result = cellAtScreen(view, sx, sy, 20, 20);
      expect(result).toBeNull();
    });

    it('returns null when x is at boundary', () => {
      const [sx, sy] = worldToScreen(view, 20, 10);
      const result = cellAtScreen(view, sx, sy, 20, 20);
      expect(result).toBeNull();
    });

    it('returns null when y is at boundary', () => {
      const [sx, sy] = worldToScreen(view, 12, 20);
      const result = cellAtScreen(view, sx, sy, 20, 20);
      expect(result).toBeNull();
    });

    it('accepts last valid cell', () => {
      const [sx, sy] = worldToScreen(view, 19, 19);
      const result = cellAtScreen(view, sx, sy, 20, 20);
      expect(result).toEqual({ x: 19, y: 19 });
    });
  });

  describe('constants', () => {
    it('exports TILE_HALF_W = 32', () => {
      expect(TILE_HALF_W).toBe(32);
    });

    it('exports TILE_HALF_H = 16', () => {
      expect(TILE_HALF_H).toBe(16);
    });
  });
});
