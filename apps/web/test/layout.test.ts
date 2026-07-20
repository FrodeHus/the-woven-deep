import { describe, expect, it } from 'vitest';
import {
  layoutTier,
  MIN_VIEWPORT,
  viewportForPane,
  ZOOM_STEPS,
  zoomForFloor,
} from '../src/ui/layout.js';

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

describe('zoomForFloor', () => {
  const CELL_PX = { width: 8, height: 16 };

  it('never exceeds the top step even when the floor is tiny relative to the pane', () => {
    const zoom = zoomForFloor({
      panePx: { width: 4000, height: 4000 },
      cellPx: CELL_PX,
      floor: { width: 4, height: 4 },
    });
    expect(zoom).toBe(ZOOM_STEPS.at(-1));
    expect(zoom).toBe(2);
  });

  it('stays at 1x when the floor already fills or exceeds the pane at 1x (dungeon-sized floor)', () => {
    const zoom = zoomForFloor({
      panePx: { width: 800, height: 400 },
      cellPx: CELL_PX,
      floor: { width: 160, height: 50 },
    });
    expect(zoom).toBe(1);
  });

  it('picks the highest step that still fits both axes for a compact town-sized floor in a big pane', () => {
    // A 34x16 floor at 8x16 cell px needs 272x256 raw px. In a pane comfortably bigger than that
    // but not big enough for the full 2x step (544x512), the highest step that fits both axes wins.
    const zoom = zoomForFloor({
      panePx: { width: 400, height: 380 },
      cellPx: CELL_PX,
      floor: { width: 34, height: 16 },
    });
    // 1.25x -> 340x320 (fits); 1.5x -> 408x384 (width overflows) -> highest fitting step is 1.25.
    expect(zoom).toBe(1.25);
  });

  it('never goes below 1x even when nothing above 1x fits', () => {
    const zoom = zoomForFloor({
      panePx: { width: 100, height: 100 },
      cellPx: CELL_PX,
      floor: { width: 34, height: 16 },
    });
    expect(zoom).toBe(1);
  });

  it('is monotonic: every step in ZOOM_STEPS is between 1 and 2 inclusive', () => {
    for (const step of ZOOM_STEPS) {
      expect(step).toBeGreaterThanOrEqual(1);
      expect(step).toBeLessThanOrEqual(2);
    }
  });
});
