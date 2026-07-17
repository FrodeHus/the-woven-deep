import type { CameraViewport } from './camera.js';

/**
 * The three responsive shapes of the Tactical Triptych: `full` shows hero panel, map, and threat
 * panel side by side; `compact` collapses the threat panel into a hover popover plus a keyboard
 * reachable drawer; `minimal` additionally collapses the hero panel to a vitals strip. This module
 * owns the tier and viewport arithmetic as pure functions so both are unit-testable without any DOM
 * measurement — `PlayScreen` is the only place that touches `ResizeObserver`.
 */
export type LayoutTier = 'full' | 'compact' | 'minimal';

// Thresholds were authored assuming the measured width tracks roughly window-width scale. They
// still apply now that the input is the triptych container rather than the map pane: the
// container is the window width minus page padding/margins, which is a fixed, tier-independent
// offset, not a tier-dependent one — unlike the pane, whose own grid column shrinks when the tier
// changes (see `layoutTier`'s doc comment below for why that distinction matters).
const FULL_MIN_CONTAINER_WIDTH_PX = 1100;
const COMPACT_MIN_CONTAINER_WIDTH_PX = 760;

/**
 * `containerWidthPx` MUST be a tier-independent measurement — the triptych container (or window)
 * width — never the map pane. The pane's own CSS grid column shrinks when the tier changes
 * (`1fr 4fr 1fr` full vs `1fr 5fr 0` compact), so feeding the pane's width back into this function
 * creates a resize feedback loop that oscillates the tier indefinitely at mid-band widths.
 */
export function layoutTier(containerWidthPx: number): LayoutTier {
  if (containerWidthPx >= FULL_MIN_CONTAINER_WIDTH_PX) return 'full';
  if (containerWidthPx >= COMPACT_MIN_CONTAINER_WIDTH_PX) return 'compact';
  return 'minimal';
}

/**
 * The smallest viewport the map pane will ever request, even when the pane itself is tiny: a
 * scrolling window this small still shows enough of the floor to read the immediate tactical
 * situation.
 */
export const MIN_VIEWPORT: CameraViewport = { width: 30, height: 12 };

function clampAxis(rawCells: number, minCells: number, floorCells: number): number {
  // `floor size` is the outer bound even when it is smaller than MIN_VIEWPORT (a tiny floor
  // cannot be rendered larger than itself); this nested clamp resolves correctly either way
  // because Math.min(Math.max(x, a), b) always yields b when b < a.
  return Math.min(Math.max(rawCells, minCells), floorCells);
}

export function viewportForPane(input: Readonly<{
  panePx: Readonly<{ width: number; height: number }>;
  cellPx: Readonly<{ width: number; height: number }>;
  floor: Readonly<{ width: number; height: number }>;
}>): CameraViewport {
  const rawWidth = Math.floor(input.panePx.width / input.cellPx.width);
  const rawHeight = Math.floor(input.panePx.height / input.cellPx.height);
  return {
    width: clampAxis(rawWidth, MIN_VIEWPORT.width, input.floor.width),
    height: clampAxis(rawHeight, MIN_VIEWPORT.height, input.floor.height),
  };
}

/**
 * The discrete zoom steps the playfield may render at. Discrete (not continuous) so the grid's
 * `1ch`/`1lh` character-cell alignment never lands on a fractional pixel that would blur
 * monospace glyphs; bounded at 2x because beyond that a compact floor stops reading as a tactical
 * map and starts reading as a magnifying glass.
 */
export const ZOOM_STEPS = [1, 1.25, 1.5, 1.75, 2] as const;
export type ZoomFactor = typeof ZOOM_STEPS[number];

/**
 * Picks the highest zoom step at which the WHOLE floor still fits inside the pane on both axes, so
 * a small authored floor (e.g. the 34x16 town) fills the pane instead of leaving letterboxed empty
 * space, while a floor that already meets-or-exceeds the pane at 1x (any dungeon floor, all of
 * which are far larger than any realistic pane) never gets scaled up and forced into a scrollable
 * camera window instead. `cellPx` MUST be the unzoomed (1x) cell size — the caller is responsible
 * for feeding this function the same base measurement it un-zooms from the live probe, never a
 * value computed independently, so this stays the single source of truth `viewportForPane` and the
 * popover pixel math also read from (see PlayScreen's measure pass).
 */
export function zoomForFloor(input: Readonly<{
  panePx: Readonly<{ width: number; height: number }>;
  cellPx: Readonly<{ width: number; height: number }>;
  floor: Readonly<{ width: number; height: number }>;
}>): ZoomFactor {
  let best: ZoomFactor = 1;
  for (const step of ZOOM_STEPS) {
    const fitsWidth = input.floor.width * input.cellPx.width * step <= input.panePx.width;
    const fitsHeight = input.floor.height * input.cellPx.height * step <= input.panePx.height;
    if (fitsWidth && fitsHeight) best = step;
  }
  return best;
}
