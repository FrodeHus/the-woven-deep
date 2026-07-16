import { describe, expect, it } from 'vitest';
import { layoutTier, MIN_VIEWPORT, viewportForPane } from '../src/ui/layout.js';

describe('layoutTier', () => {
  it('is full at exactly the full threshold and above', () => {
    expect(layoutTier(1100)).toBe('full');
    expect(layoutTier(1101)).toBe('full');
    expect(layoutTier(2000)).toBe('full');
  });

  it('is compact just below the full threshold', () => {
    expect(layoutTier(1099)).toBe('compact');
  });

  it('is compact at exactly the compact threshold and above', () => {
    expect(layoutTier(760)).toBe('compact');
    expect(layoutTier(761)).toBe('compact');
  });

  it('is minimal just below the compact threshold and below', () => {
    expect(layoutTier(759)).toBe('minimal');
    expect(layoutTier(0)).toBe('minimal');
  });
});

describe('viewportForPane', () => {
  const BIG_FLOOR = { width: 200, height: 100 };

  it('divides pane by cell size exactly per axis when it divides evenly', () => {
    const viewport = viewportForPane({
      panePx: { width: 800, height: 400 },
      cellPx: { width: 8, height: 16 },
      floor: BIG_FLOOR,
    });
    expect(viewport).toEqual({ width: 100, height: 25 });
  });

  it('floors a non-exact division per axis', () => {
    const viewport = viewportForPane({
      panePx: { width: 805, height: 407 },
      cellPx: { width: 8, height: 16 },
      floor: BIG_FLOOR,
    });
    expect(viewport).toEqual({ width: 100, height: 25 });
  });

  it('clamps up to MIN_VIEWPORT.width when the pane is too narrow, independent of height', () => {
    const viewport = viewportForPane({
      panePx: { width: 40, height: 400 },
      cellPx: { width: 8, height: 16 },
      floor: BIG_FLOOR,
    });
    expect(viewport).toEqual({ width: MIN_VIEWPORT.width, height: 25 });
  });

  it('clamps up to MIN_VIEWPORT.height when the pane is too short, independent of width', () => {
    const viewport = viewportForPane({
      panePx: { width: 800, height: 32 },
      cellPx: { width: 8, height: 16 },
      floor: BIG_FLOOR,
    });
    expect(viewport).toEqual({ width: 100, height: MIN_VIEWPORT.height });
  });

  it('clamps down to the floor width when the floor is narrower than the raw and MIN_VIEWPORT width', () => {
    const viewport = viewportForPane({
      panePx: { width: 800, height: 400 },
      cellPx: { width: 8, height: 16 },
      floor: { width: 10, height: 100 },
    });
    expect(viewport.width).toBe(10);
    expect(viewport.height).toBe(25);
  });

  it('clamps down to the floor height when the floor is shorter than the raw and MIN_VIEWPORT height', () => {
    const viewport = viewportForPane({
      panePx: { width: 800, height: 400 },
      cellPx: { width: 8, height: 16 },
      floor: { width: 200, height: 8 },
    });
    expect(viewport.width).toBe(100);
    expect(viewport.height).toBe(8);
  });
});
