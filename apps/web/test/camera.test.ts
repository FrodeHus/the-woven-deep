import { describe, expect, it } from 'vitest';
import { cameraMargin, computeCamera, type CameraOrigin, type CameraViewport } from '../src/ui/camera.js';

const BIG_FLOOR = { width: 80, height: 25 } as const;
const VIEWPORT: CameraViewport = { width: 40, height: 15 };

describe('cameraMargin', () => {
  it('equals sight radius on both axes of a 60x20 viewport when it fits', () => {
    const viewport: CameraViewport = { width: 60, height: 20 };
    expect(cameraMargin(8, viewport)).toEqual({ x: 8, y: 8 });
  });

  it('clamps to floor((axis - 1) / 2) per axis when sight radius does not fit', () => {
    const viewport: CameraViewport = { width: 60, height: 20 };
    // floor((60-1)/2) = 29 -> 12 fits on x; floor((20-1)/2) = 9 -> 12 clamps to 9 on y.
    expect(cameraMargin(12, viewport)).toEqual({ x: 12, y: 9 });
  });
});

describe('computeCamera: initial centering and clamping', () => {
  it('centers on the hero when previous is null', () => {
    const camera = computeCamera({
      hero: { x: 40, y: 12 }, sightRadius: 6, floor: BIG_FLOOR, viewport: VIEWPORT, previous: null,
    });
    expect(camera).toEqual({ x: 20, y: 5 });
  });

  it('clamps centering at the top-left floor corner', () => {
    const camera = computeCamera({
      hero: { x: 0, y: 0 }, sightRadius: 6, floor: BIG_FLOOR, viewport: VIEWPORT, previous: null,
    });
    expect(camera).toEqual({ x: 0, y: 0 });
  });

  it('clamps centering at the bottom-right floor corner', () => {
    const camera = computeCamera({
      hero: { x: 79, y: 24 }, sightRadius: 6, floor: BIG_FLOOR, viewport: VIEWPORT, previous: null,
    });
    expect(camera).toEqual({ x: 40, y: 10 });
  });

  it('clamps centering at the top-right floor corner', () => {
    const camera = computeCamera({
      hero: { x: 79, y: 0 }, sightRadius: 6, floor: BIG_FLOOR, viewport: VIEWPORT, previous: null,
    });
    expect(camera).toEqual({ x: 40, y: 0 });
  });

  it('clamps centering at the bottom-left floor corner', () => {
    const camera = computeCamera({
      hero: { x: 0, y: 24 }, sightRadius: 6, floor: BIG_FLOOR, viewport: VIEWPORT, previous: null,
    });
    expect(camera).toEqual({ x: 0, y: 10 });
  });
});

describe('computeCamera: deadzone scrolling', () => {
  it('does not scroll while the hero stays inside the deadzone', () => {
    const previous: CameraOrigin = { x: 20, y: 5 };
    // margin is 6 on both axes; hero can range x in [26,53] and y in [11,13] (viewport height 15
    // leaves only viewport.height - 2*margin = 3 rows of deadzone) without a scroll.
    for (const hero of [{ x: 26, y: 11 }, { x: 40, y: 12 }, { x: 53, y: 13 }]) {
      const camera = computeCamera({
        hero, sightRadius: 6, floor: BIG_FLOOR, viewport: VIEWPORT, previous,
      });
      expect(camera).toEqual(previous);
    }
  });

  it('scrolls left by the exact amount that restores the margin when the hero crosses the left edge', () => {
    const previous: CameraOrigin = { x: 20, y: 5 };
    // left margin edge is x=26; hero at 25 is one past it; y=12 stays inside the y deadzone.
    const camera = computeCamera({
      hero: { x: 25, y: 12 }, sightRadius: 6, floor: BIG_FLOOR, viewport: VIEWPORT, previous,
    });
    expect(camera).toEqual({ x: 19, y: 5 });
  });

  it('scrolls right by the exact amount that restores the margin when the hero crosses the right edge', () => {
    const previous: CameraOrigin = { x: 20, y: 5 };
    // right margin edge is x=53; hero at 54 is one past it; y=12 stays inside the y deadzone.
    const camera = computeCamera({
      hero: { x: 54, y: 12 }, sightRadius: 6, floor: BIG_FLOOR, viewport: VIEWPORT, previous,
    });
    expect(camera).toEqual({ x: 21, y: 5 });
  });

  it('scrolls up by the exact amount that restores the margin when the hero crosses the top edge', () => {
    const previous: CameraOrigin = { x: 20, y: 5 };
    // top margin edge is y=11; hero at 10 is one past it; x=40 stays inside the x deadzone.
    const camera = computeCamera({
      hero: { x: 40, y: 10 }, sightRadius: 6, floor: BIG_FLOOR, viewport: VIEWPORT, previous,
    });
    expect(camera).toEqual({ x: 20, y: 4 });
  });

  it('scrolls down by the exact amount that restores the margin when the hero crosses the bottom edge', () => {
    const previous: CameraOrigin = { x: 20, y: 5 };
    // bottom margin edge is y=13; hero at 14 is one past it; x=40 stays inside the x deadzone.
    const camera = computeCamera({
      hero: { x: 40, y: 14 }, sightRadius: 6, floor: BIG_FLOOR, viewport: VIEWPORT, previous,
    });
    expect(camera).toEqual({ x: 20, y: 6 });
  });

  it('clamps the scroll at every floor edge instead of overshooting past it', () => {
    // Hero right at the floor's top-left corner, previous camera already centered there: any
    // scroll math must not push the origin negative.
    const previous: CameraOrigin = { x: 0, y: 0 };
    const camera = computeCamera({
      hero: { x: 0, y: 0 }, sightRadius: 6, floor: BIG_FLOOR, viewport: VIEWPORT, previous,
    });
    expect(camera).toEqual({ x: 0, y: 0 });

    // Hero at the floor's bottom-right corner with a previous camera already pinned to the
    // maximum origin: scroll math must not push the origin past floor bounds either.
    const maxPrevious: CameraOrigin = { x: 40, y: 10 };
    const cornerCamera = computeCamera({
      hero: { x: 79, y: 24 }, sightRadius: 6, floor: BIG_FLOOR, viewport: VIEWPORT, previous: maxPrevious,
    });
    expect(cornerCamera).toEqual({ x: 40, y: 10 });
  });
});

