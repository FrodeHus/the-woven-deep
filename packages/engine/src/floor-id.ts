import type { OpaqueId } from './model.js';

/**
 * Generates a floor identifier from a depth number with 3-digit zero-padding.
 * Supports depths 0-999 (depth 0 is the authored town); depths >= 1000 throw RangeError.
 * Uses 3-digit padding to ensure lexicographic string comparison matches numeric ordering, so
 * `floor.depth-000` (town) sorts before `floor.depth-001` (the first dungeon floor).
 */
export function depthFloorId(depth: number): OpaqueId {
  if (depth < 0 || depth > 999) {
    throw new RangeError(`floor depth must be between 0 and 999, got ${depth}`);
  }
  return `floor.depth-${String(depth).padStart(3, '0')}`;
}
