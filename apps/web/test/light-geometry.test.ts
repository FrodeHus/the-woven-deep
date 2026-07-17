import { describe, expect, it } from 'vitest';
import { visibilityPolygon, type LightOccluder } from '../src/ui/light-geometry.js';

type Vertex = readonly [number, number];

/**
 * Even-odd ray-casting point-in-polygon test, used by the shadow-wedge and enclosed-room specs to
 * assert a point sits outside (in shadow) or inside (lit) the returned polygon. Standard algorithm;
 * kept local to the test since it's a verification helper, not part of the module's contract.
 */
function pointInPolygon(point: Vertex, polygon: readonly Vertex[]): boolean {
  let inside = false;
  const [px, py] = point;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    const intersects = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function distance(a: Vertex, origin: Readonly<{ x: number; y: number }>): number {
  return Math.hypot(a[0] - origin.x, a[1] - origin.y);
}

/** Detects whether two closed line segments (as consecutive polygon edges) properly intersect. */
function segmentsIntersect(p1: Vertex, p2: Vertex, p3: Vertex, p4: Vertex): boolean {
  const d = (a: Vertex, b: Vertex, c: Vertex) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return false;
}

function isSimplePolygon(polygon: readonly Vertex[]): boolean {
  const n = polygon.length;
  if (n < 4) return true;
  for (let i = 0; i < n; i += 1) {
    const a1 = polygon[i]!;
    const a2 = polygon[(i + 1) % n]!;
    for (let j = i + 1; j < n; j += 1) {
      // Adjacent edges (sharing a vertex) are allowed to "touch" at the shared endpoint; only
      // check non-adjacent edge pairs for a proper crossing.
      if (j === i || j === (i + 1) % n || (j + 1) % n === i) continue;
      const b1 = polygon[j]!;
      const b2 = polygon[(j + 1) % n]!;
      if (segmentsIntersect(a1, a2, b1, b2)) return false;
    }
  }
  return true;
}

const ORIGIN = { x: 10.5, y: 10.5 };
const RADIUS = 8;

describe('visibilityPolygon: open field', () => {
  it('returns a polygon whose every vertex sits at approximately the radius (circle approximation)', () => {
    const polygon = visibilityPolygon({ origin: ORIGIN, radius: RADIUS, occluders: [] });
    expect(polygon.length).toBeGreaterThan(8);
    for (const vertex of polygon) {
      expect(distance(vertex, ORIGIN)).toBeCloseTo(RADIUS, 1);
    }
  });
});

describe('visibilityPolygon: single wall block', () => {
  it('casts a shadow wedge behind the block -- a point directly behind it is outside the polygon', () => {
    // A single occluder cell directly east of the origin, well within radius.
    const occluders: LightOccluder[] = [{ x: 14, y: 10 }];
    const polygon = visibilityPolygon({ origin: ORIGIN, radius: RADIUS, occluders });

    // A point further east, behind the block relative to the origin, along the same ray.
    const behind: Vertex = [17.5, 10.5];
    expect(pointInPolygon(behind, polygon)).toBe(false);

    // A point well off to the side (not shadowed) should still be lit.
    const litSide: Vertex = [10.5, 4.5];
    expect(pointInPolygon(litSide, polygon)).toBe(true);
  });
});

describe('visibilityPolygon: corner grazing', () => {
  it('does not leak light through the diagonal when the origin sits exactly diagonal to a wall corner', () => {
    // Occluder cell whose near corner is exactly on the diagonal from the origin.
    // Origin at (10.5, 10.5); occluder cell (13,13)-(14,14) has its near corner at (13,13),
    // exactly on the 45-degree diagonal from the origin.
    const occluders: LightOccluder[] = [{ x: 13, y: 13 }];
    const polygon = visibilityPolygon({ origin: ORIGIN, radius: RADIUS, occluders });

    // A point just past the occluder's far corner, on the same diagonal, should be shadowed --
    // not leaking through the exact corner graze.
    const farOnDiagonal: Vertex = [15.5, 15.5];
    expect(pointInPolygon(farOnDiagonal, polygon)).toBe(false);
  });
});

describe('visibilityPolygon: enclosed room', () => {
  it('hugs the walls of a small enclosed room -- vertices never exceed the room bounds', () => {
    // A 5x5 room (interior 1..3,1..3 relative offsets) centered on the origin's cell, walls on
    // all four sides at radius 2 from the origin.
    const occluders: LightOccluder[] = [];
    for (let x = 8; x <= 13; x += 1) {
      occluders.push({ x, y: 8 });
      occluders.push({ x, y: 13 });
    }
    for (let y = 8; y <= 13; y += 1) {
      occluders.push({ x: 8, y });
      occluders.push({ x: 13, y });
    }
    const polygon = visibilityPolygon({ origin: ORIGIN, radius: RADIUS, occluders });

    for (const [x, y] of polygon) {
      expect(x).toBeGreaterThanOrEqual(8);
      expect(x).toBeLessThanOrEqual(14);
      expect(y).toBeGreaterThanOrEqual(8);
      expect(y).toBeLessThanOrEqual(14);
    }

    // A point outside the room entirely should not be lit.
    expect(pointInPolygon([20, 20], polygon)).toBe(false);
  });
});

describe('visibilityPolygon: origin inside an occluder', () => {
  it('returns an empty polygon', () => {
    const occluders: LightOccluder[] = [{ x: 10, y: 10 }];
    const polygon = visibilityPolygon({ origin: ORIGIN, radius: RADIUS, occluders });
    expect(polygon).toEqual([]);
  });
});

describe('visibilityPolygon: determinism', () => {
  it('returns the exact same output for the same input, called twice', () => {
    const occluders: LightOccluder[] = [{ x: 14, y: 10 }, { x: 6, y: 12 }];
    const first = visibilityPolygon({ origin: ORIGIN, radius: RADIUS, occluders });
    const second = visibilityPolygon({ origin: ORIGIN, radius: RADIUS, occluders });
    expect(second).toEqual(first);
  });

  it('never calls Math.random', () => {
    const spy = Math.random;
    let called = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Math as any).random = () => {
      called = true;
      return spy();
    };
    try {
      visibilityPolygon({
        origin: ORIGIN,
        radius: RADIUS,
        occluders: [{ x: 14, y: 10 }, { x: 6, y: 12 }, { x: 10, y: 6 }],
      });
    } finally {
      Math.random = spy;
    }
    expect(called).toBe(false);
  });
});

