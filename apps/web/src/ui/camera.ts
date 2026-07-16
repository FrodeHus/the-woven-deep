/**
 * Pure deadzone camera so floors larger than the viewport render as a scrolling window. Every
 * function here is stateless: the caller (PlayScreen) owns the previous-origin ref keyed by
 * floorId and feeds it back in on the next call.
 */

export interface CameraViewport { readonly width: number; readonly height: number }
export interface CameraOrigin { readonly x: number; readonly y: number }

/**
 * The deadzone margin equals the hero's sight radius, clamped per axis to
 * floor((viewportAxis - 1) / 2) so a margin always leaves room for a deadzone interior. A margin
 * equal to sight radius guarantees every engine-visible actor stays inside the viewport (nothing
 * attacks from off-screen) as long as the axis is large enough to hold it; on axes where the sight
 * diameter approaches the viewport size the clamp degrades the camera toward center-lock, which is
 * an accepted trade-off.
 */
export function cameraMargin(
  sightRadius: number, viewport: CameraViewport,
): Readonly<{ x: number; y: number }> {
  const maxX = Math.floor((viewport.width - 1) / 2);
  const maxY = Math.floor((viewport.height - 1) / 2);
  return { x: Math.min(sightRadius, maxX), y: Math.min(sightRadius, maxY) };
}

function clampAxis(origin: number, viewportSize: number, floorSize: number): number {
  if (floorSize <= viewportSize) return Math.floor((floorSize - viewportSize) / 2);
  return Math.min(Math.max(origin, 0), floorSize - viewportSize);
}

function centeredAxis(heroPosition: number, viewportSize: number, floorSize: number): number {
  return clampAxis(heroPosition - Math.floor(viewportSize / 2), viewportSize, floorSize);
}

/**
 * Restores exactly the deadzone margin on one axis once the hero crosses it, otherwise leaves the
 * origin untouched. Applied before floor-bounds clamping.
 */
function scrolledAxis(
  previousOrigin: number, heroPosition: number, margin: number, viewportSize: number,
): number {
  const leftEdge = previousOrigin + margin;
  const rightEdge = previousOrigin + viewportSize - 1 - margin;
  if (heroPosition < leftEdge) return heroPosition - margin;
  if (heroPosition > rightEdge) return heroPosition - (viewportSize - 1 - margin);
  return previousOrigin;
}

export function computeCamera(input: Readonly<{
  hero: Readonly<{ x: number; y: number }>;
  sightRadius: number;
  floor: Readonly<{ width: number; height: number }>;
  viewport: CameraViewport;
  previous: CameraOrigin | null;
}>): CameraOrigin {
  const { hero, sightRadius, floor, viewport, previous } = input;

  if (previous === null) {
    return {
      x: centeredAxis(hero.x, viewport.width, floor.width),
      y: centeredAxis(hero.y, viewport.height, floor.height),
    };
  }

  const margin = cameraMargin(sightRadius, viewport);
  const scrolledX = scrolledAxis(previous.x, hero.x, margin.x, viewport.width);
  const scrolledY = scrolledAxis(previous.y, hero.y, margin.y, viewport.height);
  return {
    x: clampAxis(scrolledX, viewport.width, floor.width),
    y: clampAxis(scrolledY, viewport.height, floor.height),
  };
}
