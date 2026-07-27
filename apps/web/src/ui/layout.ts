/**
 * The three responsive shapes of the Tactical Triptych: `full` shows hero panel, map, and threat
 * panel side by side; `compact` collapses the threat panel into a hover popover plus a keyboard
 * reachable drawer; `minimal` additionally collapses the hero panel to a vitals strip. This module
 * owns the tier arithmetic as a pure function so it is unit-testable without any DOM measurement.
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
