/**
 * Visibility-polygon geometry for the canvas light layer (Task 6's `LightCanvas`). Pure and
 * framework-free: no DOM, no React, no imports beyond plain data shapes. Given a light source's
 * origin and a set of opaque occluder cells, computes the polygon of cells the light actually
 * reaches -- a shadow-casting visibility polygon, radius-clipped.
 *
 * Algorithm (ray casting against axis-aligned occluder squares):
 * 1. Build a set of ray angles: an epsilon-pair (plus the exact angle) around every occluder
 *    corner, so shadow edges land precisely on wall silhouettes, PLUS a coarse angular sweep
 *    (every 6 degrees) so open areas -- where no occluder corner constrains the shape -- still
 *    approximate a circle rather than a coarse polygon.
 * 2. For each ray, find the nearest occluder square it hits (AABB slab test) within `radius`; if
 *    none, the ray reaches exactly `radius`.
 * 3. Sort the resulting hit points by angle and return them as the polygon's vertices.
 *
 * This is presentation-only geometry: floats are fine here (the engine's no-float-currency rule
 * doesn't bind `apps/web`), but every epsilon is a named, documented constant -- never a scattered
 * magic literal -- per the milestone's numeric-care requirement.
 */

export interface LightOccluder {
  readonly x: number;
  readonly y: number;
}

export type LightVertex = readonly [number, number];

/**
 * Half-width of the epsilon-pair cast around each occluder corner's exact angle, in radians.
 * Small enough that the pair straddles the corner without perceptibly displacing genuine wall
 * hits, large enough to resolve distinctly from `SWEEP_STEP_RADIANS`-spaced sweep rays and from
 * floating-point noise in `atan2`.
 */
const CORNER_RAY_EPSILON_RADIANS = 1e-4;

/**
 * Angular spacing of the coarse fallback sweep (~6 degrees) that approximates a circle in open
 * areas with no nearby occluder corners to pin the shape to.
 */
const SWEEP_STEP_RADIANS = (6 * Math.PI) / 180;

/**
 * Tolerance added to the slab test's `tmin > tmax` rejection so a ray that grazes an occluder
 * corner EXACTLY tangentially -- the "corner grazing" case, where the true intersection has
 * `tmin === tmax` -- still counts as a hit even if floating-point rounding nudges `tmin` a hair
 * past `tmax`. Without this, a light could leak diagonally through a wall corner by a sliver.
 */
const SLAB_TANGENT_EPSILON = 1e-9;

/**
 * Rounding precision (decimal places) used to de-duplicate ray angles that coincide exactly --
 * e.g. two adjacent occluder cells sharing a corner produce the same angle from the origin twice.
 * Coarser than `CORNER_RAY_EPSILON_RADIANS` so genuine epsilon-pairs are never merged away.
 */
const ANGLE_DEDUPE_DECIMALS = 9;

/**
 * Ray-vs-axis-aligned-unit-square intersection (the classic slab method), for the occluder cell
 * `[occluder.x, occluder.x + 1] x [occluder.y, occluder.y + 1]`. Returns the distance along the
 * ray to the NEAREST entry point, or `null` if the ray (from `t = 0` onward) misses the square
 * entirely.
 */
function raySquareIntersection(
  originX: number,
  originY: number,
  dirX: number,
  dirY: number,
  occluder: LightOccluder,
): number | null {
  const minX = occluder.x;
  const maxX = occluder.x + 1;
  const minY = occluder.y;
  const maxY = occluder.y + 1;

  let tmin = -Infinity;
  let tmax = Infinity;

  if (dirX !== 0) {
    const tx1 = (minX - originX) / dirX;
    const tx2 = (maxX - originX) / dirX;
    tmin = Math.max(tmin, Math.min(tx1, tx2));
    tmax = Math.min(tmax, Math.max(tx1, tx2));
  } else if (originX < minX || originX > maxX) {
    return null;
  }

  if (dirY !== 0) {
    const ty1 = (minY - originY) / dirY;
    const ty2 = (maxY - originY) / dirY;
    tmin = Math.max(tmin, Math.min(ty1, ty2));
    tmax = Math.min(tmax, Math.max(ty1, ty2));
  } else if (originY < minY || originY > maxY) {
    return null;
  }

  if (tmax < 0 || tmin > tmax + SLAB_TANGENT_EPSILON) return null;
  return Math.max(tmin, 0);
}

/** True if `point` sits inside (or exactly on the boundary of) `occluder`'s unit square. */
function pointInsideOccluder(point: Readonly<{ x: number; y: number }>, occluder: LightOccluder): boolean {
  return (
    point.x >= occluder.x
    && point.x <= occluder.x + 1
    && point.y >= occluder.y
    && point.y <= occluder.y + 1
  );
}

/** The four corners of an occluder cell's unit square, in no particular order. */
function occluderCorners(occluder: LightOccluder): readonly (readonly [number, number])[] {
  return [
    [occluder.x, occluder.y],
    [occluder.x + 1, occluder.y],
    [occluder.x, occluder.y + 1],
    [occluder.x + 1, occluder.y + 1],
  ];
}

export function visibilityPolygon(
  input: Readonly<{
    origin: Readonly<{ x: number; y: number }>;
    radius: number;
    occluders: readonly LightOccluder[];
  }>,
): readonly LightVertex[] {
  const { origin, radius, occluders } = input;

  if (occluders.some((occluder) => pointInsideOccluder(origin, occluder))) {
    return [];
  }

  const angles = new Map<string, number>();
  const addAngle = (angle: number) => {
    angles.set(angle.toFixed(ANGLE_DEDUPE_DECIMALS), angle);
  };

  for (const occluder of occluders) {
    for (const [cornerX, cornerY] of occluderCorners(occluder)) {
      const angle = Math.atan2(cornerY - origin.y, cornerX - origin.x);
      addAngle(angle - CORNER_RAY_EPSILON_RADIANS);
      addAngle(angle);
      addAngle(angle + CORNER_RAY_EPSILON_RADIANS);
    }
  }

  const sweepCount = Math.round((2 * Math.PI) / SWEEP_STEP_RADIANS);
  for (let step = 0; step < sweepCount; step += 1) {
    addAngle(-Math.PI + step * SWEEP_STEP_RADIANS);
  }

  const vertices: { angle: number; point: LightVertex }[] = [];
  for (const angle of angles.values()) {
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);

    let nearest = radius;
    for (const occluder of occluders) {
      const hit = raySquareIntersection(origin.x, origin.y, dirX, dirY, occluder);
      if (hit !== null && hit < nearest) nearest = hit;
    }

    vertices.push({ angle, point: [origin.x + dirX * nearest, origin.y + dirY * nearest] });
  }

  vertices.sort((a, b) => a.angle - b.angle);
  return vertices.map((vertex) => vertex.point);
}