describe('visibilityPolygon: property tests', () => {
  const EPSILON = 0.05;

  it('keeps every vertex within radius + epsilon of the origin, across varied occluder layouts', () => {
    const scenarios: readonly (readonly LightOccluder[])[] = [
      [],
      [{ x: 14, y: 10 }],
      [{ x: 6, y: 12 }, { x: 14, y: 10 }, { x: 10, y: 4 }],
      [{ x: 12, y: 12 }, { x: 13, y: 12 }, { x: 12, y: 13 }, { x: 13, y: 13 }],
    ];
    for (const occluders of scenarios) {
      const polygon = visibilityPolygon({ origin: ORIGIN, radius: RADIUS, occluders });
      for (const vertex of polygon) {
        expect(distance(vertex, ORIGIN)).toBeLessThanOrEqual(RADIUS + EPSILON);
      }
    }
  });

  it('produces a simple polygon (no self-intersecting edges) on small varied layouts', () => {
    const scenarios: readonly (readonly LightOccluder[])[] = [
      [],
      [{ x: 14, y: 10 }],
      [{ x: 6, y: 12 }, { x: 14, y: 10 }],
      [{ x: 12, y: 12 }, { x: 13, y: 12 }, { x: 12, y: 13 }, { x: 13, y: 13 }],
      [{ x: 9, y: 9 }, { x: 12, y: 9 }, { x: 9, y: 12 }],
    ];
    for (const occluders of scenarios) {
      const polygon = visibilityPolygon({ origin: ORIGIN, radius: RADIUS, occluders });
      expect(isSimplePolygon(polygon)).toBe(true);
    }
  });
});
