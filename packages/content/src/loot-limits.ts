/** Bounds every loot-table expansion before RNG consumption or allocation. */
export const MAX_LOOT_WEIGHT_TOTAL = 0x1_0000_0000;
export const MAX_LOOT_TABLE_ROLLS = 256;
export const MAX_LOOT_CHOICE_QUANTITY = 256;
export const MAX_LOOT_CREATED_UNITS = 4096;

export function boundedProduct(left: number, right: number, maximum: number): number {
  if (!Number.isSafeInteger(left) || left < 0 || !Number.isSafeInteger(right) || right < 0
    || left > Math.floor(maximum / Math.max(1, right))) return maximum + 1;
  return left * right;
}