describe('computeCamera: small floors', () => {
  it('centers the floor on the x axis when the floor is narrower than the viewport', () => {
    const floor = { width: 20, height: 25 };
    const camera = computeCamera({
      hero: { x: 10, y: 12 }, sightRadius: 6, floor, viewport: VIEWPORT, previous: null,
    });
    expect(camera.x).toBe(Math.floor((20 - 40) / 2));
    expect(camera.y).toBe(5);
  });

  it('centers the floor on the y axis when the floor is shorter than the viewport', () => {
    const floor = { width: 80, height: 8 };
    const camera = computeCamera({
      hero: { x: 40, y: 4 }, sightRadius: 6, floor, viewport: VIEWPORT, previous: null,
    });
    expect(camera.x).toBe(20);
    expect(camera.y).toBe(Math.floor((8 - 15) / 2));
  });

  it('centers the floor on both axes when it is smaller than the viewport on both, and stays centered as the hero moves', () => {
    const floor = { width: 12, height: 6 };
    const expected = { x: Math.floor((12 - 40) / 2), y: Math.floor((6 - 15) / 2) };
    const initial = computeCamera({
      hero: { x: 3, y: 2 }, sightRadius: 6, floor, viewport: VIEWPORT, previous: null,
    });
    expect(initial).toEqual(expected);
    const afterMove = computeCamera({
      hero: { x: 8, y: 5 }, sightRadius: 6, floor, viewport: VIEWPORT, previous: initial,
    });
    expect(afterMove).toEqual(expected);
  });
});

describe('computeCamera: visibility guarantee sweep', () => {
  // sightRadius 6 fits the deadzone margin on both axes of this viewport (margin caps at 19 and 7
  // respectively), so the invariant should hold everywhere except right at floor edges where fewer
  // floor cells exist than the sight radius would otherwise reach.
  const sightRadius = 6;

  function assertHeroVisible(hero: Readonly<{ x: number; y: number }>, camera: CameraOrigin): void {
    for (let dy = -sightRadius; dy <= sightRadius; dy += 1) {
      for (let dx = -sightRadius; dx <= sightRadius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) > sightRadius) continue;
        const x = hero.x + dx;
        const y = hero.y + dy;
        if (x < 0 || x >= BIG_FLOOR.width || y < 0 || y >= BIG_FLOOR.height) continue;
        const insideViewport = x >= camera.x && x < camera.x + VIEWPORT.width
          && y >= camera.y && y < camera.y + VIEWPORT.height;
        if (!insideViewport) {
          throw new Error(`cell (${x},${y}) within sight of hero (${hero.x},${hero.y}) `
            + `escaped viewport at camera (${camera.x},${camera.y})`);
        }
      }
    }
  }

  it('keeps every sight-radius cell inside the viewport along a boustrophedon sweep of the floor', () => {
    let previous: CameraOrigin | null = null;
    for (let y = 0; y < BIG_FLOOR.height; y += 1) {
      const xs = y % 2 === 0
        ? Array.from({ length: BIG_FLOOR.width }, (_unused, index) => index)
        : Array.from({ length: BIG_FLOOR.width }, (_unused, index) => BIG_FLOOR.width - 1 - index);
      for (const x of xs) {
        const hero = { x, y };
        const camera = computeCamera({
          hero, sightRadius, floor: BIG_FLOOR, viewport: VIEWPORT, previous,
        });
        expect(() => assertHeroVisible(hero, camera)).not.toThrow();
        previous = camera;
      }
    }
  });

  it('keeps the guarantee starting fresh (previous: null) from arbitrary hero positions', () => {
    for (const hero of [{ x: 0, y: 0 }, { x: 79, y: 24 }, { x: 40, y: 12 }, { x: 5, y: 20 }, { x: 75, y: 3 }]) {
      const camera = computeCamera({
        hero, sightRadius, floor: BIG_FLOOR, viewport: VIEWPORT, previous: null,
      });
      assertHeroVisible(hero, camera);
    }
  });
});
