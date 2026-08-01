/**
 * Depth banding shared by every system that scales with how deep the hero is
 * (loot tables, encounter density, curse rolls). Lives in its own module so the
 * item-creation call sites and the placement modules can share it without
 * importing each other.
 */
export type DepthBand = 'shallow' | 'mid' | 'deep';

export const DEPTH_BANDS: readonly DepthBand[] = ['shallow', 'mid', 'deep'];

export function depthBandFor(
  depth: number,
  bands: Readonly<{ shallowMaxDepth: number; midMaxDepth: number }>,
): DepthBand {
  if (depth <= bands.shallowMaxDepth) return 'shallow';
  if (depth <= bands.midMaxDepth) return 'mid';
  return 'deep';
}
