/** Upper bounds shared by content compilation and runtime preflight validation. */
export const MAX_RANDOM_WEIGHT_TOTAL = 0x1_0000_0000;
export const MAX_ENCOUNTER_MEMBERS = 1024;
export const MAX_SWARM_SPAWN_QUANTITY = 256;
export const MAX_SWARM_LIVING_CHILDREN = 1023;
export const MAX_SWARM_LIVING_MEMBERS = 1024;
export const MAX_SWARM_FLOOR_ACTORS = 1024;

export function checkedTotalWithin(values: readonly number[], maximum: number): boolean {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum - total) return false;
    total += value;
  }
  return true;
}
