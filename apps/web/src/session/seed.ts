import type { Uint32State } from '@woven-deep/engine';

/**
 * Client-only ambient randomness for a fresh run's seed; the engine itself never touches
 * non-deterministic sources. Used both by `GuestSession` (guest-session.ts) when no explicit seed
 * is passed to `freshRun`, and by `App` for the chargen wizard's seed when no `?seed=` override is
 * present -- `App` needs the seed BEFORE any `GuestSession` exists (chargen constructs its session
 * lazily, at confirm), so it calls this directly rather than going through `GuestSession`.
 */
export function randomSeed(): Uint32State {
  const words = new Uint32Array(4);
  crypto.getRandomValues(words);
  if (words.every((word) => word === 0)) words[0] = 1;
  return [words[0]!, words[1]!, words[2]!, words[3]!];
}
